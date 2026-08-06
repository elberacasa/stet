import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expand, matches, matchesAny } from '../src/glob.js';
import { canonOnce, churn, EVENTS, lastFired, loadSession, postToolUse, preCompact, preToolUse, runHook, stop, sweepSessions, targetPath } from '../src/hooks.js';
import { CLAUDE_EVENTS, install, installCommands, installed, settingsPath, uninstall, uninstallCommands, WIRING } from '../src/claude.js';
import { addItem, init } from '../src/store.js';
import { appendDirectRule, HOW_TO_ASK, readRules, renderBlock, selectRules } from '../src/rules.js';
import { appendNote, readNotes, removeNote, thin } from '../src/notes.js';
import { withLock } from '../src/lock.js';
import { sync } from '../src/sync.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-hooks-'));
  init(root);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function pend(id: string, globs: string[], question = 'Which one?') {
  const dir = path.join(root, '.stet', 'pending', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'item.json'), JSON.stringify({
    id, created: '2026-08-05T10:00:00Z', question, globs,
    map: { A: 'a', B: 'b' },
    variants: [{ label: 'A', blocks: [] }, { label: 'B', blocks: [] }],
  }));
}

function rules(text: string) {
  fs.writeFileSync(path.join(root, '.stet', 'RULES.md'), text);
}

const write = (file: string, session = 's1') => ({
  session_id: session, cwd: root, tool_name: 'Write', tool_input: { file_path: file },
});

describe('glob', () => {
  it('matches the forms people actually write', () => {
    expect(matches('src/api/**', 'src/api/users.ts')).toBe(true);
    expect(matches('src/api/**', 'src/api/deep/nested/x.ts')).toBe(true);
    expect(matches('src/api/**', 'src/web/page.tsx')).toBe(false);
    expect(matches('src/api', 'src/api/users.ts')).toBe(true);       // bare directory
    expect(matches('src/api', 'src/apiary/x.ts')).toBe(false);        // not a prefix match
    expect(matches('**/*.css', 'a/b/c.css')).toBe(true);
    expect(matches('*.md', 'README.md')).toBe(true);
    expect(matches('*.md', 'docs/README.md')).toBe(false);            // * stops at /
    expect(matches('src/**/*.{ts,tsx}', 'src/web/page.tsx')).toBe(true);
    expect(matches('src/**/*.{ts,tsx}', 'src/web/page.js')).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    expect(matches('a+b/c.ts', 'a+b/c.ts')).toBe(true);
    expect(matches('a+b/c.ts', 'aab/cxts')).toBe(false);
    expect(matches('x.ts', 'xats')).toBe(false);
  });

  it('handles an empty or missing glob list', () => {
    expect(matchesAny(undefined, 'a.ts')).toBe(false);
    expect(matchesAny([], 'a.ts')).toBe(false);
    expect(matchesAny([1, null, {}] as unknown as string[], 'a.ts')).toBe(false);
  });

  it('does not blow up on nested wildcards', () => {
    // A regex-based matcher cost 8x per nested `**`; ten of them took minutes,
    // inside a hook that runs on every write. This must stay linear.
    const victim = `a/${'x/'.repeat(40)}c.js`;
    const t0 = performance.now();
    for (const n of [1, 4, 16, 40]) matches(`a${'/**'.repeat(n)}/b.js`, victim);
    matches(`${'*'.repeat(400)}.ts`, `${'y'.repeat(400)}.js`);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('caps brace expansion so nested braces cannot explode', () => {
    expect(expand('{a,b}/{c,d}.ts').sort()).toEqual(['a/c.ts', 'a/d.ts', 'b/c.ts', 'b/d.ts']);
    expect(expand('{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}{o,p}', 16).length).toBeLessThanOrEqual(16);
    expect(expand('unclosed{a,b')).toEqual(['unclosed{a,b']);
  });
});

describe('the gate', () => {
  it('denies a write into a path an undecided question claims', () => {
    pend('api-shape', ['src/api/**'], 'Which shape should the list endpoint return?');
    const out = preToolUse(root, write(path.join(root, 'src/api/users.ts')));
    expect(out?.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(out?.hookSpecificOutput?.permissionDecisionReason).toContain('api-shape');
    expect(out?.hookSpecificOutput?.permissionDecisionReason).toContain('stet await api-shape');
  });

  it('lets everything else through', () => {
    pend('api-shape', ['src/api/**']);
    expect(preToolUse(root, write(path.join(root, 'src/web/page.tsx')))).toBeNull();
  });

  it('never claims a path when the item declares no globs', () => {
    pend('anything', []);
    expect(preToolUse(root, write(path.join(root, 'src/api/users.ts')))).toBeNull();
  });

  it('ignores tools that are not writes', () => {
    pend('api-shape', ['src/api/**']);
    expect(preToolUse(root, { ...write(path.join(root, 'src/api/users.ts')), tool_name: 'Read' })).toBeNull();
    expect(preToolUse(root, { ...write(path.join(root, 'src/api/users.ts')), tool_name: 'Bash' })).toBeNull();
  });

  it('refuses to reason about paths outside the repo', () => {
    expect(targetPath(root, write('/etc/passwd'))).toBeNull();
    expect(targetPath(root, write(path.join(root, 'src/a.ts')))).toBe('src/a.ts');
  });
});

describe('just-in-time rules', () => {
  const two = '# Rules\n\n## 1 — bare arrays for list endpoints\n\n*Earned from x, 2026-08-05. Globs: src/api/**.*\n\n## 2 — serif headings, left aligned\n\n*Earned from y, 2026-08-05. Globs: src/web/**.*\n';

  it('delivers only the rules governing the file being written', () => {
    rules(two);
    const out = preToolUse(root, write(path.join(root, 'src/api/users.ts')));
    const ctx = out?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('bare arrays');
    expect(ctx).not.toContain('serif headings');
  });

  it('never says the same thing twice in one session', () => {
    rules(two);
    expect(preToolUse(root, write(path.join(root, 'src/api/a.ts'), 'sX'))).not.toBeNull();
    expect(preToolUse(root, write(path.join(root, 'src/api/b.ts'), 'sX'))).toBeNull();
    // …but a different session is owed it again
    expect(preToolUse(root, write(path.join(root, 'src/api/a.ts'), 'sY'))).not.toBeNull();
  });

  it('keeps unscoped rules out of the per-file delivery', () => {
    rules('# Rules\n\n## 1 — never apologise in error copy\n\n*Earned from z, 2026-08-05.*\n');
    expect(preToolUse(root, write(path.join(root, 'src/api/a.ts')))).toBeNull();
  });

  it('states unscoped rules once, at session start', () => {
    rules('# Rules\n\n## 1 — never apologise in error copy\n\n*Earned from z, 2026-08-05.*\n');
    const first = canonOnce(root, { session_id: 'sA', cwd: root }, 'SessionStart');
    expect(first?.hookSpecificOutput?.additionalContext).toContain('never apologise');
    expect(canonOnce(root, { session_id: 'sA', cwd: root }, 'SessionStart')).toBeNull();
  });

  it('warns that pending decisions will block writes', () => {
    pend('api-shape', ['src/api/**']);
    const out = canonOnce(root, { session_id: 'sB', cwd: root }, 'SessionStart');
    expect(out?.hookSpecificOutput?.additionalContext).toContain('awaiting a human verdict');
  });

  it('tells a repo with no canon yet how to ask, then says nothing more', () => {
    // Day one is exactly when an agent needs to know it can ask. What must not
    // repeat is the saying of it — once per session, like the rules.
    const first = canonOnce(root, { session_id: 'sC', cwd: root }, 'SessionStart');
    expect(first?.hookSpecificOutput?.additionalContext).toContain('stet ask');
    expect(canonOnce(root, { session_id: 'sC', cwd: root }, 'SessionStart')).toBeNull();
  });
});

describe('surviving compaction', () => {
  it('restates the canon after the context that held it is gone', () => {
    rules('# Rules\n\n## 1 — never apologise in error copy\n\n*Earned from z, 2026-08-05.*\n');
    const input = { session_id: 'sD', cwd: root };
    expect(canonOnce(root, input, 'SessionStart')).not.toBeNull();
    expect(canonOnce(root, input, 'SessionStart')).toBeNull();   // already said
    expect(preCompact(root, input)?.hookSpecificOutput?.additionalContext).toContain('never apologise');
  });
});

describe('churn — taste said out loud instead of written down', () => {
  const edit = (file: string, prompt: string, session = 'c1') => ({
    session_id: session, prompt_id: prompt, cwd: root,
    tool_name: 'Edit', tool_input: { file_path: path.join(root, file) },
  });

  it('does not mistake an agent working for a human correcting', () => {
    // Five writes to one file, all inside a single instruction: that is just work.
    for (let i = 0; i < 5; i++) postToolUse(root, edit('src/hero.tsx', 'p1'));
    expect(churn(root, 'c1')).toHaveLength(0);
    expect(stop(root, { session_id: 'c1', cwd: root })).toBeNull();
  });

  it('flags a file revised across separate instructions', () => {
    postToolUse(root, edit('src/hero.tsx', 'p1'));
    postToolUse(root, edit('src/hero.tsx', 'p2'));
    expect(churn(root, 'c1')).toHaveLength(0);      // two is still iteration
    postToolUse(root, edit('src/hero.tsx', 'p3'));
    expect(churn(root, 'c1')).toEqual([{ path: 'src/hero.tsx', revisions: 3 }]);

    const out = stop(root, { session_id: 'c1', cwd: root });
    expect(out?.hookSpecificOutput?.additionalContext).toContain('src/hero.tsx');
    expect(out?.hookSpecificOutput?.additionalContext).toContain('3 separate instructions');
    expect(out?.hookSpecificOutput?.additionalContext).toContain('stet rule');
  });

  it('says it once per file, not once per turn', () => {
    for (const p of ['p1', 'p2', 'p3']) postToolUse(root, edit('src/hero.tsx', p));
    expect(stop(root, { session_id: 'c1', cwd: root })).not.toBeNull();
    expect(stop(root, { session_id: 'c1', cwd: root })).toBeNull();

    // …but a second file that starts churning is still worth saying
    for (const p of ['p4', 'p5', 'p6']) postToolUse(root, edit('src/nav.tsx', p));
    const out = stop(root, { session_id: 'c1', cwd: root });
    expect(out?.hookSpecificOutput?.additionalContext).toContain('src/nav.tsx');
    expect(out?.hookSpecificOutput?.additionalContext).not.toContain('src/hero.tsx');
  });

  it('keeps sessions apart', () => {
    for (const p of ['p1', 'p2', 'p3']) postToolUse(root, edit('src/hero.tsx', p, 'sA'));
    expect(churn(root, 'sA')).toHaveLength(1);
    expect(churn(root, 'sB')).toHaveLength(0);
  });

  it('ignores reads, and writes it cannot place', () => {
    postToolUse(root, { ...edit('src/hero.tsx', 'p1'), tool_name: 'Read' });
    postToolUse(root, { ...edit('src/hero.tsx', 'p2'), prompt_id: undefined });
    postToolUse(root, edit('../outside.ts', 'p3'));
    expect(churn(root, 'c1')).toHaveLength(0);
  });

  it('survives a torn line in the journal', () => {
    // Appends from parallel hooks can in principle interleave. A damaged line
    // must cost that one record, not the session.
    postToolUse(root, edit('src/hero.tsx', 'p1'));
    const file = path.join(root, '.stet', 'sessions', 'c1.jsonl');
    fs.appendFileSync(file, '{"t":"e","p":"src/hero.tsx","q":"tor\n');
    postToolUse(root, edit('src/hero.tsx', 'p2'));
    postToolUse(root, edit('src/hero.tsx', 'p3'));
    expect(churn(root, 'c1')).toEqual([{ path: 'src/hero.tsx', revisions: 3 }]);
  });

  it('records each instruction once however many writes it caused', () => {
    for (let i = 0; i < 20; i++) postToolUse(root, edit('src/hero.tsx', 'p1'));
    expect(loadSession(root, 'c1').edits['src/hero.tsx']).toEqual(['p1']);
  });

  it('never lets the journal interfere with the gate', () => {
    // PostToolUse must not deny anything, ever — the write has already happened.
    expect(postToolUse(root, edit('src/hero.tsx', 'p1'))).toBeNull();
  });
});

describe('hook dispatch', () => {
  it('never throws, whatever it is handed', () => {
    expect(runHook(root, 'pre-tool-use', {})).toBeNull();
    expect(runHook(root, 'nonsense-event', {})).toBeNull();
    expect(runHook(root, 'pre-tool-use', { tool_name: 'Write', tool_input: {} })).toBeNull();
    expect(runHook('/does/not/exist', 'session-start', {})).toBeNull();
  });
});

describe('claude code wiring', () => {
  it('installs, is idempotent, and reports itself', () => {
    expect(installed(root)).toBe(false);
    install(root);
    install(root);
    install(root);
    expect(installed(root)).toBe(true);
    const text = fs.readFileSync(settingsPath(root, 'project'), 'utf8');
    expect(text.match(/stet hook/g)).toHaveLength(WIRING.length);
  });

  it('leaves the user\'s own hooks and settings alone, and restores them exactly', () => {
    const file = settingsPath(root, 'project');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const original = JSON.stringify({
      permissions: { allow: ['Bash(npm test)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine.sh' }] }] },
    }, null, 2) + '\n';
    fs.writeFileSync(file, original);

    install(root);
    const after = fs.readFileSync(file, 'utf8');
    expect(after).toContain('mine.sh');
    expect(after).toContain('stet hook');

    uninstall(root);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('deletes a settings file it created outright', () => {
    install(root);
    expect(fs.existsSync(settingsPath(root, 'project'))).toBe(true);
    uninstall(root);
    expect(fs.existsSync(settingsPath(root, 'project'))).toBe(false);
  });

  it('recognises its own entry in both forms the installer writes', () => {
    // The pinned form is what you get before `npm i -g stetmark`. Failing to
    // recognise it orphans the hooks on removal and duplicates them on install.
    for (const command of ['stet hook pre-tool-use', 'node /abs/path/bin/stet.js hook pre-tool-use']) {
      const file = settingsPath(root, 'project');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command }] }] } }, null, 2));
      expect(installed(root), command).toBe(true);
      expect(uninstall(root).removed.length, command).toBe(1);
    }
  });

  it('leaves hooks that merely mention stet alone', () => {
    const file = settingsPath(root, 'project');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo "stet is great" >> hooks.log' }] }] },
    }, null, 2));
    expect(installed(root)).toBe(false);
    expect(uninstall(root).removed).toHaveLength(0);
  });

  it('implements every event it wires', () => {
    // Wiring an event this build does not handle produces a hook that fires,
    // returns nothing, and gates nothing — wired and useless.
    for (const w of WIRING) expect(EVENTS as readonly string[]).toContain(w.arg);
  });

  it('can wire local scope instead', () => {
    install(root, 'local');
    expect(fs.existsSync(settingsPath(root, 'local'))).toBe(true);
    expect(fs.existsSync(settingsPath(root, 'project'))).toBe(false);
  });

  it('refuses to touch a settings file that is not valid JSON', () => {
    const file = settingsPath(root, 'project');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ broken');
    expect(() => install(root)).toThrow(/not valid JSON/);
  });
});

describe('parallel agents', () => {
  it('serialises canon writes so no rule is lost', () => {
    // The failure this prevents is silent: twenty concurrent writes produced
    // sixteen rules with ten distinct numbers before the lock existed.
    for (let i = 0; i < 12; i++) appendDirectRule(root, `rule number ${i} about this repository`);
    const rules = readRules(root);
    expect(rules).toHaveLength(12);
    expect(new Set(rules.map((r) => r.n)).size).toBe(12);
    expect(rules.map((r) => r.n)).toEqual([...rules.map((r) => r.n)].sort((a, b) => a - b));
  });

  it('releases the lock even when the write throws', () => {
    const file = path.join(root, '.stet', 'RULES.md');
    expect(() => withLock(file, () => { throw new Error('boom'); })).toThrow('boom');
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
    // …and the next writer is not wedged
    expect(() => appendDirectRule(root, 'a rule after a failed write')).not.toThrow();
  });

  it('takes over a lock left by a process that died', () => {
    const file = path.join(root, '.stet', 'RULES.md');
    fs.writeFileSync(`${file}.lock`, '999999 gone');
    fs.utimesSync(`${file}.lock`, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    expect(withLock(file, () => 'recovered', { staleMs: 5_000 })).toBe('recovered');
  });

  it('refuses rather than waiting forever on a live lock', () => {
    const file = path.join(root, '.stet', 'RULES.md');
    fs.writeFileSync(`${file}.lock`, `${process.pid} holding`);
    expect(() => withLock(file, () => 'never', { timeoutMs: 120, staleMs: 60_000 })).toThrow(/holding it/);
    fs.rmSync(`${file}.lock`, { force: true });
  });

  it('never lets two agents claim the same decision id', () => {
    const item = {
      id: 'contested', created: '2026-08-06T10:00:00Z', question: 'Which?',
      map: { A: 'a', B: 'b' },
      variants: [{ label: 'A', blocks: [] }, { label: 'B', blocks: [] }],
    } as never;
    expect(() => addItem(root, item)).not.toThrow();
    expect(() => addItem(root, item)).toThrow(/already exists/);
  });

  it('writes surfaces atomically, so a reader never sees half a canon', () => {
    appendDirectRule(root, 'a rule that must appear whole or not at all');
    sync(root, readRules(root), {});
    const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('stet:begin');
    expect(agents).toContain('stet:end');
    expect(fs.readdirSync(root).filter((f) => f.includes('.tmp'))).toHaveLength(0);
  });
});

// ── the hole a mid-session verdict fell into ───────────────────────────────
describe('a rule earned while the session is still running', () => {
  it('reaches the agent that is still working', () => {
    // SessionStart has already fired, and an unscoped rule never travels
    // through PreToolUse — so before UserPromptSubmit was wired, the rule you
    // had just given first bound an agent tomorrow. The code for it existed
    // and was never installed.
    appendDirectRule(root, 'never centre the hero', {});
    const start = runHook(root, 'session-start', { session_id: 's1', cwd: root });
    expect(JSON.stringify(start)).toMatch(/never centre the hero/);

    appendDirectRule(root, 'error copy names the next action', {});
    const prompt = runHook(root, 'user-prompt', { session_id: 's1', cwd: root });
    const ctx = prompt?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx, 'the new rule must arrive').toMatch(/error copy names the next action/);
    expect(ctx, 'and not repeat what this session already saw').not.toMatch(/never centre the hero/);
  });

  it('goes quiet once it has delivered', () => {
    appendDirectRule(root, 'buttons name the action they take', {});
    expect(runHook(root, 'user-prompt', { session_id: 's2', cwd: root })).toBeTruthy();
    expect(runHook(root, 'user-prompt', { session_id: 's2', cwd: root })).toBeNull();
  });

  it('is wired, not merely implemented', () => {
    // `stet hook events` advertised six; the installer wired five.
    expect(WIRING.map((w) => w.arg).sort()).toEqual([...EVENTS].sort());
  });
});

// ── the human's half of the wiring ─────────────────────────────────────────
describe('slash commands', () => {
  it('installs, and marks the files as its own', () => {
    const written = installCommands(root, 'stet');
    expect(written.length).toBe(2);
    const body = fs.readFileSync(path.join(root, '.claude/commands/stet.md'), 'utf8');
    expect(body).toContain('written by stet');
    expect(body).toContain('!`stet status`');
    expect(body).toContain('allowed-tools: Bash(stet:*)');
  });

  it('does not pre-approve every node process when pinned to a checkout', () => {
    // Pinned, the command is `node /abs/path/stet.js`. Narrowing allowed-tools
    // to Bash(node:*) there would whitelist every node process on the machine
    // to save one permission prompt.
    installCommands(root, '/usr/bin/node /tmp/stet.js');
    const body = fs.readFileSync(path.join(root, '.claude/commands/stet.md'), 'utf8');
    expect(body).not.toMatch(/allowed-tools/);
    expect(body).toContain('!`/usr/bin/node /tmp/stet.js status`');
  });

  it('updates its own file when the command changes', () => {
    // The first version recognised its own files by sniffing for the string
    // "stet status", which the pinned body does not contain — so re-wiring
    // silently refused to update and left a stale command behind.
    installCommands(root, '/usr/bin/node /tmp/stet.js');
    installCommands(root, 'stet');
    expect(fs.readFileSync(path.join(root, '.claude/commands/stet.md'), 'utf8')).toContain('!`stet status`');
  });

  it('never touches a command the human wrote under the same name', () => {
    fs.mkdirSync(path.join(root, '.claude/commands'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude/commands/stet.md'), 'my own command\n');
    installCommands(root, 'stet');
    expect(fs.readFileSync(path.join(root, '.claude/commands/stet.md'), 'utf8')).toBe('my own command\n');
    uninstallCommands(root);
    expect(fs.existsSync(path.join(root, '.claude/commands/stet.md'))).toBe(true);
  });

  it('removes only what it wrote', () => {
    installCommands(root, 'stet');
    expect(uninstallCommands(root).length).toBe(2);
    expect(fs.existsSync(path.join(root, '.claude/commands/stet.md'))).toBe(false);
  });
});

// ── listening for events that exist ────────────────────────────────────────
describe('the wiring names events Claude Code emits', () => {
  it('wires nothing Claude Code does not send', () => {
    // stet wired `PostCompact` for its entire life. There is no such event.
    // That hook never fired once, and `stet claude status` reported it
    // verified — because it asked our own binary whether it implements
    // `post-compact` (it does) and never asked whether Claude Code emits
    // `PostCompact` (it does not). A real check, pointed at the wrong half.
    for (const w of WIRING) {
      expect(CLAUDE_EVENTS as readonly string[], `${w.event} is not a Claude Code event`).toContain(w.event);
    }
  });

  it('still answers a wiring written before the name was corrected', () => {
    // Anyone wired by an older stet calls `stet hook post-compact`. It never
    // fired, so nothing is lost — but going silent on them adds a second
    // failure to the first.
    appendDirectRule(root, 'never apologise in error copy', {});
    const out = runHook(root, 'post-compact', { session_id: 'old', cwd: root });
    expect(out?.hookSpecificOutput?.additionalContext).toContain('never apologise');
  });

  it('restates the canon around compaction, forgetting what the lost context held', () => {
    appendDirectRule(root, 'error copy names the next action', {});
    const first = runHook(root, 'session-start', { session_id: 'c1', cwd: root });
    expect(JSON.stringify(first)).toContain('error copy names the next action');
    // Already delivered — silent.
    expect(runHook(root, 'user-prompt', { session_id: 'c1', cwd: root })).toBeNull();
    // Compaction destroys the context that held it, so it must be said again.
    const compact = runHook(root, 'pre-compact', { session_id: 'c1', cwd: root });
    expect(JSON.stringify(compact)).toContain('error copy names the next action');
    expect(compact?.hookSpecificOutput?.hookEventName).toBe('PreCompact');
  });
});

// ── what belongs in the repo and what does not ─────────────────────────────
describe('the project directory', () => {
  it('keeps per-developer session state out of git', () => {
    // After a day of work: one RULES.md worth sharing, and 25 session
    // journals beside it — each rewritten on every tool call, each a merge
    // conflict waiting to happen.
    const ignore = fs.readFileSync(path.join(root, '.stet', '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^sessions\/$/m);
    expect(ignore).toMatch(/^\*\.lock$/m);
    // The patterns, not the prose: the comment names RULES.md and decided/
    // precisely to say they belong in the repo.
    const patterns = ignore.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    expect(patterns).toEqual(['sessions/', '*.lock']);
  });

  it('never overwrites one the human wrote', () => {
    fs.writeFileSync(path.join(root, '.stet', '.gitignore'), 'mine\n');
    init(root);
    expect(fs.readFileSync(path.join(root, '.stet', '.gitignore'), 'utf8')).toBe('mine\n');
  });
});

// ── the churn signal ───────────────────────────────────────────────────────
describe('taste said out loud', () => {
  it('proposes a scoped rule, not a bare one', () => {
    // A rule with globs is delivered at the moment an agent touches that area
    // again. An unscoped one waits at the top of the next session. The churn
    // signal already knows the path, so suggesting the weaker form was leaving
    // the whole mechanism on the table.
    for (const q of ['p1', 'p2', 'p3']) {
      postToolUse(root, {
        session_id: 'c1', cwd: root, prompt_id: q, tool_name: 'Edit',
        tool_input: { file_path: path.join(root, 'src/components/Button.tsx'), old_string: 'a', new_string: 'b' },
      });
    }
    const ctx = stop(root, { session_id: 'c1', cwd: root })?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('src/components/Button.tsx');
    expect(ctx).toContain(`--globs 'src/components/**'`);
  });
});

// ── notes: what the codebase taught, as opposed to what its owner decided ───
describe('notes', () => {
  it('arrives at the moment somebody touches what it is about', () => {
    appendNote(root, 'the second copy of weakness() lives here; rules.ts has the other', ['src/page.ts']);
    const ctx = preToolUse(root, {
      session_id: 'n1', cwd: root, tool_name: 'Edit',
      tool_input: { file_path: path.join(root, 'src/page.ts'), old_string: 'a', new_string: 'b' },
    })?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('second copy of weakness()');
    expect(ctx).toContain('learned here, not obvious from the code');
  });

  it('says it once per session', () => {
    appendNote(root, 'no backticks inside the PAGE template literal — it breaks the build', ['src/page.ts']);
    const write = () => preToolUse(root, {
      session_id: 'n2', cwd: root, tool_name: 'Edit',
      tool_input: { file_path: path.join(root, 'src/page.ts'), old_string: 'a', new_string: 'b' },
    });
    expect(write()).toBeTruthy();
    expect(write(), 'a note repeated on every write is a note people skip').toBeNull();
  });

  it('stays out of the way of files it is not about', () => {
    appendNote(root, 'globs are relative to the project root, not to where you stand', ['src/page.ts']);
    expect(preToolUse(root, {
      session_id: 'n3', cwd: root, tool_name: 'Edit',
      tool_input: { file_path: path.join(root, 'README.md'), old_string: 'a', new_string: 'b' },
    })).toBeNull();
  });

  it('never displaces a rule, which is the binding half', () => {
    appendDirectRule(root, 'never centre the hero', { globs: ['src/**'] });
    for (let i = 0; i < 12; i++) appendNote(root, `a fact about this area number ${i} worth stating`, ['src/**']);
    const ctx = preToolUse(root, {
      session_id: 'n4', cwd: root, tool_name: 'Edit',
      tool_input: { file_path: path.join(root, 'src/page.ts'), old_string: 'a', new_string: 'b' },
    })?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx.indexOf('binding')).toBeLessThan(ctx.indexOf('learned here'));
    expect(ctx).toContain('never centre the hero');
    expect((ctx.match(/^· /gm) ?? []).length, 'notes are capped so they cannot become the block people skip').toBeLessThanOrEqual(4);
  });

  it('reads its scope back intact, dots and all', () => {
    // The provenance parser that mangled every dotted glob in RULES.md was
    // copied in shape here; it must not be copied in bug.
    const globs = ['package.json', '**/*.test.*', 'src/**/*.tsx'];
    appendNote(root, 'a fact scoped to awkward globs, stated at length', globs);
    expect(readNotes(root).at(-1)?.globs).toEqual(globs);
  });

  it('numbers survive a removal, like rules', () => {
    appendNote(root, 'the first fact worth recording here', ['a/**']);
    appendNote(root, 'the second fact worth recording here', ['b/**']);
    appendNote(root, 'the third fact worth recording here', ['c/**']);
    expect(removeNote(root, 2)?.text).toContain('second');
    expect(readNotes(root).map((n) => n.n)).toEqual([1, 3]);
    expect(removeNote(root, 99)).toBeNull();
  });

  it('refuses the ones that cost tokens and say nothing', () => {
    for (const bad of ['be careful with this file', 'TODO fix this later', 'why does this break?', 'hmm']) {
      expect(thin(bad), bad).not.toBeNull();
    }
    for (const good of [
      'the second copy of weakness() lives here; rules.ts has the other',
      'globs are relative to the project root, not to where you are standing',
      'absorbAsset covers image and audio only — url is handled separately',
    ]) {
      expect(thin(good), good).toBeNull();
    }
  });
});

// ── did Claude Code actually call any of this? ─────────────────────────────
describe('observed firing', () => {
  it('records that an event was really called', () => {
    // The two checks that existed were declarations: a settings file says the
    // hook is wired, and our own binary says it implements the argument.
    // `PostCompact` satisfied both for the life of the project and never fired.
    expect(lastFired(root)).toEqual({});
    runHook(root, 'session-start', { session_id: 'f1', cwd: root });
    runHook(root, 'pre-tool-use', {
      session_id: 'f1', cwd: root, tool_name: 'Edit',
      tool_input: { file_path: path.join(root, 'x.ts'), old_string: 'a', new_string: 'b' },
    });
    const fired = lastFired(root);
    expect(Object.keys(fired).sort()).toEqual(['pre-tool-use', 'session-start']);
    expect(fired['session-start']).toBeGreaterThan(0);
    expect(fired['pre-compact'], 'an event nothing called must stay absent').toBeUndefined();
  });

  it('records the call even when the hook has nothing to say', () => {
    // Most invocations return null. If only the ones that spoke were recorded,
    // a correctly wired but quiet hook would read as never called.
    runHook(root, 'stop', { session_id: 'f2', cwd: root });
    expect(lastFired(root)['stop']).toBeGreaterThan(0);
  });

  it('survives the sweep that clears old session state', () => {
    // The markers are evidence about the wiring, not session state. A stale one
    // is the finding — "nothing has called this in a week" — not litter.
    runHook(root, 'stop', { session_id: 'f3', cwd: root });
    const marker = path.join(root, '.stet', 'sessions', '.fired-stop');
    fs.utimesSync(marker, new Date(Date.now() - 9e8), new Date(Date.now() - 9e8));
    sweepSessions(root);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('costs effectively nothing on the path that runs per tool call', () => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) {
      runHook(root, 'pre-tool-use', {
        session_id: 'perf', cwd: root, tool_name: 'Edit',
        tool_input: { file_path: path.join(root, 'x.ts'), old_string: 'a', new_string: 'b' },
      });
    }
    const perCall = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
    expect(perCall, `${perCall.toFixed(2)}ms per in-process hook call`).toBeLessThan(5);
  });
});

// ── the instruction that starts the loop ───────────────────────────────────
describe('how to ask', () => {
  it('arrives at session start even when the canon is empty', () => {
    // A repository with no verdicts yet is exactly the one that needs an agent
    // to know it can ask. Before this, SessionStart returned null there.
    expect(readRules(root)).toEqual([]);
    const ctx = runHook(root, 'session-start', { session_id: 'h1', cwd: root })
      ?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('stet ask');
    expect(ctx).toContain('--wait');
    expect(ctx, 'and that notes are the half an agent may write').toContain('stet note');
  });

  it('comes before the canon, because it is what makes any of it happen', () => {
    appendDirectRule(root, 'never centre the hero', {});
    const ctx = runHook(root, 'session-start', { session_id: 'h2', cwd: root })
      ?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx.indexOf('stet ask')).toBeLessThan(ctx.indexOf('never centre the hero'));
  });

  it('is restated around compaction, which is when it would be summarised away', () => {
    const ctx = runHook(root, 'pre-compact', { session_id: 'h3', cwd: root })
      ?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('stet ask');
  });

  it('does not repeat on every prompt', () => {
    // UserPromptSubmit exists to deliver a rule earned mid-session. Repeating
    // the whole instruction there would cost tokens on every turn.
    runHook(root, 'session-start', { session_id: 'h4', cwd: root });
    const ctx = runHook(root, 'user-prompt', { session_id: 'h4', cwd: root })
      ?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).not.toContain('stet ask');
  });

  it('is the same text the file surfaces carry, not a second copy', () => {
    // Two copies of the sentence that starts the loop would drift, and the
    // drift would be invisible: each channel would look fine on its own.
    expect(renderBlock(selectRules([], { budget: 1500 }))).toContain(HOW_TO_ASK);
  });
});

// Explaining how to ask where there is no project to ask in is noise — and
// acting on the advice would create a .stet/ nobody asked for.
describe('outside a project', () => {
  it('says nothing at all', () => {
    expect(runHook('/does/not/exist', 'session-start', {})).toBeNull();
    expect(runHook('/does/not/exist', 'pre-compact', {})).toBeNull();
  });
});
