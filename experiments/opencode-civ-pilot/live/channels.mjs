// Social channels for the single-session-per-civ pilot.
//
// Backends available TODAY: world broadcast (global messages) and pairwise
// transcript threads. There are no N-party threads in Vox (dipl:game:lo:hi),
// so in the 2-player duel every group physically rides the world broadcast
// with a [#<id> title] tag, and DMs ride the pair thread. The CHANNEL
// abstraction (open / membership / invites / history boundaries / per-channel
// inbox) is real and survives onto 3+ civs and N-party threads later; only
// the transport mapping changes.
//
// Rules:
// - One session per civ, always. Channels are inbox sections and send
//   targets, never agents.
// - Backpressure: at most ONE send per turn TOTAL across all channels
//   (world, private, groups). The model picks what matters.
// - Sending to a group you were invited to auto-accepts the invite.
// - No new tool schemas: communicate routes channel world|private|group:<id>
//   through the existing stable schema (prefix-safe).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const storeFile = () =>
  process.env.CIV_PILOT_CHANNELS_FILE || path.join(here, "channels.json");

export function tagMessage(id, title, message) {
  return `[#${id} ${title}] ${message}`;
}

export function parseTag(text) {
  const m = /^\[#([0-9a-f]{8}) ([^\]]{1,80})\]\s?/i.exec(String(text ?? ""));
  return m ? { id: m[1], title: m[2] } : null;
}

function blank() {
  return { version: 1, groups: [] };
}

export function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    if (s && Array.isArray(s.groups)) return s;
  } catch { /* first run */ }
  return blank();
}

function saveStore(s) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(s, null, 1));
}

const shortId = () => crypto.randomBytes(4).toString("hex");

// Minds open groups with members active immediately (like opening a DM:
// nobody sits pending in a 2-player duel). Human-driven invites use the
// invited status; a first send from an invitee auto-accepts.
export function createGroup({ title, creator, members = [] }) {
  // Store invariant: titles never contain brackets or newlines, so a tagged
  // line always round-trips through parseTag and renders as one inbox line.
  // Without this, a title like "War [Council]" silently breaks groupInbox
  // matching and the group's messages are lost.
  const clean = String(title ?? "").trim().replace(/[\[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) throw new Error("title is required");
  const s = loadStore();
  const seats = [...new Set([creator, ...members])];
  const g = {
    id: shortId(), title: clean, createdBy: creator, createdAt: new Date().toISOString(),
    archived: false,
    members: seats.map((seat) => ({ seat, status: "active", visibleAfter: 0, leftAfter: null })),
  };
  s.groups.push(g);
  saveStore(s);
  return g;
}

export function getGroup(id) {
  const g = loadStore().groups.find((g) => g.id === id && !g.archived);
  if (!g) throw new Error(`unknown group '${id}'`);
  return g;
}

export function inviteToGroup(id, seat, by) {
  const s = loadStore();
  const g = s.groups.find((g) => g.id === id && !g.archived);
  if (!g) throw new Error(`unknown group '${id}'`);
  if (!g.members.some((m) => m.seat === by && m.status === "active")) {
    throw new Error("only active members can invite");
  }
  if (!g.members.some((m) => m.seat === seat)) {
    g.members.push({ seat, status: "invited", visibleAfter: 0, leftAfter: null });
    saveStore(s);
  }
  return g;
}

// Resolve an invite explicitly (accept=false declines). Sending to the group
// also accepts implicitly (markMemberActive with implicit=true).
export function resolveInvite(id, seat, accept) {
  const s = loadStore();
  const g = s.groups.find((g) => g.id === id && !g.archived);
  if (!g) throw new Error(`unknown group '${id}'`);
  const m = g.members.find((m) => m.seat === seat && m.status === "invited");
  if (!m) throw new Error("no pending invite");
  m.status = accept ? "active" : "declined";
  saveStore(s);
  return g;
}

export function markMemberActive(id, seat) {
  const s = loadStore();
  const g = s.groups.find((g) => g.id === id && !g.archived);
  if (!g) throw new Error(`unknown group '${id}'`);
  const m = g.members.find((m) => m.seat === seat);
  if (!m) throw new Error(`seat ${seat} is not a member of group '${id}'`);
  if (m.status === "left" || m.status === "declined") {
    throw new Error(`seat ${seat} is not a member of group '${id}'`);
  }
  m.status = "active";
  saveStore(s);
  return g;
}

export function leaveGroup(id, seat, atWorldId = null) {
  const s = loadStore();
  const g = s.groups.find((g) => g.id === id && !g.archived);
  if (!g) throw new Error(`unknown group '${id}'`);
  const m = g.members.find((m) => m.seat === seat && m.status === "active");
  if (!m) throw new Error("not an active member");
  m.status = "left";
  m.leftAfter = atWorldId;
  saveStore(s);
  return g;
}

export function visibleGroups(seat) {
  return loadStore().groups.filter(
    (g) => !g.archived && g.members.some((m) => m.seat === seat && (m.status === "active" || m.status === "invited"))
  );
}

// Close a channel once its purpose is served (post-peace war council, dead
// duel hall, etc). Archived groups vanish from visibleGroups and groupInbox;
// getGroup/markMemberActive treat them as unknown, so a later send to the
// same id fails closed with 'unknown group' instead of resurrecting it.
// Only an active member may archive. History stays in the world broadcast.
export function archiveGroup(id, by) {
  const s = loadStore();
  const g = s.groups.find((g) => g.id === id && !g.archived);
  if (!g) throw new Error(`unknown group '${id}'`);
  if (!g.members.some((m) => m.seat === by && m.status === "active")) {
    throw new Error("only active members can archive");
  }
  g.archived = true;
  saveStore(s);
  return g;
}

export function memberStatus(id, seat) {
  const g = loadStore().groups.find((g) => g.id === id);
  return g?.members.find((m) => m.seat === seat)?.status ?? null;
}

// Per-channel inbox over ALREADY-FETCHED world messages: no extra MCP reads.
// worldMessages: [{ID, Turn, SpeakerID, Content}] as in get-global-messages.
export function groupInbox(seat, worldMessages, lastSeenTurn) {
  const lines = [];
  const invites = [];
  for (const g of visibleGroups(seat)) {
    const me = g.members.find((m) => m.seat === seat);
    if (me?.status === "invited") {
      invites.push(`- Invite: group:${g.id} "${g.title}" — send one group:${g.id} message to accept.`);
      continue;
    }
    const tagged = (worldMessages ?? []).filter((m) => {
      const t = parseTag(m.Content);
      if (!t || t.id !== g.id) return false;
      if ((m.Turn ?? 0) <= lastSeenTurn) return false;
      if ((m.ID ?? 0) <= (me?.visibleAfter ?? 0)) return false;
      if (me?.leftAfter != null && (m.ID ?? 0) > me.leftAfter) return false;
      return true;
    });
    if (!tagged.length) continue;
    lines.push(`- group:${g.id} "${g.title}":`);
    for (const m of tagged.slice(-3)) {
      const body = String(m.Content).replace(/^\[#[^\]]+\]\s?/, "").slice(0, 200);
      lines.push(`  - T${m.Turn} seat ${m.SpeakerID}: ${body}`);
    }
  }
  return { lines, invites };
}

// One-send-per-turn backpressure guard (file-based, server-enforced).
// Convention alone ("at most ONE message per turn" in civ.md) held so far,
// but a second send in one turn would double speech costs and break inbox
// accounting. No tool-schema change: descriptions untouched (prefix-safe).
// Turn source: CIV_PILOT_TURN env, set per cognition opportunity by
// run-live-turn.mjs. Guard file: CIV_PILOT_SEND_FILE, or the sibling
// send-guard.json next to CIV_PILOT_COMMIT_FILE. When TURN is unset
// (offline routing tests, manual probes) the guard is inert, so existing
// offline asserts stay green. File shape: { turn, channel, at }.
export function guardFile() {
  if (process.env.CIV_PILOT_SEND_FILE) return process.env.CIV_PILOT_SEND_FILE;
  const commit = process.env.CIV_PILOT_COMMIT_FILE;
  if (commit) return path.join(path.dirname(commit), "send-guard.json");
  return path.join(here, "send-guard.json");
}
export function guardTurn() {
  const t = process.env.CIV_PILOT_TURN;
  if (t === undefined || t === null || String(t).trim() === "") return null;
  const n = Number(String(t).trim());
  return Number.isFinite(n) ? n : String(t).trim();
}
export function lastSend() {
  try {
    const raw = fs.readFileSync(guardFile(), "utf8");
    const o = JSON.parse(raw);
    if (o && (typeof o.turn === "number" || typeof o.turn === "string")) return o;
  } catch { /* missing/corrupt reads as no send yet; never block the game */ }
  return null;
}
export function checkSend() {
  const turn = guardTurn();
  if (turn === null) return false;
  const prev = lastSend();
  if (prev && String(prev.turn) === String(turn)) {
    throw new Error("already sent one message this turn (backpressure: at most ONE send per turn across all channels)");
  }
  return false;
}
export function markSent(channel) {
  const turn = guardTurn();
  if (turn === null) return null;
  const rec = { turn, channel: String(channel ?? ""), at: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(guardFile()), { recursive: true });
    fs.writeFileSync(guardFile(), JSON.stringify(rec, null, 1));
  } catch { /* the send already happened live; never fail it on guard write */ }
  return rec;
}
