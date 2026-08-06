// The one check that tests what is published rather than what is in the tree.
// Everything else here runs against src/ or dist/; this packs the tarball, installs
// it into a directory that has never seen stet, and walks the whole first-run path.
// It exists because the published 0.16.0 identified itself as 0.15.0, and because
// `stet --version` wrote a project into the current directory and then hung.
//
// The whole new-user path, run against a packed tarball rather than the repo:
// install, init, wire, then the gate as Claude Code actually calls it — an
// agent editing a governed file, blocked, a human deciding, the agent released.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..');
// Pack into a scratch directory, never into the repo being packed.
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-pack-'));
const fail = [];
const ok = (n, c, d = '') => { console.log(`  ${c ? '✓' : '✗'} ${n}${d ? `  ${d}` : ''}`); if (!c) fail.push(n); };

// ── install the artifact, not the working tree ────────────────────────────
console.log('\n1. installing the packed tarball');
const packed = spawnSync('npm', ['pack', '--pack-destination', SP], { cwd: REPO, encoding: 'utf8' });
const tgz = path.join(SP, packed.stdout.trim().split('\n').pop());
ok('npm pack produced a tarball', fs.existsSync(tgz), path.basename(tgz));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-user-'));
fs.writeFileSync(path.join(home, 'package.json'), '{"name":"cold","version":"1.0.0"}');
const inst = spawnSync('npm', ['i', tgz, '--no-fund', '--no-audit'], { cwd: home, encoding: 'utf8' });
ok('installs clean', inst.status === 0, (inst.stdout + inst.stderr).trim().split('\n').pop());
const BIN = path.join(home, 'node_modules/stetmark/bin/stet.js');
ok('the binary is there', fs.existsSync(BIN));

const proj = path.join(home, 'proj');
fs.mkdirSync(path.join(proj, 'src/components'), { recursive: true });
fs.writeFileSync(path.join(proj, 'src/components/Button.tsx'), 'export const Button = () => <button>Buy</button>;\n');
spawnSync('git', ['init', '-q', '.'], { cwd: proj });

const stet = (args, opts = {}) =>
  spawnSync('node', [BIN, ...args], { cwd: proj, encoding: 'utf8', timeout: 15_000, ...opts });

// ── the first two commands anyone types ───────────────────────────────────
console.log('\n2. the first thing a person types');
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-empty-'));
  for (const form of ['--version', '--help', '-h', '-v']) {
    const r = spawnSync('node', [BIN, form], { cwd: empty, encoding: 'utf8', timeout: 8000 });
    ok(`${form} answers and returns`, r.status === 0 && r.signal === null, `exit ${r.status}${r.signal ? ' ' + r.signal : ''}`);
  }
  ok('and none of them wrote into the directory', fs.readdirSync(empty).length === 0,
    fs.readdirSync(empty).join(',') || 'still empty');
  ok('the version matches the tarball',
    spawnSync('node', [BIN, '--version'], { cwd: empty, encoding: 'utf8' }).stdout.trim() ===
    JSON.parse(fs.readFileSync(path.join(home, 'node_modules/stetmark/package.json'), 'utf8')).version);
  fs.rmSync(empty, { recursive: true, force: true });
}

// ── init and wire ─────────────────────────────────────────────────────────
console.log('\n3. init and wire');
{
  const r = stet(['init']);
  ok('init succeeds', r.status === 0, (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n')[1]?.trim());
  ok('creates the canon', fs.existsSync(path.join(proj, '.stet/RULES.md')));
  ok('creates AGENTS.md', fs.existsSync(path.join(proj, 'AGENTS.md')));

  const w = stet(['claude']);
  ok('wiring succeeds', w.status === 0);
  const settings = path.join(proj, '.claude/settings.local.json');
  ok('writes local settings', fs.existsSync(settings), path.relative(proj, settings));
  const cfg = JSON.parse(fs.readFileSync(settings, 'utf8'));
  const events = Object.keys(cfg.hooks ?? {});
  ok('wires every event', events.length >= 5, events.join(', '));

  const st = stet(['claude', 'status']);
  const clean = st.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  ok('status verifies against the binary it points at', /verified/.test(clean), clean.trim().split('\n').pop()?.trim());
  ok('and does not warn about skew', !/does not implement|too old/.test(clean));
}

// ── the gate, called the way Claude Code calls it ─────────────────────────
console.log('\n4. an agent edits a governed file');
const GOVERNED = 'src/components/**';
{
  // A human states the taste up front, scoped to a path.
  const r = stet(['rule', 'buttons say what happens, never "Submit"', '--globs', GOVERNED]);
  ok('the rule is actually scoped', /Globs:/.test(fs.readFileSync(path.join(proj, '.stet/RULES.md'), 'utf8')),
    (fs.readFileSync(path.join(proj, '.stet/RULES.md'), 'utf8').match(/Globs: .*/) ?? ['no Globs line'])[0]);
  ok('a direct rule is accepted', r.status === 0, (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n')[0]);

  const payload = JSON.stringify({
    session_id: 'sess-cold', cwd: proj, hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src/components/Button.tsx'), old_string: 'Buy', new_string: 'Submit' },
  });
  const h = spawnSync('node', [BIN, 'hook', 'pre-tool-use'], { cwd: proj, input: payload, encoding: 'utf8', timeout: 10_000 });
  ok('the hook answers', h.status === 0 && h.signal === null);
  let res = null;
  try { res = JSON.parse(h.stdout); } catch { /* no output means allow */ }
  ok('it returns a decision, not silence', res !== null, h.stdout ? 'JSON' : 'EMPTY — the gate did nothing');
  // Read the field, not a re-stringified copy of it: JSON.stringify escapes the
  // quotes inside the rule and the match fails on correct output.
  const ctx = res?.hookSpecificOutput?.additionalContext ?? '';
  ok('the rule reaches the agent at the moment of the edit', ctx.includes('never "Submit"'),
    ctx.split('\n').pop()?.slice(0, 70));
}

// ── speed, on the path that runs on every tool call ───────────────────────
console.log('\n5. what the gate costs on every tool call');
{
  const payload = JSON.stringify({
    session_id: 'sess-cold', cwd: proj, hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src/components/Button.tsx'), old_string: 'a', new_string: 'b' },
  });
  const times = [];
  for (let i = 0; i < 12; i++) {
    const t0 = Date.now();
    spawnSync('node', [BIN, 'hook', 'pre-tool-use'], { cwd: proj, input: payload, encoding: 'utf8' });
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  ok('median cold-start hook stays under 200ms', median < 200, `${median}ms median, ${times[times.length - 1]}ms worst`);
}

// ── a decision, end to end ────────────────────────────────────────────────
console.log('\n6. an agent asks, blocks, and is released');
{
  const item = {
    id: 'cta', question: 'Which button label ships?',
    map: { A: 'Buy now — names the transaction', B: 'Get started — names the beginning' },
    variants: [
      { label: 'A', blocks: [{ kind: 'text', text: 'Buy now' }] },
      { label: 'B', blocks: [{ kind: 'text', text: 'Get started' }] },
    ],
  };
  const a = stet(['ask'], { input: JSON.stringify(item) });
  ok('an agent can queue a decision over stdin', a.status === 0, (a.stdout + a.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n')[0]);

  const pending = path.join(proj, '.stet/pending/cta/item.json');
  ok('it lands as pending', fs.existsSync(pending));
  const onDisk = JSON.parse(fs.readFileSync(pending, 'utf8'));
  ok('labels were shuffled on intake', onDisk.map && Object.keys(onDisk.map).length === 2, JSON.stringify(onDisk.map));

  // The agent blocks. The human decides. The agent should wake with the answer.
  const waiter = spawn('node', [BIN, 'await', 'cta', '--timeout', '20'], { cwd: proj, stdio: ['ignore', 'pipe', 'pipe'] });
  let woke = '';
  waiter.stdout.on('data', (d) => (woke += d));
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 600));

  const srv = spawn('node', [BIN, '--port', '7851', '--no-open'], { cwd: proj, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const state = await (await fetch('http://127.0.0.1:7851/api/state')).json();
  const entry = state.pending.find((e) => e.id === 'cta');
  ok('the page can see it', !!entry);
  ok('and the page is not told which is which', entry && !('map' in entry.item),
    entry ? Object.keys(entry.item).join(',') : '');

  const dec = await fetch('http://127.0.0.1:7851/api/decide', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'cta', verdict: 'A', because: 'it says what the button does' }),
  });
  ok('a verdict commits', dec.status === 200, `HTTP ${dec.status}`);

  const code = await new Promise((r) => waiter.on('close', r));
  ok('the blocked agent wakes', code === 0, `exit ${code} after ${Date.now() - t0}ms`);
  ok('and is told the verdict', /verdict/i.test(woke), woke.trim().split('\n')[0]?.slice(0, 60));
  ok('the reveal names the real variant', /Buy now|Get started/.test(woke), woke.match(/Buy now|Get started/)?.[0] ?? 'not revealed');

  const canon = fs.readFileSync(path.join(proj, '.stet/RULES.md'), 'utf8');
  ok('a rule was earned', /says what the button does/.test(canon), `${(canon.match(/^## /gm) ?? []).length} rules in the canon`);
  srv.kill('SIGKILL');
}

console.log(`\n${fail.length ? `FAILED (${fail.length}): ${fail.join(' | ')}` : 'the packaged artifact works end to end for a new user'}`);
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(SP, { recursive: true, force: true });
process.exit(fail.length ? 1 : 0);
