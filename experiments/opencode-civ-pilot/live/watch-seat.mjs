// Parameterized watcher: retries banked turns for one seat until a commit
// lands or the STOP file appears. Mirror of watch-207.mjs, generalized.
//
// Usage: node watch-seat.mjs --seat 1 --turn 207 --rundir ABS(live/runs-siam) --game live-duel
// The watcher polls FILES only (never game services), so it is safe alongside
// the bridge / mcp / dashboard. Create <rundir>/STOP to stop early.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}

const seat = Number(arg('seat', NaN));
const turnTarget = Number(arg('turn', NaN));
const rundirArg = arg('rundir', null);
const game = arg('game', 'live-duel');
const maxAttempts = Number(arg('max-attempts', 160));
const waitMs = Number(arg('interval-ms', 4 * 60 * 1000));
const attemptBudgetMs = Number(arg('budget-ms', 10 * 60 * 1000));
if (!Number.isInteger(seat) || !Number.isFinite(turnTarget) || !rundirArg) {
  console.error('usage: node watch-seat.mjs --seat <N> --turn <T> --rundir <abs> [--game live-duel] [--max-attempts 160]');
  process.exit(2);
}
const rundir = path.isAbsolute(rundirArg) ? rundirArg : path.resolve(process.cwd(), rundirArg);
fs.mkdirSync(rundir, { recursive: true });

const logf = path.join(rundir, `watch-seat-${seat}.log`);
const stopf = path.join(rundir, 'STOP');
const q = String.fromCharCode(34);
function log(m) {
  fs.appendFileSync(logf, new Date().toISOString() + ' seat' + seat + ' ' + m + String.fromCharCode(10));
}
let attempt = 0;
let done = false;
while (done === false && attempt < maxAttempts) {
  if (fs.existsSync(stopf)) { log('stop file present, exiting'); break; }
  attempt = attempt + 1;
  log('attempt ' + attempt + ' start');
  const res = await new Promise((resolve) => {
    const c = spawn('node', ['run-live-seat.mjs', '--seat', String(seat), '--turn', String(turnTarget), '--rundir', rundir, '--game', game], { cwd: here });
    let out = '';
    c.stdout.on('data', (d) => { out = out + d.toString(); });
    c.stderr.on('data', (d) => { out = out + d.toString(); });
    const t = setTimeout(() => { try { c.kill(); } catch (e) {} resolve({ code: 124, out: out }); }, attemptBudgetMs);
    c.on('close', (cc) => { clearTimeout(t); resolve({ code: cc === null ? 1 : cc, out: out }); });
  });
  const okTurn = res.code === 0 && res.out.indexOf(q + 'commit_ok' + q + ': true') >= 0;
  log('attempt ' + attempt + ' exit=' + res.code + ' commit=' + okTurn);
  if (okTurn) { done = true; log('SUCCESS turn banked'); }
  else { log('waiting ' + (waitMs / 1000) + 's'); await new Promise((r) => setTimeout(r, waitMs)); }
}
log('watcher end done=' + done + ' attempts=' + attempt);
process.exit(done ? 0 : 2);

