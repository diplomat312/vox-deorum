import Database from 'better-sqlite3';
import { Kysely, sql, type Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import { openSqliteKysely, type OpenedSqlite } from '../../utils/telemetry/sqlite-helpers.js';
import type { SocialActor, SocialActorDefinition, SocialChannel, SocialChannelKind, SocialIntention, SocialMembership, SocialMessage, SocialMemory, SocialSessionDefinition, VisibleMessagePage } from '../types.js';
import type { SocialDatabase, SocialActorRow, SocialChannelRow, SocialIntentionRow, SocialMembershipRow, SocialMessageRow } from './schema.js';

type SocialDb = Kysely<SocialDatabase> | Transaction<SocialDatabase>;

/** Durable SQLite store for one game-independent social session. */
export class SocialStore {
  private readonly opened: OpenedSqlite<SocialDatabase>;
  /** Open a database and create the schema if necessary. */
  public constructor(dbPath: string) { this.opened = openSqliteKysely<SocialDatabase>(dbPath); this.createSchema(this.opened.sqlite); }
  /** Close the database. */
  public async close(): Promise<void> { await this.opened.db.destroy(); }
  /** Create a session, its actors, WORLD, and WORLD memberships atomically. */
  public async createSession(session: SocialSessionDefinition, actors: SocialActorDefinition[]): Promise<void> {
    const now = session.createdAt ?? new Date().toISOString();
    await this.opened.db.transaction().execute(async (trx) => {
      await trx.insertInto('socialSessions').values({ id: session.id, humanActorId: session.humanActorId, createdAt: now }).execute();
      for (const actor of actors) await trx.insertInto('socialActors').values({ id: actor.id, sessionId: session.id, ordinal: actor.ordinal, control: actor.control, displayName: actor.displayName, modelRef: actor.modelRef ?? null, profile: actor.profile ?? null, createdAt: now, status: 'active' }).execute();
      await trx.insertInto('socialChannels').values({ id: 'world', sessionId: session.id, kind: 'world', title: 'WORLD', createdByActorId: session.humanActorId, canonicalKey: 'world', createdAt: now, archived: 0 }).execute();
      for (const actor of actors) await this.insertMembership(trx, 'world', actor.id, 'active', null, 0, now);
    });
  }
  /** Return all actors in a session. */
  public async listActors(sessionId: string): Promise<SocialActor[]> { const rows = await this.opened.db.selectFrom('socialActors').selectAll().where('sessionId', '=', sessionId).orderBy('ordinal', 'asc').execute(); return rows.map((row) => ({ ...row, control: row.control as SocialActor['control'], status: row.status as SocialActor['status'], modelRef: row.modelRef ?? undefined, profile: row.profile ?? undefined })); }
  /** Return the persisted session definition. */
  public async getSession(sessionId: string): Promise<SocialSessionDefinition | undefined> { const row = await this.opened.db.selectFrom('socialSessions').selectAll().where('id', '=', sessionId).executeTakeFirst(); return row ? { id: row.id, humanActorId: row.humanActorId, createdAt: row.createdAt } : undefined; }
  /** Change a model actor's model for future runs without interrupting the session. */
  public async updateActorModel(sessionId: string, actorId: string, modelRef: string): Promise<SocialActor> { const row = await this.opened.db.updateTable('socialActors').set({ modelRef }).where('sessionId', '=', sessionId).where('id', '=', actorId).where('control', '=', 'model').returningAll().executeTakeFirstOrThrow(); return { ...row, control: row.control as SocialActor['control'], status: row.status as SocialActor['status'], modelRef: row.modelRef ?? undefined, profile: row.profile ?? undefined }; }
  /** Return channels visible to an actor, or all channels for explicit developer inspection. */
  public async listChannels(sessionId: string, actorId: string, inspect = false): Promise<SocialChannel[]> {
    const rows = inspect ? await this.opened.db.selectFrom('socialChannels').selectAll().where('sessionId', '=', sessionId).where('archived', '=', 0).orderBy('createdAt', 'asc').execute() : await this.opened.db.selectFrom('socialChannels as c').innerJoin('socialMemberships as m', 'm.channelId', 'c.id').selectAll('c').where('c.sessionId', '=', sessionId).where('c.archived', '=', 0).where('m.actorId', '=', actorId).where('m.status', '=', 'active').orderBy('c.createdAt', 'asc').execute();
    return rows.map((row) => ({ ...row, kind: row.kind as SocialChannelKind, archived: row.archived === 1 }));
  }
  /** Open the canonical DM for a pair, creating it only once. */
  public async openDm(sessionId: string, actorAId: string, actorBId: string, title: string): Promise<SocialChannel> {
    const canonicalKey = `dm:${[actorAId, actorBId].sort().join(':')}`;
    const existing = await this.opened.db.selectFrom('socialChannels').selectAll().where('sessionId', '=', sessionId).where('canonicalKey', '=', canonicalKey).executeTakeFirst();
    if (existing) return this.toChannel(existing);
    const channelId = randomUUID(); const now = new Date().toISOString();
    await this.opened.db.transaction().execute(async (trx) => { await trx.insertInto('socialChannels').values({ id: channelId, sessionId, kind: 'dm', title, createdByActorId: actorAId, canonicalKey, createdAt: now, archived: 0 }).execute(); await this.insertMembership(trx, channelId, actorAId, 'active', null, 0, now); await this.insertMembership(trx, channelId, actorBId, 'active', null, 0, now); });
    return this.toChannel(await this.opened.db.selectFrom('socialChannels').selectAll().where('id', '=', channelId).executeTakeFirstOrThrow());
  }
  /** Create a private group with the creator active and optional invitees pending. */
  public async createGroup(sessionId: string, creatorActorId: string, title: string, invitedActorIds: string[] = []): Promise<SocialChannel> {
    const channelId = randomUUID(); const now = new Date().toISOString();
    await this.opened.db.transaction().execute(async (trx) => { await trx.insertInto('socialChannels').values({ id: channelId, sessionId, kind: 'group', title, createdByActorId: creatorActorId, canonicalKey: null, createdAt: now, archived: 0 }).execute(); await this.insertMembership(trx, channelId, creatorActorId, 'active', null, 0, now); for (const actorId of invitedActorIds) await this.insertMembership(trx, channelId, actorId, 'invited', creatorActorId, await this.latestMessageId(trx, channelId), now); });
    return this.toChannel(await this.opened.db.selectFrom('socialChannels').selectAll().where('id', '=', channelId).executeTakeFirstOrThrow());
  }
  /** Invite an actor at a precise history boundary. */
  public async invite(channelId: string, actorId: string, invitedByActorId: string): Promise<SocialMembership> {
    const now = new Date().toISOString();
    await this.opened.db.transaction().execute(async (trx) => { await trx.selectFrom('socialChannels').select('id').where('id', '=', channelId).executeTakeFirstOrThrow(); await this.assertActiveMember(trx, channelId, invitedByActorId); await trx.insertInto('socialMemberships').values({ id: randomUUID(), channelId, actorId, status: 'invited', invitedByActorId, visibleAfterMessageId: await this.latestMessageId(trx, channelId), leftAfterMessageId: null, createdAt: now, updatedAt: now }).execute(); });
    return this.toMembership(await this.opened.db.selectFrom('socialMemberships').selectAll().where('channelId', '=', channelId).where('actorId', '=', actorId).orderBy('createdAt', 'desc').executeTakeFirstOrThrow());
  }
  /** Accept or decline the current invitation. */
  public async resolveInvitation(channelId: string, actorId: string, accepted: boolean): Promise<SocialMembership> { const row = await this.opened.db.selectFrom('socialMemberships').selectAll().where('channelId', '=', channelId).where('actorId', '=', actorId).where('status', '=', 'invited').orderBy('createdAt', 'desc').executeTakeFirstOrThrow(); return this.toMembership(await this.opened.db.updateTable('socialMemberships').set({ status: accepted ? 'active' : 'declined', updatedAt: new Date().toISOString() }).where('id', '=', row.id).returningAll().executeTakeFirstOrThrow()); }
  /** Leave a group and close the actor's current access period. */
  public async leaveGroup(channelId: string, actorId: string): Promise<SocialMembership> { const now = new Date().toISOString(); const row = await this.opened.db.transaction().execute(async (trx) => { const m = await trx.selectFrom('socialMemberships').selectAll().where('channelId', '=', channelId).where('actorId', '=', actorId).where('status', '=', 'active').executeTakeFirstOrThrow(); return trx.updateTable('socialMemberships').set({ status: 'left', leftAfterMessageId: await this.latestMessageId(trx, channelId), updatedAt: now }).where('id', '=', m.id).returningAll().executeTakeFirstOrThrow(); }); return this.toMembership(row); }
  /** Append a message with server-bound speaker identity and idempotency. */
  public async appendMessage(input: { sessionId: string; actorId: string; channelId: string; content: string; replyToMessageId?: number; intentionId?: string; idempotencyKey?: string }): Promise<SocialMessage> {
    if (input.idempotencyKey) { const existing = await this.opened.db.selectFrom('socialMessages').selectAll().where('idempotencyKey', '=', input.idempotencyKey).executeTakeFirst(); if (existing) return this.toMessage(existing); }
    const row = await this.opened.db.transaction().execute(async (trx) => { const channel = await trx.selectFrom('socialChannels').selectAll().where('id', '=', input.channelId).where('sessionId', '=', input.sessionId).executeTakeFirstOrThrow(); await this.assertActiveMember(trx, channel.id, input.actorId); if (input.replyToMessageId !== undefined) { const reply = await trx.selectFrom('socialMessages').selectAll().where('id', '=', input.replyToMessageId).where('channelId', '=', input.channelId).executeTakeFirstOrThrow(); await this.assertMessageVisible(trx, input.actorId, reply); } return trx.insertInto('socialMessages').values({ channelId: input.channelId, speakerActorId: input.actorId, content: input.content, replyToMessageId: input.replyToMessageId ?? null, createdAt: new Date().toISOString(), intentionId: input.intentionId ?? null, idempotencyKey: input.idempotencyKey ?? null }).returningAll().executeTakeFirstOrThrow(); });
    return this.toMessage(row);
  }
  /** Read only messages visible during the actor's active membership periods. */
  public async readMessages(sessionId: string, channelId: string, actorId: string, limit = 100, beforeId?: number, inspect = false): Promise<VisibleMessagePage> {
    let query = this.opened.db.selectFrom('socialMessages as msg').innerJoin('socialChannels as channel', 'channel.id', 'msg.channelId').selectAll('msg').where('channel.sessionId', '=', sessionId).where('msg.channelId', '=', channelId);
    if (!inspect) query = query.where((eb) => eb.exists(eb.selectFrom('socialMemberships as member').select('member.id').whereRef('member.channelId', '=', 'msg.channelId').where('member.actorId', '=', actorId).where('member.status', 'in', ['active', 'left']).whereRef('member.visibleAfterMessageId', '<', 'msg.id').where((inner) => inner.or([inner('member.leftAfterMessageId', 'is', null), inner('member.leftAfterMessageId', '>=', eb.ref('msg.id'))]))));
    if (beforeId !== undefined) query = query.where('msg.id', '<', beforeId);
    const rows = await query.orderBy('msg.id', 'desc').limit(limit + 1).execute(); return { messages: rows.slice(0, limit).reverse().map((row) => this.toMessage(row)), hasMore: rows.length > limit };
  }
  /** Replace an actor's private memory with a new revision. */
  public async updateMemory(actorId: string, content: string, sourceRunId?: string): Promise<SocialMemory> { const current = await this.opened.db.selectFrom('socialMemories').selectAll().where('actorId', '=', actorId).executeTakeFirst(); const row = await this.opened.db.insertInto('socialMemories').values({ actorId, revision: (current?.revision ?? 0) + 1, content, updatedAt: new Date().toISOString(), sourceRunId: sourceRunId ?? null }).onConflict((oc) => oc.column('actorId').doUpdateSet({ revision: (current?.revision ?? 0) + 1, content, updatedAt: new Date().toISOString(), sourceRunId: sourceRunId ?? null })).returningAll().executeTakeFirstOrThrow(); return row; }
  /** Read one actor's private memory. */
  public async getMemory(actorId: string): Promise<SocialMemory | undefined> { const row = await this.opened.db.selectFrom('socialMemories').selectAll().where('actorId', '=', actorId).executeTakeFirst(); return row ? { ...row } : undefined; }
  /** Enqueue a durable intention with an optional deduplication key. */
  public async enqueueIntention(input: Omit<SocialIntention, 'createdAt' | 'updatedAt' | 'attemptCount' | 'lastError'>): Promise<SocialIntention> { const now = new Date().toISOString(); const row = await this.opened.db.insertInto('socialIntentions').values({ ...input, payload: input.payload, attemptCount: 0, lastError: null, createdAt: now, updatedAt: now }).onConflict((oc) => oc.column('dedupeKey').doNothing()).returningAll().executeTakeFirst(); return this.toIntention(row ?? await this.opened.db.selectFrom('socialIntentions').selectAll().where('dedupeKey', '=', input.dedupeKey).executeTakeFirstOrThrow()); }
  /** Create all social tables and indexes on the opened SQLite connection. */
  private createSchema(sqlite: InstanceType<typeof Database>): void { sqlite.exec(`CREATE TABLE IF NOT EXISTS socialSessions (id TEXT PRIMARY KEY, humanActorId TEXT NOT NULL, createdAt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS socialActors (id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, ordinal INTEGER NOT NULL, control TEXT NOT NULL, displayName TEXT NOT NULL, modelRef TEXT, profile TEXT, createdAt TEXT NOT NULL, status TEXT NOT NULL); CREATE TABLE IF NOT EXISTS socialChannels (id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, createdByActorId TEXT NOT NULL, canonicalKey TEXT, createdAt TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, UNIQUE(sessionId, canonicalKey)); CREATE TABLE IF NOT EXISTS socialMemberships (id TEXT PRIMARY KEY, channelId TEXT NOT NULL, actorId TEXT NOT NULL, status TEXT NOT NULL, invitedByActorId TEXT, visibleAfterMessageId INTEGER NOT NULL, leftAfterMessageId INTEGER, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS socialMessages (id INTEGER PRIMARY KEY AUTOINCREMENT, channelId TEXT NOT NULL, speakerActorId TEXT NOT NULL, content TEXT NOT NULL, replyToMessageId INTEGER, createdAt TEXT NOT NULL, intentionId TEXT, idempotencyKey TEXT UNIQUE); CREATE TABLE IF NOT EXISTS socialMemories (actorId TEXT PRIMARY KEY, revision INTEGER NOT NULL, content TEXT NOT NULL, updatedAt TEXT NOT NULL, sourceRunId TEXT); CREATE TABLE IF NOT EXISTS socialIntentions (id TEXT PRIMARY KEY, actorId TEXT NOT NULL, kind TEXT NOT NULL, channelId TEXT, sourceMessageId INTEGER, priority INTEGER NOT NULL, state TEXT NOT NULL, notBefore TEXT NOT NULL, payload TEXT, dedupeKey TEXT UNIQUE, attemptCount INTEGER NOT NULL, lastError TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); CREATE INDEX IF NOT EXISTS socialMessagesChannelIdIndex ON socialMessages(channelId, id); CREATE INDEX IF NOT EXISTS socialMembershipsActorIndex ON socialMemberships(actorId, channelId);`); }
  /** Insert a membership inside a caller-owned transaction. */
  private async insertMembership(db: SocialDb, channelId: string, actorId: string, status: string, invitedByActorId: string | null, visibleAfterMessageId: number, now: string): Promise<void> { await db.insertInto('socialMemberships').values({ id: randomUUID(), channelId, actorId, status, invitedByActorId, visibleAfterMessageId, leftAfterMessageId: null, createdAt: now, updatedAt: now }).execute(); }
  /** Return the latest message boundary for a channel. */
  private async latestMessageId(db: SocialDb, channelId: string): Promise<number> { const row = await db.selectFrom('socialMessages').select(sql<number>`COALESCE(MAX(id), 0)`.as('latest')).where('channelId', '=', channelId).executeTakeFirstOrThrow(); return Number(row.latest); }
  /** Require active membership before a write. */
  private async assertActiveMember(db: SocialDb, channelId: string, actorId: string): Promise<void> { const member = await db.selectFrom('socialMemberships').select('id').where('channelId', '=', channelId).where('actorId', '=', actorId).where('status', '=', 'active').executeTakeFirst(); if (!member) throw new Error(`Actor ${actorId} is not an active member of channel ${channelId}`); }
  /** Require that a reply target was visible to the speaker. */
  private async assertMessageVisible(db: SocialDb, actorId: string, message: SocialMessageRowLike): Promise<void> { const visible = await db.selectFrom('socialMemberships').select('id').where('channelId', '=', message.channelId).where('actorId', '=', actorId).where('status', 'in', ['active', 'left']).where('visibleAfterMessageId', '<', Number(message.id)).where((eb) => eb.or([eb('leftAfterMessageId', 'is', null), eb('leftAfterMessageId', '>=', Number(message.id))])).executeTakeFirst(); if (!visible) throw new Error(`Message ${message.id} is not visible to actor ${actorId}`); }
  /** Convert a channel row to a domain object. */
  private toChannel(row: SocialChannelRow): SocialChannel { return { ...row, kind: row.kind as SocialChannelKind, archived: row.archived === 1 }; }
  /** Convert a membership row to a domain object. */
  private toMembership(row: SocialMembershipRow): SocialMembership { return { ...row, status: row.status as SocialMembership['status'] }; }
  /** Convert a message row to a domain object. */
  private toMessage(row: SocialMessageRowLike): SocialMessage { return { ...row, id: Number(row.id) }; }
  /** Convert an intention row to a domain object. */
  private toIntention(row: SocialIntentionRow): SocialIntention { return { ...row, state: row.state as SocialIntention['state'] }; }
}

type SocialMessageRowLike = Omit<SocialMessageRow, 'id'> & { id: number };
