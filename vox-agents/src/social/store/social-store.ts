import Database from 'better-sqlite3';
import { Kysely, sql, type Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import { openSqliteKysely, type OpenedSqlite } from '../../utils/telemetry/sqlite-helpers.js';
import type { SocialActor, SocialActorDefinition, SocialChannel, SocialChannelKind, SocialIntention, SocialMembership, SocialMessage, SocialMemory, SocialSessionDefinition, VisibleMessagePage } from '../types.js';
import type { SocialDatabase, SocialActorRow, SocialChannelRow, SocialIntentionRow, SocialMembershipRow, SocialMessageRow } from './schema.js';
import { migrateSocialSchema } from './migrations.js';

type SocialDb = Kysely<SocialDatabase> | Transaction<SocialDatabase>;

/** Durable SQLite store for one game-independent social session. */
export class SocialStore {
  private readonly opened: OpenedSqlite<SocialDatabase>;
  /** Open a database and create the schema if necessary. */
  public constructor(dbPath: string) { this.opened = openSqliteKysely<SocialDatabase>(dbPath); migrateSocialSchema(this.opened.sqlite); }
  /** Close the database. */
  public async close(): Promise<void> { await this.opened.db.destroy(); }
  /** Create a session, its actors, WORLD, and WORLD memberships atomically. */
  public async createSession(session: SocialSessionDefinition, actors: SocialActorDefinition[]): Promise<void> {
    const now = session.createdAt ?? new Date().toISOString();
    await this.opened.db.transaction().execute(async (trx) => {
      await trx.insertInto('socialSessions').values({ id: session.id, humanActorId: session.humanActorId, title: session.title ?? 'Untitled sandbox', archived: session.archived ? 1 : 0, createdAt: now, updatedAt: session.updatedAt ?? now }).execute();
      for (const actor of actors) await trx.insertInto('socialActors').values({ id: actor.id, sessionId: session.id, ordinal: actor.ordinal, control: actor.control, displayName: actor.displayName, modelRef: actor.modelRef ?? null, profile: actor.profile ?? null, createdAt: now, status: 'active' }).execute();
      await trx.insertInto('socialChannels').values({ id: 'world', sessionId: session.id, kind: 'world', title: 'WORLD', createdByActorId: session.humanActorId, canonicalKey: 'world', createdAt: now, archived: 0 }).execute();
      for (const actor of actors) await this.insertMembership(trx, 'world', actor.id, 'active', null, 0, now);
    });
  }
  /** Return all actors in a session. */
  public async listActors(sessionId: string): Promise<SocialActor[]> { const rows = await this.opened.db.selectFrom('socialActors').selectAll().where('sessionId', '=', sessionId).orderBy('ordinal', 'asc').execute(); return rows.map((row) => ({ ...row, control: row.control as SocialActor['control'], status: row.status as SocialActor['status'], modelRef: row.modelRef ?? undefined, profile: row.profile ?? undefined })); }
  /** Return the persisted session definition. */
  public async getSession(sessionId: string): Promise<SocialSessionDefinition | undefined> { const row = await this.opened.db.selectFrom('socialSessions').selectAll().where('id', '=', sessionId).executeTakeFirst(); return row ? { id: row.id, humanActorId: row.humanActorId, title: row.title, archived: row.archived === 1, createdAt: row.createdAt, updatedAt: row.updatedAt } : undefined; }
  /** Update durable homepage metadata for a session. */
  public async updateSession(sessionId: string, values: { title?: string; archived?: boolean }): Promise<SocialSessionDefinition> { const row = await this.opened.db.updateTable('socialSessions').set({ ...(values.title !== undefined ? { title: values.title } : {}), ...(values.archived !== undefined ? { archived: values.archived ? 1 : 0 } : {}), updatedAt: new Date().toISOString() }).where('id', '=', sessionId).returningAll().executeTakeFirstOrThrow(); return { id: row.id, humanActorId: row.humanActorId, title: row.title, archived: row.archived === 1, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
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
  public async enqueueIntention(input: Omit<SocialIntention, 'createdAt' | 'updatedAt' | 'attemptCount' | 'lastError' | 'claimedAt' | 'result'>): Promise<SocialIntention> { const now = new Date().toISOString(); const row = await this.opened.db.insertInto('socialIntentions').values({ ...input, payload: input.payload, attemptCount: 0, claimedAt: null, result: null, lastError: null, createdAt: now, updatedAt: now }).onConflict((oc) => oc.column('dedupeKey').doNothing()).returningAll().executeTakeFirst(); return this.toIntention(row ?? await this.opened.db.selectFrom('socialIntentions').selectAll().where('dedupeKey', '=', input.dedupeKey).executeTakeFirstOrThrow()); }
  /** Atomically claim the highest-priority eligible intention. */
  public async claimNextIntention(now = new Date().toISOString()): Promise<SocialIntention | undefined> { const row = await this.opened.db.transaction().execute(async (trx) => { const candidate = await trx.selectFrom('socialIntentions').selectAll().where('state', 'in', ['queued', 'deferred']).where('notBefore', '<=', now).orderBy('priority', 'desc').orderBy('createdAt', 'asc').executeTakeFirst(); if (!candidate) return undefined; return trx.updateTable('socialIntentions').set({ state: 'running', claimedAt: now, attemptCount: candidate.attemptCount + 1, updatedAt: now }).where('id', '=', candidate.id).where('state', 'in', ['queued', 'deferred']).returningAll().executeTakeFirst(); }); return row ? this.toIntention(row) : undefined; }
  /** Mark a claimed intention as completed with a pass/speak result. */
  public async completeIntention(id: string, result: string): Promise<SocialIntention> { return this.toIntention(await this.opened.db.updateTable('socialIntentions').set({ state: 'completed', result, updatedAt: new Date().toISOString() }).where('id', '=', id).where('state', '=', 'running').returningAll().executeTakeFirstOrThrow()); }
  /** Defer a transient intention without holding a runtime lane during backoff. */
  public async deferIntention(id: string, notBefore: string, error: string): Promise<SocialIntention> { return this.toIntention(await this.opened.db.updateTable('socialIntentions').set({ state: 'deferred', notBefore, lastError: error.slice(0, 500), updatedAt: new Date().toISOString() }).where('id', '=', id).where('state', '=', 'running').returningAll().executeTakeFirstOrThrow()); }
  /** Cancel a terminally failed intention. */
  public async cancelIntention(id: string, error: string): Promise<SocialIntention> { return this.toIntention(await this.opened.db.updateTable('socialIntentions').set({ state: 'cancelled', result: 'terminal-error', lastError: error.slice(0, 500), updatedAt: new Date().toISOString() }).where('id', '=', id).where('state', '=', 'running').returningAll().executeTakeFirstOrThrow()); }
  /** Recover intentions left running by a process interruption. */
  public async recoverInterruptedIntentions(staleBefore = new Date().toISOString()): Promise<number> { const result = await this.opened.db.updateTable('socialIntentions').set({ state: 'deferred', notBefore: new Date().toISOString(), lastError: 'recovered after runtime interruption', updatedAt: new Date().toISOString() }).where('state', '=', 'running').where('claimedAt', '<', staleBefore).executeTakeFirst(); return Number(result.numUpdatedRows); }
  /** Return active model actors who can see a channel. */
  public async listActiveModelActors(sessionId: string, channelId: string): Promise<SocialActor[]> { const rows = await this.opened.db.selectFrom('socialActors as a').innerJoin('socialMemberships as m', 'm.actorId', 'a.id').selectAll('a').where('a.sessionId', '=', sessionId).where('a.control', '=', 'model').where('a.status', '=', 'active').where('m.channelId', '=', channelId).where('m.status', '=', 'active').orderBy('a.ordinal', 'asc').execute(); return rows.map((row) => ({ ...row, control: row.control as SocialActor['control'], status: row.status as SocialActor['status'], modelRef: row.modelRef ?? undefined, profile: row.profile ?? undefined })); }
  /** Return all active actors who can see a channel. */
  public async listActiveActors(sessionId: string, channelId: string): Promise<SocialActor[]> { const rows = await this.opened.db.selectFrom('socialActors as a').innerJoin('socialMemberships as m', 'm.actorId', 'a.id').selectAll('a').where('a.sessionId', '=', sessionId).where('a.status', '=', 'active').where('m.channelId', '=', channelId).where('m.status', '=', 'active').orderBy('a.ordinal', 'asc').execute(); return rows.map((row) => ({ ...row, control: row.control as SocialActor['control'], status: row.status as SocialActor['status'], modelRef: row.modelRef ?? undefined, profile: row.profile ?? undefined })); }
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
  private toIntention(row: SocialIntentionRow): SocialIntention { return { ...row, state: row.state as SocialIntention['state'], claimedAt: row.claimedAt ?? undefined, result: row.result ?? undefined }; }
}

type SocialMessageRowLike = Omit<SocialMessageRow, 'id'> & { id: number };
