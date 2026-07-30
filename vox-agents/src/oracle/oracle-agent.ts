/**
 * @module oracle/oracle-agent
 *
 * OracleAgent -- a VoxAgent subclass that replays a past agent turn with a (possibly modified) prompt.
 * The LLM sees the original conversation and tools but nothing executes against MCP.
 * Used for counterfactual analysis: "what would the LLM have decided with a different prompt?"
 */

import { Tool, StepResult, ModelMessage } from 'ai';
import { VoxAgent } from '../infra/vox-agent.js';
import type { VoxContext } from '../infra/vox-context.js';
import type { Model } from '../types/index.js';
import { formatModelString } from './utils/model-resolver.js';
import type { OracleConfig, OracleParameters, OracleInput, ReplayResult, ReplayDecision } from './types.js';

/**
 * Oracle agent that replays prompts through an LLM for counterfactual analysis.
 * Stop behavior adapts to the agent type being replayed.
 */
export class OracleAgent extends VoxAgent<OracleParameters, OracleInput, ReplayResult> {
  readonly name = 'oracle';
  readonly description = 'Replays past agent turns with modified prompts for counterfactual analysis.';

  /** Let the LLM decide whether to call tools. Experiments override via {@link configure}. */
  public override toolChoice = 'auto';
  public override completionTools = ['set-strategy', 'set-flavors', 'keep-status-quo'];
  public override maxSteps = 5;

  /**
   * Apply per-experiment overrides from {@link OracleConfig}, once per replay run before any task
   * starts. VoxContext reads `toolChoice` and `completionTools` as plain fields off the registered
   * agent, and one replay process runs one experiment, so a run-scoped assignment is the whole
   * configuration surface. Omitted fields keep the defaults declared above.
   */
  public configure(overrides: Pick<OracleConfig, 'toolChoice' | 'completionTools'>): void {
    if (overrides.toolChoice !== undefined) this.toolChoice = overrides.toolChoice;
    if (overrides.completionTools !== undefined) this.completionTools = overrides.completionTools;
  }

  /** Return the pre-resolved model from parameters */
  public override getModel(parameters: OracleParameters, _input: OracleInput, _overrides: Record<string, Model | string>): Model {
    return parameters.resolvedModel;
  }

  /** Return the (possibly modified) system prompt from the input, joining array parts */
  public async getSystem(parameters: OracleParameters, input: OracleInput, _context: VoxContext<OracleParameters>): Promise<string> {
    return input.system.join('\n');
  }

  /** Return the non-system messages from the original conversation (possibly modified) */
  public override async getInitialMessages(
    _parameters: OracleParameters,
    input: OracleInput,
    _context: VoxContext<OracleParameters>
  ): Promise<ModelMessage[]> {
    return input.messages;
  }

  /** Return the active tool set from the original span */
  public override getActiveTools(parameters: OracleParameters): string[] | undefined {
    return parameters.activeTools.length > 0 ? parameters.activeTools : undefined;
  }

  /**
   * Stop check that adapts to the agent type being replayed.
   * - Strategist: stop when a decision tool call is found (multi-step, up to 5 steps)
   * - Other: stop after one step
   */
  public override stopCheck(
    parameters: OracleParameters,
    _input: OracleInput,
    lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    _context: VoxContext<OracleParameters>
  ): boolean {
    parameters.capturedSteps.push(lastStep);
    return super.stopCheck(parameters, _input, lastStep, allSteps, _context);
  }

  /** Build the ReplayResult from captured steps */
  public override async getOutput(
    parameters: OracleParameters,
    input: OracleInput,
    _finalText: string,
    _context: VoxContext<OracleParameters>
  ): Promise<ReplayResult | undefined> {
    // Collect all tool calls as ReplayDecisions
    const decisions: ReplayDecision[] = [];
    for (const step of parameters.capturedSteps) {
      for (const tc of step.toolCalls) {
        const decision: ReplayDecision = {
          toolName: tc.toolName,
          args: { ...(tc as any).input },
        };

        // Extract Rationale from strategist decision tool args
        if (this.completionTools!.includes(tc.toolName) && decision.args.Rationale) {
          decision.rationale = decision.args.Rationale as string;
          delete decision.args.Rationale;
        }

        decisions.push(decision);
      }
    }

    // Collect raw response messages from all steps
    const messages: ModelMessage[] = [];
    for (const step of parameters.capturedSteps) {
      messages.push(...step.response.messages);
    }

    return {
      row: input.row,
      // Carries the reasoning effort the replay actually ran with, matching the shape of the
      // recorded `originalModel` so the two are directly comparable in the trail and CSV.
      model: formatModelString(parameters.resolvedModel),
      decisions,
      // Placeholder — replayRow() overrides with VoxContext's nuanced token counts
      tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
      messages,
      metadata: input.metadata,
    };
  }
}
