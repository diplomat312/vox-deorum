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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUBJECTS, toolDefs, validateCommit } from "../driver/civ-tools.mjs";
import { executeOperations } from "../driver/social-exec.mjs";
import { loadSeats } from "../driver/seats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pilotRoot = path.resolve(here, "..");

// Resolve the shared world file the same way regardless of the caller cwd:
// absolute paths pass through, relative paths try the pilot root first,
// then the process cwd. Returns { path, tried } so a miss warns loudly
// instead of silently serving mock data.
function resolveWorldFile() {
  const f = process.env.CIV_PILOT_WORLD_FILE;
  if (!f) return { path: null, tried: [] };
  if (path.isAbsolute(f)) return { path: f, tried: [f] };
  const cands = [path.resolve(pilotRoot, f), path.resolve(process.cwd(), f)];
  return { path: cands.find((c) => fs.existsSync(c)) ?? null, tried: cands };
}

function loadWorldFile() {
  const { path: f } = resolveWorldFile();
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

function saveWorldFile(w) {
  const { path: f } = resolveWorldFile();
  if (!f) return false;
  try { fs.writeFileSync(f, JSON.stringify(w, null, 2)); return true; } catch { return false; }
}

// File transports mirroring the live Vox transports: world and group notes
// land in the world log, private letters land in the target civ inbox.
function worldLogLine(text) {
  const w = loadWorldFile();
  if (!w || !text) return false;
  if (Array.isArray(w.log)) w.log.push(text);
  return saveWorldFile(w);
}

function worldInboxTo(civ, from, text) {
  const w = loadWorldFile();
  if (!w || !w.civs?.[civ] || !text) return false;
  w.inbox[civ].push({ from, turn: w.turn, text: String(text).trim(), seen: false });
  if (Array.isArray(w.log)) w.log.push(`turn ${w.turn}: ${from} -> ${civ}: "${String(text).trim().slice(0, 80)}"`);
  return saveWorldFile(w);
}

// seat number -> civ name from the seats file (same file the seat driver
// reads), so dm:<seat> resolves identically on mock and live.
function seatCiv(seat) {
  try {
    const f = process.env.CIV_PILOT_SEATS_FILE;
    const cands = f ? [path.isAbsolute(f) ? f : path.resolve(pilotRoot, f)] : [path.join(pilotRoot, "live", "social-seats.json")];
    for (const c of cands) {
      try {
        const seats = JSON.parse(fs.readFileSync(c, "utf8"));
        const hit = seats.find((e) => Number(e.seat) === Number(seat));
        if (hit && hit.civ) return hit.civ;
      } catch {}
    }
  } catch {}
  return null;
}


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

// N-civ shared world file. Returns a per-civ snapshot keyed by the
// same subjects inspect() accepts, or null when not in a 2p run.
function worldSnapshot() {
  try {
    const { path: f } = resolveWorldFile();
    const civ = process.env.CIV_PILOT_CIV;
    if (!f || !civ) return null;
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
    const { path: f } = resolveWorldFile();
    const from = process.env.CIV_PILOT_CIV ?? "unknown";
    if (!f || !target || typeof text !== "string" || !text.trim()) return;
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

let toolChain = Promise.resolve();
server.setRequestHandler(CallToolRequestSchema, (req) => {
  const run = () => handleToolCall(req);
  const p = toolChain.then(run, run);
  toolChain = p.catch(() => {});
  return p;
});
async function handleToolCall(req) {
  const { name, arguments: args } = req.params;
  if (name === "inspect") {
    const subject = args?.subject;
    if (!SUBJECTS.includes(subject)) {
      return { content: [{ type: "text", text: `unknown subject '${subject}'` }], isError: true };
    }
    if (subject === "diplomacy" && typeof args?.detail === "string" && /^correspondence:/i.test(args.detail)) {
      const w = loadWorldFile();
      const me = process.env.CIV_PILOT_CIV ?? "unknown";
      const want = args.detail.replace(/^correspondence:/i, "").trim().toLowerCase();
      const names = Object.keys(w?.civs ?? {});
      const hit = names.find((n) => n.toLowerCase() === want);
      if (!w || !hit) return { content: [{ type: "text", text: JSON.stringify({ peer: want || null, messages: [], note: "no offline correspondence" }) }] };
      const box = (w.inbox?.[me] ?? []).filter((m) => String(m.from ?? "").toLowerCase() === hit.toLowerCase());
      const lines = (w.log ?? []).filter((l) => String(l).toLowerCase().includes(hit.toLowerCase()));
      return { content: [{ type: "text", text: JSON.stringify({ peer: hit, messages: box, mentions: lines.slice(-20) }) }] };
    }
    const world = worldSnapshot();
    const state = world ?? mockState();
    const payload = {
      subject,
      detail: args?.detail ?? null,
      backend: world ? "world-file" : "mock (no live game)",
      worldFile: process.env.CIV_PILOT_WORLD_FILE ?? null,
      worldFileFound: !!world,
      worldFileTried: world ? undefined : resolveWorldFile().tried,
      data: state[subject] ?? state,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
  if (name === "communicate") {
    const ME = Number(process.env.CIV_PILOT_PLAYER_ID ?? 0);
    const FROM = process.env.CIV_PILOT_CIV ?? "unknown";
    const single = !Array.isArray(args?.operations) || !args.operations.length;
    const raw = Array.isArray(args?.operations) && args.operations.length ? args.operations : [{ channel: args?.channel, target: args?.target, message: args?.message }];
    const t = Number(process.env.CIV_PILOT_TURN ?? NaN);
    const turn = Number.isFinite(t) ? t : null;
    const rec = { type: "message", at: new Date().toISOString(), ...args };
    try {
      fs.mkdirSync(path.dirname(commitFile()), { recursive: true });
      fs.appendFileSync(commitFile() + ".messages.jsonl", JSON.stringify(rec) + "\n");
    } catch {}
    const out = await executeOperations(raw, {
      me: ME,
      turn,
      seats: loadSeats(),
      transports: {
        broadcast: async (text) => { worldLogLine(text); return { ID: null }; },
        pair: async (peer, text) => { const civ = seatCiv(peer); if (civ) worldInboxTo(civ, FROM, text); },
        groupNote: async (tagged) => { worldLogLine(tagged); },
      },
    });
    if (single && out.results.length === 1 && out.results[0].error) return { content: [{ type: "text", text: out.results[0].error }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, executed: out.executed, results: out.results }) }] };
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
}

const transport = new StdioServerTransport();
await server.connect(transport);
