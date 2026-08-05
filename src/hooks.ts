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
import { listEntries, paths } from './store.js';
import type { Rule } from './types.js';

export interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  user_prompt?: string;
}

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

function sessionFile(root: string, id: string): string {
  return path.join(paths(root).stet, 'sessions', `${id.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

function seen(root: string, id: string | undefined): Set<number> {
  if (!id) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(sessionFile(root, id), 'utf8')).injected ?? []);
  } catch {
    return new Set();
  }
}

function remember(root: string, id: string | undefined, ns: number[]): void {
  if (!id || !ns.length) return;
  const file = sessionFile(root, id);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const all = [...seen(root, id), ...ns];
    fs.writeFileSync(file, JSON.stringify({ injected: [...new Set(all)].sort((a, b) => a - b), at: Date.now() }));
  } catch {
    /* a hook must never be the reason a tool call fails */
  }
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
  if (!due.length) return null;
  remember(root, input.session_id, due.map((r) => r.n));
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: stateBlock(due, `stet rules that govern ${rel} — binding, already decided by this repo's owner:`),
    },
  };
}

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

/** Compaction just discarded the conversation — say it all again. */
export function postCompact(root: string, input: HookInput, budget = DEFAULT_BUDGET): HookOutput | null {
  // Forget what this session was told: the context that held it is gone.
  if (input.session_id) {
    try {
      fs.rmSync(sessionFile(root, input.session_id));
    } catch {
      /* nothing to forget */
    }
  }
  return canonOnce(root, input, 'PostCompact', budget);
}

export function userPromptSubmit(root: string, input: HookInput, budget = DEFAULT_BUDGET): HookOutput | null {
  return canonOnce(root, input, 'UserPromptSubmit', budget);
}

/** Dispatch. Never throws: a broken hook must not break the session. */
export function runHook(root: string, event: string, input: HookInput, budget = DEFAULT_BUDGET): HookOutput | null {
  try {
    switch (event) {
      case 'pre-tool-use':
        return preToolUse(root, input, budget);
      case 'user-prompt':
        return userPromptSubmit(root, input, budget);
      case 'post-compact':
        return postCompact(root, input, budget);
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
