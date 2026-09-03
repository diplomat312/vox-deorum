// Minimal Vox Civ MCP server (stdio). Exposes exactly 4 stable tools:
// inspect / communicate / commit_turn / pass.
// Zero game authority here: validation + persistence hooks live in the driver
// and ultimately in Vox (bridge-service / mcp-server). This server is a thin
// stable-schema front door for the OpenCode civ session.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import { SUBJECTS, toolDefs, validateCommit } from "../driver/civ-tools.mjs";
import { checkSend, markSent } from "../live/channels.mjs";
import path from "node:path";



function commitFile() {
  return (
    process.env.CIV_PILOT_COMMIT_FILE ||
    path.resolve(process.cwd(), "runs", "last-commit.json")
  );
}

function mockState() {
  try {
    const p = process.env.CIV_PILOT_MOCK_STATE;
    if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* fall through to default */ }
  return {
    note: "mock backend (no live game). Set CIV_PILOT_MOCK_STATE to a JSON file for richer data.",
  };
}

// 2-player shared world (world.json). Returns a per-civ snapshot keyed by the
// same subjects inspect() accepts, or null when not in a 2p run.
function worldSnapshot() {
  try {
    const f = process.env.CIV_PILOT_WORLD_FILE;
    const civ = process.env.CIV_PILOT_CIV;
    if (!f || !civ || !fs.existsSync(f)) return null;
    const w = JSON.parse(fs.readFileSync(f, "utf8"));
    const me = w.civs?.[civ];
    if (!me) return null;
    const rivals = Object.fromEntries(
      Object.entries(w.civs ?? {}).filter(([k]) => k !== civ)
        .map(([k, v]) => [k, { leader: v.leader, treasury: v.treasury, happiness: v.happiness, research: v.research, posture: v.posture, cities: v.cities, wars: v.wars }])
    );
    return {
      turn: w.turn,
      you: civ,
      self: me,
      civ: me,
      military: { wars: me.wars, posture: me.posture },
      cities: me.cities,
      economy: { treasury: me.treasury, happiness: me.happiness },
      research: me.research,
      policies: {},
      victory: {},
      diplomacy: { posture: me.posture, rivals },
      deals: {},
      events: (w.events ?? []).filter((e) => e.turn > (me.lastSeenTurn ?? 0) && e.turn <= w.turn),
      inbox: (w.inbox?.[civ] ?? []).filter((m) => !m.seen),
    };
  } catch { return null; }
}

function routeWorldInbox(target, text) {
  try {
    const f = process.env.CIV_PILOT_WORLD_FILE;
    const from = process.env.CIV_PILOT_CIV ?? "unknown";
    if (!f || !fs.existsSync(f) || !target || typeof text !== "string" || !text.trim()) return;
    const w = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!w.civs?.[target]) return;
    w.inbox[target].push({ from, turn: w.turn, text: text.trim(), seen: false });
    if (Array.isArray(w.log)) w.log.push(`turn ${w.turn}: ${from} -> ${target}: "${text.trim().slice(0, 80)}"`);
    fs.writeFileSync(f, JSON.stringify(w, null, 2));
  } catch { /* non-fatal */ }
}

const server = new Server(
  { name: "vox-civ", version: "0.1.0" },
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
    const world = worldSnapshot();
    const state = world ?? mockState();
    const payload = {
      subject,
      detail: args?.detail ?? null,
      backend: world ? "world-file" : "mock (no live game)",
      data: state[subject] ?? state,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
  if (name === "communicate") {
    try {
      checkSend();
    } catch (e) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }
    const rec = { type: "message", at: new Date().toISOString(), ...args };
    try {
      fs.mkdirSync(path.dirname(commitFile()), { recursive: true });
      fs.appendFileSync(commitFile() + ".messages.jsonl", JSON.stringify(rec) + "\n");
    } catch { /* non-fatal */ }
    if (args?.target && args?.message) routeWorldInbox(args.target, args.message);
    try { markSent("mock"); } catch {}
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, queued: true }) }] };
  }
  if (name === "commit_turn") {
    const err = validateCommit(args);
    if (err) return { content: [{ type: "text", text: err }], isError: true };
    const rec = { committedAt: new Date().toISOString(), ...args };
    try {
      fs.mkdirSync(path.dirname(commitFile()), { recursive: true });
      fs.writeFileSync(commitFile(), JSON.stringify(rec, null, 2));
    } catch (e) {
      return { content: [{ type: "text", text: `commit persistence failed: ${e.message}` }], isError: true };
    }
    for (const a of args.actions ?? []) {
      if (a?.type === "message" && a.params?.target && a.params?.message) {
        routeWorldInbox(a.params.target, a.params.message);
      }
    }
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, actions: args.actions.length }) }] };
  }
  if (name === "pass") {
    const rec = { pass: true, at: new Date().toISOString(), reason: args?.reason ?? "" };
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
