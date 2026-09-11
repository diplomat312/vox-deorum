// The seam between the harness and Vox Deorum's MCP server.
//
// The harness reaches a real game the same way every other caller does, through
// the MCP tools, so legality, validation and logging stay in one place. This is
// deliberately a very small interface: one call, one listing, one close. A fake
// implementation answers it in tests, which is what lets the live path be
// written and verified without launching Civilization V.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "../../utils/logger.js";

// What a Vox MCP connection has to be able to do.
export interface VoxConnector {
  // Call one tool and return its text result. Throws when the tool refuses.
  call(name: string, args?: Record<string, unknown>): Promise<VoxToolResult>;
  // The tools the server offers, which is how a run checks its own assumptions
  // before it starts rather than discovering them on turn forty.
  listTools(): Promise<string[]>;
  // Release the connection.
  close(): Promise<void>;
}

// What one tool call produced.
export interface VoxToolResult {
  // The text the tool returned, which is what a caller usually parses.
  text: string;
  // Whether the server marked the call as an error.
  isError: boolean;
}

// How long a tool call may take, in milliseconds. Vox describes its own servers
// as slow, and a call that walks game state can legitimately run long, so this
// is generous while still being bounded.
const callTimeoutMs = 600000;

// The address the MCP server answers on by default, matching the rest of the
// repository, and the environment variable that overrides it.
export const defaultMcpEndpoint = "http://127.0.0.1:4000/mcp";

// A connector over the MCP SDK's streamable HTTP transport.
export class HttpVoxConnector implements VoxConnector {
  // The underlying client, created on connect.
  private client: Client | null = null;

  // The endpoint this connector talks to.
  private readonly endpoint: string;

  // Build a connector for one endpoint.
  constructor(endpoint: string = process.env.VOX_MCP_ENDPOINT ?? defaultMcpEndpoint) {
    this.endpoint = endpoint;
  }

  // Open the connection. Calling it twice is harmless.
  async connect(): Promise<void> {
    if (this.client) return;
    const client = new Client({ name: "opencode-harness", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.endpoint)));
    this.client = client;
    logger.info("Connected to the Vox MCP server at " + this.endpoint);
  }

  // Call one tool.
  async call(name: string, args: Record<string, unknown> = {}): Promise<VoxToolResult> {
    if (!this.client) throw new Error("The Vox MCP connection is not open");
    const result = await this.client.callTool({ name, arguments: args }, undefined, {
      timeout: callTimeoutMs,
      resetTimeoutOnProgress: true
    });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .filter((part) => (part as { type?: string }).type === "text")
      .map((part) => String((part as { text?: unknown }).text ?? ""))
      .join("\n");
    return { text, isError: result.isError === true };
  }

  // The tools the server offers.
  async listTools(): Promise<string[]> {
    if (!this.client) throw new Error("The Vox MCP connection is not open");
    const listed = await this.client.listTools();
    return (listed.tools ?? []).map((tool) => tool.name);
  }

  // Close the connection.
  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.close().catch((error) => logger.warn("Closing the Vox MCP connection failed: " + String(error)));
  }
}
