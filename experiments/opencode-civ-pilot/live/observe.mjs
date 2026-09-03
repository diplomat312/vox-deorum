// Shared observation builder for the live Vox Deorum AI duel.
// Used by BOTH seats so the Codex-played civ and the OpenCode-harness civ
// always see the same dashboard shape:
//   run-live-turn.mjs (seat 1, Siam, persistent OpenCode session) and
//   observe-seat.mjs  (seat 0, Portugal, Codex-driven) build their
//   per-turn observation through buildObservation() here.
// Game-state authority stays in Vox; this module only reads via MCP.
import { callLive, liveText } from "./live-mcp.mjs";

function fmtUnits(units) {
  const parts = [];
  for (const [owner, byType] of Object.entries(units ?? {})) {
    const mix = Object.entries(byType ?? {})
      .map(([type, n]) => `${n}x${type}`)
      .join(" ");
    if (mix) parts.push(`${owner} ${mix}`);
  }
  return parts.join(", ") || "no units listed";
}

// One stable line per military zone, original backend order.
// Skips the static "Unit Stats" block (available via inspect(military)).
function condenseZones(report) {
  const lines = [];
  for (const [name, z] of Object.entries(report ?? {})) {
    if (name === "Unit Stats" || !z || typeof z !== "object") continue;
    const kind = name.includes("Sea") ? "Sea" : "Land";
    const city = z.City ? ` @${z.City}` : "";
    const str = [
      z.FriendlyStrength !== undefined ? `F${z.FriendlyStrength}` : null,
      z.EnemyStrength !== undefined ? `E${z.EnemyStrength}` : null,
      z.NeutralStrength !== undefined ? `N${z.NeutralStrength}` : null,
    ]
      .filter(Boolean)
      .join("/");
    lines.push(
      `- ${kind}${city}: ${z.Dominance ?? "?"}${
        str ? ` (${str})` : ""
      } — ${fmtUnits(z.Units)}`.slice(0, 220)
    );
  }
  return lines;
}

function cityLine(name, c) {
  const prod = c.CurrentProduction
    ? ` -> ${c.CurrentProduction} (${c.ProductionTurnsLeft ?? "?"}t left)`
    : "";
  return `${name} p${c.Population ?? "?"}${prod}`;
}

export async function buildObservation({
  playerID,
  civ,
  leader,
  seat,
  rivalID,
  rivalCiv,
  rivalLeader,
  rivalSeat,
  turn,
  game,
  lastSeenTurn = 0,
  lastApplied = [],
}) {
  const players = liveText(
    await callLive("get-players", { playerIDs: [playerID, rivalID] })
  );
  const me = players[String(playerID)] ?? {};
  const rival = players[String(rivalID)] ?? {};
  const rel = me.Relationships ?? {};
  const relLine =
    Object.entries(rel)
      .map(([k, v]) => `${k}: ${(v ?? []).join("; ")}`)
      .join(" | ") || "none recorded";

  let events = [];
  try {
    const ev = liveText(await callLive("get-events", { PlayerID: playerID }));
    const arr = Array.isArray(ev) ? ev : ev?.events ?? [];
    events = arr.filter((e) => (e?.Turn ?? 0) > lastSeenTurn).slice(-10);
    if (!events.length && Array.isArray(arr)) {
      events = arr
        .slice(-4)
        .map((e) => ({ ...e, _note: "recent context, not necessarily new" }));
    }
  } catch (e) {
    events = [{ _note: `event fetch failed: ${e.message}` }];
  }
  const eventLines = events.map((e) => `- ${JSON.stringify(e).slice(0, 220)}`);

  // Political diary + correspondence deltas. Quiet turns render stable
  // "- Nothing new." lines so the provider prefix stays cache-friendly.
  const speakerName = (id) => {
    if (id === playerID) return `${civ} (you)`;
    if (id === rivalID) return `${rivalCiv} (${rivalLeader})`;
    if (id === -1) return "Observer";
    return `Player ${id}`;
  };
  let politicsLines = [];
  try {
    const dip = liveText(
      await callLive("get-diplomatic-events", {
        PlayerID: playerID,
        Formatted: true,
        FromTurn: lastSeenTurn + 1,
      })
    );
    for (const [t, entries] of Object.entries(dip ?? {})) {
      for (const e of entries ?? []) {
        politicsLines.push(`- T${t}: ${String(e).slice(0, 200)}`);
      }
    }
    politicsLines = politicsLines.slice(-8);
  } catch {
    /* politics optional; dashboard still usable */
  }
  let messageLines = [];
  try {
    const gm = liveText(await callLive("get-global-messages", { Limit: 10 }));
    const fresh = (gm?.messages ?? []).filter(
      (m) => (m?.Turn ?? 0) > lastSeenTurn && m?.SpeakerID !== playerID
    );
    for (const m of fresh.slice(-3)) {
      messageLines.push(
        `- [WORLD] T${m.Turn} ${speakerName(m.SpeakerID)}: ${String(
          m.Content
        ).slice(0, 220)}`
      );
    }
  } catch {
    /* world channel optional */
  }
  try {
    const tr = liveText(
      await callLive("read-transcript", {
        PlayerAID: Math.min(playerID, rivalID),
        PlayerBID: Math.max(playerID, rivalID),
        MessageType: "text",
        Limit: 10,
      })
    );
    const rows = Array.isArray(tr) ? tr : tr?.messages ?? tr?.rows ?? [];
    const get = (r, ...keys) => {
      for (const k of keys) if (r?.[k] !== undefined) return r[k];
      return undefined;
    };
    const fresh = rows.filter(
      (r) => (get(r, "Turn", "turn") ?? 0) > lastSeenTurn
    );
    for (const r of fresh.slice(-3)) {
      const sid = get(r, "SpeakerID", "speaker", "speakerID");
      if (sid === playerID) continue; // own sends; the other side's words matter
      messageLines.push(
        `- [PRIVATE] T${get(r, "Turn", "turn")} ${speakerName(sid)}: ${String(
          get(r, "Content", "content", "text", "message") ?? ""
        ).slice(0, 220)}`
      );
    }
  } catch {
    /* private thread optional */
  }

  const appliedLines = (lastApplied ?? []).map((a) => {
    if (a.ok) return `- ${a.type} applied.`;
    return `- ${a.type} NOT applied: ${(a.note ?? a.out ?? "rejected")
      .toString()
      .slice(0, 200)}`;
  });

  // Exact names Vox accepts (research/policy actions validate). Cheap to
  // inline so the mind picks a legal name without an extra inspect round-trip.
  let techNames = [],
    policyNames = [];
  try {
    const opt = liveText(await callLive("get-options", { PlayerID: playerID }));
    techNames = Object.keys(opt?.Options?.Technologies ?? {});
    policyNames = Object.keys(opt?.Options?.Policies ?? {});
  } catch {
    /* observation still usable without them */
  }

  // Condensed military zones: the front line at a glance. Full report with
  // unit stats stays one inspect(military) away.
  let zoneLines = [];
  try {
    const rep = liveText(
      await callLive("get-military-report", { PlayerID: playerID })
    );
    zoneLines = condenseZones(rep);
  } catch (e) {
    zoneLines = [`- zones unavailable: ${e.message}`.slice(0, 160)];
  }

  // One line per owned city: what it is building and when it finishes.
  let cityLines = [];
  try {
    const all = liveText(await callLive("get-cities", { PlayerID: playerID }));
    const mine =
      all?.[civ] ??
      Object.values(all ?? {})[0] ??
      {};
    cityLines = Object.entries(mine).map(([n, c]) => `- ${cityLine(n, c)}`);
  } catch {
    /* dashboard still usable without city detail */
  }

  return `TURN ${turn} (live game ${players.gameID ?? game})

You are ${leader}, leader of ${civ} (seat ${seat}). ${rivalCiv} (${rivalLeader}, seat ${rivalSeat}) is played by another mind.

Current:
* Treasury: ${me.Gold} (+${me.GoldPerTurn}/turn). Happiness: ${me.HappinessSituation} (${me.HappinessPercentage}%). Research: ${me.CurrentResearch}. Research must name ONE exact technology from: ${techNames.join(", ") || "unknown, inspect research"}. Next policy in ${me.NextPolicyTurns} turns (${JSON.stringify(me.PolicyBranches)}). Policy must name ONE exact entry from: ${policyNames.join("; ") || "unknown, inspect policies"}.
* Cities (${me.Cities}): population ${me.Population}, territory ${me.Territory}, military strength ${me.MilitaryStrength}, units ${me.MilitaryUnits ?? "?"} (supply ${me.MilitarySupply ?? "?"}), score ${me.Score}.
${cityLines.length ? cityLines.join("\n") : "- city builds unknown."}
* Zones:
${zoneLines.length ? zoneLines.join("\n") : "- no zone data."}
* Relationships: ${relLine}.
* ${rivalCiv} visible: score ${rival.Score}, treasury ~${rival.Gold}, research ${rival.CurrentResearch}, ${rival.Cities} cities, military ${rival.MilitaryStrength}.

Since your previous opportunity to act:
${eventLines.length ? eventLines.join("\n") : "- Nothing new recorded."}

What happened to your last committed actions:
${appliedLines.length ? appliedLines.join("\n") : "- First live turn; nothing committed yet."}

Politics since your last opportunity (war/peace, city-states, deals):
${politicsLines.length ? politicsLines.join("\n") : "- Nothing new recorded."}

Messages for you (reply with communicate if warranted, at most one message per turn):
${messageLines.length ? messageLines.join("\n") : "- None."}

Outstanding deals: deal inspection arrives in a later phase; treat proposals in messages as talk, not commitments.

You may inspect anything else you need (inspect). When finished, commit your actions (commit_turn) or pass. Keep the rationale short.`;
}
