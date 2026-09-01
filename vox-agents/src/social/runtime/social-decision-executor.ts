import { SocialStore } from '../store/social-store.js';
import { SocialEventHub } from '../events/social-event-hub.js';
import type { SocialActor, SocialDecision, SocialIntention } from '../types.js';
import type { SocialReferenceSet } from '../context/social-context-builder.js';
import type { SocialEnvironmentPort } from './social-environment-port.js';

/** Optional environment hooks used by the generic executor without importing Civ into social logic. */
export type SocialEnvironmentActionPort = SocialEnvironmentPort;
export interface SocialDecisionApplication { result: string; }

/** Apply one semantic model proposal after generation has completed and validation has succeeded. */
export class SocialDecisionExecutor {
  public constructor(private readonly store: SocialStore, private readonly events: SocialEventHub, private readonly environmentForActor: (actor: SocialActor) => Promise<SocialEnvironmentActionPort | undefined> = async () => undefined) {}

  /** Apply one decision under runtime authority and turn deterministic refusals into durable outcomes. */
  public async apply(actor: SocialActor, intention: SocialIntention, decision: SocialDecision, references?: SocialReferenceSet): Promise<SocialDecisionApplication> { try { return await this.applyInternal(actor, intention, decision, references); } catch (error) { if (this.isExpectedRefusal(error)) { const message = error instanceof Error ? error.message : String(error); await this.store.completeIntention(intention.id, `refused:${message.slice(0, 300)}`); return { result: 'refused' }; } throw error; } }

  /** Apply the decision-specific durable mutation. */
  private async applyInternal(actor: SocialActor, intention: SocialIntention, decision: SocialDecision, references?: SocialReferenceSet): Promise<SocialDecisionApplication> {
    if (decision.kind === 'pass') { await this.store.completeIntention(intention.id, `pass${decision.reasonCode ? `:${decision.reasonCode}` : ''}`); return { result: 'pass' }; }
    if (decision.kind === 'reply') { if (!intention.channelId) throw new Error('decision-refused: reply requires a bound channel'); return this.commitSpeech(actor, intention, intention.channelId, decision.content, decision.replyToMessageId); }
    if (decision.kind === 'send_message') { const channelId = this.resolveChannel(references, decision.roomRef); return this.commitSpeech(actor, intention, channelId, decision.content, decision.replyToMessageId); }
    if (decision.kind === 'send_dm') { const targetActorId = this.resolveActor(references, decision.participantRef); const mutation = await this.store.commitModelDm({ intentionId: intention.id, sessionId: actor.sessionId, actorId: actor.id, targetActorId, content: decision.content }); this.events.publish({ type: 'channel-created', channel: mutation.channel }); this.events.publish({ type: 'message-added', message: mutation.message }); this.publishIntentions(mutation.createdIntentions); return { result: 'send_dm' }; }
    if (decision.kind === 'start_group') { const invitedActorIds = decision.participantRefs.map((reference) => this.resolveActor(references, reference)); const mutation = await this.store.commitModelGroup({ intentionId: intention.id, sessionId: actor.sessionId, actorId: actor.id, title: decision.title, invitedActorIds, initialMessage: decision.initialMessage }); this.events.publish({ type: 'channel-created', channel: mutation.channel }); if (mutation.message) this.events.publish({ type: 'message-added', message: mutation.message }); for (const membership of mutation.memberships) this.events.publish({ type: 'membership-changed', membership }); this.publishIntentions(mutation.createdIntentions); return { result: 'start_group' }; }
    if (decision.kind === 'invite_actor') { const channelId = this.resolveChannel(references, decision.roomRef); const targetActorId = this.resolveActor(references, decision.participantRef); const mutation = await this.store.commitModelInvite({ intentionId: intention.id, sessionId: actor.sessionId, channelId, actorId: actor.id, targetActorId }); this.events.publish({ type: 'membership-changed', membership: mutation.membership }); this.publishIntentions(mutation.createdIntentions); return { result: 'invite_actor' }; }
    if (decision.kind === 'respond_invitation') { if (intention.kind !== 'invitation-decision' || !intention.channelId) throw new Error('decision-refused: no invitation is bound to this decision'); const mutation = await this.store.commitInvitationDecision({ intentionId: intention.id, channelId: intention.channelId, actorId: actor.id, accepted: decision.accepted }); this.events.publish({ type: 'membership-changed', membership: mutation.membership }); this.publishIntentions(mutation.createdIntentions); return { result: decision.accepted ? 'invitation_accepted' : 'invitation_declined' }; }
    if (decision.kind === 'leave_group') { const channelId = this.resolveChannel(references, decision.roomRef); const membership = await this.store.commitModelLeave({ intentionId: intention.id, channelId, actorId: actor.id }); this.events.publish({ type: 'membership-changed', membership }); return { result: 'leave_group' }; }
    const port = await this.environmentForActor(actor); if (!port) throw new Error('decision-refused: no environment action gateway is attached'); const attempt = await port.execute(actor, this.eventTurn(intention), decision.actionName, decision.arguments, `social-intention:${intention.id}`); await this.store.completeIntention(intention.id, `environment_action:${attempt.state}`); return { result: `environment_action:${attempt.state}` };
  }

  /** Commit speech to the channel selected by runtime authority. */
  private async commitSpeech(actor: SocialActor, intention: SocialIntention, channelId: string, content: string, replyToMessageId?: number): Promise<SocialDecisionApplication> { const mutation = await this.store.commitModelSpeech({ intentionId: intention.id, actorId: actor.id, channelId, content, replyToMessageId, result: 'send_message' }); this.publishMutation(mutation); return { result: mutation.outcome }; }
  /** Resolve a context-local actor reference without trusting a model-supplied database ID. */
  private resolveActor(references: SocialReferenceSet | undefined, reference: string): string { const resolved = references?.actors.find((candidate) => candidate.ref === reference); if (!resolved) throw new Error(`decision-refused: unknown participant reference ${reference}`); return resolved.id; }
  /** Resolve a context-local room reference without trusting a model-supplied database ID. */
  private resolveChannel(references: SocialReferenceSet | undefined, reference: string): string { const resolved = references?.channels.find((candidate) => candidate.ref === reference); if (!resolved) throw new Error(`decision-refused: unknown room reference ${reference}`); return resolved.id; }
  /** Distinguish deterministic authorization or legality refusals from infrastructure failures. */
  private isExpectedRefusal(error: unknown): boolean { const message = error instanceof Error ? error.message : String(error); return /decision-refused|not an active member|already a member|already invitee|requires two different|only group channels|only group channel|not visible|revision conflict|unknown Civ action|not model-facing|no environment action gateway/i.test(message); }
  /** Publish all events generated by an atomic message mutation. */
  private publishMutation(mutation: { message?: import('../types.js').SocialMessage; createdIntentions: SocialIntention[] }): void { if (mutation.message) this.events.publish({ type: 'message-added', message: mutation.message }); this.publishIntentions(mutation.createdIntentions); }
  /** Publish newly persisted downstream intentions. */
  private publishIntentions(intentions: SocialIntention[]): void { for (const intention of intentions) this.events.publish({ type: 'intention-created', intention }); }
  /** Extract an authoritative source turn from the bounded trigger payload. */
  private eventTurn(intention: SocialIntention): number { if (!intention.payload) return 0; try { const payload = JSON.parse(intention.payload) as { turn?: unknown }; return typeof payload.turn === 'number' ? payload.turn : 0; } catch { return 0; } }
}

/** Return only non-secret decision fields suitable for durable diagnostics. */
export function decisionRoutingSummary(decision: SocialDecision): Record<string, unknown> {
  if (decision.kind === 'pass') return {};
  if (decision.kind === 'reply') return { replyToMessageId: decision.replyToMessageId };
  if (decision.kind === 'send_message') return { roomRef: decision.roomRef, replyToMessageId: decision.replyToMessageId };
  if (decision.kind === 'send_dm') return { participantRef: decision.participantRef };
  if (decision.kind === 'start_group') return { participantRefs: decision.participantRefs };
  if (decision.kind === 'invite_actor') return { roomRef: decision.roomRef, participantRef: decision.participantRef };
  if (decision.kind === 'respond_invitation') return { accepted: decision.accepted };
  if (decision.kind === 'leave_group') return { roomRef: decision.roomRef };
  return { actionName: decision.actionName, argumentKeys: Object.keys(decision.arguments).slice(0, 30) };
}
