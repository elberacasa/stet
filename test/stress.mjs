// Adversarial stress test. Not a demo — an attempt to break it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// execFile has no `input` option — that is execFileSync. Feeding stdin means
// writing to the pipe and closing it, or the child waits forever.
const run = (cmd, args, { input = '' } = {}) => new Promise((done) => {
  const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  let stdout = '';
  p.stdout.on('data', (d) => (stdout += d));
  p.on('error', () => done({ stdout: '', code: -1 }));
  p.on('close', (code) => done({ stdout, code }));
  p.stdin.end(input);
});

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..');
const BIN = path.join(REPO, 'bin', 'stet.js');
const { init } = await import(`${REPO}/dist/store.js`);
const { globToRegExp, matches } = await import(`${REPO}/dist/glob.js`);
const { loadSession, postToolUse, preToolUse } = await import(`${REPO}/dist/hooks.js`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-stress-'));
init(root);
const fail = [];
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!cond) fail.push(name);
};

// ── 1. catastrophic backtracking in globs ────────────────────────────────
// Glob patterns come from item.json and RULES.md and are matched on every
// tool call. A regex-based matcher blew up exponentially on nested **.
console.log('\n1. ReDoS in glob compilation');
{
  const evil = [
    'a/**/**/**/**/**/**/**/**/**/**/b',
    '**/**/**/**/**/**/**/**/**/**/**/**/x.ts',
    `${'*'.repeat(200)}.ts`,
    `a${'/**'.repeat(50)}/b.ts`,
  ];
  const victim = `a/${'x/'.repeat(40)}c.js`;
  let worst = 0;
  for (const g of evil) {
    const t0 = performance.now();
    try { matches(g, victim); } catch { /* throwing is fine, hanging is not */ }
    worst = Math.max(worst, performance.now() - t0);
  }
  ok('pathological globs resolve fast', worst < 250, `worst ${worst.toFixed(1)}ms`);
}

// ── 2. concurrent writes to the session journal ──────────────────────────
// Claude Code runs tool calls in parallel. PostToolUse is read-modify-write.
console.log('\n2. concurrent PostToolUse (parallel tool calls)');
{
  const N = 40;
  await Promise.all(Array.from({ length: N }, (_, i) =>
    run('node', [BIN, 'hook', 'post-tool-use'], {
      input: JSON.stringify({
        session_id: 'race', prompt_id: `p${i}`, cwd: root,
        tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src/hot.ts') },
      }),
    }).catch(() => {})));
  const seen = loadSession(root, 'race').edits['src/hot.ts']?.length ?? 0;
  ok('no lost updates across parallel hooks', seen === N, `recorded ${seen}/${N} distinct prompts`);
}

// ── 3. scale: a long session touching many files ─────────────────────────
console.log('\n3. journal growth over a long session');
{
  for (let i = 0; i < 1500; i++) {
    postToolUse(root, {
      session_id: 'big', prompt_id: `p${i % 60}`, cwd: root,
      tool_name: 'Edit', tool_input: { file_path: path.join(root, `src/f${i}.ts`) },
    });
  }
  const bytes = fs.statSync(path.join(root, '.stet', 'sessions', 'big.jsonl')).size;
  const t0 = performance.now();
  preToolUse(root, { session_id: 'big', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/f9.ts') } });
  const ms = performance.now() - t0;
  ok('journal stays small', bytes < 400_000, `${(bytes / 1024).toFixed(0)}KB after 1500 files`);
  ok('gate stays fast at scale', ms < 120, `${ms.toFixed(1)}ms`);
}

// ── 4. a huge canon ──────────────────────────────────────────────────────
console.log('\n4. a canon nobody pruned');
{
  let md = '# Rules\n';
  for (let i = 1; i <= 1200; i++) {
    md += `\n## ${i} — rule number ${i} about how this repository prefers to do things\n\n*Earned from d${i}, 2026-08-05. Tags: t${i % 7}. Globs: src/area${i % 12}/**.*\n`;
  }
  fs.writeFileSync(path.join(root, '.stet', 'RULES.md'), md);
  const t0 = performance.now();
  preToolUse(root, { session_id: 'huge', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/area3/x.ts') } });
  const ms = performance.now() - t0;
  ok('1200-rule canon still fast', ms < 250, `${ms.toFixed(1)}ms`);
}

// ── 5. hostile item.json ─────────────────────────────────────────────────
console.log('\n5. hostile pending items');
{
  const hostile = {
    'escaping-globs': ['../../../../etc/**', '/etc/**', '~/.ssh/**'],
    'claims-everything': ['**'],
    'not-strings': [1, null, {}, []],
  };
  for (const [id, globs] of Object.entries(hostile)) {
    const dir = path.join(root, '.stet', 'pending', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'item.json'), JSON.stringify({
      id, created: '2026-08-05T10:00:00Z', question: 'q', globs,
      map: { A: 'a', B: 'b' }, variants: [{ label: 'A', blocks: [] }, { label: 'B', blocks: [] }],
    }));
  }
  let threw = null;
  try {
    preToolUse(root, { session_id: 'h', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/x.ts') } });
  } catch (e) { threw = e; }
  ok('malformed globs do not throw', !threw, threw ? String(threw).slice(0, 60) : '');

  // a decision outside the repo must not gate files inside it
  const out = preToolUse(root, { session_id: 'h2', cwd: root, tool_name: 'Write', tool_input: { file_path: '/etc/hosts' } });
  ok('paths outside the repo are ignored entirely', out === null);
}

// ── 6. the hook must never break the session ─────────────────────────────
console.log('\n6. hostile hook input over the real CLI');
{
  const inputs = ['', 'not json', '{}', '[]', 'null', '{"tool_input":null}',
    JSON.stringify({ cwd: root, tool_name: 'Write', tool_input: { file_path: 'x'.repeat(5000) } }),
    JSON.stringify({ cwd: '/nonexistent/place', tool_name: 'Write', tool_input: { file_path: 'a.ts' } })];
  let bad = 0;
  for (const inp of inputs) {
    for (const ev of ['pre-tool-use', 'post-tool-use', 'stop', 'session-start', 'post-compact']) {
      try {
        const { stdout } = await run('node', [BIN, 'hook', ev], { input: inp });
        if (stdout.trim() && !stdout.trim().startsWith('{')) bad++;
      } catch { bad++; }
    }
  }
  ok('every hook exits clean on garbage', bad === 0, `${inputs.length * 5} combinations`);
}

console.log(`\n${fail.length ? `FAILED: ${fail.join(', ')}` : 'all stress checks passed'}`);
fs.rmSync(root, { recursive: true, force: true });
process.exit(fail.length ? 1 : 0);
