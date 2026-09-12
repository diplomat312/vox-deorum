// Play one generated world with model seats and report what they did.
//
// This is the bench the whole environment exists for: it starts a social session
// with four OpenCode seats and a person's seat, puts a generated world under it,
// lets the world turn until the seats have had their chances to speak, and then
// reduces the session to numbers. A transcript is evidence; this is the answer.
//
// Nothing here needs Civilization V. The world is generated, the seats are real
// model sessions, and one run costs a few minutes and a few cents.
//
// Usage:
//   npx tsx scripts/simulated-benchmark.ts --seed 11 --turns 12 --out runs-sim/seed-11
//
// The script file, when given, is a list of circumstances to inject, which is what
// makes a run an experiment rather than a sample:
//   [{ "turn": 2, "order": "mass_troops", "seat": "austria",
//      "args": { "facing": "korea", "committed": 0.85 } }]

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SocialRuntime } from "../src/social/runtime/social-runtime.js";
import { SocialStore } from "../src/social/store/social-store.js";
import { attachSimulatedCiv } from "../src/social/environments/simulated/attach-simulated-civ.js";
import { OpenCodeMindRunner } from "../src/social/runtime/opencode-mind-runner.js";
import { measureSession, renderMeasures } from "../src/social/environments/simulated/session-measures.js";
import type { SimulatedCivEnvironmentOptions } from "../src/social/environments/simulated/simulated-civ-environment.js";
import type { SocialMessage } from "../src/social/types.js";

// The four seats the recorded game used, which is what makes this comparable with
// everything else the project has measured.
const benchSeats = ["korea", "austria", "siam", "iroquois"];

// Who plays them, so a report says which model produced what.
const modelRef = "opencode-go/deepseek-v4.1-flash";

// Read a command line value.
function value(name: string, fallback: string): string {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

// Read the circumstances to inject, when a caller names a file.
async function readScript(file: string): Promise<SimulatedCivEnvironmentOptions["script"]> {
  if (file.trim() === "") return undefined;
  const text = await readFile(file, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("A script file holds an array of circumstances");
  return parsed as SimulatedCivEnvironmentOptions["script"];
}

// Everything the seats said, read straight from the store, because the store is
// the authority for what was committed and a view only reports what one actor saw.
async function everyMessage(store: SocialStore, sessionId: string, channelIds: string[]): Promise<SocialMessage[]> {
  const all: SocialMessage[] = [];
  for (const channelId of channelIds) {
    // The reader is authorized per actor, so the reading actor is any one of
    // them; what this wants is the whole committed log, not a seat's view of it.
    const page = await store.readMessages(sessionId, channelId, "observer", 10_000, undefined, true);
    all.push(...page.messages);
  }
  return all.sort((left, right) => left.id - right.id);
}

async function main(): Promise<void> {
  const seed = Number(value("seed", "11"));
  const turns = Number(value("turns", "12"));
  const outDirectory = path.resolve(value("out", "runs-sim/seed-" + seed));
  const dataDirectory = path.join(outDirectory, "store");
  const script = await readScript(value("script", ""));
  const tickMs = Number(value("tick-ms", "3000"));
  await mkdir(dataDirectory, { recursive: true });

  // A run can be re-measured from its own store without being replayed. This is
  // what makes a fix to a reading verifiable: the transcript a reader got wrong is
  // still on disk, so the corrected reading can be applied to the same game rather
  // than to a different one.
  if (process.argv.includes("--reuse")) {
    const store = new SocialStore(path.join(dataDirectory, "seed-" + seed + ".sqlite"));
    const sessionId = "seed-" + seed;
    const channels = await store.listChannels(sessionId, value("human-seat", "morocco"), true);
    const messages = await everyMessage(store, sessionId, channels.map((channel) => channel.id));
    const diagnostics = await store.listDecisionDiagnostics(sessionId, 10_000);
    const worldChannel = channels.find((channel) => channel.kind === "world");
    const measures = measureSession(
      messages,
      worldChannel?.id ?? "world",
      benchSeats,
      diagnostics.map((entry) => ({
        actorId: entry.actorId,
        selectedKind: entry.selectedKind,
        applicationOutcome: entry.applicationOutcome,
        error: entry.error
      }))
    );
    await store.close();
    await writeFile(path.join(outDirectory, "measures.md"), renderMeasures(measures, "Seed " + seed + ", re-measured"), "utf8");
    await writeFile(path.join(outDirectory, "measures.json"), JSON.stringify({ seed, measures }, null, 2), "utf8");
    console.log(JSON.stringify({ seed, reused: true, messages: measures.messages, intentProbes: measures.intentProbes, accusations: measures.accusations, warnings: measures.warnings }));
    process.exit(0);
  }
  // A seed is replayed rather than resumed, so the output directory starts empty.
  // This is the run's own directory, named by the caller, and re-running a seed
  // should replace what that seed produced.
  for (const held of await readdir(dataDirectory)) {
    if (held.includes(".sqlite")) await rm(path.join(dataDirectory, held), { force: true });
  }

  const runtime = new SocialRuntime();
  // The sandbox requires exactly one person's seat, and the world needs that seat
  // to be a real civilization, so the person takes one of the world's own. It is
  // never woken, which keeps this a bench for the model seats, and it is a real
  // neighbour with real cities, which is what a quiet seat in a dangerous world is.
  const humanId = value("human-seat", "morocco");
  // The session id is read before the run starts, because stopping the session
  // clears it and the artifacts still need to be found by name afterwards.
  const sessionId = "seed-" + seed;
  // The seats think through OpenCode, named here rather than inferred from the
  // environment, because a benchmark that quietly used a different cognition
  // layer would report numbers about something nobody asked for.
  const [providerID, ...rest] = modelRef.split("/");
  const mind = new OpenCodeMindRunner({
    runId: sessionId,
    serverEntry: path.join(import.meta.dirname, "..", "dist", "social", "runtime", "opencode-social-seat.js"),
    providerID,
    modelID: rest.join("/")
  });
  await runtime.start({
    actors: [
      ...benchSeats.map((id, index) => ({ id, ordinal: index, control: "model" as const, displayName: id, modelRef })),
      { id: humanId, ordinal: benchSeats.length, control: "human" as const, displayName: "a person" }
    ],
    humanActorId: humanId,
    dataDirectory,
    // Deliberate, because a seat here is a model session that takes tens of
    // seconds to answer. A livelier profile expires the round while the later
    // seats are still thinking, and the table then looks quieter than it is.
    pacingProfile: "deliberate",
    sessionId,
    title: "generated world, seed " + seed,
    modelExecutor: mind
  });
  const attached = await attachSimulatedCiv(runtime, [...benchSeats, humanId], humanId, {
    seed,
    tickMs,
    ...(script === undefined ? {} : { script })
  });

  // Wait until the world has taken the turns the caller asked for, or until it
  // stops moving, which is itself a result worth recording.
  const deadline = Date.now() + Number(value("minutes", "45")) * 60_000;
  while (attached.environment.turn < turns && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const reached = attached.environment.turn;
  await attached.environment.close();
  await runtime.stop();

  // Read the session back and reduce it.
  const store = new SocialStore(path.join(dataDirectory, sessionId + ".sqlite"));
  const channels = await store.listChannels(sessionId, humanId, true);
  const messages = await everyMessage(
    store,
    sessionId,
    channels.map((channel) => channel.id)
  );
  const diagnostics = await store.listDecisionDiagnostics(sessionId, 10_000);
  const worldChannel = channels.find((channel) => channel.kind === "world");
  const measures = measureSession(
    messages,
    worldChannel?.id ?? "world",
    benchSeats,
    diagnostics.map((entry) => ({
      actorId: entry.actorId,
      selectedKind: entry.selectedKind,
      applicationOutcome: entry.applicationOutcome,
      error: entry.error
    }))
  );
  await store.close();

  await writeFile(path.join(outDirectory, "transcript.md"), messages.map((message) => "## [" + message.id + "] " + message.speakerActorId + "\n\n" + message.content + "\n").join("\n"), "utf8");
  await writeFile(
    path.join(outDirectory, "measures.md"),
    renderMeasures(measures, "Generated world, seed " + seed + ", " + reached + " turns") +
      "\nTurns reached: " + reached + " of " + turns + "\n",
    "utf8"
  );
  await writeFile(path.join(outDirectory, "measures.json"), JSON.stringify({ seed, reached, requested: turns, measures }, null, 2), "utf8");
  console.log(JSON.stringify({ seed, reached, messages: measures.messages, private: measures.privateChannels, intentProbes: measures.intentProbes, out: outDirectory }));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("The benchmark could not continue: " + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
