/**
 * Shared policy and configuration seam for a civilization-level unified mind.
 *
 * The strategic and diplomacy agents remain thin framework adapters. They use
 * this module for the same identity, model assignment, and bounded continuity
 * so a seat does not become two political actors merely because the existing
 * executors have different input contracts.
 */

import type { ModelMessage } from "ai";
import type { Model as VoxModel, PlayerConfig } from "../types/config.js";
import { getModelConfig } from "../utils/models/models.js";
import { selectModelReference } from "../utils/models/resolution.js";
import type { StrategistParameters } from "./strategy-parameters.js";
import { getRecentGameState } from "./strategy-parameters.js";
import { createLogger } from "../utils/logger.js";

/** The player-facing configuration value for the additive unified mind mode. */
export const unifiedMindMode = "unified-mind" as const;

/** The registered strategic wake adapter used internally for unified seats. */
export const unifiedStrategistAgentName = "unified-mind-strategist" as const;

/** The registered social wake adapter used internally for unified seats. */
export const unifiedDiplomatAgentName = "unified-mind-diplomat" as const;

/** The single per-seat model override key used by both unified wake adapters. */
export const unifiedMindModelKey = "unified-mind" as const;

const recentDiplomacyLimit = 12;
const recentDiplomacyPlayerLimit = 8;
const logger = createLogger("unified-civilization-mind");

/** Return whether a player opts into the additive unified mind path. */
export function isUnifiedMindPlayer(playerConfig: PlayerConfig): boolean {
  return playerConfig.mind === unifiedMindMode;
}

/** Resolve the internal strategic wake agent for a player configuration. */
export function strategicAgentForPlayer(playerConfig: PlayerConfig): string {
  return isUnifiedMindPlayer(playerConfig) ? unifiedStrategistAgentName : playerConfig.strategist;
}

/** Resolve the internal diplomacy wake agent for a player configuration. */
export function diplomacyAgentForPlayer(playerConfig: PlayerConfig): string {
  return isUnifiedMindPlayer(playerConfig)
    ? unifiedDiplomatAgentName
    : playerConfig.diplomat ?? "diplomat";
}

/** Resolve the one model assignment shared by strategic and social unified wakes. */
export function getUnifiedMindModel(
  overrides: Record<string, VoxModel | string>,
  reasoning: "minimal" | "low" | "medium" | "high" | "max" | "default" = "default",
): VoxModel {
  return getModelConfig(
    selectModelReference(unifiedMindModelKey, "default", overrides),
    reasoning,
    overrides,
  );
}

/** Read the civilization and leader names from the shared seat metadata. */
function identityFrom(parameters: StrategistParameters): { civilization: string; leader: string } {
  const identity = parameters.metadata?.YouAre as Record<string, unknown> | undefined;
  return {
    civilization: typeof identity?.Name === "string" ? identity.Name : `Player ${parameters.playerID}`,
    leader: typeof identity?.Leader === "string" ? identity.Leader : "the leader",
  };
}

/** Build the common political identity shared by strategic and social invocations. */
export function buildUnifiedMindIdentity(
  parameters: StrategistParameters,
  wake: "strategic" | "social",
): string {
  const { civilization, leader } = identityFrom(parameters);
  const wakeInstruction = wake === "strategic"
    ? "This is a strategic wake. Choose the available high-level strategy action or keep the status quo."
    : "This is a diplomacy wake. Use the available conversation, briefing, and deal tools when useful, or pass by ending without a spoken commitment.";

  return `You are the governing mind of ${civilization}, led by ${leader}. You are not an adviser, envoy, spokesperson, or external assistant. You are the civilization's decision-making political actor. You are responsible for strategy, diplomacy, promises, threats, coalition behavior, economic and military priorities, and the consistency of those choices over time.

Treat public, group, and private channels as different information scopes. Never reveal a private message to actors who were not entitled to see it unless you deliberately choose to disclose your own information as a political act. Track what your civilization has promised, implied, threatened, requested, and learned. Adapt when the balance of power changes. Passing or maintaining the status quo is valid when intervention has no strategic value.

${wakeInstruction}
Keep this civilization's identity, state, goals, posture, relationships, and commitments coherent across every wake.`;
}

/** Format one durable diplomacy row without exposing internal database metadata. */
function formatDiplomacyRow(
  row: { SpeakerID: number; Player1ID: number; Player1Role: string; Player2Role: string; Content: string },
  selfID: number,
): string {
  const speakerRole = row.SpeakerID === row.Player1ID ? row.Player1Role : row.Player2Role;
  const speaker = row.SpeakerID === selfID ? "Our civilization" : speakerRole || `Player ${row.SpeakerID}`;
  return `${speaker}: ${row.Content}`;
}

/** Load a bounded private/public diplomacy view visible to this civilization. */
export async function buildRecentDiplomacyMessage(
  parameters: StrategistParameters,
): Promise<ModelMessage | undefined> {
  const state = getRecentGameState(parameters);
  const playerIDs = Object.keys(state?.players ?? {})
    .map(Number)
    .filter((playerID) => Number.isInteger(playerID) && playerID !== parameters.playerID)
    .sort((left, right) => left - right)
    .slice(0, recentDiplomacyPlayerLimit);

  if (playerIDs.length === 0) return undefined;

  try {
    const { readTranscriptPage } = await import("../utils/diplomacy/transcript/transcript.js");
    const transcripts = await Promise.all(playerIDs.map(async (playerID) => ({
      playerID,
      page: await readTranscriptPage(parameters.playerID, playerID, { limit: recentDiplomacyLimit }),
    })));
    const sections = transcripts
      .filter(({ page }) => page.messages.length > 0)
      .map(({ playerID, page }) => {
        const rows = page.messages.slice(-recentDiplomacyLimit)
          .map((row) => formatDiplomacyRow(row, parameters.playerID));
        return `Private diplomacy with Player ${playerID}:\n${rows.join("\n")}`;
      });

    if (sections.length === 0) return undefined;
    return {
      role: "user",
      content: `# Recent Diplomacy Visible to Our Civilization\n${sections.join("\n\n")}\n\nUse this bounded history as continuity for the current strategic decision.`,
    };
  } catch (error) {
    // A stale or unavailable transcript must not prevent the existing game turn
    // from completing. The social path remains the authoritative transcript reader.
    logger.warn("Could not load recent diplomacy for unified strategic wake", { error });
    return undefined;
  }
}

/** Return the model reference that startup must preflight for a unified seat. */
export function unifiedModelReference(overrides?: Record<string, VoxModel | string>): string {
  return selectModelReference(unifiedMindModelKey, "default", overrides);
}
