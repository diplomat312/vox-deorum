import { spawn } from 'node:child_process';
import fs from 'node:fs';
const here = 'C:/Users/bikka/Documents/Codex/2026-09-02/go/work/vox-deorum/experiments/opencode-civ-pilot/live';
const rundir = here + '/runs-siam';
const logf = rundir + '/watch-207.log';
const stopf = rundir + '/STOP';
const q = String.fromCharCode(34);
function log(m) {
  fs.appendFileSync(logf, new Date().toISOString() + ' ' + m + String.fromCharCode(10));
}
const maxAttempts = 40;
const waitMs = 4 * 60 * 1000;
const attemptBudgetMs = 10 * 60 * 1000;
let attempt = 0;
let done = false;
while (done === false && attempt < maxAttempts) {
  if (fs.existsSync(stopf)) { log('stop file present, exiting'); break; }
  attempt = attempt + 1;
  log('attempt ' + attempt + ' start');
  const res = await new Promise((resolve) => {
    const c = spawn('node', ['run-live-turn.mjs', '--turn', '207', '--rundir', rundir, '--game', 'live-duel'], { cwd: here });
    let out = '';
    c.stdout.on('data', (d) => { out = out + d.toString(); });
    c.stderr.on('data', (d) => { out = out + d.toString(); });
    const t = setTimeout(() => { try { c.kill(); } catch (e) {} resolve({ code: 124, out: out }); }, attemptBudgetMs);
    c.on('close', (cc) => { clearTimeout(t); resolve({ code: cc === null ? 1 : cc, out: out }); });
  });
  const okTurn = res.code === 0 && res.out.indexOf(q + 'commit_ok' + q + ': true') >= 0;
  log('attempt ' + attempt + ' exit=' + res.code + ' commit=' + okTurn);
  if (okTurn) { done = true; log('SUCCESS turn banked'); }
  else { log('waiting 4min'); await new Promise((r) => setTimeout(r, waitMs)); }
}
log('watcher end done=' + done + ' attempts=' + attempt);
process.exit(done ? 0 : 2);
