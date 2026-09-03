/**
 * @module web/routes/social
 *
 * Social-layer API for the Civ pilot dashboard (World / Groups / DMs panes).
 *
 * The social store is the same authoritative world channel the harness reads:
 *   - world + group posts live in the MCP GlobalMessages feed (broadcast-message /
 *     get-global-messages, ported into mcp-server);
 *   - private messages live in the DurableConversation pair threads (append-message /
 *     read-transcript);
 *   - group registry (titles, membership, invites, archives) lives in the pilot's
 *     channels.json via live/channels.mjs (single source of truth, shared with the
 *     OpenCode harness).
 *
 * The dashboard is a human client: it bypasses the model one-send-per-turn guard
 * (humans may post freely; the LLM backpressure applies to harness turns only) and
 * speaks as whatever seat the user has selected from the Social tab.
 */

import { Router, Request, Response } from 'express';
import { mcpClient } from '../../utils/models/mcp-client.js';
import { unwrapMcpResponse } from '../../utils/models/mcp-response.js';
import { createLogger } from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';

const logger = createLogger('webui:social-routes');

export interface SocialSeat {
  seat: number;
  civ: string;
  leader: string;
  playedBy?: 'codex' | 'opencode' | 'human';
  sessionId?: string;
  stateFile?: string;
  // live fields merged from the seat state file on each read
  lastSeenTurn?: number;
  lastTurnAt?: number;
  messageCount?: number;
}

interface ErrorResponse { error: string; }

const OBSERVER_ID = -1;

/** The pilot live dir (seats, state files, channels.json). */
function resolveLiveDir(): string {
  const env = process.env.CIV_PILOT_SOCIAL_DIR;
  if (env) return env;
  const candidates = [
    path.resolve(process.cwd(), 'experiments', 'opencode-civ-pilot', 'live'),
    path.resolve(process.cwd(), '..', 'experiments', 'opencode-civ-pilot', 'live'),
    path.resolve(process.cwd(), 'vox-agents', '..', 'experiments', 'opencode-civ-pilot', 'live'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* keep probing */ }
  }
  return candidates[0];
}

let liveDirCache: string | null = null;
function liveDir(): string {
  if (!liveDirCache) liveDirCache = resolveLiveDir();
  return liveDirCache;
}

/** Point channels.mjs at the same registry file the harness uses. */
function ensureChannelsEnv(): void {
  if (!process.env.CIV_PILOT_CHANNELS_FILE) {
    process.env.CIV_PILOT_CHANNELS_FILE = path.join(liveDir(), 'channels.json');
  }
}

let channelsModulePromise: Promise<any> | null = null;
function channelsModule(): Promise<any> {
  ensureChannelsEnv();
  if (!channelsModulePromise) {
    const mod = process.env.CIV_PILOT_CHANNELS_MODULE || path.join(liveDir(), 'channels.mjs');
    channelsModulePromise = import(pathToFileURL(mod).href).catch((err) => {
      channelsModulePromise = null;
      throw new Error(`social channels module unavailable: ${(err as Error).message}`);
    });
  }
  return channelsModulePromise;
}

/** Default names for the pilot duel, used only to label seats that lack state metadata. */
const DEFAULT_NAMES: Record<number, { civ: string; leader: string }> = {
  0: { civ: 'Portugal', leader: 'Maria I' },
  1: { civ: 'Siam', leader: 'Ramkhamhaeng' },
};

function readStateFile(file: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

function seatsFile(): string {
  return process.env.CIV_PILOT_SEATS_FILE || path.join(liveDir(), 'social-seats.json');
}

async function loadSeats(): Promise<SocialSeat[]> {
  let raw: SocialSeat[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(seatsFile(), 'utf8')) as SocialSeat[];
    if (Array.isArray(parsed)) raw = parsed;
  } catch { raw = []; }
  if (!raw.length) {
    // Fallback: synthesize from the seat state files the harnesses maintain.
    let files: string[] = [];
    try {
      files = fs.readdirSync(liveDir()).filter((f) => /^civ-state-.+\.json$/.test(f));
    } catch { files = []; }
    files.sort();
    for (const f of files) {
      const st = readStateFile(path.join(liveDir(), f));
      if (!st) continue;
      const seat = Number((st as any).seat ?? (f.match(/\d+/) ?? [null])[0]);
      if (!Number.isInteger(seat)) continue;
      const names = ((st as any).civ && (st as any).leader)
        ? { civ: String((st as any).civ), leader: String((st as any).leader) }
        : DEFAULT_NAMES[seat] ?? { civ: `Seat ${seat}`, leader: '' };
      raw.push({
        seat,
        civ: names.civ,
        leader: names.leader,
        playedBy: (st as any).playedBy as SocialSeat['playedBy'],
        sessionId: (st as any).sessionId as string | undefined,
        stateFile: path.join(liveDir(), f),
        lastSeenTurn: Number((st as any).lastSeenTurn ?? 0),
        lastTurnAt: Number((st as any).lastTurnAt ?? 0),
        messageCount: Number((st as any).messageCount ?? 0),
      });
    }
  }
  // Merge live state fields from each seat's own state file.
  return raw.map((s) => {
    const f = s.stateFile || path.join(liveDir(), `civ-state-${s.seat}.json`);
    const st = readStateFile(f);
    if (!st) return s;
    return {
      ...s,
      stateFile: f,
      lastSeenTurn: Number((st as any).lastSeenTurn ?? s.lastSeenTurn ?? 0),
      lastTurnAt: Number((st as any).lastTurnAt ?? s.lastTurnAt ?? 0),
      messageCount: Number((st as any).messageCount ?? s.messageCount ?? 0),
    };
  }).sort((a, b) => a.seat - b.seat);
}

function seatName(seats: SocialSeat[], id: number): string {
  if (id === OBSERVER_ID) return 'Observer';
  const s = seats.find((x) => x.seat === id);
  return s ? `${s.civ} (${s.leader})`.trim() : `Seat ${id}`;
}

/** Connect to the MCP server with a short deadline; throws a clean message when down. */
async function prepMcp(timeoutMs = 6000): Promise<void> {
  if (mcpClient.connected) return;
  const result = await Promise.race([
    mcpClient.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('MCP not reachable; is the game stack running?')), timeoutMs)
    ),
  ]);
  return result;
}

/** Read-oriented helper that returns null on MCP failure so polling never throws. */
async function tryCall<T = Record<string, any>>(tool: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await mcpClient.callTool(tool, args);
    return unwrapMcpResponse(res, tool) as T;
  } catch (err) {
    logger.warn(`social ${tool} failed: ${(err as Error).message}`);
    return null;
  }
}

async function readWorldMessages(limit: number): Promise<any[]> {
  const out = await tryCall('get-global-messages', { Limit: limit });
  const msgs = (out as any)?.messages ?? [];
  return msgs.map((m: any) => ({
    ID: m.ID, Turn: m.Turn, SpeakerID: m.SpeakerID,
    SpeakerRole: m.SpeakerRole ?? null, Content: m.Content,
    ReplyToID: m.ReplyToID ?? null, CreatedAt: m.CreatedAt,
  }));
}

async function readTransfer(seat: number, other: number, limit = 20): Promise<any[]> {
  const out = await tryCall('read-transcript', {
    PlayerAID: Math.min(seat, other),
    PlayerBID: Math.max(seat, other),
    Limit: limit,
  });
  return (out as any)?.messages ?? [];
}

export function createSocialRoutes(): Router {
  const router = Router();

  /**
   * GET /api/social/status
   * Cheap poll target: game context (no snapshot lock), seats with their
   * per-seat lastSeenTurn, and the group registry.
   */
  router.get('/status', async (_req: Request, res: Response<any | ErrorResponse>) => {
    try {
      const seats = await loadSeats();
      const ch = await channelsModule();
      let groups: any[] = [];
      try {
        groups = ch.visibleGroups ? [] : [];
        for (const g of ch.loadStore().groups) groups.push(g);
      } catch (err) { groups = []; }
      let game: { gameID: string; turn: number; activePlayerId: number } | null = null;
      try {
        await prepMcp(2000);
        const st = await tryCall('get-game-status', {});
        if (st) game = (st as any) as { gameID: string; turn: number; activePlayerId: number };
      } catch { /* MCP down: game stays null, Social tab shows mcpDown */ }
      res.json({ socialDir: liveDir(), game, seats, groups });
    } catch (err) {
      logger.error('Failed social status', { error: err });
      res.status(500).json({ error: `Failed to get social status: ${(err as Error).message}` });
    }
  });

  /**
   * GET /api/social/messages?seat=0
   * Composes the world feed, per-group inboxes, and per-pair DM threads for one
   * control seat. Same authoritative reads the model inbox uses.
   */
  router.get('/messages', async (req: Request, res: Response<any | ErrorResponse>) => {
    try {
      const raw = req.query.seat;
      const seat = Number(Array.isArray(raw) ? raw[0] : raw ?? 0);
      if (!Number.isInteger(seat)) {
        res.status(400).json({ error: `seat must be an integer (got ${JSON.stringify(raw)})` }); return;
      }
      const seats = await loadSeats();
      const seatCfg = seats.find((s) => s.seat === seat);
      const lastSeenTurn = Number(seatCfg?.lastSeenTurn ?? 0);
      const ch = await channelsModule();

      try { await prepMcp(2000); } catch { res.json({ seat, lastSeenTurn, world: [], groups: [], dms: [], invites: [], mcpDown: true }); return; }

      const worldMsgs = await readWorldMessages(50);
      const world = worldMsgs.map((m) => ({ ...m, speaker: seatName(seats, m.SpeakerID) }));

      // Groups: registry + tagged lines from the already-fetched world feed.
      const groups: any[] = [];
      const invites: string[] = [];
      try {
        const all = ch.loadStore().groups;
        for (const g of all) {
          if (g.archived) continue;
          const me = (g.members ?? []).find((m: any) => m.seat === seat);
          if (!me) continue;
          const tagged = worldMsgs.filter((m) => {
            const t = ch.parseTag(m.Content);
            if (!t || t.id !== g.id) return false;
            if ((m.Turn ?? 0) <= lastSeenTurn) return false;
            if ((m.ID ?? 0) <= (me.visibleAfter ?? 0)) return false;
            if (me.leftAfter != null && (m.ID ?? 0) > me.leftAfter) return false;
            return true;
          });
          const messages = tagged.map((m) => ({
            ...m,
            speaker: seatName(seats, m.SpeakerID),
            body: String(m.Content).replace(/^\[#[^\]]+\]\s?/, ''),
          }));
          groups.push({ id: g.id, title: g.title, createdBy: g.createdBy, archived: !!g.archived,
            myStatus: me.status, members: g.members, messages });
        }
      } catch { /* groups optional */ }

      // DM threads per other seat.
      const dms: any[] = [];
      for (const other of seats) {
        if (other.seat === seat) continue;
        try {
          const rows = await readTransfer(seat, other.seat, 20);
          const messages = rows
            .filter((r) => (r.Turn ?? 0) > lastSeenTurn)
            .map((r) => ({ ...r, speaker: seatName(seats, r.SpeakerID) }));
          dms.push({ seat: other.seat, civ: other.civ, leader: other.leader, messages });
        } catch { /* per-pair optional */ }
      }

      res.json({ seat, lastSeenTurn, world, groups, dms, invites });
    } catch (err) {
      logger.error('Failed social messages', { error: err });
      res.status(500).json({ error: `Failed to get social messages: ${(err as Error).message}` });
    }
  });

  /**
   * POST /api/social/send
   * Speak as a seat: world ('world'), DM ('dm:<seat>'), group ('group:<id>' /
   * 'group:create:<title>' / 'group:invite:<id>:<seat>').
   */
  router.post('/send', async (req: Request, res: Response<any | ErrorResponse>) => {
    try {
      const body = req.body ?? {};
      const seat = Number(body.seat ?? 0);
      const channel = String(body.channel ?? '');
      const message = String(body.message ?? '');
      if (!Number.isInteger(seat)) { res.status(400).json({ error: 'seat must be an integer' }); return; }
      if (!message.trim()) { res.status(400).json({ error: 'message is required' }); return; }
      if (message.length > 1000) { res.status(400).json({ error: 'message too long (1000 chars max)' }); return; }

      await prepMcp();
      const ch = await channelsModule();

      if (channel === 'world') {
        const out = await tryCall('broadcast-message', { PlayerID: seat, Content: message });
        if (!out) { res.status(502).json({ error: 'broadcast failed' }); return; }
        res.json({ ok: true, channel: 'world', id: (out as any).ID });
        return;
      }

      if (channel.startsWith('dm:')) {
        const target = Number(channel.slice(3).trim());
        if (!Number.isInteger(target)) { res.status(400).json({ error: "dm channel needs a seat number, e.g. channel 'dm:0'" }); return; }
        if (target === seat) { res.status(400).json({ error: 'cannot DM yourself; pick another seat' }); return; }
        if (target < 0 || target > 63) { res.status(400).json({ error: 'dm seat out of range' }); return; }
        const out = await tryCall('append-message', {
          PlayerAID: Math.min(seat, target), PlayerBID: Math.max(seat, target),
          PlayerARole: 'strategist', PlayerBRole: 'strategist',
          SpeakerID: seat, MessageType: 'text', Content: message,
        });
        if (!out) { res.status(502).json({ error: 'dm send failed' }); return; }
        res.json({ ok: true, channel: 'dm:' + target, id: (out as any).ID });
        return;
      }

      if (channel.startsWith('group:')) {
        const rest = channel.slice('group:'.length);
        if (rest.startsWith('create:')) {
          const title = rest.slice('create:'.length).trim().slice(0, 60);
          if (!title) { res.status(400).json({ error: "group:create needs a title, e.g. channel 'group:create:War Council'" }); return; }
          const g = ch.createGroup({ title, creator: seat, members: [seat] });
          const tagged = ch.tagMessage(g.id, g.title, message);
          const out = await tryCall('broadcast-message', { PlayerID: seat, Content: tagged });
          if (!out) { res.status(502).json({ error: 'group create broadcast failed' }); return; }
          res.json({ ok: true, channel: 'group:' + g.id, id: (out as any).ID });
          return;
        }
        if (rest.startsWith('invite:')) {
          const cut = rest.slice('invite:'.length);
          const sep = cut.indexOf(':');
          const gid = (sep >= 0 ? cut.slice(0, sep) : cut).trim();
          const target = sep >= 0 ? Number(cut.slice(sep + 1).trim()) : NaN;
          if (!gid || !Number.isInteger(target)) {
            res.status(400).json({ error: "group:invite needs an id and seat, e.g. channel 'group:invite:ab12cd34:0'" }); return;
          }
          ch.inviteToGroup(gid, target, seat);
          const g = ch.getGroup(gid);
          const tagged = ch.tagMessage(g.id, g.title, message);
          const out = await tryCall('broadcast-message', { PlayerID: seat, Content: tagged });
          if (!out) { res.status(502).json({ error: 'group invite broadcast failed' }); return; }
          res.json({ ok: true, channel: 'group:' + gid, invited: target, id: (out as any).ID });
          return;
        }
        const gid = rest.trim();
        if (!gid) { res.status(400).json({ error: "group channel needs an id, e.g. 'group:ab12cd34'" }); return; }
        const status = ch.memberStatus(gid, seat);
        if (status === 'invited') {
          // First send accepts the invite, same as the harness path.
          ch.markMemberActive(gid, seat);
        } else if (status !== 'active') {
          res.status(400).json({ error: `not a member of group '${gid}'` }); return;
        }
        const g = ch.getGroup(gid);
        const tagged = ch.tagMessage(g.id, g.title, message);
        const out = await tryCall('broadcast-message', { PlayerID: seat, Content: tagged });
        if (!out) { res.status(502).json({ error: 'group send failed' }); return; }
        res.json({ ok: true, channel: 'group:' + gid, id: (out as any).ID });
        return;
      }

      res.status(400).json({ error: "unknown channel; use 'world', 'dm:<seat>', or 'group:<id>'" });
    } catch (err) {
      logger.error('Failed social send', { error: err });
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** POST /api/social/groups/resolve — accept (or decline) a pending invite. */
  router.post('/groups/resolve', async (req: Request, res: Response<any | ErrorResponse>) => {
    try {
      const body = req.body ?? {};
      const gid = String(body.groupId ?? '');
      const seat = Number(body.seat ?? 0);
      const accept = body.accept !== false;
      if (!gid || !Number.isInteger(seat)) { res.status(400).json({ error: 'groupId and seat required' }); return; }
      const ch = await channelsModule();
      const g = ch.resolveInvite(gid, seat, !!accept);
      res.json({ ok: true, groupId: gid, accepted: !!accept, title: g.title });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** POST /api/social/groups/leave — leave a group as a seat. */
  router.post('/groups/leave', async (req: Request, res: Response<any | ErrorResponse>) => {
    try {
      const body = req.body ?? {};
      const gid = String(body.groupId ?? '');
      const seat = Number(body.seat ?? 0);
      if (!gid || !Number.isInteger(seat)) { res.status(400).json({ error: 'groupId and seat required' }); return; }
      const ch = await channelsModule();
      const g = ch.leaveGroup(gid, seat);
      res.json({ ok: true, groupId: gid, title: g.title });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** POST /api/social/groups/archive — archive a group (active members only). */
  router.post('/groups/archive', async (req: Request, res: Response<any | ErrorResponse>) => {
    try {
      const body = req.body ?? {};
      const gid = String(body.groupId ?? '');
      const seat = Number(body.seat ?? 0);
      if (!gid || !Number.isInteger(seat)) { res.status(400).json({ error: 'groupId and seat required' }); return; }
      const ch = await channelsModule();
      const g = ch.archiveGroup(gid, seat);
      res.json({ ok: true, groupId: gid, title: g.title });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}

export default createSocialRoutes();
