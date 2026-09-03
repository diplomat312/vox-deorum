// Pluggable game-state backend. MockBackend runs without Civ V (for the
// cognition/cache experiment). LiveVoxBackend is the seam where the real
// Vox MCP reads/writes plug in — authority stays in Vox, never here.
export class MockBackend {
  constructor(seed = 42) { this.seed = seed; }
  stateFor(turn) {
    const t = turn;
    return {
      self: { civ: "Rome", leader: "Augustus Caesar", playerID: 0, turn: t },
      treasury: 120 + t * 7, happiness: 6 - (t % 3 === 0 ? 2 : 0),
      research: t < 8 ? "Machinery" : t < 15 ? "Education" : "Astronomy",
      wars: [], posture: t < 10 ? "consolidate" : "prepare-expansion",
      cities: ["Rome", "Antium"],
      events: this.eventsFor(t),
    };
  }
  eventsFor(t) {
    const scripted = {
      2: ["Greece founded Sparta near Antium."],
      3: ["Germany denounced Greece."],
      5: ["Machinery completed."],
      6: ["Egypt requested Open Borders."],
      9: ["Barbarian encampment spotted near Antium."],
      12: ["Greece adopted Liberty."],
      14: ["Egypt completed the Pyramids."],
      17: ["German scouts seen near your borders."],
    };
    return scripted[t] ?? [`Routine turn ${t}: trade income +${4 + (t % 5)} gold.`];
  }
}

// Live backend seam (Phase 4 / live game). Wire these to the existing Vox
// MCP tools (get-players, get-cities, get-events, get-options,
// get-victory-progress, get-military-report) and commit via set-strategy /
// set-research / set-policy / set-relationship / set-production-mode /
// keep-status-quo + deal tools. NOT implemented in the first experiment —
// it throws so nobody mistakes mock numbers for authoritative state.
export class LiveVoxBackend {
  constructor({ mcpUrl } = {}) { this.mcpUrl = mcpUrl; }
  stateFor() { throw new Error("LiveVoxBackend not wired yet — use MockBackend for the cache experiment."); }
  eventsFor() { throw new Error("LiveVoxBackend not wired yet — use MockBackend for the cache experiment."); }
}
