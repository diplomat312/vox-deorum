/**
 * Binding deal-decision wake for a unified civilization mind.
 *
 * The existing Negotiator supplies deal inspection, legality checks, terminal actions, and
 * persistence. This adapter changes the political identity and model resolution only, so the
 * binding result belongs to the same civilization mind as strategy and spoken diplomacy.
 */

import type { ModelMessage } from "ai";
import type { Model } from "../../types/config.js";
import { Negotiator } from "./negotiator.js";
import type { VoxContext } from "../../infra/vox-context.js";
import type { StrategistParameters } from "../../strategist/strategy-parameters.js";
import { buildGameContextMessages } from "../../strategist/strategy-parameters.js";
import { buildUnifiedMindIdentity, getUnifiedMindModel } from "../../strategist/unified-civilization-mind.js";
import type { NegotiatorInput } from "../context/negotiator-utils.js";

/** Deal adapter that keeps binding authority inside the unified civilization mind. */
export class UnifiedNegotiator extends Negotiator {
  /** Internal registry name for the unified deal wake. */
  override readonly name = "unified-mind-negotiator";

  /** Player-facing description of the common civilization policy. */
  override readonly description = "Unified civilization mind deal decision wake";

  /** Keep the deal wake on the one model assigned to the civilization mind. */
  override getModel(
    _parameters: StrategistParameters,
    _input: NegotiatorInput,
    overrides: Record<string, Model | string>,
  ): Model {
    return getUnifiedMindModel(overrides, this.reasoningTier);
  }

  /** Build the canonical identity and deal-specific binding instructions. */
  override async getSystem(
    parameters: StrategistParameters,
    _input: NegotiatorInput,
    _context: VoxContext<StrategistParameters>,
  ): Promise<string> {
    return `${buildUnifiedMindIdentity(parameters, "deal")}

# Deal decision expectations
- This wake belongs to the same civilization mind that sets strategy and speaks in diplomacy.
- Inspect the available terms, current strategy, relationships, promises, and threats before acting.
- Choose exactly one binding terminal action: \`accept-deal\`, \`reject-deal\`, or \`propose-deal\`.
- Use only legal terms from the provided menu and preserve the civilization's existing commitments.
- The terminal action is the authoritative political decision. Do not defer it to another agent.`.trim();
  }

  /** Use civilization-owned wording for the deal wake's shared game context. */
  protected override getGameContextMessages(parameters: StrategistParameters): ModelMessage[] {
    return buildGameContextMessages(parameters, { unifiedMind: true });
  }

  /** Keep the final instruction free of legacy negotiator or subordinate-persona wording. */
  protected override getFinalInstruction(parameters: StrategistParameters, input: NegotiatorInput): string {
    const action = input.activeProposal ? "accept, reject, or revise" : "propose";
    return `${buildUnifiedMindIdentity(parameters, "deal")} Use exactly one terminal tool to ${action} the available diplomatic deal terms.`;
  }
}
