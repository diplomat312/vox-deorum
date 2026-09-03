// Shared 2-player mock world: Rome (OpenCode harness) vs Greece (Codex chat).
// One JSON file is the whole game. Both minds observe it and commit into it.
import fs from "node:fs";
import path from "node:path";

export const CIVS = ["Rome", "Greece"];
export const GAME = "2p-1";

const SCRIPTED = {
  2: ["Barbarian encampment spotted in the hills between Rome and Athens."],
  3: ["A merchant caravan visits both capitals: +8 gold each."],
  4: ["The city-state of Tyre asks for patronage against the barbarians."],
  6: ["Earthquake! -2 happiness in all cities this turn."],
  8: ["Scholars cross the border; both courts glimpse the other's research."],
  10: ["Tyre offers 60 gold to whoever clears the barbarian camp."],
};

function freshWorld() {
  return {
    game: GAME,
    turn: 1,
    civs: {
      Rome: { leader: "Augustus Caesar", treasury: 120, happiness: 6, research: "Machinery", posture: "consolidate", cities: ["Rome", "Antium"], wars: [], lastSeenTurn: 0, lastCommit: null },
      Greece: { leader: "Alexander", treasury: 120, happiness: 7, research: "Mining", posture: "expand", cities: ["Athens", "Sparta"], wars: [], lastSeenTurn: 0, lastCommit: null },
    },
    events: [{ turn: 1, text: "Rome and Greece become aware of each other across a narrow sea." }],
    inbox: { Rome: [], Greece: [] },
    moved: { Rome: false, Greece: false },
    log: [],
  };
}

export function loadWorld(rundir) {
  const f = path.join(rundir, "world.json");
  if (!fs.existsSync(f)) {
    fs.mkdirSync(rundir, { recursive: true });
    const w = freshWorld();
    fs.writeFileSync(f, JSON.stringify(w, null, 2));
    return w;
  }
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

export function saveWorld(rundir, w) {
  fs.writeFileSync(path.join(rundir, "world.json"), JSON.stringify(w, null, 2));
}

export function opponentOf(civ) {
  return CIVS.find((c) => c !== civ);
}

export function queueMessage(w, from, to, text) {
  if (!w.civs[to] || typeof text !== "string" || !text.trim()) return false;
  w.inbox[to].push({ from, turn: w.turn, text: text.trim(), seen: false });
  w.log.push(`turn ${w.turn}: ${from} -> ${to}: "${text.trim().slice(0, 80)}"`);
  return true;
}

function applyActionEffects(w, civ, actions) {
  const s = w.civs[civ];
  for (const a of actions ?? []) {
    if (!a || typeof a.type !== "string") continue;
    const p = a.params ?? {};
    if (a.type === "research" && (p.tech || p.name || p.value)) s.research = p.tech ?? p.name ?? p.value;
    if (a.type === "posture" && (p.posture || p.name || p.value)) s.posture = p.posture ?? p.name ?? p.value;
    if (a.type === "message" && p.target && p.message) queueMessage(w, civ, p.target, p.message);
  }
}

export function recordCommit(w, civ, commit) {
  const actions = commit?.actions ?? [];
  w.civs[civ].lastCommit = { actions, rationale: commit?.rationale ?? commit?.reason ?? "", at: commit?.committedAt ?? commit?.at ?? new Date().toISOString(), by: commit?.by ?? "harness" };
  applyActionEffects(w, civ, actions);
  w.civs[civ].lastSeenTurn = w.turn;
  for (const m of w.inbox[civ]) m.seen = true;
  w.moved[civ] = true;
  w.log.push(`turn ${w.turn}: ${civ} committed (${actions.map((a) => a.type).join(",") || "pass"})`);
}

// Barrier: when both civs moved, tick the world forward. Returns true if advanced.
export function maybeAdvance(w) {
  if (!CIVS.every((c) => w.moved[c])) return false;
  w.turn += 1;
  for (const c of CIVS) {
    w.civs[c].treasury += 7;
    w.moved[c] = false;
  }
  for (const text of SCRIPTED[w.turn] ?? []) w.events.push({ turn: w.turn, text });
  w.events.push({ turn: w.turn, text: `Routine turn ${w.turn}: trade income +7 gold.` });
  w.log.push(`advanced to turn ${w.turn}`);
  return true;
}

export function nextUp(w) {
  return CIVS.find((c) => !w.moved[c]) ?? null;
}

export function buildPlayerObservation(civ, w) {
  const me = w.civs[civ];
  const foeName = opponentOf(civ);
  const foe = w.civs[foeName];
  const news = w.events.filter((e) => e.turn > me.lastSeenTurn && e.turn <= w.turn);
  const mail = w.inbox[civ].filter((m) => !m.seen);
  const out = [];
  out.push(`You are ${me.leader}, leader of ${civ}. You are playing Civilization V against ${foe.leader} of ${foeName}, played by another mind. Advance your civilization's interests and try to win. Your prior conversations, decisions, promises, threats, and political behavior are your own history. Continue coherently from them.`);
  out.push(`\nTURN ${w.turn}\n\nYour civilization:\n- Treasury: ${me.treasury}\n- Happiness: ${me.happiness}\n- Research: ${me.research}\n- Posture: ${me.posture}\n- Cities: ${me.cities.join(", ")}\n- Wars: ${me.wars.length ? me.wars.join(", ") : "none"}`);
  out.push(`\nRival visible: ${foeName} treasury ~${Math.round(foe.treasury / 10) * 10}, posture ${foe.posture}, ${foe.cities.length} cities.`);
  if (news.length) out.push(`\nSince you last looked:\n${news.map((e) => `- (turn ${e.turn}) ${e.text}`).join("\n")}`);
  if (mail.length) out.push(`\nMessages for you:\n${mail.map((m) => `- From ${m.from} (turn ${m.turn}): "${m.text}"`).join("\n")}`);
  out.push(`\nYou may inspect anything else you need (inspect). When finished, commit your actions (commit_turn) or pass. One short diplomatic message per turn at most (communicate, or a message action in your commit).`);
  return out.join("\n");
}
