// Cache telemetry. Per physical model request if possible; sums for cumulative.
// cache_hit_ratio = cache_read / (cache_read + uncached_input + cache_write)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function scrubEnv() {
  const e = { ...process.env };
  delete e.OPENCODE_SERVER_PASSWORD;
  delete e.OPENCODE_SERVER_USERNAME;
  return e;
}

// Authoritative per-turn usage via `opencode export`: sums assistant-message
// tokens for messages appended since prevCount. Export works with stock env,
// but scrubbed anyway for the `run`-adjacent code paths that share this env.
export function exportUsageDelta(sessionId, prevCount) {
  const r = spawnSync("opencode", ["export", sessionId], { encoding: "utf8", env: scrubEnv(), maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return null;
  let data;
  try { data = JSON.parse(r.stdout); } catch { return null; }
  const msgs = data.messages ?? [];
  const agg = { uncached: 0, read: 0, write: 0, output: 0, reasoning: 0 };
  // Compaction detection: a compacted session rewrites history, so the
  // message array shrinks below prevCount and slice(prevCount) would
  // silently undercount to zero. Flag it and aggregate over the whole
  // (rewritten) history so the row stays honest; the cache ledger in
  // NIGHT-LOG records exactly what changed. None observed through 110 msgs.
  const compaction = msgs.length < prevCount;
  const window = compaction ? msgs : msgs.slice(prevCount);
  for (const m of window) {
    if (m?.info?.role !== "assistant") continue;
    const t = m.info.tokens ?? {};
    agg.uncached += t.input ?? 0;
    agg.read += t.cache?.read ?? 0;
    agg.write += t.cache?.write ?? 0;
    agg.output += t.output ?? 0;
    agg.reasoning += t.reasoning ?? 0;
  }
  return { ...agg, newCount: msgs.length, prevCount, compaction };
}

export function normalizeUsage(raw = {}) {
  const u = raw ?? {};
  const uncached =
    u.uncached_input_tokens ?? u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? 0;
  const read =
    u.cache_read_input_tokens ?? u.cached_input_tokens ?? u.cacheReadTokens ??
    u.cachedTokens ?? u.cache_read ?? 0;
  const write =
    u.cache_creation_input_tokens ?? u.cache_write_input_tokens ?? u.cacheWriteTokens ?? 0;
  const output = u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? 0;
  const reasoning =
    u.reasoning_tokens ?? u.reasoningTokens ?? u.thinking_tokens ?? 0;
  return { uncached, read, write, output, reasoning, raw: u };
}

export function hitRatio(n) {
  const d = n.read + n.uncached + n.write;
  return d > 0 ? n.read / d : 0;
}

export function appendTelemetry(file, rec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(rec) + "\n");
}

export function summarize(file) {
  if (!fs.existsSync(file)) return null;
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const tot = { uncached: 0, read: 0, write: 0, output: 0 };
  for (const r of rows) {
    tot.uncached += r.uncached_input_tokens ?? 0;
    tot.read += r.cache_read_input_tokens ?? 0;
    tot.write += r.cache_write_input_tokens ?? 0;
    tot.output += r.output_tokens ?? 0;
  }
  const all = tot.uncached + tot.read + tot.write;
  return {
    requests: rows.length,
    ...tot,
    cumulative_hit_ratio: all > 0 ? tot.read / all : 0,
    compactions: rows.filter((r) => r.compaction).length,
  };
}
