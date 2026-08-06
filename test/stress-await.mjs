// Does `stet await` survive many agents blocking while many verdicts land?
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..');
const BIN = path.join(REPO, 'bin', 'stet.js');
const { init } = await import(`${REPO}/dist/store.js`);
const { decide, revealText } = await import(`${REPO}/dist/store.js`);
const { appendRule } = await import(`${REPO}/dist/rules.js`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-await-'));
init(root);
const fail = [];
const ok = (n, c, d = '') => { console.log(`  ${c ? '✓' : '✗'} ${n}${d ? `  ${d}` : ''}`); if (!c) fail.push(n); };

function put(id) {
  const dir = path.join(root, '.stet', 'pending', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'item.json'), JSON.stringify({
    id, created: '2026-08-06T10:00:00Z', question: `Which for ${id}?`,
    map: { A: `${id}-alpha`, B: `${id}-beta` },
    variants: [{ label: 'A', blocks: [] }, { label: 'B', blocks: [] }],
  }));
}

function rule(id) {
  const item = decide(root, id, {
    verdict: 'A', because: `the verdict for ${id} recorded under load`,
    rule: `the verdict for ${id} recorded under load`, revealed: '',
  });
  item.revealed = revealText(item);
  fs.writeFileSync(path.join(root, '.stet/decided', id, 'item.json'), JSON.stringify(item, null, 2));
  appendRule(root, item);
}

/** Spawn `stet await <id>` and resolve with what it printed and how long it took. */
function awaitAgent(id, timeoutSec = 25) {
  const t0 = Date.now();
  return new Promise((done) => {
    const p = spawn('node', [BIN, 'await', id, '--timeout', String(timeoutSec)], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => done({ id, code, out, ms: Date.now() - t0 }));
  });
}

const N = 12;

// ── 1. the window between the first check and the watcher being installed ──
console.log('\n1. verdicts landing the instant the agents start waiting');
{
  for (let i = 0; i < N; i++) put(`race-${i}`);
  const agents = Array.from({ length: N }, (_, i) => awaitAgent(`race-${i}`));
  // No delay at all: decide while those processes are still booting, which is
  // exactly when the check-then-watch window is open.
  for (let i = 0; i < N; i++) rule(`race-${i}`);
  const done = await Promise.all(agents);
  const unblocked = done.filter((r) => r.code === 0);
  ok('every agent unblocks', unblocked.length === N, `${unblocked.length}/${N}`);
  ok('each gets its own verdict', done.every((r) => r.out.includes(r.id)),
    done.filter((r) => !r.out.includes(r.id)).map((r) => r.id).join(', ') || 'all correct');
  const slowest = Math.max(...done.map((r) => r.ms));
  ok('none of them sat on a timeout', slowest < 8000, `slowest ${slowest}ms`);
}

// ── 2. a verdict that landed before the agent ever asked ──────────────────
console.log('\n2. a verdict that already happened');
{
  put('already');
  rule('already');
  const r = await awaitAgent('already');
  ok('returns immediately rather than waiting for an event', r.code === 0 && r.ms < 3000, `${r.ms}ms`);
}

// ── 3. many agents on the same id ─────────────────────────────────────────
console.log('\n3. several agents blocked on one decision');
{
  put('shared');
  const agents = Array.from({ length: 6 }, () => awaitAgent('shared'));
  await new Promise((r) => setTimeout(r, 400));
  rule('shared');
  const done = await Promise.all(agents);
  ok('all of them wake', done.every((r) => r.code === 0), `${done.filter((r) => r.code === 0).length}/6`);
  ok('all of them get the verdict', done.every((r) => r.out.includes('verdict: A')));
}

// ── 4. what it costs to wait ──────────────────────────────────────────────
console.log('\n4. the cost of waiting, with many blocked at once');
{
  for (let i = 0; i < N; i++) put(`idle-${i}`);
  const agents = Array.from({ length: N }, (_, i) => awaitAgent(`idle-${i}`));
  await new Promise((r) => setTimeout(r, 3000));
  const cpu = await new Promise((res) => {
    const ps = spawn('sh', ['-c', `ps -o %cpu=,rss=,command= -A | grep "[a]wait idle-" | awk '{c+=$1; m+=$2} END {print c" "m/1024}'`]);
    let o = ''; ps.stdout.on('data', (d) => (o += d)); ps.on('close', () => res(o.trim()));
  });
  const [totalCpu, totalMb] = cpu.split(/\s+/).map(Number);
  ok(`${N} agents blocked burn no CPU`, totalCpu < 2, `${totalCpu}% total across ${N}`);
  ok('and little memory', totalMb < 900, `${Math.round(totalMb)}MB total`);
  for (let i = 0; i < N; i++) rule(`idle-${i}`);
  const done = await Promise.all(agents);
  ok('and all still wake correctly', done.every((r) => r.code === 0), `${done.filter((r) => r.code === 0).length}/${N}`);
}

// ── 5. a timeout is a timeout ─────────────────────────────────────────────
console.log('\n5. an agent nobody answers');
{
  put('never');
  const r = await awaitAgent('never', 2);
  ok('exits non-zero rather than hanging', r.code !== 0, `exit ${r.code} after ${r.ms}ms`);
  ok('at roughly the requested time', r.ms >= 1800 && r.ms < 6000, `${r.ms}ms for a 2s timeout`);
}

// ── 6. the fan-out shape: waiters and writers at the same time ────────────
console.log('\n6. agents blocked on verdicts while other agents write rules');
{
  const W = 8;
  for (let i = 0; i < W; i++) put(`fan-${i}`);
  const waiting = Array.from({ length: W }, (_, i) => awaitAgent(`fan-${i}`, 30));
  const writing = Array.from({ length: W }, (_, i) =>
    new Promise((res) => {
      const p = spawn('node', [BIN, 'rule', `concurrent rule ${i} written while agents waited`, '--tag', `w${i}`],
        { cwd: root, stdio: 'ignore' });
      p.on('close', (c) => res(c));
    }));
  await new Promise((r) => setTimeout(r, 400));
  for (let i = W - 1; i >= 0; i--) rule(`fan-${i}`);   // verdicts land out of order

  const woke = await Promise.all(waiting);
  const wrote = await Promise.all(writing);
  ok('every blocked agent wakes', woke.every((r) => r.code === 0), `${woke.filter((r) => r.code === 0).length}/${W}`);
  ok('every writer succeeds', wrote.every((c) => c === 0), `${wrote.filter((c) => c === 0).length}/${W}`);

  const { readRules } = await import(`${REPO}/dist/rules.js`);
  const nums = readRules(root).map((r) => r.n);
  ok('no rule is lost to the crossfire', nums.length >= W * 2, `${nums.length} rules`);
  ok('no duplicate rule numbers', new Set(nums).size === nums.length, `${new Set(nums).size} distinct`);
  ok('no lock left behind', !fs.existsSync(path.join(root, '.stet', 'RULES.md.lock')));
}

console.log(`\n${fail.length ? `FAILED: ${fail.join(', ')}` : 'await holds under load'}`);
fs.rmSync(root, { recursive: true, force: true });
process.exit(fail.length ? 1 : 0);
