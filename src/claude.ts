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
export const TAG = /stet.*\bhook\s+(pre-tool-use|post-tool-use|stop|session-start|pre-compact|post-compact|user-prompt)\b/;

/**
 * Every event Claude Code actually emits.
 *
 * This list exists because stet wired `PostCompact` for its entire life. There
 * is no such event — the real one is `PreCompact` — so that hook never fired
 * once, and the README's claim that taste survives compaction was resting on a
 * hook that was never called.
 *
 * It hid because the check was pointed at the wrong side. `stet claude status`
 * asked *our own binary* whether it implements `post-compact`, which it does,
 * and reported "verified — all 6 events implemented". Nothing ever asked
 * whether Claude Code emits the event we were listening for. Same shape as the
 * very first bug in this project: a real check, verifying the wrong half.
 */
export const CLAUDE_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreCompact',
  'Notification',
] as const;

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
    matcher: 'Write|Edit|MultiEdit|NotebookEdit|Read|NotebookRead',
    arg: 'pre-tool-use',
    why: 'tells you what this repo learned about a file when you open it, and denies writes into a path an undecided question claims',
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
    event: 'PreCompact',
    arg: 'pre-compact',
    why: 'restates the canon around compaction, which is when taste gets summarised away',
  },
  {
    // Implemented since the hooks existed and never installed, which left a
    // hole exactly where this tool is supposed to be strongest: a verdict given
    // in the middle of a session did not reach the agent that asked for it.
    // SessionStart has already fired, and an unscoped rule never travels
    // through PreToolUse — so the rule you just earned first bound an agent
    // tomorrow. It arrives at the next thing you type instead, once, because
    // canonOnce only ever sends what this session has not already been shown.
    event: 'UserPromptSubmit',
    arg: 'user-prompt',
    why: 'delivers a rule earned mid-session to the agent that is still working',
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

/**
 * Slash commands, so the loop can be driven without leaving the session.
 *
 * The point of wiring stet into Claude Code is that the human never has to go
 * anywhere else. Hooks handle the agent's half; this is the human's half —
 * `/stet` to see what is waiting, `/stet-undo` to take back a verdict that
 * should not have become a rule.
 *
 * The bodies are prompts, and each one carries live state injected by the
 * shell, so Claude answers from what is actually there rather than from
 * whatever it remembers about the repo.
 */
export const COMMANDS: Array<{ name: string; body: (cmd: string) => string }> = [
  {
    name: 'stet',
    body: (cmd) => `${head(cmd, 'What is waiting on a human verdict, and the taste already recorded')}
Current stet state:

!\`${cmd} status\`

Tell the user plainly what is waiting on them and what the canon already says.
If anything is waiting, offer to open the decision page — run \`${cmd}\` — so
they can judge it. It opens in a browser and blocks nothing here.

Do not offer to answer the decisions yourself. They are waiting on a human on
purpose; that is the entire point of them existing.
`,
  },
  {
    name: 'stet-undo',
    body: (cmd) => `${head(cmd, 'Take back the last verdict, and the rule it earned')}
The canon as it stands:

!\`${cmd} rules\`

The user wants to take back a verdict — usually because the rule it produced is
not a rule, or the decision was wrong to have asked.

Run \`${cmd} undo\` for the most recent one, or \`${cmd} undo <id>\` if they
name a decision. To drop a rule without touching a decision, run
\`${cmd} rule remove <n>\`.

Then say what was removed and what the canon says now. If the decision went
back in the queue, mention that judging it again will not be blind, because
they have already seen the reveal.
`,
  },
];

/**
 * Frontmatter. `allowed-tools` is only safe to narrow when the command is the
 * bare word `stet`. Pinned to a checkout it reads `node /abs/path/stet.js`, and
 * whitelisting `Bash(node:*)` there would pre-approve every node process on the
 * machine to save one permission prompt. Omitted instead: Claude asks once.
 */
function head(cmd: string, description: string): string {
  const allow = cmd === 'stet' ? 'allowed-tools: Bash(stet:*)\n' : '';
  return `---\n${allow}description: ${description}\n---\n${MARK}\n`;
}

/**
 * How we recognise a file as ours, for overwriting and for removal.
 *
 * The first version sniffed the body for the string "stet status", which the
 * pinned form does not contain — it says "…/stet.js status" — so re-wiring
 * silently refused to update its own file and left a stale command behind.
 * Never infer ownership from content that varies.
 */
const MARK = '<!-- written by stet · safe to delete · `stet claude remove` -->';

export function commandsDir(root: string): string {
  return path.join(root, '.claude', 'commands');
}

/** Writes the slash commands. Returns the files it created or updated. */
export function installCommands(root: string, command: string): string[] {
  const dir = commandsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const c of COMMANDS) {
    const file = path.join(dir, `${c.name}.md`);
    const body = c.body(command);
    let current = '';
    try {
      current = fs.readFileSync(file, 'utf8');
    } catch {
      /* new */
    }
    // Never clobber a command the user wrote themselves under the same name.
    if (current && !current.includes(MARK)) continue;
    if (current === body) continue;
    fs.writeFileSync(file, body);
    written.push(file);
  }
  return written;
}

/** Removes only the command files stet wrote. */
export function uninstallCommands(root: string): string[] {
  const dir = commandsDir(root);
  const removed: string[] = [];
  for (const c of COMMANDS) {
    const file = path.join(dir, `${c.name}.md`);
    try {
      if (!fs.readFileSync(file, 'utf8').includes(MARK)) continue;
      fs.rmSync(file);
      removed.push(file);
    } catch {
      /* not there */
    }
  }
  try {
    if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
  } catch {
    /* not empty, or not there */
  }
  return removed;
}
