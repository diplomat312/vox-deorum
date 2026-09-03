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

let execModulePromise: Promise<any> | null = null;
function execModule(): Promise<any> {
  if (!execModulePromise) {
    const mod = process.env.CIV_PILOT_EXEC_MODULE || path.join(liveDir(), "..", "driver", "social-exec.mjs");
    execModulePromise = import(pathToFileURL(mod).href).catch((err) => {
      execModulePromise = null;
      throw new Error("social executor unavailable: " + (err as Error).message);
    });
  }
  return execModulePromise;
}

// Seat secrets for dashboard writes (pilot live/seats-secrets.json). The
// human holds their own seat secret; harness seats never post through the
// dashboard. Missing file means dev mode: attribution unchecked.
function readSecrets(): Record<string, string> {
  try {
    const f = process.env.CIV_PILOT_SECRETS_FILE || path.join(liveDir(), "seats-secrets.json");
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch { return {}; }
}

// Null when the seat may post, otherwise the rejection reason. Observer
// (-1) posts are Vox-labeled natively, so no secret impersonates anyone.
function requireSeatSecret(seat: number, provided: unknown): string | null {
  if (seat === OBSERVER_ID) return null;
  const all = readSecrets();
  if (!Object.keys(all).length) return null;
  const want = (all as Record<string, string>)[String(seat)];
  if (!want) return "unknown seat";
  if (provided !== want) return "wrong seat secret";
  return null;
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

      // Seats are stable harness ids; Vox threads use player ids recorded on
      // the seat rows at game boot (defaulting to seat number).
      const playerOf = (n: number): number => {
        const hit = seats.find((x) => x.seat === n);
        const p = Number((hit as any)?.playerID ?? n);
        return Number.isInteger(p) ? p : n;
      };
      // Pair threads carry tagged group lines under fan-out delivery: fetch
      // once per peer and share the rows between the group inbox and DMs.
      const pairRows: any[] = [];
      const pairBySeat = new Map<number, any[]>();
      for (const other of seats) {
        if (other.seat === seat) continue;
        try {
          const rows = await readTransfer(playerOf(seat), playerOf(other.seat), 30);
          pairBySeat.set(other.seat, rows);
          for (const r of rows) pairRows.push(r);
        } catch { pairBySeat.set(other.seat, []); }
      }
      // Groups: registry + tagged lines from the world feed and pair threads.
      const groups: any[] = [];
      const invites: string[] = [];
      try {
        const all = ch.loadStore().groups;
        for (const g of all) {
          if (g.archived) continue;
          const me = (g.members ?? []).find((m: any) => m.seat === seat);
          if (!me) continue;
          const tagged = [...worldMsgs, ...pairRows].filter((m) => {
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
          const rows = pairBySeat.get(other.seat) ?? [];
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
  router.post("/send", async (req: Request, res: Response<any | ErrorResponse>) => {
    try {
      const body = req.body ?? {};
      const seat = Number(body.seat ?? 0);
      if (!Number.isInteger(seat)) { res.status(400).json({ error: "seat must be an integer" }); return; }
      const secretErr = requireSeatSecret(seat, (body as any).secret);
      if (secretErr) { res.status(403).json({ error: secretErr }); return; }
      const rawOps = Array.isArray((body as any).operations) && (body as any).operations.length
        ? (body as any).operations
        : [{ channel: String(body.channel ?? ""), target: (body as any).target, message: String(body.message ?? "") }];
      if (seat === OBSERVER_ID && rawOps.some((o: any) => String(o?.channel ?? "") !== "world")) {
        res.status(400).json({ error: "observer posts are world-only" }); return;
      }
      await prepMcp();
      const exec = await execModule();
      const seats = await loadSeats();
      const transports = {
        broadcast: async (text: string) => {
          const r = await tryCall("broadcast-message", { PlayerID: seat, Content: text });
          if (!r) throw new Error("broadcast failed");
          return r;
        },
        pair: async (peer: number, text: string) => {
          const r = await tryCall("append-message", {
            PlayerAID: Math.min(seat, peer), PlayerBID: Math.max(seat, peer),
            PlayerARole: "strategist", PlayerBRole: "strategist",
            SpeakerID: seat, MessageType: "text", Content: text,
          });
          if (!r) throw new Error("send failed");
          return r;
        },
      };
      const out = await exec.executeOperations(rawOps, { me: seat, turn: null, seats, transports });
      const single = !Array.isArray((body as any).operations) || !(body as any).operations.length;
      if (single && out.results.length === 1 && (out.results[0] as any).error) {
        res.status(400).json({ error: (out.results[0] as any).error }); return;
      }
      res.json({ ok: true, executed: out.executed, results: out.results });
    } catch (err) {
      logger.error("Failed social send", { error: err });
      res.status(500).json({ error: "Failed social send: " + (err as Error).message });
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
      const secretErr = requireSeatSecret(seat, (body as any).secret);
      if (secretErr) { res.status(403).json({ error: secretErr }); return; }
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
      const secretErr = requireSeatSecret(seat, (body as any).secret);
      if (secretErr) { res.status(403).json({ error: secretErr }); return; }
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
      const secretErr = requireSeatSecret(seat, (body as any).secret);
      if (secretErr) { res.status(403).json({ error: secretErr }); return; }
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
