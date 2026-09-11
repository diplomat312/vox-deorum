// Whether this sandbox thinks with OpenCode, and how to reach one if it does.
//
// The choice belongs to the runtime rather than to a route, because the thing
// that thinks is a property of the session. A session started with
// SOCIAL_OPENCODE set gets one persistent OpenCode session per model actor; a
// session started without it behaves exactly as it always has, which keeps the
// default path untouched.

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SocialActorDefinition } from "../types.js";
import type { SocialDecisionExecutor } from "./social-model-executor.js";
import { OpenCodeMindRunner, type OpenCodeMindRunnerOptions } from "./opencode-mind-runner.js";

/** The environment variable that asks a session to think with OpenCode. */
export const openCodeMindVariable = "SOCIAL_OPENCODE";

// The provider and model every actor runs on when none of them names one.
const defaultModelRef = "opencode-go/deepseek-v4.1-flash";

/**
 * Build the OpenCode mind for a session, or undefined when it did not ask for one.
 *
 * The model comes from the actors themselves, because an actor names its own and
 * the sandbox already treats that as the authoritative choice. The seat tool
 * server is resolved from this module, so a built tree reaches it without a
 * caller having to know where it landed.
 */
export function openCodeMindForSession(
  actors: SocialActorDefinition[],
  sessionId: string,
  options: Partial<OpenCodeMindRunnerOptions> = {}
): SocialDecisionExecutor | undefined {
  if (process.env[openCodeMindVariable] !== "true") return undefined;
  const named = actors.map((actor) => actor.modelRef).find((ref): ref is string => typeof ref === "string" && ref.includes("/"));
  const modelRef = named ?? defaultModelRef;
  const [providerID, ...rest] = modelRef.split("/");
  return new OpenCodeMindRunner({
    runId: sessionId,
    serverEntry: path.join(path.dirname(fileURLToPath(import.meta.url)), "opencode-social-seat.js"),
    providerID,
    modelID: rest.join("/"),
    ...options,
  });
}

