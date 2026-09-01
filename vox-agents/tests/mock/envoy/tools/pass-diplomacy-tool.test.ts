/** Regression coverage for the explicit non-spoken diplomacy pass action. */

import { describe, expect, it, vi } from "vitest";
import { createPassDiplomacyTool } from "../../../../src/envoy/tools/pass-diplomacy-tool.js";

describe("pass-diplomacy tool", () => {
  it("records an explicit pass outcome without writing speech", async () => {
    const setMindOutcome = vi.fn();
    const tool = createPassDiplomacyTool({ setMindOutcome } as never) as any;

    await expect(tool.execute({}, { toolCallId: "pass-1", messages: [] }))
      .resolves.toBe("No diplomatic action taken.");
    expect(setMindOutcome).toHaveBeenCalledWith("pass");
  });
});
