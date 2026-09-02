import type { Tool, ToolSet } from 'ai';
import { buildCivilizationMemoryContext } from '../../civilization-memory/civilization-memory-context.js';
import { buildUnifiedMindIdentity } from '../../strategist/unified-civilization-mind.js';
import { buildGameContextMessages, ensureGameState, type StrategistParameters } from '../../strategist/strategy-parameters.js';
import type { VoxPlayer } from '../../strategist/vox-player.js';
import type { SocialActor } from '../types.js';
import type { SocialContextBundle } from '../context/social-context-builder.js';
import type { SocialDecisionRun, SocialModelExecutor } from './social-model-executor.js';
import type { SocialDecision } from '../types.js';
import type { CapturedSocialToolCall, UnifiedSocialCognitionInput } from '../../strategist/agents/unified-social-cognition.js';
import { createLogger } from '../../utils/logger.js';

/** Resolve live Civ actors to their already-created authoritative seat player. */
export type LiveCivilizationPlayerResolver = (actorId: string) => VoxPlayer | undefined;

/** Execute social decisions through the existing unified civilization VoxContext. */
export class LiveCivilizationMindRunner implements SocialModelExecutor {
  private readonly logger = createLogger('live-civilization-mind');

  public constructor(private readonly playerForActor: LiveCivilizationPlayerResolver) {}

  /** Generate one side-effect-free live social decision using the seat's unified model. */
  public async decide(actor: SocialActor, socialContext: SocialContextBundle, actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecision> {
    return (await this.decideWithTelemetry(actor, socialContext, actorNames, abortSignal)).decision;
  }

  /** Generate one live decision while returning the same sanitized usage shape as the sandbox. */
  public async decideWithTelemetry(actor: SocialActor, socialContext: SocialContextBundle, _actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecisionRun> {
    const player = this.playerForActor(actor.id);
    if (!player || !player.isUnifiedMind()) throw new Error(`No unified civilization player is bound to social actor ${actor.id}`);
    const startedAt = Date.now();
    const result = await player.runOnCognitionLane(() => this.runInSeatContext(player, socialContext, abortSignal));
    return { decision: result.decision, retryCount: 0, semanticRetryCount: 0, providerAttemptCount: 1, providerRetryCount: 0, latencyMs: Date.now() - startedAt, ...(result.usage ? { usage: result.usage } : {}) };
  }

  /** Run the model inside the existing seat context and keep application side effects outside it. */
  private async runInSeatContext(player: VoxPlayer, socialContext: SocialContextBundle, abortSignal?: AbortSignal): Promise<{ decision: SocialDecision; usage?: SocialDecisionRun['usage'] }> {
    const base = player.getBaseParameters();
    const turn = player.getCurrentTurn();
    const before = base.before;
    const after = base.after;
    return player.context.withRun({ overrides: { turn, before, after } }, async (run) => {
      const parameters = run.parameters;
      const decisionCalls: CapturedSocialToolCall[] = [];
      const definitions = socialContext.decisionToolDefinitions ?? [];
      const tools = this.captureTools(socialContext.decisionTools ?? {}, decisionCalls, socialContext);
      const outlookTool = player.context.tools['update-civilization-outlook'];
      if (outlookTool) tools['update-civilization-outlook'] = outlookTool;
      const outwardToolNames = [
        ...Object.keys(tools).filter((name) => name !== 'update-civilization-outlook' && !definitions.some((definition) => definition.name === name && definition.phase === 'support')),
      ];
      const previousTools = this.installTools(player, tools);
      const tokenOutput = { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 };
      const unlinkAbort = () => run.abort();
      abortSignal?.addEventListener('abort', unlinkAbort, { once: true });
      try {
        const messages = await this.buildMessages(player, parameters, socialContext);
        const input: UnifiedSocialCognitionInput = {
          socialContext: { ...socialContext, system: this.system(parameters, socialContext), messages },
          decisionDefinitions: definitions,
          decisionTools: tools,
          toolNames: Object.keys(tools),
          decisionCalls,
          outwardToolNames,
        };
        const output = await player.context.execute('unified-mind-social', input, undefined, tokenOutput, undefined, { throwOnError: true });
        const usage = tokenOutput.inputTokens || tokenOutput.reasoningTokens || tokenOutput.outputTokens
          ? { inputTokens: tokenOutput.inputTokens, reasoningTokens: tokenOutput.reasoningTokens, outputTokens: tokenOutput.outputTokens, totalTokens: tokenOutput.inputTokens + tokenOutput.reasoningTokens + tokenOutput.outputTokens }
          : undefined;
        return { decision: output as SocialDecision, usage };
      } finally {
        abortSignal?.removeEventListener('abort', unlinkAbort);
        this.restoreTools(player, previousTools);
      }
    });
  }

  /** Build a canonical live communication identity and keep the social situation semantic. */
  private system(parameters: StrategistParameters, socialContext: SocialContextBundle): string {
    const environment = socialContext.environment ? `\n\nBounded current environment context:\n${socialContext.environment}` : '';
    return `${buildUnifiedMindIdentity(parameters, 'social')}\n\nThis is a live communication wake of the same civilization mind. Speak only when useful. Use support reads or update the Current Outlook when useful, then choose exactly one legal outward social or environment action, including PASS. The runtime applies your validated proposal after this wake; do not assume that conversation claims changed the game.${environment}`;
  }

  /** Combine game state, shared memory, bounded environment facts, and the social situation. */
  private async buildMessages(player: VoxPlayer, parameters: StrategistParameters, socialContext: SocialContextBundle): Promise<SocialContextBundle['messages']> {
    try {
      await ensureGameState(player.context, parameters, 10);
    } catch (error) {
      this.logger.warn('Could not refresh Civ state for live social wake; continuing with bounded social context', { playerID: parameters.playerID, gameID: parameters.gameID, turn: parameters.turn, error });
    }
    const messages: SocialContextBundle['messages'] = [];
    try {
      messages.push(...buildGameContextMessages(parameters, { unifiedMind: true }));
    } catch (error) {
      this.logger.warn('No cached Civ state was available for live social wake', { playerID: parameters.playerID, gameID: parameters.gameID, turn: parameters.turn, error });
    }
    const memory = buildCivilizationMemoryContext(parameters, 'social');
    if (memory) messages.push(memory);
    messages.push(...socialContext.messages);
    return messages;
  }

  /** Wrap legal social tools so model generation records proposals without applying them. */
  private captureTools(tools: ToolSet, calls: CapturedSocialToolCall[], socialContext: SocialContextBundle): ToolSet {
    return Object.fromEntries(Object.entries(tools).map(([name, definition]) => [name, {
      ...definition,
      execute: async (input: unknown) => {
        const environmentDefinition = (socialContext.decisionToolDefinitions ?? []).find((candidate) => candidate.name === name);
        if (environmentDefinition?.phase === 'support' && socialContext.supportRead) {
          return socialContext.supportRead(environmentDefinition.actionName, input as Record<string, unknown>);
        }
        calls.push({ toolName: name, input });
        return `Recorded one ${name} proposal for runtime validation.`;
      },
    } as Tool])) as ToolSet;
  }

  /** Temporarily expose only this wake's legal tools in the seat context. */
  private installTools(player: VoxPlayer, tools: ToolSet): Map<string, Tool | undefined> {
    const previous = new Map<string, Tool | undefined>();
    for (const [name, definition] of Object.entries(tools)) {
      previous.set(name, player.context.tools[name]);
      player.context.tools[name] = definition as Tool;
    }
    return previous;
  }

  /** Restore the seat's normal strategist tools after live social generation. */
  private restoreTools(player: VoxPlayer, previous: Map<string, Tool | undefined>): void {
    for (const [name, definition] of previous) {
      if (definition) player.context.tools[name] = definition;
      else delete player.context.tools[name];
    }
  }
}
