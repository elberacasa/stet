// stet — writing into other people's files. Marker-delimited, idempotent, and
// removable byte for byte. The markers carry the whitespace we inserted so
// `--remove` can put the file back exactly as it was.

import fs from 'node:fs';
import path from 'node:path';
import type { Rule, Surface } from './types.js';
import { writeAtomic } from './lock.js';
import { DEFAULT_BUDGET, renderBlock, selectRules } from './rules.js';

const BEGIN_RE = /<!-- stet:begin([^>]*)-->/;
const END = '<!-- stet:end -->';

export interface SyncResult {
  path: string;
  agent: string;
  action: 'created' | 'updated' | 'unchanged' | 'removed' | 'deleted' | 'absent';
  rules: number;
  heldBack: number;
  tokens: number;
}

/** Surfaces that exist, plus AGENTS.md, which we always write. */
export function findSurfaces(root: string): Surface[] {
  const out: Surface[] = [{ path: 'AGENTS.md', agent: 'vendor-neutral (Claude Code, Kimi Code, Codex…)', always: true }];
  const optional: Array<[string, string]> = [
    ['CLAUDE.md', 'Claude Code'],
    ['.cursorrules', 'Cursor'],
    ['.github/copilot-instructions.md', 'Copilot'],
    ['.windsurfrules', 'Windsurf'],
  ];
  for (const [p, agent] of optional) {
    if (fs.existsSync(path.join(root, p))) out.push({ path: p, agent });
  }
  const cursorDir = path.join(root, '.cursor', 'rules');
  if (fs.existsSync(cursorDir)) {
    for (const f of fs.readdirSync(cursorDir).sort()) {
      if (f.endsWith('.mdc')) out.push({ path: path.join('.cursor', 'rules', f), agent: 'Cursor' });
    }
  }
  return out;
}

/** A .mdc rule file can be scoped to globs; only relevant rules go in it. */
function scopeOf(root: string, surface: Surface): 'repo' | string[] {
  if (!surface.path.endsWith('.mdc')) return 'repo';
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, surface.path), 'utf8');
  } catch {
    return 'repo';
  }
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fm) return 'repo';
  const line = /^globs:\s*(.+)$/m.exec(fm[1]);
  if (!line) return 'repo';
  const globs = line[1]
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return globs.length ? globs : 'repo';
}

export interface SyncOpts {
  budget?: number;
  tags?: string[];
  dryRun?: boolean;
}

export function sync(root: string, rules: Rule[], opts: SyncOpts = {}): SyncResult[] {
  const results: SyncResult[] = [];
  for (const surface of findSurfaces(root)) {
    const sel = selectRules(rules, {
      budget: opts.budget ?? DEFAULT_BUDGET,
      tags: opts.tags,
      scope: scopeOf(root, surface),
    });
    const block = renderBlock(sel);
    const file = path.join(root, surface.path);
    const existed = fs.existsSync(file);
    const before = existed ? fs.readFileSync(file, 'utf8') : null;
    const next = insert(before, block);
    let action: SyncResult['action'];
    if (before === null) action = 'created';
    else if (before === next) action = 'unchanged';
    else action = 'updated';
    if (!opts.dryRun && action !== 'unchanged') {
      // Atomic: an agent reading AGENTS.md mid-write would otherwise see a
      // truncated canon and treat it as the whole thing.
      writeAtomic(file, next);
    }
    results.push({ path: surface.path, agent: surface.agent, action, rules: sel.chosen.length, heldBack: sel.heldBack, tokens: sel.tokens });
  }
  return results;
}

export function unsync(root: string, opts: { dryRun?: boolean } = {}): SyncResult[] {
  const results: SyncResult[] = [];
  for (const surface of findSurfaces(root)) {
    const file = path.join(root, surface.path);
    if (!fs.existsSync(file)) {
      results.push({ path: surface.path, agent: surface.agent, action: 'absent', rules: 0, heldBack: 0, tokens: 0 });
      continue;
    }
    const before = fs.readFileSync(file, 'utf8');
    const { text, owned, changed } = remove(before);
    let action: SyncResult['action'] = 'unchanged';
    if (owned) {
      action = 'deleted';
      if (!opts.dryRun) fs.rmSync(file);
    } else if (changed) {
      action = 'removed';
      if (!opts.dryRun) fs.writeFileSync(file, text);
    }
    results.push({ path: surface.path, agent: surface.agent, action, rules: 0, heldBack: 0, tokens: 0 });
  }
  return results;
}

function marker(pad: number, tail: number, own: boolean): string {
  return `<!-- stet:begin pad=${pad} tail=${tail}${own ? ' own=1' : ''} -->`;
}

/** Adds or replaces our block. Everything outside the markers is untouched. */
export function insert(content: string | null, block: string): string {
  if (content === null) {
    return `${marker(0, 0, true)}\n${block}\n${END}\n`;
  }
  const found = locate(content);
  if (found) {
    const head = content.slice(0, found.start);
    const tailText = content.slice(found.end);
    return `${head}${marker(found.pad, found.tail, found.own)}\n${block}\n${END}${tailText}`;
  }
  // tail=1 so --remove strips the newline we are about to add and leaves the
  // empty file empty.
  if (!content.length) return `${marker(0, 1, false)}\n${block}\n${END}\n`;
  const pad = content.endsWith('\n\n') ? 0 : content.endsWith('\n') ? 1 : 2;
  return `${content}${'\n'.repeat(pad)}${marker(pad, 1, false)}\n${block}\n${END}${'\n'}`;
}

/** Removes every block we own, along with exactly the whitespace we inserted. */
export function remove(content: string): { text: string; owned: boolean; changed: boolean } {
  let text = content;
  let owned = false;
  let changed = false;
  for (;;) {
    const found = locate(text);
    if (!found) break;
    changed = true;
    if (found.own) owned = true;
    let from = found.start;
    for (let i = 0; i < found.pad && from > 0 && text[from - 1] === '\n'; i++) from--;
    let to = found.end;
    for (let i = 0; i < found.tail && text[to] === '\n'; i++) to++;
    text = text.slice(0, from) + text.slice(to);
  }
  return { text, owned: owned && text.trim() === '', changed };
}

export function hasBlock(content: string): boolean {
  return locate(content) !== null;
}

function locate(content: string): { start: number; end: number; pad: number; tail: number; own: boolean } | null {
  const m = BEGIN_RE.exec(content);
  if (!m) return null;
  const start = m.index;
  const endIdx = content.indexOf(END, start);
  if (endIdx === -1) return null;
  const attrs = m[1];
  return {
    start,
    end: endIdx + END.length,
    pad: Number(/pad=(\d+)/.exec(attrs)?.[1] ?? 0),
    tail: Number(/tail=(\d+)/.exec(attrs)?.[1] ?? 0),
    own: /own=1/.test(attrs),
  };
}
