/**
 * Diplomacy wake adapter for the unified civilization mind.
 *
 * The existing LiveEnvoy and Diplomat plumbing supplies transcript, deal,
 * streaming, and completion behavior. This adapter changes only the policy
 * identity and model lookup so the same seat-level mind handles both wakes.
 */

import { Diplomat } from "./diplomat.js";
import { ModelMessage, StepResult, Tool } from "ai";
import type { Model } from "../../types/config.js";
import { buildGameContextMessages, type StrategistParameters } from "../../strategist/strategy-parameters.js";
import type { EnvoyThread } from "../../types/index.js";
import type { VoxContext } from "../../infra/vox-context.js";
import { buildUnifiedMindCanonicalIdentity, buildUnifiedMindIdentity, getUnifiedMindModel } from "../../strategist/unified-civilization-mind.js";
import { worldContext, communicationStyle, audienceSection } from "../context/envoy-prompts.js";
import { createPassDiplomacyTool } from "../tools/pass-diplomacy-tool.js";
import { terminalActionTools } from "../../utils/diplomacy/transcript/transcript-utils.js";
import { getPoliticalMemoryContext, memoryToolNames } from "../../political-memory/political-memory-context.js";
import { createPoliticalMemoryTools } from "../../political-memory/political-memory-tools.js";
import type { LiveEnvoyContext } from "../live-envoy.js";

/** Social adapter that invokes the shared civilization-level policy. */
export class UnifiedDiplomat extends Diplomat {
  /** Internal registry name for the unified diplomacy wake. */
  override readonly name = "unified-mind-diplomat";

  /** Player-facing description of the common civilization policy. */
  override readonly description = "Unified civilization mind diplomacy wake";

  /** Unified diplomacy has an explicit no-op alongside the existing terminal actions. */
  override completionTools = ["send-message", "pass-diplomacy", ...terminalActionTools];

  /** Keep the unified model selection independent of the legacy diplomat key. */
  override getModel(
    _parameters: StrategistParameters,
    _input: EnvoyThread,
    overrides: Record<string, Model | string>,
  ): Model {
    return getUnifiedMindModel(overrides, this.reasoningTier);
  }

  /** Use civilization-owned wording for the shared game context. */
  protected override getContextMessages(
    parameters: StrategistParameters,
    _input: EnvoyThread,
  ): ModelMessage[] {
    return buildGameContextMessages(parameters, { unifiedMind: true });
  }

  /** Expose the explicit no-op with the rest of the unified diplomacy tools. */
  public override getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return [
      "get-briefing",
      "send-message",
      "pass-diplomacy",
      "get-diplomatic-events",
      "call-diplomatic-analyst",
      "close-conversation",
      "call-negotiator",
      ...memoryToolNames(),
    ];
  }

  /** Register the non-spoken pass action beside the inherited diplomacy tools. */
  public override getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return {
      ...super.getExtraTools(context),
      "pass-diplomacy": createPassDiplomacyTool(context),
      ...createPoliticalMemoryTools(context),
    };
  }

  /** Add the same counterpart-focused political memory to every unified diplomacy wake. */
  protected override async getExtraContext(
    parameters: StrategistParameters,
    input: EnvoyThread,
    context: VoxContext<StrategistParameters>,
  ): Promise<LiveEnvoyContext> {
    const extra = await super.getExtraContext(parameters, input, context);
    const counterpart = input.agent === input.player1ID ? input.player2ID : input.player1ID;
    const memory = getPoliticalMemoryContext(parameters, 'diplomacy', counterpart >= 0 ? counterpart : undefined);
    return memory ? { ...extra, preamble: [...(extra.preamble ?? []), memory] } : extra;
  }

  /** Build the common identity plus the existing diplomacy tool contract. */
  override async getSystem(
    parameters: StrategistParameters,
    input: EnvoyThread,
    _context: VoxContext<StrategistParameters>,
  ): Promise<string> {
    const sections = [
      `${buildUnifiedMindIdentity(parameters, "social")}
${worldContext}`,
      `# Diplomacy expectations
- Speak to the counterpart only through the \`send-message\` tool.
- Use the briefing and diplomatic-event tools when factual context is needed.
- Use \`call-negotiator\` for a proposal or response to a deal when that tool is available.
- Use \`pass-diplomacy\` for a non-spoken, non-closing no-op when there is nothing useful to add.
- Treat the current private pairwise information scope as distinct from any other channel.
- Use the \`pass-diplomacy\` tool for a deliberate non-spoken no-op. Do not speak merely because you were awakened.
- Keep promises, requests, threats, and concessions consistent with the shared civilization identity.
- Use the exact tool-calling format for each available tool.`,
    ];

    if (!this.isSpecialMode(input)) {
      sections.push(`# Available tools
- \`send-message\` delivers your spoken reply to the counterpart.
- \`get-briefing\` retrieves current military, economic, or diplomatic context.
- \`get-diplomatic-events\` retrieves recent history for this counterpart.
- \`call-diplomatic-analyst\` records important intelligence for the civilization.
- \`call-negotiator\` handles deal terms and negotiation mechanics.
- \`close-conversation\` ends the current exchange when no further response is useful.`);
    }

    const unifiedStyle = communicationStyle.replace(
      "- Follow your leader's instruction (if any): be friendly to (desired) friends and, when appropriate, taunt your enemies (if so desired)",
      "- Maintain the governing mind's chosen posture and commitments toward friends, rivals, and neutral parties",
    );
    sections.push(unifiedStyle, audienceSection(this.formatUserDescription(input)));
    return sections.join("\n\n").trim();
  }

  /** Preserve the pass action in special greetings instead of forcing speech. */
  public override async prepareStep(
    parameters: StrategistParameters,
    input: EnvoyThread,
    lastStep: StepResult<Record<string, Tool>> | null,
    allSteps: StepResult<Record<string, Tool>>[],
    messages: ModelMessage[],
    context: VoxContext<StrategistParameters>,
  ) {
    const config = await super.prepareStep(parameters, input, lastStep, allSteps, messages, context);
    if (this.isSpecialMode(input)) config.activeTools = ["send-message", "pass-diplomacy"];
    return config;
  }

  /** Keep the final system message anchored to the same civilization identity. */
  protected override getHint(parameters: StrategistParameters, input: EnvoyThread): string {
    return `**HINT**: ${buildUnifiedMindCanonicalIdentity(parameters)} You are speaking to ${this.formatUserDescription(input)} on turn ${parameters.turn}.`;
  }

  /** Keep the final hint aligned with the shared civilization identity. */
  protected override getDefaultAddon(): string {
    return "Speak only when useful. Use the available diplomacy tools to act for our civilization, or call `pass-diplomacy` without inventing a response.";
  }
}
