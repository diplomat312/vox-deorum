import type { SocialActor, SocialIntention } from '../types.js';
import type { DecisionToolDefinition } from './social-decision-tools.js';

/** Result returned by an environment after the runtime submits one actor-bound action. */
export interface SocialEnvironmentActionResult { state: string; }

/** Minimal environment boundary used by the generic social runtime. */
export interface SocialEnvironmentPort {
  /** Provide bounded environment context for one actor. */
  contextForActor(actor: SocialActor): Promise<string | undefined>;
  /** Provide only the semantic environment actions legal for this intention. */
  decisionDefinitionsForActor(actor: SocialActor, intention: SocialIntention): Promise<DecisionToolDefinition[]>;
  /** Execute one action with the environment-owned actor binding and stable operation ID. */
  execute(actor: SocialActor, sourceTurn: number, actionName: string, argumentsValue: Record<string, unknown>, operationId: string): Promise<SocialEnvironmentActionResult>;
  /** Release environment subscriptions when the social session stops. */
  close?(): Promise<void> | void;
}
