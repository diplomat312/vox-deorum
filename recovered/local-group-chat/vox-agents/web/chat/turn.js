/**
 * @module web/chat/turn
 *
 * Runs one chat turn without depending on Express or SSE wire formatting.
 *
 * A turn has exactly two phases, and the boundary between them is enforced rather than assumed:
 *
 *  1. **Pre-run.** `beginChatTurn` takes the thread lock and commits the caller's move. That single
 *     durable row is the whole of `connected.rows`.
 *  2. **Post-connect.** The turn handle's row capture records every durable row the run commits — the
 *     deal/close rows the diplomat's tools write mid-run, and the final archived reply. Before either
 *     terminal event `turn.terminalRows()` freezes it and snapshots the rows once. That terminal-only
 *     set is what feeds `done.rows` / `error.rows`, the `done.deals` compatibility view, and the cache
 *     repair.
 *
 * The capture's own phase-boundary and lifetime guarantees are `active-turn-state.ts`'s to state; what
 * this module owes on top of them is that every committed turn emits exactly one terminal event:
 * `done` or `error`, never both and never neither.
 */
import { agentRegistry } from '../../infra/agent-registry.js';
import { contextRegistry } from '../../infra/context-registry.js';
import { ensureGameState } from '../../strategist/strategy-parameters.js';
import { agentName, needsRetryReply, retryMessage } from '../../utils/diplomacy/transcript/transcript.js';
import { insertDurableRows, isDealRow, } from '../../utils/diplomacy/transcript/transcript-utils.js';
import { beginChatTurn, ThreadBusyError, threadBusyMessage, } from '../../utils/diplomacy/turn/chat-turn-commit.js';
import { ConversationClosedThisTurnError, LiveTurnUnavailableError, requireOpenConversationTurn, } from '../../utils/diplomacy/turn/live-turn.js';
import { IllegalDealError, ProposalConflictError } from '../../utils/diplomacy/deal/deal.js';
import { createLogger } from '../../utils/logger.js';
import { createSendMessageStreamer, } from '../../utils/models/send-message-stream.js';
import { DealPayloadSchema } from '../../../../mcp-server/dist/utils/deal-schema.js';
import { chatThreadStore } from './store.js';
import { backfillThreadIdentities } from './enrichment.js';
const INITIATE_PROMPT = "Your leader has decided to speak on this turn before being prompted. You are writing on a PRIVATE thread: everything without a marker stays private. If you want your statement to be posted to the WORLD channel for every civilization to see — a public greeting, an open warning, a rallying cry, an expose — prefix it with exactly [WORLD] (for example: \"[WORLD] Greetings to every nation of this continent.\"). The prefix is stripped when it is broadcast. If you have something meaningful to say to the other side — news, a warning, a grievance, a peace feeler, or a moment of pride — send exactly one short message. If nothing is worth saying this turn, do not send anything.";
const logger = createLogger('webui:chat-turn');
/** Test whether an untrusted request body is a record whose fields can be inspected safely. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Parse the untrusted route body into the canonical discriminated chat request contract. */
function parseRequest(request) {
    if (!isRecord(request)) {
        return { status: 400, error: 'Chat request body must be an object.' };
    }
    if (typeof request.chatId !== 'string' || request.chatId.trim().length === 0) {
        return { status: 400, error: 'Chat ID is required' };
    }
    const chatId = request.chatId;
    if (request.kind === 'text') {
        if (typeof request.message !== 'string' || request.message.trim().length === 0) {
            return { status: 400, error: 'Message is required' };
        }
        return { kind: 'text', chatId, message: request.message };
    }
    if (request.kind === 'deal') {
        const parsed = DealPayloadSchema.safeParse(request.deal);
        if (!parsed.success) {
            return { status: 400, error: `Invalid deal payload: ${parsed.error.message}` };
        }
        if (request.expectedProposalID !== undefined
            && (typeof request.expectedProposalID !== 'number'
                || !Number.isSafeInteger(request.expectedProposalID)
                || request.expectedProposalID <= 0)) {
            return { status: 400, error: 'expectedProposalID must be a positive safe integer when provided.' };
        }
        return {
            kind: 'deal',
            chatId,
            deal: parsed.data,
            expectedProposalID: request.expectedProposalID,
        };
    }
    if (request.kind === 'initiate') {
        const prompt = typeof request.prompt === 'string' && request.prompt.trim().length > 0
            ? request.prompt.trim()
            : INITIATE_PROMPT;
        return { kind: 'initiate', chatId, message: prompt };
    }
    return { status: 400, error: 'kind must be either "text" or "deal".' };
}
/** Build the durable turn commit or return a pre-stream validation error. */
function parseCommit(request, thread) {
    if (request.kind === 'deal') {
        if (!thread.diplomacy) {
            return { status: 400, error: 'Only diplomacy conversations support deal actions.' };
        }
        return {
            kind: 'deal',
            chatId: request.chatId,
            deal: request.deal,
            expectedProposalID: request.expectedProposalID,
        };
    }
    if (request.kind === 'initiate') {
        if (!thread.diplomacy) {
            return { status: 400, error: 'Only diplomacy conversations support initiated correspondence.' };
        }
        return request;
    }
    return request;
}
/** Test whether a parsed commit result is a pre-stream rejection. */
function isRejection(value) {
    return 'status' in value;
}
/** Map the shared live-turn/closed guard's typed failures to the public pre-stream HTTP contract. */
function mapTurnGuardError(error) {
    if (error instanceof LiveTurnUnavailableError)
        return { status: 503, error: error.message };
    if (error instanceof ConversationClosedThisTurnError)
        return { status: 409, error: error.message };
    // The guard raises only those two, but a pre-commit failure must never escape as an unhandled
    // rejection: nothing has streamed yet, so degrade to the generic upstream-failure class.
    logger.error('Failed to resolve the conversation turn', { error });
    return { status: 502, error: 'Could not determine the current game turn. Please retry.' };
}
/** Map a begin-turn failure to the public pre-stream HTTP contract. */
function mapBeginTurnError(error) {
    if (error instanceof ThreadBusyError) {
        return { status: 409, error: threadBusyMessage };
    }
    if (error instanceof ProposalConflictError) {
        return { status: 409, error: error.message };
    }
    if (error instanceof IllegalDealError) {
        return { status: 400, error: error.message };
    }
    logger.error('Failed to commit the turn to the transcript store', { error });
    return { status: 502, error: 'Failed to record your message. Please retry.' };
}
/** Emit one spoken text delta through the transport-neutral sink. */
function emitSpoken(sink, text, id) {
    sink.message({ type: 'text-delta', text, id });
}
/**
 * The Web client's compatibility view of a turn's captured rows. It consumes `deals` (full deal rows
 * with their payload), not the transport-neutral projection, so derive it from the same captured set
 * instead of rereading the transcript. Every `deal-*` row this codebase reports is a full row, so the
 * narrowing cast holds.
 */
function dealRowsOf(rows) {
    return rows.filter(isDealRow);
}
/**
 * Run a chat request through validation, durable commit, agent execution, and terminal cleanup.
 * A returned rejection is always pre-stream. Undefined means the request committed and emitted.
 */
export async function runChatTurn(body, sink) {
    const request = parseRequest(body);
    if (isRejection(request))
        return request;
    const { chatId } = request;
    const thread = chatThreadStore.get(chatId);
    if (!thread)
        return { status: 404, error: 'Chat thread not found' };
    const parsedCommit = parseCommit(request, thread);
    if (isRejection(parsedCommit))
        return parsedCommit;
    const commit = parsedCommit;
    const voxContext = contextRegistry.get(thread.contextId);
    if (!voxContext) {
        return { status: 400, error: 'Context not found. It may have been shut down.' };
    }
    // The same guard the shared deal actions run: a live thread without a reported turn is unavailable
    // (never turn zero), and a conversation closed on this turn cannot be resumed.
    let currentTurn;
    try {
        currentTurn = requireOpenConversationTurn(thread);
    }
    catch (error) {
        return mapTurnGuardError(error);
    }
    let turn;
    try {
        turn = await beginChatTurn(thread, commit, currentTurn);
    }
    catch (error) {
        return mapBeginTurnError(error);
    }
    const replyStart = thread.messages.length;
    let terminal;
    let completed = false;
    /**
     * Emit the turn's single terminal success event: freeze the capture, splice the mid-run durable
     * rows in at the reply boundary (ahead of the normalized reply, matching the durable order), and
     * report them.
     */
    const emitDone = () => {
        if (terminal)
            return;
        terminal = 'done';
        const rows = turn.terminalRows();
        insertDurableRows(thread, rows, replyStart);
        const target = turn.traceTarget();
        if (target) {
            const cached = thread.messages.find((item) => item.metadata.id === target.rowID);
            if (cached)
                cached.metadata.trace = target.trace;
        }
        sink.done({
            sessionId: thread.id,
            messageCount: thread.messages.length,
            deals: dealRowsOf(rows),
            rows,
        });
    };
    /**
     * Emit the turn's single terminal failure event. `finish` runs first so the transient model output
     * is gone, then every durable row the turn did commit is restored — an append-only store cannot
     * unwrite them, so the live cache must keep them even though the turn failed.
     */
    const emitError = (message) => {
        if (terminal)
            return;
        terminal = 'error';
        const rows = turn.terminalRows();
        turn.finish();
        insertDurableRows(thread, rows);
        sink.error({ message, rows });
    };
    try {
        sink.connected({
            sessionId: thread.id,
            deal: turn.dealRow,
            rows: turn.callerRow ? [turn.callerRow] : [],
        });
        const voiceName = agentName(thread);
        // The one place the voice capability becomes a rendering decision: a voice that speaks only
        // through `send-message` emits native text chunks that are tool-force junk, so they are swallowed.
        const speaksOnlyViaSendMessage = Boolean(voiceName && agentRegistry.get(voiceName)?.speaksOnlyViaSendMessage);
        const streamer = createSendMessageStreamer((text, id) => emitSpoken(sink, text, id), { suppressFreeText: speaksOnlyViaSendMessage });
        const streamCallback = {
            OnChunk: ({ chunk }) => {
                if (!streamer.handleChunk(chunk)) {
                    sink.message(chunk);
                }
            },
        };
        const streamProgress = (message) => {
            emitSpoken(sink, `${message}\n`, 'progress');
        };
        const overrides = thread.contextType === 'live'
            ? {
                turn: currentTurn,
                before: currentTurn * 1000000 + 999999,
                after: currentTurn * 1000000,
            }
            : undefined;
        let contextLengthFailed = false;
        await voxContext.withRun({ overrides, streamProgress }, async (run) => {
            sink.onDisconnect(() => {
                logger.info('Chat client disconnected');
                // Do not abort the envoy run: the reply is committed to the durable
                // transcript even when the web page closes or refreshes mid-turn —
                // relation with the client is only the live stream, not the turn.
            });
            const params = run.parameters;
            if (thread.contextType === 'live' && params.gameStates && !params.gameStates[params.turn]) {
                await ensureGameState(voxContext, params);
            }
            // A thread opened before this seat had any cached game state (fresh launch, load, crash
            // recovery) froze missing identities; repair it now that the state above is ensured, so
            // this same turn's diplomacy background sees the pair's civ names.
            if (thread.diplomacy)
                backfillThreadIdentities(thread, voxContext);
            const voice = agentName(thread);
            if (!voice) {
                emitError('Could not resolve the voicing agent for this conversation');
                return;
            }
            const agent = agentRegistry.get(voice);
            if (agent?.programmatic) {
                if (commit.kind === 'deal') {
                    emitError('Deal actions are not supported by this conversation.');
                    return;
                }
                await agent.handleMessage(params, thread, commit.message, (text) => {
                    emitSpoken(sink, text, 'programmatic');
                });
            }
            else {
                await voxContext.execute(voice, thread, streamCallback, undefined, () => { contextLengthFailed = true; }, { throwOnError: true });
            }
            if (contextLengthFailed) {
                emitError('This conversation is too long for the model to continue. Please start a new one.');
                return;
            }
            const replySlice = thread.messages.slice(replyStart);
            if (thread.diplomacy && needsRetryReply(replySlice)) {
                emitSpoken(sink, retryMessage, 'retry');
            }
            // A valid send-message call already appended its own text row. Completion clears transient
            // model traffic, appends the retry fallback when nothing spoke or took a terminal action, and
            // commits any close the diplomat staged mid-run last of all. A staged close is discarded
            // automatically if this turn takes the error path instead.
            await turn.complete();
            emitDone();
        });
    }
    catch (error) {
        logger.error('Failed to execute agent', { error });
        const errorMessage = error instanceof Error ? error.message : 'unknown';
        emitError(`Failed to execute agent: ${errorMessage}`);
    }
    finally {
        turn.finish();
        completed = true;
    }
    // A committed turn owes its client exactly one terminal event. Every path above emits one, but the
    // guarantee is asserted here rather than assumed: a future branch that returns without reporting
    // must not leave a client waiting forever on a turn that already released its lock.
    if (!terminal) {
        logger.error('Chat turn ended without a terminal event', { chatId });
        emitError('The conversation ended without a result. Please retry.');
    }
    return undefined;
}
//# sourceMappingURL=turn.js.map
