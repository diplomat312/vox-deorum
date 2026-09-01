/**
 * @module political-memory/political-memory-tools
 *
 * Constrained support tools for unified civilization minds. The active parameters provide the
 * owner and game scope, so models never choose which civilization owns a memory record.
 */

import { Tool } from 'ai';
import { z } from 'zod';
import type { PoliticalMemoryStore } from './political-memory-store.js';
import type { PoliticalEvidenceRef, PoliticalMemoryScope } from './types.js';
import type { StrategistParameters } from '../strategist/strategy-parameters.js';
import { getRecentGameState } from '../strategist/strategy-parameters.js';
import type { VoxContext } from '../infra/vox-context.js';
import { createSimpleTool } from '../utils/tools/simple-tools.js';

const evidenceSchema = z.array(z.union([
  z.object({ kind: z.literal('transcript'), id: z.string() }),
  z.object({ kind: z.literal('deal'), id: z.string() }),
  z.object({ kind: z.literal('game-event'), id: z.string() }),
  z.object({ kind: z.literal('wake'), traceId: z.string() }),
])).optional();

const resolveGoalSchema = z.object({ Id: z.string(), Status: z.enum(['completed', 'abandoned']) });
const resolveCommitmentSchema = z.object({ Id: z.string(), Status: z.enum(['fulfilled', 'broken', 'expired', 'withdrawn', 'disputed']) });
const resolveBeliefSchema = z.object({ Id: z.string(), Status: z.enum(['superseded', 'disconfirmed']) });
const resolveProjectSchema = z.object({ Id: z.string(), Status: z.enum(['completed', 'abandoned']) });

/** Return the active civilization's durable memory store or explain a missing integration. */
function requireStore(parameters: StrategistParameters): PoliticalMemoryStore {
  if (!parameters.politicalMemoryStore) throw new Error('Political memory is not available for this session.');
  return parameters.politicalMemoryStore;
}

/** Construct the runtime-owned game and civilization scope for one mutation. */
function scope(parameters: StrategistParameters): PoliticalMemoryScope {
  return { gameId: parameters.gameID, ownerPlayerId: parameters.playerID, turn: parameters.turn };
}

/** Validate that a model-selected counterpart is a distinct known major player when facts exist. */
function validateCounterpart(parameters: StrategistParameters, playerId: number): void {
  if (!Number.isInteger(playerId) || playerId === parameters.playerID) throw new Error('Counterpart must be a distinct civilization seat.');
  const players = getRecentGameState(parameters)?.players;
  if (players && Object.keys(players).length > 0 && players[String(playerId)] === undefined) throw new Error('Counterpart is not present in the current visible civilization roster.');
}

/** Validate every model-selected counterpart without allowing the owner to become a party. */
function validateCounterparts(parameters: StrategistParameters, playerIds: number[]): void {
  if (playerIds.length > 8) throw new Error('A memory record may name at most eight counterpart civilizations.');
  for (const playerId of [...new Set(playerIds)]) validateCounterpart(parameters, playerId);
}

/** Convert a validated optional evidence list to the shared semantic type. */
function evidence(value: PoliticalEvidenceRef[] | undefined): PoliticalEvidenceRef[] {
  return value ?? [];
}

/** Return a stable tool result string without allowing one rejected mutation to abort the wake. */
function resultText(label: string, id: string): string {
  return `${label} recorded as ${id}. This support action does not end the current wake.`;
}

/** Create all constrained semantic-memory tools for a single unified context. */
export function createPoliticalMemoryTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
  const setGoal = createSimpleTool({ name: 'set-political-goal', description: 'Record one durable, politically consequential goal for our civilization. Use sparingly.', inputSchema: z.object({ Title: z.string().min(1), Description: z.string().optional(), Priority: z.enum(['low', 'medium', 'high', 'critical']), Rationale: z.string().optional(), Evidence: evidenceSchema }), execute: async (input, parameters, options) => { const record = requireStore(parameters).createGoal(scope(parameters), { title: input.Title, description: input.Description, priority: input.Priority, rationale: input.Rationale, evidence: evidence(input.Evidence) }, options.toolCallId); return resultText('Goal', record.id); } }, context);
  const resolveGoal = createSimpleTool({ name: 'resolve-political-goal', description: 'Resolve one of our existing political goals without deleting its history.', inputSchema: resolveGoalSchema, execute: async (input, parameters, options) => { const record = requireStore(parameters).resolveGoal(scope(parameters), input.Id, input.Status, options.toolCallId); return resultText(`Goal ${record.status}`, record.id); } }, context);
  const recordCommitment = createSimpleTool({ name: 'record-commitment', description: 'Record a consequential promise, threat, request, informal agreement, or obligation involving another civilization. This is a support action, not a terminal action.', inputSchema: z.object({ Parties: z.array(z.number().int()).min(1), Kind: z.enum(['promise', 'conditional-promise', 'threat', 'request', 'informal-agreement', 'deal-obligation']), Summary: z.string().min(1), Terms: z.string().optional(), DueTurn: z.number().int().optional(), Visibility: z.enum(['private', 'public']), Evidence: evidenceSchema }), execute: async (input, parameters, options) => { validateCounterparts(parameters, input.Parties); const record = requireStore(parameters).recordCommitment(scope(parameters), { parties: input.Parties, kind: input.Kind, summary: input.Summary, terms: input.Terms, dueTurn: input.DueTurn, visibility: input.Visibility, evidence: evidence(input.Evidence) }, options.toolCallId); return resultText('Commitment', record.id); } }, context);
  const resolveCommitment = createSimpleTool({ name: 'resolve-commitment', description: 'Move an existing commitment to a terminal historical state such as fulfilled or broken.', inputSchema: resolveCommitmentSchema, execute: async (input, parameters, options) => { const record = requireStore(parameters).resolveCommitment(scope(parameters), input.Id, input.Status, options.toolCallId); return resultText(`Commitment ${record.status}`, record.id); } }, context);
  const adjustRelationship = createSimpleTool({ name: 'adjust-political-relationship', description: 'Make a constrained subjective relationship update. These values are our private assessment, not Civ diplomacy modifiers.', inputSchema: z.object({ CounterpartPlayerId: z.number().int(), Dimension: z.enum(['trust', 'grievance', 'favor', 'threat']), Direction: z.enum(['increase', 'decrease']), Magnitude: z.enum(['slight', 'moderate', 'major']), Reason: z.string().optional(), Evidence: evidenceSchema }), execute: async (input, parameters, options) => { validateCounterpart(parameters, input.CounterpartPlayerId); const record = requireStore(parameters).adjustRelationship(scope(parameters), { counterpartPlayerId: input.CounterpartPlayerId, dimension: input.Dimension, direction: input.Direction, magnitude: input.Magnitude, reason: input.Reason, evidence: evidence(input.Evidence) }, options.toolCallId); return resultText('Relationship assessment', String(record.counterpartPlayerId)); } }, context);
  const updateBelief = createSimpleTool({ name: 'update-political-belief', description: 'Record or update one uncertain political belief. Do not use this for authoritative game facts.', inputSchema: z.object({ Id: z.string().optional(), Subject: z.string().min(1), Claim: z.string().min(1), Confidence: z.enum(['low', 'medium', 'high']), Evidence: evidenceSchema }), execute: async (input, parameters, options) => { const record = requireStore(parameters).upsertBelief(scope(parameters), { id: input.Id, subject: input.Subject, claim: input.Claim, confidence: input.Confidence, evidence: evidence(input.Evidence) }, options.toolCallId); return resultText('Belief', record.id); } }, context);
  const resolveBelief = createSimpleTool({ name: 'resolve-political-belief', description: 'Mark an uncertain political belief as superseded or disconfirmed.', inputSchema: resolveBeliefSchema, execute: async (input, parameters, options) => { const record = requireStore(parameters).resolveBelief(scope(parameters), input.Id, input.Status, options.toolCallId); return resultText(`Belief ${record.status}`, record.id); } }, context);
  const rememberEpisode = createSimpleTool({ name: 'remember-political-episode', description: 'Remember one sparse, important political episode such as cooperation, betrayal, or crisis.', inputSchema: z.object({ Turn: z.number().int().optional(), Importance: z.enum(['medium', 'high', 'critical']), Summary: z.string().min(1), CounterpartPlayerIds: z.array(z.number().int()).optional(), Tags: z.array(z.string()).optional(), Evidence: evidenceSchema }), execute: async (input, parameters, options) => { validateCounterparts(parameters, input.CounterpartPlayerIds ?? []); const record = requireStore(parameters).rememberEpisode(scope(parameters), { turn: input.Turn, importance: input.Importance, summary: input.Summary, counterpartPlayerIds: input.CounterpartPlayerIds, tags: input.Tags, evidence: evidence(input.Evidence) }, options.toolCallId); return resultText('Episode', record.id); } }, context);
  const setProject = createSimpleTool({ name: 'set-political-project', description: 'Create one durable multi-turn diplomatic project for our civilization.', inputSchema: z.object({ Title: z.string().min(1), Description: z.string().optional(), CounterpartPlayerIds: z.array(z.number().int()).optional(), Priority: z.enum(['low', 'medium', 'high']), Evidence: evidenceSchema }), execute: async (input, parameters, options) => { validateCounterparts(parameters, input.CounterpartPlayerIds ?? []); const record = requireStore(parameters).createProject(scope(parameters), { title: input.Title, description: input.Description, counterpartPlayerIds: input.CounterpartPlayerIds, priority: input.Priority, evidence: evidence(input.Evidence) }, options.toolCallId); return resultText('Project', record.id); } }, context);
  const resolveProject = createSimpleTool({ name: 'resolve-political-project', description: 'Resolve an existing multi-turn political project without deleting its history.', inputSchema: resolveProjectSchema, execute: async (input, parameters, options) => { const record = requireStore(parameters).resolveProject(scope(parameters), input.Id, input.Status, options.toolCallId); return resultText(`Project ${record.status}`, record.id); } }, context);
  return { 'set-political-goal': setGoal, 'resolve-political-goal': resolveGoal, 'record-commitment': recordCommitment, 'resolve-commitment': resolveCommitment, 'adjust-political-relationship': adjustRelationship, 'update-political-belief': updateBelief, 'resolve-political-belief': resolveBelief, 'remember-political-episode': rememberEpisode, 'set-political-project': setProject, 'resolve-political-project': resolveProject };
}
