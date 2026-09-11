// What tools a seat's session actually offers it.
//
// A seat's game tools arrive as an MCP server of its own, and nothing in a run
// said whether that server was there. A seat whose tool server never started
// answers the observation, never reaches for a tool, and is recorded as a seat
// that chose to say nothing, which is the same shape a dropped request leaves.
// The session is asked instead, and its answer is the difference between a seat
// that stayed quiet and a seat that had nothing to reach for.

import { existsSync } from "node:fs";
import path from "node:path";

// The name a seat's own game tools are served under.
export const seatToolServer = "vox-civ";

// The name of the agent a seat's turns are played under.
//
// A session inherits the machine's own OpenCode plugins, and a project
// configuration can disable an inherited server but not an inherited plugin, so
// a seat on the default agent is offered a browser and every built-in tool. An
// agent carries its own tool list, and naming one on each turn is what closes
// the rest: measured on this machine, the default agent offered twenty tools and
// a named seat agent offered exactly the four the game answers.
export const seatAgent = "seat";

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

// Why a seat cannot be confined, or null when it can.
//
// The seat's turns name an agent, and a name the server does not have would run
// every turn under the default agent instead, which is the state the agent
// exists to leave. Asking is cheap and the failure is silent otherwise.
export function agentProblem(names: string[]): string | null {
  if (names.includes(seatAgent)) return null;
  return (
    "the seat's session does not offer an agent named '" +
    seatAgent +
    "', so its turns would run under the default agent with everything the machine has installed behind them"
  );
}

// Whether a seat directory sits inside a repository, and which instruction files
// that would put in front of the seat.
//
// A seat's standing instructions are collected by walking up from its working
// directory, so a seat inside a repository is handed that repository's guidance.
// Measured on a real seat, two AGENTS.md files arrived this way and told a
// Civilization V diplomat how to write TypeScript. There is no setting that turns
// that off, so this checks the arrangement instead of trusting it, and it is a
// directory walk rather than a model call.
export function contextProblem(seatDirectory: string): string[] {
  const found: string[] = [];
  let here = path.resolve(seatDirectory);
  for (;;) {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const candidate = path.join(here, name);
      if (existsSync(candidate)) found.push(candidate);
    }
    // A repository root is where collected instructions stop, so the root itself
    // is examined and then the walk ends. Stopping before examining it would miss
    // the very file this exists to catch.
    if (existsSync(path.join(here, ".git"))) break;
    const above = path.dirname(here);
    if (above === here) break;
    here = above;
  }
  return found;
}
