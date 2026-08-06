#!/usr/bin/env node
// stet — the command. Hand-rolled arg parsing, zero dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendDirectRule, DEFAULT_BUDGET, readRules, renderBlock, selectRules } from './rules.js';
import { notify, open } from './notify.js';
// server.ts pulls in the 39KB page document. The hook path runs on every tool
// call, so it is imported lazily and only by the command that serves.
import { addItem, findEntry, findRoot, init, listEntries, paths, validId } from './store.js';
import { sync, unsync } from './sync.js';
import type { Item } from './types.js';

const VERSION = '0.12.0';

interface Args {
  cmd: string;
  rest: string[];
  flags: Record<string, string | boolean>;
}

function parse(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('-')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else rest.push(a);
  }
  return { cmd: rest[0] ?? '', rest: rest.slice(1), flags };
}

const args = parse(process.argv.slice(2));
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
  switch (args.cmd) {
    case '':
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
    case 'version':
    case '--version':
      return out(VERSION);
    case 'help':
    case '--help':
    case '-h':
      return help();
    default:
      // Printing help for an unknown command reads as success. It is how an
      // older global install silently ignores a command it has never heard of.
      process.stderr.write(`stet: unknown command "${args.cmd}" (this is stet ${VERSION})\n`);
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
    out(JSON.stringify({ version: VERSION, events: EVENTS }));
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

async function claude(): Promise<void> {
  const { install, installed, uninstall, WIRING } = await import('./claude.js');
  // Local by default. A checked-in hook pointing at a binary a teammate has
  // not installed fails on every tool call and gates nothing — the repo would
  // claim a protection it is not providing, which is worse than no protection.
  // `--project` opts into the shared form once the team has stet.
  const scope = args.flags.project ? 'project' : 'local';
  const sub = args.rest[0] ?? 'install';

  if (sub === 'remove' || args.flags.remove) {
    const r = uninstall(root, scope);
    out(r.removed.length ? `  ${cool('removed')} ${r.removed.length} hook(s) from ${path.relative(root, r.file)}` : dim('  nothing wired'));
    return;
  }
  if (sub === 'status') {
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
    return;
  }

  // A hook that cannot be found fails quietly and the gate silently does not
  // exist — which is worse than not installing it. Resolve it now, and pin an
  // absolute path if `stet` is not on PATH.
  let command = args.flags.command ? String(args.flags.command) : '';
  if (!command) {
    const onPath = await resolves('stet');
    command = onPath ? 'stet' : `${process.execPath} ${fileURLToPath(new URL('../bin/stet.js', import.meta.url))}`;
    if (!onPath) {
      process.stderr.write(`stet: not on PATH, so the hook is pinned to this checkout.\n` +
        `      after \`npm i -g stetmark\`, re-run \`stet claude\` to use the short form.\n`);
    }
  }
  const r = install(root, scope, command);
  out();
  out(`  ${warm('stet')} is now a gate in this repo, not a suggestion.`);
  out();
  for (const w of WIRING) out(`  ${cool(w.event.padEnd(13))} ${dim(w.why)}`);
  out();
  out(`  ${dim('written to')} ${path.relative(root, r.file) || r.file}`);

  // Wiring is written by whichever stet you ran; the hooks call whichever stet
  // is on PATH. Those are not always the same build.
  const probe = await askEvents(`${command} hook events`);
  const need = WIRING.map((w) => w.arg);
  const missing = probe.ok ? need.filter((e) => !probe.events.includes(e)) : need;
  if (missing.length) {
    out();
    out(`  ${warm('!')} ${probe.ok
      ? `the stet these hooks call is ${probe.version}, which does not implement:`
      : 'the stet these hooks call is older than this one, and does not implement:'}`);
    out(`    ${missing.join(', ')}`);
    out(`    they will fire and do nothing. ${cool('npm i -g stetmark@latest')}${dim(', then re-run stet claude')}`);
  }
  out(`  ${dim('undo with')} stet claude remove`);
  out();
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
    port: Number(args.flags.port) || undefined,
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

async function ask(): Promise<void> {
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
  if (!validId((item as { id?: unknown }).id)) throw new Error('the item needs an "id" of letters, digits, . _ or -');
  warnUnmatchedGlobs(item);
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
  ${warm('stet ask')} ${dim('< item.json')}   ${dim('— queue a decision and let the human rule on it')}

  ${cool('A worked example.')} Copy it, replace the content, pipe it in.

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
  const timeout = Number(args.flags.timeout) || 0;

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

function directRule(): void {
  const text = args.rest.join(' ').trim();
  if (!text) throw new Error('usage: stet rule "never centre the hero" [--tag design]');
  init(root);
  const tags = typeof args.flags.tag === 'string' ? args.flags.tag.split(',').map((s) => s.trim()) : [];
  const rule = appendDirectRule(root, text, { tags });
  sync(root, readRules(root), { budget });
  out(`  ${warm(String(rule.n))}  ${rule.text}`);
  out(dim('  in every agent surface in this repo'));
}

function help(): void {
  out(`
  ${warm('stet')} ${dim('— let it stand.')}  ${dim(VERSION)}

  Your agents ask once. Your answer stands.

  ${cool('stet')}                        init, wire agent surfaces, serve, watch, notify
  ${cool('stet ask')} < item.json        queue a decision — this is how agents call it
  ${cool('stet init')}                   start a project here, even inside another one
  ${cool('stet capture')} A=<url> B=<url>  matched screenshots of every variant at every view
  ${cool('stet schema')}                 the item format, as a worked example
  ${cool('stet await')} <id> [--timeout] block until decided, print the verdict
  ${cool('stet rule')} "<one line>"      record a correction straight into the canon
  ${cool('stet rules')} [--tag design]   print the canon
  ${cool('stet sync')} [--remove]        re-inject rules into agent surfaces, or restore them

  ${cool('stet claude')}                 wire into Claude Code — rules arrive when they apply,
                              and writes into an undecided path are denied
  ${cool('stet claude remove')}          unwire  ${dim('·')}  ${cool('stet claude status')}  check

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
