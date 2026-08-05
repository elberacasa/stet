import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addItem, blind, decide, describeProblem, init, listEntries, readEntry, revealText, shuffleLabels, assetPath } from '../src/store.js';
import { appendRule, appendDirectRule, bumpHits, estimateTokens, parseRules, readRules, renderBlock, reviseRule, ruleLine, selectRules, weakness } from '../src/rules.js';
import { hasBlock, insert, remove, sync, unsync } from '../src/sync.js';
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
