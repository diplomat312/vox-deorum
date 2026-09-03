import fs from "node:fs";
const base = process.env.MCP_URL || "http://127.0.0.1:4000/mcp";
let session = null;
export async function callLive(tool, args) {
  async function rpc(method, params) {
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (session) headers["mcp-session-id"] = session;
    const r = await fetch(base, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now() + Math.floor(Math.random() * 1000), method, params }) });
    const sid = r.headers.get("mcp-session-id");
    if (sid) session = sid;
    const text = await r.text();
    const chunks = [...text.matchAll(/^data:\s*(\{.*\})\s*$/gm)].map((m) => m[1]);
    return JSON.parse(chunks.length ? chunks[chunks.length - 1] : text);
  }
  if (!session) {
    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vox-live-harness", version: "1" } });
    await rpc("notifications/initialized", {});
  }
  const out = await rpc("tools/call", { name: tool, arguments: args || {} });
  if (out.error) throw new Error("live MCP " + tool + " error: " + JSON.stringify(out.error).slice(0, 300));
  const res = out.result;
  if (res && res.isError) throw new Error("live MCP " + tool + " tool error: " + JSON.stringify(res.content).slice(0, 300));
  return res;
}
export function liveText(res) {
  try {
    const sc = res?.structuredContent;
    if (sc !== undefined) return sc;
    const c = res?.content?.[0]?.text;
    return JSON.parse(c);
  } catch { return res?.content?.[0]?.text ?? res; }
}
export function cap(obj, n) {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 1);
  return s.length > n ? s.slice(0, n) + "\n...[trimmed " + (s.length - n) + " chars]" : s;
}
