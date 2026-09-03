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
import { createGroup, getGroup, markMemberActive, tagMessage, checkSend, markSent, leaveGroup, archiveGroup, inviteToGroup, memberStatus } from "./channels.mjs";

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

// Server-side tech-tree walk: one inspect answers "what stands between me and
// X" instead of the model chaining single-tech lookups across round-trips.
// SUFFIX-ONLY: result content, never identity or tool schemas. Prefix guard
// (check-prefix.mjs) must stay green after this change.
async function techPath(target) {
  const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
  const me = p[String(PLAYER_ID)] ?? {};
  const techName = (x) => String(typeof x === "string" ? x : (x?.Name ?? x?.name ?? x?.Type ?? ""));
  // get-players reports Technologies as a COUNT, not a list. Researchability
  // is the ground truth instead: get-options lists exactly what is pickable
  // now, and anything behind the current research/available set is owned
  // (prereqs of a live option must be researched). Statuses guide ordering,
  // not ownership: compare chain names against availableTechnologies.
  let availableNow = new Set();
  try {
    const opt = liveJson(await liveCall("get-options", { PlayerID: PLAYER_ID }));
    availableNow = new Set(Object.keys(opt?.Options?.Technologies ?? {}).map((s) => s.toLowerCase()));
  } catch { /* chain still useful without availability marks */ }
  const researching = String(me.CurrentResearch ?? "").toLowerCase();
  const seen = new Set();
  const steps = [];
  const queue = [target];
  let calls = 0;
  while (queue.length && calls < 10) {
    const name = queue.shift();
    const key = String(name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let item = null;
    try {
      const r = liveJson(await liveCall("get-technology", { Search: name, MaxResults: 3 }));
      calls++;
      const items = r?.Items ?? [];
      item = items.find((i) => techName(i).toLowerCase() === key) ?? items[0] ?? null;
    } catch {
      calls++;
    }
    if (!item) {
      steps.push({ name, status: "unknown" });
      continue;
    }
    const prereqs = item.TechsPrereq ?? [];
    steps.push({
      name: item.Name, cost: item.Cost, era: item.Era, prereqs,
      unlocks: [
        ...(item.UnitsUnlocked ?? []),
        ...(item.BuildingsUnlocked ?? []),
        ...(item.WorldWondersUnlocked ?? []),
        ...(item.NationalWondersUnlocked ?? []),
      ].slice(0, 5),
      // Forward edges: what this tech opens next, so the mind can traverse
      // the tree in both directions from one inspect (suffix-only result).
      leadsTo: [...(item.TechsUnlocked ?? [])].slice(0, 8),
      status: availableNow.has(key) ? "available" : key === researching ? "researching" : "chained",
    });
    for (const pre of prereqs) {
      const pk = String(pre).toLowerCase();
      if (!seen.has(pk)) queue.push(pre);
    }
  }
  const needed = steps.filter((s) => s.status !== "unknown").reverse();
  return {
    target,
    path: needed.map((s) => s.name),
    // Full-cone cost: techs you already own cost nothing, so the remaining
    // bill is coneCost minus whatever sits behind your available set.
    coneCost: needed.reduce((a, s) => a + (Number(s.cost) || 0), 0),
    detail: steps.reverse().slice(0, 12),
    hint: "status available = pickable now (matches availableTechnologies); researching = in progress; chained = deeper in the cone (owned if behind an available tech). research {technology} names ONE exact technology",
  };
}

// Server-side policy-tree walk, mirroring techPath: one inspect answers "what
// stands between me and X" for social policies. Adopted marks come from the
// player's PolicyBranches (branch -> adopted names); availability from
// get-options, same as the research action validates. SUFFIX-ONLY.
async function policyPath(target) {
  const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
  const me = p[String(PLAYER_ID)] ?? {};
  const polName = (x) => String(typeof x === "string" ? x : (x?.Name ?? x?.name ?? x?.Type ?? ""));
  let adopted = new Set();
  try {
    for (const v of Object.values(me.PolicyBranches ?? {})) {
      if (Array.isArray(v)) for (const n of v) adopted.add(String(n).toLowerCase());
    }
  } catch { /* chain still useful without adopted marks */ }
  let availableNow = new Set();
  try {
    const opt = liveJson(await liveCall("get-options", { PlayerID: PLAYER_ID }));
    availableNow = new Set(Object.keys(opt?.Options?.Policies ?? {}).map((s) => s.toLowerCase()));
  } catch { /* chain still useful without availability marks */ }
  const seen = new Set();
  const steps = [];
  const queue = [target];
  let calls = 0;
  while (queue.length && calls < 10) {
    const name = queue.shift();
    const key = String(name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let item = null;
    try {
      const r = liveJson(await liveCall("get-policy", { Search: name, MaxResults: 3 }));
      calls++;
      const items = r?.Items ?? [];
      item = items.find((i) => polName(i).toLowerCase() === key) ?? items[0] ?? null;
    } catch {
      calls++;
    }
    if (!item) {
      steps.push({ name, status: "unknown" });
      continue;
    }
    const prereqs = item.PrereqPolicies ?? [];
    const iname = polName(item);
    steps.push({
      name: item.Name, branch: item.Branch ?? null, level: item.Level ?? null, era: item.Era ?? null, prereqs,
      status: adopted.has(iname.toLowerCase()) ? "adopted" : availableNow.has(iname.toLowerCase()) ? "available" : "chained",
    });
    for (const pre of prereqs) {
      const pk = String(pre).toLowerCase();
      if (!seen.has(pk)) queue.push(pre);
    }
  }
  const needed = steps.filter((s) => s.status !== "unknown").reverse();
  return {
    target,
    path: needed.map((s) => s.name),
    detail: steps.reverse().slice(0, 12),
    hint: "status available = pickable now (matches availablePolicies); adopted = already owned; chained = deeper in the cone (owned if behind an available policy). policy {policy} names ONE exact policy",
  };
}

// detail enables one-hop graph walks without new schemas: research "<tech
// name>" returns cost/prereqs/unlocks for that tech; policies "<policy>"
// returns that policy's data; cities "<name>" narrows to one city.
// Diplomatic opinion prose (get-opinions) condensed to short lines.
// SUFFIX-ONLY: result content, never identity or tool schemas.
function shortOpinions(op) {
  const lines = [];
  const entries = Object.values(op ?? {});
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const name = String(entry.Civilization ?? entry.Leader ?? "?");
    const bits = [];
    const we = Array.isArray(entry.OurOpinionOfThem) ? entry.OurOpinionOfThem.filter(Boolean).slice(0, 2).join(" ") : "";
    const they = Array.isArray(entry.TheirOpinionOfUs) ? entry.TheirOpinionOfUs.filter(Boolean).slice(0, 2).join(" ") : "";
    if (we) bits.push("we think: " + String(we).slice(0, 200));
    if (they) bits.push("they think: " + String(they).slice(0, 200));
    if (bits.length) lines.push("- " + name + ": " + bits.join(" / "));
  }
  lines.sort();
  return lines.slice(0, 8);
}
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
      if (detail && /^path:/i.test(detail)) {
        return await techPath(detail.replace(/^path:/i, "").trim());
      }
      if (detail) return liveJson(await liveCall("get-technology", { Search: detail, MaxResults: 3 }));
      const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
      const cur = pick(p[me] ?? {}, ["Technologies", "CurrentResearch", "SciencePerTurn"]);
      // Exact available names the research action accepts (Vox validates).
      let available = [];
      try {
        const opt = liveJson(await liveCall("get-options", { PlayerID: PLAYER_ID }));
        const techs = opt?.Options?.Technologies ?? {};
        available = Object.keys(techs).sort();
      } catch { /* keep current-only on failure */ }
      return { ...cur, availableTechnologies: available, hint: "inspect(research, \"<name>\") for one technology; inspect(research, \"path:<name>\") for the full prereq chain with costs" };
    }
    case "policies": {
      if (detail && /^path:/i.test(detail)) {
        return await policyPath(detail.replace(/^path:/i, "").trim());
      }
      if (detail) return liveJson(await liveCall("get-policy", { Search: detail, MaxResults: 3 }));
      const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
      const cur = pick(p[me] ?? {}, ["PolicyBranches", "NextPolicyTurns", "CulturePerTurn"]);
      let available = [];
      try {
        const opt = liveJson(await liveCall("get-options", { PlayerID: PLAYER_ID }));
        const pols = opt?.Options?.Policies ?? {};
        available = Object.keys(pols).sort();
      } catch { /* keep current-only on failure */ }
      return { ...cur, availablePolicies: available, hint: "inspect(policies, \"<name>\") for detail on one policy; inspect(policies, \"path:<name>\") for the full prereq chain" };
    }
    case "diplomacy": {
      if (detail) {
        const all = liveJson(await liveCall("get-players", {}));
        const want = String(detail).toLowerCase();
        const hit = Object.entries(all ?? {}).find(
          ([id, v]) => v && typeof v === "object" && String(v.Civilization ?? "").toLowerCase() === want
        );
        if (hit) {
          const one = { [hit[0]]: hit[1] };
          try {
            const op = liveJson(await liveCall("get-opinions", { PlayerID: PLAYER_ID }));
            const w = String(detail).toLowerCase();
            const lines = shortOpinions(op).filter((l) => l.toLowerCase().indexOf(w) >= 0);
            if (lines.length) one.opinionLines = lines;
          } catch { /* opinions optional */ }
          try {
            // Static civilization traits: unique units/buildings, leader
            // ability, preferred victory. Local-DB read (no game-lock risk),
            // try/catch-optional like opinions. Suffix-only result content.
            const cz = liveJson(await liveCall("get-civilization", { Search: detail, MaxResults: 3 }));
            const item = (cz?.Items ?? [])[0];
            if (item) {
              const t = [];
              if (item.Leader) t.push("leader: " + item.Leader);
              if (item.PreferredVictory) t.push("preferred victory: " + item.PreferredVictory);
              const abs = item.Abilities ?? item.Uniques ?? [];
              for (const a of abs.slice(0, 4)) {
                if (typeof a === "string") t.push(a.slice(0, 160));
                else if (a && a.Name) t.push((a.Type ? a.Type + ": " : "") + a.Name + (a.Replacing ? " (replaces " + a.Replacing + ")" : "") + (a.PrereqTech ? " @" + a.PrereqTech : ""));
              }
              if (t.length) one.traits = t.slice(0, 6);
            }
          } catch { /* traits optional; mechanics still useful */ }
          return one;
        }
        return { note: "no civilization named '" + detail + "' visible" };
      }
      const p = liveJson(await liveCall("get-players", { playerIDs: [PLAYER_ID] }));
      const out = pick(p[me] ?? {}, ["Relationships", "MilitaryStrength", "Score"]);
      try {
        const all = liveJson(await liveCall("get-players", {}));
        const minors = [];
        const myName = p[me]?.Civilization;
        for (const [id, v] of Object.entries(all ?? {})) {
          if (!v || typeof v !== "object" || v.IsMajor !== false) continue;
          const rel = v.Relationships ?? {};
          const mine = (myName && rel[myName]) ?? Object.values(rel)[0];
          const q = v.Quests?.["Player" + PLAYER_ID] ?? [];
          minors.push({ civ: v.Civilization, status: mine ?? null, quests: Array.isArray(q) ? q.length : 0 });
        }
        minors.sort((a, b) => String(a.civ) < String(b.civ) ? -1 : 1);
        out.cityStates = minors.slice(0, 16);
      } catch { /* majors-only on failure */ }
      try {
        const op = liveJson(await liveCall("get-opinions", { PlayerID: PLAYER_ID }));
        const lines = shortOpinions(op);
        if (lines.length) out.opinionLines = lines;
      } catch { /* opinions optional; mechanics still useful */ }
      out.hint = "inspect(diplomacy, \"<civilization>\") for one entry (majors and city-states alike)";
      return out;
    }
    case "military": {
      const rep = liveJson(await liveCall("get-military-report", { PlayerID: PLAYER_ID }));
      if (detail && /^stats?$/i.test(detail)) return rep["Unit Stats"] ?? rep;
      if (detail && /^zone:/i.test(detail)) {
        const want = detail.replace(/^zone:/i, "").trim().toLowerCase();
        const hit = Object.entries(rep ?? {}).find(
          ([k, z]) => k.toLowerCase() === want || String(z?.City ?? "").toLowerCase() === want || k.toLowerCase().includes(want)
        );
        if (hit) return { [hit[0]]: hit[1] };
        return { note: "no zone matching '" + detail + "' visible", zones: Object.keys(rep ?? {}) };
      }
      return { ...rep, hint: "inspect(military, \"zone:<city or zone name>\") for one zone; inspect(military, \"stats\") for unit stats" };
    }
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
        "Send one diplomatic message: channel 'world' broadcasts publicly, 'private' (default) writes a private letter to the rival, 'dm:<seat>' writes a direct message to one seat, 'group:<id>' writes to a group you belong to (first send accepts an invite), 'group:create:<title>' opens a new group with your message. Manage memberships with 'group:invite:<id>:<seat>' (your message is the invite note), 'group:leave:<id>' (posts a farewell, then leaves), 'group:archive:<id>' (posts a closing line, then closes the group). At most ONE message per turn total across all channels. Keep it short and in character.",
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
    // Backpressure enforcement (file-based, prefix-safe): at most ONE send
    // per turn across all channels. Inert when CIV_PILOT_TURN is unset
    // (offline routing tests), enforced on live turns. The driver marks the
    // guard after each run, so a nudge follow-up in the same turn cannot
    // double-send either.
    try {
      checkSend();
    } catch (e) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }
    try {
      const ch = String(args?.channel ?? "private");
      if (ch.startsWith("dm:")) {
        const seat = Number(ch.slice("dm:".length).trim());
        if (!Number.isInteger(seat)) {
          return { content: [{ type: "text", text: "dm channel needs a seat number, e.g. channel 'dm:0'" }], isError: true };
        }
        if (seat !== RIVAL_ID) {
          return { content: [{ type: "text", text: "this game has two seats; your counterpart is seat " + RIVAL_ID }], isError: true };
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
        try { markSent(ch); } catch {}
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, channel: ch, sent: true }) }] };
      }
      if (ch.startsWith("group:create:")) {
        const title = ch.slice("group:create:".length).trim().slice(0, 60);
        if (!title) {
          return { content: [{ type: "text", text: "group:create needs a title, e.g. channel 'group:create:War Council'" }], isError: true };
        }
        let g = null;
        try {
          g = createGroup({ title, creator: PLAYER_ID, members: [PLAYER_ID] });
        } catch (e) {
          return { content: [{ type: "text", text: "group create failed: " + e.message }], isError: true };
        }
        const tagged = tagMessage(g.id, g.title, message).slice(0, 1000);
        try {
          const res = liveJson(
            await liveCall("broadcast-message", { PlayerID: PLAYER_ID, Content: tagged })
          );
          try { markSent(ch); } catch {}
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, channel: "group:" + g.id, id: res.ID ?? null }) }] };
        } catch (e) {
          return { content: [{ type: "text", text: "communicate failed: " + e.message }], isError: true };
        }
      }
      if (ch.startsWith("group:invite:")) {
        const rest = ch.slice("group:invite:".length).trim();
        const cut = rest.indexOf(":");
        const gid = (cut >= 0 ? rest.slice(0, cut) : rest).trim();
        const seat = cut >= 0 ? Number(rest.slice(cut + 1).trim()) : NaN;
        if (!gid) {
          return { content: [{ type: "text", text: "group:invite needs an id and seat, e.g. channel 'group:invite:ab12cd34:0'" }], isError: true };
        }
        if (!Number.isInteger(seat)) {
          return { content: [{ type: "text", text: "group:invite needs a seat number, e.g. channel 'group:invite:ab12cd34:0'" }], isError: true };
        }
        // Invite first (validates the inviter is active), then post the
        // invite note: a failed send leaves a benign pending invite, never
        // a lost membership.
        let g = null;
        try {
          g = inviteToGroup(gid, seat, PLAYER_ID);
        } catch (e) {
          return { content: [{ type: "text", text: "group invite failed: " + e.message }], isError: true };
        }
        const tagged = tagMessage(g.id, g.title, message).slice(0, 1000);
        try {
          const res = liveJson(
            await liveCall("broadcast-message", { PlayerID: PLAYER_ID, Content: tagged })
          );
          try { markSent(ch); } catch {}
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, channel: "group:" + g.id, invited: seat, id: res.ID ?? null }) }] };
        } catch (e) {
          return { content: [{ type: "text", text: "communicate failed: " + e.message }], isError: true };
        }
      }
      if (ch.startsWith("group:leave:")) {
        const gid = ch.slice("group:leave:".length).trim();
        if (!gid) {
          return { content: [{ type: "text", text: "group:leave needs an id, e.g. channel 'group:leave:ab12cd34'" }], isError: true };
        }
        let g = null;
        try {
          g = getGroup(gid);
        } catch (e) {
          return { content: [{ type: "text", text: "unknown group '" + gid + "'" }], isError: true };
        }
        if (memberStatus(gid, PLAYER_ID) !== "active") {
          return { content: [{ type: "text", text: "not a member of group '" + gid + "'" }], isError: true };
        }
        // Farewell first, membership change after: a failed send leaves the
        // seat still a member (fail closed), never a silent departure.
        const tagged = tagMessage(g.id, g.title, message).slice(0, 1000);
        try {
          const res = liveJson(
            await liveCall("broadcast-message", { PlayerID: PLAYER_ID, Content: tagged })
          );
          try {
            leaveGroup(gid, PLAYER_ID, res.ID ?? null);
          } catch (e) {
            return { content: [{ type: "text", text: "group leave failed: " + e.message }], isError: true };
          }
          try { markSent(ch); } catch {}
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, channel: "group:" + g.id, left: true, id: res.ID ?? null }) }] };
        } catch (e) {
          return { content: [{ type: "text", text: "communicate failed: " + e.message }], isError: true };
        }
      }
      if (ch.startsWith("group:archive:")) {
        const gid = ch.slice("group:archive:".length).trim();
        if (!gid) {
          return { content: [{ type: "text", text: "group:archive needs an id, e.g. channel 'group:archive:ab12cd34'" }], isError: true };
        }
        let g = null;
        try {
          g = getGroup(gid);
        } catch (e) {
          return { content: [{ type: "text", text: "unknown group '" + gid + "'" }], isError: true };
        }
        if (memberStatus(gid, PLAYER_ID) !== "active") {
          return { content: [{ type: "text", text: "not a member of group '" + gid + "'" }], isError: true };
        }
        // Closing line first, archive after: a failed send keeps the group
        // open (fail closed), never a silent close.
        const tagged = tagMessage(g.id, g.title, message).slice(0, 1000);
        try {
          const res = liveJson(
            await liveCall("broadcast-message", { PlayerID: PLAYER_ID, Content: tagged })
          );
          try {
            archiveGroup(gid, PLAYER_ID);
          } catch (e) {
            return { content: [{ type: "text", text: "group archive failed: " + e.message }], isError: true };
          }
          try { markSent(ch); } catch {}
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, channel: "group:" + g.id, archived: true, id: res.ID ?? null }) }] };
        } catch (e) {
          return { content: [{ type: "text", text: "communicate failed: " + e.message }], isError: true };
        }
      }
      if (ch.startsWith("group:")) {
        const gid = ch.slice("group:".length).trim();
        let g = null;
        try {
          g = getGroup(gid);
        } catch (e) {
          return { content: [{ type: "text", text: `unknown group '${gid}'` }], isError: true };
        }
        try {
          markMemberActive(gid, PLAYER_ID);
          g = getGroup(gid);
        } catch (e) {
          return { content: [{ type: "text", text: `not a member of group '${gid}': ${e.message}` }], isError: true };
        }
        const tagged = tagMessage(g.id, g.title, message).slice(0, 1000);
        try {
          const res = liveJson(
            await liveCall("broadcast-message", { PlayerID: PLAYER_ID, Content: tagged })
          );
          try { markSent(ch); } catch {}
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, channel: `group:${g.id}`, id: res.ID ?? null }) }] };
        } catch (e) {
          return { content: [{ type: "text", text: `communicate failed: ${e.message}` }], isError: true };
        }
      }
      if ((args?.channel ?? "private") === "world") {
        const res = liveJson(
          await liveCall("broadcast-message", { PlayerID: PLAYER_ID, Content: message.slice(0, 1000) })
        );
          try { markSent(ch); } catch {}
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
      try { markSent("private"); } catch {}
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
