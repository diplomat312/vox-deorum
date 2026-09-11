// What tools a seat's session actually offers it.
//
// A seat's game tools arrive as an MCP server of its own, and nothing in a run
// said whether that server was there. A seat whose tool server never started
// answers the observation, never reaches for a tool, and is recorded as a seat
// that chose to say nothing, which is the same shape a dropped request leaves.
// The session is asked instead, and its answer is the difference between a seat
// that stayed quiet and a seat that had nothing to reach for.

// The name a seat's own game tools are served under.
export const seatToolServer = "vox-civ";

// Why a seat cannot play, or null when it can.
//
// Only the absence of the game tools is fatal. Other servers being present is a
// fact about the machine rather than about the seat, so it is reported by the
// caller rather than refused here.
export function surfaceProblem(statuses: Record<string, string>): string | null {
  const status = statuses[seatToolServer];
  if (status === undefined) {
    return "the seat's session does not list its game tool server at all, so it would play with no tools";
  }
  if (status !== "connected") {
    return "the seat's game tool server is " + status + " rather than connected, so it would play with no tools";
  }
  return null;
}

// The servers a seat's session can actually reach besides its own, which are the
// ones a seat has no business using.
//
// A session inherits whatever the machine's own OpenCode configuration offers,
// and the harness writes a config that switches them off. A switched-off server
// is still listed, so counting the listing rather than the status would warn
// about every seat that is correctly confined, and a warning that always fires
// is a warning nobody reads.
export function inheritedServers(statuses: Record<string, string>): string[] {
  return Object.entries(statuses)
    .filter(([name, status]) => name !== seatToolServer && status !== "disabled")
    .map(([name]) => name);
}
