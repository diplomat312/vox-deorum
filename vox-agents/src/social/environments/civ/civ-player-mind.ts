import type { SocialActor, SocialDecision, SocialIntention, SocialMessage } from '../../types.js';
import type { SocialActivity } from '../../context/social-context-builder.js';
import type { ActorLane } from '../../runtime/actor-lane.js';
import type { SocialContextBuilder } from '../../context/social-context-builder.js';
import type { SocialDecisionExecutor } from '../../runtime/social-model-executor.js';
import type { CivContextProvider } from './civ-context-provider.js';

/** Shared player-mind facade for social, strategic, and environment-triggered reasoning. */
export class CivPlayerMind {
  public constructor(private readonly lane: ActorLane, private readonly contextBuilder: SocialContextBuilder, private readonly executor: SocialDecisionExecutor, private readonly civContext: CivContextProvider) {}
  /** Run a trigger-specific reasoning mode under the actor's one authoritative lane. */
  public async reason(actor: SocialActor, mode: string, input: { messages: SocialMessage[]; actors: SocialActor[]; intention: SocialIntention; memory?: string; activity?: SocialActivity[] }): Promise<SocialDecision> { return this.lane.run(async () => { const environment = await this.civContext.forActor(actor); const context = input.intention.channelId ? this.contextBuilder.build(actor, input.actors, input.messages, input.intention, input.memory, { environment, mode }) : this.contextBuilder.buildPlayerMind(actor, input.actors, input.activity ?? [], input.intention, input.memory, { environment, mode }); return this.executor.decide(actor, context, input.actors.map((candidate) => candidate.displayName)); }); }
}
