// stet — the rulebook. RULES.md is the source of truth: human-readable,
// human-editable, parsed back out for injection. No second copy anywhere.

import fs from 'node:fs';
import type { Item, Rule } from './types.js';
import { paths } from './store.js';

export const HEADER = `# Rules

Earned one at a time, by a human, in this repository.
Each rule is binding on every agent that touches this repo.
`;

/** The one line that gets injected: the first line the human wrote. */
export function ruleLine(because: string): string {
  const first = because.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return first.replace(/\s+/g, ' ').trim();
}

export function readRules(root: string): Rule[] {
  const file = paths(root).rules;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return parseRules(text);
}

export function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  const parts = text.split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const rest = nl === -1 ? '' : part.slice(nl + 1);
    const m = /^(\d+)\s*[—–-]\s*(.*)$/.exec(heading);
    const n = m ? Number(m[1]) : rules.length + 1;
    const ruleText = (m ? m[2] : heading).trim();
    if (!ruleText) continue;

    const prov = /^\s*\*Earned from ([^,*]+), ([^.*]+)\.((?:[^*]|\*(?!\/))*)\*\s*$/m.exec(rest);
    const tail = prov?.[3] ?? '';
    const tags = list(/Tags:\s*([^.]*)\./.exec(tail)?.[1]);
    const globs = list(/Globs:\s*([^.]*)\./.exec(tail)?.[1]);
    const hits = Number(/Hits:\s*(\d+)/.exec(tail)?.[1] ?? 0);

    const body = rest
      .split('\n')
      .filter((l) => !/^\s*\*Earned from /.test(l))
      .join('\n')
      .trim();

    rules.push({
      n,
      text: ruleText,
      from: prov?.[1]?.trim(),
      earned: prov?.[2]?.trim(),
      tags,
      globs,
      body,
      hits: Number.isFinite(hits) ? hits : 0,
    });
  }
  return rules;
}

function list(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

/** Appends a rule earned from a decided item. Returns the rule as stored. */
export function appendRule(root: string, item: Item): Rule {
  const file = paths(root).rules;
  const existing = readRules(root);
  const n = existing.reduce((m, r) => Math.max(m, r.n), 0) + 1;
  const text = ruleLine(item.because ?? '');
  const date = (item.decidedAt ?? new Date().toISOString()).slice(0, 10);
  const tags = item.tags ?? [];
  const globs = item.globs ?? [];

  let prov = `*Earned from ${item.id}, ${date}.`;
  if (tags.length) prov += ` Tags: ${tags.join(', ')}.`;
  if (globs.length) prov += ` Globs: ${globs.join(', ')}.`;
  prov += '*';

  const rest = (item.because ?? '').split('\n').slice(1).join('\n').trim();
  const asked = `Asked: "${item.question}" — ${verdictSentence(item)}`;

  const entry = `\n## ${n} — ${text}\n\n${prov}\n\n${asked}${rest ? `\n${rest}` : ''}\n`;

  let current = '';
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    current = HEADER;
  }
  if (!current.trim()) current = HEADER;
  fs.writeFileSync(file, current.replace(/\s*$/, '\n') + entry);

  return { n, text, from: item.id, earned: date, tags, globs, body: `${asked}${rest ? `\n${rest}` : ''}`, hits: 0 };
}

/**
 * Marks rules as still relevant. When a decision lands carrying tags, every
 * rule sharing a tag is in an area you are actively working in — that is what
 * "most frequently matched" means in the budget, and without this it would be
 * a claim with nothing behind it. Recorded in the provenance line so the file
 * stays the only source of truth.
 */
export function bumpHits(root: string, tags: string[] | undefined): number {
  const want = new Set((tags ?? []).map((t) => t.toLowerCase()));
  if (!want.size) return 0;
  const file = paths(root).rules;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return 0;
  }
  let bumped = 0;
  const next = text.split(/(?=^## )/m).map((part) => {
    if (!part.startsWith('## ')) return part;
    const rule = parseRules(part)[0];
    if (!rule || !rule.tags.some((t) => want.has(t.toLowerCase()))) return part;
    const hits = rule.hits + 1;
    const rewritten = part.replace(
      /^(\s*\*Earned from [^*]*?)(?:\s*Hits:\s*\d+\.)?\*\s*$/m,
      (_m, head: string) => `${head.replace(/\s*$/, '')} Hits: ${hits}.*`,
    );
    if (rewritten !== part) bumped++;
    return rewritten;
  });
  if (bumped) fs.writeFileSync(file, next.join(''));
  return bumped;
}

/**
 * Rewrites the one line of rule `n` in place, leaving everything else in the
 * file byte-identical. This exists because of the reveal: a blind verdict is
 * given before you know what you chose, so the sharpest wording of the rule is
 * only available a second later. The first version is written immediately so
 * nothing is ever lost if the human walks away.
 */
export function reviseRule(root: string, n: number, text: string): Rule {
  const file = paths(root).rules;
  const line = ruleLine(text);
  if (!line) throw new Error('a rule needs a line of text');
  const current = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`^## ${n}\\s*[—–-]\\s*.*$`, 'm');
  if (!re.test(current)) throw new Error(`no rule ${n} in RULES.md`);
  fs.writeFileSync(file, current.replace(re, `## ${n} — ${line}`));
  const found = readRules(root).find((r) => r.n === n);
  if (!found) throw new Error(`rule ${n} vanished after revision`);
  return found;
}

/**
 * A deterministic, offline quality check — no model call. A rule that names a
 * variant label is unusable by construction: the labels are shuffled per item
 * and mean nothing tomorrow.
 */
export function weakness(text: string): string | null {
  const t = ruleLine(text);
  if (!t) return 'nothing to inject yet';
  if (t.length < 12) return 'too short to mean anything to an agent next week';
  if (/\b(option|variant|version)\s+[ab12]\b|\b[ab]\s+(is|was|looks|reads)\b/i.test(t)) {
    return 'names a variant label — those are shuffled per decision and mean nothing later';
  }
  if (/^(looks?|feels?|seems?|sounds?)\b/i.test(t) && !/\b(so|because|use|keep|never|always|prefer)\b/i.test(t)) {
    return 'reads as a reaction, not an instruction — say what to do next time';
  }
  // "I think go with the flow" passed every check above and told the next
  // agent nothing. A rule written in the first person is a note to yourself.
  if (/^(i\s+(think|guess|feel|like|prefer|would|reckon)|i'?d|maybe|probably|let'?s)\b/i.test(t)) {
    return 'written to yourself, not to an agent — drop the "I" and say what to do';
  }
  return null;
}

/**
 * The third door into the canon: a correction typed straight in, with no
 * decision behind it. `stet rule "never centre the hero"` — for the case where
 * you have already corrected an agent twice and want it to stop.
 */
export function appendDirectRule(root: string, text: string, opts: { tags?: string[]; globs?: string[]; note?: string } = {}): Rule {
  const file = paths(root).rules;
  const existing = readRules(root);
  const n = existing.reduce((m, r) => Math.max(m, r.n), 0) + 1;
  const line = ruleLine(text);
  if (!line) throw new Error('a rule needs a line of text');
  const date = new Date().toISOString().slice(0, 10);
  const tags = opts.tags ?? [];
  const globs = opts.globs ?? [];

  let prov = `*Earned from a correction, ${date}.`;
  if (tags.length) prov += ` Tags: ${tags.join(', ')}.`;
  if (globs.length) prov += ` Globs: ${globs.join(', ')}.`;
  prov += '*';

  const rest = [text.split('\n').slice(1).join('\n').trim(), opts.note?.trim()].filter(Boolean).join('\n');
  const entry = `\n## ${n} — ${line}\n\n${prov}\n${rest ? `\n${rest}\n` : ''}`;

  let current = '';
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    current = HEADER;
  }
  if (!current.trim()) current = HEADER;
  fs.writeFileSync(file, current.replace(/\s*$/, '\n') + entry);

  return { n, text: line, from: 'a correction', earned: date, tags, globs, body: rest, hits: 0 };
}

function verdictSentence(item: Item): string {
  const v = (item.verdict ?? '').trim();
  const labels = item.variants.map((x) => x.label);
  if (labels.includes(v)) {
    const others = labels.filter((l) => l !== v);
    return others.length ? `chose ${v} over ${others.join(' and ')}.` : `chose ${v}.`;
  }
  return `verdict: ${v || '(none)'}.`;
}

// ── Budget ────────────────────────────────────────────────────────────────
//
// An estimate, not a tokenizer: no runtime dependencies, so no BPE tables.
// It is deliberately pessimistic — code and punctuation tokenize worse than
// prose, so we take the larger of a character rate and a word rate.

export function estimateTokens(text: string): number {
  const chars = text.length;
  const words = (text.match(/\S+/g) ?? []).length;
  return Math.max(Math.ceil(chars / 3.6), Math.ceil(words * 1.35));
}

export const DEFAULT_BUDGET = 1500;

export interface Selection {
  chosen: Rule[];
  heldBack: number;
  tokens: number;
}

export interface SelectOpts {
  budget?: number;
  tags?: string[];
  /** Surface scope. A rule with globs only applies where the scope can match. */
  scope?: 'repo' | string[];
}

/**
 * Keeps the most frequently matched, then the most recently earned, until the
 * budget is spent. Never silently truncates — the count comes back with it.
 */
export function selectRules(rules: Rule[], opts: SelectOpts = {}): Selection {
  const budget = opts.budget ?? DEFAULT_BUDGET;
  let pool = rules;
  if (opts.tags?.length) {
    const want = new Set(opts.tags.map((t) => t.toLowerCase()));
    pool = pool.filter((r) => r.tags.some((t) => want.has(t.toLowerCase())));
  }
  if (Array.isArray(opts.scope)) {
    const scope = opts.scope;
    pool = pool.filter((r) => r.globs.length === 0 || r.globs.some((g) => scope.some((s) => globOverlaps(g, s))));
  }

  const ranked = [...pool].sort((a, b) => b.hits - a.hits || b.n - a.n);
  const chosen: Rule[] = [];
  let tokens = estimateTokens(preamble());
  for (const r of ranked) {
    const cost = estimateTokens(renderRule(r) + '\n');
    if (chosen.length && tokens + cost > budget) break;
    tokens += cost;
    chosen.push(r);
  }
  chosen.sort((a, b) => a.n - b.n);
  return { chosen, heldBack: pool.length - chosen.length, tokens };
}

/** Cheap containment test — enough for "does this rule belong in this file". */
function globOverlaps(a: string, b: string): boolean {
  if (a === b) return true;
  const head = (g: string) => g.split(/[*?[]/)[0];
  const ha = head(a);
  const hb = head(b);
  return ha.startsWith(hb) || hb.startsWith(ha);
}

function preamble(): string {
  return [
    'STET RULES — verdicts this repo\'s owner already gave. They are binding.',
    'Follow them without asking again. Hitting a preference fork with no rule',
    'here is the one time to stop and ask — run `stet schema` to see how.',
    // The wiring is per-developer, so nothing checked in can tell a teammate
    // it is missing. This line can, and it costs about twenty tokens once.
    'If `stet claude status` says unwired, tell the human to run `stet claude`.',
  ].join('\n');
}

export function renderRule(r: Rule): string {
  const meta = [r.tags.length ? r.tags.join(' ') : '', r.globs.length ? `→ ${r.globs.join(' ')}` : '']
    .filter(Boolean)
    .join(' ');
  return `${r.n}. ${r.text}${meta ? `  [${meta}]` : ''}`;
}

/** The plain text that goes inside the markers. No JSON, no ceremony. */
export function renderBlock(sel: Selection): string {
  const lines = [preamble(), ''];
  if (!sel.chosen.length) {
    lines.push('(no rules earned yet)');
  } else {
    for (const r of sel.chosen) lines.push(renderRule(r));
  }
  if (sel.heldBack > 0) {
    lines.push('', `${sel.heldBack} more rule${sel.heldBack === 1 ? '' : 's'} held back by the token budget — run \`stet rules\` for all.`);
  }
  return lines.join('\n');
}
