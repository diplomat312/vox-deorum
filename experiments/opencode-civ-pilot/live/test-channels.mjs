// Offline asserts for the pilot channel layer (no model, no live game).
// Covers: tag round-trip, registry, invites and boundaries, auto-accept rule.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'civ-channels-'));
process.env.CIV_PILOT_CHANNELS_FILE = path.join(tmp, 'channels.json');
const ch = await import('./channels.mjs');
let pass = 0;
function ok(cond, name) {
  if (cond === false) { console.error('FAIL: ' + name); process.exit(1); }
  pass = pass + 1; console.log('ok: ' + name);
}
const g0 = ch.createGroup({ title: 'Duel Hall', creator: 0, members: [0, 1] });
ok(/^[0-9a-f]{8}/.test(g0.id) && g0.id.length === 8, 'group id is 8 hex chars');
const tagged = ch.tagMessage(g0.id, g0.title, 'hello world');
ok(tagged === '[#' + g0.id + ' Duel Hall] hello world', 'tagMessage formats');
const parsed = ch.parseTag(tagged);
ok(parsed !== null && parsed.id === g0.id && parsed.title === 'Duel Hall', 'parseTag round-trips');
ok(ch.parseTag('no tag here') === null, 'parseTag null on untagged');
ok(ch.memberStatus(g0.id, 0) === 'active', 'creator active');
ok(ch.memberStatus(g0.id, 1) === 'active', 'member active immediately in duel create');
const g1 = ch.createGroup({ title: 'War Council', creator: 0, members: [0] });
ch.inviteToGroup(g1.id, 1, 0);
ok(ch.memberStatus(g1.id, 1) === 'invited', 'invite sets invited');
const vis1 = ch.visibleGroups(1).map((g) => g.id);
ok(vis1.includes(g1.id), 'invited group visible to invitee');
let inbox = ch.groupInbox(1, [], 999);
ok(inbox.invites.some((l) => l.includes(g1.id)), 'invite surfaces in inbox');
ch.markMemberActive(g1.id, 1);
ok(ch.memberStatus(g1.id, 1) === 'active', 'first send auto-accepts invite');
inbox = ch.groupInbox(1, [], 999);
ok(inbox.invites.some((l) => l.includes(g1.id)) === false, 'invite clears after accept');
const g2 = ch.createGroup({ title: 'Secret', creator: 0, members: [0, 1] });
const world = [
  { ID: 10, Turn: 180, SpeakerID: 0, Content: ch.tagMessage(g2.id, g2.title, 'before') },
  { ID: 11, Turn: 181, SpeakerID: 1, Content: ch.tagMessage(g2.id, g2.title, 'after') },
  { ID: 12, Turn: 181, SpeakerID: 0, Content: 'untagged world chatter' },
];
let box = ch.groupInbox(1, world, 180);
ok(box.lines.join(' ').includes('after'), 'only messages after lastSeenTurn surface');
ok(box.lines.join(' ').includes('before') === false, 'old tagged message hidden');
ch.leaveGroup(g2.id, 1, 11);
box = ch.groupInbox(1, world.concat([{ ID: 13, Turn: 182, SpeakerID: 0, Content: ch.tagMessage(g2.id, g2.title, 'late') }]), 180);
ok(box.lines.join(' ').includes('late') === false, 'messages after leave hidden');
ok(ch.memberStatus(g2.id, 1) === 'left', 'leave sets left');
const g3 = ch.createGroup({ title: 'Solo', creator: 0, members: [0] });
let threw = false;
try { ch.markMemberActive(g3.id, 1); } catch (e) { threw = true; }
ok(threw, 'non-member cannot activate');
let threw2 = false;
try { ch.markMemberActive('deadbeef', 1); } catch (e) { threw2 = true; }
ok(threw2, 'unknown group rejects');
const arch = ch.createGroup({ title: 'Ephemeral', creator: 0, members: [0, 1] });
let threw3 = false;
try { ch.archiveGroup(arch.id, 5); } catch (e) { threw3 = true; }
ok(threw3, 'non-member cannot archive');
ch.archiveGroup(arch.id, 0);
ok(ch.visibleGroups(1).some((g) => g.id === arch.id) === false, 'archived group hidden');
const warch = [{ ID: 30, Turn: 190, SpeakerID: 0, Content: ch.tagMessage(arch.id, arch.title, 'after close') }];
ok(ch.groupInbox(1, warch, 189).lines.join(' ').includes('after close') === false, 'archived messages hidden');
let threw4 = false;
try { ch.markMemberActive(arch.id, 1); } catch (e) { threw4 = true; }
ok(threw4, 'archived group rejects sends');
const brk = ch.createGroup({ title: 'War [Council]\nRoom', creator: 0, members: [0, 1] });
ok(brk.title === 'War Council Room', 'title sanitized at creation');
const btag = ch.tagMessage(brk.id, brk.title, 'orders');
const bparsed = ch.parseTag(btag);
ok(bparsed !== null && bparsed.id === brk.id, 'sanitized title round-trips tag/parse');
const wbrk = [{ ID: 31, Turn: 191, SpeakerID: 1, Content: btag }];
ok(ch.groupInbox(0, wbrk, 190).lines.join(' ').includes('orders'), 'sanitized group message reaches inbox');
const dec = ch.createGroup({ title: 'Opt Out', creator: 0, members: [0] });
ch.inviteToGroup(dec.id, 1, 0);
ch.resolveInvite(dec.id, 1, false);
ok(ch.memberStatus(dec.id, 1) === 'declined', 'decline sets declined');
ok(ch.visibleGroups(1).some((g) => g.id === dec.id) === false, 'declined group hidden');
let threw5 = false;
try { ch.markMemberActive(dec.id, 1); } catch (e) { threw5 = true; }
ok(threw5, 'declined seat cannot send');
console.log('All ' + pass + ' channel asserts passed.');

// Pilot server routing checks (offline-safe: every case below is rejected
// by validation before any live MCP call, so no game state is touched).
const { spawn } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
const serverHere = path.dirname(fileURLToPath(import.meta.url));
function callServer(payloads, extraEnv, rel) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(serverHere, rel || 'vox-live-server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...(extraEnv || {}) } });
    let buf = '';
    const out = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('server routing timed out')); }, 15000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg = null;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && msg.id !== 1) out.push(msg);
        if (out.length === payloads.length) { clearTimeout(timer); child.kill(); resolve(out); }
      }
    });
    child.on('error', reject);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'routing-test', version: '1' } } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    let id = 2;
    for (const p of payloads) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: 'tools/call', params: p }) + '\n');
      id = id + 1;
    }
  });
}
function isErr(m) { return !!(m && m.result && m.result.isError); }
function textOf(m) { return String((m && m.result && m.result.content && m.result.content[0] && m.result.content[0].text) || ''); }
const routed = await callServer([
  { name: 'communicate', arguments: { channel: 'dm:1', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'group:create:   ', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'group:deadbeef', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'group:leave:deadbeef', target: 'x', message: 'bye' } },
  { name: 'communicate', arguments: { channel: 'group:archive:deadbeef', target: 'x', message: 'done' } },
  { name: 'communicate', arguments: { channel: 'group:invite:deadbeef:0', target: 'x', message: 'join us' } },
  { name: 'communicate', arguments: { channel: 'group:invite:deadbeef:xx', target: 'x', message: 'join us' } },
  { name: 'communicate', arguments: { channel: 'group:leave:', target: 'x', message: 'bye' } },
  { name: 'inspect', arguments: { subject: 'nope' } },
]);
ok(routed.length === 9, 'nine routing responses');
ok(isErr(routed[0]) && textOf(routed[0]).indexOf('cannot DM yourself') >= 0, 'dm:self rejected offline');
ok(isErr(routed[1]) && textOf(routed[1]).indexOf('needs a title') >= 0, 'group:create without title rejected offline');
ok(isErr(routed[2]) && textOf(routed[2]).indexOf('unknown group') >= 0, 'unknown group rejected offline');
ok(isErr(routed[3]) && textOf(routed[3]).indexOf('unknown group') >= 0, 'group:leave unknown rejected offline');
ok(isErr(routed[4]) && textOf(routed[4]).indexOf('unknown group') >= 0, 'group:archive unknown rejected offline');
ok(isErr(routed[5]) && textOf(routed[5]).indexOf('unknown group') >= 0, 'group:invite unknown rejected offline');
ok(isErr(routed[6]) && textOf(routed[6]).indexOf('seat number') >= 0, 'group:invite non-seat rejected offline');
ok(isErr(routed[7]) && textOf(routed[7]).indexOf('needs an id') >= 0, 'group:leave without id rejected offline');
ok(isErr(routed[8]) && textOf(routed[8]).indexOf('unknown subject') >= 0, 'unknown subject rejected offline');
// Full round-trip: create -> tag -> inbox, with invite isolation. Mirrors
// what communicate channel 'group:create:<title>' does on the live path.
const g4 = ch.createGroup({ title: 'Round Trip', creator: 1, members: [1] });
ch.inviteToGroup(g4.id, 0, 1);
const w1 = [{ ID: 20, Turn: 200, SpeakerID: 1, Content: ch.tagMessage(g4.id, g4.title, 'hello duel') }];
let box4 = ch.groupInbox(0, w1, 199);
ok(box4.invites.some((l) => l.includes(g4.id)), 'invitee sees invite before accepting');
ok(box4.lines.join(' ').includes('hello duel') === false, 'invitee sees no messages before accepting');
ch.markMemberActive(g4.id, 0);
box4 = ch.groupInbox(0, w1.concat([{ ID: 21, Turn: 201, SpeakerID: 1, Content: ch.tagMessage(g4.id, g4.title, 'second') }]), 199);
ok(box4.lines.join(' ').includes('second'), 'member sees messages after accepting');
box4 = ch.groupInbox(1, w1, 199);
ok(box4.lines.join(' ').includes('hello duel'), 'creator sees group messages');
// Budget asserts: per-seat per-turn operation budget in one shared file.
process.env.CIV_PILOT_OPS_FILE = path.join(tmp, 'ops-budget.json');
delete process.env.CIV_PILOT_TURN;
ok(ch.budgetAllow(0, null, 8) === 8, 'no turn means no budget');
process.env.CIV_PILOT_TURN = '207';
ok(ch.budgetAllow(0, '207', 8) === 8, 'fresh turn allows full budget');
ch.budgetSpend(0, '207', 3);
ok(ch.budgetAllow(0, '207', 8) === 5, 'spend reduces allowance');
ok(ch.budgetAllow(1, '207', 8) === 8, 'other seat unaffected');
ch.budgetSpend(0, '207', 5);
ok(ch.budgetAllow(0, '207', 1) === 0, 'exhausted budget blocks');
process.env.CIV_PILOT_TURN = '208';
ok(ch.budgetAllow(0, '208', 8) === 8, 'new turn resets');
delete process.env.CIV_PILOT_TURN;
delete process.env.CIV_PILOT_OPS_FILE;
// Mock/live parity: every validation accept and reject below is decided
// before any transport, so both backends must answer identically. Transports
// (Vox broadcast vs world-file log) stay backend-specific and untested here.
const parityEnv = {
  CIV_PILOT_PLAYER_ID: '0',
  CIV_PILOT_SEND_FILE: '',
  CIV_PILOT_TURN: '',
  CIV_PILOT_CHANNELS_FILE: '',
};
// Guard and registry env must be empty (not unset) so spawned servers see
// no turn and the shared classifier decides alone.
const parityPayloads = [
  { name: 'communicate', arguments: { channel: 'dm:0', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'dm:x', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'dm:64', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'group:create:   ', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'group:invite:deadbeef:xx', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'group:accept:', target: 'x', message: 'ok' } },
  { name: 'communicate', arguments: { channel: 'group:decline:', target: 'x', message: 'no' } },
  { name: 'communicate', arguments: { channel: 'group:leave:', target: 'x', message: 'bye' } },
  { name: 'communicate', arguments: { channel: 'group:archive:', target: 'x', message: 'done' } },
  { name: 'communicate', arguments: { channel: 'group:accept:deadbeef', target: 'x', message: 'ok' } },
  { name: 'communicate', arguments: { channel: 'group:decline:deadbeef', target: 'x', message: 'no' } },
  { name: 'communicate', arguments: { channel: 'world', target: 'x', message: '' } },
  { name: 'communicate', arguments: { channel: 'world', target: 'x', message: 'y'.repeat(1001) } },
  { name: 'inspect', arguments: { subject: 'nope' } },
]; 
const liveParity = await callServer(parityPayloads, parityEnv, 'vox-live-server.mjs');
const mockParity = await callServer(parityPayloads, parityEnv, '../mcp-server/index.mjs');
ok(liveParity.length === parityPayloads.length, 'live parity responses complete');
ok(mockParity.length === parityPayloads.length, 'mock parity responses complete');
for (let k = 0; k < parityPayloads.length; k = k + 1) {
  const a = liveParity[k];
  const b = mockParity[k];
  ok(isErr(a) === isErr(b), 'parity isErr case ' + k + ' (' + parityPayloads[k].arguments.channel + ')');
  ok(textOf(a) === textOf(b), 'parity text case ' + k + ' (' + parityPayloads[k].arguments.channel + ')');
}
// Decline-budget evidence: a seeded invite declined through the live server
// resolves the membership AND spends the turn send, so the next send in the
// same turn is rejected by the backpressure guard.
const declineFile = path.join(tmp, 'channels-decline.json');
const declineGuard = path.join(tmp, 'send-guard-decline.json');
const declineOps = path.join(tmp, 'ops-budget-decline.json');
process.env.CIV_PILOT_CHANNELS_FILE = declineFile;
const gD = ch.createGroup({ title: 'Peace Talks', creator: 1, members: [1] });
ch.inviteToGroup(gD.id, 0, 1);
const declineEnv = {
  CIV_PILOT_PLAYER_ID: '0',
  CIV_PILOT_TURN: '500',
  CIV_PILOT_SEND_FILE: declineGuard,
  CIV_PILOT_OPS_FILE: declineOps,
  CIV_PILOT_CHANNELS_FILE: declineFile,
  CIV_PILOT_OPS_BUDGET: '1'};
const declined = await callServer([
  { name: 'communicate', arguments: { channel: 'group:decline:' + gD.id, target: 'x', message: 'not now' } },
  { name: 'communicate', arguments: { channel: 'world', target: 'x', message: 'hello' } },
], declineEnv, 'vox-live-server.mjs');
ok(declined.length === 2, 'decline plus follow-up answered');
ok(!isErr(declined[0]) && textOf(declined[0]).indexOf('accepted') >= 0, 'decline resolves silently');
ok(isErr(declined[1]) && textOf(declined[1]).indexOf('budget') >= 0, 'decline spent the turn budget');
process.env.CIV_PILOT_CHANNELS_FILE = path.join(tmp, 'channels.json');
// Seat budgets share one file across seats and turns.
process.env.CIV_PILOT_OPS_FILE = path.join(tmp, 'ops-budget-seats.json');
process.env.CIV_PILOT_TURN = '600';
ch.budgetSpend(0, '600', 8);
ok(ch.budgetAllow(0, '600', 1) === 0, 'same seat same turn blocked');
ok(ch.budgetAllow(1, '600', 8) === 8, 'other seat same turn allowed');
ch.budgetSpend(1, '600', 8);
ok(ch.budgetAllow(1, '600', 1) === 0, 'second seat spend recorded');
process.env.CIV_PILOT_TURN = '601';
ok(ch.budgetAllow(0, '601', 8) === 8, 'new turn opens both seats');
delete process.env.CIV_PILOT_TURN;
delete process.env.CIV_PILOT_OPS_FILE;
// Visibility before transport: archived and declined group sends fail.
const visFile = path.join(tmp, 'channels-vis.json');
const visGuard = path.join(tmp, 'send-guard-vis.json');
process.env.CIV_PILOT_CHANNELS_FILE = visFile;
const gA = ch.createGroup({ title: 'Old Council', creator: 0, members: [0] });
ch.archiveGroup(gA.id, 0);
const gD2 = ch.createGroup({ title: 'Cold Shoulder', creator: 1, members: [1] });
ch.inviteToGroup(gD2.id, 0, 1);
ch.resolveInvite(gD2.id, 0, false);
const visEnv = { CIV_PILOT_PLAYER_ID: '0', CIV_PILOT_TURN: '502', CIV_PILOT_SEND_FILE: visGuard, CIV_PILOT_CHANNELS_FILE: visFile };
const vis = await callServer([
  { name: 'communicate', arguments: { channel: 'group:' + gA.id, target: 'x', message: 'hello?' } },
  { name: 'communicate', arguments: { channel: 'group:' + gD2.id, target: 'x', message: 'hello?' } },
], visEnv, 'vox-live-server.mjs');
ok(vis.length === 2, 'visibility probes answered');
ok(isErr(vis[0]) && textOf(vis[0]).indexOf('unknown group') >= 0, 'archived group send rejected');
ok(isErr(vis[1]) && textOf(vis[1]).indexOf('not a member') >= 0, 'declined group send rejected');
process.env.CIV_PILOT_CHANNELS_FILE = path.join(tmp, 'channels.json');
console.log('All ' + pass + ' asserts passed (channels + routing + guard + parity + seat).');
