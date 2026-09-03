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
        "Send one diplomatic message: channel 'world' broadcasts publicly, 'private' (default) writes a private letter to the rival, 'dm:<seat>' writes a direct message to one seat, 'group:<id>' writes to a group you belong to (first send accepts an invite), 'group:create:<title>' opens a new group with your message. Manage memberships with 'group:invite:<id>:<seat>' (your message is the invite note), 'group:leave:<id>' (posts a farewell, then leaves), 'group:archive:<id>' (posts a closing line, then closes the group). group:accept:<id> accepts a pending invite (posts a join note), group:decline:<id> declines it silently without spending the turn send. At most ONE message per turn total across all channels. Keep it short and in character.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          channel: { type: "string" },
          message: { type: "string" },
        },
        required: ["target", "message"],
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
