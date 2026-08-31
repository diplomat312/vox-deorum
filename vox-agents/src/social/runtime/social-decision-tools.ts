import { tool, type Tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { SocialDecision } from '../types.js';

/** A model-facing environment action definition with no execution callback. */
export interface DecisionToolDefinition { name: string; actionName: string; description: string; inputSchema: z.ZodType; }

const decisionSchemas = {
  social_pass: z.object({ reasonCode: z.string().max(200).optional() }),
  social_send_message: z.object({ channelId: z.string().min(1).optional(), content: z.string().min(1).max(12000), replyToMessageId: z.number().int().positive().optional() }),
  social_send_dm: z.object({ targetActorId: z.string().min(1), content: z.string().min(1).max(12000) }),
  social_create_group: z.object({ title: z.string().min(1).max(200), invitedActorIds: z.array(z.string().min(1)).max(8), initialMessage: z.string().min(1).max(12000).optional() }),
  social_invite_actor: z.object({ channelId: z.string().min(1), actorId: z.string().min(1) }),
  social_resolve_invitation: z.object({ channelId: z.string().min(1), accepted: z.boolean() }),
  social_leave_group: z.object({ channelId: z.string().min(1) }),
  social_update_memory: z.object({ expectedRevision: z.number().int().nonnegative(), content: z.string().max(12000) }),
} as const;

/** Build side-effect-free tools that let a model propose exactly one runtime action. */
export function createSocialDecisionTools(extra: DecisionToolDefinition[] = []): ToolSet {
  const tools: Record<string, Tool> = {};
  for (const [name, inputSchema] of Object.entries(decisionSchemas)) {
    tools[name] = tool({ description: decisionDescription(name), inputSchema: inputSchema as any, strict: true });
  }
  for (const definition of extra) {
    if (!definition.name.startsWith('environment_')) throw new Error(`Environment decision tool must be namespaced: ${definition.name}`);
    if (tools[definition.name]) throw new Error(`Duplicate decision tool: ${definition.name}`);
    tools[definition.name] = tool({ description: definition.description, inputSchema: definition.inputSchema as any, strict: true });
  }
  return tools;
}

/** Decode and validate one provider tool call into a generic SocialDecision. */
export function decodeSocialDecision(calls: readonly unknown[], extra: DecisionToolDefinition[] = []): SocialDecision {
  if (calls.length !== 1) throw new Error(`invalid-output: expected exactly one decision tool call, received ${calls.length}`);
  const call = calls[0] as { toolName?: unknown; input?: unknown };
  if (typeof call.toolName !== 'string') throw new Error('invalid-output: decision tool name is missing');
  const input = call.input;
  const parsed = parseDecisionCall(call.toolName, input, extra);
  if (!parsed) throw new Error(`invalid-output: unknown decision tool ${call.toolName}`);
  return parsed;
}

/** Return a short description that reinforces one-call, proposal-only semantics. */
function decisionDescription(name: string): string {
  return `${name.replace(/^social_/, '').replaceAll('_', ' ')}. This only proposes one action; the runtime applies it after validation.`;
}

/** Parse one known decision tool without executing any side effect. */
function parseDecisionCall(name: string, input: unknown, extra: DecisionToolDefinition[]): SocialDecision | undefined {
  const schema = decisionSchemas[name as keyof typeof decisionSchemas];
  if (schema) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new Error(`invalid-output: ${name} arguments failed validation`);
    const value = parsed.data as Record<string, unknown>;
    switch (name) {
      case 'social_pass': return { kind: 'pass', reasonCode: value.reasonCode as string | undefined };
      case 'social_send_message': return { kind: 'send_message', channelId: value.channelId as string | undefined, content: value.content as string, replyToMessageId: value.replyToMessageId as number | undefined };
      case 'social_send_dm': return { kind: 'send_dm', targetActorId: value.targetActorId as string, content: value.content as string };
      case 'social_create_group': return { kind: 'create_group', title: value.title as string, invitedActorIds: value.invitedActorIds as string[], initialMessage: value.initialMessage as string | undefined };
      case 'social_invite_actor': return { kind: 'invite_actor', channelId: value.channelId as string, actorId: value.actorId as string };
      case 'social_resolve_invitation': return { kind: 'resolve_invitation', channelId: value.channelId as string, accepted: value.accepted as boolean };
      case 'social_leave_group': return { kind: 'leave_group', channelId: value.channelId as string };
      case 'social_update_memory': return { kind: 'update_memory', expectedRevision: value.expectedRevision as number, content: value.content as string };
    }
  }
  const environment = extra.find((definition) => definition.name === name);
  if (!environment) return undefined;
  const parsed = environment.inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(`invalid-output: ${name} arguments failed validation`);
  return { kind: 'environment_action', actionName: environment.actionName, arguments: parsed.data as Record<string, unknown> };
}
