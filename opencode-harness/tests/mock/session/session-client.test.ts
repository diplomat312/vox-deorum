// Covers the seat session client: how a response is read, and how a seat keeps
// one session. The server is a local stub, so nothing here reaches a model.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTurnResult } from "../../../src/session/session-client.js";
import { SessionClient } from "../../../src/session/session-client.js";
import type { RunningServer } from "../../../src/session/opencode-server.js";

// A response shaped the way the server returns one, for the parsing tests.
const fullResponse = {
  info: {
    providerID: "opencode-go",
    modelID: "deepseek-v4.1-flash",
    cost: 0.00601215,
    tokens: { total: 40248, input: 189, output: 123, reasoning: 61, cache: { read: 39936, write: 0 } }
  },
  parts: [
    { type: "step-start" },
    { type: "reasoning", text: "Train A arrives at 18:07." },
    { type: "reasoning", text: "Train B arrives at 17:57." },
    {
      type: "tool",
      tool: "vox-civ_inspect",
      callID: "call_1",
      state: { status: "completed", input: { subject: "self" }, output: "{\"gold\":0}" }
    },
    { type: "text", text: "B arrives first by 10 minutes." },
    { type: "something-new", text: "kept" }
  ]
};

describe("reading a model response", () => {
  it("should keep reasoning, text and tool calls apart", () => {
    const result = readTurnResult("ses_1", "opencode-go/deepseek-v4.1-flash", fullResponse, 42);

    expect(result.reasoning).toBe("Train A arrives at 18:07.\n\nTrain B arrives at 17:57.");
    expect(result.modelText).toBe("B arrives first by 10 minutes.");
    expect(result.toolCalls).toEqual([
      {
        tool: "vox-civ_inspect",
        callID: "call_1",
        status: "completed",
        input: { subject: "self" },
        output: "{\"gold\":0}",
        error: null
      }
    ]);
    expect(result.latencyMs).toBe(42);
  });

  it("should read the token, cache and cost fields", () => {
    const result = readTurnResult("ses_1", "model", fullResponse, 1);

    expect(result.usage).toEqual({
      input: 189,
      output: 123,
      reasoning: 61,
      cacheRead: 39936,
      cacheWrite: 0,
      total: 40248,
      cost: 0.00601215
    });
  });

  it("should keep a part type it does not know instead of dropping it", () => {
    const result = readTurnResult("ses_1", "model", fullResponse, 1);

    expect(result.unknownParts).toEqual(["something-new"]);
  });

  it("should survive a response with no reasoning and no parts", () => {
    const result = readTurnResult("ses_1", "model", {}, 5);

    expect(result.reasoning).toBeNull();
    expect(result.modelText).toBeNull();
    expect(result.toolCalls).toEqual([]);
    expect(result.usage.total).toBe(0);
    expect(result.usage.cost).toBeNull();
  });
});

// A stub server that records the requests it receives, so a test can prove
// which routes were called.
function startStub(onRequest: (request: IncomingMessage, body: string) => { status: number; body: unknown }): Promise<{
  server: Server;
  port: number;
  requests: string[];
}> {
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      requests.push(request.method + " " + request.url);
      const result = onRequest(request, body);
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

describe("the seat session client", () => {
  let stub: { server: Server; port: number; requests: string[] } | null = null;
  let server: RunningServer | null = null;

  beforeAll(async () => {
    stub = await startStub((request) => {
      if (request.method === "POST" && request.url === "/session") return { status: 200, body: { id: "ses_korea" } };
      if (request.method === "POST" && request.url === "/session/ses_korea/message") {
        return { status: 200, body: fullResponse };
      }
      if (request.method === "GET" && request.url === "/session/ses_korea/message") {
        return { status: 200, body: [{ info: {} }, { info: {} }] };
      }
      if (request.url === "/broken") return { status: 500, body: { error: "nope" } };
      return { status: 404, body: { error: "not found" } };
    });
    server = {
      url: "http://127.0.0.1:" + stub.port,
      credentials: { username: "harness", password: "secret" }
    };
  });

  afterAll(() => {
    stub?.server.close();
  });

  it("should refuse to send an observation before a session exists", async () => {
    const client = new SessionClient(server as RunningServer, { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" });

    await expect(client.sendObservation("korea", "TURN 1")).rejects.toThrowError(/has no session/);
  });

  it("should open one session and keep it across turns", async () => {
    const client = new SessionClient(server as RunningServer, { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" });
    const session = await client.openSeat("korea");
    const first = await client.sendObservation("korea", "TURN 1");
    const second = await client.sendObservation("korea", "TURN 2");

    expect(session).toBe("ses_korea");
    expect(client.sessionOf("korea")).toBe("ses_korea");
    expect(first.reasoning).toContain("Train A arrives");
    expect(second.session).toBe("ses_korea");
    expect(stub?.requests.filter((entry) => entry === "POST /session/ses_korea/message")).toHaveLength(2);
  });

  it("should refuse a second session for the same seat", async () => {
    const client = new SessionClient(server as RunningServer, { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" });
    await client.openSeat("siam");

    await expect(client.openSeat("siam")).rejects.toThrowError(/keeps one session/);
  });

  it("should use a per-seat model override when one is given", async () => {
    const client = new SessionClient(
      server as RunningServer,
      { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" },
      { siam: { providerID: "opencode-zen", modelID: "muse-spark-1.3" } }
    );

    expect(client.modelOf("siam")).toEqual({ providerID: "opencode-zen", modelID: "muse-spark-1.3" });
    expect(client.modelOf("korea")).toEqual({ providerID: "opencode-go", modelID: "deepseek-v4.1-flash" });
  });

  it("should list the messages a session holds", async () => {
    const client = new SessionClient(server as RunningServer, { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" });
    await client.openSeat("korea");

    expect(await client.listMessages("korea")).toHaveLength(2);
  });

  it("should report a refused request instead of returning nothing", async () => {
    const failing = await startStub(() => ({ status: 500, body: { error: "nope" } }));
    const client = new SessionClient(
      { url: "http://127.0.0.1:" + failing.port, credentials: { username: "a", password: "b" } },
      { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" }
    );

    try {
      await expect(client.openSeat("korea")).rejects.toThrowError(/HTTP 500/);
    } finally {
      failing.server.close();
    }
  });
});
