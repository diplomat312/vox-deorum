/**
 * @module web/chat/discovery
 *
 * Registers agent discovery and chat-thread lifecycle routes.
 */
import { Router } from 'express';
import { agentRegistry } from '../../infra/agent-registry.js';
import { pacingInterruptionRegistry } from '../../strategist/pacing/registry.js';
import { createLogger } from '../../utils/logger.js';
import { mcpClient } from '../../utils/models/mcp-client.js';
import { enrichChat } from './enrichment.js';
import { ChatOpenError, openDiplomacyChat, openOrdinaryChat, } from './factory.js';
import { chatThreadStore } from './store.js';
import { runChatTurn } from './turn.js';
const logger = createLogger('webui:chat-discovery');
/** Register discovery, open, read, list, and delete routes for Web chats. */
export function createAgentDiscoveryRoutes() {
    const router = Router();
    router.get('/agents', (_req, res) => {
        try {
            const agents = agentRegistry.getAll().map((agent) => ({
                name: agent.name,
                displayName: agent.displayName,
                description: agent.description,
                tags: agent.tags || [],
                modelSize: agent.modelSize,
                diplomacyOnly: agent.diplomacyOnly,
                offeredInSetup: agent.offeredInSetup,
            }));
            res.json({ agents });
        }
        catch (error) {
            logger.error('Failed to list agents', { error });
            res.status(500).json({ error: 'Failed to list agents' });
        }
    });
    router.get('/agents/pacing-interruptions', (_req, res) => {
        try {
            const interruptions = pacingInterruptionRegistry.getAll().map((strategy) => ({
                name: strategy.name,
                label: strategy.label,
                description: strategy.description,
            }));
            res.json({ interruptions });
        }
        catch (error) {
            logger.error('Failed to list pacing interruptions', { error });
            res.status(500).json({ error: 'Failed to list pacing interruptions' });
        }
    });
    router.post('/agents/chat', async (req, res) => {
        try {
            const thread = req.body.mode === 'diplomacy'
                ? await openDiplomacyChat(req.body)
                : await openOrdinaryChat(req.body);
            return res.json({ ...thread, ...enrichChat(thread) });
        }
        catch (error) {
            if (error instanceof ChatOpenError) {
                return res.status(error.status).json({ error: error.message });
            }
            logger.error('Failed to create session', { error });
            return res.status(500).json({ error: 'Failed to create session' });
        }
    });
    router.get('/agents/chats', (_req, res) => {
        try {
            res.json({ chats: chatThreadStore.list() });
        }
        catch (error) {
            logger.error('Failed to list chat threads', { error });
            res.status(500).json({ error: 'Failed to list chat threads' });
        }
    });
    router.get('/agents/chat/:chatId', async (req, res) => {
        try {
            const thread = await chatThreadStore.read(req.params.chatId);
            if (!thread)
                return res.status(404).json({ error: 'Chat thread not found' });
            return res.json({ ...thread, ...enrichChat(thread) });
        }
        catch (error) {
            logger.error('Failed to get chat thread', { error });
            return res.status(500).json({ error: 'Failed to get chat thread' });
        }
    });
    router.delete('/agents/chat/:chatId', async (req, res) => {
        try {
            const deleted = await chatThreadStore.delete(req.params.chatId);
            if (!deleted)
                return res.status(404).json({ error: 'Chat thread not found' });
            return res.json({ success: true });
        }
        catch (error) {
            logger.error('Failed to delete chat thread', { error });
            return res.status(500).json({ error: 'Failed to delete chat thread' });
        }
    });
    router.get('/chat/global', async (_req, res) => {
        try {
            const result = await mcpClient.callTool('get-global-messages', { Limit: 100 });
            return res.json(result);
        }
        catch (error) {
            logger.error('Failed to read the world channel', { error });
            return res.status(500).json({ error: 'Failed to read the world channel' });
        }
    });
    router.post('/chat/global', async (req, res) => {
        const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
        if (!content)
            return res.status(400).json({ error: 'content is required' });
        const playerID = (typeof req.body?.playerID === 'number' && Number.isInteger(req.body.playerID))
            ? req.body.playerID
            : -1;
        try {
            const result = await mcpClient.callTool('broadcast-message', { PlayerID: playerID, Content: content });
            return res.json(result);
        }
        catch (error) {
            logger.error('Failed to post to the world channel', { error });
            return res.status(500).json({ error: 'Failed to post to the world channel' });
        }
    });
    router.post('/agents/chat/:chatId/initiate', async (req, res) => {
        const thread = chatThreadStore.get(req.params.chatId);
        if (!thread)
            return res.status(404).json({ error: 'Chat thread not found' });
        try {
            const outcome = await new Promise((resolve) => {
                let settled = false;
                const sink = {
                    connected() { },
                    message() { },
                    error(data) {
                        if (!settled) { settled = true; resolve({ success: false, error: data?.message ?? 'initiate failed' }); }
                    },
                    done(data) {
                        if (!settled) { settled = true; resolve({ success: true, messageCount: data?.messageCount ?? thread.messages.length }); }
                    },
                    onDisconnect() { return () => { }; },
                };
                runChatTurn({ chatId: req.params.chatId, kind: 'initiate' }, sink)
                    .then((rejection) => {
                    if (rejection && !settled) { settled = true; resolve({ success: false, error: rejection.error }); }
                })
                    .catch((error) => {
                    if (!settled) { settled = true; resolve({ success: false, error: String(error) }); }
                });
            });
            return res.json(outcome);
        }
        catch (error) {
            logger.error('Failed to initiate conversation turn', { error });
            return res.status(500).json({ error: 'Failed to initiate conversation turn' });
        }
    });
    return router;
}
//# sourceMappingURL=discovery.js.map
