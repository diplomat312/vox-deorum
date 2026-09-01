/**
 * @module envoy/negotiator
 *
 * The negotiator agent (interactive-diplomacy stage 5) — a deal specialist invoked by the
 * diplomat through the diplomat⇔negotiator loop, and the **sole decider of deal terms**.
 *
 * It never reads the human free-text thread. It is grounded by three contexts (specs §7):
 *  (1) general game context + strategy/persona — its own `get-briefing` / `get-diplomatic-events`
 *      tools plus the diplomat's briefing;
 *  (2) what is tradable and each item's value — the `inspect-deal` results (tradable range +
 *      per-term legality/value + promise agreeability), run UPFRONT by the loop and placed in
 *      its context (it does not call inspect-deal itself);
 *  (3) what is on the table — the active proposal the diplomat relays (absent when proposing).
 *
 * It chooses EXACTLY ONE of three terminal tools per invocation, each returning an inward
 * `Rationale` (reasoning for the diplomat, never voiced verbatim):
 *  - `accept-deal`        — accept the on-the-table deal as-is (routes through enact-agent-deal);
 *  - `propose-deal` — author a draft deal (counter, or an opening proposal), with a
 *                            one-sentence outward `Message`; stored as deal-counter / deal-proposal;
 *  - `reject-deal`        — decline the on-the-table deal as-is.
 *
 * Authority is baked into the chosen negotiator agent (specs §7) — there is no separate
 * ratification knob.
 */

import { z } from "zod";
import { ModelMessage, StepResult, Tool } from "ai";
import { VoxAgent } from "../../infra/vox-agent.js";
import { VoxContext } from "../../infra/vox-context.js";
import { StrategistParameters, buildGameContextMessages, getRecentGameState } from "../../strategist/strategy-parameters.js";
import { createBriefingTool } from "../../briefer/briefing-utils.js";
import { createLogger } from "../../utils/logger.js";
import type { EnvoyThread } from "../../types/index.js";
import { inspectDeal, readActiveProposal, type InspectDealResult } from "../../utils/diplomacy/deal/deal.js";
import { PROMISE_METADATA } from "../../../../mcp-server/dist/utils/deal-schema.js";
import { activeProposalDeal } from "../../utils/diplomacy/deal/deal-reduce.js";
import { resolveNegotiator } from "./resolve-negotiator.js";
import {
  NEGOTIATOR_TERMINAL_TOOLS,
  createNegotiatorTerminalTools,
  formatActiveProposalLedger,
  formatGiveReceiveLedger,
  summarizeMove,
  type NegotiatorInput,
} from "../context/negotiator-utils.js";
import { buildDiplomacyBackgroundMessage } from "../context/diplomacy-context.js";

const logger = createLogger("negotiator");

/**
 * The negotiator agent. A specialist agent-tool (like the analyst, it extends VoxAgent
 * directly rather than the EnvoyThread-typed Envoy) reusing the live-game building blocks:
 * `buildGameContextMessages` for grounding and `createBriefingTool` for on-demand briefings.
 */
export class Negotiator extends VoxAgent<StrategistParameters, NegotiatorInput, string | undefined> {
  readonly name: string = "negotiator";

  readonly description: string =
    "A deal specialist who inspects, values, and decides deal terms behind the diplomat — accepting, countering/proposing, or rejecting a deal.";

  public tags = ["diplomatic"];

  public override toolDescription =
    "Hand the current deal decision wake a `briefing`: a short recap of what the counterpart said and where the talks stand. The deal wake inspects the game and records exactly one accepted, rejected, or proposed deal action, then returns a summary for the conversation.";

  /**
   * Caller-facing schema for the diplomat's `call-negotiator` handoff. The diplomat authors
   * only the briefing (and an optional intent when opening a deal); the conversation thread and
   * the on-the-table proposal are supplied by {@link resolveHandoffInput} / the transcript.
   */
  public override handoffSchema = z.object({
    Briefing: z
      .string()
      .describe("Short briefing of the conversational context for the negotiator (no terms)."),
    Intent: z
      .string()
      .optional()
      .describe("Strategic intent when you want to open a deal: what you hope it achieves (no terms)."),
  });

  /** Merge the diplomat's handoff arguments with the ambient conversation thread. */
  public override resolveHandoffInput(
    callerArgs: unknown,
    context: VoxContext<StrategistParameters>
  ): NegotiatorInput {
    const args = (callerArgs ?? {}) as { Briefing?: string; Intent?: string };
    return {
      thread: context.currentInput as EnvoyThread,
      briefing: args.Briefing ?? "",
      intent: args.Intent,
    };
  }

  /**
   * Dispatch the `call-negotiator` handoff to the voiced seat's configured negotiator (a custom
   * Negotiator variant sharing this input shape), defaulting to this built-in negotiator. The
   * caller's thread is still current here, so its seat drives the per-seat lookup.
   */
  public override resolveHandoffTarget(context: VoxContext<StrategistParameters>): string {
    const thread = context.currentInput as EnvoyThread | undefined;
    return thread ? resolveNegotiator(thread) : this.name;
  }

  /** Stop as soon as one terminal tool has produced a move. */
  public override completionTools = [...NEGOTIATOR_TERMINAL_TOOLS];

  public override maxSteps = 4;

  /**
   * Stop only after a terminal tool has successfully persisted a move.
   *
   * Terminal tools return explanatory strings for stale state and validation failures so the
   * model can recover on a later step; those strings must not be mistaken for completion.
   */
  public override stopCheck(
    _parameters: StrategistParameters,
    input: NegotiatorInput,
    _lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    _context: VoxContext<StrategistParameters>
  ): boolean {
    return input.outcome !== undefined || allSteps.length >= this.maxSteps;
  }

  public getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return ["get-briefing", "get-diplomatic-events", ...NEGOTIATOR_TERMINAL_TOOLS];
  }

  public override getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return {
      "get-briefing": createBriefingTool(context),
      ...createNegotiatorTerminalTools(context),
    };
  }

  /** Return the politically neutral deal-authoring contract shared by legacy and unified wakes. */
  protected getDealMechanicsPrompt(): string {
    return `# Deal mechanics
- Call EXACTLY ONE terminal tool after gathering sufficient information.
- Use \`accept-deal\` to accept the current deal exactly as offered.
- Use \`reject-deal\` to decline the current deal exactly as offered.
- Use \`propose-deal\` to author an opening proposal or counter. Include a one-sentence outward \`Message\`.
- In \`propose-deal\`, \`Give\` lists what our civilization gives the counterpart and \`Receive\` lists what the counterpart gives our civilization. Each side is one term string or a list of plain term strings.
- Use the exact term names shown in the Tradable Terms menu. Append a number only for Gold, Gold Per Turn, or a resource quantity, such as "Gold 100" or "Iron 2".
- Joint wars require a third-party civilization name from the menu. "${PROMISE_METADATA.COOP_WAR.label} on <Civilization>" starts after a short countdown; "Third-Party War on <Civilization>" starts immediately.
- In-game valuation and AI evaluation are advisory evidence. The binding decision must follow this civilization's current strategy, relationships, and commitments.
- Opening proposals and counters must use only legal terms from the supplied menu and must respond to the current proposal state.`;
  }

  public async getSystem(
    parameters: StrategistParameters,
    _input: NegotiatorInput,
    _context: VoxContext<StrategistParameters>
  ): Promise<string> {
    const leader = parameters.metadata?.YouAre?.Leader ?? "your leader";
    const civName = parameters.metadata?.YouAre?.Name ?? "your civilization";

    return [`You are the deal negotiator for ${civName}, serving ${leader}. You negotiate and decide ${civName}'s diplomatic deals and terms.`,
      `# Expectations
- Reason from ${civName}'s strategy, persona, and national interest, not the counterpart's convenience. Drive a hard but realistic bargain.
- You work behind the diplomat, who speaks to the other civilization and relays you a briefing of the conversational context.
- There is no user to respond to, so you ALWAYS and ONLY properly call tools to convey your decisions.
- Your context includes a fresh inspection and evaluation of the deal on the table, when one exists, and all tradable items.
- In-game AI evaluation is advisory evidence. Apply the leader's intention through this legacy negotiator path.
- Use the correct tool-calling format for each tool provided in the prompt.`,
      this.getDealMechanicsPrompt(),
      "# Resources\n- Use the `get-briefing` tool to retrieve current military, economic, or diplomatic context when needed.",
    ].join("\n\n").trim();
  }

  /**
   * Assemble the negotiator's grounding. Determines the task itself from the transcript — any
   * still-open proposal is forwarded: the counterpart's to answer, or our own standing offer to
   * revise or retract; none (or a closed one) means we are opening a deal. Then runs
   * `inspect-deal` upfront (context 2) against the on-the-table deal, or the bare tradable
   * range when proposing. The derived `activeProposal` is stashed on `input` for the terminal
   * tools (which re-validate it against the live transcript before writing).
   */
  /** Build the shared game context used by this deal wake. */
  protected getGameContextMessages(parameters: StrategistParameters): ModelMessage[] {
    return buildGameContextMessages(parameters);
  }

  /** Build the final instruction appended after the deal ledger. */
  protected getFinalInstruction(parameters: StrategistParameters, input: NegotiatorInput): string {
    const leader = parameters.metadata?.YouAre?.Leader ?? "your leader";
    const civName = parameters.metadata?.YouAre?.Name ?? "your civilization";
    return `You are the negotiator for ${civName}, serving ${leader}. Once you are confident in your decision, use exactly one tool in the provided format to ${(input.activeProposal ? "negotiate" : "propose")} ${civName}'s diplomatic deals and terms.`;
  }

  public async getInitialMessages(
    parameters: StrategistParameters,
    input: NegotiatorInput,
    context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    const { thread } = input;

    // (3) what is on the table — reduce the transcript and forward the open offer from either side.
    const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
    const selfAuthored = reduction.status === "open" && reduction.active?.SpeakerID === thread.agent;
    if (reduction.active && reduction.status === "open") {
      const deal = activeProposalDeal(reduction);
      if (deal) input.activeProposal = { messageID: reduction.active.ID, deal };
    }

    // (2) what is tradable and each item's value — inspect upfront (range only when proposing). The
    // result is stashed on `input` so the propose-deal tool can resolve authored NAMES back to IDs.
    let inspection: InspectDealResult | undefined;
    try {
      inspection = await inspectDeal(thread.player1ID, thread.player2ID, input.activeProposal?.deal);
      input.upfrontInspection = inspection;
    } catch (error) {
      logger.warn("inspect-deal failed; proceeding without the tradable menu or value estimates", { error });
    }

    // Cities + game deals background between the two civs (context 1 support), fetched fresh. It also
    // returns the viewer-perspective players report, reused below for third-party relationship context.
    // Our leader's own set-relationship directives ride along the cached game state (no extra fetch).
    const background = await buildDiplomacyBackgroundMessage(context, parameters, thread);
    const relationships = getRecentGameState(parameters)?.options?.Relationships;
    const ledgerOptions = { inspection, players: background.players, relationships };

    const sections: string[] = [
      `# Diplomat's Briefing\n${input.briefing || "(no briefing provided)"}`,
    ];

    if (input.activeProposal) {
      // The unified ledger folds the on-the-table deal's per-term legality, advisory value, and
      // third-party relationship context directly into the terms: no separate inspection section.
      sections.push(formatActiveProposalLedger(input.activeProposal, thread, { ...ledgerOptions, selfAuthored }));
      if (selfAuthored) {
        sections.push(
          `The deal on the table is YOUR OWN proposal #${input.activeProposal.messageID}, awaiting the counterpart's reply. You cannot accept your own offer. Either revise it with propose-deal (your new terms supersede it) or retract it with reject-deal.`
        );
      }
    } else {
      sections.push(`# Strategic Intent\n${input.intent || "(open a deal at your discretion)"}`);
      sections.push(
        "There is no deal from the counterpart on the table. Construct opening terms with propose-deal using the menu below."
      );
    }

    // The Give/Receive menu (context 2): the available terms, by NAME, that propose-deal expects.
    sections.push(
       "# Tradable Terms\n" + (inspection
          ? formatGiveReceiveLedger(inspection, thread, background.players) :
          "(options unavailable)")
    );

    return [
      ...this.getGameContextMessages(parameters),
      ...(background.text ? [{ role: "user" as const, content: background.text }] : []),
      { role: "user", content: sections.join("\n\n") },
      { role: "system", content: this.getFinalInstruction(parameters, input) },
    ];
  }

  /** Summarize the move recorded by the terminal tool for the diplomat to reason over and voice. */
  public override async getOutput(
    _parameters: StrategistParameters,
    input: NegotiatorInput,
    _finalText: string
  ): Promise<string | undefined> {
    return input.outcome ? summarizeMove(input.outcome, input.thread) : undefined;
  }
  
  /** Negotiators run at the high reasoning tier. */
  protected reasoningTier = "high" as const;
}
