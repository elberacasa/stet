#!/usr/bin/env node
// stet — the command. Hand-rolled arg parsing, zero dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { appendDirectRule, DEFAULT_BUDGET, readRules, renderBlock, selectRules } from './rules.js';
import { notify, open } from './notify.js';
import { serve } from './server.js';
import { addItem, findEntry, findRoot, init, listEntries, paths, validId } from './store.js';
import { sync, unsync } from './sync.js';
import type { Item } from './types.js';

const VERSION = '0.1.0';

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
    case 'version':
    case '--version':
      return out(VERSION);
    default:
      return help();
  }
}

// ── the default command: everything ───────────────────────────────────────

async function run(): Promise<void> {
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
  const raw = await readStdin();
  if (!raw.trim()) throw new Error('nothing on stdin — pipe an item: stet ask < item.json');
  let item: Item;
  try {
    item = JSON.parse(raw);
  } catch (err) {
    throw new Error(`that is not valid JSON — ${(err as Error).message}`);
  }
  if (!validId((item as { id?: unknown }).id)) throw new Error('the item needs an "id" of letters, digits, . _ or -');
  const dir = addItem(root, item, { shuffle: args.flags.shuffle !== 'false' });
  const rel = path.relative(process.cwd(), dir) || dir;
  out(item.id);
  process.stderr.write(`stet: queued ${item.id} — put any assets beside ${rel}/item.json\n`);
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
  ${cool('stet await')} <id> [--timeout] block until decided, print the verdict
  ${cool('stet rule')} "<one line>"      record a correction straight into the canon
  ${cool('stet rules')} [--tag design]   print the canon
  ${cool('stet sync')} [--remove]        re-inject rules into agent surfaces, or restore them

  ${dim('--budget <tokens>')}           cap the injected block (default ${DEFAULT_BUDGET})
`);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
