/** Regression tests for the additive unified civilization mind seam. */

import { describe, expect, it } from "vitest";
import { agentRegistry } from "../../../src/infra/agent-registry.js";
import {
  buildUnifiedMindIdentity,
  diplomacyAgentForPlayer,
  getUnifiedMindModel,
  isUnifiedMindPlayer,
  strategicAgentForPlayer,
} from "../../../src/strategist/unified-civilization-mind.js";
import type { PlayerConfig } from "../../../src/types/config.js";
import type { EnvoyThread } from "../../../src/types/index.js";
import type { StrategistParameters } from "../../../src/strategist/strategy-parameters.js";

const unifiedPlayer: PlayerConfig = {
  strategist: "simple-strategist",
  mind: "unified-mind",
  llms: {
    "unified-mind": { provider: "openrouter", name: "minimax/minimax-m3:free" },
  },
};

const parameters = {
  playerID: 2,
  gameID: "unified-test",
  turn: 7,
  after: 0,
  before: 0,
  mode: "Flavor",
  workingMemory: {},
  gameStates: {},
  metadata: { YouAre: { Name: "Rome", Leader: "Caesar" } },
  reports: {},
} as unknown as StrategistParameters;

const thread: EnvoyThread = {
  id: "dipl:unified-test:1:2",
  agent: 2,
  gameID: "unified-test",
  player1ID: 1,
  player2ID: 2,
  player1Role: "the leader",
  player2Role: "unified-mind-diplomat",
  player1Identity: { name: "Greece", leader: "Pericles" },
  player2Identity: { name: "Rome", leader: "Caesar" },
  diplomacy: true,
  contextType: "live",
  contextId: "unified-test-player-2",
  messages: [],
};

describe("unified civilization mind", () => {
  it("uses one seat-level model and two thin wake adapters", () => {
    expect(isUnifiedMindPlayer(unifiedPlayer)).toBe(true);
    expect(strategicAgentForPlayer(unifiedPlayer)).toBe("unified-mind-strategist");
    expect(diplomacyAgentForPlayer(unifiedPlayer)).toBe("unified-mind-diplomat");

    const strategist = agentRegistry.get("unified-mind-strategist")!;
    const diplomat = agentRegistry.get("unified-mind-diplomat")!;
    const strategicModel = strategist.getModel(parameters, undefined, unifiedPlayer.llms!);
    const socialModel = diplomat.getModel(parameters, thread, unifiedPlayer.llms!);

    expect(strategicModel.provider).toBe("openrouter");
    expect(strategicModel.name).toBe("minimax/minimax-m3:free");
    expect(socialModel).toEqual(strategicModel);
  });

  it("keeps the same civilization identity across strategic and social wakes", async () => {
    const strategist = agentRegistry.get("unified-mind-strategist")!;
    const diplomat = agentRegistry.get("unified-mind-diplomat")!;
    const strategicSystem = await strategist.getSystem(parameters, {} as never);
    const socialSystem = await diplomat.getSystem(parameters, thread, {} as never);

    expect(strategicSystem).toContain("governing mind of Rome, led by Caesar");
    expect(socialSystem).toContain("governing mind of Rome, led by Caesar");
    expect(strategicSystem).toContain("strategic wake");
    expect(socialSystem).toContain("diplomacy wake");
    expect(socialSystem).not.toContain("You are a diplomat serving your civilization");
  });

  it("keeps the identity helper provider-independent and explicit", () => {
    const identity = buildUnifiedMindIdentity(parameters, "strategic");
    const model = getUnifiedMindModel(unifiedPlayer.llms!, "default");

    expect(identity).toContain("Rome");
    expect(identity).toContain("Caesar");
    expect(model.provider).toBe("openrouter");
  });
});
