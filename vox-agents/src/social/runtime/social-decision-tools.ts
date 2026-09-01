import { tool, type Tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { SocialDecision } from '../types.js';
import type { SocialReferenceSet } from '../context/social-context-builder.js';

export interface DecisionToolDefinition { name: string; actionName: string; description: string; inputSchema: z.ZodType; }
export type SocialDecisionToolScope = 'channel-reaction' | 'player-mind' | 'invitation-decision';

/** Build only the semantic actions legal for the current intention. */
export function createSocialDecisionTools(scope: SocialDecisionToolScope, references: SocialReferenceSet, extra: DecisionToolDefinition[] = []): ToolSet {
  const tools: Record<string, Tool> = {};
  if (scope !== 'invitation-decision') tools.social_pass = tool({ description: 'Pass without taking a social action.', inputSchema: z.object({ reason: z.string().max(200).optional() }), strict: true });
  const dmActors = references.dmActors ?? references.actors;
  const groupParticipants = references.groupParticipants ?? references.actors;
  const messageRooms = references.messageRooms ?? references.channels;
  const inviteRooms = references.inviteRooms ?? references.channels;
  const inviteParticipants = references.inviteParticipants ?? references.actors;
  const inviteTargets = references.inviteTargets ?? (inviteRooms.length > 0 && inviteParticipants.length > 0 ? inviteRooms.map((room) => ({ roomRef: room.ref, participantRefs: inviteParticipants.map((participant) => participant.ref) })) : []);
  const leaveRooms = references.leaveRooms ?? references.channels;
  if (scope === 'channel-reaction') {
    tools.social_reply = tool({ description: 'Reply in the current room.', inputSchema: z.object({ text: z.string().min(1).max(12000), replyToMessageId: z.number().int().positive().optional() }), strict: true });
  }
  if ((scope === 'channel-reaction' || scope === 'player-mind') && dmActors.length > 0) {
    tools.social_send_dm = tool({ description: 'Send a private message to one listed participant.', inputSchema: z.object({ participantRef: referenceSchema(dmActors), text: z.string().min(1).max(12000) }), strict: true });
    tools.social_start_group = tool({ description: 'Start a private titled group with at least one listed participant.', inputSchema: z.object({ title: z.string().min(1).max(200), participantRefs: z.array(referenceSchema(groupParticipants)).min(1).max(8), text: z.string().min(1).max(12000).optional() }), strict: true });
  }
  if (scope === 'player-mind') {
    if (messageRooms.length > 0) tools.social_send_room_message = tool({ description: 'Send a message to one listed visible room.', inputSchema: z.object({ roomRef: referenceSchema(messageRooms), text: z.string().min(1).max(12000) }), strict: true });
    if (inviteTargets.length > 0) tools.social_invite = tool({ description: 'Invite one listed participant to one listed group room.', inputSchema: inviteChoiceSchema(inviteTargets), strict: true });
    if (leaveRooms.length > 0) tools.social_leave_group = tool({ description: 'Leave one listed group room.', inputSchema: z.object({ roomRef: referenceSchema(leaveRooms) }), strict: true });
  }
  if (scope === 'invitation-decision') tools.social_respond_invitation = tool({ description: 'Accept or decline the invitation described in the situation.', inputSchema: z.object({ accept: z.boolean() }), strict: true });
  for (const definition of extra) {
    if (!definition.name.startsWith('environment_')) throw new Error(`Environment decision tool must be namespaced: ${definition.name}`);
    tools[definition.name] = tool({ description: definition.description, inputSchema: definition.inputSchema as any, strict: true });
  }
  return tools;
}

/** Decode exactly one semantic tool call into a side-effect-free decision. */
export function decodeSocialDecision(calls: readonly unknown[], extra: DecisionToolDefinition[] = []): SocialDecision {
  if (calls.length !== 1) throw new Error(`invalid-output: expected exactly one decision tool call, received ${calls.length}`);
  const call = calls[0] as { toolName?: unknown; input?: unknown };
  if (typeof call.toolName !== 'string') throw new Error('invalid-output: decision tool name is missing');
  const input = call.input as Record<string, unknown>;
  if (!input || typeof input !== 'object') throw new Error('invalid-output: decision arguments are missing');
  switch (call.toolName) {
    case 'social_pass': return { kind: 'pass', reasonCode: typeof input.reason === 'string' ? input.reason : undefined };
    case 'social_reply': return { kind: 'reply', content: requiredText(input.text, 'text'), replyToMessageId: positiveNumber(input.replyToMessageId) };
    case 'social_send_dm': return { kind: 'send_dm', participantRef: requiredRef(input.participantRef, 'participantRef'), content: requiredText(input.text, 'text') };
    case 'social_start_group': return { kind: 'start_group', title: boundedText(input.title, 'title', 200), participantRefs: requiredRefs(input.participantRefs), initialMessage: input.text === undefined ? undefined : requiredText(input.text, 'text') };
    case 'social_send_room_message': return { kind: 'send_message', roomRef: requiredRef(input.roomRef, 'roomRef'), content: requiredText(input.text, 'text') };
    case 'social_invite': return { kind: 'invite_actor', roomRef: requiredRef(input.roomRef, 'roomRef'), participantRef: requiredRef(input.participantRef, 'participantRef') };
    case 'social_respond_invitation': if (typeof input.accept !== 'boolean') throw new Error('invalid-output: accept must be boolean'); return { kind: 'respond_invitation', accepted: input.accept };
    case 'social_leave_group': return { kind: 'leave_group', roomRef: requiredRef(input.roomRef, 'roomRef') };
    default: {
      const environment = extra.find((definition) => definition.name === call.toolName);
      if (!environment) throw new Error(`invalid-output: unknown decision tool ${call.toolName}`);
      const parsed = environment.inputSchema.safeParse(input);
      if (!parsed.success) throw new Error(`invalid-output: ${call.toolName} arguments failed validation`);
      return { kind: 'environment_action', actionName: environment.actionName, arguments: parsed.data as Record<string, unknown> };
    }
  }
}

/** Build a schema that only accepts the references authorized for this run. */
function referenceSchema(references: Array<{ ref: string }>): z.ZodType<string> {
  if (references.length === 0) return z.never();
  if (references.length === 1) return z.literal(references[0].ref);
  return z.enum(references.map((reference) => reference.ref) as [string, ...string[]]);
}

/** Build a compact invite schema containing only legal room and participant pairs. */
function inviteChoiceSchema(targets: Array<{ roomRef: string; participantRefs: string[] }>): z.ZodType<Record<string, string>> {
  const choices = targets.flatMap((target) => target.participantRefs.map((participantRef) => z.object({ roomRef: z.literal(target.roomRef), participantRef: z.literal(participantRef) })));
  if (choices.length === 1) return choices[0] as z.ZodType<Record<string, string>>;
  return z.union(choices as [typeof choices[0], typeof choices[0], ...typeof choices]);
}

/** Validate a bounded model text field before converting it to a runtime decision. */
function requiredText(value: unknown, field: string): string { return boundedText(value, field, 12000); }
/** Validate a short model reference without accepting an omitted value. */
function requiredRef(value: unknown, field: string): string { if (typeof value !== 'string' || value.trim() === '') throw new Error(`invalid-output: ${field} is required`); return value; }
/** Validate a bounded text field. */
function boundedText(value: unknown, field: string, maximum: number): string { if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) throw new Error(`invalid-output: ${field} is invalid`); return value; }
/** Validate an optional positive message ID. */
function positiveNumber(value: unknown): number | undefined { if (value === undefined) return undefined; if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error('invalid-output: replyToMessageId is invalid'); return value; }
/** Validate a nonempty list of model references. */
function requiredRefs(value: unknown): string[] { if (!Array.isArray(value) || value.length < 1 || value.some((item) => typeof item !== 'string' || item.trim() === '') || value.length > 8) throw new Error('invalid-output: participantRefs is invalid'); return [...new Set(value as string[])]; }
