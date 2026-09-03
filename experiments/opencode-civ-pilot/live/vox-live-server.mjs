// Live Vox Civ MCP server (stdio) for the seat-1 OpenCode harness (Siam, PlayerID 1).
// Same 4 stable tool schemas as the mock pilot: inspect / communicate / commit_turn / pass.
// inspect() reads the LIVE game through the Vox MCP HTTP endpoint. Game-state
// authority stays in Vox; this server never writes game state.
// commit_turn() only validates and persists the model's chosen actions to a
// commit file. The driver (run-live-turn.mjs) applies them to the live game
// through the Vox MCP tools, so every write is validated and logged in one place.
// communicate() sends immediately (speech is the action): channel "world"
// posts to the public world channel, anything else appends a private letter
// to the 1v1 thread with the rival seat. Backpressure is by convention (the
// identity prompt allows at most one message per turn), not by lock.
// NOTE: imports resolve via the pilot mcp-server install (no admin symlink).
// Keep these relative paths in sync if the pilot directory moves.
import { Server } from "../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js";
import { StdioServerTransport } from "../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";
import fs from "node:fs";
import path from "node:path";

const PLAYER_ID = Number(process.env.CIV_PILOT_PLAYER_ID ?? 1);
const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:4000/mcp";
// 2p duel default: the other seat. Override per deployment.
const RIVAL_ID = Number(
  process.env.CIV_PILOT_RIVAL_ID ?? 1 - PLAYER_ID
);

const SUBJECTS = [
  "self", "civ", "military", "cities", "economy",
  "research", "policies", "victory", "diplomacy", "deals", "events",
];

const PHASE1_ACTIONS = new Set([
  "strategy", "research", "policy", "posture", "production_mode",
  "keep_status_quo", "deal_propose", "deal_accept", "deal_reject",
]);

function commitFile() {
  return (
    process.env.CIV_PILOT_COMMIT_FILE ||
    path.resolve(process.cwd(), "runs", "last-commit-siam.json")
  );
}

let mcpSession = null;
async function rpc(method, params) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (mcpSession) headers["mcp-session-id"] = mcpSession;
  const r = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: String(Date.now()), method, params }),
  });
  const sid = r.headers.get("mcp-session-id");
  if (sid) mcpSession = sid;
  const text = await r.text();
  const chunks = [...text.matchAll(/^data:\s*(\{.*\})\s*$/gm)].map((m) => m[1]);
  const payload = chunks.length ? chunks[chunks.length - 1] : text;
  return JSON.parse(payload);
}

async function liveCall(tool, args) {
  if (!mcpSession) {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vox-live-server", version: "1" },
    });
    await rpc("notifications/initialized", {});
  }
  const out = await rpc("tools/call", { name: tool, arguments: args });
  if (out?.result?.isError) {
    throw new Error(out.result.content?.[0]?.text ?? "unknown Vox MCP error");
  }
  return out.result;
}

function liveJson(res) {
  const t = res?.content?.[0]?.text ?? "{}";
  try {
    return JSON.parse(t);
  } catch {
    return { raw: String(t).slice(0, 2000) };
  }
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj && obj[k] !== undefined) o[k] = obj[k];
  return o;
}

// detail enables one-hop graph walks without new schemas: research "<tech
// name>" returns cost/prereqs/unlocks for that tech; policies "<policy>"
// returns that policy's data; cities "<name>" narrows to one city.
async function inspectLive(subject, detail) {
  const me = String(PLAYER_ID);
  switch (subject) {
    case "self":
    case "civ": {
      const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
      return p[me] ?? p;
    }
    case "economy": {
      const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
      return pick(p[me] ?? {}, ["Gold", "GoldPerTurn", "HappinessSituation", "HappinessPercentage", "CulturePerTurn", "FaithPerTurn", "SciencePerTurn", "TourismPerTurn", "Population", "Cities", "Territory"]);
    }
    case "research": {
      if (detail) return liveJson(await liveCall("get-technology", { Search: detail, MaxResults: 3 }));
      const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
      const cur = pick(p[me] ?? {}, ["Technologies", "CurrentResearch", "SciencePerTurn"]);
      // Exact available names the research action accepts (Vox validates).
      let available = [];
      try {
        const opt = liveJson(await liveCall("get-options", { PlayerID: PLAYER_ID }));
        const techs = opt?.Options?.Technologies ?? {};
        available = Object.keys(techs);
      } catch { /* keep current-only on failure */ }
      return { ...cur, availableTechnologies: available, hint: "inspect(research, \"<name>\") for cost, prereqs and unlocks of one technology" };
    }
    case "policies": {
      if (detail) return liveJson(await liveCall("get-policy", { Search: detail, MaxResults: 3 }));
      const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
      const cur = pick(p[me] ?? {}, ["PolicyBranches", "NextPolicyTurns", "CulturePerTurn"]);
      let available = [];
      try {
        const opt = liveJson(await liveCall("get-options", { PlayerID: PLAYER_ID }));
        const pols = opt?.Options?.Policies ?? {};
        available = Object.keys(pols);
      } catch { /* keep current-only on failure */ }
      return { ...cur, availablePolicies: available, hint: "inspect(policies, \"<name>\") for detail on one policy" };
    }
    case "diplomacy": {
      const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
      return pick(p[me] ?? {}, ["Relationships", "MilitaryStrength", "Score"]);
    }
    case "military":
      return liveJson(await liveCall("get-military-report", { PlayerID: PLAYER_ID }));
    case "cities": {
      const c = liveJson(await liveCall("get-cities", { PlayerID: PLAYER_ID }));
      if (detail) {
        for (const owner of Object.values(c ?? {})) {
          for (const [name, info] of Object.entries(owner ?? {})) {
            if (String(name).toLowerCase() === String(detail).toLowerCase()) return { [name]: info };
          }
        }
        return { note: `no city named '${detail}' visible`, cities: Object.values(c ?? {}).flatMap((o) => Object.keys(o ?? {})) };
      }
      return c;
    }
    case "victory":
      return liveJson(await liveCall("get-victory-progress", { PlayerID: PLAYER_ID }));
    case "events": {
      const ev = liveJson(await liveCall("get-events", { PlayerID: PLAYER_ID }));
      const arr = Array.isArray(ev) ? ev : ev?.events ?? ev;
      if (!Array.isArray(arr)) return ev;
      return arr.slice(-12).map((e) => JSON.stringify(e).slice(0, 300));
    }
    case "deals": {
      // Live tradable range, condensed: legal terms plus short reasons.
      const r = liveJson(
        await liveCall("inspect-deal", { PlayerAID: PLAYER_ID, PlayerBID: RIVAL_ID })
      );
      const tr = r?.tradableRange ?? {};
      const keys = Object.keys(tr);
      const side = tr[String(PLAYER_ID)] ?? tr[keys[0]] ?? {};
      const out = { netGoldPerTurn: side.netGoldPerTurn };
      for (const k of ["gold", "goldPerTurn", "maps", "openBorders", "defensivePact", "peaceTreaty", "allowEmbassy", "declarationOfFriendship", "vassalage"]) {
        const e = side[k];
        if (!e) continue;
        out[k] =
          e.legal === true || e.available === true
            ? `LEGAL${e.max !== undefined ? ` (max ${e.max})` : ""}`
            : `no (${(e.reasons ?? []).join("; ").slice(0, 160)})`;
      }
      if (Array.isArray(side.resources)) {
        out.resourcesLegal = side.resources
          .filter((x) => x.legal)
          .slice(0, 12)
          .map((x) => `${x.name} x${x.quantityAvailable}`);
      }
      for (const k of ["technologies", "techs", "cities"]) {
        if (Array.isArray(side[k])) {
          const legal = side[k].filter((x) => x.legal);
          out[`${k}Legal`] = legal
            .slice(0, 8)
            .map((x) => x.name ?? JSON.stringify(x).slice(0, 60));
        }
      }
      out.hint =
        "deal_propose {items:[{fromPlayerID,toPlayerID,itemType,amount?}], message?} sends a formal proposal; deal_accept {proposalId} enacts an open proposal; deal_reject {proposalId} declines it. itemType: GOLD, GOLD_PER_TURN, MAPS, RESOURCES, CITIES, OPEN_BORDERS, DEFENSIVE_PACT, RESEARCH_AGREEMENT, PEACE_TREATY, ALLOW_EMBASSY, DECLARATION_OF_FRIENDSHIP, TECHS, VASSALAGE.";
      return out;
    }
    default:
      throw new Error(`unknown subject '${subject}'`);
  }
}

function toolDefs() {
  return [
    {
      name: "inspect",
      description:
        "Request authoritative live detail about one subject: self|civ|military|cities|economy|research|policies|victory|diplomacy|deals|events. Optional detail string narrows it.",
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
        "Send one diplomatic message: channel 'world' broadcasts publicly, channel 'private' (default) writes a private letter to the rival civilization. At most one message per turn. Keep it short and in character.",
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

function validateCommit(args) {
  const actions = args?.actions;
  if (!Array.isArray(actions)) return "actions must be an array";
  for (const a of actions) {
    if (!a || typeof a.type !== "string") return "each action needs a string type";
    if (!PHASE1_ACTIONS.has(a.type)) {
      return `unknown action type '${a.type}'. Allowed: ${[...PHASE1_ACTIONS].join("|")}`;
    }
  }
  if (typeof args.rationale !== "string" || args.rationale.length < 3) {
    return "rationale must be a short string";
  }
  return null;
}

const server = new Server(
  { name: "vox-civ-live", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs() }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (name === "inspect") {
    const subject = args?.subject;
    if (!SUBJECTS.includes(subject)) {
      return { content: [{ type: "text", text: `unknown subject '${subject}'` }], isError: true };
    }
    try {
      const data = await inspectLive(subject, args?.detail);
      return { content: [{ type: "text", text: JSON.stringify({ subject, data }, null, 2).slice(0, 12000) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `live inspect failed: ${e.message}` }], isError: true };
    }
  }
  if (name === "communicate") {
    const message = String(args?.message ?? "").trim();
    if (!message) {
      return { content: [{ type: "text", text: "message must be a non-empty string" }], isError: true };
    }
    if (message.length > 1000) {
      return { content: [{ type: "text", text: "message too long (1000 chars max); keep it short" }], isError: true };
    }
    try {
      if ((args?.channel ?? "private") === "world") {
        const res = liveJson(
          await liveCall("broadcast-message", { PlayerID: PLAYER_ID, Content: message.slice(0, 1000) })
        );
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, channel: "world", id: res.ID ?? null }) }] };
      }
      const res = liveJson(
        await liveCall("append-message", {
          PlayerAID: Math.min(PLAYER_ID, RIVAL_ID),
          PlayerBID: Math.max(PLAYER_ID, RIVAL_ID),
          PlayerARole: "strategist",
          PlayerBRole: "strategist",
          SpeakerID: PLAYER_ID,
          MessageType: "text",
          Content: message.slice(0, 1000),
        })
      );
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, channel: "private", sent: true }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `communicate failed: ${e.message}` }], isError: true };
    }
  }
  if (name === "commit_turn") {
    const err = validateCommit(args);
    if (err) return { content: [{ type: "text", text: err }], isError: true };
    const rec = { committedAt: new Date().toISOString(), playerID: PLAYER_ID, ...args };
    try {
      fs.mkdirSync(path.dirname(commitFile()), { recursive: true });
      fs.writeFileSync(commitFile(), JSON.stringify(rec, null, 2));
    } catch (e) {
      return { content: [{ type: "text", text: `commit persistence failed: ${e.message}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, actions: args.actions.length }) }] };
  }
  if (name === "pass") {
    const rec = { pass: true, at: new Date().toISOString(), playerID: PLAYER_ID, reason: args?.reason ?? "" };
    try {
      fs.mkdirSync(path.dirname(commitFile()), { recursive: true });
      fs.writeFileSync(commitFile(), JSON.stringify(rec, null, 2));
    } catch { /* non-fatal */ }
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, pass: true }) }] };
  }
  return { content: [{ type: "text", text: `unknown tool '${name}'` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
