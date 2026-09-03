// Shared communicate channel classifier (mock and live backends).
//
// Pure parsing and validation only: no Vox calls, no filesystem, no sends.
// Both MCP front doors parse the channel with classifyChannel, so the
// advertised channel set behaves identically on both backends. Transports
// (Vox broadcast and pair threads vs world-file log and inbox) stay
// backend-specific, but accept and reject decisions never diverge.
//
// Every communicate call counts as the turn send, including membership
// decisions with no visible message (decline). Backpressure budgets speech
// opportunities, not posted characters.
//
// Returns { kind, ch, seat?, id?, title? } or { kind: "invalid", ch, error }.
// Error strings are the user-facing validation messages, shared verbatim.
export function classifyChannel(raw, selfSeat) {
  const ch = String(raw ?? "private");
  if (ch.startsWith("dm:")) {
    const seat = Number(ch.slice("dm:".length).trim());
    if (!Number.isInteger(seat)) {
      return { kind: "invalid", ch, error: "dm channel needs a seat number, e.g. channel \'dm:0\'" };
    }
    if (seat === selfSeat) {
      return { kind: "invalid", ch, error: "cannot DM yourself; pick another seat" };
    }
    if (seat < 0 || seat > 63) {
      return { kind: "invalid", ch, error: "dm seat out of range" };
    }
    return { kind: "dm", ch, seat };
  }
  if (ch.startsWith("group:create:")) {
    const title = ch.slice("group:create:".length).trim().slice(0, 60);
    if (!title) {
      return { kind: "invalid", ch, error: "group:create needs a title, e.g. channel \'group:create:War Council\'" };
    }
    return { kind: "create", ch, title };
  }
  if (ch.startsWith("group:invite:")) {
    const rest = ch.slice("group:invite:".length).trim();
    const cut = rest.indexOf(":");
    const id = (cut >= 0 ? rest.slice(0, cut) : rest).trim();
    const seat = cut >= 0 ? Number(rest.slice(cut + 1).trim()) : NaN;
    if (!id) {
      return { kind: "invalid", ch, error: "group:invite needs an id and seat, e.g. channel \'group:invite:ab12cd34:0\'" };
    }
    if (!Number.isInteger(seat)) {
      return { kind: "invalid", ch, error: "group:invite needs a seat number, e.g. channel \'group:invite:ab12cd34:0\'" };
    }
    return { kind: "invite", ch, id, seat };
  }
  for (const [prefix, kind, label] of [
    ["group:accept:", "accept", "group:accept"],
    ["group:decline:", "decline", "group:decline"],
    ["group:leave:", "leave", "group:leave"],
    ["group:archive:", "archive", "group:archive"],
  ]) {
    if (ch.startsWith(prefix)) {
      const id = ch.slice(prefix.length).trim();
      if (!id) {
        return { kind: "invalid", ch, error: label + " needs an id, e.g. channel \'" + label + ":ab12cd34\'" };
      }
      return { kind, ch, id };
    }
  }
  if (ch.startsWith("group:")) {
    return { kind: "group", ch, id: ch.slice("group:".length).trim() };
  }
  if (ch === "world") return { kind: "world", ch };
  return { kind: "private", ch };
}
