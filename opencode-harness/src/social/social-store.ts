// An append-only, file-backed social store for the seat harness. Several seats
// (Civilization players) trade world messages, direct messages, group messages,
// invitations and deal talk through one run directory. A run keeps a single
// JSONL log plus a single cursor file, so a run can be replayed and inspected
// without a database.
//
// Privacy is enforced when reading, never when writing: a world message is
// visible to every seat, a direct message only to the two seats in the pair, and
// a group message only to seats that accepted the group's invitation. An
// invitation on its own never grants membership; only accept does.

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// The largest batch of operations one call may carry.
export const maxOperationsPerBatch = 8;

// Every operation a seat may ask for. Each one carries only the fields it needs:
// world takes a message, dm takes a target seat and a message, group-create takes
// a name, invite takes a group and a target seat, accept takes a group, group-msg
// takes a group and a message, leave takes a group, deal-propose takes a target
// seat and at least one term, and deal-accept and deal-reject take the id of the
// proposal they answer.
export type OperationKind =
  | "world"
  | "dm"
  | "group-create"
  | "invite"
  | "accept"
  | "group-msg"
  | "leave"
  | "deal-propose"
  | "deal-accept"
  | "deal-reject";

// One requested social operation, as the caller hands it in.
export interface Operation {
  // Which operation to run.
  kind: OperationKind;
  // The message body for world, dm and group-msg.
  message?: string;
  // The target seat for dm and invite.
  to?: string;
  // The group name for group-create.
  name?: string;
  // The group id for invite, accept, group-msg and leave.
  group?: string;
  // A gold term of a proposed deal, in whole coins.
  gold?: number;
  // A per-turn gold term of a proposed deal, in whole coins per turn.
  goldPerTurn?: number;
  // A resource term of a proposed deal, named by the caller.
  resource?: string;
  // The id of the deal-propose entry a deal-accept or deal-reject answers.
  deal?: string;
}

// One recorded line of the log. Every entry carries a stable id, an ISO
// timestamp, the sender seat and the operation kind, so a reader can tell what
// happened and who did it without any extra bookkeeping.
export interface SocialEntry {
  // Stable id of the entry inside the run. Ids are positional, so replaying the
  // same operations in the same order in a fresh run directory reproduces them.
  id: string;
  // ISO timestamp of the moment the entry was appended.
  at: string;
  // The seat that authored the entry.
  from: string;
  // The operation that produced the entry.
  kind: OperationKind;
  // Where the entry is scoped: "world", "dm:<a>:<b>" or "group:<id>" for
  // messages, and the target seat for an invite.
  to?: string;
  // The message body, for world, dm and group-msg.
  text?: string;
  // The group name, for group-create.
  name?: string;
  // The group id, for invite, accept, group-msg and leave.
  group?: string;
  // A gold term of a proposed deal, in whole coins.
  gold?: number;
  // A per-turn gold term of a proposed deal, in whole coins per turn.
  goldPerTurn?: number;
  // A resource term of a proposed deal, named by the caller.
  resource?: string;
  // The id of the deal-propose entry a deal-accept or deal-reject answers.
  deal?: string;
}

// Where a run keeps its log and its cursors.
export interface StorePaths {
  // The append-only JSONL log, one entry per line.
  log: string;
  // The per-seat cursor file, one count per seat.
  cursors: string;
}

// What a seat sees when it reads its inbox: the entries it had not consumed yet,
// plus the cursor it now sits at.
export interface InboxPage {
  // Entries the seat may see, in log order.
  messages: SocialEntry[];
  // The seat's cursor after the read, counted in log entries.
  cursor: number;
}

// Extra context for a batch. Seats lists the roster of the run, which lets a
// direct message reach a seat that has not spoken yet.
export interface ApplyOptions {
  // The seats that exist in this run. When omitted, a seat counts as known once
  // it has appeared in the log, as a sender or as the target of a direct message
  // or an invitation.
  seats?: readonly string[];
}

// The log and cursor paths for one run directory.
export function storePaths(runDir: string): StorePaths {
  return { log: join(runDir, "social.jsonl"), cursors: join(runDir, "social-cursors.json") };
}

// Apply one batch of operations for the sending seat, in order. The whole batch
// is validated before anything is written, so a refused batch leaves the log
// untouched. Returns the entries that were appended.
export async function applyOperations(
  runDir: string,
  from: string,
  operations: readonly Operation[],
  options: ApplyOptions = {}
): Promise<SocialEntry[]> {
  if (typeof from !== "string" || from.trim() === "") {
    throw new Error("a sender seat is required");
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("operations must be a non-empty array");
  }
  if (operations.length > maxOperationsPerBatch) {
    throw new Error("at most " + maxOperationsPerBatch + " operations per batch");
  }
  const seat = from.trim();
  const entries = await readLog(runDir);
  const roster = knownSeats(entries, seat, options.seats);
  const staged: SocialEntry[] = [...entries];
  const applied: SocialEntry[] = [];
  for (const operation of operations) {
    const entry = buildEntry(operation, seat, staged, roster, staged.length + 1);
    applied.push(entry);
    staged.push(entry);
  }
  await appendEntries(runDir, applied);
  return applied;
}

// Read the entries a seat has not consumed yet, from its persisted cursor, and
// advance the cursor so a later read never replays them. Entries the seat may
// not see never advance the cursor past the point where they could still become
// visible: a group message sent while an invitation is pending stays put until
// the seat accepts.
export async function readInbox(runDir: string, seat: string): Promise<InboxPage> {
  if (typeof seat !== "string" || seat.trim() === "") {
    throw new Error("a seat is required");
  }
  const entries = await readLog(runDir);
  const start = Math.min(await getCursor(runDir, seat), entries.length);
  const messages: SocialEntry[] = [];
  let cursor = entries.length;
  for (let index = start; index < entries.length; index += 1) {
    const entry = entries[index];
    if (seesEntry(entry, seat, entries)) {
      messages.push(entry);
    } else if (awaitsInvitation(entry, seat, entries)) {
      cursor = index;
      break;
    }
  }
  await setCursor(runDir, seat, cursor);
  return { messages, cursor };
}

// Read one seat's persisted cursor, counted in log entries. A missing file, or a
// seat that never read, starts at zero.
// Read everything a seat can see, without moving its cursor.
//
// readInbox answers "what is new for this seat" and advances the cursor as it
// goes. This answers "what does this seat know", which is what a view of the
// standing between seats needs. It never writes, so it is safe to call as often
// as a caller likes.
export async function readVisible(runDir: string, seat: string): Promise<SocialEntry[]> {
  if (typeof seat !== "string" || seat.trim() === "") {
    throw new Error("a seat is required");
  }
  const entries = await readLog(runDir);
  return entries.filter((entry) => seesEntry(entry, seat, entries));
}

// The terms of one proposed deal, without the bookkeeping that a reader of the
// log does not need.
export interface DealTerms {
  // The id of the deal-propose entry, which is what an answer must name.
  id: string;
  // The seat that proposed the deal.
  from: string;
  // The seat the deal was proposed to.
  to: string;
  // A gold term, when the proposal carried one.
  gold?: number;
  // A per-turn gold term, when the proposal carried one.
  goldPerTurn?: number;
  // A resource term, when the proposal carried one.
  resource?: string;
  // The message that came with the proposal, when it carried one.
  text?: string;
}

// Every deal a seat is still negotiating, whether it proposed the deal or was
// proposed it, oldest first. A deal that either side has accepted or rejected is
// settled and drops out.
export async function openDealsForSeat(runDir: string, seat: string): Promise<DealTerms[]> {
  if (typeof seat !== "string" || seat.trim() === "") {
    throw new Error("a seat is required");
  }
  const entries = await readLog(runDir);
  return entries
    .filter(
      (entry) =>
        entry.kind === "deal-propose" &&
        (entry.from === seat || entry.to === seat) &&
        !dealAnswered(entries, entry.id)
    )
    .map(dealTermsOf);
}

// Every deal that has been accepted, with the seat that accepted it. A world
// reads this to carry the agreed terms out, so it covers the whole log rather
// than one seat's view.
export async function acceptedDeals(runDir: string): Promise<Array<DealTerms & { acceptedBy: string }>> {
  const entries = await readLog(runDir);
  const accepted: Array<DealTerms & { acceptedBy: string }> = [];
  for (const entry of entries) {
    if (entry.kind !== "deal-propose") continue;
    const answer = entries.find((other) => other.kind === "deal-accept" && other.deal === entry.id);
    if (answer !== undefined) {
      accepted.push({ ...dealTermsOf(entry), acceptedBy: answer.from });
    }
  }
  return accepted;
}

// The seats an entry is addressed to, beyond its author.
//
// A direct message does not store a recipient the way an invitation does: its
// scope carries both seats, written "dm:<a>:<b>". Anything reading a log has to
// know that, so the interpretation lives here rather than in each caller.
export function addressesOf(entry: SocialEntry): string[] {
  if (entry.kind === "dm") {
    return directPartners(entry.to ?? "").filter((seat) => seat !== entry.from);
  }
  if (
    (entry.kind === "invite" ||
      entry.kind === "deal-propose" ||
      entry.kind === "deal-accept" ||
      entry.kind === "deal-reject") &&
    typeof entry.to === "string"
  ) {
    return [entry.to];
  }
  return [];
}

// The two seats a direct message is between, or an empty list when the scope is
// not a direct message.
export function directPairOf(entry: SocialEntry): string[] {
  if (entry.kind !== "dm") return [];
  return directPartners(entry.to ?? "").sort();
}

// One group as a seat is allowed to see it.
export interface VisibleGroup {
  // The group id, which is what an accept or a leave must name.
  id: string;
  // The name given when the group was created.
  name: string;
  // Seats that have accepted membership.
  members: string[];
  // Seats invited but not yet accepted.
  invites: string[];
}

// The groups a seat belongs to or has been invited to.
//
// What a seat may see is membership, not the group's existence. A seat invited
// to a council has to be told what it is being asked to join and which id to
// accept, or the invitation is unanswerable. The group's messages stay private
// until the seat accepts, which is what membership governs.
export async function groupsForSeat(runDir: string, seat: string): Promise<VisibleGroup[]> {
  if (typeof seat !== "string" || seat.trim() === "") {
    throw new Error("a seat is required");
  }
  const entries = await readLog(runDir);
  const groups: VisibleGroup[] = [];
  for (const entry of entries) {
    if (entry.kind !== "group-create") continue;
    const id = entry.group ?? entry.id;
    const members = [...groupMembers(entries, id)];
    const invites = entries
      .filter((other) => other.kind === "invite" && other.group === id && typeof other.to === "string")
      .map((other) => other.to as string)
      .filter((invited) => !members.includes(invited));
    if (!members.includes(seat) && !invites.includes(seat)) continue;
    groups.push({ id, name: entry.name ?? id, members, invites });
  }
  return groups;
}

export async function getCursor(runDir: string, seat: string): Promise<number> {
  const all = await readCursorFile(runDir);
  const value = all[seat];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

// Persist one seat's cursor, so a restart neither replays nor skips messages.
export async function setCursor(runDir: string, seat: string, cursor: number): Promise<void> {
  if (typeof seat !== "string" || seat.trim() === "") {
    throw new Error("a seat is required");
  }
  if (typeof cursor !== "number" || !Number.isFinite(cursor)) {
    throw new Error("a cursor must be a finite number");
  }
  const all = await readCursorFile(runDir);
  all[seat] = Math.max(0, Math.trunc(cursor));
  await mkdir(runDir, { recursive: true });
  await writeFile(storePaths(runDir).cursors, JSON.stringify(all, null, 2) + "\n");
}

// Read the whole correspondence between two seats, in both directions. This is
// what a diplomacy thread view shows, and nothing else leaks into it.
export async function readCorrespondence(
  runDir: string,
  seat: string,
  peer: string
): Promise<SocialEntry[]> {
  if (typeof seat !== "string" || seat.trim() === "" || typeof peer !== "string" || peer.trim() === "") {
    throw new Error("two seats are required to read a correspondence");
  }
  const entries = await readLog(runDir);
  const scope = directScope(seat, peer);
  return entries.filter((entry) => entry.kind === "dm" && entry.to === scope);
}

// Build one entry from one operation, refusing bad input with a clear message.
// The staged list already holds every entry from this batch, so a batch can open
// a group and then use it in the same call.
function buildEntry(
  operation: Operation,
  from: string,
  staged: readonly SocialEntry[],
  roster: ReadonlySet<string>,
  position: number
): SocialEntry {
  const id = "e-" + position;
  const at = new Date().toISOString();
  const kind = operation?.kind;
  switch (kind) {
    case "world":
      return { id, at, from, kind, to: "world", text: requiredField(operation, "message") };
    case "dm": {
      const to = requiredField(operation, "to");
      if (!roster.has(to)) {
        throw new Error("dm target '" + to + "' is not a seat in this run");
      }
      return { id, at, from, kind, to: directScope(from, to), text: requiredField(operation, "message") };
    }
    case "group-create":
      return { id, at, from, kind, name: requiredField(operation, "name") };
    case "invite": {
      const group = requiredGroup(staged, operation);
      const to = requiredField(operation, "to");
      if (!groupMembers(staged, group).has(from)) {
        throw new Error("only members may invite to group '" + group + "'");
      }
      if (!roster.has(to)) {
        throw new Error("invite target '" + to + "' is not a seat in this run");
      }
      return { id, at, from, kind, group, to };
    }
    case "accept": {
      const group = requiredGroup(staged, operation);
      if (groupMembers(staged, group).has(from)) {
        throw new Error(from + " is already a member of group '" + group + "'");
      }
      if (!invited(staged, group, from)) {
        throw new Error("no invitation for " + from + " to group '" + group + "'");
      }
      return { id, at, from, kind, group };
    }
    case "group-msg": {
      const group = requiredGroup(staged, operation);
      if (!groupMembers(staged, group).has(from)) {
        throw new Error(from + " is not a member of group '" + group + "'");
      }
      return { id, at, from, kind, to: "group:" + group, group, text: requiredField(operation, "message") };
    }
    case "leave": {
      const group = requiredGroup(staged, operation);
      if (!groupMembers(staged, group).has(from)) {
        throw new Error(from + " is not a member of group '" + group + "'");
      }
      return { id, at, from, kind, group };
    }
    case "deal-propose": {
      const to = requiredField(operation, "to");
      if (to === from) {
        throw new Error("cannot propose a deal to yourself");
      }
      if (!roster.has(to)) {
        throw new Error("deal-propose target '" + to + "' is not a seat in this run");
      }
      const gold = optionalAmount(operation, "gold");
      const goldPerTurn = optionalAmount(operation, "goldPerTurn");
      const resource = optionalResource(operation);
      if (gold === undefined && goldPerTurn === undefined && resource === undefined) {
        throw new Error("deal-propose operation needs at least one term: gold, goldPerTurn or resource");
      }
      const entry: SocialEntry = { id, at, from, kind, to };
      if (gold !== undefined) {
        entry.gold = gold;
      }
      if (goldPerTurn !== undefined) {
        entry.goldPerTurn = goldPerTurn;
      }
      if (resource !== undefined) {
        entry.resource = resource;
      }
      const message = optionalMessage(operation);
      if (message !== undefined) {
        entry.text = message;
      }
      return entry;
    }
    case "deal-accept":
    case "deal-reject": {
      const deal = requiredField(operation, "deal");
      const proposal = staged.find((entry) => entry.kind === "deal-propose" && entry.id === deal);
      if (proposal === undefined) {
        throw new Error("unknown deal '" + deal + "'");
      }
      if (proposal.from === from) {
        throw new Error(from + " cannot answer their own deal '" + deal + "'");
      }
      if (proposal.to !== from) {
        throw new Error("deal '" + deal + "' is not addressed to " + from);
      }
      if (dealAnswered(staged, deal)) {
        throw new Error("deal '" + deal + "' has already been answered");
      }
      return { id, at, from, kind, deal, to: proposal.from };
    }
    default:
      throw new Error("unknown operation kind: " + String(kind));
  }
}

// Read a required text field from an operation, or refuse the operation.
function requiredField(operation: Operation, field: "message" | "to" | "name" | "deal"): string {
  const value = operation?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(operation?.kind + " operation needs " + field);
  }
  return value.trim();
}

// Read an optional whole-number term from an operation. A missing term is no
// term at all, while anything that is not a positive whole number is refused.
function optionalAmount(operation: Operation, field: "gold" | "goldPerTurn"): number | undefined {
  const value: unknown = operation?.[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(operation?.kind + " operation needs a positive whole number for " + field);
  }
  return value;
}

// Read an optional resource term from an operation. A blank value counts as no
// term, so a proposal that carries only a blank resource has nothing to trade.
function optionalResource(operation: Operation): string | undefined {
  const value: unknown = operation?.resource;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// Read the optional message that comes with a deal proposal. Unlike a direct
// message, a proposal needs no words to be valid.
function optionalMessage(operation: Operation): string | undefined {
  const value: unknown = operation?.message;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// Whether a proposal already has an answer from either side. The first accept or
// reject settles a deal, so a second answer is refused.
function dealAnswered(entries: readonly SocialEntry[], deal: string): boolean {
  return entries.some(
    (entry) => (entry.kind === "deal-accept" || entry.kind === "deal-reject") && entry.deal === deal
  );
}

// The terms of a deal-propose entry, as a reader outside the store needs them.
function dealTermsOf(entry: SocialEntry): DealTerms {
  const terms: DealTerms = { id: entry.id, from: entry.from, to: entry.to ?? "" };
  if (entry.gold !== undefined) {
    terms.gold = entry.gold;
  }
  if (entry.goldPerTurn !== undefined) {
    terms.goldPerTurn = entry.goldPerTurn;
  }
  if (entry.resource !== undefined) {
    terms.resource = entry.resource;
  }
  if (entry.text !== undefined) {
    terms.text = entry.text;
  }
  return terms;
}

// Read a group id from an operation and require that the group was created.
function requiredGroup(entries: readonly SocialEntry[], operation: Operation): string {
  const group = operation?.group;
  if (typeof group !== "string" || group.trim() === "") {
    throw new Error(operation?.kind + " operation needs group");
  }
  const id = group.trim();
  if (!groupExists(entries, id)) {
    throw new Error("unknown group '" + id + "'");
  }
  return id;
}

// Whether a group was created. A group's id is the id of its group-create entry.
function groupExists(entries: readonly SocialEntry[], group: string): boolean {
  return entries.some((entry) => entry.kind === "group-create" && entry.id === group);
}

// The seats currently in a group: the creator, plus everyone who accepted, minus
// everyone who left. An invitation alone never adds a seat.
function groupMembers(entries: readonly SocialEntry[], group: string): Set<string> {
  const members = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "group-create" && entry.id === group) {
      members.add(entry.from);
    } else if (entry.kind === "accept" && entry.group === group) {
      members.add(entry.from);
    } else if (entry.kind === "leave" && entry.group === group) {
      members.delete(entry.from);
    }
  }
  return members;
}

// Whether a seat holds an invitation to a group.
function invited(entries: readonly SocialEntry[], group: string, seat: string): boolean {
  return entries.some((entry) => entry.kind === "invite" && entry.group === group && entry.to === seat);
}

// Whether one seat may see one entry. This is the whole privacy model, and it is
// applied on every read rather than on write.
function seesEntry(entry: SocialEntry, seat: string, entries: readonly SocialEntry[]): boolean {
  switch (entry.kind) {
    case "world":
      return true;
    case "dm":
      return entry.to !== undefined && directPartners(entry.to).includes(seat);
    case "group-msg":
      return entry.group !== undefined && groupMembers(entries, entry.group).has(seat);
    case "group-create":
      return entry.from === seat || groupMembers(entries, entry.id).has(seat);
    case "invite":
      return entry.to === seat;
    case "deal-propose":
    case "deal-accept":
    case "deal-reject":
      return entry.from === seat || entry.to === seat;
    case "accept":
    case "leave":
      return entry.from === seat || (entry.group !== undefined && groupMembers(entries, entry.group).has(seat));
    default:
      return false;
  }
}

// Whether an entry is invisible to a seat only because an invitation is still
// pending. Such an entry must not let the cursor move past it, or accepting the
// invitation later could never reveal it.
function awaitsInvitation(entry: SocialEntry, seat: string, entries: readonly SocialEntry[]): boolean {
  if (entry.kind !== "group-msg" || entry.group === undefined) {
    return false;
  }
  return invited(entries, entry.group, seat) && !groupMembers(entries, entry.group).has(seat);
}

// The seats a run knows about. An explicit roster wins, so a direct message can
// reach a seat that has not spoken yet. Without a roster, a seat is known once it
// appears in the log.
function knownSeats(
  entries: readonly SocialEntry[],
  from: string,
  roster: readonly string[] | undefined
): Set<string> {
  const known = new Set<string>([from]);
  if (roster !== undefined) {
    for (const seat of roster) {
      known.add(seat);
    }
    return known;
  }
  for (const entry of entries) {
    known.add(entry.from);
    if (entry.kind === "dm" && entry.to !== undefined) {
      for (const seat of directPartners(entry.to)) {
        known.add(seat);
      }
    }
    if (entry.kind === "invite" && entry.to !== undefined) {
      known.add(entry.to);
    }
  }
  return known;
}

// The scope key of a direct message between two seats. The pair is sorted so
// both seats read and write the same key, whichever direction the message went.
function directScope(seat: string, peer: string): string {
  return "dm:" + [seat, peer].sort().join(":");
}

// The two seats named in a direct message scope key.
function directPartners(scope: string): string[] {
  return scope.slice(3).split(":");
}

// Read and parse the cursor file. A missing or unreadable file reads as empty.
async function readCursorFile(runDir: string): Promise<Record<string, number>> {
  try {
    const raw = await readFile(storePaths(runDir).cursors, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      return parsed as Record<string, number>;
    }
  } catch {
    // A missing cursor file is a fresh run.
  }
  return {};
}

// Read every entry from the log, in order. A missing log reads as empty.
async function readLog(runDir: string): Promise<SocialEntry[]> {
  const { log } = storePaths(runDir);
  if (!existsSync(log)) {
    return [];
  }
  const text = await readFile(log, "utf8");
  const entries: SocialEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    entries.push(JSON.parse(line) as SocialEntry);
  }
  return entries;
}

// Append a batch of entries as one write of newline separated JSON.
async function appendEntries(runDir: string, entries: readonly SocialEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  await mkdir(runDir, { recursive: true });
  await appendFile(storePaths(runDir).log, entries.map((entry) => JSON.stringify(entry) + "\n").join(""));
}
