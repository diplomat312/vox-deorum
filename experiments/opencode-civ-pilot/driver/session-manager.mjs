// One persistent OpenCode session per civ. Appends observations with
// `opencode run --session <id>` (never a fresh session per turn).
// Parses `--format json` events generically: tool calls + usage + latency.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { normalizeUsage, hitRatio } from "./telemetry.mjs";

function tryParse(line) { try { return JSON.parse(line); } catch { return null; } }

function walk(o, cb) {
  if (!o || typeof o !== "object") return;
  cb(o);
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) v.forEach((x) => walk(x, cb));
    else if (v && typeof v === "object") walk(v, cb);
  }
}

export async function appendToSession({
  dir, sessionId, message, model, agent = "civ", timeoutMs = 300000, title,
}) {
  const started = Date.now();
  const args = ["run", "--dir", dir, "--agent", agent, "--format", "json"];
  if (sessionId) args.push("--session", sessionId);
  if (model) args.push("--model", model);
  if (title) args.push("--title", title);
  args.push(message);
  // stdin ignored: a prompt must fail fast, never hang the loop.
  // The Codex harness exports OPENCODE_SERVER_PASSWORD/USERNAME into our env.
  // Upstream opencode issue: `run` fails with "Session not found" whenever the
  // server-password var is set. Strip both for the child; everything else
  // (auth.json creds, CIV_PILOT_COMMIT_FILE for the MCP server) passes through.
  const runEnv = { ...process.env };
  delete runEnv.OPENCODE_SERVER_PASSWORD;
  delete runEnv.OPENCODE_SERVER_USERNAME;
  const child = spawn("opencode", args, { cwd: dir, shell: false, stdio: ["ignore", "pipe", "pipe"], env: runEnv });
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d.toString(); });
  child.stderr.on("data", (d) => { err += d.toString(); });
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill(); } catch {} resolve(124); }, timeoutMs);
    child.on("close", (c) => { clearTimeout(t); resolve(c ?? 0); });
  });
  const latencyMs = Date.now() - started;
  const toolCalls = [];
  let usageRaw = {};
  let session = sessionId ?? null;
  let finalText = "";
  for (const line of out.split("\n")) {
    const e = tryParse(line);
    if (!e) { continue; }
    walk(e, (o) => {
      const nm = o.tool ?? o.toolName ?? o.name;
      const st8 = o.state && typeof o.state === "object" ? o.state : {};
      if ((o.type && /tool/i.test(String(o.type)) || o.callID) && typeof nm === "string" && /commit_turn|pass|inspect|communicate/.test(nm)) {
        toolCalls.push({
          tool: nm,
          callID: o.callID ?? null,
          status: st8.status ?? o.status ?? null,
          input: st8.input ?? o.input ?? o.arguments ?? o.args ?? null,
          output: capStr(st8.output ?? o.output ?? o.result ?? null, 1500),
          error: capStr(o.error ?? st8.error ?? null, 500),
        });
      }
      if (o.sessionID && !session) session = o.sessionID;
      if (o.session_id && !session) session = o.session_id;
      if (o.session && typeof o.session === "string" && !session) session = o.session;
      if (o.usage && typeof o.usage === "object") usageRaw = { ...usageRaw, ...o.usage };
      for (const k of ["input_tokens", "inputTokens", "output_tokens", "outputTokens", "cached_input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "cache_write_input_tokens", "reasoning_tokens"]) {
        if (typeof o[k] === "number") usageRaw[k] = (usageRaw[k] ?? 0) + o[k];
      }
      if (typeof o.text === "string" && o.type && /result|message|assistant|final/i.test(String(o.type))) {
        if (o.text.length > finalText.length) finalText = o.text;
      }
    });
  }
  // Last resort: session id sometimes surfaces only on stderr or as raw text.
  if (!session) {
    const m = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) session = m[0];
  }
  const norm = normalizeUsage(usageRaw);
  return {
    exitCode: code, latencyMs, toolCalls, sessionId: session,
    usageRaw, uncached: norm.uncached, read: norm.read, write: norm.write,
    output: norm.output, reasoning: norm.reasoning,
    hit_ratio: hitRatio(norm), stderrTail: err.slice(-2000), finalText,
    rawBytes: out.length,
  };
}

export function readCommit(commitFile) {
  try {
    if (!fs.existsSync(commitFile)) return null;
    return JSON.parse(fs.readFileSync(commitFile, "utf8"));
  } catch { return null; }
}

export function clearCommit(commitFile) {
  try { if (fs.existsSync(commitFile)) fs.unlinkSync(commitFile); } catch {}
}
function capStr(v, n) {
  if (v === undefined || v === null) return null;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + "...[trimmed " + (s.length - n) + " chars]" : s;
}
