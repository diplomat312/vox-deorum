import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import { SocialRuntime, type SocialRuntimeConfig } from '../../social/runtime/social-runtime.js';
import type { SocialActorDefinition } from '../../social/types.js';

const router = Router();
export const socialRuntime = new SocialRuntime();
const socialDataDirectory = path.join(process.cwd(), 'social-data');

/** Return a request body as a record when it is a JSON object. */
function bodyRecord(body: unknown): Record<string, unknown> | undefined { return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined; }
/** Return a boolean query flag. */
function queryFlag(value: unknown): boolean { return value === true || value === 'true' || value === '1'; }
/** Return a safe route error message. */
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unexpected social runtime error'; }
/** Validate the actor list accepted by the standalone social session endpoint. */
function actorDefinitions(value: unknown): SocialActorDefinition[] | undefined { if (!Array.isArray(value)) return undefined; if (value.length < 2 || value.length > 8) return undefined; const actors: SocialActorDefinition[] = []; for (const item of value) { const record = bodyRecord(item); if (!record || typeof record.id !== 'string' || typeof record.ordinal !== 'number' || (record.control !== 'human' && record.control !== 'model') || typeof record.displayName !== 'string') return undefined; actors.push({ id: record.id, ordinal: record.ordinal, control: record.control, displayName: record.displayName, ...(typeof record.modelRef === 'string' ? { modelRef: record.modelRef } : {}), ...(typeof record.profile === 'string' ? { profile: record.profile } : {}) }); } return actors; }

/** Start a standalone social session without Civilization V. */
router.post('/session', async (req: Request, res: Response) => { try { const body = bodyRecord(req.body); const actors = actorDefinitions(body?.actors); if (!actors) { res.status(400).json({ error: 'actors must contain 2 to 8 valid actor definitions' }); return; } const runtimeConfig: SocialRuntimeConfig = { actors, dataDirectory: typeof body?.dataDirectory === 'string' ? body.dataDirectory : path.join(process.cwd(), 'social-data'), ...(typeof body?.sessionId === 'string' ? { sessionId: body.sessionId } : {}), ...(typeof body?.humanActorId === 'string' ? { humanActorId: body.humanActorId } : {}) }; await socialRuntime.start(runtimeConfig); res.status(201).json({ sessionId: socialRuntime.getSessionId(), humanActorId: socialRuntime.getHumanActorId(), actors: await socialRuntime.listActors() }); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });
/** Stop the standalone social session. */
router.post('/session/stop', async (_req: Request, res: Response) => { try { await socialRuntime.stop(); res.json({ success: true }); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });
/** List persisted social sessions available after a server restart. */
router.get('/sessions', async (_req: Request, res: Response) => { try { res.json({ sessions: await socialRuntime.listStoredSessions(socialDataDirectory) }); } catch (error) { res.status(500).json({ error: errorMessage(error) }); } });
/** Resume one persisted social session without changing its durable state. */
router.post('/session/resume', async (req: Request, res: Response) => { const body = bodyRecord(req.body); if (typeof body?.sessionId !== 'string') { res.status(400).json({ error: 'sessionId is required' }); return; } try { await socialRuntime.resume(body.sessionId, socialDataDirectory); res.json({ sessionId: socialRuntime.getSessionId(), humanActorId: socialRuntime.getHumanActorId(), actors: await socialRuntime.listActors() }); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });
/** Return social session status and actor definitions. */
router.get('/session', async (_req: Request, res: Response) => { if (!socialRuntime.isRunning()) { res.status(404).json({ error: 'No social session is active' }); return; } res.json({ sessionId: socialRuntime.getSessionId(), humanActorId: socialRuntime.getHumanActorId(), actors: await socialRuntime.listActors() }); });
/** Change one model actor's model for future replies without interrupting the session. */
router.patch('/actors/:actorId', async (req: Request<{ actorId: string }>, res: Response) => { const body = bodyRecord(req.body); if (typeof body?.modelRef !== 'string' || !body.modelRef.includes('/')) { res.status(400).json({ error: 'modelRef must be a provider/model identifier' }); return; } try { res.json(await socialRuntime.updateActorModel(req.params.actorId, body.modelRef)); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });
/** List channels visible to the human, optionally using read-only developer inspection. */
router.get('/channels', async (req: Request, res: Response) => { try { res.json({ channels: await socialRuntime.listChannels(queryFlag(req.query.inspect)) }); } catch (error) { res.status(404).json({ error: errorMessage(error) }); } });
/** Read a channel with paging and authorization. */
router.get('/channels/:channelId/messages', async (req: Request<{ channelId: string }>, res: Response) => { try { const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined; const beforeId = typeof req.query.beforeId === 'string' ? Number(req.query.beforeId) : undefined; res.json(await socialRuntime.readMessages(req.params.channelId, limit, beforeId, queryFlag(req.query.inspect))); } catch (error) { res.status(404).json({ error: errorMessage(error) }); } });
/** Append a human-authored message with server-bound identity. */
router.post('/channels/:channelId/messages', async (req: Request<{ channelId: string }>, res: Response) => { const body = bodyRecord(req.body); if (typeof body?.content !== 'string' || body.content.trim() === '') { res.status(400).json({ error: 'content is required' }); return; } try { const message = await socialRuntime.appendHumanMessage(req.params.channelId, body.content, typeof body.replyToMessageId === 'number' ? body.replyToMessageId : undefined); void socialRuntime.generateAiReplies(message.channelId, message.id); res.status(201).json(message); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });
/** Open a human DM. */
router.post('/dms/:actorId', async (req: Request<{ actorId: string }>, res: Response) => { try { const body = bodyRecord(req.body); res.status(201).json(await socialRuntime.openHumanDm(req.params.actorId, typeof body?.title === 'string' ? body.title : undefined)); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });
/** Create a titled group owned by the human. */
router.post('/groups', async (req: Request, res: Response) => { const body = bodyRecord(req.body); if (typeof body?.title !== 'string' || body.title.trim() === '') { res.status(400).json({ error: 'title is required' }); return; } const invitees = Array.isArray(body.invitedActorIds) && body.invitedActorIds.every((id) => typeof id === 'string') ? body.invitedActorIds as string[] : []; try { res.status(201).json(await socialRuntime.createHumanGroup(body.title, invitees)); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });
/** Invite an actor to a human-accessible group. */
router.post('/groups/:channelId/invitations', async (req: Request<{ channelId: string }>, res: Response) => { const body = bodyRecord(req.body); if (typeof body?.actorId !== 'string') { res.status(400).json({ error: 'actorId is required' }); return; } try { res.status(201).json(await socialRuntime.invite(req.params.channelId, body.actorId)); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });
/** Resolve the human's pending invitation. */
router.post('/groups/:channelId/invitation', async (req: Request<{ channelId: string }>, res: Response) => { const body = bodyRecord(req.body); if (typeof body?.accepted !== 'boolean') { res.status(400).json({ error: 'accepted is required' }); return; } try { res.json(await socialRuntime.resolveHumanInvitation(req.params.channelId, body.accepted)); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });
/** Leave a human group. */
router.post('/groups/:channelId/leave', async (req: Request<{ channelId: string }>, res: Response) => { try { res.json(await socialRuntime.leave(req.params.channelId)); } catch (error) { res.status(400).json({ error: errorMessage(error) }); } });

/** Stream committed social events as an SSE connection. */
router.get('/events/stream', (req: Request, res: Response) => { if (!socialRuntime.isRunning()) { res.status(404).json({ error: 'No social session is active' }); return; } res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders(); const unsubscribe = socialRuntime.events.subscribe((event) => { const safeEvent = event.type === 'message-added' ? { type: event.type, message: { id: event.message.id, channelId: event.message.channelId } } : event.type === 'membership-changed' ? { type: event.type, membership: { id: event.membership.id, channelId: event.membership.channelId, actorId: event.membership.actorId, status: event.membership.status } } : event; res.write(`event: ${event.type}\ndata: ${JSON.stringify(safeEvent)}\n\n`); }); req.on('close', unsubscribe); });

export default router;
