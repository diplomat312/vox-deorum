import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { mcpClient, type GameEventNotification } from '../../../utils/models/mcp-client.js';

/** Minimal MCP surface shared by production Civ integration and deterministic tests. */
export interface CivMcpPort { getTools(): Promise<Tool[]>; callTool(name: string, args?: Record<string, unknown>): Promise<unknown>; onNotification(handler: (event: GameEventNotification) => void): () => void; }

/** Adapt the existing singleton MCP client without creating another transport or poller. */
export const mcpCivPort: CivMcpPort = { getTools: () => mcpClient.getTools(), callTool: (name, args) => mcpClient.callTool(name, args), onNotification: (handler) => mcpClient.onNotification(handler) };
