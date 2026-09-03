// Shared social executor (mock MCP, live MCP, dashboard): one code path for
// every communicate operation on every backend. Parsing comes from
// communicate-forms.mjs, membership from live/channels.mjs, and the actual
// delivery from caller-supplied transports, so backends differ only in how
// bytes move, never in what is allowed.
//
// Privacy model: world posts broadcast publicly. DMs and private letters go
// to exactly one pair thread. Group traffic fans out to member pair threads
// only, never the world channel: non-members have no thread containing the
// lines, and registry-gated reads (groupInbox) hide even leaked tags from
// non-members. Invites are explicit: an invited seat must accept before a
// normal group send; there is no auto-accept on first message.
//
// Every executed operation counts against the per-seat per-turn budget (8 by
// default). Validation failures are free: only delivered operations spend.
import { classifyChannel } from "./communicate-forms.mjs";
import {
  createGroup,
  getGroup,
  inviteToGroup,
  resolveInvite,
  leaveGroup,
  archiveGroup,
  memberStatus,
  tagMessage,
  budgetAllow,
  budgetSpend,
} from "../live/channels.mjs";
import { resolveSeat, peerSeats } from "./seats.mjs";

// One validated operation against membership and transports. Throws Error
// with the user-facing message on any failure; callers record it as the
// operation result and continue with the next operation.
async function runOne(form, op, ctx) {
  const message = op.message;
  const me = ctx.me;
  const T = ctx.transports;
  const ch = form.ch;
  if (form.kind === 'dm') {
    await T.pair(form.seat, message);
    return { ok: true, channel: ch, sent: true };
  }
  if (form.kind === 'private') {
    const to = resolveSeat(op.target, ctx.seats);
    if (to === null || to === me) throw new Error('private needs a target seat number');
    await T.pair(to, message);
    return { ok: true, channel: 'private', to, sent: true };
  }
  if (form.kind === 'world') {
    const res = await T.broadcast(message.slice(0, 1000));
    return { ok: true, channel: 'world', id: res?.ID ?? null };
  }
  if (form.kind === 'create') {
    let g = null;
    try { g = createGroup({ title: form.title, creator: me, members: [me] }); }
    catch (e) { throw new Error('group create failed: ' + e.message); }
    return { ok: true, channel: 'group:' + g.id, created: true };
  }
  if (form.kind === 'invite') {
    let g = null;
    try { g = inviteToGroup(form.id, form.seat, me); }
    catch (e) { throw new Error('group invite failed: ' + e.message); }
    await T.pair(form.seat, tagMessage(g.id, g.title, message).slice(0, 1000));
    return { ok: true, channel: 'group:' + g.id, invited: form.seat };
  }
  if (form.kind === 'accept') {
    let g = null;
    try { g = resolveInvite(form.id, me, true); }
    catch (e) { throw new Error('group accept failed: ' + e.message); }
    await fanOut(g, me, message, T);
    return { ok: true, channel: 'group:' + g.id, accepted: true };
  }
  if (form.kind === 'decline') {
    try { resolveInvite(form.id, me, false); }
    catch (e) { throw new Error('group decline failed: ' + e.message); }
    return { ok: true, channel: ch, accepted: false };
  }
  if (form.kind === 'leave') {
    const g = needActive(form.id, me);
    await fanOut(g, me, message, T);
    try { leaveGroup(form.id, me); }
    catch (e) { throw new Error('group leave failed: ' + e.message); }
    return { ok: true, channel: ch, left: true };
  }
  if (form.kind === 'archive') {
    const g = needActive(form.id, me);
    await fanOut(g, me, message, T);
    try { archiveGroup(form.id, me); }
    catch (e) { throw new Error('group archive failed: ' + e.message); }
    return { ok: true, channel: ch, archived: true };
  }
  const g = needActive(form.id, me);
  await fanOut(g, me, message, T);
  return { ok: true, channel: 'group:' + g.id };
}

// Group load with explicit invite semantics: unknown (incl. archived)
// groups and non-members fail; invited seats must accept first.
function needActive(gid, me) {
  let g = null;
  try { g = getGroup(gid); }
  catch (e) { throw new Error(`unknown group '${gid}'`); }
  const st = memberStatus(gid, me);
  if (st === 'invited') throw new Error('invitation pending for group ' + gid + '');
  if (st !== 'active') throw new Error(`not a member of group '${gid}'`);
  return g;
}

// Tagged delivery to every active member except the speaker: the N-party
// private transport. Pair threads carry the group tag so registry-gated
// reads reconstruct exactly the rooms each seat may see.
async function fanOut(g, me, message, T) {
  const tagged = tagMessage(g.id, g.title, message).slice(0, 1000);
  for (const m of g.members ?? []) {
    if (m.seat === me || m.status !== 'active') continue;
    await T.pair(m.seat, tagged);
  }
  if (T.groupNote) await T.groupNote(tagged);
  return tagged;
}
// Batched entry point: validate and execute operations in order against
// the per-seat per-turn budget. Validation failures are free and recorded;
// execution stops with a budget error once the allowance is spent.
// ctx: { me, turn, seats, transports }. Returns { results, executed }.
export async function executeOperations(ops, ctx) {
  const results = [];
  let executed = 0;
  const allowed = budgetAllow(ctx.me, ctx.turn, ops.length);
  for (const op of ops) {
    const message = String(op?.message ?? '').trim();
    if (!message) { results.push({ error: 'message must be a non-empty string' }); continue; }
    if (message.length > 1000) { results.push({ error: 'message too long (1000 chars max); keep it short' }); continue; }
    const ch = String(op?.channel ?? 'private');
    const form = classifyChannel(ch, ctx.me);
    if (form.kind === 'invalid') { results.push({ error: form.error }); continue; }
    if (executed >= allowed) { results.push({ error: 'social budget spent for this turn' }); continue; }
    try {
      results.push(await runOne(form, { ...op, message }, ctx));
      executed = executed + 1;
    } catch (e) {
      results.push({ error: String(e?.message ?? e) });
    }
  }
  budgetSpend(ctx.me, ctx.turn, executed);
  return { results, executed };
}
