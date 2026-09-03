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
console.log('All ' + pass + ' channel asserts passed.');

// Pilot server routing checks (offline-safe: every case below is rejected
// by validation before any live MCP call, so no game state is touched).
const { spawn } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
const serverHere = path.dirname(fileURLToPath(import.meta.url));
function callServer(payloads) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(serverHere, 'vox-live-server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
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
  { name: 'communicate', arguments: { channel: 'dm:7', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'group:create:   ', target: 'x', message: 'hi' } },
  { name: 'communicate', arguments: { channel: 'group:deadbeef', target: 'x', message: 'hi' } },
  { name: 'inspect', arguments: { subject: 'nope' } },
]);
ok(routed.length === 4, 'four routing responses');
ok(isErr(routed[0]) && textOf(routed[0]).indexOf('two seats') >= 0, 'dm:non-rival rejected offline');
ok(isErr(routed[1]) && textOf(routed[1]).indexOf('needs a title') >= 0, 'group:create without title rejected offline');
ok(isErr(routed[2]) && textOf(routed[2]).indexOf('unknown group') >= 0, 'unknown group rejected offline');
ok(isErr(routed[3]) && textOf(routed[3]).indexOf('unknown subject') >= 0, 'unknown subject rejected offline');
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
console.log('All ' + pass + ' asserts passed (channels + routing).');
