import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globToRegExp, matches, matchesAny } from '../src/glob.js';
import { canonOnce, churn, postCompact, postToolUse, preToolUse, runHook, stop, targetPath } from '../src/hooks.js';
import { install, installed, settingsPath, uninstall, WIRING } from '../src/claude.js';
import { init } from '../src/store.js';

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
    expect(globToRegExp('x.ts').test('xats')).toBe(false);
  });

  it('handles an empty or missing glob list', () => {
    expect(matchesAny(undefined, 'a.ts')).toBe(false);
    expect(matchesAny([], 'a.ts')).toBe(false);
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

  it('says nothing when there is nothing to say', () => {
    expect(canonOnce(root, { session_id: 'sC', cwd: root }, 'SessionStart')).toBeNull();
  });
});

describe('surviving compaction', () => {
  it('restates the canon after the context that held it is gone', () => {
    rules('# Rules\n\n## 1 — never apologise in error copy\n\n*Earned from z, 2026-08-05.*\n');
    const input = { session_id: 'sD', cwd: root };
    expect(canonOnce(root, input, 'SessionStart')).not.toBeNull();
    expect(canonOnce(root, input, 'SessionStart')).toBeNull();   // already said
    expect(postCompact(root, input)?.hookSpecificOutput?.additionalContext).toContain('never apologise');
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
