/**
 * @module envoy/pass-diplomacy-tool
 *
 * A non-spoken, non-closing terminal action for unified diplomacy wakes.
 */

import { z } from "zod";
import type { StrategistParameters } from "../../strategist/strategy-parameters.js";
import { createSimpleTool } from "../../utils/tools/simple-tools.js";
import type { VoxContext } from "../../infra/vox-context.js";

type DiplomacyPassInput = Record<string, never>;

/** Create the explicit no-op action used when a unified mind has nothing useful to say. */
export function createPassDiplomacyTool(
  context: VoxContext<StrategistParameters>,
): ReturnType<typeof createSimpleTool<StrategistParameters, DiplomacyPassInput, string>> {
  return createSimpleTool<StrategistParameters, DiplomacyPassInput, string>({
    name: "pass-diplomacy",
    description: "Take no diplomatic action for this wake. Do not speak and do not close the conversation.",
    inputSchema: z.object({}) as z.ZodType<DiplomacyPassInput>,
    execute: async () => "No diplomatic action taken.",
  }, context);
}
