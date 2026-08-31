import { z } from 'zod';
import type { CivActionDefinition, CivActionExecutionResult, CivActionGateway } from './civ-action-gateway.js';
import type { CivActorBinding } from './civ-actor-binding.js';
import type { CivMcpPort } from './civ-mcp-port.js';

/** Register the narrow, explicit MCP allowlist used by the social player-mind. */
export async function registerExistingCivCapabilities(gateway: CivActionGateway, port: CivMcpPort): Promise<string[]> {
  const available = new Set((await port.getTools()).map((tool) => tool.name)); const registered: string[] = [];
  const definitions: Array<[string, CivActionDefinition]> = [
    ['get-players', readDefinition('Read the normalized player summary from the bound Civ perspective.', z.object({})),],
    ['get-cities', readDefinition('Read normalized visible city information from the bound Civ perspective.', z.object({ Owner: z.string().optional() })),],
    ['reject-agent-deal', nativeDealDefinition()],
  ];
  for (const [actionType, definition] of definitions) { if (!available.has(actionType)) continue; gateway.register(actionType, { ...definition, execute: async (binding, args, operationId) => callMcp(port, actionType, binding, args, operationId) }); registered.push(actionType); }
  return registered;
}

/** Construct a read-only model-facing capability whose player is inserted by the gateway. */
function readDefinition(description: string, inputSchema: z.ZodType): CivActionDefinition { return { category: 'READ', description, inputSchema: inputSchema as z.ZodType<Record<string, unknown>>, modelFacing: true, execute: async () => ({ state: 'FAILED', failureClass: 'unbound-mcp-handler' }) }; }

/** Construct an allowlisted native diplomacy capability over the existing safe deal path. */
function nativeDealDefinition(): CivActionDefinition { return { category: 'NATIVE_DIPLOMACY', description: 'Reject an open agent deal proposal addressed to the bound Civ actor.', inputSchema: z.object({ targetPlayerId: z.number().int().min(-1), proposalMessageId: z.number().int(), content: z.string().max(12000).optional() }), modelFacing: true, execute: async () => ({ state: 'FAILED', failureClass: 'unbound-mcp-handler' }) }; }

/** Call the canonical MCP client with the acting player structurally inserted. */
async function callMcp(port: CivMcpPort, actionType: string, binding: CivActorBinding, args: Record<string, unknown>, operationId: string): Promise<CivActionExecutionResult> {
  const underlying = actionType === 'reject-agent-deal'
    ? { PlayerAID: binding.playerId, PlayerBID: args.targetPlayerId, ProposalMessageID: args.proposalMessageId, SpeakerID: binding.playerId, Content: args.content, ExpectedGameID: binding.gameId }
    : { ...args, PlayerID: binding.playerId };
  const result = await port.callTool(actionType, underlying); const envelope = result as { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> } | undefined; if (envelope?.isError) return { state: 'FAILED', failureClass: 'mcp-error', resultSummary: `${actionType} returned an MCP error` }; const value = envelope?.structuredContent ?? result; if (actionType === 'reject-agent-deal' && typeof value === 'object' && value !== null && 'Result' in value && (value as { Result?: unknown }).Result === 'conflict') return { state: 'REFUSED', failureClass: 'legality-refusal', resultSummary: JSON.stringify(value).slice(0, 1000) }; return { state: 'CONFIRMED', resultSummary: JSON.stringify(value ?? envelope?.content ?? null).slice(0, 4000), readbackSummary: `MCP ${actionType} completed for bound player ${binding.playerId}`, };
}
