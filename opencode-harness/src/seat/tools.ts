// The four tools a seat is allowed to call: inspect, communicate, commit_turn
// and pass. The surface is deliberately small and stable, because the point of
// the harness is to change what the seat is *shown*, not what it *can do*.
//
// Two of the tools are terminal: commit_turn and pass end the turn. The other
// two may be called as often as the seat likes.

import { applyOperations, type Operation } from "../social/social-store.js";
import type { DecisionOutcome, DealOperation, World } from "../world/types.js";

// What a seat may ask to see. Each subject answers one question about the world.
export const inspectSubjects = [
  "self",
  "research",
  "cities",
  "economy",
  "military",
  "victory",
  "diplomacy",
  "deals",
  "events"
] as const;

// A subject a seat may inspect.
export type InspectSubject = (typeof inspectSubjects)[number];

// The kinds of game action a seat may commit. Everything else the game does,
// meaning unit movement, city production and combat, belongs to the native AI.
export const commitActionTypes = ["research", "policy", "posture", "strategy", "keep_status_quo"] as const;

// A game action a seat may commit.
export type CommitActionType = (typeof commitActionTypes)[number];

// One action inside a commit.
export interface CommitAction {
  // Which kind of action this is.
  type: CommitActionType;
  // The technology to research, when this is a research action.
  technology?: string;
  // The policy to adopt, when this is a policy action.
  policy?: string;
  // The seat to aim a posture at, when this is a posture action.
  target?: number;
  // The public relationship value, when this is a posture action.
  public?: number;
  // The private relationship value, when this is a posture action.
  private?: number;
  // The grand strategy, when this is a strategy action.
  grand?: string;
  // The economic strategies, when this is a strategy action.
  economic?: string[];
  // The military strategies, when this is a strategy action.
  military?: string[];
  // The mode of the standstill, when this is a keep_status_quo action.
  mode?: string;
}

// Everything a tool call needs in order to answer.
export interface SeatContext {
  // The seat making the call.
  seat: string;
  // The seat's player index, when the world knows it.
  playerID: number | null;
  // The turn being played.
  turn: number;
  // The state source, which answers inspect from what it holds.
  world: World;
  // Directory holding this run's social log, which is where talking lands.
  socialDirectory: string;
}

// What a tool call produced.
export interface SeatToolResult {
  // The text handed back to the seat.
  text: string;
  // Whether this call ended the turn.
  terminal: boolean;
  // The outcome when the call ended the turn.
  outcome?: "committed" | "passed";
  // Set when an inspect asked for something the world does not hold. These are
  // collected as a metric, because what seats keep asking for and not getting
  // is the sharpest signal about what the observation should carry.
  gap?: { subject: string; detail?: string };
  // The actions a commit carried, when the call was a commit.
  actions?: CommitAction[];
  // The operations a communicate applied.
  delivered?: number;
}

// Refuse a call with a message the seat can act on.
function refuse(message: string): SeatToolResult {
  return { text: message, terminal: false };
}

// Answer an inspect from what the world holds, and mark the call as a gap when
// the world does not hold it. The recorded game stores the calls a seat
// actually made, so a seat asking the same question gets the same answer, and
// a seat asking something new is told that the simulation cannot answer it
// rather than being handed invented state.
async function inspect(context: SeatContext, input: Record<string, unknown>): Promise<SeatToolResult> {
  const subject = input.subject;
  if (typeof subject !== "string" || !(inspectSubjects as readonly string[]).includes(subject)) {
    return refuse("inspect needs a subject, one of: " + inspectSubjects.join(", "));
  }
  const detail = typeof input.detail === "string" ? input.detail : undefined;
  const answer = await context.world.inspect(context.seat, context.turn, subject, detail);
  return {
    text: answer.text,
    terminal: false,
    gap: answer.gap ? (detail ? { subject, detail } : { subject }) : undefined
  };
}

// Apply a batch of social operations, which is the only way a seat talks.
// Whether an operation is about a deal, which is the one kind a world may have
// its own place to settle.
function isDealOperation(operation: Operation): operation is Operation & DealOperation {
  return (
    operation.kind === "deal-propose" || operation.kind === "deal-accept" || operation.kind === "deal-reject"
  );
}

// Rewrite the seat a message is aimed at into the seat name the run uses.
// Anything already correct, or that matches nothing, is left exactly as it was
// so the social store can refuse it with its own message.
function resolveRecipients(context: SeatContext, operation: Operation): Operation {
  if (typeof operation.to !== "string") return operation;
  const aliases = context.world.aliases();
  const resolved = aliases[operation.to.trim().toLowerCase()];
  return resolved && resolved !== operation.to ? { ...operation, to: resolved } : operation;
}

async function communicate(context: SeatContext, input: Record<string, unknown>): Promise<SeatToolResult> {
  const operations = input.operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    return refuse("communicate needs at least one operation");
  }
  // A model writes the civilization it can see, not the seat name the harness
  // uses. Resolving both here means a correctly aimed message is never refused
  // over what the sender called its recipient.
  const resolved = (operations as Operation[]).map((operation) => resolveRecipients(context, operation));
  // A world with a deal system of its own settles deals there. A live game has
  // real terms, live legality checks and a transactional enactment, so a deal
  // written into the run's own log beside it would be a second, weaker truth
  // about the same trade. A world without one keeps every operation in the log.
  const settleDeal = context.world.applyDeal?.bind(context.world);
  const deals = settleDeal ? resolved.filter(isDealOperation) : [];
  const social = deals.length > 0 ? resolved.filter((operation) => !isDealOperation(operation)) : resolved;
  try {
    const applied =
      social.length > 0
        ? await applyOperations(context.socialDirectory, context.seat, social, {
            seats: context.world.seats().map((entry) => entry.seat),
            // The turn is stamped onto every entry, so a reading can say how long
            // a seat has been silent in the unit a game is measured in.
            turn: context.turn
          })
        : [];
    const settled: DecisionOutcome[] = [];
    if (settleDeal) for (const operation of deals) settled.push(await settleDeal(context.seat, operation));
    const body: Record<string, unknown> = { delivered: applied.length, operations: applied };
    if (settled.length > 0) body.deals = settled;
    return {
      text: JSON.stringify(body, null, 1),
      terminal: false,
      delivered: applied.length + settled.filter((outcome) => outcome.taken).length
    };
  } catch (error) {
    return refuse("communicate was refused: " + (error instanceof Error ? error.message : String(error)));
  }
}

// Read one action out of the commit payload, refusing anything malformed.
function readAction(value: unknown, index: number): CommitAction | string {
  if (typeof value !== "object" || value === null) return "action " + index + " is not an object";
  const action = value as Record<string, unknown>;
  const type = action.type;
  if (typeof type !== "string" || !(commitActionTypes as readonly string[]).includes(type)) {
    return "action " + index + " needs a type, one of: " + commitActionTypes.join(", ");
  }
  return action as unknown as CommitAction;
}

// Validate and accept a seat's game actions for the turn.
async function commitTurn(context: SeatContext, input: Record<string, unknown>): Promise<SeatToolResult> {
  const raw = input.actions;
  if (!Array.isArray(raw)) return refuse("commit_turn needs an actions array");
  const actions: CommitAction[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const action = readAction(raw[index], index);
    if (typeof action === "string") return refuse("commit_turn was refused: " + action);
    actions.push(action);
  }
  const rationale = typeof input.rationale === "string" ? input.rationale : "";
  return {
    text:
      "Committed at turn " +
      context.turn +
      ": " +
      actions.map((action) => action.type).join(", ") +
      (rationale ? " (" + rationale.slice(0, 200) + ")" : ""),
    terminal: true,
    outcome: "committed",
    actions
  };
}

// Accept a seat's decision to do nothing this turn.
function pass(context: SeatContext, input: Record<string, unknown>): SeatToolResult {
  const rationale = typeof input.rationale === "string" ? input.rationale : "";
  return {
    text: "Passed at turn " + context.turn + (rationale ? " (" + rationale.slice(0, 200) + ")" : ""),
    terminal: true,
    outcome: "passed"
  };
}

// Dispatch one tool call. Unknown tools are refused rather than ignored, so a
// seat that drifts off the surface shows up rather than silently doing nothing.
export async function dispatchSeatTool(
  context: SeatContext,
  name: string,
  input: Record<string, unknown>
): Promise<SeatToolResult> {
  const tool = name.replace(/^vox-civ_/, "");
  if (tool === "inspect") return inspect(context, input);
  if (tool === "communicate") return communicate(context, input);
  if (tool === "commit_turn") return commitTurn(context, input);
  if (tool === "pass") return pass(context, input);
  return refuse("unknown tool '" + name + "'. The available tools are: inspect, communicate, commit_turn, pass");
}

// The tool definitions a seat session is given. Kept here beside the dispatch
// so the description a model reads and the behaviour it gets cannot drift apart.
export function seatToolDefinitions(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return [
    {
      name: "inspect",
      description:
        "Read one subject of your situation. Subjects: " +
        inspectSubjects.join(", ") +
        ". Use detail for diplomacy, either a seat name or correspondence:<seat>.",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string", enum: [...inspectSubjects] },
          detail: { type: "string" }
        },
        required: ["subject"]
      }
    },
    {
      name: "communicate",
      description:
        "Send up to 8 social operations in one call. Kinds: world {message}, dm {to, message}, group-create {name}, invite {group, to}, accept {group}, group-msg {group, message}, leave {group}, deal-propose {to, gold?, goldPerTurn?, resource?, message?}, deal-accept {deal}, deal-reject {deal}. Invited seats must accept before group messaging. A deal is a promise with terms: the other seat answers it, and what you promise you pay.",
      inputSchema: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: [
                    "world",
                    "dm",
                    "group-create",
                    "invite",
                    "accept",
                    "group-msg",
                    "leave",
                    "deal-propose",
                    "deal-accept",
                    "deal-reject"
                  ]
                },
                to: { type: "string" },
                message: { type: "string" },
                name: { type: "string" },
                group: { type: "string" },
                gold: { type: "number" },
                goldPerTurn: { type: "number" },
                resource: { type: "string" },
                deal: { type: "string" }
              },
              required: ["kind"]
            }
          }
        },
        required: ["operations"]
      }
    },
    {
      name: "commit_turn",
      description:
        "Terminal action. Commit your game actions with a rationale. Types: research {technology}, policy {policy}, posture {target, public, private}, strategy {grand, economic[], military[]}, keep_status_quo {mode?}. All are validated by the game.",
      inputSchema: {
        type: "object",
        properties: {
          rationale: { type: "string" },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: [...commitActionTypes] },
                technology: { type: "string" },
                policy: { type: "string" },
                target: { type: "number" },
                public: { type: "number" },
                private: { type: "number" },
                grand: { type: "string" },
                economic: { type: "array", items: { type: "string" } },
                military: { type: "array", items: { type: "string" } },
                mode: { type: "string" }
              },
              required: ["type"]
            }
          }
        },
        required: ["rationale", "actions"]
      }
    },
    {
      name: "pass",
      description: "Terminal no-op. Use when nothing needs changing this turn.",
      inputSchema: {
        type: "object",
        properties: { rationale: { type: "string" } }
      }
    }
  ];
}
