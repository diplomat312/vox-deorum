/**
 * Live communication wake adapter for a unified civilization mind.
 *
 * This adapter deliberately performs no durable work. It records the model's validated tool
 * proposal in the wake input, then the live social runner applies it through SocialDecisionExecutor.
 */

import type { ModelMessage, StepResult, Tool, ToolSet } from 'ai';
import { VoxAgent } from '../../infra/vox-agent.js';
import type { VoxContext } from '../../infra/vox-context.js';
import type { Model } from '../../types/config.js';
import type { StrategistParameters } from '../strategy-parameters.js';
import { getUnifiedMindModel } from '../unified-civilization-mind.js';
import { decodeSocialDecision, type DecisionToolDefinition } from '../../social/runtime/social-decision-tools.js';
import type { SocialContextBundle } from '../../social/context/social-context-builder.js';
import type { SocialDecision } from '../../social/types.js';

/** One captured tool call that remains local to a single live cognition wake. */
export interface CapturedSocialToolCall { toolName: string; input: unknown; }

/** Input passed from the live runner without exposing runtime bookkeeping to the model. */
export interface UnifiedSocialCognitionInput {
  socialContext: SocialContextBundle;
  decisionDefinitions: DecisionToolDefinition[];
  decisionTools: ToolSet;
  toolNames: string[];
  decisionCalls: CapturedSocialToolCall[];
  outwardToolNames: string[];
}

/** Registered VoxAgent adapter that runs live social cognition inside the seat VoxContext. */
export class UnifiedSocialCognition extends VoxAgent<StrategistParameters, UnifiedSocialCognitionInput, SocialDecision> {
  /** Internal registry name for the live communication wake. */
  override readonly name = 'unified-mind-social';

  /** Keep the adapter out of player-facing agent selection. */
  override readonly description = 'Unified civilization mind communication wake';

  /** This adapter is only selected by live Civ integration. */
  override offeredInSetup = false;

  /** Keep the internal adapter name out of player-facing setup controls. */
  override displayName = 'Unified Civilization Mind Communication (internal)';

  /** Bound live communication wakes to a small number of model steps. */
  override maxSteps = 3;

  /** Resolve the model through the seat's existing unified-mind override. */
  override getModel(
    _parameters: StrategistParameters,
    _input: UnifiedSocialCognitionInput,
    overrides: Record<string, Model | string>,
  ): Model {
    return getUnifiedMindModel(overrides);
  }

  /** Use the canonical civilization identity prepared by the live runner. */
  override async getSystem(
    _parameters: StrategistParameters,
    input: UnifiedSocialCognitionInput,
    _context: VoxContext<StrategistParameters>,
  ): Promise<string> {
    return input.socialContext.system;
  }

  /** Let the live runner choose the exact legal action set for this wake. */
  override getActiveTools(_parameters: StrategistParameters): string[] {
    return [];
  }

  /** Install the wake-specific legal tools without adding side effects to their execution. */
  override async prepareStep(
    parameters: StrategistParameters,
    input: UnifiedSocialCognitionInput,
    lastStep: StepResult<Record<string, Tool>> | null,
    allSteps: StepResult<Record<string, Tool>>[],
    messages: ModelMessage[],
    context: VoxContext<StrategistParameters>,
  ) {
    const config = await super.prepareStep(parameters, input, lastStep, allSteps, messages, context);
    config.activeTools = input.toolNames;
    if (lastStep === null) config.messages = [...input.socialContext.messages];
    return config;
  }

  /** Stop once one legal proposal has executed, otherwise let the bounded loop finish. */
  override stopCheck(
    _parameters: StrategistParameters,
    input: UnifiedSocialCognitionInput,
    _lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
  ): boolean {
    const completed = allSteps.some((step) => step.toolResults.some((result) => {
      if (!input.outwardToolNames.includes(result.toolName)) return false;
      const output = result.output;
      return output !== undefined && !(output !== null && typeof output === 'object' && 'isError' in output && output.isError === true);
    }));
    return completed || allSteps.length >= this.maxSteps;
  }

  /** Decode the captured proposal after the model loop, still before any durable application. */
  override async getOutput(
    _parameters: StrategistParameters,
    input: UnifiedSocialCognitionInput,
    _finalText: string,
    _context: VoxContext<StrategistParameters>,
  ): Promise<SocialDecision> {
    return decodeSocialDecision(input.decisionCalls, input.decisionDefinitions);
  }
}
