// Shared vox-civ tool surface (single schema for mock and live backends).
// Both MCP front doors import SUBJECTS, ACTION_TYPES, toolDefs, validateCommit
// from here, so the model-visible prefix cannot drift between backends.

export const SUBJECTS = [
  "self", "civ", "military", "cities", "economy",
  "research", "policies", "victory", "diplomacy", "deals", "events",
];

export const ACTION_TYPES = new Set([
  "strategy", "research", "policy", "posture", "production_mode",
  "keep_status_quo", "deal_propose", "deal_accept", "deal_reject",
]);

export function toolDefs() {
  return [
    {
      name: "inspect",
      description:
        "Request authoritative live detail about one subject: self|civ|military|cities|economy|research|policies|victory|diplomacy|deals|events. Optional detail narrows it: research/policies accept a name or 'path:<name>' for the full prereq chain with costs and unlocks; military accepts 'zone:<city or zone>' or 'stats'; cities accepts a city name; diplomacy accepts a civilization name (majors and city-states).",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string", enum: SUBJECTS },
          detail: { type: "string" },
        },
        required: ["subject"],
        additionalProperties: false,
      },
    },
    {
      name: "communicate",
      description:
        "Send diplomatic messages as one batched call with operations:[{channel, target?, message}]. Up to 8 operations per turn per seat; once the budget is spent further operations are rejected. Validation failures are free, delivered operations spend. Channels: 'world' broadcasts publicly; 'dm:<seat>' writes one seat; private needs a target seat; group traffic fans out privately to member pair threads only, never the world channel; 'group:create:<title>' opens a room without sending (follow with a group send); 'group:invite:<id>:<seat>' invites with your message as the private invite note; 'group:accept:<id>' accepts a pending invite and greets the room; 'group:decline:<id>' declines silently and still spends one operation; 'group:leave:<id>' posts a farewell then leaves; 'group:archive:<id>' posts a closing line then closes the room. Invites are explicit: an invited seat must accept before it can send to the room. Legacy single form {channel, target, message} still works as one operation. Keep messages short and in character.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          channel: { type: "string" },
          message: { type: "string" },
          operations: { type: "array", items: { type: "object", properties: { channel: { type: "string" }, target: { type: "string" }, message: { type: "string" } }, additionalProperties: false } },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "commit_turn",
      description:
        "Terminal action. Commit this turn's actions with a short rationale. Allowed types and params shapes: strategy {grandStrategy?, economic[]?, military[]?} (grand strategy names like Culture/UnitedNations/Spaceship/Conquest); research {technology REQUIRED} (exact technology name); policy {policy REQUIRED} (exact policy or branch name); posture {targetID?, public -100..100?, private -100..100?} (diplomatic stance toward one MAJOR civilization, never a city); production_mode {enabled REQUIRED boolean} (global AI production toggle, never a city build choice — leave city builds to the game); keep_status_quo {} (hold current direction); deal_propose {items REQUIRED [{fromPlayerID,toPlayerID,itemType,amount?}], promises?, message?} (send a formal deal proposal — only terms you mean; check inspect(deals) first); deal_accept {proposalId REQUIRED} (enact an open proposal; binding); deal_reject {proposalId REQUIRED, reason?} (decline an open proposal).",
      inputSchema: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                params: { type: "object" },
              },
              required: ["type"],
              additionalProperties: false,
            },
          },
          rationale: { type: "string" },
        },
        required: ["actions", "rationale"],
        additionalProperties: false,
      },
    },
    {
      name: "pass",
      description: "Terminal no-op. Use when there is genuinely nothing to change this turn.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  ];
}

export function validateCommit(args) {
  const actions = args?.actions;
  if (!Array.isArray(actions)) return "actions must be an array";
  for (const a of actions) {
    if (!a || typeof a.type !== "string") return "each action needs a string type";
    if (!ACTION_TYPES.has(a.type)) {
      return `unknown action type '${a.type}'. Allowed: ${[...ACTION_TYPES].join("|")}`;
    }
  }
  if (typeof args.rationale !== "string" || args.rationale.length < 3) {
    return "rationale must be a short string";
  }
  return null;
}
