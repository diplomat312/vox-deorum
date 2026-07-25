/**
 * @module web/chat/deal
 *
 * The Express face of the blocking diplomacy operations: conversation close, deal inspection, and the
 * accept / reject deal actions.
 *
 * Everything here is HTTP: resolve the `chatId`, parse the request body, call a transport-neutral
 * action, map its typed errors onto the public status classes. The domain logic — the diplomacy-thread
 * guard, the live-turn and closed-this-turn gate, the per-thread lock, the authoritative backend call,
 * and the live-cache hydration — lives in `utils/diplomacy/deal-actions.ts` so the in-game panel can
 * take exactly the same path (stage 7.04 work item 1).
 *
 * The public status classes, unchanged:
 *
 * | Error                                        | HTTP |
 * |----------------------------------------------|-----:|
 * | invalid request, or `IllegalDealError`        |  400 |
 * | thread not found                              |  404 |
 * | busy, closed this turn, or proposal conflict  |  409 |
 * | live turn unavailable                         |  503 |
 * | store, bridge, inspection, enactment failure   |  502 |
 */

import { Router, type Request, type Response } from 'express';
import type {
  DealAcceptRequest,
  DealMessagesResponse,
  DealRejectRequest,
  ErrorResponse,
  GetChatResponse,
  InspectDealRequest,
  InspectDealResponse,
  EnvoyThread,
} from '../../types/index.js';
import {
  IllegalDealError,
  ProposalConflictError,
  closeConversation,
  inspectDeal,
  readDealMessages,
} from '../../utils/diplomacy/deal.js';
import {
  NotDiplomacyThreadError,
  acceptDealAction,
  rejectDealAction,
} from '../../utils/diplomacy/deal-actions.js';
import {
  ThreadBusyError,
  threadBusyMessage,
  withThreadLock,
} from '../../utils/diplomacy/chat-turn-commit.js';
import {
  ConversationClosedThisTurnError,
  LiveTurnUnavailableError,
  requireOpenConversationTurn,
} from '../../utils/diplomacy/live-turn.js';
import { audienceID, insertDurableRows } from '../../utils/diplomacy/transcript.js';
import { createLogger } from '../../utils/logger.js';
import { DealPayloadSchema } from '../../../../mcp-server/dist/utils/deal-schema.js';
import { enrichChat } from './enrichment.js';
import { chatThreadStore } from './store.js';

const logger = createLogger('webui:chat-deal');

/** One mapped HTTP failure: the status class and the body the client receives. */
interface MappedFailure {
  status: number;
  error: string;
}

/** Resolve a diplomacy thread or send the public lookup or mode error. */
function resolveDealThread(chatId: string, res: Response): EnvoyThread | undefined {
  const thread = chatThreadStore.get(chatId);
  if (!thread) {
    res.status(404).json({ error: 'Chat thread not found' });
    return undefined;
  }
  if (!thread.diplomacy) {
    res.status(400).json({ error: 'Only diplomacy conversations support deal actions' });
    return undefined;
  }
  return thread;
}

/**
 * The single mapper from the shared actions' typed errors to the public status classes. Every branch
 * keys off the error TYPE — never its message text — so the same failure reaches the Web and the
 * in-game panel classified identically.
 *
 * @param error    The thrown failure.
 * @param fallback Wording for an unrecognized failure — the store, the bridge, the inspector, or the
 *                 enactment refused.
 * @param fallbackStatus Status class for that unrecognized failure. The deal actions report an
 *                 upstream refusal (502); the close control has always reported its own (500), and
 *                 that public class is preserved.
 */
function mapDealActionError(error: unknown, fallback: string, fallbackStatus = 502): MappedFailure {
  if (error instanceof ThreadBusyError) return { status: 409, error: threadBusyMessage };
  if (error instanceof ConversationClosedThisTurnError) return { status: 409, error: error.message };
  if (error instanceof ProposalConflictError) return { status: 409, error: error.message };
  if (error instanceof LiveTurnUnavailableError) return { status: 503, error: error.message };
  if (error instanceof IllegalDealError) return { status: 400, error: error.message };
  if (error instanceof NotDiplomacyThreadError) return { status: 400, error: error.message };
  logger.error(fallback, { error });
  return {
    status: fallbackStatus,
    error: fallbackStatus === 500 ? fallback : (error instanceof Error ? error.message : fallback),
  };
}

/** Register conversation close and blocking deal-status routes. */
export function createAgentDealStatusRoutes(): Router {
  const router = Router();

  router.post(
    '/agents/chat/:chatId/close',
    async (
      req: Request<{ chatId: string }, {}, { message?: string }>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<Response> => {
      const thread = chatThreadStore.get(req.params.chatId);
      if (!thread) return res.status(404).json({ error: 'Chat thread not found' });
      if (!thread.diplomacy) {
        return res.status(400).json({ error: 'Only diplomacy conversations can be closed.' });
      }

      const content = req.body?.message?.trim() || 'The conversation has been closed.';
      try {
        // The same live-turn/closed guard the deal actions use; a conversation already closed on this
        // turn cannot be closed again. `closeConversation` retracts any open offer first, then writes
        // the close, and hands back both durable rows so the cache is repaired from what it committed.
        requireOpenConversationTurn(thread, {
          closedMessage: 'This conversation is already closed this turn.',
        });
        await withThreadLock(thread, async () => {
          const { rows } = await closeConversation(thread, audienceID(thread), content);
          insertDurableRows(thread, rows);
          thread.metadata!.updatedAt = new Date();
        });
        return res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        const mapped = mapDealActionError(error, 'Failed to close conversation', 500);
        return res.status(mapped.status).json({ error: mapped.error });
      }
    },
  );

  router.post(
    '/agents/chat/:chatId/deal/inspect',
    async (
      req: Request<{ chatId: string }, {}, InspectDealRequest>,
      res: Response<InspectDealResponse | ErrorResponse>,
    ): Promise<Response> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return res;

      let deal: InspectDealRequest['deal'];
      if (req.body?.deal !== undefined) {
        const parsed = DealPayloadSchema.safeParse(req.body.deal);
        if (!parsed.success) {
          return res.status(400).json({ error: `Invalid deal payload: ${parsed.error.message}` });
        }
        deal = parsed.data;
      }

      try {
        const result = await inspectDeal(thread.player1ID, thread.player2ID, deal);
        return res.json(result as InspectDealResponse);
      } catch (error) {
        logger.error('Failed to inspect deal', { error });
        return res.status(502).json({
          error: error instanceof Error ? error.message : 'Failed to inspect deal',
        });
      }
    },
  );

  router.post(
    '/agents/chat/:chatId/deal/reject',
    async (
      req: Request<{ chatId: string }, {}, DealRejectRequest>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<Response> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return res;

      const proposalMessageID = req.body?.proposalMessageID;
      if (typeof proposalMessageID !== 'number') {
        return res.status(400).json({ error: 'proposalMessageID (number) is required' });
      }

      try {
        // A repeat of a rejection this endpoint already made returns the existing row and writes
        // nothing (`changed: false`); the Web response is identical either way, since the client
        // renders the conversation, not the transition.
        await rejectDealAction(thread, proposalMessageID, req.body?.content);
        return res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        const mapped = mapDealActionError(error, 'Failed to append deal-reject');
        return res.status(mapped.status).json({ error: mapped.error });
      }
    },
  );

  router.post(
    '/agents/chat/:chatId/deal/accept',
    async (
      req: Request<{ chatId: string }, {}, DealAcceptRequest>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<Response> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return res;
      if (typeof req.body?.proposalMessageID !== 'number') {
        return res.status(400).json({ error: 'proposalMessageID (number) is required' });
      }

      try {
        // No catch-time re-probe of the proposal. Both backend transactions now report a lost race as
        // a typed ProposalConflictError, so the mapper separates a conflict (409) from an
        // infrastructure failure (502) without a second, race-prone read that could report a verdict
        // already stale by the time it lands.
        await acceptDealAction(thread, req.body.proposalMessageID);
        return res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        const mapped = mapDealActionError(error, 'Failed to enact deal');
        return res.status(mapped.status).json({ error: mapped.error });
      }
    },
  );

  router.get(
    '/agents/chat/:chatId/deals',
    async (
      req: Request<{ chatId: string }>,
      res: Response<DealMessagesResponse | ErrorResponse>,
    ): Promise<Response> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return res;
      try {
        const messages = await readDealMessages(thread.player1ID, thread.player2ID);
        return res.json({ messages: messages as DealMessagesResponse['messages'] });
      } catch (error) {
        logger.error('Failed to read deal messages', { error });
        return res.status(502).json({
          error: error instanceof Error ? error.message : 'Failed to read deal messages',
        });
      }
    },
  );

  return router;
}
