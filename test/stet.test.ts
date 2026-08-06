import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { addItem, blind, decide, describeProblem, init, listEntries, readEntry, revealText, shuffleLabels, assetPath } from '../src/store.js';
import { appendRule, appendDirectRule, bumpHits, estimateTokens, parseRules, readRules, renderBlock, reviseRule, ruleLine, selectRules, weakness } from '../src/rules.js';
import { hasBlock, insert, remove, sync, unsync } from '../src/sync.js';
import { PAGE } from '../src/page.js';
import { runHook } from '../src/hooks.js';
import { problems } from '../src/validate.js';
import { METHOD } from '../src/method.js';
import { matchesAny } from '../src/glob.js';
import type { Item, Rule } from '../src/types.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-test-'));
  init(root);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const item = (over: Partial<Item> = {}): Item => ({
  id: 'demo',
  created: '2026-08-05T10:00:00Z',
  question: 'Which one?',
  map: { A: 'the first thing', B: 'the second thing' },
  variants: [
    { label: 'A', blocks: [{ kind: 'text', text: 'one' }] },
    { label: 'B', blocks: [{ kind: 'text', text: 'two' }] },
  ],
  ...over,
});

describe('store', () => {
  it('round-trips an item through pending and decided', () => {
    addItem(root, item(), { shuffle: false });
    expect(listEntries(root, 'pending')).toHaveLength(1);
    const out = decide(root, 'demo', { verdict: 'B', because: 'because it is plainer', rule: 'because it is plainer', revealed: 'x' });
    expect(out.verdict).toBe('B');
    expect(listEntries(root, 'pending')).toHaveLength(0);
    expect(listEntries(root, 'decided')).toHaveLength(1);
  });

  it('moves assets with the item', () => {
    const dir = addItem(root, item({ variants: [
      { label: 'A', blocks: [{ kind: 'image', src: 'a.svg' }] },
      { label: 'B', blocks: [{ kind: 'image', src: 'b.svg' }] },
    ] }), { shuffle: false });
    fs.writeFileSync(path.join(dir, 'a.svg'), '<svg/>');
    decide(root, 'demo', { verdict: 'A', because: 'r', rule: 'r', revealed: 'x' });
    expect(assetPath(root, 'demo', 'a.svg')).toBeTruthy();
  });

  it('never lets map through blind()', () => {
    const b = blind(item()) as Record<string, unknown>;
    expect('map' in b).toBe(false);
    expect(JSON.stringify(b)).not.toContain('the first thing');
  });

  it('refuses assets outside the item directory', () => {
    addItem(root, item(), { shuffle: false });
    expect(assetPath(root, 'demo', '../../../etc/passwd')).toBeNull();
    expect(assetPath(root, 'demo', '..%2Fitem.json')).toBeNull();
  });

  it('surfaces a broken item instead of skipping it', () => {
    const dir = path.join(root, '.stet', 'pending', 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'item.json'), '{ not json');
    const e = readEntry(dir, 'pending');
    expect(e.ok).toBe(false);
    expect(listEntries(root, 'pending')).toHaveLength(1);
  });

  it('accepts a single variant as an acceptance gate', () => {
    expect(describeProblem({ ...item(), map: { A: 'it' }, variants: [{ label: 'A', blocks: [] }] })).toBeNull();
  });

  it('rejects an item with no map for a variant', () => {
    expect(describeProblem({ ...item(), map: { A: 'only a' } })).toMatch(/map/);
  });

  it('shuffles labels while keeping each variant tied to its own truth', () => {
    const src = item();
    const flipped = shuffleLabels(src, () => 0); // deterministic swap
    for (const v of flipped.variants) {
      const original = src.variants.find((o) => o.blocks[0] === v.blocks[0])!;
      expect(flipped.map[v.label]).toBe(src.map[original.label]);
    }
    expect(revealText(flipped)).toContain('=');
  });
});

describe('rules', () => {
  it('injects only the first line of a paragraph', () => {
    expect(ruleLine('one line\n\nand a whole paragraph after it')).toBe('one line');
  });

  it('appends and parses back', () => {
    const it0 = { ...item(), verdict: 'B', because: 'Bare arrays for lists\nmore prose', decidedAt: '2026-08-05T10:00:00Z', tags: ['api'] };
    const r = appendRule(root, it0);
    expect(r.n).toBe(1);
    const back = readRules(root);
    expect(back).toHaveLength(1);
    expect(back[0].text).toBe('Bare arrays for lists');
    expect(back[0].tags).toEqual(['api']);
    expect(back[0].from).toBe('demo');
  });

  it('numbers rules in sequence', () => {
    appendRule(root, { ...item(), verdict: 'A', because: 'first' });
    appendRule(root, { ...item(), verdict: 'A', because: 'second' });
    expect(readRules(root).map((r) => r.n)).toEqual([1, 2]);
  });

  it('revises one rule in place and leaves the rest byte-identical', () => {
    appendRule(root, { ...item(), verdict: 'A', because: 'first' });
    appendRule(root, { ...item(), verdict: 'A', because: 'second' });
    const before = fs.readFileSync(path.join(root, '.stet', 'RULES.md'), 'utf8');
    reviseRule(root, 1, 'sharper first');
    const after = fs.readFileSync(path.join(root, '.stet', 'RULES.md'), 'utf8');
    expect(after).toBe(before.replace('## 1 — first', '## 1 — sharper first'));
    expect(readRules(root)[1].text).toBe('second');
  });

  it('records a correction with no decision behind it', () => {
    const r = appendDirectRule(root, 'never centre the hero', { tags: ['design'] });
    expect(r.n).toBe(1);
    expect(readRules(root)[0].tags).toEqual(['design']);
  });

  it('catches rules that cannot survive the shuffle', () => {
    expect(weakness('Looks cleaner and much better compared to the option B')).toMatch(/variant label/);
    expect(weakness('short')).toMatch(/too short/);
    expect(weakness('Empty states keep the table headers so the screen teaches its own shape')).toBeNull();
    expect(weakness('Looks better')).toBeTruthy();
  });

  it('catches a rule written to yourself rather than to an agent', () => {
    // Real: this one passed every earlier check and told the next agent nothing.
    expect(weakness('I think go with the flow')).toMatch(/written to yourself/);
    expect(weakness("I'd keep the serif one")).toMatch(/written to yourself/);
    expect(weakness('Maybe use the bare array')).toMatch(/written to yourself/);
    // …without flagging a legitimate instruction that happens to contain "I"
    expect(weakness('Invoices always show the client name before the amount')).toBeNull();
    expect(weakness('Prefer bare arrays for list endpoints')).toBeNull();
  });

  it('counts a rule as matched when a decision lands in its area', () => {
    appendRule(root, { ...item(), verdict: 'A', because: 'a design rule', tags: ['design'] });
    appendRule(root, { ...item(), verdict: 'A', because: 'an api rule', tags: ['api'] });
    expect(readRules(root).map((r) => r.hits)).toEqual([0, 0]);

    expect(bumpHits(root, ['design'])).toBe(1);
    expect(bumpHits(root, ['design'])).toBe(2 - 1); // still just the one rule
    expect(readRules(root).map((r) => r.hits)).toEqual([2, 0]);

    // the text of every rule survives the rewrite untouched
    expect(readRules(root).map((r) => r.text)).toEqual(['a design rule', 'an api rule']);
    expect(bumpHits(root, [])).toBe(0);
    expect(bumpHits(root, ['nothing-matches-this'])).toBe(0);
  });

  it('lets a matched rule outrank a newer one under pressure', () => {
    appendRule(root, { ...item(), verdict: 'A', because: 'an old but constantly relevant rule', tags: ['design'] });
    appendRule(root, { ...item(), verdict: 'A', because: 'a newer rule nobody has touched' });
    bumpHits(root, ['design']);
    const sel = selectRules(readRules(root), { budget: 90 });
    expect(sel.chosen[0].text).toBe('an old but constantly relevant rule');
  });

  it('parses tags and globs out of the provenance line', () => {
    const rs = parseRules('## 4 — a rule\n\n*Earned from x, 2026-08-05. Tags: api, ui. Globs: src/**.*\n\nbody\n');
    expect(rs[0].n).toBe(4);
    expect(rs[0].tags).toEqual(['api', 'ui']);
    expect(rs[0].globs).toEqual(['src/**']);
  });
});

describe('budget', () => {
  const many = (n: number): Rule[] =>
    Array.from({ length: n }, (_, i) => ({
      n: i + 1,
      text: `rule number ${i + 1} says something reasonably long about how this repository prefers things`,
      tags: i % 2 ? ['api'] : ['ui'],
      globs: [],
      body: '',
      hits: 0,
    }));

  it('keeps the most recent when the budget bites, and says how many it held back', () => {
    const sel = selectRules(many(200), { budget: 400 });
    expect(sel.chosen.length).toBeLessThan(200);
    expect(sel.heldBack).toBe(200 - sel.chosen.length);
    expect(sel.chosen.at(-1)!.n).toBe(200);
    expect(renderBlock(sel)).toContain('held back');
  });

  it('never emits an empty block silently', () => {
    expect(renderBlock(selectRules([], {}))).toContain('no rules earned yet');
  });

  it('keeps at least one rule even under an absurd budget', () => {
    expect(selectRules(many(5), { budget: 1 }).chosen).toHaveLength(1);
  });

  it('prefers frequently matched rules over merely recent ones', () => {
    const rs = many(3);
    rs[0].hits = 99;
    const sel = selectRules(rs, { budget: 120 });
    expect(sel.chosen.some((r) => r.n === 1)).toBe(true);
  });

  it('filters by tag', () => {
    expect(selectRules(many(10), { tags: ['api'] }).chosen.every((r) => r.tags.includes('api'))).toBe(true);
  });

  it('estimates tokens above the naive character count', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('sync', () => {
  it('is idempotent', () => {
    const once = insert('# Notes\n', 'BLOCK');
    expect(insert(once, 'BLOCK')).toBe(once);
    expect(hasBlock(once)).toBe(true);
  });

  it('restores the original byte for byte', () => {
    for (const original of ['# Notes\n', '# Notes', 'a\n\n', '', 'x\ny\nz\n\n\n']) {
      const withBlock = insert(original, 'BLOCK');
      expect(remove(withBlock).text).toBe(original);
    }
  });

  it('updates in place without disturbing the rest of the file', () => {
    const a = insert('# Notes\n\ntail text\n', 'ONE');
    const b = insert(a, 'TWO');
    expect(b).toContain('TWO');
    expect(b).not.toContain('ONE');
    expect(remove(b).text).toBe('# Notes\n\ntail text\n');
  });

  it('creates AGENTS.md and deletes it again on --remove', () => {
    sync(root, readRules(root), {});
    const agents = path.join(root, 'AGENTS.md');
    expect(fs.existsSync(agents)).toBe(true);
    unsync(root, {});
    expect(fs.existsSync(agents)).toBe(false);
  });

  it('never creates a surface the repo did not already have', () => {
    sync(root, readRules(root), {});
    expect(fs.existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.cursorrules'))).toBe(false);
  });

  it('writes into an existing surface and restores it exactly', () => {
    const claude = path.join(root, 'CLAUDE.md');
    const original = '# Project\n\nSome guidance the human wrote.\n';
    fs.writeFileSync(claude, original);
    appendRule(root, { ...item(), verdict: 'A', because: 'a real rule about things' });
    sync(root, readRules(root), {});
    const after = fs.readFileSync(claude, 'utf8');
    expect(after.startsWith(original)).toBe(true);
    expect(after).toContain('a real rule about things');
    unsync(root, {});
    expect(fs.readFileSync(claude, 'utf8')).toBe(original);
  });

  it('scopes a .mdc rule file to its own globs', () => {
    const dir = path.join(root, '.cursor', 'rules');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'api.mdc'), '---\nglobs: src/api/**\n---\n\nrules here\n');
    fs.writeFileSync(path.join(root, '.stet', 'RULES.md'),
      '# Rules\n\n## 1 — an api rule\n\n*Earned from x, 2026-08-05. Globs: src/api/**.*\n\n## 2 — a web rule\n\n*Earned from y, 2026-08-05. Globs: web/**.*\n');
    sync(root, readRules(root), {});
    const mdc = fs.readFileSync(path.join(dir, 'api.mdc'), 'utf8');
    expect(mdc).toContain('an api rule');
    expect(mdc).not.toContain('a web rule');
  });
});

// ── the live preview ───────────────────────────────────────────────────────
// Every check here is a bug that reached a real dev server first: an iframe
// that never painted, an app that could not use storage or fetch, and a CSS
// class the frame shared with the connection indicator in the header.
describe('the live preview', () => {
  it('never defers loading a frame or an image', () => {
    // A deferred element inside a collapsed box is 0×0, never enters the
    // viewport, and so never loads — it waits for itself. Both frames were
    // blank white boxes on first paint because of this.
    expect(PAGE).not.toMatch(/loading="lazy"/);
  });

  it('decides the sandbox from the origin rather than granting it flat', () => {
    // allow-same-origin on a same-origin frame lets the frame reach into the
    // page that sandboxed it and remove its own sandbox. Cross-origin — the
    // dev server on another port — it is the only way the app can use
    // localStorage or fetch its own API.
    expect(PAGE).toContain('function sandboxFor(');
    expect(PAGE).toMatch(/origin!==location\.origin/);
    expect(PAGE).not.toMatch(/sandbox="allow-scripts allow-forms allow-popups allow-same-origin"/);
  });

  it('does not style the frame with a class another element already wears', () => {
    // The connection indicator is `conn live`. A bare `.live` rule matched it
    // too, so min-height:300px on the frame grew the status dot in the header
    // into a 480×300 box over the title.
    const worn = new Set<string>();
    for (const m of PAGE.matchAll(/class="([^"{]+)"/g))
      for (const c of m[1].trim().split(/\s+/)) worn.add(c);
    // Any class used to style the frame must not also appear on a second,
    // unrelated element. The pairing that bit us was .live on both.
    expect(PAGE).toContain('.liveframe{');
    expect(PAGE).not.toMatch(/^\.live\{/m);
    expect(worn.has('liveframe') || PAGE.includes('class="liveframe"')).toBe(true);
  });
});

// ── first contact ──────────────────────────────────────────────────────────
// The first thing a person types is `--version` or `--help`. Both used to be
// swallowed by the flag parser, fall through to the default command, write a
// project into the current directory and hang on a web server. And the version
// they would have printed was hardcoded a release behind the package — the
// number `stet hook events` reports, which is what the skew check trusts.
describe('first contact', () => {
  const BIN = path.join(process.cwd(), 'bin', 'stet.js');
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
  const run = (args: string[], cwd: string) =>
    spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8', timeout: 10_000 });

  it('reports the version the package actually is', () => {
    // One source of truth. A second copy drifts, and this one fed the check
    // built to catch drift.
    expect(run(['version'], root).stdout.trim()).toBe(pkg.version);
    expect(run(['--version'], root).stdout.trim()).toBe(pkg.version);
    expect(run(['-v'], root).stdout.trim()).toBe(pkg.version);
  });

  it('reports that same version to a wiring probing it', () => {
    const probe = JSON.parse(run(['hook', 'events'], root).stdout) as { version: string };
    expect(probe.version).toBe(pkg.version);
  });

  it('answers --version and --help without touching the filesystem', () => {
    for (const form of [['--version'], ['--help'], ['-h'], ['help'], ['-v']]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-first-'));
      const r = run(form, dir);
      expect(r.status, `${form.join(' ')} should exit 0`).toBe(0);
      expect(r.signal, `${form.join(' ')} should not have to be killed`).toBe(null);
      expect(fs.readdirSync(dir), `${form.join(' ')} wrote into the cwd`).toEqual([]);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── the item contract ──────────────────────────────────────────────────────
// Items are authored by agents, so malformed input is the normal case. Each of
// these either crashed with a TypeError naming an internal property, or queued
// successfully and produced a decision screen the human could not act on.
describe('the item contract', () => {
  const good = (): unknown => ({
    id: 'ok', question: 'Which?',
    map: { A: 'serif', B: 'sans' },
    variants: [
      { label: 'A', blocks: [{ kind: 'text', text: 'one' }] },
      { label: 'B', blocks: [{ kind: 'text', text: 'two' }] },
    ],
  });

  it('accepts a well-formed item', () => {
    expect(problems(good())).toEqual([]);
  });

  it('allows a single variant, which is the accept/reject gate', () => {
    // Documented behaviour: one variant asks "good enough to ship?". A rule
    // requiring two would have quietly removed a supported mode.
    const one = good() as { variants: unknown[]; map: Record<string, string> };
    one.variants = [one.variants[0]];
    delete one.map.B;
    expect(problems(one)).toEqual([]);
  });

  it('refuses an item with nothing to rule on', () => {
    const none = good() as { variants: unknown[] };
    none.variants = [];
    expect(problems(none).join(' ')).toMatch(/is empty/);
  });

  it('refuses an item with no question', () => {
    const q = good() as Record<string, unknown>;
    delete q.question;
    expect(problems(q).join(' ')).toMatch(/"question" is required/);
  });

  it('refuses a missing map instead of throwing on undefined', () => {
    const m = good() as Record<string, unknown>;
    delete m.map;
    // It used to be: Cannot read properties of undefined (reading 'A')
    expect(problems(m).join(' ')).toMatch(/"map" is required/);
  });

  it('names a label the map does not cover', () => {
    const m = good() as { map: Record<string, string> };
    delete m.map.B;
    expect(problems(m).join(' ')).toMatch(/no entry for variant "B"/);
  });

  it('refuses a block of a kind nothing renders', () => {
    const b = good() as { variants: { blocks: unknown[] }[] };
    b.variants[0].blocks = [{ kind: 'video', src: 'v.mp4' }];
    expect(problems(b).join(' ')).toMatch(/is not one of: code, diff, text, image, audio, url/);
  });

  it('refuses a block missing the field its kind needs', () => {
    const b = good() as { variants: { blocks: unknown[] }[] };
    b.variants[0].blocks = [{ kind: 'image' }];
    expect(problems(b).join(' ')).toMatch(/needs a non-empty "src"/);
  });

  it('reports every problem at once, not one per attempt', () => {
    expect(problems({}).length).toBeGreaterThanOrEqual(3);
  });

  it('refuses to write anything when the item is bad', () => {
    expect(() => addItem(root, { id: 'bad' } as never)).toThrow(/cannot be queued/);
    expect(fs.existsSync(path.join(root, '.stet/pending/bad'))).toBe(false);
  });
});

// ── flags ──────────────────────────────────────────────────────────────────
describe('flags a command does not read', () => {
  const BIN = path.join(process.cwd(), 'bin', 'stet.js');
  const run = (args: string[]) => spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });

  it('scopes a direct rule, which --globs silently dropped', () => {
    // The flag parsed, nothing read it, and the rule became repo-wide while
    // reporting success — so the fastest way to record a rule was also the
    // only way that could not scope it.
    expect(run(['rule', 'buttons say what happens', '--globs', 'src/web/**']).status).toBe(0);
    const rule = readRules(root)[0];
    expect(rule.globs).toEqual(['src/web/**']);
  });

  it('refuses a flag it does not read, and suggests the real one', () => {
    const r = run(['rule', 'x', '--glob', 'src/**']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not take --glob/);
    expect(r.stderr).toMatch(/did you mean --globs\?/);
  });

  it('still accepts the flags it does read', () => {
    expect(run(['rules', '--tag', 'design']).status).toBe(0);
  });
});

// ── the one-line ask ───────────────────────────────────────────────────────
// The whole tool is downstream of whether an agent ever asks, and asking used
// to cost a discovery command plus fifteen lines of authored JSON — more than
// guessing, against a model trained to finish. These are the shapes that make
// asking cheaper than the guess.
describe('the one-line ask', () => {
  const BIN = path.join(process.cwd(), 'bin', 'stet.js');
  const run = (args: string[]) => spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  const queued = (id: string) =>
    JSON.parse(fs.readFileSync(path.join(root, '.stet/pending', id, 'item.json'), 'utf8')) as Item;

  it('queues two text options with no JSON', () => {
    const r = run(['ask', 'Which button label ships?', 'Buy now', 'Get started']);
    expect(r.status, r.stderr).toBe(0);
    const item = queued('which-button-label-ships');
    expect(item.variants).toHaveLength(2);
    expect(item.variants.map((v) => (v.blocks[0] as { text: string }).text).sort())
      .toEqual(['Buy now', 'Get started']);
  });

  it('derives the id from the question and never collides', () => {
    run(['ask', 'Same question?', 'a', 'b']);
    run(['ask', 'Same question?', 'c', 'd']);
    expect(fs.existsSync(path.join(root, '.stet/pending/same-question'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.stet/pending/same-question-2'))).toBe(true);
  });

  it('gives a bare host:port a scheme, because otherwise it is a relative path', () => {
    run(['ask', 'Which hero?', '--url', 'localhost:5173/a', '--url', '127.0.0.1:5173/b']);
    const hrefs = queued('which-hero').variants.map((v) => (v.blocks[0] as { href: string }).href).sort();
    expect(hrefs).toEqual(['http://127.0.0.1:5173/b', 'http://localhost:5173/a']);
  });

  it('claims paths, so the gate denies writes there', () => {
    run(['ask', 'Which layout?', 'grid', 'stack', '--globs', 'src/hero/**']);
    expect(queued('which-layout').globs).toEqual(['src/hero/**']);
  });

  it('refuses to compare unlike things', () => {
    const r = run(['ask', 'Which?', 'some text', '--url', 'localhost:3000']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/compare like with like/);
  });

  it('names the options it can take when given none', () => {
    const r = run(['ask', 'Which one?']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--url/);
    expect(r.stderr).toMatch(/--image/);
  });

  it('shuffles, so the order the agent listed them in is not the order shown', () => {
    // Deterministically: over many items, the first option must not always be A.
    let firstIsA = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      run(['ask', `Shuffle probe ${i}?`, 'first-option', 'second-option']);
      const item = queued(`shuffle-probe-${i}`);
      if (item.map?.A === 'first-option') firstIsA++;
    }
    expect(firstIsA).toBeGreaterThan(4);
    expect(firstIsA).toBeLessThan(n - 4);
  });
});

// ── the blind guarantee, in the page itself ────────────────────────────────
describe('what the page shows before a verdict', () => {
  it('withholds a url block address until the reveal', () => {
    // A URL is rarely neutral: /hero-serif beside /hero-sans hands the human
    // the answer while they are still supposed to be judging the frame. The
    // page printed it under every panel.
    expect(PAGE).toContain('opens in a new tab');
    expect(PAGE).toMatch(/revealed\?esc\(b\.href/);
  });
});

// ── local files a variant points at ────────────────────────────────────────
describe('assets a variant brings with it', () => {
  const write = (name: string, body = 'x') => {
    const f = path.join(root, name);
    fs.writeFileSync(f, body);
    return name;
  };

  it('copies a url block\'s local file in and renames it after the shuffled label', () => {
    // `url` was excluded from this for as long as it existed, which made it the
    // one kind that both failed to load from a relative path — the file was
    // never copied, so the frame rendered nothing — and leaked its own name.
    write('hero-serif.html', '<b>serif</b>');
    write('hero-sans.html', '<b>sans</b>');
    addItem(root, {
      id: 'live', question: 'Which hero?',
      map: { A: 'serif', B: 'sans' },
      variants: [
        { label: 'A', blocks: [{ kind: 'url', href: 'hero-serif.html' }] },
        { label: 'B', blocks: [{ kind: 'url', href: 'hero-sans.html' }] },
      ],
    } as Item, { from: root });

    const dir = path.join(root, '.stet/pending/live');
    const item = JSON.parse(fs.readFileSync(path.join(dir, 'item.json'), 'utf8')) as Item;
    const hrefs = item.variants.map((v) => (v.blocks[0] as { href: string }).href);
    for (const h of hrefs) {
      expect(h, 'the source filename is the answer to the blind test').not.toMatch(/serif|sans/);
      expect(fs.existsSync(path.join(dir, h)), `${h} must be there to serve`).toBe(true);
    }
  });

  it('leaves a url block pointing at someone else\'s server alone', () => {
    addItem(root, {
      id: 'remote', question: 'Which?',
      map: { A: 'a', B: 'b' },
      variants: [
        { label: 'A', blocks: [{ kind: 'url', href: 'http://localhost:5173/?v=a' }] },
        { label: 'B', blocks: [{ kind: 'url', href: 'http://localhost:5173/?v=b' }] },
      ],
    } as Item, { from: root });
    const item = JSON.parse(fs.readFileSync(path.join(root, '.stet/pending/remote/item.json'), 'utf8')) as Item;
    for (const v of item.variants) expect((v.blocks[0] as { href: string }).href).toMatch(/^http:\/\/localhost:5173/);
  });
});

// ── the demo ───────────────────────────────────────────────────────────────
describe('the example decisions the demo runs on', () => {
  const dir = path.join(process.cwd(), 'fixtures');

  it('ships with the package', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files, '`stet demo` reads these at runtime').toContain('fixtures');
  });

  it('is a set every one of which stet would accept from an agent', () => {
    const ids = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'item.json')));
    expect(ids.length).toBeGreaterThan(3);
    for (const id of ids) {
      const item = JSON.parse(fs.readFileSync(path.join(dir, id, 'item.json'), 'utf8')) as unknown;
      expect(problems(item), `fixtures/${id} would be refused`).toEqual([]);
    }
  });

  it('has every local file each variant points at', () => {
    for (const id of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'item.json')))) {
      const item = JSON.parse(fs.readFileSync(path.join(dir, id, 'item.json'), 'utf8')) as Item;
      for (const v of item.variants) {
        for (const b of v.blocks as { src?: string; href?: string }[]) {
          const local = [b.src, b.href].find((x) => x && !/^[a-z][a-z0-9+.-]*:/i.test(x));
          if (local) expect(fs.existsSync(path.join(dir, id, local)), `fixtures/${id}/${local}`).toBe(true);
        }
      }
    }
  });
});

// ── the source itself ──────────────────────────────────────────────────────
describe('the source', () => {
  it('contains no raw NUL byte, which would make a file read as binary', () => {
    // store.ts used a literal NUL as a sort-key separator, so grep, ripgrep,
    // diff and GitHub's viewer all treated the file as binary and silently
    // returned nothing for every search in it. The escape compiles the same.
    for (const f of fs.readdirSync('src').filter((n) => n.endsWith('.ts'))) {
      expect(fs.readFileSync(path.join('src', f)).includes(0), `src/${f}`).toBe(false);
    }
  });
});

// ── the rule-quality check, in both places it lives ────────────────────────
// Reported from a real first use in another repo: "they both look the same?
// can you please review" was accepted as a verdict and became rule 1 of that
// canon, injected into AGENTS.md. It is not a weak rule — it is not a rule.
describe('what cannot become a rule', () => {
  const notRules = [
    'they both look the same? can you please review',
    'can you please review this',
    'why do these look identical?',
    'which one is better',
    'review this again',
    'should we use the blue one',
  ];
  // Phrasings that must keep working. A warning that fires on a good rule
  // teaches people to click past warnings, which is how the sharpen step
  // failed the first time.
  const realRules = [
    'do not centre the hero',
    'when the list is empty, say what to do next',
    'where a form fits on one screen, keep it there',
    'use the shorter label on primary buttons',
    'never centre the hero',
    'buttons say what happens, never "Submit"',
    'always ask before adding a dependency',
    'error copy names the next action, not the failure',
    'prefer the quieter of two options',
  ];

  it('refuses a question', () => {
    for (const t of notRules) expect(weakness(t), t).not.toBeNull();
  });

  it('does not fire on rules people actually write', () => {
    for (const t of realRules) expect(weakness(t), t).toBeNull();
  });

  it('agrees with the copy of itself that runs in the page', () => {
    // The check exists twice: once here and once inside the page document,
    // which has no imports. Fixing only one is invisible exactly where it
    // matters, because the page is where the warning is shown.
    const src = /function weakness\(t\)\{[\s\S]*?\n\}/.exec(PAGE)?.[0];
    expect(src, 'weakness() not found in the page').toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const inPage = new Function(`${src}; return weakness;`)() as (t: string) => string | null;
    for (const t of [...notRules, ...realRules, '', 'short', 'I think go with the flow', 'option A is nicer']) {
      expect(inPage(t), `page and rules.ts disagree on ${JSON.stringify(t)}`).toEqual(weakness(t));
    }
  });
});

// ── taking it back ─────────────────────────────────────────────────────────
describe('undo', () => {
  const BIN = path.join(process.cwd(), 'bin', 'stet.js');
  const run = (args: string[]) => spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });

  const decide = (id: string) => {
    const item = { ...JSON.parse(fs.readFileSync(path.join(root, '.stet/pending', id, 'item.json'), 'utf8')) } as Item;
    const decided = { ...item, verdict: 'A', because: 'the shorter label reads faster', decidedAt: '2026-08-06T10:00:00Z' };
    fs.mkdirSync(path.join(root, '.stet/decided', id), { recursive: true });
    fs.writeFileSync(path.join(root, '.stet/decided', id, 'item.json'), JSON.stringify(decided, null, 2));
    fs.rmSync(path.join(root, '.stet/pending', id), { recursive: true, force: true });
    appendRule(root, decided);
  };

  it('removes the rule and puts the decision back in the queue', () => {
    run(['ask', 'Which label?', 'Save', 'Save to library']);
    decide('which-label');
    expect(readRules(root).some((r) => r.from === 'which-label')).toBe(true);

    const r = run(['undo']);
    expect(r.status, r.stderr).toBe(0);
    expect(readRules(root).some((r2) => r2.from === 'which-label')).toBe(false);
    expect(fs.existsSync(path.join(root, '.stet/pending/which-label'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.stet/decided/which-label'))).toBe(false);
  });

  it('drops the verdict but keeps everything there was to judge', () => {
    run(['ask', 'Which copy?', 'Done', 'All set']);
    decide('which-copy');
    run(['undo', 'which-copy']);
    const back = JSON.parse(fs.readFileSync(path.join(root, '.stet/pending/which-copy/item.json'), 'utf8')) as Item;
    expect(back.verdict).toBeUndefined();
    expect(back.because).toBeUndefined();
    expect(back.variants).toHaveLength(2);
    expect(back.map).toBeTruthy();
  });

  it('removes a rule by number without renumbering the rest', () => {
    // Renumbering would silently repoint every reference that already exists —
    // the per-session record of what an agent has been shown, and anything a
    // human wrote down.
    run(['rule', 'never centre the hero']);
    run(['rule', 'buttons name the action']);
    run(['rule', 'error copy names the next action']);
    expect(run(['rule', 'remove', '2']).status).toBe(0);
    expect(readRules(root).map((r) => r.n)).toEqual([1, 3]);
    expect(readRules(root).map((r) => r.text)).toEqual(['never centre the hero', 'error copy names the next action']);
  });

  it('says so rather than pretending when there is no such rule', () => {
    const r = run(['rule', 'remove', '99']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no rule 99/);
  });
});

// ── two variants that are the same variant ─────────────────────────────────
describe('nothing to choose between', () => {
  it('refuses variants with identical content', () => {
    expect(problems({
      id: 'same', question: 'Which toast?',
      map: { A: 'first', B: 'second' },
      variants: [
        { label: 'A', blocks: [{ kind: 'text', text: 'Saved.' }] },
        { label: 'B', blocks: [{ kind: 'text', text: 'Saved.' }] },
      ],
    }).join(' ')).toMatch(/identical/);
  });

  it('catches the same file captured twice under two names', () => {
    // The likeliest way an agent produces a non-decision: capture both
    // variants, but the second capture never changed anything.
    fs.writeFileSync(path.join(root, 'a.png'), 'IDENTICAL BYTES');
    fs.writeFileSync(path.join(root, 'b.png'), 'IDENTICAL BYTES');
    expect(problems({
      id: 'shot', question: 'Which spacing?',
      map: { A: 'tight', B: 'loose' },
      variants: [
        { label: 'A', blocks: [{ kind: 'image', src: 'a.png' }] },
        { label: 'B', blocks: [{ kind: 'image', src: 'b.png' }] },
      ],
    }, { from: root }).join(' ')).toMatch(/identical/);
  });

  it('allows variants that genuinely differ', () => {
    expect(problems({
      id: 'diff', question: 'Which toast?',
      map: { A: 'long', B: 'short' },
      variants: [
        { label: 'A', blocks: [{ kind: 'text', text: 'Saved to your library' }] },
        { label: 'B', blocks: [{ kind: 'text', text: 'Saved' }] },
      ],
    })).toEqual([]);
  });
});

// ── commands the help advertises ───────────────────────────────────────────
describe('the help', () => {
  const BIN = path.join(process.cwd(), 'bin', 'stet.js');
  it('advertises no command that does not exist', () => {
    // `stet serve` was listed in the help line and answered "unknown command",
    // which is the papercut that makes a tool feel broken before it has done
    // anything wrong.
    const help = spawnSync('node', [BIN, 'help'], { encoding: 'utf8' }).stdout.replace(/\x1b\[[0-9;]*m/g, '');
    const advertised = [...help.matchAll(/^\s{2}stet (\w+)/gm)].map((m) => m[1]);
    expect(advertised.length).toBeGreaterThan(5);
    for (const cmd of new Set(advertised)) {
      const r = spawnSync('node', [BIN, cmd, '--help'], { cwd: root, encoding: 'utf8', timeout: 8000 });
      expect(r.stderr, `stet ${cmd} is advertised but not a command`).not.toMatch(/unknown command/);
    }
  });
});

// ── the provenance line ────────────────────────────────────────────────────
// Scoped rules are the mechanism this whole tool is built on, and the scope
// survives only as text in RULES.md. The parser read a field with `[^.]*` —
// stopping at the first full stop — and captured the tail with a pattern that
// treated `**/` as the end of the line. Both are in almost every real glob.
describe('globs survive the round trip', () => {
  const shapes: Array<[string, string[]]> = [
    ['a file with an extension', ['package.json']],
    ['a dotted directory', ['.github/workflows/**']],
    ['a star-dot glob', ['**/*.test.*']],
    ['the common one', ['src/**/*.tsx']],
    ['several, mixed', ['test/**', '**/*.spec.*', 'package.json']],
    ['no dots at all — the shape that always worked', ['src/web/**']],
  ];

  for (const [label, globs] of shapes) {
    it(`reads back ${label}`, () => {
      appendDirectRule(root, `a rule scoped to ${label}`, { globs, tags: ['design'] });
      const rule = readRules(root).at(-1);
      expect(rule?.globs, `written: ${globs.join(', ')}`).toEqual(globs);
      expect(rule?.tags).toEqual(['design']);
    });
  }

  it('still reads tags and hits when the globs are full of dots', () => {
    const md = '# Rules\n\n## 1 — a rule\n\n*Earned from x, 2026-08-06. Tags: ui, forms. Globs: src/**/*.tsx. Hits: 4.*\n';
    const r = parseRules(md)[0];
    expect(r.globs).toEqual(['src/**/*.tsx']);
    expect(r.tags).toEqual(['ui', 'forms']);
    expect(r.hits).toBe(4);
  });

  it('a rule whose scope was mangled would silently govern nothing', () => {
    // The failure mode, stated: `Globs: package.json, .github/**` parsed as the
    // single glob `package`, which matches a file literally named "package".
    // Nothing reports a rule that never matches — it simply never arrives.
    appendDirectRule(root, 'test the artifact you ship', { globs: ['package.json'] });
    const rule = readRules(root).at(-1)!;
    expect(matchesAny(rule.globs, 'package.json')).toBe(true);
    expect(matchesAny(rule.globs, 'package')).toBe(false);
  });
});

// ── the method canon ───────────────────────────────────────────────────────
describe('the method canon', () => {
  const BIN = path.join(process.cwd(), 'bin', 'stet.js');
  const run = (args: string[]) => spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });

  it('would not be flagged by the quality check it ships with', () => {
    // A canon that fails its own gate is not a canon.
    for (const r of METHOD) expect(weakness(r.text), r.text).toBeNull();
  });

  it('carries the failure each rule was earned from', () => {
    for (const r of METHOD) expect(r.note.length, r.text).toBeGreaterThan(40);
  });

  it('is never installed without being asked for', () => {
    // A canon is a claim about what a repository believes. Filling one with
    // claims its owner never made is what stet refuses to do everywhere else.
    expect(readRules(root)).toEqual([]);
    expect(run(['method', '--list']).status).toBe(0);
    expect(readRules(root), '--list must not write').toEqual([]);
  });

  it('installs, and adds nothing the second time', () => {
    expect(run(['method']).status).toBe(0);
    expect(readRules(root)).toHaveLength(METHOD.length);
    run(['method']);
    expect(readRules(root)).toHaveLength(METHOD.length);
  });

  it('keeps the scopes it claims, which is the whole point of shipping them', () => {
    run(['method']);
    const scoped = readRules(root).filter((r) => r.globs.length);
    expect(scoped.length).toBeGreaterThan(0);
    for (const r of scoped) {
      for (const g of r.globs) expect(g, `${r.text} lost its scope`).not.toBe('');
    }
    const tests = readRules(root).find((r) => r.text.includes('reproduction as a permanent check'));
    expect(matchesAny(tests!.globs, 'test/thing.test.ts')).toBe(true);
    expect(matchesAny(tests!.globs, 'src/index.ts')).toBe(false);
  });
});

// ── editing a rule after the moment has passed ─────────────────────────────
describe('sharpening a rule later', () => {
  const BIN = path.join(process.cwd(), 'bin', 'stet.js');
  const run = (args: string[]) => spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });

  it('rewrites the line and leaves the provenance alone', () => {
    // Sharpening was reachable only from the page, in the seconds after a
    // reveal. A rule whose wording goes stale a week later could then only be
    // deleted or hand-edited — the same answer that made `undo` necessary.
    run(['rule', 'go with the flow here', '--globs', 'src/page.ts', '--tag', 'ui']);
    expect(run(['rule', 'edit', '1', 'the sharpen field takes focus when the reveal lands']).status).toBe(0);
    const rule = readRules(root)[0];
    expect(rule.text).toBe('the sharpen field takes focus when the reveal lands');
    expect(rule.globs, 'scope must survive an edit').toEqual(['src/page.ts']);
    expect(rule.tags).toEqual(['ui']);
  });

  it('says so rather than pretending when the rule is not there', () => {
    const r = run(['rule', 'edit', '42', 'something']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no rule 42/);
  });

  it('warns when the sharper wording is still not a rule', () => {
    run(['rule', 'never centre the hero', '--globs', 'src/**']);
    const r = run(['rule', 'edit', '1', 'why does this keep happening?']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/question/);
  });
});

// ── code nothing reaches ───────────────────────────────────────────────────
describe('the source has no dead ends', () => {
  it('exports no function or constant that nothing references', () => {
    // `restatesOption` sat here exported and uncalled for two releases —
    // written alongside a real fix, then never wired up. Same species as a hook
    // implemented and never installed, which is finding 40.
    //
    // Types are exempt: an exported interface used only as an inferred return
    // type has no textual reference, and demanding one would be a warning that
    // fires on correct code.
    const dir = (d: string) =>
      fs.readdirSync(d).filter((f) => /\.(ts|mjs)$/.test(f)).map((f) => [path.join(d, f), fs.readFileSync(path.join(d, f), 'utf8')] as const);
    const src = dir('src');
    const all = [...src, ...dir('test')];

    const dead: string[] = [];
    for (const [file, text] of src) {
      for (const m of text.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)) {
        const name = m[1];
        let uses = 0;
        for (const [f2, t2] of all) {
          for (const hit of t2.matchAll(new RegExp(`\\b${name}\\b`, 'g'))) {
            const line = t2.slice(t2.lastIndexOf('\n', hit.index) + 1, t2.indexOf('\n', hit.index));
            if (f2 === file && /^export (async )?(function|const) /.test(line)) continue;
            uses++;
          }
        }
        if (uses === 0) dead.push(`${file} → ${name}`);
      }
    }
    expect(dead, 'exported and never referenced').toEqual([]);
  });
});

// ── when the wiring becomes live ───────────────────────────────────────────
// Claude Code snapshots hooks at session start, deliberately, so settings
// cannot be swapped underneath a running session. Nothing stet writes is live
// until a session begins after it — and stet never said so, which leaves people
// wiring from inside a running session, seeing no gate, and concluding it does
// not work.
describe('telling people when the gate starts working', () => {
  const BIN = path.join(process.cwd(), 'bin', 'stet.js');
  const run = (args: string[]) => spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  it('says it at the moment of wiring, and distinguishes the two cases', () => {
    const outp = plain(run(['claude', '--command', 'stet']).stdout);
    expect(outp).toMatch(/not live yet/);
    // A fresh folder needs a start, not a restart. Telling everyone to restart
    // sends people to fix something that is not broken.
    expect(outp).toMatch(/first time\? nothing to do/);
    expect(outp).toMatch(/already have one open.*claude.*again/);
  });

  it('keeps saying it in status until a hook has actually been called', () => {
    run(['claude', '--command', 'stet']);
    expect(plain(run(['status']).stdout)).toMatch(/no hook has ever been called/);
  });

  it('stops saying it once one has', () => {
    run(['claude', '--command', 'stet']);
    runHook(root, 'session-start', { session_id: 'live', cwd: root });
    expect(plain(run(['status']).stdout)).not.toMatch(/no hook has ever been called/);
  });

  it('says nothing about it in a project that was never wired', () => {
    expect(plain(run(['status']).stdout)).not.toMatch(/no hook has ever been called/);
  });
});

// ── a decision that announces its own answer ───────────────────────────────
// Found the first time a stranger's agent queued a real decision, in a fresh
// project. Labels shuffled correctly, map withheld correctly — and variant A
// read "Warm apricot #D98E63 (current)" while the question said "I picked warm
// apricot". Every mechanism for keeping the judgement honest was defeated by a
// parenthesis.
describe('the blind test, defeated by its own content', () => {
  const item = (question: string, texts: string[]) => ({
    id: 'x', question,
    map: Object.fromEntries(texts.map((t, i) => [String.fromCharCode(65 + i), `v${i}`])),
    variants: texts.map((t, i) => ({ label: String.fromCharCode(65 + i), blocks: [{ kind: 'text', text: t }] })),
  });
  const tell = (it: unknown) => problems(it).filter((p) => /tells the human|names your own/.test(p));

  it('refuses a variant that marks itself as the current one', () => {
    expect(tell(item('Which accent?', ['Apricot (current)', 'Blue']))).toHaveLength(1);
    expect(tell(item('Which?', ['Apricot (existing)', 'Blue']))).toHaveLength(1);
  });

  it('refuses a question that names the agent\'s own pick', () => {
    expect(tell(item('I picked apricot. Which do you want?', ['Apricot', 'Blue']))).toHaveLength(1);
  });

  it('refuses a variant that claims to be the recommendation', () => {
    expect(tell(item('Which?', ['Apricot — my pick', 'Blue']))).toHaveLength(1);
  });

  it('does not fire on ordinary product copy', () => {
    // "Buy now" is this project's own worked example; a bare "currently" or
    // "now" is what real interface copy says. A check that fires on real copy
    // is one people learn to route around.
    for (const it of [
      item('Which label?', ['Buy now', 'Get started']),
      item('Which error copy?', ['Your payment is currently processing', 'We could not take that payment']),
      item('Which empty state?', ['Nothing here yet', 'Start your first project now']),
      item('Which palette?', ['Original Bauhaus red', 'Muted brick']),
    ]) expect(tell(it), JSON.stringify(it.variants[0])).toHaveLength(0);
  });
});
