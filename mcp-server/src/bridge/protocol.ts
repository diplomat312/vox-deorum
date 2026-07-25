import * as z from "zod";

/** Delimiter framing event-pipe messages between the bridge service and MCP server. */
export const eventPipeDelimiter = "!@#$%^!";

/**
 * Response shape of Bridge Service Lua calls. The single source of truth for both the
 * `LuaResponse` type used by BridgeManager and the output schema of tools that expose
 * Lua calls verbatim (call-lua-function).
 *
 * Loose on purpose. A reply reaches us as a whole transport frame — the DLL's
 * `lua_response` carries `type` and `id` beside the payload, and the bridge settles that
 * frame verbatim — so a closed object here would forbid exactly the keys every real reply
 * arrives with. That matters most where this doubles as a tool's output schema: the MCP
 * SDK validates structured output against it, and a rejection lands *after* the Lua call
 * has already run in the game, which is precisely the failure a retry re-executes rather
 * than repairs. Tolerate the framing here; tools publishing this shape strip it at their
 * own boundary so the extra keys never reach a caller.
 */
export const LuaResponseSchema = z.looseObject({
  success: z.boolean(),
  result: z.any().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional(),
  }).optional(),
});
