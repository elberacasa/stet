// stet — the store. Everything on disk lives under .stet/ and is plain files.

import fs from 'node:fs';
import path from 'node:path';
import { assertItem } from './validate.js';
import type { BlindItem, Entry, Item, Variant } from './types.js';

export const DIRNAME = '.stet';

export interface Paths {
  root: string;
  stet: string;
  pending: string;
  decided: string;
  rules: string;
  /** What working here taught, as opposed to what its owner decided. */
  notes: string;
}

/** Nearest ancestor holding a .stet/, else cwd. */
export function findRoot(cwd = process.cwd()): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, DIRNAME))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(cwd);
    dir = up;
  }
}

export function paths(root: string): Paths {
  const stet = path.join(root, DIRNAME);
  return {
    root,
    stet,
    pending: path.join(stet, 'pending'),
    decided: path.join(stet, 'decided'),
    rules: path.join(stet, 'RULES.md'),
    notes: path.join(stet, 'NOTES.md'),
  };
}

/** Creates .stet/ if absent. Returns true when it did the creating. */
export function init(root: string): boolean {
  const p = paths(root);
  const fresh = !fs.existsSync(p.stet);
  fs.mkdirSync(p.pending, { recursive: true });
  fs.mkdirSync(p.decided, { recursive: true });
  // The canon and the decided items are the product and belong in the repo.
  // The session journals next to them are per-developer, machine-specific, and
  // rewritten on every tool call — 25 of them against one RULES.md after a day
  // of work, each one a merge conflict waiting to happen and noise on top of
  // the thing that is actually worth sharing.
  const ignore = path.join(p.stet, '.gitignore');
  if (!fs.existsSync(ignore)) {
    fs.writeFileSync(
      ignore,
      [
        '# Per-developer state, not shared taste.',
        '# Everything else here — RULES.md and decided/ — is the point, and belongs in the repo.',
        'sessions/',
        '*.lock',
        '',
      ].join('\n'),
    );
  }
  if (!fs.existsSync(p.rules)) {
    fs.writeFileSync(
      p.rules,
      '# Rules\n\nEarned one at a time, by a human, in this repository.\nEach rule is binding on every agent that touches this repo.\n',
    );
  }
  return fresh;
}

const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validId(id: unknown): id is string {
  return typeof id === 'string' && ID_OK.test(id) && id !== '.' && id !== '..';
}

/** Parses one item directory. Broken items come back as entries, never as nothing. */
export function readEntry(dir: string, state: 'pending' | 'decided'): Entry {
  const id = path.basename(dir);
  const file = path.join(dir, 'item.json');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, id, dir, state, error: 'no item.json in this directory' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, id, dir, state, error: `item.json is not valid JSON — ${(err as Error).message}` };
  }
  const problem = describeProblem(parsed);
  if (problem) return { ok: false, id, dir, state, error: problem };
  const item = parsed as Item;
  if (item.id !== id) return { ok: false, id, dir, state, error: `item.json says id "${item.id}" but it lives in ${id}/` };
  return { ok: true, id, dir, state, item };
}

/** Returns a human sentence when the object cannot be judged, else null. */
export function describeProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'item.json is not an object';
  const o = v as Record<string, unknown>;
  if (!validId(o.id)) return 'missing or unusable "id" (letters, digits, . _ - only)';
  if (typeof o.question !== 'string' || !o.question.trim()) return 'missing "question"';
  // One variant is legal: that is an acceptance gate ("is this good enough?"),
  // the same shape as a comparison with nothing to compare against.
  if (!Array.isArray(o.variants) || o.variants.length < 1) return 'needs at least one variant';
  for (const v2 of o.variants as Variant[]) {
    if (!v2 || typeof v2.label !== 'string' || !v2.label) return 'every variant needs a "label"';
    if (!Array.isArray(v2.blocks)) return `variant ${v2.label} has no "blocks" array`;
  }
  if (!o.map || typeof o.map !== 'object' || Array.isArray(o.map)) return 'missing "map" — the blind test needs it';
  const labels = (o.variants as Variant[]).map((x) => x.label);
  for (const l of labels) {
    if (typeof (o.map as Record<string, unknown>)[l] !== 'string') return `"map" has no entry for variant ${l}`;
  }
  return null;
}

export function listEntries(root: string, state: 'pending' | 'decided'): Entry[] {
  const dir = state === 'pending' ? paths(root).pending : paths(root).decided;
  let names: string[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const entries = names.map((n) => readEntry(path.join(dir, n), state));
  entries.sort((a, b) => key(a).localeCompare(key(b)));
  if (state === 'decided') entries.reverse(); // newest decision first
  return entries;
}

function key(e: Entry): string {
  if (!e.ok) return `￿${e.id}`; // broken items sink to the end of pending
  return `${(e.state === 'decided' ? e.item.decidedAt : e.item.created) ?? ''}\u0000${e.id}`;
}

export function findEntry(root: string, id: string): Entry | null {
  if (!validId(id)) return null;
  const p = paths(root);
  for (const [state, dir] of [['pending', p.pending], ['decided', p.decided]] as const) {
    const d = path.join(dir, id);
    if (fs.existsSync(d)) return readEntry(d, state);
  }
  return null;
}

/** Strips `map`. This is the only shape the page is ever handed. */
export function blind(item: Item): BlindItem {
  const { map, ...rest } = item;
  void map;
  return rest;
}

/**
 * Assigns labels to variants at random, keeping each variant tied to its own
 * map entry. The agent's ordering carries its preference; this removes it.
 */
export function shuffleLabels(item: Item, rand: () => number = Math.random): Item {
  const labels = item.variants.map((v) => v.label);
  const order = item.variants.map((v, i) => ({ v, was: labels[i] }));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const map: Record<string, string> = {};
  const variants = order.map((o, i) => {
    map[labels[i]] = item.map[o.was];
    return { ...o.v, label: labels[i] };
  });
  return { ...item, variants, map };
}

/** Writes a new pending item. Assets referenced from cwd are copied in beside it. */
export function addItem(root: string, input: Item, opts: { shuffle?: boolean; from?: string } = {}): string {
  // Before anything is written. An agent authored this, and a bad item used to
  // fail with a TypeError naming an internal property, or queue successfully
  // and render a decision the human could not act on.
  assertItem(input, { from: opts.from ?? process.cwd() });
  init(root);
  const p = paths(root);
  const dir = path.join(p.pending, input.id);
  if (fs.existsSync(path.join(p.decided, input.id))) {
    throw new Error(`a decision with id "${input.id}" already exists`);
  }
  let item: Item = { ...input, created: input.created || new Date().toISOString() };
  if (opts.shuffle !== false) item = shuffleLabels(item);
  // Claim the id by creating the directory itself, not by asking whether it
  // exists first: two agents queueing the same id in the same instant both
  // pass an existsSync check, and the loser silently overwrites the winner.
  // mkdir without `recursive` fails with EEXIST, atomically.
  fs.mkdirSync(p.pending, { recursive: true });
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`a decision with id "${input.id}" already exists`);
    }
    throw err;
  }
  // Named after the shuffled label, not the source file. `stripe-shape.png`
  // reaching the page as an <img src> would hand the human the mapping the
  // blind test exists to hide — and the filename is visible in devtools.
  let n = 0;
  item = {
    ...item,
    variants: item.variants.map((v) => ({
      ...v,
      blocks: v.blocks.map((b) => absorbAsset(b, dir, opts.from ?? process.cwd(), `${v.label}-${++n}`)),
    })),
  };
  fs.writeFileSync(path.join(dir, 'item.json'), JSON.stringify(item, null, 2) + '\n');
  return dir;
}

/**
 * image/audio srcs that point at a real file get copied next to item.json,
 * under a name derived from the shuffled label so the filename cannot leak
 * which variant is which.
 */
/** Which field each block kind keeps its local file in. */
const ASSET_FIELD: Record<string, 'src' | 'href'> = { image: 'src', audio: 'src', url: 'href' };

/**
 * Copies a variant's local file into the decision's own directory, named after
 * the label it was shuffled into.
 *
 * Both halves matter. Without the copy the file is not there to serve and the
 * variant renders as nothing. Without the rename the filename is the answer:
 * `hero-serif.html` in the A column tells the human what the blind test exists
 * to hide, and it is visible in devtools whatever the page chooses to display.
 *
 * `url` was excluded from this for as long as it existed, which made it the one
 * kind that both failed to load from a relative path and leaked its own name —
 * and it is the kind the one-line ask reaches for first.
 */
function absorbAsset<T extends { kind: string; src?: string; href?: string }>(
  block: T,
  dir: string,
  from: string,
  name: string,
): T {
  const field = ASSET_FIELD[block.kind];
  if (!field) return block;
  const value = block[field];
  // Anything with a scheme, a host, or a query is somewhere else's to serve.
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value) || /[?#]/.test(value)) return block;
  const candidate = path.resolve(from, value);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return block;
  const target = `${name}${path.extname(candidate).toLowerCase()}`;
  const full = path.join(dir, target);
  if (path.resolve(full) !== candidate) fs.copyFileSync(candidate, full);
  return { ...block, [field]: target } as T;
}

export interface Decision {
  verdict: string;
  because: string;
  rule: string;
  revealed: string;
  decidedAt?: string;
}

/** Records the verdict and moves the whole directory, assets and all. */
export function decide(root: string, id: string, d: Decision): Item {
  const p = paths(root);
  const dir = path.join(p.pending, id);
  const entry = readEntry(dir, 'pending');
  if (!entry.ok) throw new Error(entry.error);
  const item: Item = {
    ...entry.item,
    verdict: d.verdict,
    because: d.because,
    rule: d.rule,
    revealed: d.revealed,
    decidedAt: d.decidedAt || new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'item.json'), JSON.stringify(item, null, 2) + '\n');
  fs.mkdirSync(p.decided, { recursive: true });
  fs.renameSync(dir, path.join(p.decided, id));
  return item;
}

/** Renders the reveal sentence: what each label actually was. */
export function revealText(item: Item): string {
  return item.variants.map((v) => `${v.label} = ${item.map[v.label]}`).join(', ');
}

/** Resolves an asset request, refusing anything that escapes the item directory. */
export function assetPath(root: string, id: string, rel: string): string | null {
  if (!validId(id)) return null;
  const p = paths(root);
  for (const base of [path.join(p.pending, id), path.join(p.decided, id)]) {
    const full = path.resolve(base, rel);
    if (!full.startsWith(path.resolve(base) + path.sep)) return null;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

/**
 * Puts a decided item back in the queue, undoing the verdict.
 *
 * The whole pitch is that the canon is binding, which makes a wrong entry in it
 * expensive: the first thing it does is start governing agents. Before this
 * existed the only way out was to delete a directory and hand-edit RULES.md,
 * which is a bad answer for a file the tool tells you to treat as sacred.
 *
 * The verdict, the reason and the reveal are dropped. The variants, the map and
 * every asset stay exactly as they were, so the decision can be judged again —
 * though not blind, since whoever is undoing it has already seen the reveal.
 */
export function undecide(root: string, id: string): Item {
  const p = paths(root);
  const from = path.join(p.decided, id);
  const to = path.join(p.pending, id);
  const entry = readEntry(from, 'decided');
  if (!entry.ok) throw new Error(`${id} cannot be read: ${entry.error}`);
  if (fs.existsSync(to)) throw new Error(`${id} is already pending — nothing to undo`);

  const { verdict, because, decidedAt, revealed, ...rest } = entry.item as Item & Record<string, unknown>;
  void verdict;
  void because;
  void decidedAt;
  void revealed;

  fs.mkdirSync(p.pending, { recursive: true });
  fs.renameSync(from, to);
  fs.writeFileSync(path.join(to, 'item.json'), JSON.stringify(rest, null, 2) + '\n');
  return rest as Item;
}

/**
 * Discards a pending decision, and everything queued with it.
 *
 * A decision that should not have been asked had no exit. `undo` walks a
 * *decided* item back to the queue; there was nothing for one that never should
 * have entered it — and a pending decision is not inert, it denies writes to
 * every path it claims. So a badly-worded question left the work blocked with
 * no way out except deleting a directory by hand, which is the answer that made
 * `undo` necessary in the first place.
 */
export function drop(root: string, id: string): Item {
  const dir = path.join(paths(root).pending, id);
  const entry = readEntry(dir, 'pending');
  if (!entry.ok) throw new Error(`${id} is not a pending decision: ${entry.error}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return entry.item;
}

/** The most recently decided item, or null. */
export function lastDecided(root: string): Item | null {
  const decided = listEntries(root, 'decided').filter((e) => e.ok);
  return decided.length ? (decided[0].ok ? decided[0].item : null) : null;
}
