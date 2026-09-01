/**
 * Strategic wake adapter for the unified civilization mind.
 *
 * Strategic execution still uses the existing strategist tools and executor.
 * Only the policy identity, model selection, and diplomacy continuity are
 * supplied by the shared unified mind seam.
 */

import type { ModelMessage } from "ai";
import { SimpleStrategist } from "./simple-strategist.js";
import { SimpleStrategistBase } from "./simple-strategist-base.js";
import { SimpleBriefer } from "../../briefer/simple-briefer.js";
import { VoxContext } from "../../infra/vox-context.js";
import type { Model } from "../../types/config.js";
import type { StrategistParameters } from "../strategy-parameters.js";
import { buildRecentDiplomacyMessage, buildUnifiedMindCanonicalIdentity, buildUnifiedMindIdentity, getUnifiedMindModel } from "../unified-civilization-mind.js";

/** Strategic adapter that invokes the shared civilization-level policy. */
export class UnifiedStrategist extends SimpleStrategist {
  /** Internal registry name for the unified strategic wake. */
  override readonly name = "unified-mind-strategist";

  /** Player-facing description of the common civilization policy. */
  override readonly description = "Unified civilization mind strategic wake";

  /** This adapter is selected by the player-level architecture, never as a standalone style. */
  override offeredInSetup = false;

  /** Keep the internal adapter name out of player-facing setup controls. */
  override displayName = "Unified Civilization Mind (internal)";

  /** Keep the legacy strategic context aligned with the canonical unified identity. */
  protected override getInitialIdentity(parameters: StrategistParameters): string {
    return buildUnifiedMindCanonicalIdentity(parameters);
  }

  /** State that strategic settings belong to the civilization, not a separate leader agent. */
  protected override getInitialStrategyLabel(): string {
    return "Strategies: existing strategic decisions owned by our civilization's governing mind.";
  }

  /** Keep the unified model selection independent of the legacy strategist key. */
  override getModel(
    _parameters: StrategistParameters,
    _input: unknown,
    overrides: Record<string, Model | string>,
  ): Model {
    return getUnifiedMindModel(overrides, this.reasoningTier);
  }

  /** Build the common identity plus the existing high-level strategic instructions. */
  override async getSystem(
    parameters: StrategistParameters,
    _context: VoxContext<StrategistParameters>,
  ): Promise<string> {
    return `${buildUnifiedMindIdentity(parameters, "strategic")}

${SimpleStrategistBase.expertPlayerPrompt}

${SimpleStrategistBase.expectationPrompt}

${SimpleStrategistBase.goalsPrompt}
${SimpleStrategistBase.getDecisionPrompt(parameters.mode)}

# Resources
${SimpleStrategistBase.optionsDescriptionPrompt}
${SimpleStrategistBase.strategiesDescriptionPrompt}
${SimpleStrategistBase.victoryConditionsPrompt}
${SimpleStrategistBase.playersInfoPrompt}
${SimpleBriefer.citiesPrompt}
${SimpleBriefer.militaryPrompt}
${SimpleBriefer.eventsPrompt}`.trim();
  }

  /** Reuse the established strategic context and append bounded diplomacy continuity. */
  override async getInitialMessages(
    parameters: StrategistParameters,
    input: unknown,
    context: VoxContext<StrategistParameters>,
  ): Promise<ModelMessage[]> {
    const messages = await super.getInitialMessages(parameters, input, context);
    const diplomacy = await buildRecentDiplomacyMessage(parameters);
    if (diplomacy) messages.push(diplomacy);
    return messages;
  }
}
