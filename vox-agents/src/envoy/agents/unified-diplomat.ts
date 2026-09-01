/**
 * Diplomacy wake adapter for the unified civilization mind.
 *
 * The existing LiveEnvoy and Diplomat plumbing supplies transcript, deal,
 * streaming, and completion behavior. This adapter changes only the policy
 * identity and model lookup so the same seat-level mind handles both wakes.
 */

import { Diplomat } from "./diplomat.js";
import type { Model } from "../../types/config.js";
import type { StrategistParameters } from "../../strategist/strategy-parameters.js";
import type { EnvoyThread } from "../../types/index.js";
import type { VoxContext } from "../../infra/vox-context.js";
import { buildUnifiedMindIdentity, getUnifiedMindModel } from "../../strategist/unified-civilization-mind.js";
import { worldContext, communicationStyle, audienceSection } from "../context/envoy-prompts.js";

/** Social adapter that invokes the shared civilization-level policy. */
export class UnifiedDiplomat extends Diplomat {
  /** Internal registry name for the unified diplomacy wake. */
  override readonly name = "unified-mind-diplomat";

  /** Player-facing description of the common civilization policy. */
  override readonly description = "Unified civilization mind diplomacy wake";

  /** Keep the unified model selection independent of the legacy diplomat key. */
  override getModel(
    _parameters: StrategistParameters,
    _input: EnvoyThread,
    overrides: Record<string, Model | string>,
  ): Model {
    return getUnifiedMindModel(overrides, this.reasoningTier);
  }

  /** Build the common identity plus the existing diplomacy tool contract. */
  override async getSystem(
    _parameters: StrategistParameters,
    input: EnvoyThread,
    _context: VoxContext<StrategistParameters>,
  ): Promise<string> {
    const sections = [
      `${buildUnifiedMindIdentity(_parameters, "social")}
${worldContext}`,
      `# Diplomacy expectations
- Speak to the counterpart only through the \`send-message\` tool.
- Use the briefing and diplomatic-event tools when factual context is needed.
- Use \`call-negotiator\` for a proposal or response to a deal when that tool is available.
- Treat your public, group, and private information scopes as distinct.
- A concise PASS or a deliberate status quo is valid. Do not speak merely because you were awakened.
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

    sections.push(communicationStyle, audienceSection(this.formatUserDescription(input)));
    return sections.join("\n\n").trim();
  }

  /** Keep the final hint aligned with the shared civilization identity. */
  protected override getDefaultAddon(): string {
    return "Speak only when useful. Use the available diplomacy tools to act for our civilization, or pass without inventing a response.";
  }
}
