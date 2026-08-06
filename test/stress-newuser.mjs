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


/**
 * Start the server and learn where it landed, rather than assuming a port.
 * A fixed port makes this suite fail for a reason that has nothing to do with
 * stet: a server left behind by an earlier interrupted run still holds it, and
 * the fetches then talk to a stale process pointed at a deleted directory.
 */
function serveAndWait(cwd) {
  return new Promise((done, fail) => {
    const p = spawn('node', [BIN, '--port', '0', '--no-open'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let seen = '';
    const t = setTimeout(() => fail(new Error(`server never printed a url: ${seen.slice(0, 200)}`)), 15_000);
    p.stdout.on('data', (d) => {
      seen += d;
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(seen.replace(/\x1b\[[0-9;]*m/g, ''));
      if (m) { clearTimeout(t); done({ proc: p, base: `http://127.0.0.1:${m[1]}` }); }
    });
  });
}

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
  // Attached now, not after the verdict is posted. 'close' fires once; a
  // listener added later misses it and waits forever for an event that has
  // already happened — the same check-then-watch ordering `stet await` had.
  const waiterExit = new Promise((r) => waiter.on('close', r));
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 600));

  const { proc: srv, base } = await serveAndWait(proj);
  const state = await (await fetch(`${base}/api/state`)).json();
  const entry = state.pending.find((e) => e.id === 'cta');
  ok('the page can see it', !!entry);
  ok('and the page is not told which is which', entry && !('map' in entry.item),
    entry ? Object.keys(entry.item).join(',') : '');

  const dec = await fetch(`${base}/api/decide`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'cta', verdict: 'A', because: 'it says what the button does' }),
  });
  ok('a verdict commits', dec.status === 200, `HTTP ${dec.status}`);

  const code = await waiterExit;
  ok('the blocked agent wakes', code === 0, `exit ${code} after ${Date.now() - t0}ms`);
  ok('and is told the verdict', /verdict/i.test(woke), woke.trim().split('\n')[0]?.slice(0, 60));
  ok('the reveal names the real variant', /Buy now|Get started/.test(woke), woke.match(/Buy now|Get started/)?.[0] ?? 'not revealed');

  const canon = fs.readFileSync(path.join(proj, '.stet/RULES.md'), 'utf8');
  ok('a rule was earned', /says what the button does/.test(canon), `${(canon.match(/^## /gm) ?? []).length} rules in the canon`);
  srv.kill('SIGKILL');
}

// ── the one-line form, which is the one an agent will actually reach for ──
console.log('\n7. the whole loop in one command');
{
  const { proc: srv, base } = await serveAndWait(proj);

  const asking = spawn('node', [BIN, 'ask', 'Which empty state?', 'Nothing here yet', 'Start a project',
    '--globs', 'src/empty/**', '--wait', '--timeout', '25'], { cwd: proj, stdio: ['ignore', 'pipe', 'pipe'] });
  let sout = '';
  let serr = '';
  asking.stdout.on('data', (d) => (sout += d));
  asking.stderr.on('data', (d) => (serr += d));
  const askingExit = new Promise((r) => asking.on('close', r));
  await new Promise((r) => setTimeout(r, 1500));

  ok('one command queued it with no JSON authored', /queued which-empty-state/.test(serr), serr.trim().split('\n').pop());

  // While the agent waits, the paths it claimed are shut.
  const denied = spawnSync('node', [BIN, 'hook', 'pre-tool-use'], {
    cwd: proj, encoding: 'utf8',
    input: JSON.stringify({
      session_id: 's9', cwd: proj, hook_event_name: 'PreToolUse', tool_name: 'Write',
      tool_input: { file_path: path.join(proj, 'src/empty/Empty.tsx'), content: 'x' },
    }),
  });
  const spec = denied.stdout ? JSON.parse(denied.stdout).hookSpecificOutput : {};
  ok('writes into the paths it claimed are denied meanwhile', spec?.permissionDecision === 'deny',
    spec?.permissionDecision ?? 'allowed');

  const state = await (await fetch(`${base}/api/state`)).json();
  const entry = state.pending.find((e) => e.id === 'which-empty-state');
  ok('and the page still is not told which is which', entry && !('map' in entry.item));

  await fetch(`${base}/api/decide`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'which-empty-state', verdict: 'A', because: 'it tells them what to do next' }),
  });
  const code = await askingExit;
  ok('the same command returns with the verdict', code === 0 && /verdict: A/.test(sout), sout.trim().split('\n')[0]);
  ok('and reveals what A actually was', /revealed:/.test(sout), (sout.match(/revealed: .*/) ?? [''])[0].slice(0, 60));
  srv.kill('SIGKILL');
}

// ── the sixty-second tour, from the tarball ───────────────────────────────
console.log('\n8. stet demo, on a machine with nothing set up');
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-nothing-'));
  const p = spawn('node', [BIN, 'demo', '--no-open', '--port', '0'], { cwd: empty, stdio: ['ignore', 'pipe', 'pipe'] });
  let seen = '';
  p.stdout.on('data', (d) => (seen += d));
  p.stderr.on('data', (d) => (seen += d));
  const base = await new Promise((done) => {
    const t = setTimeout(() => done(null), 15_000);
    const tick = setInterval(() => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(seen.replace(/\x1b\[[0-9;]*m/g, ''));
      if (m) { clearTimeout(t); clearInterval(tick); done(`http://127.0.0.1:${m[1]}`); }
    }, 200);
  });
  ok('the example decisions shipped with the package', !/without its example decisions/.test(seen),
    /without its example decisions/.test(seen) ? 'fixtures missing from the tarball' : 'present');
  ok('it serves', !!base, base ?? seen.slice(0, 120));

  if (base) {
    const state = await (await fetch(`${base}/api/state`)).json();
    ok('with several decisions to judge', state.pending.length >= 5, `${state.pending.length} pending`);
    ok('none of which tell the page which is which', !state.pending.some((e) => e.ok && 'map' in e.item));
    ok('and it opens on the live one', state.pending[0]?.id === 'signup-live', state.pending[0]?.id ?? 'none');

    // Every local file a variant points at must actually be served, or the
    // tour opens on two blank frames.
    let checked = 0;
    let missing = 0;
    for (const e of state.pending) {
      for (const v of e.item.variants ?? []) {
        for (const b of v.blocks ?? []) {
          const local = [b.src, b.href].find((x) => x && !/^[a-z][a-z0-9+.-]*:/i.test(x));
          if (!local) continue;
          checked++;
          const r = await fetch(`${base}/a/${e.id}/${local}`);
          if (!r.ok) missing++;
        }
      }
    }
    ok('every asset a variant points at is served', missing === 0, `${checked} checked, ${missing} missing`);
  }
  ok('and it wrote nothing into the directory it was run from', fs.readdirSync(empty).length === 0,
    fs.readdirSync(empty).join(',') || 'still empty');
  p.kill('SIGKILL');
  fs.rmSync(empty, { recursive: true, force: true });
}

// ── the suites must leave the checkout exactly as they found it ───────────
// Last suite in the run, so this sees anything the other three left behind.
// `stet claude status` reports which hooks have really been called; a marker
// dropped here by a test is false evidence in the one check built to be
// trustworthy — and a hook fired with no cwd falls back to the project
// containing the process, which is the checkout you are developing in.
console.log('\n9. the working tree, after all of it');
{
  const sessions = path.join(REPO, '.stet', 'sessions');
  const leaked = fs.existsSync(sessions)
    ? fs.readdirSync(sessions).filter((n) => n.startsWith('.fired-'))
    : [];
  ok('no suite left hook evidence in the repository it ran from', leaked.length === 0,
    leaked.length ? `left ${leaked.join(', ')}` : 'untouched');
}

console.log(`\n${fail.length ? `FAILED (${fail.length}): ${fail.join(' | ')}` : 'the packaged artifact works end to end for a new user'}`);
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(SP, { recursive: true, force: true });
process.exit(fail.length ? 1 : 0);
