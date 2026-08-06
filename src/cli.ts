#!/usr/bin/env node
// stet — the command. Hand-rolled arg parsing, zero dependencies.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendDirectRule, DEFAULT_BUDGET, readRules, removeRule, renderBlock, reviseRule, selectRules, weakness } from './rules.js';
import { notify, open } from './notify.js';
// server.ts pulls in the 39KB page document. The hook path runs on every tool
// call, so it is imported lazily and only by the command that serves.
import { addItem, drop, findEntry, findRoot, init, lastDecided, listEntries, paths, undecide, validId } from './store.js';
import { appendNote, readNotes, removeNote, thin } from './notes.js';
import { commaList } from './text.js';
import { assertItem } from './validate.js';
import { sync, unsync } from './sync.js';
import type { Item } from './types.js';

// Read from package.json rather than kept alongside it. A hardcoded copy had
// already drifted a release behind by the time anyone looked, and the number it
// feeds is the one `stet hook events` reports — so the check that exists to
// catch version skew was itself reporting the wrong version. One source only.
// Lazy, because the hook path runs on every tool call and never asks for it.
let cachedVersion: string | null = null;
function VERSION(): string {
  if (cachedVersion === null) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version?: string };
    cachedVersion = String(pkg.version ?? '0.0.0');
  }
  return cachedVersion;
}

interface Args {
  cmd: string;
  rest: string[];
  flags: Record<string, string | boolean>;
  /** Every occurrence of each flag, in order — `--url a --url b` is two options. */
  all: Record<string, string[]>;
}

function parse(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const all: Record<string, string[]> = {};
  const rest: string[] = [];
  const set = (k: string, v: string | boolean): void => {
    flags[k] = v;
    if (typeof v === 'string') (all[k] ??= []).push(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) set(a.slice(2, eq), a.slice(eq + 1));
      else if (argv[i + 1] && !argv[i + 1].startsWith('-')) set(a.slice(2), argv[++i]);
      else set(a.slice(2), true);
    } else rest.push(a);
  }
  return { cmd: rest[0] ?? '', rest: rest.slice(1), flags, all };
}

const args = parse(process.argv.slice(2));
// `--version` and `--help` start with `--`, so parse() files them as flags and
// the command comes out empty — which is the default command, which initialises
// a project and starts a server. The two things a person types first wrote
// AGENTS.md into whatever directory they were standing in and then hung. Anyone
// typing them means the command, so say so before anything reads args.cmd.
if (args.cmd === '') {
  // Consumed, not just read: it is the command now, and leaving it in flags
  // makes the unknown-flag guard below reject `stet --version` for taking a
  // flag that `stet version` does not accept.
  if (args.flags.version) { args.cmd = 'version'; delete args.flags.version; }
  else if (args.flags.help) { args.cmd = 'help'; delete args.flags.help; }
}

// Every flag each command actually reads. A flag nobody reads used to be
// accepted and dropped: `stet rule "…" --globs src/web/**` scoped nothing and
// still printed success, so the rule silently became repo-wide. A typo in a
// flag name is the same failure. Refuse instead, and name the alternatives —
// a misspelled flag is a person who knows what they want.
const FLAGS: Record<string, string[]> = {
  '': ['port', 'no-open', 'budget'],
  serve: ['port', 'no-open', 'budget'],
  ask: ['shuffle', 'help', 'url', 'image', 'code', 'why', 'id', 'globs', 'tag', 'how', 'notes', 'wait', 'timeout'],
  await: ['timeout'],
  rules: ['tag', 'budget'],
  sync: ['remove', 'budget'],
  rule: ['tag', 'globs'],
  hook: ['budget'],
  claude: ['project', 'remove', 'command'],
  churn: ['threshold'],
  capture: ['views', 'out', 'json', 'settle'],
  demo: ['port', 'no-open'],
  undo: [],
  status: ['json'],
  method: ['list'],
  note: ['globs'],
  notes: [],
  init: [],
  schema: [],
  version: [],
  help: [],
};

function checkFlags(): void {
  const known = FLAGS[args.cmd];
  if (!known) return; // unknown command — that path reports its own error
  const unknown = Object.keys(args.flags).filter((f) => !known.includes(f));
  if (!unknown.length) return;
  const near = (f: string): string => {
    // Cheap and good enough for a typo: the known flag sharing the most
    // leading characters, if it shares more than one.
    let best = '';
    for (const k of known) {
      let i = 0;
      while (i < f.length && i < k.length && f[i] === k[i]) i++;
      if (i > 1 && i > best.length) best = k;
    }
    return best ? ` — did you mean --${best}?` : '';
  };
  const list = unknown.map((f) => `--${f}${near(f)}`).join(', ');
  throw new Error(
    `${args.cmd || 'stet'} does not take ${list}\n` +
      `       it takes: ${known.length ? known.map((f) => `--${f}`).join(', ') : 'no flags'}`,
  );
}

/**
 * Refuse a value that cannot be what it has to be, before anything is written.
 * `stet --port notaport` used to initialise the project, sync every agent
 * surface, and only then complain — so the failure arrived after the side
 * effects it should have prevented.
 */
function checkValues(): void {
  for (const f of ['port', 'budget', 'timeout', 'threshold', 'settle']) {
    const v = args.flags[f];
    if (v === undefined || v === true) continue;
    if (!Number.isFinite(Number(v))) throw new Error(`--${f} takes a number, not ${JSON.stringify(v)}`);
  }
}
const root = findRoot();
const budget = Number(args.flags.budget ?? DEFAULT_BUDGET) || DEFAULT_BUDGET;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const warm = (s: string) => `\x1b[38;5;215m${s}\x1b[0m`;
const cool = (s: string) => `\x1b[38;5;79m${s}\x1b[0m`;
const out = (s = ''): void => {
  process.stdout.write(s + '\n');
};

try {
  await main();
} catch (err) {
  process.stderr.write(`stet: ${(err as Error).message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  checkFlags();
  checkValues();
  switch (args.cmd) {
    case '':
    // Advertised by the help line as one of the things bare `stet` does, which
    // reads like a subcommand — and typing it got "unknown command", which is
    // the kind of papercut that makes a tool feel broken before it has done
    // anything wrong.
    case 'serve':
      return run();
    case 'ask':
      return ask();
    case 'await':
      return awaitDecision();
    case 'rules':
      return printRules();
    case 'sync':
      return doSync();
    case 'rule':
      return directRule();
    case 'hook':
      return hook();
    case 'claude':
      return claude();
    case 'churn':
      return showChurn();
    case 'schema':
      return schema();
    case 'init':
      return doInit();
    case 'capture':
      return doCapture();
    case 'demo':
      return demo();
    case 'undo':
      return undo();
    case 'status':
      return status();
    case 'method':
      return method();
    case 'note':
      return note();
    case 'notes':
      return printNotes();
    case 'version':
    case '-v':
      return out(VERSION());
    case 'help':
    case '-h':
      return help();
    default:
      // Printing help for an unknown command reads as success. It is how an
      // older global install silently ignores a command it has never heard of.
      process.stderr.write(`stet: unknown command "${args.cmd}" (this is stet ${VERSION()})\n`);
      help();
      return process.exit(1);
  }
}

// ── the default command: everything ───────────────────────────────────────

// ── hooks: the gate ───────────────────────────────────────────────────────

/**
 * Called by Claude Code on every matching tool call. Two rules govern this
 * path: it must be fast, and it must never break the session. Any failure
 * exits 0 with no output, which Claude Code treats as "carry on".
 */
async function hook(): Promise<void> {
  const event = args.rest[0] ?? '';
  // `stet hook events` is how a wiring checks the binary it is pointed at.
  // It reads no stdin, so it cannot block.
  if (event === 'events') {
    const { EVENTS } = await import('./hooks.js');
    out(JSON.stringify({ version: VERSION(), events: EVENTS }));
    return;
  }
  let input: import('./hooks.js').HookInput = {};
  try {
    // Bounded: a caller that opens stdin and never closes it would otherwise
    // hold the tool call open until the hook timeout, on every tool call.
    input = JSON.parse(await readStdin(2000));
  } catch {
    process.exit(0);
  }
  try {
    const here = input.cwd ? findRoot(input.cwd) : root;
    const { runHook } = await import('./hooks.js');
    const result = runHook(here, event, input, budget);
    if (result) process.stdout.write(JSON.stringify(result));
  } catch {
    /* silence is the correct failure mode for a hook */
  }
  process.exit(0);
}

/** `stet claude remove` — take the wiring and the slash commands back out. */
async function claudeRemove(scope: 'project' | 'local'): Promise<void> {
  const { uninstall, uninstallCommands } = await import('./claude.js');
  const r = uninstall(root, scope);
  const gone = uninstallCommands(root);
  out(r.removed.length ? `  ${cool('removed')} ${r.removed.length} hook(s) from ${path.relative(root, r.file)}` : dim('  nothing wired'));
  if (gone.length) out(`  ${cool('removed')} ${gone.length} slash command(s)`);
}

/**
 * `stet claude status` — three questions, in increasing order of how much they
 * are worth. Is a hook written down; does the binary it names implement the
 * event; and has Claude Code ever actually called it. Only the third is
 * evidence rather than a declaration.
 */
async function claudeStatus(scope: 'project' | 'local'): Promise<void> {
  const { install, installed, WIRING } = await import('./claude.js');

    const file = install(root, scope, 'stet', { dryRun: true }).file;
    if (!installed(root, scope)) return out(dim('  not wired'));
    out(`  ${cool('wired')} — ${path.relative(root, file) || file}`);

    // Wired is not the same as working. Ask the binary the hooks actually
    // point at which events it implements, rather than assuming it is this one.
    const wired = wiredCommands(file);
    for (const cmd of new Set(wired.map((w) => w.command))) {
      const probe = await askEvents(cmd);
      const events = wired.filter((w) => w.command === cmd).map((w) => w.event);
      if (!probe.ok) {
        out(probe.why === 'too-old'
          ? `  ${warm('!')} the stet these hooks call is too old to say what it supports.\n` +
            `    it fires, returns nothing, and gates nothing. fix: ${cool('npm i -g stetmark@latest')}`
          : `  ${warm('!')} could not run ${JSON.stringify(cmd)} — those hooks fire and do nothing`);
        continue;
      }
      const missing = events.filter((e) => !probe.events.includes(e));
      if (missing.length) {
        out(`  ${warm('!')} that command is stet ${probe.version}, which does not implement: ${missing.join(', ')}`);
        out(`    those hooks fire, return nothing, and gate nothing. fix: ${cool('npm i -g stetmark@latest')}`);
      } else {
        out(`  ${cool('verified')} ${dim(`against stet ${probe.version} — all ${events.length} events implemented`)}`);
      }
    }

    // The third check, and the only empirical one. The two above are
    // declarations: a settings file says the hook is wired, and our own binary
    // says it implements the argument. Neither can tell you Claude Code is
    // calling any of it — `PostCompact` satisfied both for the life of the
    // project while never firing once.
    const { lastFired } = await import('./hooks.js');
    const fired = lastFired(root);
    const now = Date.now();
    out();
    let anyFired = false;
    let healthy = true;
    for (const cmd of new Set(wiredCommands(file).map((w) => w.command))) {
      const p2 = await askEvents(cmd);
      if (!p2.ok || WIRING.some((w) => !p2.events.includes(w.arg))) healthy = false;
    }
    for (const w of WIRING) {
      const at = fired[w.arg];
      if (at) anyFired = true;
      out(`    ${dim(w.event.padEnd(17))} ${at ? cool(ago(now - at)) : warm('never called')}`);
    }
    if (!anyFired) {
      out();
      // Do not say "verified" when the probe above said otherwise: two
      // contradictory lines in one report teach people to read neither.
      out(healthy
        ? `  ${warm('!')} wired and verified, but Claude Code has never called any of it.`
        : `  ${warm('!')} Claude Code has never called any of it either.`);
      out(`    ${dim('hooks are loaded when a session starts — restart Claude Code, then check again.')}`);
    }
}


async function claude(): Promise<void> {
  const { CLAUDE_EVENTS, install, installCommands, installed, uninstall, uninstallCommands, WIRING } = await import('./claude.js');
  // Local by default. A checked-in hook pointing at a binary a teammate has
  // not installed fails on every tool call and gates nothing — the repo would
  // claim a protection it is not providing, which is worse than no protection.
  // `--project` opts into the shared form once the team has stet.
  const scope = args.flags.project ? 'project' : 'local';
  const sub = args.rest[0] ?? 'install';

  if (sub === 'remove' || args.flags.remove) return claudeRemove(scope);
  // Both halves, not one. The old check asked our own binary whether it
  // implements each hook argument — which it always does, since we wrote both
  // sides — and never asked whether Claude Code emits the event we are
  // listening for. `PostCompact` passed that check for the life of the project
  // and was never emitted by anything.
  const unreal = WIRING.filter((w) => !(CLAUDE_EVENTS as readonly string[]).includes(w.event));
  if (unreal.length) {
    throw new Error(
      `this build wires ${unreal.map((w) => w.event).join(', ')}, which Claude Code does not emit.\n` +
        `       those hooks would never fire. real events: ${CLAUDE_EVENTS.join(', ')}`,
    );
  }

  if (sub === 'status') return claudeStatus(scope);

  // The executable the hooks will name. `--command` overrides it; otherwise it
  // is resolved below, preferring the short form and falling back to this build.
  let command = args.flags.command ? String(args.flags.command) : '';
  const self = `${process.execPath} ${fileURLToPath(new URL('../bin/stet.js', import.meta.url))}`;
  const need = WIRING.map((w) => w.arg);
  let pinned = '';

  if (!command) {
    const onPath = await resolves('stet');
    command = onPath ? 'stet' : self;
    if (!onPath) pinned = 'stet is not on PATH';
    else if (scope === 'local') {
      // `stet` on PATH is not necessarily this stet. It is routinely an older
      // global install, and hooks wired to it fire, return nothing and gate
      // nothing — the repo claims a protection it is not providing. This was
      // the first bug this project ever found and it came back four times.
      // Detecting it and writing the broken wiring anyway is not a fix, and
      // "npm i -g stetmark@latest" is the wrong advice for someone who
      // installed locally on purpose. Pin the binary that works.
      const probe = await askEvents(`${command} hook events`);
      const missing = probe.ok ? need.filter((e) => !probe.events.includes(e)) : need;
      if (missing.length) {
        command = self;
        pinned = probe.ok
          ? `the stet on PATH is ${probe.version}, which does not implement ${missing.join(', ')}`
          : 'the stet on PATH is too old to say what it supports';
      }
    }
  }
  const r = install(root, scope, command);
  out();
  out(`  ${warm('stet')} is now a gate in this repo, not a suggestion.`);
  out();
  for (const w of WIRING) out(`  ${cool(w.event.padEnd(17))} ${dim(w.why)}`);
  out();
  out(`  ${dim('written to')} ${path.relative(root, r.file) || r.file}`);

  // The hooks are the agent's half. These are the human's: the loop can be
  // driven without leaving the session it interrupts.
  const cmds = installCommands(root, command);
  if (cmds.length) {
    out();
    out(`  ${cool('/stet')}        ${dim('what is waiting on you, and what the canon already says')}`);
    out(`  ${cool('/stet-undo')}   ${dim('take back a verdict, and the rule it earned')}`);
    out(`  ${dim('written to')} ${path.relative(root, path.dirname(cmds[0]))}`);
  }

  if (pinned) {
    out();
    out(`  ${dim(`${pinned}, so these hooks call this build directly`)}`);
    out(`  ${dim('after `npm i -g stetmark@latest`, re-run `stet claude` for the short form')}`);
  }

  // Wiring is written by whichever stet you ran; the hooks call whichever stet
  // the command resolves to. Those are not always the same build — so ask the
  // one that was actually written, after it was written.
  const probe = await askEvents(`${command} hook events`);
  const missing = probe.ok ? need.filter((e) => !probe.events.includes(e)) : need;
  if (missing.length) {
    out();
    out(`  ${warm('!')} ${probe.ok
      ? `the stet these hooks call is ${probe.version}, which does not implement:`
      : 'the stet these hooks call is older than this one, and does not implement:'}`);
    out(`    ${missing.join(', ')}`);
    out(`    they will fire and do nothing. ${cool('npm i -g stetmark@latest')}${dim(', then re-run stet claude')}`);
  }
  // The single most important next action, and stet never said it. Claude Code
  // takes a snapshot of hooks when a session starts — deliberately, so settings
  // cannot be swapped underneath a running one — so nothing here is live until
  // a session begins after this moment. Someone who wires from inside a running
  // session and keeps working sees no gate at all and concludes it does not
  // work. Both cases are stated because they are genuinely different: a new
  // folder needs no restart, only a start.
  out();
  out(`  ${warm('these are not live yet.')} Claude Code loads hooks when a session starts.`);
  out(`    ${dim('starting Claude Code here for the first time?')} nothing to do — just start it.`);
  out(`    ${dim('already have one open in this folder?')} exit and run ${cool('claude')} again.`);
  out();
  out(`  ${dim('then')} ${cool('stet claude status')} ${dim('will show them actually firing.')}`);
  out(`  ${dim('undo with')} stet claude remove`);
  out();
}

/**
 * The sixty-second answer to "what is this, actually".
 *
 * Everything stet does is visual and none of it can be felt from a README. But
 * seeing it required already having an agent wired and a decision queued, so a
 * new arrival ran `stet` in their repo, read "nothing pending", and left.
 *
 * This runs the real thing on real decisions — every block kind, shuffled on
 * intake, blind exactly as a live one would be — in a temporary directory, so
 * nothing is written to the repo the person is standing in and no verdict they
 * give here binds anything.
 */
async function demo(): Promise<void> {
  const from = fileURLToPath(new URL('../fixtures', import.meta.url));
  // Deliberate order, not alphabetical. The first screen decides whether anyone
  // looks at the second, and alphabetical opened on an API envelope — the least
  // representative thing here. Lead with two running pages side by side.
  const ORDER = ['signup-live', 'hero-type', 'empty-state', 'error-copy', 'town-loop', 'api-shape', 'retry-policy'];
  const rank = (d: string): number => (ORDER.indexOf(d) + 1 || ORDER.length + 1);
  let ids: string[];
  try {
    ids = fs
      .readdirSync(from)
      .filter((d) => fs.existsSync(path.join(from, d, 'item.json')))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  } catch {
    throw new Error('this build shipped without its example decisions');
  }
  if (!ids.length) throw new Error('this build shipped without its example decisions');

  const here = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-demo-'));
  init(here);
  // Pending items are ordered by when they were queued, and seven queued in the
  // same millisecond fall back to sorting by id — which is how the tour opened
  // on an API envelope. Stamp them a minute apart so the intended order holds.
  const base = Date.now() - ids.length * 60_000;
  ids.forEach((id, i) => {
    const dir = path.join(from, id);
    const item = JSON.parse(fs.readFileSync(path.join(dir, 'item.json'), 'utf8')) as Item;
    item.created = new Date(base + i * 60_000).toISOString();
    // Through the same intake as a real decision: labels shuffled, assets
    // renamed after the shuffle. A demo that is not blind is not the product.
    addItem(here, item, { from: dir });
  });

  out();
  out(`  ${warm('stet')} ${dim('— let it stand.')}  ${dim(VERSION())}`);
  out();
  out(`  ${ids.length} real decisions, waiting on you. Judge them the way you would your own:`);
  out(`  ${dim('press')} A ${dim('or')} B${dim(', say why in one line, then sharpen it once you see what you picked.')}`);
  out();
  out(`  ${dim('This is a scratch copy in')} ${here}`);
  out(`  ${dim('Nothing here touches the repo you are standing in.')}`);

  const server = await serveDemo(here);
  out();
  out(`  ${cool(server.url)}`);
  out();
  if (!args.flags['no-open']) open(server.url);
  process.on('SIGINT', () => {
    server.close();
    fs.rmSync(here, { recursive: true, force: true });
    out();
    process.exit(0);
  });
}

async function serveDemo(here: string) {
  const { serve } = await import('./server.js');
  return serve(here, { port: portOf(args.flags.port), budget });
}

/**
 * Start a project here, even inside another one. Every other command walks up
 * to the nearest ancestor `.stet/`, which is right for a repo and wrong for a
 * monorepo package or an example folder — without this there was no way to have
 * taste that belongs to a subdirectory.
 */
function doInit(): void {
  const here = process.cwd();
  const p = paths(here);
  if (fs.existsSync(p.stet)) return out(dim(`  already a stet project — ${path.relative(here, p.stet) || '.stet'}`));

  const ancestor = findRoot(here);
  init(here);
  const surfaces = sync(here, readRules(here), { budget });
  out();
  out(`  ${cool('initialised')} ${path.relative(here, p.stet) || '.stet'}`);
  for (const s of surfaces) out(`  ${dim(s.action.padEnd(9))} ${s.path}`);
  if (ancestor !== here) {
    out();
    out(`  ${dim('note:')} ${path.relative(here, ancestor) || ancestor} is also a stet project.`);
    out(`  ${dim('this directory now keeps its own canon; the one above no longer applies here.')}`);
  }
  out();
}

/**
 * The matched-capture rig. Every variant at every view, same frame each time.
 * Without this, capturing a pair by hand took a dozen browser calls and the
 * mobile pair was abandoned — which is how this command came to exist.
 */
async function doCapture(): Promise<void> {
  const { capture, DEFAULT_VIEWS, findBrowser, parseVariants, parseViews, plan, toVariants } = await import('./capture.js');
  const variants = parseVariants(args.rest);
  const views = args.flags.views ? parseViews(String(args.flags.views)) : DEFAULT_VIEWS;
  const outDir = path.resolve(String(args.flags.out ?? 'captures'));
  const shots = plan(variants, views, outDir);

  const browser = findBrowser();
  if (!browser) {
    // Say exactly what could not be done and what would have been done, so an
    // agent with its own browser tools can run the same rig by hand.
    process.stderr.write('stet: no Chrome, Chromium, Edge or Brave found — set $CHROME_PATH to point at one.\n');
    process.stderr.write('      the rig it would have run, so you can drive it yourself:\n\n');
    for (const s of shots) {
      process.stderr.write(`      ${String(s.view.width).padStart(5)}x${s.view.height}  ${s.url}\n` +
        `            → ${path.relative(process.cwd(), s.file)}\n`);
    }
    process.exit(2);
  }

  if (!args.flags.json) {
    out();
    out(`  ${dim('capturing with')} ${path.basename(browser)}`);
    out();
  }
  const results = await capture(shots, browser, { settleMs: Number(args.flags.settle) || undefined });

  const failed = results.filter((r) => !r.ok);
  if (!args.flags.json) {
    for (const r of results) {
      const size = r.bytes ? dim(`${(r.bytes / 1024).toFixed(0)}KB`) : warm('empty');
      // A page laid out at a different width than asked for was cropped, not
      // reflowed — the image would look right and be wrong.
      const laid = r.laidOutAt === r.shot.view.width ? '' : warm(`  laid out at ${r.laidOutAt}px, not ${r.shot.view.width}`);
      out(`  ${r.ok ? cool('✓') : warm('✗')} ${r.shot.label}-${r.shot.view.name.padEnd(8)} ${dim(`${r.shot.view.width}x${r.shot.view.height}`)}  ${size}${laid}${r.error ? warm(`  ${r.error}`) : ''}`);
    }
    out();
    if (failed.length) {
      out(`  ${warm(String(failed.length))} of ${results.length} produced nothing — is the page actually serving?`);
      out();
      process.exitCode = 1;
      return;
    }
    out(`  ${dim('paste these into an item, or:')}  stet capture ${args.rest.join(' ')} --json`);
    out();
    return;
  }

  // Machine-readable: the variants array, ready to drop into item.json.
  out(JSON.stringify({ variants: toVariants(shots, process.cwd()) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

/** Which files this repo keeps having to redo, across every recent session. */
async function showChurn(): Promise<void> {
  const { churn, loadSession, CHURN_THRESHOLD } = await import('./hooks.js');
  const threshold = Number(args.flags.threshold) || CHURN_THRESHOLD;
  const dir = path.join(paths(root).stet, 'sessions');
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    /* no sessions yet */
  }

  const total = new Map<string, number>();
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, '');
    for (const c of churn(root, id, threshold)) total.set(c.path, (total.get(c.path) ?? 0) + c.revisions);
    // a file below the threshold in one session may still be worth seeing
    for (const [p, prompts] of Object.entries(loadSession(root, id).edits)) {
      if (!total.has(p) && prompts.length > 1) total.set(p, prompts.length);
    }
  }

  const rows = [...total.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) return out(dim('  nothing has been revised more than once yet'));

  out();
  out(`  ${warm('files this repo keeps redoing')} ${dim(`— ${files.length} session${files.length === 1 ? '' : 's'}`)}`);
  out();
  for (const [p, n] of rows) {
    const hot = n >= threshold;
    out(`  ${hot ? warm(String(n).padStart(3)) : dim(String(n).padStart(3))}  ${hot ? p : dim(p)}`);
  }
  out();
  out(dim(`  ${threshold}+ separate instructions on one file usually means a preference nobody wrote down.`));
  out(dim('  write it down once:  stet rule "<the one line>"'));
  out();
}

async function run(): Promise<void> {
  const { serve } = await import('./server.js');
  const fresh = init(root);
  const surfaces = sync(root, readRules(root), { budget });
  const rules = readRules(root);

  out();
  out(`  ${warm('stet')} ${dim('— let it stand')}`);
  out();
  if (fresh) out(`  ${cool('initialised')} ${dim(path.relative(process.cwd(), paths(root).stet) || '.stet')}`);
  out(`  ${rules.length} rule${rules.length === 1 ? '' : 's'} in the canon`);
  for (const s of surfaces) {
    const verb = s.action === 'created' ? 'created' : s.action === 'updated' ? 'synced ' : 'ok     ';
    out(`  ${dim(verb)} ${s.path} ${dim(`— ${s.agent}`)}`);
  }

  const server = await serve(root, {
    port: portOf(args.flags.port),
    budget,
    onPending: (ids) => {
      const n = ids.length;
      notify('stet — a decision is waiting', n === 1 ? ids[0] : `${n} decisions pending`, server.url);
      out(`  ${warm('•')} ${ids.join(', ')} ${dim('— waiting on you')}`);
    },
  });

  const pending = listEntries(root, 'pending').length;
  out();
  out(`  ${cool(server.url)}`);
  out(`  ${dim(pending ? `${pending} pending` : 'nothing pending — the page shows your canon')}`);
  out();
  if (!args.flags['no-open']) open(server.url);

  process.on('SIGINT', () => {
    server.close();
    out();
    process.exit(0);
  });
}

// ── ask: how agents queue a decision ──────────────────────────────────────

/**
 * The one-line form.
 *
 * An agent mid-task will not stop, run `stet schema`, author fifteen lines of
 * JSON and block — it will pick one and keep going, because it is trained to
 * finish. Every instruction telling it otherwise is competing with that. So the
 * ask has to cost less than the guess:
 *
 *   stet ask "Which hero?" --url localhost:5173/a --url localhost:5173/b \
 *            --globs 'src/hero/**' --wait
 *
 * which queues the decision, denies writes into the paths it claims, and blocks
 * until a human has ruled — in one command, with nothing to author.
 */
async function askShorthand(): Promise<void> {
  const question = args.rest[0];
  const texts = args.rest.slice(1);
  const urls = args.all.url ?? [];
  const images = args.all.image ?? [];
  const codes = args.all.code ?? [];

  const kinds = [
    ['text', texts] as const,
    ['url', urls] as const,
    ['image', images] as const,
    ['code', codes] as const,
  ].filter(([, v]) => v.length);

  if (!kinds.length) {
    throw new Error(
      'give the options to choose between:\n' +
        '       stet ask "Which label?" "Buy now" "Get started"\n' +
        '       stet ask "Which hero?" --url localhost:5173/a --url localhost:5173/b\n' +
        '       stet ask "Which spacing?" --image a.png --image b.png\n' +
        '       stet ask "Which shape?" --code a.ts --code b.ts',
    );
  }
  if (kinds.length > 1) {
    // Comparing a screenshot against a URL is not a comparison. The whole
    // premise is that only the thing being decided differs.
    throw new Error(`compare like with like — got ${kinds.map(([k, v]) => `${v.length} ${k}`).join(' and ')}`);
  }

  const [kind, values] = kinds[0];
  const label = (i: number): string => String.fromCharCode(65 + i);
  const why = args.all.why ?? [];

  const variants = values.map((value, i) => {
    let block: Record<string, unknown>;
    if (kind === 'text') block = { kind: 'text', text: value };
    else if (kind === 'url') block = { kind: 'url', href: withScheme(value) };
    else if (kind === 'image') block = { kind: 'image', src: value };
    else block = { kind: 'code', lang: path.extname(value).slice(1), text: readOption(value), title: path.basename(value) };
    return { label: label(i), blocks: [block] };
  });

  // What the human is told afterwards. Derived from the option itself, because
  // that is the honest answer to "which one was that" — and overridable with
  // --why when the agent knows something the artifact does not show.
  const map: Record<string, string> = {};
  values.forEach((value, i) => {
    map[label(i)] = why[i] ?? (kind === 'text' && value.length > 90 ? value.slice(0, 87) + '…' : value);
  });


  const item = {
    id: uniqueId(String(args.flags.id ?? '') || slug(question)),
    question,
    map,
    variants,
    ...(args.flags.how ? { how: String(args.flags.how) } : {}),
    ...(args.flags.notes ? { notes: String(args.flags.notes) } : {}),
    ...(commaList(args.flags.globs).length ? { globs: commaList(args.flags.globs) } : {}),
    ...(commaList(args.flags.tag).length ? { tags: commaList(args.flags.tag) } : {}),
  } as unknown as Item;

  assertItem(item);
  warnUnmatchedGlobs(item);
  warnTransientHosts(item);
  addItem(root, item, { shuffle: args.flags.shuffle !== 'false' });
  out(item.id);
  process.stderr.write(
    `stet: queued ${item.id} — ${values.length} option${values.length === 1 ? '' : 's'}` +
      `${item.globs?.length ? `, writes into ${item.globs.join(', ')} are denied until ruled` : ''}\n`,
  );
  // Queue and block in one command, so an agent that asks does not also have to
  // remember to wait — forgetting to wait is how it ends up guessing anyway.
  if (args.flags.wait) await waitFor(item.id, Number(args.flags.timeout) || 0);
}

/**
 * A bare host:port is what people type; without a scheme it resolves as a file
 * beside item.json instead. `localhost:5173` is the awkward one — it is a valid
 * URL whose scheme is `localhost` and whose path is `5173`, which is the same
 * ambiguity a browser address bar has. A colon followed by a digit is a port.
 */
function withScheme(v: string): string {
  // host:port first — a numeric host, a name, or a bracketed IPv6 address.
  if (/^(\[[^\]]+\]|[a-z0-9][a-z0-9.-]*):\d+(?:[/?#]|$)/i.test(v)) return `http://${v}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('/') || v.startsWith('.')) return v;
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?:[/?#]|$)/i.test(v) ? `http://${v}` : v;
}

/**
 * `Number(v) || undefined` reads 0 as "unset". But 0 is a real request — let the
 * operating system pick a free port — and swallowing it sent every caller back
 * to the default, where they raced each other for 7838.
 */
function portOf(v: string | boolean | undefined): number | undefined {
  if (v === undefined || v === true) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`--port ${String(v)} is not a port number`);
  return n;
}

function readOption(file: string): string {
  try {
    return fs.readFileSync(path.resolve(file), 'utf8');
  } catch {
    throw new Error(`cannot read ${file} — --code takes a path to a file`);
  }
}

/** Loopback origins a variant points at — the ones that stop when you do. */
function loopbackOrigins(item: Item): string[] {
  const out = new Set<string>();
  for (const v of item.variants ?? []) {
    for (const b of (v.blocks ?? []) as { href?: string }[]) {
      if (typeof b.href !== 'string') continue;
      try {
        const u = new URL(b.href);
        if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(u.hostname)) out.add(u.origin);
      } catch {
        /* relative — stet copies those in, and they outlive everything */
      }
    }
  }
  return [...out];
}

/**
 * A decision waits for a human, possibly for days. A variant pointing at a dev
 * server does not: when that process stops, the frames render blank and nothing
 * explains why. Variants given as relative paths are copied into the decision
 * and outlive everything, which is the difference worth naming out loud.
 */
function warnTransientHosts(item: Item): void {
  const origins = loopbackOrigins(item);
  if (!origins.length) return;
  process.stderr.write(
    `stet: this decision points at ${origins.join(', ')}, which stops when that server does.\n` +
      `      the human may judge it hours from now and see blank frames. keep it running,\n` +
      `      or pass files stet can copy in — a relative path is absorbed into the decision.\n`,
  );
}

function slug(s: string): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return base || 'decision';
}

/** Never collide with a decision already queued or already made. */
function uniqueId(base: string): string {
  const p = paths(root);
  const taken = (id: string): boolean =>
    fs.existsSync(path.join(p.pending, id)) || fs.existsSync(path.join(p.decided, id));
  if (!taken(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
  throw new Error(`too many decisions named "${base}" — pass --id`);
}

async function ask(): Promise<void> {
  // A question on the command line means the one-line form. Nothing to author,
  // nothing to pipe.
  if (args.rest.length) return askShorthand();
  // Nothing is piped in. Waiting forever is the worst possible answer to the
  // first thing anyone types when working out how this is called.
  if (process.stdin.isTTY || args.flags.help) return schema();
  const raw = await readStdin(30_000);
  if (!raw.trim()) throw new Error('nothing on stdin — pipe an item: stet ask < item.json');
  let item: Item;
  try {
    item = JSON.parse(raw);
  } catch (err) {
    throw new Error(`that is not valid JSON — ${(err as Error).message}`);
  }
  // Report every problem at once. Checking the id alone meant an agent with
  // five things wrong learned about them one command at a time.
  assertItem(item);
  warnUnmatchedGlobs(item);
  warnTransientHosts(item);
  const dir = addItem(root, item, { shuffle: args.flags.shuffle !== 'false' });
  const rel = path.relative(process.cwd(), dir) || dir;
  out(item.id);
  process.stderr.write(`stet: queued ${item.id} — put any assets beside ${rel}/item.json\n`);
}

/**
 * A glob that matches nothing gates nothing, silently. Globs are written
 * relative to the project root, which is not always the directory the author
 * had in mind — claiming `showcase/site/**` from inside a project rooted at
 * `showcase/` produces an item that looks correct everywhere and never fires.
 */
function warnUnmatchedGlobs(item: Item): void {
  for (const g of item.globs ?? []) {
    if (typeof g !== 'string' || !g) continue;
    const literal = g.split(/[*?{[]/)[0].replace(/\/+$/, '');
    if (!literal || fs.existsSync(path.join(root, literal))) continue;

    process.stderr.write(`stet: "${g}" matches nothing under ${root}\n`);
    // The commonest cause: a path written relative to a parent directory.
    const here = path.basename(root);
    if (g.startsWith(`${here}/`)) {
      process.stderr.write(`      this project is rooted at ${here}/ — did you mean "${g.slice(here.length + 1)}"?\n`);
    }
    process.stderr.write('      the decision is queued, but it will not gate any writes.\n');
  }
}

/**
 * The item format, as a working example rather than a grammar. This is what an
 * agent reads before its first `ask`, so it is the whole contract: matched
 * views, a map that never reaches the page, and globs that gate the paths the
 * answer will govern.
 */
function schema(): void {
  out(`
  ${warm('stet ask')}   ${dim('— queue a decision and let the human rule on it')}

  ${cool('Most decisions need no JSON at all.')} One line, nothing to author:

  ${cool('stet ask')} "Which empty state?" "Nothing here yet" "Start a project" ${warm('--wait')}
  ${cool('stet ask')} "Which hero?" ${warm('--url')} localhost:5173/a ${warm('--url')} localhost:5173/b ${warm('--wait')}
  ${cool('stet ask')} "Which spacing?" ${warm('--image')} a.png ${warm('--image')} b.png
  ${cool('stet ask')} "Which shape?" ${warm('--code')} a.ts ${warm('--code')} b.ts

  ${warm('--wait')} blocks until a human rules, then prints the verdict.
  ${warm('--globs')} ${dim("'src/hero/**'")} denies writes into those paths until it is ruled.
  ${warm('--why')} ${dim('"…"')} names what an option really is, if the artifact does not show it.

  ${cool('Show the thing, not a description of it.')} A colour, a layout or a piece of
  interface cannot be judged as a sentence — use ${warm('--url')} or ${warm('--image')} so the
  human sees what you are actually asking about. Text options are for text.

  ${cool('Give it files, not a server you are running.')} A relative path is copied into
  the decision and outlives your session; ${dim('http://localhost:…')} stops when that
  process does, and the human judging it tomorrow sees blank frames.

  ${cool('Never say which one is yours.')} No ${dim('"(current)"')}, no ${dim('"I picked X"')} in the
  question. The labels are shuffled precisely so the human cannot tell; a
  variant that announces itself throws that away and stet will refuse it.

  ${cool('The long form')} ${dim('— stet ask < item.json')} ${dim('— for views, mixed blocks, notes.')}
  Copy it, replace the content, pipe it in.

{
  "id": "hero-type",                        ${dim('// [a-z0-9._-], becomes the directory name')}
  "question": "Which register should the site speak in?",
  "notes": "Same words, same grid — only the type and palette differ.",
  "how": "Press S to flip them in the same frame. Check mobile too.",
  "tags": ["design"],                       ${dim('// optional, groups rules')}
  "globs": ["src/web/**"],                  ${dim('// writes here are DENIED until ruled')}

  "map": {                                  ${dim('// what each label really is —')}
    "A": "serif on warm paper, left-aligned",   ${dim('// never sent to the page')}
    "B": "geometric sans, centred"              ${dim('// until a verdict is recorded')}
  },

  "variants": [
    { "label": "A", "blocks": [
      { "kind": "image", "src": "a-desktop.png", "view": "desktop" },
      { "kind": "image", "src": "a-mobile.png",  "view": "mobile"  },
      { "kind": "text",  "text": "What it costs, honestly." }
    ]},
    { "label": "B", "blocks": [
      { "kind": "image", "src": "b-desktop.png", "view": "desktop" },
      { "kind": "image", "src": "b-mobile.png",  "view": "mobile"  },
      { "kind": "text",  "text": "What this one costs." }
    ]}
  ]
}

  ${cool('blocks')}  code{lang,text} diff{path,text} text{text} image{src} audio{src} url{href}
          ${dim('every block may carry title and view')}

  ${cool('view')}    ${dim('the matched-capture key. Both variants must render the SAME views —')}
          ${dim('same camera, same breakpoint, same screen — so the only difference in')}
          ${dim('the frame is the thing being decided. That is what makes flipping work.')}

  ${cool('assets')}  ${dim('put files beside item.json, or give a path relative to cwd and stet')}
          ${dim('copies them in. They are never sent to the model — the human looks at')}
          ${dim('them in a browser, so the comparison costs no tokens.')}

  ${warm('Then block on it:')}  stet await hero-type   ${dim('— sleeps on a file watch, burns nothing')}

  ${dim('One variant is legal: that is an acceptance gate ("good enough to ship?").')}
  ${dim('Labels are shuffled on intake, so do not assume A is the one you built first.')}
`);
}

// ── await: block on a file watch, burn nothing ────────────────────────────

async function awaitDecision(): Promise<void> {
  const id = args.rest[0];
  if (!validId(id)) throw new Error('usage: stet await <id> [--timeout 3600]');
  return waitFor(id, Number(args.flags.timeout) || 0);
}

/** Block until `id` has a verdict, then print it. Shared with `stet ask --wait`. */
async function waitFor(id: string, timeout: number): Promise<void> {
  const decided = () => {
    const e = findEntry(root, id);
    return e && e.ok && e.state === 'decided' ? e.item : null;
  };

  const now = decided();
  if (now) return report(now);

  const p = paths(root);
  fs.mkdirSync(p.decided, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      watcher.close();
      if (timer) clearTimeout(timer);
      fn();
    };
    // fs.watch is event-driven: a waiting agent consumes no CPU and no tokens.
    const watcher = fs.watch(p.decided, { persistent: true }, () => {
      const item = decided();
      if (item) finish(() => { report(item); resolve(); });
    });
    watcher.on('error', (e) => finish(() => reject(e)));
    const timer = timeout
      ? setTimeout(() => finish(() => reject(new Error(`timed out after ${timeout}s waiting on ${id}`))), timeout * 1000)
      : null;

    // Check once more, now that we are listening. A verdict landing between the
    // first check and this watcher being installed fires no event we can see,
    // and the agent would then block until its timeout for a decision that has
    // already been made. The window is sub-millisecond and was never reproduced
    // in 140 timed attempts — but it is there in the ordering, and closing it
    // costs one stat.
    const late = decided();
    if (late) {
      finish(() => {
        report(late);
        resolve();
      });
    }
  });
}

function report(item: Item): void {
  out(`verdict: ${item.verdict ?? ''}`);
  if (item.because) out(`because: ${item.because.split('\n')[0]}`);
  if (item.rule) out(`rule: ${item.rule}`);
  if (item.revealed) out(`revealed: ${item.revealed}`);
}

// ── the rest ──────────────────────────────────────────────────────────────

function printRules(): void {
  const tags = typeof args.flags.tag === 'string' ? [args.flags.tag] : undefined;
  const sel = selectRules(readRules(root), { budget: Number.MAX_SAFE_INTEGER, tags });
  if (!sel.chosen.length) return out(dim('  no rules yet'));
  for (const r of sel.chosen) {
    out(`${warm(String(r.n).padStart(3))}  ${r.text}`);
    const meta = [r.from ? `from ${r.from}` : '', r.earned, r.tags.join(' ')].filter(Boolean).join('  ·  ');
    if (meta) out(`     ${dim(meta)}`);
  }
  const injected = selectRules(readRules(root), { budget });
  out();
  out(dim(`  ${injected.chosen.length} of ${sel.chosen.length} fit the ${budget}-token budget (~${injected.tokens} est.)`));
}

function doSync(): void {
  const results = args.flags.remove ? unsync(root, {}) : sync(root, readRules(root), { budget });
  for (const r of results) out(`  ${dim(r.action.padEnd(9))} ${r.path}${r.heldBack ? dim(`  (${r.heldBack} held back)`) : ''}`);
  if (!args.flags.remove) {
    const block = renderBlock(selectRules(readRules(root), { budget }));
    out();
    out(dim(`  injected block: ${block.length} chars, ~${selectRules(readRules(root), { budget }).tokens} est. tokens`));
  }
}

/**
 * Take back a verdict. The canon governs every agent the moment a rule lands in
 * it, so a wrong entry is expensive and the only way out used to be deleting a
 * directory and hand-editing RULES.md — a bad answer for a file this tool tells
 * you to treat as the product.
 */
/**
 * What is waiting, and what has been settled — without starting a server.
 *
 * There was no way to ask this. `stet` serves a page and opens a browser, which
 * is the wrong shape for a person mid-session in a terminal, for a slash
 * command, or for anything that wants to render the state somewhere else.
 */
/** Rough and readable; the question is "recently or not", never the exact second. */
function ago(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'seconds ago';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}

async function status(): Promise<void> {
  const pending = listEntries(root, 'pending');
  const rules = readRules(root);
  const broken = pending.filter((e) => !e.ok);
  const ok = pending.filter((e) => e.ok);

  if (args.flags.json) {
    return out(JSON.stringify({
      version: VERSION(),
      root,
      pending: ok.map((e) => (e.ok ? { id: e.id, question: e.item.question, globs: e.item.globs ?? [] } : null)),
      broken: broken.map((e) => ({ id: e.id, error: e.ok ? '' : e.error })),
      rules: rules.length,
      scoped: rules.filter((r) => r.globs.length).length,
    }));
  }

  out();
  out(`  ${warm('stet')} ${dim(VERSION())}  ${dim(path.relative(process.cwd(), root) || '.')}`);
  out();
  if (!ok.length && !broken.length) {
    out(dim('  nothing waiting on you'));
  } else {
    // Width from the content, not a guess: a slug long enough to overflow a
    // fixed column is exactly what `stet ask` generates from a long question.
    const w = Math.max(...[...ok, ...broken].map((e) => e.id.length));
    out(`  ${cool(String(ok.length))} waiting on a verdict`);
    for (const e of ok) {
      if (!e.ok) continue;
      const claims = e.item.globs?.length ? dim(`  claims ${e.item.globs.join(', ')}`) : '';
      out(`    ${warm(e.id.padEnd(w))}  ${e.item.question}${claims}`);
    }
    for (const e of broken) out(`    ${warm(e.id.padEnd(w))}  ${dim(e.ok ? '' : e.error)}`);
  }
  out();
  // A question that was taken back before anyone answered it. Surfaced because
  // the likeliest author of that is an agent unblocking itself, and the person
  // it was addressed to should not have to notice by absence.
  let binned: string[] = [];
  try {
    binned = fs.readdirSync(paths(root).discarded, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    /* none */
  }
  // Probing loopback only, on a decision that already exists: this is why the
  // frames are blank, and nobody could otherwise tell.
  for (const e of ok) {
    if (!e.ok) continue;
    for (const origin of loopbackOrigins(e.item)) {
      const alive = await reachable(origin);
      if (!alive) {
        out();
        out(`  ${warm('!')} ${e.id} shows ${origin}, which is not responding.`);
        out(`    ${dim('its variants will render blank until that server is running again.')}`);
        out();
      }
    }
  }

  if (binned.length) {
    out();
    out(`  ${warm(String(binned.length))} discarded without a verdict ${dim('— .stet/discarded/')}`);
    for (const b of binned) out(`    ${dim(b)}`);
  }

  const scoped = rules.filter((r) => r.globs.length).length;
  out(`  ${cool(String(rules.length))} ${rules.length === 1 ? 'rule' : 'rules'} in the canon${scoped ? dim(`, ${scoped} scoped to paths`) : ''}`);
  if (ok.length) out(dim('  run `stet` to judge them'));

  // Wired but never called is the state everyone lands in right after `stet
  // claude`, and nothing said so — this command reported a healthy, empty
  // project while none of the gate was actually running.
  const { installed } = await import('./claude.js');
  const { lastFired } = await import('./hooks.js');
  if ((installed(root, 'local') || installed(root, 'project')) && !Object.keys(lastFired(root)).length) {
    out();
    out(`  ${warm('!')} wired, but no hook has ever been called here.`);
    out(`    ${dim('Claude Code loads hooks when a session starts — start it in this folder,')}`);
    out(`    ${dim('or exit and run `claude` again if one is already open.')}`);
  }
  out();
}

/**
 * Install the method canon — the rules that would have prevented this project's
 * own recorded failures.
 *
 * Never on `init`. A canon is a claim about what a repository believes, and
 * filling one with claims its owner never made is the thing stet refuses to do
 * everywhere else. Asked for explicitly, or not at all.
 */
async function method(): Promise<void> {
  const { METHOD } = await import('./method.js');
  const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  if (args.flags.list) {
    out();
    for (const r of METHOD) {
      out(`  ${warm('·')} ${r.text}`);
      if (r.globs?.length) out(`    ${dim(`arrives on ${r.globs.join(', ')}`)}`);
    }
    out();
    out(dim(`  ${METHOD.length} rules. \`stet method\` writes them into this repo's canon.`));
    out();
    return;
  }

  init(root);
  const existing = readRules(root).map((r) => norm(r.text));
  let added = 0;
  for (const r of METHOD) {
    if (existing.includes(norm(r.text))) continue;
    appendDirectRule(root, r.text, { tags: r.tags ?? ['method'], globs: r.globs ?? [], note: r.note });
    added++;
  }
  sync(root, readRules(root), { budget });

  out();
  if (!added) {
    out(dim('  already in this canon — nothing to add'));
  } else {
    out(`  ${cool(String(added))} method ${added === 1 ? 'rule' : 'rules'} added to the canon`);
    out(dim('  each one carries the failure it was earned from — read them in .stet/RULES.md'));
    out(dim('  remove any of them with `stet rule remove <n>`'));
  }
  out();
}

/**
 * Record a fact this repository taught, scoped to where it applies.
 *
 * The half of the canon an agent may legitimately write. It cannot decide taste
 * — that is the whole premise — but it is the best possible author of "this is
 * what just cost me an hour", and until now there was nowhere to put that which
 * would ever be read again.
 */
function note(): void {
  if (args.rest[0] === 'remove') {
    const n = Number(args.rest[1]);
    if (!Number.isInteger(n)) throw new Error('usage: stet note remove <n>   (see `stet notes`)');
    const gone = removeNote(root, n);
    if (!gone) throw new Error(`there is no note ${n} — run \`stet notes\` to see what there is`);
    return out(`  ${cool('removed')} ${dim(`note ${n} —`)} ${gone.text}`);
  }

  const text = args.rest.join(' ').trim();
  if (!text) {
    throw new Error(
      'usage: stet note "<what you learned>" --globs \'src/page.ts\'\n' +
        '       a fact about the code, not a preference — a preference is `stet rule`',
    );
  }
  // Scope is required, and that is the point. A note earns its keep by arriving
  // at the moment somebody touches the thing it is about; one with no place to
  // arrive is a document, and documents are what this failed to be three times.
  const globs = commaList(args.flags.globs);
  if (!globs.length) {
    throw new Error(
      'a note needs --globs: it is delivered when somebody touches that path.\n' +
        '       stet note "the second copy of weakness() is here" --globs \'src/page.ts\'',
    );
  }
  const weak = thin(text);
  if (weak) throw new Error(`${weak}\n       got: ${JSON.stringify(text)}`);

  init(root);
  const added = appendNote(root, text, globs);
  out(`  ${warm(String(added.n))}  ${added.text}`);
  out(dim(`  arrives when an agent touches ${globs.join(', ')}`));
}

function printNotes(): void {
  const notes = readNotes(root);
  if (!notes.length) {
    out(dim('  nothing recorded yet'));
    out(dim('  stet note "<what you learned>" --globs \'src/thing.ts\''));
    return;
  }
  for (const n of notes) {
    out(`${warm(String(n.n).padStart(3))}  ${n.text}`);
    out(`     ${dim(`${n.globs.join(' ')}${n.learned ? `  ·  ${n.learned}` : ''}`)}`);
  }
  out();
  out(dim(`  ${notes.length} note${notes.length === 1 ? '' : 's'}. these are facts, not verdicts — nothing here is binding.`));
}

/** Is anything answering there? Short timeout: this is a hint, not a health check. */
async function reachable(origin: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 600);
    await fetch(origin, { signal: ctrl.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

function undo(): void {
  // Named `undo` rather than a second verb because it is one idea: take the
  // decision back a step. Decided goes to pending; pending goes away. Dropping
  // requires the id spelled out — deleting a queued question is not something
  // to do by defaulting to "the last one".
  const named = args.rest[0];
  if (named && findEntry(root, named)?.state === 'pending') return dropPending(named);

  const id = named ?? lastDecided(root)?.id;
  if (!id) {
    const waiting = listEntries(root, 'pending').filter((e) => e.ok);
    throw new Error(waiting.length
      ? `nothing has been decided yet. to discard a question instead: stet undo ${waiting[0].id}`
      : 'nothing has been decided yet');
  }
  const before = readRules(root);
  const item = undecide(root, String(id));
  const earned = before.filter((r) => r.from === id);
  for (const r of earned) removeRule(root, r.n);
  sync(root, readRules(root), { budget });

  out();
  out(`  ${cool('undone')} ${item.id} ${dim('— back in the queue, waiting on a verdict again')}`);
  for (const r of earned) out(`  ${dim('removed rule')} ${r.n} ${dim('—')} ${r.text}`);
  if (!earned.length) out(dim('  no rule had been earned from it'));
  out(dim('  you have seen the reveal, so judging it again will not be blind'));
  out();
}

function editDirectRule(): void {
  const n = Number(args.rest[1]);
  const text = args.rest.slice(2).join(' ').trim();
  if (!Number.isInteger(n) || !text) throw new Error('usage: stet rule edit <n> "<the sharper line>"');
  const before = readRules(root).find((r) => r.n === n);
  if (!before) throw new Error(`there is no rule ${n} — run \`stet rules\` to see what there is`);
  const after = reviseRule(root, n, text);
  sync(root, readRules(root), { budget });
  out(`  ${dim(`was`)} ${dim(before.text)}`);
  out(`  ${warm(String(n))}  ${after.text}`);
  const weak = weakness(after.text);
  if (weak) out(`  ${warm('!')} ${dim(weak)}`);
}

/** A queued question that should not have been asked, and the block it holds. */
function dropPending(id: string): void {
  const item = drop(root, id);
  out();
  out(`  ${cool('discarded')} ${item.id} ${dim('— never decided, nothing earned from it')}`);
  out(dim(`  kept in .stet/discarded/ — nothing is deleted, and \`stet status\` will say so`));
  if (item.globs?.length) out(dim(`  writes into ${item.globs.join(', ')} are no longer denied`));
  out();
}

function removeDirectRule(): void {
  const n = Number(args.rest[1]);
  if (!Number.isInteger(n)) throw new Error('usage: stet rule remove <n>   (see `stet rules` for numbers)');
  const removed = removeRule(root, n);
  if (!removed) throw new Error(`there is no rule ${n} — run \`stet rules\` to see what there is`);
  sync(root, readRules(root), { budget });
  out(`  ${cool('removed')} ${dim(`rule ${n} —`)} ${removed.text}`);
  out(dim('  numbers are not reused; the rules after it keep theirs'));
}

function directRule(): void {
  // `stet rule remove 3` — the canon is the product, so it needs an eraser.
  if (args.rest[0] === 'remove') return removeDirectRule();
  // …and a pencil. Sharpening was reachable only from the page, in the seconds
  // after a reveal. A rule whose wording goes stale a week later could then be
  // deleted or hand-edited, which is the same answer that made `undo` necessary.
  if (args.rest[0] === 'edit') return editDirectRule();
  const text = args.rest.join(' ').trim();
  if (!text) throw new Error('usage: stet rule "never centre the hero" [--globs src/web/**] [--tag design]');
  init(root);
  const tags = commaList(args.flags.tag);
  // A rule with globs is the one that arrives at the moment of the edit rather
  // than sitting in AGENTS.md hoping to be remembered. The canon has always
  // stored them and the gate has always used them; this was simply the one path
  // that could not set them, so the fastest way to record a rule was also the
  // only way that could not scope it.
  const globs = commaList(args.flags.globs);
  const rule = appendDirectRule(root, text, { tags, globs });
  sync(root, readRules(root), { budget });
  out(`  ${warm(String(rule.n))}  ${rule.text}`);
  out(dim(globs.length ? `  arrives when an agent touches ${globs.join(', ')}` : '  in every agent surface in this repo'));
}

function help(): void {
  out(`
  ${warm('stet')} ${dim('— let it stand.')}  ${dim(VERSION())}

  Your agents ask once. Your answer stands.

  ${cool('stet')}                        start it here: serve the decision page, watch, notify
  ${dim('                            (also: stet serve — first run initialises and wires)')}
  ${cool('stet ask')} "<question>" <a> <b>  queue a decision — this is how agents call it
  ${dim('        [--url u --url u] [--image f] [--code f]')}  ${dim('live pages, shots, files')}
  ${dim('        [--globs src/x/**] [--wait]')}          ${dim('claim paths · block for the verdict')}
  ${cool('stet ask')} < item.json        the long form, for anything the flags cannot say
  ${cool('stet init')}                   start a project here, even inside another one
  ${cool('stet capture')} A=<url> B=<url>  matched screenshots of every variant at every view
  ${cool('stet demo')}                   seven real decisions to judge, in a scratch copy
  ${cool('stet schema')}                 the item format, as a worked example
  ${cool('stet status')} [--json]        what is waiting, and how big the canon is
  ${cool('stet await')} <id> [--timeout] block until decided, print the verdict
  ${cool('stet undo')} [<id>]            take back the last verdict, and the rule it earned
  ${dim('                            or, with a pending id: discard that question')}
  ${cool('stet rule')} "<one line>"      record a correction straight into the canon
  ${dim('        [--globs src/web/**]')}   ${dim('scoped: arrives at the moment of a matching write')}
  ${cool('stet rule edit')} <n> "<line>"  sharpen a rule's wording later
  ${cool('stet rule remove')} <n>        delete a rule from the canon
  ${cool('stet note')} "<fact>" --globs   record what this repo taught, delivered where it applies
  ${cool('stet notes')}                    print them  ${dim('·')}  ${cool('stet note remove')} <n>
  ${cool('stet method')} [--list]        install the method canon — eight rules, each
  ${dim('                            earned from a recorded failure in stet\'s own build')}
  ${cool('stet rules')} [--tag design]   print the canon
  ${cool('stet sync')} [--remove]        re-inject rules into agent surfaces, or restore them

  ${cool('stet claude')}                 wire into Claude Code — rules arrive when they apply,
                              and writes into an undecided path are denied
  ${cool('stet claude remove')}          unwire  ${dim('·')}  ${cool('stet claude status')}  check
  ${dim('                            it also adds')} ${cool('/stet')} ${dim('and')} ${cool('/stet-undo')} ${dim('inside the session')}

  ${dim('--budget <tokens>')}           cap the injected block (default ${DEFAULT_BUDGET})
`);
}

/** The commands a settings file has wired, and which event each one serves. */
function wiredCommands(file: string): Array<{ command: string; event: string }> {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const hooks = (settings.hooks ?? {}) as Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
  const found: Array<{ command: string; event: string }> = [];
  for (const list of Object.values(hooks)) {
    for (const entry of list ?? []) {
      for (const h of entry.hooks ?? []) {
        const m = /^(.*?)\s+hook\s+(\S+)\s*$/.exec(h.command ?? '');
        if (m) found.push({ command: `${m[1]} hook events`, event: m[2] });
      }
    }
  }
  return found;
}

type Probe =
  | { ok: true; version: string; events: string[] }
  | { ok: false; why: 'unrunnable' | 'too-old' };

/**
 * Ask a wired command what it can actually do. A stet too old to answer is a
 * different problem from one that will not run, and the fix differs.
 */
function askEvents(command: string): Promise<Probe> {
  return new Promise((done) => {
    let outBuf = '';
    let ran = false;
    const p = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.on('data', (d) => {
      ran = true;
      outBuf += d;
    });
    p.on('error', () => done({ ok: false, why: 'unrunnable' }));
    const timer = setTimeout(() => {
      p.kill();
      done({ ok: false, why: 'unrunnable' });
    }, 5000);
    p.on('close', (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(outBuf.trim());
        if (Array.isArray(parsed.events)) return done({ ok: true, version: String(parsed.version ?? '?'), events: parsed.events });
      } catch {
        /* fall through */
      }
      // Exited cleanly but said nothing: a build that predates event probing.
      done({ ok: false, why: code === 0 || ran ? 'too-old' : 'unrunnable' });
    });
  });
}

/** Is this command actually runnable? A hook that is not, fails silently. */
function resolves(cmd: string): Promise<boolean> {
  return new Promise((done) => {
    const probe = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    probe.on('error', () => done(false));
    probe.on('close', (code) => done(code === 0));
  });
}

function readStdin(timeoutMs = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const timer = timeoutMs
      ? setTimeout(() => done(() => reject(new Error('timed out reading stdin'))), timeoutMs)
      : null;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => done(() => resolve(data)));
    process.stdin.on('error', (e) => done(() => reject(e)));
  });
}
