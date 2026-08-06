// stet — wiring into Claude Code. JSON cannot carry the marker comments the
// markdown surfaces use, so our entries are identified by their command string
// and removed by filtering on it. Everything else in the file is preserved,
// including key order and the user's own hooks.

import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './lock.js';

/**
 * Recognising our own entries has to survive both forms the installer writes:
 * `stet hook pre-tool-use` when stet is on PATH, and
 * `node /abs/path/bin/stet.js hook pre-tool-use` when it is not. Matching the
 * literal string "stet hook" only catches the first, which silently orphans
 * the second on removal and duplicates it on reinstall.
 */
export const TAG = /stet.*\bhook\s+(pre-tool-use|post-tool-use|stop|session-start|post-compact|user-prompt)\b/;

export interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string; timeout?: number }>;
}

interface Wiring {
  event: string;
  matcher?: string;
  arg: string;
  why: string;
}

export const WIRING: Wiring[] = [
  {
    event: 'PreToolUse',
    matcher: 'Write|Edit|MultiEdit|NotebookEdit',
    arg: 'pre-tool-use',
    why: 'denies writes into a path an undecided question claims, and delivers the rules for that path',
  },
  {
    event: 'PostToolUse',
    matcher: 'Write|Edit|MultiEdit|NotebookEdit',
    arg: 'post-tool-use',
    why: 'notes which instruction caused each write, to spot taste being said out loud',
  },
  {
    event: 'Stop',
    arg: 'stop',
    why: 'at the end of a turn, names files you had to correct repeatedly',
  },
  {
    event: 'SessionStart',
    arg: 'session-start',
    why: 'states the canon once, at the top of the session',
  },
  {
    event: 'PostCompact',
    arg: 'post-compact',
    why: 'states it again after compaction, which is when taste gets summarised away',
  },
];

export function settingsPath(root: string, scope: 'project' | 'local'): string {
  return path.join(root, '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json');
}

/**
 * Match whatever indentation the file already uses. JSON cannot be edited
 * surgically the way the markdown surfaces can, so a rewrite is unavoidable —
 * but it should not show up in a diff as a reformat of the whole file.
 */
function indentOf(file: string): string | number {
  try {
    const m = /\n([ \t]+)"/.exec(fs.readFileSync(file, 'utf8'));
    if (!m) return 2;
    return m[1].includes('\t') ? '\t' : m[1].length;
  } catch {
    return 2;
  }
}

function read(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON — fix it before wiring stet in`);
  }
}

function isOurs(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some((h) => typeof h.command === 'string' && TAG.test(h.command));
}

export interface WireResult {
  file: string;
  added: string[];
  removed: string[];
  unchanged: boolean;
}

/** `command` is the executable to call — `stet` once installed, else an absolute path. */
export function install(root: string, scope: 'project' | 'local' = 'project', command = 'stet', opts: { dryRun?: boolean } = {}): WireResult {
  const file = settingsPath(root, scope);
  const settings = read(file);
  const before = JSON.stringify(settings);
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const added: string[] = [];

  for (const w of WIRING) {
    const list = (hooks[w.event] ?? []).filter((e) => !isOurs(e));
    list.push({
      ...(w.matcher ? { matcher: w.matcher } : {}),
      hooks: [{ type: 'command', command: `${command} hook ${w.arg}`, timeout: 10 }],
    });
    hooks[w.event] = list;
    added.push(`${w.event}${w.matcher ? ` (${w.matcher})` : ''}`);
  }
  settings.hooks = hooks;

  const next = `${JSON.stringify(settings, null, indentOf(file))}\n`;
  const unchanged = before === JSON.stringify(settings);
  if (!opts.dryRun && !unchanged) writeAtomic(file, next);
  return { file, added, removed: [], unchanged };
}

export function uninstall(root: string, scope: 'project' | 'local' = 'project', opts: { dryRun?: boolean } = {}): WireResult {
  const file = settingsPath(root, scope);
  if (!fs.existsSync(file)) return { file, added: [], removed: [], unchanged: true };
  const indent = indentOf(file);
  const settings = read(file);
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const removed: string[] = [];

  for (const event of Object.keys(hooks)) {
    const kept = (hooks[event] ?? []).filter((e) => {
      if (!isOurs(e)) return true;
      removed.push(event);
      return false;
    });
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!Object.keys(hooks).length) delete settings.hooks;
  else settings.hooks = hooks;

  if (!opts.dryRun && removed.length) {
    // An empty object left behind is litter; remove the file if we made it.
    if (!Object.keys(settings).length) fs.rmSync(file);
    else writeAtomic(file, `${JSON.stringify(settings, null, indent)}\n`);
  }
  return { file, added: [], removed, unchanged: !removed.length };
}

export function installed(root: string, scope: 'project' | 'local' = 'project'): boolean {
  const file = settingsPath(root, scope);
  if (!fs.existsSync(file)) return false;
  try {
    const hooks = (read(file).hooks ?? {}) as Record<string, HookEntry[]>;
    return Object.values(hooks).some((list) => (list ?? []).some(isOurs));
  } catch {
    return false;
  }
}
