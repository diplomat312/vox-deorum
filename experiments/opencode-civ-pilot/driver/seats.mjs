// Single seat resolver for the whole pilot (brief item: shared seat
// resolution everywhere). Seats are the stable identity across drivers,
// servers, observers, and tests: numeric seat ids that survive civ-name
// assignment at game boot. Civ and leader names fill in once the game
// assigns them; playerID defaults to seat until the live mapping lands.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Seats file location: explicit env wins, else live/social-seats.json next
// to this driver directory, so mock and live backends resolve identically.
export function seatsFile() {
  const f = process.env.CIV_PILOT_SEATS_FILE;
  if (f) return path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
  return path.join(here, "..", "live", "social-seats.json");
}

// Load seat rows, tolerating a missing file (offline single-seat drills).
export function loadSeats() {
  try {
    const rows = JSON.parse(fs.readFileSync(seatsFile(), "utf8"));
    if (Array.isArray(rows)) return rows;
  } catch {}
  return [];
}

// Numeric seat id when v names a known seat, else null. Strings match civ
// or leader names case-insensitively; unknown names stay unknown (Vox
// validates game-side ids, the driver never invents them).
export function resolveSeat(v, seats) {
  const rows = seats ?? loadSeats();
  if (typeof v === "number" && Number.isInteger(v)) {
    return rows.some((r) => Number(r.seat) === v) ? v : null;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const w = v.trim().toLowerCase();
    const n = Number(w);
    if (w !== "" && Number.isInteger(n) && rows.some((r) => Number(r.seat) === n)) return n;
    const hit = rows.find((r) => String(r.civ ?? "").toLowerCase() === w || String(r.leader ?? "").toLowerCase() === w);
    if (hit) return Number(hit.seat);
  }
  return null;
}

// All seats except mine, in seat order: the N-peer loop for transcripts,
// deal threads, and fan-out.
export function peerSeats(mine, seats) {
  const rows = seats ?? loadSeats();
  return rows.map((r) => Number(r.seat)).filter((n) => Number.isInteger(n) && n !== mine).sort((a, b) => a - b);
}

// Display name for a seat: civ and leader when assigned, else Seat N.
export function seatName(seat, seats) {
  const rows = seats ?? loadSeats();
  const hit = rows.find((r) => Number(r.seat) === Number(seat));
  if (hit && hit.civ && hit.civ !== "TBD") return hit.leader && hit.leader !== "TBD" ? hit.civ + " (" + hit.leader + ")" : hit.civ;
  return "Seat " + seat;
}

// Vox player id for a seat. Seats are the stable harness identity; player ids
// are assigned by the game at boot and recorded on the seat row. Until the
// live mapping lands they coincide (duel: seat N is player N).
export function seatPlayer(seat, seats) {
  const rows = seats ?? loadSeats();
  const hit = rows.find((r) => Number(r.seat) === Number(seat));
  if (hit && Number.isInteger(Number(hit.playerID))) return Number(hit.playerID);
  return Number(seat);
}
