import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ActorLane } from './actor-lane.js';
import { SocialEventHub } from '../events/social-event-hub.js';
import { SocialStore } from '../store/social-store.js';
import { SocialScheduler } from './social-scheduler.js';
import type { SocialDecisionExecutor } from './social-model-executor.js';
import type { SocialActor, SocialActorDefinition, SocialChannel, SocialIntention, SocialMembership, SocialMessage, SocialSessionDefinition, VisibleMessagePage } from '../types.js';

/** Configuration for one standalone social sandbox. */
export interface SocialRuntimeConfig { sessionId?: string; humanActorId?: string; title?: string; actors: SocialActorDefinition[]; dataDirectory: string; modelExecutor?: SocialDecisionExecutor; }

/** Lifecycle owner for one durable, game-independent social session. */
export class SocialRuntime {
  public readonly events = new SocialEventHub();
  private readonly lanes = new Map<string, ActorLane>();
  private store: SocialStore | undefined;
  private session: SocialSessionDefinition | undefined;
  private scheduler: SocialScheduler | undefined;
  private modelExecutor: SocialDecisionExecutor | undefined;

  /** Create and persist a new social session. */
  public async start(config: SocialRuntimeConfig): Promise<void> {
    if (this.store) throw new Error('A social session is already running');
    const humanActorId = config.humanActorId ?? 'human';
    if (!config.actors.some((actor) => actor.id === humanActorId && actor.control === 'human')) throw new Error('The social session requires one human actor');
    if (config.actors.length < 2 || config.actors.length > 8) throw new Error('A social session requires 2 to 8 actors');
    await mkdir(config.dataDirectory, { recursive: true });
    this.session = { id: config.sessionId ?? randomUUID(), humanActorId, title: config.title };
    this.store = new SocialStore(path.join(config.dataDirectory, `${this.session.id}.sqlite`));
    await this.store.createSession(this.session, config.actors);
    for (const actor of config.actors) this.lanes.set(actor.id, new ActorLane());
    this.modelExecutor = config.modelExecutor;
    this.scheduler = this.createScheduler();
  }
  /** Reopen a persisted social session without creating duplicate channels or messages. */
  public async resume(sessionId: string, dataDirectory: string): Promise<void> { if (this.store) throw new Error('A social session is already running'); if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('Invalid social session ID'); const store = new SocialStore(path.join(dataDirectory, `${sessionId}.sqlite`)); const session = await store.getSession(sessionId); if (!session) { await store.close(); throw new Error('Persisted social session was not found'); } this.store = store; this.session = session; for (const actor of await store.listActors(sessionId)) this.lanes.set(actor.id, new ActorLane()); await store.recoverInterruptedIntentions(); this.scheduler = this.createScheduler(); this.scheduler.kick(); }
  /** List persisted sessions available for resume. */
  public async listStoredSessions(dataDirectory: string): Promise<Array<{ session: SocialSessionDefinition; actors: SocialActor[] }>> { await mkdir(dataDirectory, { recursive: true }); const files = await readdir(dataDirectory); const sessions: Array<{ session: SocialSessionDefinition; actors: SocialActor[] }> = []; for (const file of files.filter((candidate) => candidate.endsWith('.sqlite'))) { const sessionId = file.slice(0, -'.sqlite'.length); if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) continue; const store = new SocialStore(path.join(dataDirectory, file)); const session = await store.getSession(sessionId); if (session) sessions.push({ session, actors: await store.listActors(sessionId) }); await store.close(); } return sessions.sort((a, b) => (b.session.updatedAt ?? b.session.createdAt ?? '').localeCompare(a.session.updatedAt ?? a.session.createdAt ?? '')); }
  /** Update durable homepage metadata for a persisted session. */
  public async updateStoredSession(sessionId: string, dataDirectory: string, values: { title?: string; archived?: boolean }): Promise<SocialSessionDefinition> { if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('Invalid social session ID'); const store = new SocialStore(path.join(dataDirectory, `${sessionId}.sqlite`)); try { return await store.updateSession(sessionId, values); } finally { await store.close(); } }
  /** Permanently delete a stopped persisted session. */
  public async deleteStoredSession(sessionId: string, dataDirectory: string): Promise<void> { if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('Invalid social session ID'); if (this.session?.id === sessionId) throw new Error('Stop the active social session before deleting it'); await unlink(path.join(dataDirectory, `${sessionId}.sqlite`)); }

  /** Stop the session and close the durable store. */
  public async stop(): Promise<void> { this.scheduler?.stop(); await this.scheduler?.waitForIdle(); if (this.store) await this.store.close(); this.scheduler = undefined; this.store = undefined; this.session = undefined; this.lanes.clear(); }
  /** Return whether a session is active. */
  public isRunning(): boolean { return this.store !== undefined && this.session !== undefined; }
  /** Return the active session identifier. */
  public getSessionId(): string { return this.requireSession().id; }
  /** Return the human actor identifier. */
  public getHumanActorId(): string { return this.requireSession().humanActorId; }
  /** Return all session actors. */
  public async listActors(): Promise<SocialActor[]> { return this.requireStore().listActors(this.getSessionId()); }
  /** Change one model actor's future model without stopping or resetting the session. */
  public async updateActorModel(actorId: string, modelRef: string): Promise<SocialActor> { return this.requireStore().updateActorModel(this.getSessionId(), actorId, modelRef); }
  /** Return channels visible to the human, with explicit developer inspection support. */
  public async listChannels(inspect = false): Promise<SocialChannel[]> { return this.requireStore().listChannels(this.getSessionId(), this.getHumanActorId(), inspect); }
  /** Read a channel using the human actor's authorization boundary. */
  public async readMessages(channelId: string, limit?: number, beforeId?: number, inspect = false): Promise<VisibleMessagePage> { return this.requireStore().readMessages(this.getSessionId(), channelId, this.getHumanActorId(), limit, beforeId, inspect); }
  /** Report whether development inspection is explicitly enabled for this process. */
  public inspectionAvailable(): boolean { return process.env.SOCIAL_DEV_INSPECT === 'true'; }
  /** Check human visibility for viewer-aware event projection. */
  public async canHumanSeeChannel(channelId: string): Promise<boolean> { return this.requireStore().isActiveMember(channelId, this.getHumanActorId()); }
  /** Append a human message and publish the event after commit. */
  public async appendHumanMessage(channelId: string, content: string, replyToMessageId?: number): Promise<SocialMessage> { const message = await this.requireStore().appendMessage({ sessionId: this.getSessionId(), actorId: this.getHumanActorId(), channelId, content, replyToMessageId }); this.events.publish({ type: 'message-added', message }); await this.enqueueListeners(message); return message; }
  /** Create the durable scheduler for the current session. */
  private createScheduler(): SocialScheduler { return new SocialScheduler(this.requireStore(), () => this.listActors(), this.lanes, this.events, this.modelExecutor, undefined, async (message, payload) => this.enqueueListeners(message, payload)); }
  /** Enqueue listener intentions after each committed visible message. */
  private async enqueueListeners(message: SocialMessage, payload: { rootMessageId: number; depth: number; count: number } = { rootMessageId: message.id, depth: 0, count: 0 }): Promise<void> { const store = this.requireStore(); const actors = await store.listActiveModelActors(this.getSessionId(), message.channelId); for (const actor of actors.filter((candidate) => candidate.id !== message.speakerActorId)) { const intention = await store.enqueueIntention({ id: randomUUID(), actorId: actor.id, kind: 'consider-reply', channelId: message.channelId, sourceMessageId: message.id, priority: 0, state: 'queued', notBefore: new Date().toISOString(), payload: JSON.stringify(payload), dedupeKey: `social-message:${message.id}:${actor.id}` }); this.events.publish({ type: 'intention-created', intention }); } this.scheduler?.kick(); }

  /** Open a human DM with an actor. */
  public async openHumanDm(actorId: string, title?: string): Promise<SocialChannel> { const channel = await this.requireStore().openDm(this.getSessionId(), this.getHumanActorId(), actorId, title ?? `DM with ${actorId}`); this.events.publish({ type: 'channel-created', channel }); return channel; }
  /** Create a group owned by the human. */
  public async createHumanGroup(title: string, invitedActorIds?: string[]): Promise<SocialChannel> { const channel = await this.requireStore().createGroup(this.getSessionId(), this.getHumanActorId(), title, invitedActorIds); this.events.publish({ type: 'channel-created', channel }); return channel; }
  /** Invite an actor to a human-owned group. */
  public async invite(channelId: string, actorId: string): Promise<SocialMembership> { const membership = await this.requireStore().invite(channelId, actorId, this.getHumanActorId()); this.events.publish({ type: 'membership-changed', membership }); return membership; }
  /** Resolve the human's own pending invitation. */
  public async resolveHumanInvitation(channelId: string, accepted: boolean): Promise<SocialMembership> { const membership = await this.requireStore().resolveInvitation(channelId, this.getHumanActorId(), accepted); this.events.publish({ type: 'membership-changed', membership }); return membership; }
  /** Leave a human group. */
  public async leave(channelId: string): Promise<SocialMembership> { const membership = await this.requireStore().leaveGroup(channelId, this.getHumanActorId()); this.events.publish({ type: 'membership-changed', membership }); return membership; }
  /** Enqueue a durable development intention for the human actor. */
  public async enqueueIntention(input: Omit<SocialIntention, 'createdAt' | 'updatedAt' | 'attemptCount' | 'lastError'>): Promise<SocialIntention> { const intention = await this.requireStore().enqueueIntention(input); this.events.publish({ type: 'intention-created', intention }); return intention; }
  /** Run one actor-owned operation through its serial lane. */
  public runForActor<T>(actorId: string, work: () => Promise<T>): Promise<T> { const lane = this.lanes.get(actorId); if (!lane) throw new Error(`Unknown social actor ${actorId}`); return lane.run(work); }
  /** Return the active session or throw a clear lifecycle error. */
  private requireSession(): SocialSessionDefinition { if (!this.session) throw new Error('No social session is active'); return this.session; }
  /** Return the active store or throw a clear lifecycle error. */
  private requireStore(): SocialStore { if (!this.store) throw new Error('No social session is active'); return this.store; }
}
