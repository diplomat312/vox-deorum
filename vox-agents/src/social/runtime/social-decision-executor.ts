import { SocialStore } from '../store/social-store.js';
import { SocialEventHub } from '../events/social-event-hub.js';
import type { SocialActor, SocialDecision, SocialIntention } from '../types.js';
import type { CivActionGateway } from '../environments/civ/civ-action-gateway.js';
import type { CivEnvironmentAdapter } from '../environments/civ/civ-environment-adapter.js';

/** Optional environment hooks used by the generic executor without importing Civ into social logic. */
export interface SocialEnvironmentActionPort { gateway: CivActionGateway; adapter: CivEnvironmentAdapter; }

/** Result of applying one validated decision under runtime authority. */
export interface SocialDecisionApplication { result: string; }

/** Applies one model proposal after generation has completed and validation has succeeded. */
export class SocialDecisionExecutor {
  public constructor(private readonly store: SocialStore, private readonly events: SocialEventHub, private readonly environmentForActor: (actor: SocialActor) => Promise<SocialEnvironmentActionPort | undefined> = async () => undefined) {}

  /** Apply exactly one decision and preserve durable social/action boundaries. */
  public async apply(actor: SocialActor, intention: SocialIntention, decision: SocialDecision): Promise<SocialDecisionApplication> { try { return await this.applyInternal(actor, intention, decision); } catch (error) { if (this.isExpectedRefusal(error)) { const message = error instanceof Error ? error.message : String(error); await this.store.completeIntention(intention.id, `refused:${message.slice(0, 300)}`); return { result: 'refused' }; } throw error; } }
  /** Apply the decision-specific durable mutation. */
  private async applyInternal(actor: SocialActor, intention: SocialIntention, decision: SocialDecision): Promise<SocialDecisionApplication> {
    if (decision.kind === 'pass') { const completed = await this.store.completeIntention(intention.id, `pass${decision.reasonCode ? `:${decision.reasonCode}` : ''}`); this.events.publish({ type: 'intention-created', intention: completed }); return { result: completed.result ?? 'pass' }; }
    if (decision.kind === 'send_message') { const channelId = decision.channelId ?? intention.channelId; if (!channelId) throw new Error('decision-refused: send_message requires a destination channel'); const mutation = await this.store.commitModelSpeech({ intentionId: intention.id, actorId: actor.id, channelId, content: decision.content, replyToMessageId: decision.replyToMessageId, result: 'send_message' }); this.publishMutation(mutation); return { result: mutation.outcome }; }
    if (decision.kind === 'send_dm') { const mutation = await this.store.commitModelDm({ intentionId: intention.id, sessionId: actor.sessionId, actorId: actor.id, targetActorId: decision.targetActorId, content: decision.content }); this.events.publish({ type: 'channel-created', channel: mutation.channel }); this.events.publish({ type: 'message-added', message: mutation.message }); this.publishIntentions(mutation.createdIntentions); return { result: 'send_dm' }; }
    if (decision.kind === 'create_group') { const mutation = await this.store.commitModelGroup({ intentionId: intention.id, sessionId: actor.sessionId, actorId: actor.id, title: decision.title, invitedActorIds: decision.invitedActorIds, initialMessage: decision.initialMessage }); this.events.publish({ type: 'channel-created', channel: mutation.channel }); if (mutation.message) this.events.publish({ type: 'message-added', message: mutation.message }); for (const membership of mutation.memberships) this.events.publish({ type: 'membership-changed', membership }); this.publishIntentions(mutation.createdIntentions); return { result: 'create_group' }; }
    if (decision.kind === 'invite_actor') { const mutation = await this.store.commitModelInvite({ intentionId: intention.id, sessionId: actor.sessionId, channelId: decision.channelId, actorId: actor.id, targetActorId: decision.actorId }); this.events.publish({ type: 'membership-changed', membership: mutation.membership }); this.publishIntentions(mutation.createdIntentions); return { result: 'invite_actor' }; }
    if (decision.kind === 'resolve_invitation') { const mutation = await this.store.commitInvitationDecision({ intentionId: intention.id, channelId: decision.channelId, actorId: actor.id, accepted: decision.accepted }); this.events.publish({ type: 'membership-changed', membership: mutation.membership }); this.publishIntentions(mutation.createdIntentions); return { result: decision.accepted ? 'invitation_accepted' : 'invitation_declined' }; }
    if (decision.kind === 'leave_group') { const membership = await this.store.commitModelLeave({ intentionId: intention.id, channelId: decision.channelId, actorId: actor.id }); this.events.publish({ type: 'membership-changed', membership }); return { result: 'leave_group' }; }
    if (decision.kind === 'update_memory') { await this.store.commitMemoryDecision({ intentionId: intention.id, actorId: actor.id, expectedRevision: decision.expectedRevision, content: decision.content }); return { result: 'update_memory' }; }
    const port = await this.environmentForActor(actor); if (!port) throw new Error('decision-refused: no environment action gateway is attached'); const turn = this.eventTurn(intention); const attempt = await port.gateway.invoke(port.adapter.binding(actor.id), turn, decision.actionName, decision.arguments, `social-intention:${intention.id}`); const completed = await this.store.completeIntention(intention.id, `environment_action:${attempt.state}`); this.events.publish({ type: 'intention-created', intention: completed }); return { result: `environment_action:${attempt.state}` };
  }

  /** Distinguish deterministic authorization or legality refusals from infrastructure failures. */
  private isExpectedRefusal(error: unknown): boolean { const message = error instanceof Error ? error.message : String(error); return /not an active member|already a member|already invitee|requires two different|only group channels|only group channel|not visible|revision conflict|unknown Civ action|not model-facing|no environment action gateway/i.test(message); }

  /** Publish all events generated by an atomic message mutation. */
  private publishMutation(mutation: { message?: import('../types.js').SocialMessage; createdIntentions: SocialIntention[] }): void { if (mutation.message) this.events.publish({ type: 'message-added', message: mutation.message }); this.publishIntentions(mutation.createdIntentions); }
  /** Publish newly persisted downstream intentions. */
  private publishIntentions(intentions: SocialIntention[]): void { for (const intention of intentions) this.events.publish({ type: 'intention-created', intention }); }
  /** Extract an authoritative source turn from the bounded trigger payload. */
  private eventTurn(intention: SocialIntention): number { if (!intention.payload) return 0; try { const payload = JSON.parse(intention.payload) as { turn?: unknown }; return typeof payload.turn === 'number' ? payload.turn : 0; } catch { return 0; } }
}
