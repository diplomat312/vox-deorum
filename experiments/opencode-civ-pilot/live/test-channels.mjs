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
console.log('All ' + pass + ' channel asserts passed.');