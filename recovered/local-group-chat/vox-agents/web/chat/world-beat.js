/**
 * @module web/chat/world-beat
 *
 * A light, fire-and-forget scheduler that invites each LLM-voiced civilization to
 * speak unprompted on its human thread, a few turns apart. It runs the same chat-turn
 * machinery as a human message but with an initiation prompt; envoys may stay silent.
 *
 * Channel separation: a statement on a private thread stays private UNLESS the envoy
 * explicitly marks it public with a leading `[WORLD]` marker. Only those marked rows
 * are republished into the global feed (one per row), so the world channel never
 * mirrors confidential letters.
 *
 * AI-to-AI correspondence: besides the human threads, the beat also watches every pair
 * of LLM-voiced civilizations. When a durable letter exists between such a pair, the
 * thread is materialized (deterministically voiced by the HIGHER seat's diplomat) and
 * a reply turn fires when a letter from the lower seat is awaiting an answer. The lower
 * seat writes its side through its strategist loop; the beat handles the reply cadence.
 */
import { runChatTurn } from './turn.js';
import { chatThreadStore } from './store.js';
import { openDiplomacyChat } from './factory.js';
import { sessionRegistry } from '../../infra/session-registry.js';
import { createLogger } from '../../utils/logger.js';
import { mcpClient } from '../../utils/models/mcp-client.js';
import { unwrapMcpResponse } from '../../utils/models/mcp-response.js';
import { syncThreadMessages } from '../../utils/diplomacy/transcript/transcript.js';
const logger = createLogger('world-beat');
const BEAT_INTERVAL_MS = 30_000;
const COOLDOWN_TURNS = 3;
// A beat turn occupies its thread for minutes (model + tool loops), while game turns
// advance in seconds — the 3-turn cooldown alone lets beats re-lock a thread before
// the human's own letters and deals can get a slot. Add a wall-clock floor so a
// thread is never re-locked by a beat within MIN_BEAT_GAP_MS of the last beat turn.
// Manual sends and deal actions are unaffected (they only need the thread free).
const MIN_BEAT_GAP_MS = 180_000;
const WORLD_MARKER = /^\s*\[WORLD\]\s*/i;
const silentSink = {
    connected() { },
    message() { },
    error(data) {
        logger.warn('world-beat turn failed', { error: data?.message });
    },
    done() { },
    onDisconnect() { return () => { }; },
};
const lastBeat = new Map();
const lastBeatAt = new Map();
const publishedRows = new Set();
function eligibleSeats(status) {
    const llmPlayers = status?.config?.llmPlayers ?? {};
    return Object.keys(llmPlayers)
        .map(Number)
        .filter((id) => llmPlayers[id]?.strategist && llmPlayers[id].strategist !== 'none-strategist');
}
function rowText(row) {
    const content = row?.message?.content;
    if (typeof content === "string")
        return content.trim();
    if (Array.isArray(content)) {
        const parts = content.map((part) => {
            if (part?.type === "text")
                return part.text;
            if (part?.type === "tool-call" && part?.input?.Message)
                return part.input.Message;
            return "";
        }).filter(Boolean);
        return parts.join("\n").trim();
    }
    return "";
}

/** True when the envoy explicitly marked the row for the world channel. */
function isMarkedPublic(text) {
    return WORLD_MARKER.test(text);
}

/** Strip the public marker so the world feed reads as plain speech. */
function stripMarker(text) {
    return text.replace(WORLD_MARKER, "").trim();
}
/**
 * Publish explicitly marked statements into the global feed. Rows without the
 * `[WORLD]` marker are private letters and are deliberately NOT republished; each
 * row is processed once (whether published or kept private).
 */
async function publishMarkedRows(threadId, seat) {
    try {
        const thread = chatThreadStore.get(threadId);
        if (!thread)
            return;
        for (const row of (thread.messages ?? [])) {
            if (row.message?.role !== "assistant")
                continue;
            const key = `${threadId}:${row.metadata?.id ?? row.metadata?.datetime ?? "?"}`;
            if (publishedRows.has(key))
                continue;
            publishedRows.add(key);
            const text = rowText(row);
            if (!text || !isMarkedPublic(text))
                continue; // private letter — stays on the thread only.
            const content = stripMarker(text);
            try {
                // Dedupe against the durable feed, not just this process: if another
                // beat instance (or a restart) already published the same statement,
                // do not post a second copy.
                const feed = unwrapMcpResponse(await mcpClient.callTool("get-global-messages", { Limit: 200 }), "get-global-messages");
                const existing = Array.isArray(feed?.messages)
                    ? feed.messages.some((m) => Number(m.SpeakerID) === seat && m.Content === content)
                    : false;
                if (existing) {
                    logger.info("world-beat skipped already-published statement", { threadId, seat });
                    continue;
                }
                await mcpClient.callTool("broadcast-message", { PlayerID: seat, Content: content });
                logger.info("world-beat republished marked statement", { threadId, seat });
            }
            catch (error) {
                logger.warn("world-beat republish failed", { threadId, seat, error: String(error) });
            }
        }
    }
    catch (error) {
        logger.warn("world-beat publish scan failed", { threadId, error: String(error) });
    }
}
/**
 * Cross-pair pass: one private correspondence thread per LLM-voiced pair. Only pairs
 * that already have durable letters are materialized, so empty channel placeholders
 * do not litter the UI. The higher seat is the diplomat-voiced side; the lower seat
 * writes through its strategist loop (see the strategist channel-separation prompt).
 */
async function crossPairTick(status, gameID, turn) {
    const seats = eligibleSeats(status).sort((a, b) => a - b);
    for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
            const lo = seats[i];
            const hi = seats[j];
            const threadId = `dipl:${gameID}:${lo}:${hi}`;
            let thread = chatThreadStore.get(threadId);
            if (!thread || thread.diplomacy === false) {
                // Only open once the pair has actually exchanged letters.
                try {
                    const probe = unwrapMcpResponse(await mcpClient.callTool("read-transcript", {
                        PlayerAID: lo,
                        PlayerBID: hi,
                        Limit: 1,
                    }), "read-transcript");
                    if (!Array.isArray(probe?.messages) || probe.messages.length === 0)
                        continue;
                }
                catch {
                    continue; // store not answering yet — try again next beat
                }
                try {
                    thread = await openDiplomacyChat({
                        mode: "diplomacy",
                        contextId: `${gameID}-player-${hi}`,
                        targetPlayerID: hi,
                        callerPlayerID: lo,
                    });
                    logger.info("world-beat opened AI-voiced correspondence thread", { threadId, lo, hi });
                }
                catch (error) {
                    logger.warn("world-beat cross-pair open failed", { threadId, lo, hi, error: String(error) });
                    continue;
                }
            }
            // The higher seat's envoy may mark statements public; honor that intent.
            void publishMarkedRows(threadId, hi);
            // Re-sync from the durable store: the lower seat's strategist may have
            // written a new letter since the last beat, without touching this cache.
            try {
                await syncThreadMessages(thread);
            }
            catch (error) {
                logger.warn("world-beat cross-pair sync failed", { threadId, error: String(error) });
                continue;
            }
            const lastRow = thread.messages.at(-1);
            const letterPending = Boolean(lastRow && lastRow.message?.role === "user");
            if (!letterPending)
                continue;
            const last = lastBeat.get(threadId) ?? -1;
            const lastAt = lastBeatAt.get(threadId) ?? 0;
            if (turn < last + COOLDOWN_TURNS || Date.now() - lastAt < MIN_BEAT_GAP_MS)
                continue;
            lastBeat.set(threadId, turn);
            lastBeatAt.set(threadId, Date.now());
            runChatTurn({ chatId: threadId, kind: "initiate" }, silentSink)
                .then((rejection) => {
                    if (rejection)
                        logger.warn("world-beat cross-pair turn rejected", { threadId, error: rejection.error });
                })
                .catch((error) => logger.warn("world-beat cross-pair turn errored", { threadId, error: String(error) }));
        }
    }
}
async function tick() {
    try {
        const session = sessionRegistry.getActive();
        if (!session) {
            lastBeat.clear();
            return;
        }
        const status = session.getStatus();
        const gameID = status?.gameID;
        const turn = status?.turn;
        if (!gameID || turn == null)
            return;
        for (const seat of eligibleSeats(status)) {
            const threadId = `dipl:${gameID}:0:${seat}`;
            let thread = chatThreadStore.get(threadId);
            // The thread cache is in-memory: after a service restart the durable letters
            // are still in the store, but the thread must be reopened before it can speak
            // again. Reopen deterministically (same ID and context the UI uses) so beats
            // resume automatically instead of the conversation going silent.
            if (!thread || thread.diplomacy === false) {
                try {
                    thread = await openDiplomacyChat({
                        mode: "diplomacy",
                        contextId: `${gameID}-player-${seat}`,
                        targetPlayerID: seat,
                        callerPlayerID: 0,
                    });
                    logger.info("world-beat reopened dormant thread", { threadId, seat });
                }
                catch (error) {
                    logger.warn("world-beat thread reopen failed", { threadId, seat, error: String(error) });
                    continue;
                }
            }
            // Republish any `[WORLD]`-marked statements (beat replies AND replies to
            // human letters) that have not been processed yet. Deduped per process.
            void publishMarkedRows(threadId, seat);
            const last = lastBeat.get(threadId) ?? -1;
            const lastAt = lastBeatAt.get(threadId) ?? 0;
            if (turn < last + COOLDOWN_TURNS || Date.now() - lastAt < MIN_BEAT_GAP_MS)
                continue;
            lastBeat.set(threadId, turn);
            lastBeatAt.set(threadId, Date.now());
            runChatTurn({ chatId: threadId, kind: 'initiate' }, silentSink)
                .then((rejection) => {
                    if (rejection) {
                        logger.warn('world-beat turn rejected', { threadId, error: rejection.error });
                    }
                })
                .catch((error) => logger.warn('world-beat turn errored', { threadId, error: String(error) }));
        }
        await crossPairTick(status, gameID, turn);
    }
    catch (error) {
        logger.warn('world-beat tick failed', { error: String(error) });
    }
}
export function startWorldBeat() {
    const timer = setInterval(() => { void tick(); }, BEAT_INTERVAL_MS);
    if (typeof timer.unref === 'function')
        timer.unref();
    logger.info('World chat beat scheduler started');
    void tick();
    return timer;
}
