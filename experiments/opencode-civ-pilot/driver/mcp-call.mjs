import fs from "node:fs";
const base = process.env.MCP_URL || "http://127.0.0.1:4000/mcp";
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
let outFile = null;
if (outIdx >= 0) { outFile = args[outIdx + 1]; args.splice(outIdx, 2); }
const [tool, argsJson] = args;
let session = null;
async function rpc(method, params) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (session) headers["mcp-session-id"] = session;
  const r = await fetch(base, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  const sid = r.headers.get("mcp-session-id");
  if (sid) session = sid;
  const text = await r.text();
  const chunks = [...text.matchAll(/^data:\s*(\{.*\})\s*$/gm)].map(m => m[1]);
  const payload = chunks.length ? chunks[chunks.length - 1] : text;
  return JSON.parse(payload);
}
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "codex-play", version: "2" } });
await rpc("notifications/initialized", {});
const out = await rpc("tools/call", { name: tool, arguments: JSON.parse(argsJson || "{}") });
const s = JSON.stringify(out, null, 1);
if (outFile) { fs.writeFileSync(outFile, s); console.log("wrote " + s.length + " chars to " + outFile); }
else console.log(s.slice(0, 6000));
