import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { bridgeManager } from "../../server.js";
import { LuaResponseSchema } from "../../bridge/protocol.js";
import { assertExpectedGame } from "../../utils/expected-game.js";
import { ToolBase } from "../base.js";

/** Input accepted by the generic registered-Lua-function transport. */
const CallLuaFunctionInputSchema = z.object({
  Name: z.string().min(1).describe("Name of the Lua function registered by the game mod"),
  Args: z.array(z.any()).describe("Structured arguments passed to the registered Lua function"),
  ExpectedGameID: z.string().min(1).optional().describe("Optional game identity guard that rejects calls after the active game changes."),
});

/** Response returned by BridgeManager without transport-specific reinterpretation. */
const CallLuaFunctionOutputSchema = LuaResponseSchema;

/** Tool that invokes one function registered by a game-side Lua context. */
class CallLuaFunctionTool extends ToolBase {
  /** Stable MCP tool name. */
  readonly name = "call-lua-function";

  /** Human-readable tool description. */
  readonly description = "Call a game-registered Lua function through the Bridge Service with structured arguments.";

  /** Schema for the function name and its structured arguments. */
  readonly inputSchema = CallLuaFunctionInputSchema;

  /** Schema for the verbatim BridgeManager response. */
  readonly outputSchema = CallLuaFunctionOutputSchema;

  /** This tool may invoke game-side presentation code. */
  readonly annotations: ToolAnnotations = { readOnlyHint: false };

  /** Call BridgeManager and preserve its success, result, and error contract exactly. */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    assertExpectedGame(this.name, args.ExpectedGameID);
    const { success, result, error } = await bridgeManager.callLuaFunction(args.Name, args.Args);
    // Strip the transport frame here rather than passing the reply through. What
    // BridgeManager hands back is the DLL's whole `lua_response`, `type` and `id`
    // included, and this value is published as the tool's structured output — internal
    // wire framing has no business in a caller-facing contract.
    return { success, result, error };
  }
}

/** Create the generic registered-Lua-function transport tool. */
export default function createCallLuaFunctionTool(): CallLuaFunctionTool {
  return new CallLuaFunctionTool();
}
