// A stand-in for the Vox MCP server, so a live run can be played without
// Civilization V installed.
//
// The live world reaches a game through Vox Deorum's MCP tools. A fake connector
// proves the harness makes the right calls, but it cannot prove the part that
// matters most: in a live run each seat reaches the game through its own tool
// server, in its own process, over the MCP protocol. This server speaks that
// protocol on the same streamable HTTP transport the real one uses and answers
// the tools a live run needs, which is what lets a whole live run be played,
// paced, recorded and read with no game at all.
//
// It is not a simulation of Civilization V and does not pretend to be. It holds
// what the round trip needs in order to mean something: a clock that really
// moves and really holds, players whose reads change when their writes land, a
// transcript with real message ids, and deals that validate before they enact.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "../utils/logger.js";

// One seat at this table.
export interface FakeSeat {
  // The seat name the harness uses, such as "korea".
  seat: string;
  // The player index every read and write is addressed by.
  playerID: number;
  // The civilization's name, as the game reports it.
  civ: string;
  // The leader's name.
  leader: string;
}

// Everything this stand-in game needs to start.
export interface FakeGameOptions {
  // The seats at the table. The first four also get a real capital name.
  seats: FakeSeat[];
  // How long a turn lasts while the game is running, in milliseconds.
  turnMs?: number;
  // The turn the game starts on.
  startTurn?: number;
}

// What one player holds, as far as the tools can see.
interface FakePlayer {
  gold: number;
  goldPerTurn: number;
  sciencePerTurn: number;
  culturePerTurn: number;
  research: string | null;
  policy: string | null;
  grandStrategy: string | null;
  cities: Array<{ name: string; population: number }>;
  units: number;
  militaryStrength: number;
  score: number;
  happy: boolean;
  // Regard toward each other player, by player index.
  regard: Record<number, { public: number; private: number }>;
}

// One row of the game's own diplomatic transcript.
interface FakeRow {
  ID: number;
  Player1ID: number;
  Player2ID: number;
  SpeakerID: number;
  MessageType: string;
  Content: string;
  Payload: Record<string, unknown>;
  Turn: number;
  CreatedAt: number;
}

// What has happened at this table, which is what the politics read answers with.
interface FakeEvent {
  turn: number;
  type: string;
  summary: string;
}

// The message types that close a proposal, so an answered offer is not open.
const answerTypes = ["deal-accept", "deal-reject", "deal-enacted"];

// The technologies and policies a seat may name. Small on purpose: a stand-in
// only has to be able to accept and refuse an answer, not to be a tech tree.
const technologies = ["Pottery", "Animal Husbandry", "Mining", "Trapping", "The Wheel", "Writing", "Archery"];
const policies = ["Tradition Opener", "Tradition Aristocracy", "Tradition Oligarchy", "Liberty Opener"];

// The capital each of the bench's four seats builds, so a read looks like a game
// rather than like a fixture.
const capitals: Record<string, string> = {
  korea: "Seoul",
  austria: "Vienna",
  siam: "Sukhothai",
  iroquois: "Onondaga"
};

// Play one stand-in game and answer the tools for it.
export class FakeGame {
  // The seats at the table, by player index.
  readonly seats: FakeSeat[];

  // What each player holds, by player index.
  private readonly players = new Map<number, FakePlayer>();

  // The transcript, in the order rows were written.
  private readonly rows: FakeRow[] = [];

  // What has happened, oldest first.
  private readonly events: FakeEvent[] = [];

  // How long a turn lasts while the game is running.
  private readonly turnMs: number;

  // The turn the game is on.
  private turn: number;

  // Whether the game is holding still.
  private paused = false;

  // When the current turn began, which is what the clock advances from.
  private turnStartedAt = Date.now();

  // The next id a transcript row will be given.
  private nextRowID = 1;

  // Build a game at its opening position.
  constructor(options: FakeGameOptions) {
    this.seats = options.seats;
    this.turnMs = options.turnMs ?? 4000;
    this.turn = options.startTurn ?? 1;
    for (const seat of this.seats) {
      this.players.set(seat.playerID, {
        gold: 40,
        goldPerTurn: 5,
        sciencePerTurn: 4,
        culturePerTurn: 2,
        research: null,
        policy: null,
        grandStrategy: null,
        cities: [{ name: capitals[seat.seat.toLowerCase()] ?? seat.civ + " Capital", population: 2 }],
        units: 2,
        militaryStrength: 15,
        score: 30,
        happy: true,
        regard: {}
      });
    }
    for (const seat of this.seats) {
      const player = this.players.get(seat.playerID) as FakePlayer;
      for (const other of this.seats) {
        if (other.playerID !== seat.playerID) player.regard[other.playerID] = { public: 0, private: 0 };
      }
    }
    this.record("GameStarted", "The game opened with " + this.seats.length + " seats.");
  }

  // The turn the game is on, after letting it run for however long has passed.
  //
  // Calling this at the top of every tool is what makes the clock real: a game
  // that is not held moves, which is the condition pacing exists to cope with.
  private tick(): void {
    if (this.paused) return;
    const elapsed = Date.now() - this.turnStartedAt;
    const advanced = Math.floor(elapsed / this.turnMs);
    if (advanced <= 0) return;
    this.turn += advanced;
    this.turnStartedAt += advanced * this.turnMs;
    for (let step = 0; step < advanced; step += 1) {
      for (const seat of this.seats) this.advance(this.players.get(seat.playerID) as FakePlayer);
    }
    this.record("TurnAdvanced", "The game advanced to turn " + this.turn + ".");
  }

  // Let one player's economy run for a turn.
  private advance(player: FakePlayer): void {
    player.gold = Math.round((player.gold + player.goldPerTurn) * 10) / 10;
    player.score += 1;
  }

  // Note something that happened, so the politics read has something to say.
  private record(type: string, summary: string): void {
    this.events.push({ turn: this.turn, type, summary });
  }

  // The current turn, for a caller that wants it without a tool call.
  get currentTurn(): number {
    this.tick();
    return this.turn;
  }

  // Every row written so far, which is what a transcript read filters.
  get transcript(): readonly FakeRow[] {
    return this.rows;
  }

  // Answer one tool call the way the game's own server does: with text.
  async call(name: string, args: Record<string, unknown> = {}): Promise<string> {
    this.tick();
    const number = (key: string): number => Number(args[key]);
    const player = this.players.get(number("PlayerID"));
    switch (name) {
      case "get-metadata":
        // The turn is answered as a bare number, which is the shape the harness
        // reads a clock from.
        return args.Key === "turn" ? String(this.turn) : "";
      case "pause-game":
        this.paused = true;
        return "true";
      case "resume-game":
        this.paused = false;
        this.turnStartedAt = Date.now();
        return "true";
      case "get-players":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        return JSON.stringify({ Players: this.seats.map((seat) => this.playerView(seat)) });
      case "get-cities":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        return JSON.stringify({ Cities: player.cities.map((city) => ({ Name: city.name, Population: city.population })) });
      case "get-military-report":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        return JSON.stringify({ Units: player.units, Strength: player.militaryStrength, Supply: 14 });
      case "get-options":
        return JSON.stringify({ Technologies: technologies, Policies: policies });
      case "get-victory-progress":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        return JSON.stringify({ ScienceVictory: { Progress: player.score }, Score: player.score });
      case "get-opinions":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        return JSON.stringify({
          Opinions: this.seats
            .filter((seat) => seat.playerID !== number("PlayerID"))
            .map((seat) => ({
              PlayerID: seat.playerID,
              Civ: seat.civ,
              Public: player.regard[seat.playerID]?.public ?? 0,
              Private: player.regard[seat.playerID]?.private ?? 0
            }))
        });
      case "get-events":
        return JSON.stringify({ Events: this.events.slice(-12).map((event) => ({ Turn: event.turn, Type: event.type, Detail: event.summary })) });
      case "get-diplomatic-events":
        return JSON.stringify({
          Turn: this.turn,
          Events: this.events
            .filter((event) => event.type !== "TurnAdvanced")
            .map((event) => ({ Turn: event.turn, Type: event.type, Summary: event.summary }))
        });
      case "inspect-deal":
        return JSON.stringify({ Items: [], Promises: [] });
      case "read-transcript":
        return JSON.stringify({ messages: this.pairRows(number("PlayerAID"), number("PlayerBID"), args) });
      case "set-research":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        if (!technologies.includes(String(args.Technology))) {
          return this.refuse("INVALID_TECHNOLOGY", "the game has no technology named '" + args.Technology + "'");
        }
        player.research = String(args.Technology);
        this.record("ResearchSet", this.civOf(number("PlayerID")) + " set research to " + args.Technology + ".");
        return JSON.stringify({ Success: true, PlayerID: number("PlayerID"), Technology: player.research });
      case "set-policy":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        if (!policies.includes(String(args.Policy))) {
          return this.refuse("INVALID_POLICY", "the game has no policy named '" + args.Policy + "'");
        }
        player.policy = String(args.Policy);
        this.record("PolicyAdopted", this.civOf(number("PlayerID")) + " adopted " + args.Policy + ".");
        return JSON.stringify({ Success: true, PlayerID: number("PlayerID"), Policy: player.policy });
      case "set-relationship":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        if (player.regard[number("TargetID")] === undefined) {
          return this.refuse("NO_SUCH_PLAYER", "no player " + args.TargetID + " in this game");
        }
        player.regard[number("TargetID")] = {
          public: Number(args.Public ?? player.regard[number("TargetID")].public),
          private: Number(args.Private ?? player.regard[number("TargetID")].private)
        };
        this.record("RelationshipSet", this.civOf(number("PlayerID")) + " set its regard toward " + this.civOf(number("TargetID")) + ".");
        return JSON.stringify({ Success: true, TargetID: number("TargetID") });
      case "set-strategy":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        player.grandStrategy = typeof args.GrandStrategy === "string" ? args.GrandStrategy : player.grandStrategy;
        this.record("StrategySet", this.civOf(number("PlayerID")) + " declared " + player.grandStrategy + ".");
        return JSON.stringify({ Success: true, GrandStrategy: player.grandStrategy });
      case "keep-status-quo":
        if (!player) return this.refuse("NO_SUCH_PLAYER", "no player " + args.PlayerID + " in this game");
        return JSON.stringify({ Success: true });
      case "append-message":
        return this.appendMessage(args);
      case "enact-agent-deal":
        return this.enactDeal(args);
      case "reject-agent-deal":
        return this.rejectDeal(args);
      default:
        return this.refuse("UNKNOWN_TOOL", "this game does not offer '" + name + "'");
    }
  }

  // What one seat's own read looks like.
  private playerView(seat: FakeSeat): Record<string, unknown> {
    const player = this.players.get(seat.playerID) as FakePlayer;
    return {
      PlayerID: seat.playerID,
      Civ: seat.civ,
      Leader: seat.leader,
      Gold: player.gold,
      GoldPerTurn: player.goldPerTurn,
      Happiness: player.happy ? "Happy" : "Unhappy",
      CurrentResearch: player.research,
      CurrentPolicy: player.policy,
      GrandStrategy: player.grandStrategy,
      Cities: player.cities.length,
      Population: player.cities.reduce((total, city) => total + city.population, 0),
      MilitaryStrength: player.militaryStrength,
      Score: player.score
    };
  }

  // The civilization a player index belongs to.
  private civOf(playerID: number): string {
    return this.seats.find((seat) => seat.playerID === playerID)?.civ ?? "player " + playerID;
  }

  // The rows of one conversation, ordered by append id.
  //
  // A conversation belongs to a pair rather than to a speaker, so the two
  // endpoints are ordered the same way however the caller names them, and both
  // directions read as one thread.
  private pairRows(playerA: number, playerB: number, args: Record<string, unknown>): FakeRow[] {
    const first = Math.min(playerA, playerB);
    const second = Math.max(playerA, playerB);
    const limit = typeof args.Limit === "number" ? args.Limit : undefined;
    let rows = this.rows.filter((row) => row.Player1ID === first && row.Player2ID === second);
    if (typeof args.MessageType === "string") rows = rows.filter((row) => row.MessageType === args.MessageType);
    if (limit !== undefined) rows = rows.slice(-limit);
    return rows;
  }

  // Write one row into a pair's conversation and answer with the row, whose id
  // is what both sides quote when they answer it.
  private appendMessage(args: Record<string, unknown>): string {
    const playerA = Number(args.PlayerAID);
    const playerB = Number(args.PlayerBID);
    if (!this.players.has(playerA) || !this.players.has(playerB)) {
      return this.refuse("NO_SUCH_PLAYER", "this conversation names a player who is not in the game");
    }
    const row: FakeRow = {
      ID: this.nextRowID++,
      Player1ID: Math.min(playerA, playerB),
      Player2ID: Math.max(playerA, playerB),
      SpeakerID: Number(args.SpeakerID ?? playerA),
      MessageType: typeof args.MessageType === "string" ? args.MessageType : "text",
      Content: typeof args.Content === "string" ? args.Content : "",
      Payload: args.Payload !== null && typeof args.Payload === "object" ? (args.Payload as Record<string, unknown>) : {},
      Turn: this.turn,
      CreatedAt: Date.now()
    };
    this.rows.push(row);
    if (row.MessageType === "deal-proposal") {
      this.record("DealProposed", this.civOf(row.SpeakerID) + " put a deal to " + this.civOf(row.SpeakerID === playerA ? playerB : playerA) + ".");
    }
    return JSON.stringify(row);
  }

  // The proposal a row id names, when it is one and is still open.
  private openProposal(id: number): FakeRow | string {
    const proposal = this.rows.find((row) => row.ID === id);
    if (!proposal) return this.refuse("NOT_FOUND", "proposal message " + id + " does not exist");
    if (proposal.MessageType !== "deal-proposal" && proposal.MessageType !== "deal-counter") {
      return this.refuse("NOT_A_PROPOSAL", "message " + id + " is not a deal proposal");
    }
    const answered = this.rows.some((row) => {
      if (!answerTypes.includes(row.MessageType)) return false;
      return (row.Payload as { ProposalMessageID?: unknown }).ProposalMessageID === id;
    });
    if (answered) return this.refuse("NOT_OPEN", "proposal " + id + " has already been answered");
    return proposal;
  }

  // Enact an accepted offer: transfer what it promised, then record that it was
  // agreed and enacted. This is the one place a deal costs anything.
  private enactDeal(args: Record<string, unknown>): string {
    const id = Number(args.ProposalMessageID);
    const accepter = Number(args.AccepterID);
    const held = this.openProposal(id);
    if (typeof held === "string") return held;
    const deal = held.Payload.Deal as { items?: unknown } | undefined;
    const items = Array.isArray(deal?.items) ? (deal?.items as Array<Record<string, unknown>>) : [];
    for (const item of items) {
      const giver = this.players.get(Number(item.fromPlayerID));
      const receiver = this.players.get(Number(item.toPlayerID));
      if (!giver || !receiver) continue;
      if (item.itemType === "GOLD") {
        const amount = Math.min(Number(item.amount ?? 0), Math.max(0, giver.gold));
        giver.gold = Math.round((giver.gold - amount) * 10) / 10;
        receiver.gold = Math.round((receiver.gold + amount) * 10) / 10;
      }
    }
    const speaker = this.rows.find((row) => row.ID === id)?.SpeakerID ?? accepter;
    const pair = this.rows.find((row) => row.ID === id) as FakeRow;
    this.appendMessage({
      PlayerAID: pair.Player1ID,
      PlayerBID: pair.Player2ID,
      SpeakerID: accepter,
      MessageType: "deal-accept",
      Content: typeof args.Content === "string" ? args.Content : "",
      Payload: { ProposalMessageID: id }
    });
    const enacted = JSON.parse(
      this.appendMessage({
        PlayerAID: pair.Player1ID,
        PlayerBID: pair.Player2ID,
        SpeakerID: accepter,
        MessageType: "deal-enacted",
        Content: "",
        Payload: { ProposalMessageID: id }
      })
    ) as FakeRow;
    this.record("DealEnacted", this.civOf(accepter) + " accepted a deal from " + this.civOf(speaker) + ".");
    return JSON.stringify({ Success: true, Enacted: true, EnactedMessageID: enacted.ID });
  }

  // Refuse an offer, which closes it without anything changing hands.
  private rejectDeal(args: Record<string, unknown>): string {
    const id = Number(args.ProposalMessageID);
    const held = this.openProposal(id);
    if (typeof held === "string") return held;
    this.appendMessage({
      PlayerAID: held.Player1ID,
      PlayerBID: held.Player2ID,
      SpeakerID: Number(args.SpeakerID ?? args.AccepterID ?? held.Player1ID),
      MessageType: "deal-reject",
      Content: typeof args.Content === "string" ? args.Content : "",
      Payload: { ProposalMessageID: id }
    });
    this.record("DealRejected", "A deal was refused.");
    return JSON.stringify({ Success: true });
  }

  // The shape the game uses to say it will not do something. It is a successful
  // call whose payload carries the refusal, which is the harder of the two
  // refusal shapes for a caller to notice, so the stand-in produces it.
  private refuse(code: string, message: string): string {
    return JSON.stringify({ Success: false, Error: { Code: code, Message: message } });
  }
}

// Every tool this stand-in answers. It is the set a live run requires plus the
// ones a seat reaches for on its own: the transcript, its deals, and the clock.
export const fakeGameTools = [
  "get-players",
  "get-cities",
  "get-military-report",
  "get-options",
  "get-victory-progress",
  "get-opinions",
  "get-events",
  "get-diplomatic-events",
  "get-metadata",
  "inspect-deal",
  "read-transcript",
  "set-research",
  "set-policy",
  "set-relationship",
  "set-strategy",
  "keep-status-quo",
  "append-message",
  "enact-agent-deal",
  "reject-agent-deal",
  "pause-game",
  "resume-game"
] as const;

// Build the MCP server for one stand-in game.
//
// The schemas are deliberately open. A stand-in has to accept the arguments the
// real tools accept, and describing each one again here would be a second copy
// of the real server's contract that could drift away from it.
export function createFakeGameServer(game: FakeGame): McpServer {
  const server = new McpServer({ name: "vox-civ-stand-in", version: "1.0.0", title: "Vox Civ stand-in game" });
  for (const name of fakeGameTools) {
    server.registerTool(
      name,
      { description: "Stand-in for the game's " + name + " tool.", inputSchema: z.looseObject({}) },
      async (args: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: await game.call(name, args ?? {}) }] })
    );
  }
  return server;
}

// One running stand-in game.
export interface RunningFakeGame {
  // The MCP endpoint a client should be pointed at, which is what
  // VOX_MCP_ENDPOINT takes.
  url: string;
  // The port it bound, which is the real one when the caller asked for zero.
  port: number;
  // Stop answering.
  close(): Promise<void>;
}

// Serve one stand-in game over the same streamable HTTP transport the real
// server uses, so a client cannot tell the difference by the protocol.
//
// One game is reached through one server per client session, which is how the
// real server behaves and what the harness needs: the run and each seat's own
// tool server are separate clients that all read the same table.
export async function serveFakeGame(game: FakeGame, port = 4100): Promise<RunningFakeGame> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const http = createServer((request, response) => {
    // A failure in one request must not take the game down with it, and an
    // unhandled rejection inside a bare `void` call would do exactly that.
    serve(request, response).catch((error: unknown) => {
      logger.warn("A stand-in game request failed: " + (error instanceof Error ? error.message : String(error)));
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
      if (!response.writableEnded) response.end(JSON.stringify({ error: "the stand-in game could not answer" }));
    });
  });

  // Answer one request, opening a session for a client that is introducing
  // itself and reusing the one it already has for everything after that.
  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = request.url ?? "";
    if (request.method === "GET" && route === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "healthy", turn: game.currentTurn }));
      return;
    }
    if (!route.startsWith("/mcp")) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "nothing answers there" }));
      return;
    }
    let body: unknown;
    if (request.method === "POST") {
      const read = await readBody(request);
      // A body that is not JSON is the request's problem, so it is answered
      // rather than thrown: a throw here would drop the socket and leave a
      // client with a reset instead of a reason.
      if (!read.ok) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
        return;
      }
      body = read.body;
    }
    const held = request.headers["mcp-session-id"];
    const sessionId = typeof held === "string" ? held : undefined;
    let transport = sessionId === undefined ? undefined : transports.get(sessionId);
    if (!transport && sessionId === undefined && isInitializeRequest(body)) {
      const opened = randomUUID();
      const fresh = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => opened,
        onsessioninitialized: (id) => {
          transports.set(id, fresh);
        },
        onsessionclosed: (id) => {
          transports.delete(id);
        }
      });
      await createFakeGameServer(game).connect(fresh);
      transport = fresh;
    }
    if (!transport) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: no session" }, id: null })
      );
      return;
    }
    await transport.handleRequest(request, response, body);
  }

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", () => {
      http.off("error", reject);
      resolve();
    });
  });
  const bound = (http.address() as { port: number }).port;
  return {
    url: "http://127.0.0.1:" + bound + "/mcp",
    port: bound,
    close: async () => {
      for (const transport of transports.values()) await transport.close().catch(() => undefined);
      transports.clear();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      http.closeAllConnections();
    }
  };
}

// Read a request body as JSON, saying plainly when it is not JSON.
async function readBody(request: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

// Read one seat as "seat:playerID:civ:leader", which is how the command line
// names a table. A malformed entry is skipped rather than guessed at.
export function readFakeSeats(value: string): FakeSeat[] {
  const seats: FakeSeat[] = [];
  for (const entry of value.split(",")) {
    const [seat, playerID, civ, leader] = entry.split(":");
    if (!seat || playerID === undefined) continue;
    const index = Number(playerID);
    if (!Number.isInteger(index)) continue;
    seats.push({
      seat: seat.trim(),
      playerID: index,
      civ: (civ ?? seat).trim(),
      leader: (leader ?? seat).trim()
    });
  }
  return seats;
}

// The seats a stand-in game starts with when the caller names none, which are the
// four the bench's runs use.
const benchSeats = [
  { seat: "korea", playerID: 0, civ: "Korea", leader: "Sejong" },
  { seat: "austria", playerID: 1, civ: "Austria", leader: "Maria Theresa" },
  { seat: "siam", playerID: 2, civ: "Siam", leader: "Ramkhamhaeng" },
  { seat: "iroquois", playerID: 3, civ: "Iroquois", leader: "Hiawatha" }
];

// Read a command line value, or use a default.
function value(name: string, fallback: string): string {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

// Start a stand-in game for a live run to be pointed at.
async function main(): Promise<void> {
  const seats = value("seats", "") === "" ? benchSeats : readFakeSeats(value("seats", ""));
  if (seats.length < 2) throw new Error("A stand-in game needs at least two seats");
  const game = new FakeGame({
    seats,
    turnMs: Number(value("turn-ms", "4000")),
    startTurn: Number(value("start-turn", "1"))
  });
  const running = await serveFakeGame(game, Number(value("port", "4100")));
  logger.info("The stand-in game is answering on " + running.url);
  logger.info("Point a live run at it with VOX_MCP_ENDPOINT=" + running.url);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void running.close().then(() => process.exit(0));
    });
  }
}

// A stand-in started by hand is a process of its own, so it only starts when this
// file is the entry point. Importing it to cover its behaviour starts nothing.
const entryPoint = process.argv[1];
if (entryPoint !== undefined && pathToFileURL(entryPoint).href === import.meta.url) {
  main().catch((error: unknown) => {
    logger.error("The stand-in game could not start: " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
