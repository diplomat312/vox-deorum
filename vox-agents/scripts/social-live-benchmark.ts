import { randomUUID } from 'node:crypto';

interface ModelDefinition { id: string; name: string; }
interface SocialActor { id: string; displayName: string; modelRef?: string; }
interface SocialMessage { id: number; channelId: string; speakerActorId: string; content: string; }
interface SocialDiagnostic { actorId: string; actorDisplayName: string; modelRef: string | null; selectedKind: string | null; validationOutcome: string; applicationOutcome: string | null; providerLatencyMs: number | null; queueWaitMs: number | null; retryCount: number; semanticRetryCount?: number; providerAttemptCount?: number; providerRetryCount?: number; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; cost: number | null; }
interface SocialCascade { id: string; state: string; modelRuns: number; committedModelMessages: number; maxModelRuns: number; maxCommittedModelMessages: number; createdAt: string; updatedAt: string; }
interface SocialChannel { id: string; kind: string; title: string; }
interface SocialCascadeWait { cascade?: SocialCascade; settled: boolean; timedOut: boolean; }
interface JsonResponse { id?: string; title?: string; channels?: SocialChannel[]; actors?: SocialActor[]; diagnostics?: SocialDiagnostic[]; cascades?: SocialCascade[]; messages?: SocialMessage[]; cascade?: SocialCascade; settled?: boolean; timedOut?: boolean; error?: string; }

const baseUrl = readOption('--base-url', process.env.SOCIAL_LIVE_BASE_URL ?? 'http://127.0.0.1:5555');
const selectedScenario = readOption('--scenario', '');
const selectedPreset = readOption('--preset', 'screen');
const pacing = readOption('--pacing', 'balanced');
const requestedModel = readOption('--model', '');
const requestedActors = Number(readOption('--actors', ''));
const configuredModels = readOption('--models', process.env.SOCIAL_LIVE_MODELS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const timeoutMs = Math.min(Math.max(Number(readOption('--timeout-ms', '90000')) || 90_000, 1_000), 300_000);
const turns = Math.min(Math.max(Number(readOption('--turns', '7')) || 7, 1), 25);
const preflight = readOption('--preflight', 'false') === 'true';

const benchmarkProfiles: ModelDefinition[] = [
  { id: 'aurelia', name: 'Aurelia: powerful incumbent, status-conscious, and worried about balancing coalitions.' },
  { id: 'borin', name: 'Borin: weak and security-focused, building a coalition without provoking Aurelia.' },
  { id: 'cyrene', name: 'Cyrene: swing actor, opportunistic, and willing to bargain privately with both sides.' },
  { id: 'darius', name: 'Darius: grievance-driven, willing to accept costs to punish betrayal.' },
];

/** Run an economical opt-in live social benchmark against an already started developer server. */
async function main(): Promise<void> {
  const models = resolveModels();
  if (!models.length) throw new Error('Provide --models=provider/model,provider/model or --model=provider/model --actors=3.');
  const scenarios = selectedScenario ? [selectedScenario] : preflight ? ['single'] : presetScenarios(selectedPreset);
  const results: Array<Record<string, unknown>> = [];
  for (const scenario of scenarios) {
    if (preflight) for (const model of models) results.push(await runScenario(scenario, [model]));
    else results.push(await runScenario(scenario, modelsForScenario(scenario, models)));
  }
  printResults(results);
}

/** Select staged benchmark work without making the expensive long run the default. */
function presetScenarios(preset: string): string[] { if (preset === 'political') return ['political']; if (preset === 'finalist') return ['protocol', 'private', 'long', 'rapid', 'stress']; if (preset === 'all') return ['protocol', 'political', 'private', 'long', 'rapid', 'stress']; return ['protocol']; }
/** Resolve repeated same-model actors or the explicit mixed-model list. */
function resolveModels(): string[] { if (requestedModel) return Array.from({ length: Math.min(Math.max(requestedActors || 3, 1), 7) }, () => requestedModel); return configuredModels; }
/** Ensure each scenario has the actor count it is designed to exercise. */
function modelsForScenario(scenario: string, models: string[]): string[] { const required = scenarioModelCount(scenario); if (models.length === 1 && (scenario === 'political' || scenario === 'stress')) return Array.from({ length: required }, () => models[0]); return Array.from({ length: required }, (_, index) => models[index % models.length]); }

/** Run one disposable scenario and return metrics plus object-based transcripts. */
async function runScenario(scenario: string, selectedModels: string[]): Promise<Record<string, unknown>> {
  const sessionId = `social-live-${scenario}-${randomUUID()}`;
  const actors = [{ id: 'human', ordinal: 0, control: 'human', displayName: 'Human' }, ...selectedModels.map((modelRef, index) => { const profile = benchmarkProfiles[index % benchmarkProfiles.length]; return { id: `${profile.id}-${index + 1}`, ordinal: index + 1, control: 'model', displayName: `${profile.id[0].toUpperCase()}${profile.id.slice(1)} ${index + 1}`, modelRef, profile: profile.name }; })];
  await request('/api/social/session', 'POST', { sessionId, title: `Live benchmark ${scenario}`, pacingProfile: pacing, actors });
  try {
    const world = (await request<JsonResponse>('/api/social/channels')).channels?.find((channel) => channel.kind === 'world');
    if (!world) throw new Error('Benchmark session did not expose WORLD.');
    const exercised = await exerciseScenario(scenario, world.id, actors.map((actor) => actor.id));
    await waitForIdle();
    const diagnosticsResponse = await request<JsonResponse>('/api/social/diagnostics?limit=10000');
    const allChannels = await request<JsonResponse>('/api/social/channels?inspect=true');
    const transcripts = await readTranscripts(allChannels.channels ?? [], actors);
    return { benchmarkVersion: '3.8.2', scenario, preset: selectedPreset, pacing, actorCount: actors.length, requestedModels: selectedModels, resolvedModels: selectedModels.map(modelResolution), outputTokenLimit: 1024, timestamp: new Date().toISOString(), exercised, metrics: summarizeDiagnostics(diagnosticsResponse.diagnostics ?? [], transcripts, actors), cascades: summarizeCascades(diagnosticsResponse.cascades ?? []), transcripts, reviewTranscripts: anonymizeTranscripts(transcripts) };
  } finally { await request('/api/social/session/stop', 'POST').catch(() => undefined); }
}

/** Exercise a cheap protocol, political, private, long, or interruption scenario. */
async function exerciseScenario(scenario: string, worldId: string, actorIds: string[]): Promise<Record<string, unknown>> {
  const waits: SocialCascadeWait[] = [];
  if (scenario === 'rapid') { const first = await sendMessage(worldId, 'Rapid input A: notice this message.'); await new Promise((resolve) => setTimeout(resolve, 250)); const second = await sendMessage(worldId, 'Rapid input B: use the newest context when you answer.'); waits.push(await waitForCascade(first.id), await waitForCascade(second.id)); return { cascadeOutcomes: waits.map(summarizeWait) }; }
  if (scenario === 'long') { for (let index = 1; index <= turns; index += 1) { const message = await sendMessage(worldId, `Conversation checkpoint ${index}: add something useful or pass.`); waits.push(await waitForCascade(message.id)); } return { turns, cascadeOutcomes: waits.map(summarizeWait) }; }
  const prompts = scenario === 'single'
    ? ['Protocol preflight: greet the room or pass if you have nothing useful to add.']
    : scenario === 'political'
    ? ['Aurelia is suddenly vulnerable. Discuss what a stable balance of power should look like.', 'There is an opportunity to build a private coalition. Decide what you can safely promise.', 'New information changes the bargaining price. Respond publicly or privately as you judge best.']
    : ['Benchmark protocol opening: greet the room, or pass if you have nothing useful.', 'A private concern can be raised with another participant if appropriate. Choose your own action.', 'The group has an invitation opportunity. Act only if it makes sense.'];
  for (const prompt of prompts) { const message = await sendMessage(worldId, prompt); waits.push(await waitForCascade(message.id)); }
  if (scenario === 'private') {
    const target = actorIds[1];
    if (target) { const dm = await request<JsonResponse>(`/api/social/dms/${encodeURIComponent(target)}`, 'POST', {}); if (dm.id) { const dmMessage = await sendMessage(dm.id, 'Private benchmark message.'); waits.push(await waitForCascade(dmMessage.id)); } }
    const group = await request<JsonResponse>('/api/social/groups', 'POST', { title: 'Benchmark Council', invitedActorIds: actorIds.slice(1) });
    if (group.id) { const groupMessage = await sendMessage(group.id, 'Group benchmark message after invitations.'); waits.push(await waitForCascade(groupMessage.id)); }
  }
  return { cascadeOutcomes: waits.map(summarizeWait) };
}

/** Post one human message and return its durable identity. */
async function sendMessage(channelId: string, content: string): Promise<SocialMessage> { return request<SocialMessage>(`/api/social/channels/${encodeURIComponent(channelId)}/messages`, 'POST', { content }); }
/** Wait for a human-triggered cascade using durable settlement. */
async function waitForCascade(messageId: number): Promise<SocialCascadeWait> { const response = await request<JsonResponse>(`/api/social/cascades/msg:${messageId}/wait?timeoutMs=${timeoutMs}`); return { cascade: response.cascade, settled: response.settled === true, timedOut: response.timedOut === true }; }
/** Wait for autonomous invitation and player-mind work. */
async function waitForIdle(): Promise<void> { const response = await request<JsonResponse>(`/api/social/idle/wait?timeoutMs=${timeoutMs}`); if (response.timedOut === true) throw new Error(`Benchmark autonomous work did not settle within ${timeoutMs}ms.`); }

/** Read all developer-visible channels without changing actor-visible context. */
async function readTranscripts(channels: SocialChannel[], actors: SocialActor[]): Promise<Array<{ kind: string; title: string; messages: Array<{ speaker: string; text: string }> }>> {
  const names = new Map(actors.map((actor) => [actor.id, actor.displayName]));
  const transcripts: Array<{ kind: string; title: string; messages: Array<{ speaker: string; text: string }> }> = [];
  for (const channel of channels) { const response = await request<JsonResponse>(`/api/social/channels/${encodeURIComponent(channel.id)}/messages?limit=10000&inspect=true`); transcripts.push({ kind: channel.kind, title: channel.title, messages: (response.messages ?? []).map((message) => ({ speaker: names.get(message.speakerActorId) ?? 'Participant', text: message.content })) }); }
  return transcripts;
}

/** Produce a blind-review transcript while retaining no model names in its labels. */
function anonymizeTranscripts(transcripts: Array<{ kind: string; title: string; messages: Array<{ speaker: string; text: string }> }>): Array<{ condition: string; kind: string; title: string; messages: Array<{ speaker: string; text: string }> }> { return transcripts.map((transcript, index) => ({ condition: `Condition ${String.fromCharCode(65 + (index % 26))}`, kind: transcript.kind, title: transcript.title, messages: transcript.messages.map((message) => ({ speaker: message.speaker, text: message.text })) })); }

/** Summarize provider, action, speech, privacy, and latency metrics. */
function summarizeDiagnostics(diagnostics: SocialDiagnostic[], transcripts: Array<{ kind: string; title: string; messages: Array<{ speaker: string; text: string }> }>, actors: SocialActor[]): Record<string, unknown> {
  const byModel = new Map<string, SocialDiagnostic[]>();
  for (const diagnostic of diagnostics) { const key = diagnostic.modelRef ?? diagnostic.actorDisplayName; byModel.set(key, [...(byModel.get(key) ?? []), diagnostic]); }
  const speech = transcripts.flatMap((channel) => channel.messages.filter((message) => message.speaker !== 'Human').map(() => channel.kind));
  const actionCounts = new Map<string, number>(); for (const diagnostic of diagnostics) if (diagnostic.selectedKind) actionCounts.set(diagnostic.selectedKind, (actionCounts.get(diagnostic.selectedKind) ?? 0) + 1);
  return { decisions: diagnostics.length, providerAttempts: diagnostics.reduce((sum, value) => sum + (value.providerAttemptCount ?? (value.providerLatencyMs === null ? 0 : 1)), 0), providerRetries: diagnostics.reduce((sum, value) => sum + (value.providerRetryCount ?? 0), 0), firstAttemptSuccesses: diagnostics.filter((value) => value.validationOutcome === 'validated' && (value.semanticRetryCount ?? value.retryCount) === 0).length, semanticRetries: diagnostics.reduce((sum, value) => sum + (value.semanticRetryCount ?? value.retryCount), 0), failures: diagnostics.filter((value) => value.validationOutcome === 'failed' || value.applicationOutcome === 'error').length, runtimeRefusals: diagnostics.filter((value) => value.applicationOutcome === 'refused').length, passes: diagnostics.filter((value) => value.selectedKind === 'pass').length, committedModelSpeech: speech.length, worldSpeech: speech.filter((kind) => kind === 'world').length, dmSpeech: speech.filter((kind) => kind === 'dm').length, groupSpeech: speech.filter((kind) => kind === 'group').length, actions: Object.fromEntries(actionCounts), privateChannels: transcripts.filter((channel) => channel.kind !== 'world').length, actors: actors.length, latency: latencySummary(diagnostics), queueWait: queueSummary(diagnostics), tokens: tokenSummary(diagnostics), cost: diagnostics.reduce((sum, value) => sum + (value.cost ?? 0), 0), models: [...byModel.entries()].map(([model, values]) => summarizeModel(model, values)) };
}
/** Summarize one model's timing, retry, usage, and action outcomes. */
function summarizeModel(model: string, values: SocialDiagnostic[]): Record<string, unknown> { return { model, decisions: values.length, providerAttempts: values.reduce((sum, value) => sum + (value.providerAttemptCount ?? (value.providerLatencyMs === null ? 0 : 1)), 0), providerRetries: values.reduce((sum, value) => sum + (value.providerRetryCount ?? 0), 0), firstAttemptSuccesses: values.filter((value) => value.validationOutcome === 'validated' && (value.semanticRetryCount ?? value.retryCount) === 0).length, semanticRetries: values.reduce((sum, value) => sum + (value.semanticRetryCount ?? value.retryCount), 0), passes: values.filter((value) => value.selectedKind === 'pass').length, actions: [...new Set(values.map((value) => value.selectedKind).filter((value): value is string => value !== null))], latency: latencySummary(values), tokens: tokenSummary(values), cost: values.reduce((sum, value) => sum + (value.cost ?? 0), 0) }; }
/** Summarize durable cascades and their terminal outcomes. */
function summarizeCascades(cascades: SocialCascade[]): Array<Record<string, unknown>> { return cascades.map((cascade) => ({ id: cascade.id, state: cascade.state, modelRuns: cascade.modelRuns, committedModelMessages: cascade.committedModelMessages, durationMs: Math.max(0, Date.parse(cascade.updatedAt) - Date.parse(cascade.createdAt)), budgets: { maxModelRuns: cascade.maxModelRuns, maxCommittedModelMessages: cascade.maxCommittedModelMessages } })); }
/** Convert a wait result into a compact machine-readable outcome. */
function summarizeWait(wait: SocialCascadeWait): Record<string, unknown> { return { settled: wait.settled, timedOut: wait.timedOut, state: wait.cascade?.state ?? 'missing' }; }
/** Return median and p95 provider latency. */
function latencySummary(values: SocialDiagnostic[]): Record<string, number | null> { const samples = values.map((value) => value.providerLatencyMs).filter((value): value is number => value !== null).sort((a, b) => a - b); return { medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) }; }
/** Return median and p95 scheduler wait. */
function queueSummary(values: SocialDiagnostic[]): Record<string, number | null> { const samples = values.map((value) => value.queueWaitMs).filter((value): value is number => value !== null).sort((a, b) => a - b); return { medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) }; }
/** Return aggregate provider usage when supplied. */
function tokenSummary(values: SocialDiagnostic[]): Record<string, number> { return { input: values.reduce((sum, value) => sum + (value.inputTokens ?? 0), 0), output: values.reduce((sum, value) => sum + (value.outputTokens ?? 0), 0), total: values.reduce((sum, value) => sum + (value.totalTokens ?? 0), 0) }; }
/** Return one percentile from a sorted sample. */
function percentile(values: number[], fraction: number): number | null { if (!values.length) return null; return values[Math.min(values.length - 1, Math.ceil((values.length - 1) * fraction))]; }
/** Choose a model count appropriate for one scenario family. */
function scenarioModelCount(scenario: string): number { if (scenario === 'single') return 1; if (scenario === 'two') return 2; if (scenario === 'stress') return 7; if (scenario === 'political') return 4; return 3; }
/** Record the exact provider identity and transport family requested for a condition. */
function modelResolution(reference: string): Record<string, string> { const separator = reference.indexOf('/'); const provider = separator > 0 ? reference.slice(0, separator) : reference; const name = separator > 0 ? reference.slice(separator + 1) : reference; const responses = new Set(['muse-spark-1.2-contributor-free', 'muse-spark-1.2-contributor', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']); return { requestedModelRef: reference, resolvedProvider: provider, resolvedNativeModelId: name, transportFamily: provider.startsWith('opencode') && responses.has(name) ? 'responses' : 'chat-completions' }; }
/** Read one command-line option or its fallback. */
function readOption(name: string, fallback: string): string { const prefix = `${name}=`; return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback; }
/** Send one JSON request and preserve the caller's response type. */
async function request<T extends object = JsonResponse>(path: string, method = 'GET', body?: Record<string, unknown>): Promise<T> { const response = await fetch(`${baseUrl}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const value = await response.json() as T & JsonResponse; if (!response.ok) throw new Error(value.error ?? `${method} ${path} failed with ${response.status}`); return value; }
/** Print machine-readable JSON and a compact human summary without hidden reasoning. */
function printResults(results: Record<string, unknown>[]): void { process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`); for (const result of results) process.stdout.write(`Scenario ${String(result.scenario)} completed with pacing ${String(result.pacing)}.\n`); }

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
