import type { SocialActor, SocialIntention, SocialMessage } from '../types.js';
import type { DecisionToolDefinition } from './social-decision-tools.js';
import type { SocialReferenceSet } from '../context/social-context-builder.js';

/** Result returned by an environment after the runtime submits one actor-bound action. */
export interface SocialEnvironmentActionResult { state: string; }

/** Factual communication committed by the generic runtime for an environment to journal. */
export interface SocialCommittedFact { kind: string; actorId: string; channelId?: string; channelTitle?: string; message?: SocialMessage; content?: string; turn?: number; eventId?: string; recipientActorIds?: string[]; entitledActorIds: string[]; }

/** Minimal environment boundary used by the generic social runtime. */
export interface SocialEnvironmentPort {
  /** Keep compatibility memory available to sandbox environments only. */
  useSocialMemory?: boolean;
  /** Admit a complete live cognition wake, including its authoritative application, to the seat lane. */
  runOnCognitionLane?<TResult>(actor: SocialActor, work: () => Promise<TResult>): Promise<TResult>;
  /** Provide bounded environment context for one actor. */
  contextForActor(actor: SocialActor): Promise<string | undefined>;
  /** Provide only the semantic environment actions legal for this intention. */
  decisionDefinitionsForActor(actor: SocialActor, intention: SocialIntention): Promise<DecisionToolDefinition[]>;
  /** Restrict model-facing references to entities the environment says are currently visible. */
  filterReferencesForActor?(actor: SocialActor, references: SocialReferenceSet): Promise<SocialReferenceSet>;
  /** Restrict downstream communication recipients to the environment's visibility boundary. */
  filterRecipientActorIds?(actor: SocialActor, channelId: string, recipientActorIds: string[]): Promise<string[]>;
  /** Check a direct social target against the environment's authoritative contact graph. */
  isActorReachable?(actor: SocialActor, targetActorId: string): Promise<boolean>;
  /** Execute a non-mutating support read and return a model-readable result. */
  read?(actor: SocialActor, sourceTurn: number, actionName: string, argumentsValue: Record<string, unknown>, operationId: string): Promise<string>;
  /** Execute one action with the environment-owned actor binding and stable operation ID. */
  execute(actor: SocialActor, sourceTurn: number, actionName: string, argumentsValue: Record<string, unknown>, operationId: string): Promise<SocialEnvironmentActionResult>;
  /** Journal a factual communication in the environment's authoritative longitudinal memory. */
  recordCommittedFact?(fact: SocialCommittedFact): Promise<void> | void;
  /** Release environment subscriptions when the social session stops. */
  close?(): Promise<void> | void;
}
