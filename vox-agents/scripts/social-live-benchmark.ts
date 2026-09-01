import { randomUUID } from 'node:crypto';

interface ModelDefinition { id: string; name: string; }
interface SocialMessage { speakerActorId: string; content: string; }
interface SocialDiagnostic { actorId: string; actorDisplayName: string; modelRef: string | null; selectedKind: string | null; validationOutcome: string; applicationOutcome: string | null; providerLatencyMs: number | null; retryCount: number; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; cost: number | null; }
interface SocialCascade { id: string; state: string; modelRuns: number; committedModelMessages: number; createdAt: string; updatedAt: string; }
interface SocialChannel { id: string; kind: string; title: string; }
interface JsonResponse { sessionId?: string; channels?: SocialChannel[]; diagnostics?: SocialDiagnostic[]; cascades?: SocialCascade[]; messages?: SocialMessage[]; error?: string; }

const baseUrl = readOption('--base-url', process.env.SOCIAL_LIVE_BASE_URL ?? 'http://127.0.0.1:5555');
const scenario = readOption('--scenario', 'three');
const pacing = readOption('--pacing', 'balanced');
const models = (readOption('--models', process.env.SOCIAL_LIVE_MODELS ?? '').split(',').map((value) => value.trim()).filter(Boolean));

/** Run the opt-in live social benchmark against an already started developer server. */
async function main(): Promise<void> {
  if (!models.length) throw new Error('Provide --models=model/id,model/id or SOCIAL_LIVE_MODELS.');
  if (scenario === 'all') {
    const results = [];
    for (const selectedScenario of ['single', 'two', 'three', 'private', 'long', 'rapid']) results.push(await runScenario(selectedScenario, models.slice(0, scenarioModelCount(selectedScenario))));
    printResults(results);
    return;
  }
  printResults([await runScenario(scenario, models.slice(0, scenarioModelCount(scenario))) ]);
}

/** Run one disposable scenario and return compact metrics plus human-review transcripts. */
async function runScenario(selectedScenario: string, selectedModels: string[]): Promise<Record<string, unknown>> {
  if (!selectedModels.length) throw new Error(`Scenario ${selectedScenario} needs at least one model.`);
  const sessionId = `social-live-${selectedScenario}-${randomUUID()}`;
  const actors = [{ id: 'human', ordinal: 0, control: 'human', displayName: 'Human' }, ...selectedModels.map((modelRef, index) => ({ id: `model-${index + 1}`, ordinal: index + 1, control: 'model', displayName: `Model ${index + 1}`, modelRef }))];
  await request('/api/social/session', 'POST', { sessionId, title: `Live benchmark ${selectedScenario}`, pacingProfile: pacing, actors });
  try {
    const channels = (await request('/api/social/channels')) as JsonResponse;
    const world = channels.channels?.find((channel) => channel.kind === 'world') ?? channels.channels?.[0];
    if (!world) throw new Error('Benchmark session did not expose WORLD.');
    await exerciseScenario(selectedScenario, world.id, actors.map((actor) => actor.id));
    await waitForDiagnostics(selectedModels.length);
    const diagnosticsResponse = (await request('/api/social/diagnostics?limit=250')) as JsonResponse;
    const diagnostics = diagnosticsResponse.diagnostics ?? [];
    const messages = ((await request(`/api/social/channels/${encodeURIComponent(world.id)}/messages?limit=100`)) as JsonResponse).messages ?? [];
    return { scenario: selectedScenario, pacing, models: selectedModels, diagnostics: summarizeDiagnostics(diagnostics), cascades: summarizeCascades(diagnosticsResponse.cascades ?? []), transcript: messages };
  } finally {
    await request('/api/social/session/stop', 'POST').catch(() => undefined);
  }
}

/** Send the smallest useful set of prompts for the selected benchmark family. */
async function exerciseScenario(selectedScenario: string, worldId: string, actorIds: string[]): Promise<void> {
  if (selectedScenario === 'rapid') {
    await sendMessage(worldId, 'Rapid input A: please notice this message.');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await sendMessage(worldId, 'Rapid input B: use the newest context when you answer.');
    return;
  }
  if (selectedScenario === 'long') {
    for (let index = 1; index <= 8; index += 1) { await sendMessage(worldId, `Conversation checkpoint ${index}: add something useful or pass.`); await waitForQuietPeriod(1_500); }
    return;
  }
  await sendMessage(worldId, `Benchmark greeting for ${selectedScenario}. Speak only if you have something useful to add.`);
  if (selectedScenario === 'private') {
    for (const actorId of actorIds.slice(1)) await request('/api/social/dms/' + encodeURIComponent(actorId), 'POST', {});
    await request('/api/social/groups', 'POST', { title: 'Benchmark Council', invitedActorIds: actorIds.slice(1) });
  }
}

/** Post one human message through the social API. */
async function sendMessage(channelId: string, content: string): Promise<void> { await request(`/api/social/channels/${encodeURIComponent(channelId)}/messages`, 'POST', { content }); }

/** Wait until a short period has elapsed without requiring provider-specific timing assumptions. */
async function waitForQuietPeriod(milliseconds = 2_500): Promise<void> { await new Promise((resolve) => setTimeout(resolve, milliseconds)); }

/** Wait for provider decisions to settle without allowing a live test to run indefinitely. */
async function waitForDiagnostics(expectedMinimum: number, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let previousCount = -1;
  let stablePolls = 0;
  while (Date.now() < deadline) {
    const response = (await request('/api/social/diagnostics?limit=250')) as JsonResponse;
    const count = response.diagnostics?.length ?? 0;
    if (count >= expectedMinimum && count === previousCount) stablePolls += 1;
    else stablePolls = 0;
    if (count >= expectedMinimum && stablePolls >= 2) return;
    previousCount = count;
    await waitForQuietPeriod(1_000);
  }
}

/** Aggregate diagnostics without persisting or printing hidden model reasoning. */
function summarizeDiagnostics(diagnostics: SocialDiagnostic[]): Record<string, unknown> {
  const byModel = new Map<string, SocialDiagnostic[]>();
  for (const diagnostic of diagnostics) { const key = diagnostic.modelRef ?? diagnostic.actorDisplayName; byModel.set(key, [...(byModel.get(key) ?? []), diagnostic]); }
  const models = [...byModel.entries()].map(([model, values]) => ({ model, decisions: values.length, validated: values.filter((value) => value.validationOutcome === 'validated').length, passes: values.filter((value) => value.selectedKind === 'pass').length, retries: values.reduce((sum, value) => sum + value.retryCount, 0), failures: values.filter((value) => value.validationOutcome === 'failed' || value.applicationOutcome === 'error').length, committed: values.filter((value) => value.applicationOutcome === 'send_message').length, latencies: latencySummary(values), tokens: tokenSummary(values) }));
  return { decisions: diagnostics.length, passes: diagnostics.filter((value) => value.selectedKind === 'pass').length, failures: diagnostics.filter((value) => value.validationOutcome === 'failed' || value.applicationOutcome === 'error').length, models };
}

/** Summarize durable cascade usage and elapsed time for pacing comparisons. */
function summarizeCascades(cascades: SocialCascade[]): Array<Record<string, unknown>> { return cascades.map((cascade) => ({ state: cascade.state, modelRuns: cascade.modelRuns, committedModelMessages: cascade.committedModelMessages, durationMs: Math.max(0, Date.parse(cascade.updatedAt) - Date.parse(cascade.createdAt)) })); }

/** Return median and p95 provider latency for one model. */
function latencySummary(values: SocialDiagnostic[]): Record<string, number | null> { const samples = values.map((value) => value.providerLatencyMs).filter((value): value is number => value !== null).sort((a, b) => a - b); return { medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) }; }
/** Return aggregate provider token usage when supplied. */
function tokenSummary(values: SocialDiagnostic[]): Record<string, number> { return { input: values.reduce((sum, value) => sum + (value.inputTokens ?? 0), 0), output: values.reduce((sum, value) => sum + (value.outputTokens ?? 0), 0), total: values.reduce((sum, value) => sum + (value.totalTokens ?? 0), 0) }; }
/** Return one percentile from a sorted finite sample. */
function percentile(values: number[], fraction: number): number | null { if (!values.length) return null; return values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))]; }

/** Choose a model count appropriate for one scenario family. */
function scenarioModelCount(selectedScenario: string): number { if (selectedScenario === 'single') return 1; if (selectedScenario === 'two') return 2; if (selectedScenario === 'stress') return 7; return 3; }
/** Read one command-line option or its fallback. */
function readOption(name: string, fallback: string): string { const prefix = `${name}=`; return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback; }

/** Send one JSON request and surface the server's concise error. */
async function request(path: string, method = 'GET', body?: Record<string, unknown>): Promise<JsonResponse> { const response = await fetch(`${baseUrl}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const value = await response.json() as JsonResponse; if (!response.ok) throw new Error(value.error ?? `${method} ${path} failed with ${response.status}`); return value; }

/** Print both machine-readable JSON and a compact human summary. */
function printResults(results: Record<string, unknown>[]): void { process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`); for (const result of results) process.stdout.write(`Scenario ${String(result.scenario)} completed with pacing ${String(result.pacing)}.\n`); }

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
