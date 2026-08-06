// stet — Claude Code hooks. This is the difference between a rulebook an agent
// may read and a gate it cannot walk past.
//
// Three things happen here, none of them requiring a model call:
//
//   1. A write into a path claimed by an undecided question is DENIED, with the
//      question handed back to the agent. Instructions get ignored; a denied
//      tool call cannot be.
//   2. Rules arrive as a system reminder at the moment they apply, and never
//      twice in one session. A rule in AGENTS.md is read once at session start
//      and then competes with everything after it; a system reminder arrives
//      immediately before the model request that needs it.
//   3. After compaction the canon is re-stated, because compaction is exactly
//      when taste gets summarised away.

import fs from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.js';
import { DEFAULT_BUDGET, readRules, renderRule, selectRules } from './rules.js';
import { readNotes, type Note } from './notes.js';
import { listEntries, paths } from './store.js';
import type { Rule } from './types.js';

export interface HookInput {
  session_id?: string;
  prompt_id?: string;
  hook_event_name?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  user_prompt?: string;
}

/** What one session has been told, and what it has been made to redo. */
interface Session {
  injected: number[];
  /** Note numbers already shown this session. Separate from `injected`. */
  notesSeen: number[];
  /** repo-relative path → the distinct prompts that caused a write to it */
  edits: Record<string, string[]>;
  /** paths already surfaced as churn, so it is said once */
  flagged: string[];
  at: number;
}

/**
 * Revising the same file across separate instructions is the signature of
 * taste being negotiated out loud instead of written down. Three is the point
 * where it stops looking like iteration and starts looking like a preference
 * nobody has recorded.
 */
export const CHURN_THRESHOLD = 3;

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: 'deny' | 'allow' | 'ask';
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
}

const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

/** The path a write-shaped tool call is aimed at, repo-relative. */
export function targetPath(root: string, input: HookInput): string | null {
  const t = input.tool_input ?? {};
  const raw = (t.file_path ?? t.notebook_path ?? t.path) as string | undefined;
  if (typeof raw !== 'string' || !raw) return null;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(input.cwd ?? root, raw);
  const rel = path.relative(root, abs);
  return rel.startsWith('..') ? null : rel.split(path.sep).join('/');
}

// ── session memory: never inject the same rule twice ──────────────────────

/**
 * An append-only log, not a state file. PostToolUse fires on every write and
 * Claude Code runs tool calls in parallel, so read-modify-write loses updates —
 * measured at six lost out of forty. Appends do not race, and a torn line is
 * skipped on read instead of destroying the whole file.
 */
function sessionFile(root: string, id: string): string {
  return path.join(paths(root).stet, 'sessions', `${id.replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`);
}

type Record_ = { t: 'e'; p: string; q: string } | { t: 'i'; n: number } | { t: 'f'; p: string } | { t: 'n'; n: number };

function append(root: string, id: string | undefined, rec: Record_): void {
  if (!id) return;
  const file = sessionFile(root, id);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);
  } catch {
    /* a hook must never be the reason a tool call fails */
  }
}

/**
 * A fresh object every time. A shared literal spread with `{...EMPTY}` copies
 * the nested `edits` map by reference, and one session's churn then leaks into
 * every other session read in the same process.
 */
function blank(): Session {
  return { injected: [], notesSeen: [], edits: {}, flagged: [], at: 0 };
}

/** Folds the log. Unparseable lines are skipped — a half-written record must
 *  not cost the whole session. */
export function loadSession(root: string, id: string | undefined): Session {
  const s = blank();
  if (!id) return s;
  let text: string;
  try {
    text = fs.readFileSync(sessionFile(root, id), 'utf8');
  } catch {
    return s;
  }
  for (const line of text.split('\n')) {
    if (!line) continue;
    let r: Record_;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.t === 'e' && typeof r.p === 'string' && typeof r.q === 'string') {
      const list = (s.edits[r.p] ??= []);
      if (!list.includes(r.q)) list.push(r.q);
    } else if (r.t === 'i' && Number.isInteger(r.n)) {
      if (!s.injected.includes(r.n)) s.injected.push(r.n);
    } else if (r.t === 'f' && typeof r.p === 'string') {
      if (!s.flagged.includes(r.p)) s.flagged.push(r.p);
    } else if (r.t === 'n' && Number.isInteger(r.n)) {
      // Numbered separately from rules: both start at 1 and they are different
      // things, so one namespace would silently suppress the other.
      if (!s.notesSeen.includes(r.n)) s.notesSeen.push(r.n);
    }
  }
  s.injected.sort((a, b) => a - b);
  s.notesSeen.sort((a, b) => a - b);
  return s;
}

function seen(root: string, id: string | undefined): Set<number> {
  return new Set(loadSession(root, id).injected);
}

function remember(root: string, id: string | undefined, ns: number[]): void {
  for (const n of ns) append(root, id, { t: 'i', n });
}

/**
 * Record that Claude Code actually called us.
 *
 * `stet claude status` could say two things: the wiring is present, and the
 * binary it points at implements the event. Both are declarations — one read
 * from a settings file, one asked of our own code. Neither can tell you whether
 * Claude Code is calling any of it, which is the only question that matters and
 * the one nobody could answer. `PostCompact` passed both checks for the life of
 * the project while never firing once.
 *
 * An empty file per event, truncated on each call. No parsing, no growth, and
 * concurrent writers cannot corrupt it because there is nothing in it — the
 * mtime is the whole payload. Kept as a dotfile inside sessions/, which is
 * already git-ignored in every project stet has ever initialised.
 */
function markFired(root: string, event: string): void {
  try {
    const dir = path.join(paths(root).stet, 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `.fired-${event.replace(/[^a-z-]/g, '')}`), '');
  } catch {
    /* a hook must never be the reason a tool call fails */
  }
}

/** When each event was last seen, by event argument. Absent means never. */
export function lastFired(root: string): Record<string, number> {
  const dir = path.join(paths(root).stet, 'sessions');
  const out: Record<string, number> = {};
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!n.startsWith('.fired-')) continue;
    try {
      out[n.slice(7)] = fs.statSync(path.join(dir, n)).mtimeMs;
    } catch {
      /* raced with a sweep */
    }
  }
  return out;
}

/** Sessions are cheap files; drop the ones older than a day when we pass by. */
export function sweepSessions(root: string, maxAgeMs = 86_400_000): void {
  const dir = path.join(paths(root).stet, 'sessions');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const n of names) {
    // The fired-markers are evidence about the wiring, not session state, and
    // a stale one is the finding rather than litter to clear away.
    if (n.startsWith('.')) continue;
    const f = path.join(dir, n);
    try {
      if (now - fs.statSync(f).mtimeMs > maxAgeMs) fs.rmSync(f);
    } catch {
      /* ignore */
    }
  }
}

// ── the block ─────────────────────────────────────────────────────────────

export function blockingDecisions(root: string, rel: string) {
  return listEntries(root, 'pending')
    .filter((e): e is Extract<typeof e, { ok: true }> => e.ok)
    .filter((e) => matchesAny(e.item.globs, rel));
}

function denyText(items: ReturnType<typeof blockingDecisions>): string {
  const lines = ['stet: this path is governed by a decision the human has not made yet.', ''];
  for (const e of items) {
    lines.push(`  ${e.id} — "${e.item.question}"`);
    lines.push(`  claims: ${(e.item.globs ?? []).join(', ')}`);
  }
  lines.push('');
  lines.push('Do not implement either option yet — whichever you pick has a 50% chance of');
  lines.push('being thrown away. Either work somewhere else, or block on the verdict with:');
  lines.push(`  stet await ${items[0].id}`);
  return lines.join('\n');
}

// ── the just-in-time rules ────────────────────────────────────────────────

function stateBlock(rules: Rule[], heading: string): string {
  return [`${heading}`, ...rules.map(renderRule)].join('\n');
}

/**
 * Rules scoped to this path, minus anything this session has already been
 * told. Unscoped rules are the canon and are delivered once per session.
 */
function dueFor(root: string, rel: string | null, id: string | undefined, budget: number) {
  const already = seen(root, id);
  const all = readRules(root);
  const relevant = all.filter((r) => {
    if (already.has(r.n)) return false;
    if (!r.globs.length) return false;
    return rel !== null && matchesAny(r.globs, rel);
  });
  return selectRules(relevant, { budget }).chosen;
}

export function preToolUse(root: string, input: HookInput, budget = DEFAULT_BUDGET): HookOutput | null {
  if (!WRITE_TOOLS.test(input.tool_name ?? '')) return null;
  const rel = targetPath(root, input);
  if (rel === null) return null;

  const blocked = blockingDecisions(root, rel);
  if (blocked.length) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: denyText(blocked),
      },
    };
  }

  const due = dueFor(root, rel, input.session_id, budget);
  const notes = notesFor(root, rel, input.session_id);
  if (!due.length && !notes.length) return null;

  const parts: string[] = [];
  if (due.length) {
    remember(root, input.session_id, due.map((r) => r.n));
    parts.push(stateBlock(due, `stet rules that govern ${rel} — binding, already decided by this repo's owner:`));
  }
  if (notes.length) {
    for (const n of notes) append(root, input.session_id, { t: 'n', n: n.n });
    parts.push(
      [`stet notes for ${rel} — learned here, not obvious from the code:`, ...notes.map((n) => `· ${n.text}`)].join('\n'),
    );
  }
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: parts.join('\n\n') },
  };
}

/**
 * Notes matching this path that this session has not been shown.
 *
 * Rules are selected first and against the full budget; notes take what is left
 * and never more than a handful. A landmine is worth saying once — a rule is
 * binding, and if the two ever compete for room the binding one wins.
 */
function notesFor(root: string, rel: string | null, id: string | undefined): Note[] {
  if (rel === null) return [];
  const already = new Set(loadSession(root, id).notesSeen);
  return readNotes(root)
    .filter((n) => !already.has(n.n) && n.globs.length && matchesAny(n.globs, rel))
    .slice(0, MAX_NOTES);
}

/** Enough to warn, not enough to become the thing people skip. */
const MAX_NOTES = 4;

/** Everything unscoped, once per session. Also how the canon survives compaction. */
export function canonOnce(root: string, input: HookInput, event: string, budget = DEFAULT_BUDGET): HookOutput | null {
  const already = seen(root, input.session_id);
  const fresh = readRules(root).filter((r) => !already.has(r.n) && !r.globs.length);
  const sel = selectRules(fresh, { budget });
  const pending = listEntries(root, 'pending').filter((e) => e.ok).length;

  const parts: string[] = [];
  if (sel.chosen.length) {
    parts.push(stateBlock(sel.chosen, "stet canon — verdicts this repo's owner already gave. Binding; do not re-litigate:"));
    if (sel.heldBack > 0) parts.push(`(${sel.heldBack} more held back by the token budget — run \`stet rules\`.)`);
  }
  if (pending) {
    parts.push(
      `${pending} decision${pending === 1 ? '' : 's'} awaiting a human verdict. Writes into paths they claim will be denied.`,
    );
  }
  if (!parts.length) return null;

  remember(root, input.session_id, sel.chosen.map((r) => r.n));
  return { hookSpecificOutput: { hookEventName: event, additionalContext: parts.join('\n\n') } };
}

// ── churn: taste that is being said out loud instead of written down ──────

/**
 * After a write lands, note which instruction caused it. Distinct prompts
 * matter, not distinct writes: three edits inside one instruction is an agent
 * working, while three edits across three instructions is a human correcting.
 */
export function postToolUse(root: string, input: HookInput): HookOutput | null {
  if (!WRITE_TOOLS.test(input.tool_name ?? '')) return null;
  const rel = targetPath(root, input);
  if (rel === null || !input.session_id) return null;
  const prompt = input.prompt_id ?? '';
  if (!prompt) return null;

  append(root, input.session_id, { t: 'e', p: rel, q: prompt });
  return null;
}

export interface Churn {
  path: string;
  revisions: number;
}

/** Files revised across enough separate instructions to look like preference. */
export function churn(root: string, id: string | undefined, threshold = CHURN_THRESHOLD): Churn[] {
  const s = loadSession(root, id);
  return Object.entries(s.edits)
    .map(([p, prompts]) => ({ path: p, revisions: prompts.length }))
    .filter((c) => c.revisions >= threshold)
    .sort((a, b) => b.revisions - a.revisions);
}

/**
 * The end of a turn is the only moment with no task pressure competing for
 * attention, which makes it the one place a nudge has a chance of landing.
 * Said once per file per session.
 */
export function stop(root: string, input: HookInput, threshold = CHURN_THRESHOLD): HookOutput | null {
  const s = loadSession(root, input.session_id);
  const fresh = churn(root, input.session_id, threshold).filter((c) => !s.flagged.includes(c.path));
  if (!fresh.length) return null;

  for (const c of fresh) append(root, input.session_id, { t: 'f', p: c.path });

  // Scoped, not bare. The churn signal already knows which path was argued
  // over, and a rule with globs is delivered at the moment an agent touches
  // that area again; an unscoped one waits at the top of the next session and
  // competes with everything after it. Suggesting the weaker form when the
  // stronger one is one flag away was leaving the mechanism on the table.
  const scope = (p: string): string => {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    return dir ? `${dir}/**` : p;
  };
  const lines = [
    'stet: unwritten taste detected.',
    '',
    ...fresh.map((c) => `  ${c.path} — revised across ${c.revisions} separate instructions this session`),
    '',
    'Being asked to redo the same file across separate instructions usually means',
    'a preference is being negotiated out loud instead of recorded. If one of those',
    'corrections was a matter of taste rather than a bug, say so and offer to write',
    'it down — scoped, so it arrives the moment an agent touches that area again:',
    '',
    ...fresh.map((c) => `  stet rule "<the one line>" --globs '${scope(c.path)}'`),
    '',
    'If it was just bugs, ignore this.',
  ];
  return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: lines.join('\n') } };
}

/** Compaction just discarded the conversation — say it all again. */
export function preCompact(root: string, input: HookInput, budget = DEFAULT_BUDGET): HookOutput | null {
  // Forget what this session was told: the context that held it is gone.
  if (input.session_id) {
    try {
      fs.rmSync(sessionFile(root, input.session_id));
    } catch {
      /* nothing to forget */
    }
  }
  return canonOnce(root, input, 'PreCompact', budget);
}

export function userPromptSubmit(root: string, input: HookInput, budget = DEFAULT_BUDGET): HookOutput | null {
  return canonOnce(root, input, 'UserPromptSubmit', budget);
}

/**
 * The events this build actually implements. Wiring written by a newer stet
 * and run by an older one produces hooks that fire, return nothing, and gate
 * nothing — wired and useless, which reads exactly like working.
 */
export const EVENTS = ['pre-tool-use', 'post-tool-use', 'stop', 'session-start', 'pre-compact', 'user-prompt'] as const;

/** Dispatch. Never throws: a broken hook must not break the session. */
export function runHook(root: string, event: string, input: HookInput, budget = DEFAULT_BUDGET): HookOutput | null {
  try {
    markFired(root, event);
    switch (event) {
      case 'pre-tool-use':
        return preToolUse(root, input, budget);
      case 'post-tool-use':
        return postToolUse(root, input);
      case 'stop':
        return stop(root, input);
      case 'user-prompt':
        return userPromptSubmit(root, input, budget);
      case 'pre-compact':
      // Wirings written before this was corrected call `post-compact`, an
      // event Claude Code never emitted. Answer it anyway rather than going
      // silent on anyone who has not re-run `stet claude`.
      case 'post-compact':
        return preCompact(root, input, budget);
      case 'session-start':
        sweepSessions(root);
        return canonOnce(root, input, 'SessionStart', budget);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
