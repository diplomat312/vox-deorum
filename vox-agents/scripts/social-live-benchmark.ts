import { randomUUID } from 'node:crypto';

interface ModelDefinition { id: string; name: string; }
interface SocialMessage { id: number; speakerActorId: string; content: string; }
interface SocialDiagnostic { actorId: string; actorDisplayName: string; modelRef: string | null; selectedKind: string | null; validationOutcome: string; applicationOutcome: string | null; providerLatencyMs: number | null; queueWaitMs: number | null; durationMs: number | null; retryCount: number; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; cost: number | null; }
interface SocialCascade { id: string; state: string; modelRuns: number; committedModelMessages: number; maxModelRuns: number; maxCommittedModelMessages: number; createdAt: string; updatedAt: string; }
interface SocialChannel { id: string; kind: string; title: string; }
interface SocialCascadeWait { cascade?: SocialCascade; settled: boolean; timedOut: boolean; }
interface JsonResponse { id?: string; kind?: string; title?: string; sessionId?: string; channels?: SocialChannel[]; diagnostics?: SocialDiagnostic[]; cascades?: SocialCascade[]; messages?: SocialMessage[]; cascade?: SocialCascade; settled?: boolean; timedOut?: boolean; error?: string; }

const baseUrl = readOption('--base-url', process.env.SOCIAL_LIVE_BASE_URL ?? 'http://127.0.0.1:5555');
const selectedScenario = readOption('--scenario', 'three');
const pacing = readOption('--pacing', 'balanced');
const requestedModel = readOption('--model', '');
const requestedActors = Number(readOption('--actors', ''));
const configuredModels = readOption('--models', process.env.SOCIAL_LIVE_MODELS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const timeoutMs = Math.min(Math.max(Number(readOption('--timeout-ms', '90000')) || 90_000, 1_000), 300_000);

const benchmarkProfiles: ModelDefinition[] = [
  { id: 'aurelia', name: 'Aurelia: diplomatic, status-conscious, coalition-oriented, dislikes public humiliation.' },
  { id: 'borin', name: 'Borin: suspicious, security-oriented, direct, concerned about dominant powers.' },
  { id: 'cyrene', name: 'Cyrene: opportunistic, socially adept, willing to make contradictory private and public commitments.' },
  { id: 'darius', name: 'Darius: proud, grievance-driven, willing to bear costs to punish betrayal.' },
];

/** Run the opt-in live social benchmark against an already started developer server. */
async function main(): Promise<void> {
  const models = resolveModels();
  if (!models.length) throw new Error('Provide --models=provider/model,provider/model or --model=provider/model --actors=3.');
  const scenarios = selectedScenario === 'all' ? ['single', 'two', 'three', 'private', 'stress', 'rapid'] : [selectedScenario];
  const results: Array<Record<string, unknown>> = [];
  for (const scenario of scenarios) results.push(await runScenario(scenario, modelsForScenario(scenario, models)));
  printResults(results);
}

/** Resolve repeated same-model actors or the explicit mixed-model list. */
function resolveModels(): string[] {
  if (requestedModel) return Array.from({ length: Math.min(Math.max(requestedActors || 3, 1), 7) }, () => requestedModel);
  return configuredModels;
}

/** Ensure the stress case always exercises a bounded six to eight actor roster. */
function modelsForScenario(scenario: string, models: string[]): string[] { const required = scenarioModelCount(scenario); if (scenario !== 'stress') return models.slice(0, required); return Array.from({ length: required }, (_, index) => models[index % models.length]); }

/** Run one disposable scenario and return compact comparison metrics plus transcripts. */
async function runScenario(scenario: string, selectedModels: string[]): Promise<Record<string, unknown>> {
  if (!selectedModels.length) throw new Error(`Scenario ${scenario} needs at least one model.`);
  const sessionId = `social-live-${scenario}-${randomUUID()}`;
  const actors = [{ id: 'human', ordinal: 0, control: 'human', displayName: 'Human' }, ...selectedModels.map((modelRef, index) => { const profile = benchmarkProfiles[index % benchmarkProfiles.length]; const displayName = `${profile.id[0].toUpperCase()}${profile.id.slice(1)} ${index + 1}`; return { id: `${profile.id}-${index + 1}`, ordinal: index + 1, control: 'model', displayName, modelRef, profile: profile.name }; })];
  await request('/api/social/session', 'POST', { sessionId, title: `Live benchmark ${scenario}`, pacingProfile: pacing, actors });
  try {
    const channels = (await request('/api/social/channels')) as JsonResponse;
    const world = channels.channels?.find((channel) => channel.kind === 'world');
    if (!world) throw new Error('Benchmark session did not expose WORLD.');
    const exercised = await exerciseScenario(scenario, world.id, actors.map((actor) => actor.id));
    await waitForIdle();
    const diagnosticsResponse = (await request('/api/social/diagnostics?limit=500')) as JsonResponse;
    const diagnostics = diagnosticsResponse.diagnostics ?? [];
    const allChannels = (await request('/api/social/channels')) as JsonResponse;
    const transcripts = await readTranscripts(allChannels.channels ?? [], scenario === 'private');
    return { scenario, layer: scenario === 'single' || scenario === 'two' || scenario === 'three' || scenario === 'stress' ? 'protocol' : 'social', pacing, actorCount: actors.length, models: selectedModels, exercised, metrics: summarizeDiagnostics(diagnostics), cascades: summarizeCascades(diagnosticsResponse.cascades ?? []), transcripts };
  } finally {
    await request('/api/social/session/stop', 'POST').catch(() => undefined);
  }
}

/** Exercise one benchmark family and return authoritative cascade outcomes. */
async function exerciseScenario(scenario: string, worldId: string, actorIds: string[]): Promise<Record<string, unknown>> {
  const waits: SocialCascadeWait[] = [];
  if (scenario === 'rapid') {
    const first = await sendMessage(worldId, 'Rapid input A: notice this message.');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = await sendMessage(worldId, 'Rapid input B: use the newest context when you answer.');
    waits.push(await waitForCascade(first.id), await waitForCascade(second.id));
    return { cascadeOutcomes: waits.map(summarizeWait) };
  }
  if (scenario === 'long') {
    for (let index = 1; index <= 25; index += 1) { const message = await sendMessage(worldId, `Conversation checkpoint ${index}: add something useful or pass.`); waits.push(await waitForCascade(message.id)); }
    return { cascadeOutcomes: waits.map(summarizeWait) };
  }
  const greeting = await sendMessage(worldId, `Benchmark greeting for ${scenario}. Speak only if you have something useful to add.`);
  waits.push(await waitForCascade(greeting.id));
  if (scenario === 'private') {
    const target = actorIds[1];
    if (target) { const dm = await request(`/api/social/dms/${encodeURIComponent(target)}`, 'POST', {}) as JsonResponse; const dmChannel = dm.channels?.[0] ?? (dm.id && dm.kind && dm.title ? { id: dm.id, kind: dm.kind, title: dm.title } : undefined); if (dmChannel) { const dmMessage = await sendMessage(dmChannel.id, 'Private benchmark message.'); waits.push(await waitForCascade(dmMessage.id)); } }
    const group = await request('/api/social/groups', 'POST', { title: 'Benchmark Council', invitedActorIds: actorIds.slice(1) }) as JsonResponse;
    await waitForIdle();
    const groupChannel = group.channels?.[0] ?? (group.id && group.kind && group.title ? { id: group.id, kind: group.kind, title: group.title } : undefined) ?? (await request('/api/social/channels')).channels?.find((channel) => channel.kind === 'group');
    if (groupChannel) { const groupMessage = await sendMessage(groupChannel.id, 'Group benchmark message after invitations.'); waits.push(await waitForCascade(groupMessage.id)); }
    return { cascadeOutcomes: waits.map(summarizeWait), privateAction: true };
  }
  return { cascadeOutcomes: waits.map(summarizeWait) };
}

/** Post one human message and return its durable identity. */
async function sendMessage(channelId: string, content: string): Promise<SocialMessage> { if (!channelId) throw new Error('Benchmark channel was not created.'); return request(`/api/social/channels/${encodeURIComponent(channelId)}/messages`, 'POST', { content }) as Promise<SocialMessage>; }
/** Wait for a human-triggered cascade using the runtime's durable settlement primitive. */
async function waitForCascade(messageId: number): Promise<SocialCascadeWait> { const response = await request(`/api/social/cascades/msg:${messageId}/wait?timeoutMs=${timeoutMs}`) as JsonResponse; return { cascade: response.cascade, settled: response.settled === true, timedOut: response.timedOut === true }; }
/** Wait for autonomous invitation decisions without inferring completion from telemetry. */
async function waitForIdle(): Promise<void> { await request('/api/social/idle/wait'); }
/** Read visible transcripts, including private rooms when the scenario intentionally creates them. */
async function readTranscripts(channels: SocialChannel[], includePrivate: boolean): Promise<Record<string, SocialMessage[]>> { const transcripts: Record<string, SocialMessage[]> = {}; for (const channel of channels) { if (!includePrivate && channel.kind !== 'world') continue; transcripts[channel.title] = ((await request(`/api/social/channels/${encodeURIComponent(channel.id)}/messages?limit=200`)) as JsonResponse).messages ?? []; } return transcripts; }

/** Summarize sanitized diagnostics by model and for the whole scenario. */
function summarizeDiagnostics(diagnostics: SocialDiagnostic[]): Record<string, unknown> { const byModel = new Map<string, SocialDiagnostic[]>(); for (const diagnostic of diagnostics) { const key = diagnostic.modelRef ?? diagnostic.actorDisplayName; byModel.set(key, [...(byModel.get(key) ?? []), diagnostic]); } const models = [...byModel.entries()].map(([model, values]) => summarizeModel(model, values)); return { decisions: diagnostics.length, providerCalls: diagnostics.filter((value) => value.providerLatencyMs !== null).length, firstAttemptSuccesses: diagnostics.filter((value) => value.validationOutcome === 'validated' && value.retryCount === 0).length, retries: diagnostics.reduce((sum, value) => sum + value.retryCount, 0), failures: diagnostics.filter((value) => value.validationOutcome === 'failed' || value.applicationOutcome === 'error').length, runtimeRefusals: diagnostics.filter((value) => value.applicationOutcome === 'refused').length, passes: diagnostics.filter((value) => value.selectedKind === 'pass').length, committedMessages: diagnostics.filter((value) => value.applicationOutcome === 'send_message').length, latency: latencySummary(diagnostics), queueWait: queueSummary(diagnostics), tokens: tokenSummary(diagnostics), cost: diagnostics.reduce((sum, value) => sum + (value.cost ?? 0), 0), models }; }
/** Summarize one model's protocol and timing outcomes. */
function summarizeModel(model: string, values: SocialDiagnostic[]): Record<string, unknown> { return { model, decisions: values.length, providerCalls: values.filter((value) => value.providerLatencyMs !== null).length, firstAttemptSuccesses: values.filter((value) => value.validationOutcome === 'validated' && value.retryCount === 0).length, retries: values.reduce((sum, value) => sum + value.retryCount, 0), failures: values.filter((value) => value.validationOutcome === 'failed' || value.applicationOutcome === 'error').length, runtimeRefusals: values.filter((value) => value.applicationOutcome === 'refused').length, passes: values.filter((value) => value.selectedKind === 'pass').length, committedMessages: values.filter((value) => value.applicationOutcome === 'send_message').length, actions: [...new Set(values.map((value) => value.selectedKind).filter((value): value is string => value !== null))], latency: latencySummary(values), queueWait: queueSummary(values), tokens: tokenSummary(values), cost: values.reduce((sum, value) => sum + (value.cost ?? 0), 0) }; }
/** Summarize durable cascades and their terminal outcomes. */
function summarizeCascades(cascades: SocialCascade[]): Array<Record<string, unknown>> { return cascades.map((cascade) => ({ id: cascade.id, state: cascade.state, modelRuns: cascade.modelRuns, committedModelMessages: cascade.committedModelMessages, durationMs: Math.max(0, Date.parse(cascade.updatedAt) - Date.parse(cascade.createdAt)), budgets: { maxModelRuns: cascade.maxModelRuns, maxCommittedModelMessages: cascade.maxCommittedModelMessages } })); }
/** Convert a wait result into a compact machine-readable outcome. */
function summarizeWait(wait: SocialCascadeWait): Record<string, unknown> { return { settled: wait.settled, timedOut: wait.timedOut, state: wait.cascade?.state ?? 'missing' }; }
/** Return median and p95 provider latency for one diagnostic sample. */
function latencySummary(values: SocialDiagnostic[]): Record<string, number | null> { const samples = values.map((value) => value.providerLatencyMs).filter((value): value is number => value !== null).sort((a, b) => a - b); return { medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) }; }
/** Return median and p95 actual scheduler or channel wait. */
function queueSummary(values: SocialDiagnostic[]): Record<string, number | null> { const samples = values.map((value) => value.queueWaitMs).filter((value): value is number => value !== null).sort((a, b) => a - b); return { medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) }; }
/** Return aggregate provider token usage when supplied. */
function tokenSummary(values: SocialDiagnostic[]): Record<string, number> { return { input: values.reduce((sum, value) => sum + (value.inputTokens ?? 0), 0), output: values.reduce((sum, value) => sum + (value.outputTokens ?? 0), 0), total: values.reduce((sum, value) => sum + (value.totalTokens ?? 0), 0) }; }
/** Return one percentile from a sorted finite sample. */
function percentile(values: number[], fraction: number): number | null { if (!values.length) return null; return values[Math.min(values.length - 1, Math.ceil((values.length - 1) * fraction))]; }
/** Choose a model count appropriate for one scenario family. */
function scenarioModelCount(scenario: string): number { if (scenario === 'single') return 1; if (scenario === 'two') return 2; if (scenario === 'stress') return 7; return 3; }
/** Read one command-line option or its fallback. */
function readOption(name: string, fallback: string): string { const prefix = `${name}=`; return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback; }
/** Send one JSON request and surface the server's concise error. */
async function request(path: string, method = 'GET', body?: Record<string, unknown>): Promise<JsonResponse> { const response = await fetch(`${baseUrl}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const value = await response.json() as JsonResponse; if (!response.ok) throw new Error(value.error ?? `${method} ${path} failed with ${response.status}`); return value; }
/** Print machine-readable JSON and a compact human summary without hidden reasoning. */
function printResults(results: Record<string, unknown>[]): void { process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`); for (const result of results) process.stdout.write(`Scenario ${String(result.scenario)} completed with pacing ${String(result.pacing)}.\n`); }

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
