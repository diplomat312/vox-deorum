import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type JsonRecord = Record<string, any>;

const root = path.resolve('benchmark/social-player-mind-bakeoff-2');
const rawRoot = path.join(root, 'raw');
const outputRoot = path.join(root, 'blind');
const scenarios = [
  { fileName: 'preflight', rawName: 'preflight' },
  { fileName: 'power', rawName: 'power' },
  { fileName: 'role-reversal', rawName: 'reversal' },
  { fileName: 'coalition', rawName: 'coalition' },
  { fileName: 'betrayal', rawName: 'betrayal' },
];
const mapping: Record<string, string> = {
  'Condition A': 'openrouter/minimax/minimax-m2.7:free',
  'Condition B': 'opencode-go/muse-spark-1.2-contributor',
  'Condition C': 'openrouter/google/gemma-4-31b-it:free',
  'Condition D': 'opencode-go/deepseek-v4-flash',
  'Condition E': 'openrouter/thinkingmachines/inkling:free',
  'Condition F': 'opencode-go/longcat-2.0',
  'Condition G': 'openrouter/minimax/minimax-m3:free',
  'Condition H': 'opencode-go/mimo-v2.5',
};

/** Read one raw benchmark export, returning an empty result when that family was not run. */
async function readScenario(scenario: { fileName: string; rawName: string }): Promise<JsonRecord[]> {
  try { return ((JSON.parse(await readFile(path.join(rawRoot, `${scenario.fileName}.json`), 'utf8')) as JsonRecord).results ?? []) as JsonRecord[]; } catch { return []; }
}

/** Write one transcript-only blind scenario without model or provider metadata. */
async function writeBlindScenario(directory: string, scenario: { fileName: string; rawName: string }, result: JsonRecord | undefined): Promise<void> {
  const title = scenario.fileName.replace('-', ' ');
  const lines = [`# ${title[0].toUpperCase()}${title.slice(1)}`];
  if (!result) { lines.push('', 'No condition was run for this scenario.'); await writeFile(path.join(directory, `${scenario.fileName}.md`), `${lines.join('\n')}\n`); return; }
  for (const transcript of result.transcripts ?? []) {
    lines.push('', `## ${transcript.title}`);
    if (!transcript.messages?.length) { lines.push('', 'None.'); continue; }
    for (const message of transcript.messages) lines.push('', `${message.speaker}:`, '', message.text);
  }
  await writeFile(path.join(directory, `${scenario.fileName}.md`), `${lines.join('\n')}\n`);
}

/** Create blank human-review dimensions without pre-populating subjective scores. */
async function writeWorksheet(directory: string): Promise<void> {
  const dimensions = ['Political intelligence', 'Persona differentiation', 'Power sensitivity', 'Coalition reasoning', 'Private/public judgment', 'Strategic subtlety', 'Memory/adaptation', 'Naturalness', 'Excessive assistant behavior', 'Excessive melodrama', 'Overall player-mind plausibility'];
  await writeFile(path.join(directory, 'review-worksheet.md'), `# Review worksheet\n\n${dimensions.map((dimension) => `## ${dimension}\n\nScore (1-5): ____\n\nNotes:\n`).join('\n')}`);
}

/** Compute a compact unblinded operations table from the raw diagnostics. */
function operations(results: JsonRecord[]): JsonRecord[] {
  return results.map((result) => { const metrics = result.metrics ?? {}; return { condition: result.condition?.label, model: result.condition?.modelRefs?.[0], scenario: result.scenario, decisions: metrics.decisions ?? 0, firstAttemptValid: metrics.firstAttemptSuccesses ?? 0, semanticRetries: metrics.semanticRetries ?? 0, providerAttempts: metrics.providerAttempts ?? 0, providerRetries: metrics.providerRetries ?? 0, providerFailures: metrics.providerFailures ?? {}, providerFailureDetails: metrics.providerFailureDetails ?? [], providerLatencies: (result.diagnostics ?? []).map((diagnostic: JsonRecord) => diagnostic.providerLatencyMs).filter((value: unknown): value is number => typeof value === 'number'), queueWaits: (result.diagnostics ?? []).map((diagnostic: JsonRecord) => diagnostic.queueWaitMs).filter((value: unknown): value is number => typeof value === 'number'), cascadeDurations: (result.cascades ?? []).map((cascade: JsonRecord) => cascade.durationMs), actions: metrics.actions ?? {}, features: result.features ?? {} }; });
}

/** Write machine-readable manifest and human-facing operations reports. */
async function main(): Promise<void> {
  const allResults: JsonRecord[] = [];
  for (const scenario of scenarios) allResults.push(...await readScenario(scenario));
  await mkdir(outputRoot, { recursive: true });
  for (const [condition] of Object.entries(mapping)) { const directory = path.join(outputRoot, condition.toLowerCase().replace(' ', '-')); await mkdir(directory, { recursive: true }); for (const scenario of scenarios) await writeBlindScenario(directory, scenario, allResults.find((result) => result.condition?.label?.startsWith(condition) && result.scenario === scenario.rawName)); await writeWorksheet(directory); }
  await mkdir(path.join(root, 'mapping'), { recursive: true }); await mkdir(path.join(root, 'report'), { recursive: true });
  const ops = operations(allResults);
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify({ benchmark: 'social-player-mind-bakeoff-2', seed: 'vd-bakeoff-2', calibrationSha: '5cda76b3', bakeoffHarnessSha: 'f2746767', commonPromptVariant: 'interface', roster: Object.values(mapping), conditionMapping: mapping, scenarios: scenarios.map(({ fileName }) => fileName) }, null, 2)}\n`);
  await writeFile(path.join(root, 'mapping', 'condition-mapping.json'), `${JSON.stringify(mapping, null, 2)}\n`);
  await writeFile(path.join(root, 'report', 'operations.json'), `${JSON.stringify(ops, null, 2)}\n`);
  const lines = ['# Operational summary', '', '| Condition | Model | Scenario | Decisions | First-attempt valid | Semantic retries | Provider attempts | Provider retries | Provider failures | Median provider latency | Median cascade duration |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |'];
  for (const row of ops) lines.push(`| ${row.condition} | ${row.model} | ${row.scenario} | ${row.decisions} | ${row.firstAttemptValid} | ${row.semanticRetries} | ${row.providerAttempts} | ${row.providerRetries} | ${JSON.stringify(row.providerFailures)} | ${median(row.providerLatencies)} ms | ${median(row.cascadeDurations)} ms |`);
  await writeFile(path.join(root, 'report', 'operational-summary.md'), `${lines.join('\n')}\n`);
  const failureLines = ['# Provider failures', '', ...ops.filter((row) => Object.values(row.providerFailures ?? {}).some((value: unknown) => typeof value === 'number' && value > 0) || row.providerFailureDetails.length).map((row) => `- ${row.condition}, ${row.model}, ${row.scenario}: ${JSON.stringify(row.providerFailures)} ${JSON.stringify(row.providerFailureDetails)}`)];
  await writeFile(path.join(root, 'report', 'provider-failures.md'), `${failureLines.join('\n')}\n`);
  await writeFile(path.join(root, 'report', 'request-ledger.md'), `# Request ledger\n\nProvider attempts are taken from diagnostic providerAttemptCount.\n\n${ops.map((row) => `- ${row.condition}, ${row.model}, ${row.scenario}: ${row.providerAttempts} attempts, ${row.providerRetries} provider retries, ${row.semanticRetries} semantic retries`).join('\n')}\n`);
  await writeFile(path.join(root, 'report', 'blind-review-packet.md'), `# Blind review packet\n\nReview each condition folder without opening the private mapping or operations reports first. Every folder contains preflight, power, role-reversal, coalition, and betrayal transcript files plus a blank worksheet.\n\n${Object.keys(mapping).map((condition) => `- [${condition}](../blind/${condition.toLowerCase().replace(' ', '-')}/)`).join('\n')}\n`);
}

/** Return the upper-middle value for a small sorted sample. */
function median(values: unknown): number | null { const samples = (Array.isArray(values) ? values : []).filter((value): value is number => typeof value === 'number').sort((left, right) => left - right); return samples.length ? samples[Math.ceil((samples.length - 1) / 2)] : null; }

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryUrl) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
