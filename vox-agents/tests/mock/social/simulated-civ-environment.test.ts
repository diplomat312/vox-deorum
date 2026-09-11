// Covers the generated world attached to a social session.
//
// The point of the environment is that a seat is told about the game and can act
// in it, so these tests are about the briefing a seat reads and the orders that
// change the world. Nothing here starts a process or a model.

import { describe, expect, it } from "vitest";
import { SimulatedCivEnvironment } from "../../../src/social/environments/simulated/simulated-civ-environment.js";
import type { SocialActor } from "../../../src/social/types.js";

// One seat, as the sandbox describes it.
function actor(id: string, ordinal: number, displayName: string): SocialActor {
  return {
    id,
    ordinal,
    control: "model",
    displayName,
    sessionId: "session-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "active"
  };
}

// The four seats the recorded game used.
const seats = ["korea", "austria", "siam", "iroquois"];
const korea = actor("korea", 1, "Sejong of Korea");
const austria = actor("austria", 2, "Maria Theresa of Austria");

// A world with no timer, so a test drives it itself.
async function world(options: { script?: Array<{ turn: number; order: string; seat: string; args: Record<string, unknown> }> } = {}) {
  const woken: Array<{ seat: string; reason: string }> = [];
  const environment = await SimulatedCivEnvironment.start({
    seats,
    seed: 11,
    game: "sim-test",
    // Long enough that only an explicit tick moves the world.
    tickMs: 3_600_000,
    enqueue: async (seat, reason) => {
      woken.push({ seat, reason });
    },
    ...(options.script === undefined ? {} : { script: options.script })
  });
  return { environment, woken };
}

describe("a generated world under a session", () => {
  it("should wake the model seats once the game begins", async () => {
    const { environment, woken } = await world();

    await environment.open();

    // Four seats at the table, and the opening is what gives every seat its first
    // look at the game.
    expect(woken.map((entry) => entry.seat).sort()).toEqual([...seats].sort());
    expect(woken[0].reason).toContain("game has begun");
    await environment.close();
  });

  it("should never wake a seat a person is playing", async () => {
    const woken: string[] = [];
    const environment = await SimulatedCivEnvironment.start({
      seats,
      seed: 11,
      game: "sim-test",
      humanActorId: "korea",
      tickMs: 3_600_000,
      enqueue: async (seat) => {
        woken.push(seat);
      }
    });

    await environment.open();

    expect(woken).not.toContain("korea");
    expect(woken).toHaveLength(3);
    await environment.close();
  });

  it("should introduce a seat to itself and to the table", async () => {
    const { environment } = await world();

    const briefing = await environment.contextForActor(korea);

    expect(briefing).toContain("You are Korea.");
    expect(briefing).toContain("Your position:");
    expect(briefing).toContain("Treasury");
    expect(briefing).toContain("The table:");
    // A seat is told who borders it, because a border is what makes an army in
    // one place mean something rather than nothing.
    expect(briefing).toContain("border you");
    expect(briefing).toContain("Austria");
    await environment.close();
  });

  it("should say plainly when nothing has happened", async () => {
    const { environment } = await world();

    // The first look carries the opening of the game. The second carries nothing,
    // which is the state a seat reads most turns and the one worth naming.
    await environment.contextForActor(korea);
    const briefing = await environment.contextForActor(korea);

    expect(briefing).toContain("Since you last looked:");
    expect(briefing).toContain("Nothing new recorded");
    await environment.close();
  });

  it("should tell a seat that a neighbour has massed on its border", async () => {
    const { environment, woken } = await world({
      // The experiment this environment exists for, expressed as a turn and an
      // order rather than as a hope.
      script: [{ turn: 2, order: "mass_troops", seat: "austria", args: { facing: "korea", committed: 0.8 } }]
    });

    await environment.tick();
    const briefing = await environment.contextForActor(korea);

    // The number is an estimate rather than the truth, and the intent behind the
    // build-up is not reported at all, because the game does not show it.
    expect(briefing).toContain("massed on YOUR border");
    expect(briefing).toContain("has been there 1 turn");
    // Korea hears about it, which is what wakes a seat to do something about it.
    expect(woken.some((entry) => entry.seat === "korea" && entry.reason.includes("massing"))).toBe(true);
    await environment.close();
  });

  it("should not tell a seat about an army that is not on its border", async () => {
    const { environment } = await world({
      // Austria sits between Korea and Siam, so an army facing Siam is a fact
      // Korea gets only as something it cannot explain.
      script: [{ turn: 2, order: "mass_troops", seat: "austria", args: { facing: "siam", committed: 0.8 } }]
    });

    await environment.tick();
    const briefing = await environment.contextForActor(korea);

    expect(briefing).not.toContain("massed on YOUR border");
    expect(briefing).toContain("away from home");
    await environment.close();
  });

  it("should offer a seat the game's own knobs and a free read", async () => {
    const { environment } = await world();

    const definitions = await environment.decisionDefinitionsForActor(korea);
    const names = definitions.map((definition) => definition.name);

    // One action per turn, chosen from the high-level knobs the game already has.
    expect(names).toContain("environment_mass_troops");
    expect(names).toContain("environment_declare_war");
    expect(names).toContain("environment_attack");
    expect(names).toContain("environment_make_peace");
    expect(names).toContain("environment_set_research");
    expect(names).toContain("environment_set_posture");
    // A read costs nothing, so it is marked as support rather than as an action.
    expect(definitions.find((definition) => definition.name === "environment_inspect")?.phase).toBe("support");
    await environment.close();
  });

  it("should let a seat move its own army and act in the game", async () => {
    const { environment } = await world();

    const state = await environment.execute(korea, 1, "mass_troops", { facing: "austria", committed: 0.5 }, "op-1");

    expect(state.state).toContain("facing Austria");
    await environment.close();
  });

  it("should refuse an order the game does not allow, and say why", async () => {
    const { environment } = await world();

    // A war with a seat that is not on the border is not a thing the game does.
    await expect(environment.execute(korea, 1, "declare_war", { target: "siam" }, "op-1")).rejects.toThrowError(
      /does not border/
    );
    // An action the world has never heard of is refused the same way.
    await expect(environment.execute(korea, 1, "environment_teleport", {}, "op-2")).rejects.toThrowError(/no action called/);
    await environment.close();
  });

  it("should answer a free read without moving the world", async () => {
    const { environment } = await world();
    await environment.execute(austria, 1, "mass_troops", { facing: "korea", committed: 1 }, "op-1");

    const answer = await environment.read(korea, 1, "inspect", { subject: "army" }, "read-1");

    expect(answer).toContain("Austria");
    expect(answer).toContain("massed on your border");
    // A read is not an action, so the same read answers the same way twice.
    expect(await environment.read(korea, 1, "inspect", { subject: "army" }, "read-2")).toBe(answer);
    await environment.close();
  });

  it("should advance the world one turn at a time and record what happened", async () => {
    const { environment } = await world();

    await environment.tick();
    const briefing = await environment.contextForActor(korea);

    expect(briefing).toContain("It is turn 2 of the game");
    await environment.close();
  });

  it("should wait for the table before moving the world on", async () => {
    // A turn is a turn-based game turn, so it waits for the players. The world
    // asks whether the table is busy rather than assuming a wall clock.
    const order: string[] = [];
    const environment = await SimulatedCivEnvironment.start({
      seats,
      seed: 11,
      game: "sim-test",
      tickMs: 20,
      enqueue: async () => undefined,
      waitForIdle: async () => {
        order.push("waited");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });

    await environment.open();
    await new Promise((resolve) => setTimeout(resolve, 120));

    // The table was asked before every turn the world took, and the world moved
    // more than once, which is what makes a run bounded by the models rather than
    // by a timer.
    expect(order.length).toBeGreaterThan(1);
    expect(order.every((entry) => entry === "waited")).toBe(true);
    await environment.close();
  });

  it("should stop moving the world once it is closed", async () => {
    const { environment } = await world();

    await environment.close();
    await environment.tick();
    const briefing = await environment.contextForActor(korea);

    // A world that kept ticking after its session stopped would be a game nobody
    // is watching.
    expect(briefing).toContain("It is turn 1 of the game");
    await environment.close();
  });
});
