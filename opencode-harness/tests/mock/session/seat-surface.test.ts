// Covers what a seat's session says it has, which is how a seat that never
// reached for a tool is told apart from a seat that had nothing to reach for.

import { describe, expect, it } from "vitest";
import { inheritedServers, seatToolServer, surfaceProblem } from "../../../src/session/seat-surface.js";

describe("a seat's tool surface", () => {
  it("should pass when the seat has its own tools", () => {
    expect(surfaceProblem({ "vox-civ": "connected" })).toBeNull();
  });

  it("should refuse a session that does not list the seat's tools at all", () => {
    // This is the shape a wrong tool-server path leaves: the session is healthy,
    // the model answers, and there is nothing for it to call.
    const problem = surfaceProblem({ "google-workspace": "connected" });

    expect(problem).toContain("does not list its game tool server");
  });

  it("should refuse a server that is there but not connected", () => {
    expect(surfaceProblem({ "vox-civ": "failed" })).toContain("failed");
    expect(surfaceProblem({ "vox-civ": "disabled" })).toContain("disabled");
  });

  it("should name the servers a seat has no business using", () => {
    const statuses = { "vox-civ": "connected", "google-workspace": "connected" };

    expect(inheritedServers(statuses)).toEqual(["google-workspace"]);
    expect(inheritedServers({ "vox-civ": "connected" })).toEqual([]);
  });

  it("should not warn about a server that is switched off", () => {
    // A disabled server is still listed by the session, so counting the listing
    // rather than the status would warn about every correctly confined seat.
    const statuses = { "vox-civ": "connected", "google-workspace": "disabled" };

    expect(inheritedServers(statuses)).toEqual([]);
  });

  it("should look for the one name the seat's tools are served under", () => {
    expect(seatToolServer).toBe("vox-civ");
  });
});
