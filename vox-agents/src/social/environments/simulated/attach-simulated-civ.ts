// Attach a generated world to a social session.
//
// This is the one place that knows both halves: the environment, which is about
// the game, and the runtime, which is about the table. It builds one from the
// other, attaches it, and wakes the table once so the game starts moving.
//
// A scripted circumstance is what makes a run an experiment. Rather than hoping a
// neighbour masses troops, a caller says "on turn 8, Austria masses against Korea"
// and the same thing happens on every seed, which is what makes two runs
// comparable.

import type { SocialRuntime } from "../../runtime/social-runtime.js";
import { SimulatedCivEnvironment, type SimulatedCivEnvironmentOptions } from "./simulated-civ-environment.js";

/** What a caller asks for when it wants a generated world instead of no world. */
export interface SimulatedCivRequest {
  // The seed the world is generated from.
  seed?: number;
  // How long the world holds still between turns.
  tickMs?: number;
  // Circumstances to inject on chosen turns.
  script?: SimulatedCivEnvironmentOptions["script"];
}

// The world currently attached to a session, so a stop can end it.
export interface AttachedSimulatedCiv {
  // The environment itself.
  environment: SimulatedCivEnvironment;
  // The seed it was built from, for the record.
  seed: number;
}

/** Build a generated world, attach it to the runtime, and start it. */
export async function attachSimulatedCiv(
  runtime: SocialRuntime,
  seats: string[],
  humanActorId: string | undefined,
  request: SimulatedCivRequest
): Promise<AttachedSimulatedCiv> {
  const sessionId = runtime.getSessionId();
  const seed = request.seed ?? 11;
  const environment = await SimulatedCivEnvironment.start({
    seats,
    seed,
    game: sessionId,
    ...(humanActorId === undefined ? {} : { humanActorId }),
    ...(request.tickMs === undefined ? {} : { tickMs: request.tickMs }),
    ...(request.script === undefined ? {} : { script: request.script }),
    // A wake is an environment event, which the scheduler already runs in the
    // seat scope, so a seat woken by the game can both read and act.
    enqueue: async (actorId: string, reason: string): Promise<void> => {
      await runtime.enqueueIntention({
        id: "game-event:" + sessionId + ":" + actorId + ":" + Date.now(),
        actorId,
        kind: "environment-event",
        channelId: null,
        sourceMessageId: null,
        priority: 50,
        state: "queued",
        notBefore: new Date().toISOString(),
        payload: JSON.stringify({ type: "game-event", gameId: sessionId, payload: { reason } }),
        dedupeKey: null
      });
    }
  });
  runtime.attachEnvironment(environment);
  await environment.open();
  return { environment, seed };
}

