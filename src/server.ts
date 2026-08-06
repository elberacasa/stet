// stet — a local server. node:http, SSE, no dependencies, bound to loopback.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { PAGE } from './page.js';
import { appendRule, bumpHits, readRules, removeRule, reviseRule, ruleLine } from './rules.js';
import { sync } from './sync.js';
import { assetPath, blind, decide, listEntries, paths, revealText, validId } from './store.js';
import type { Entry } from './types.js';

const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

/** The only shape the browser is ever handed. `map` is stripped here. */
export function state(root: string) {
  const pending = listEntries(root, 'pending').map(publicEntry);
  const decided = listEntries(root, 'decided').slice(0, 24).map(publicEntry);
  const rules = readRules(root);
  return {
    repo: path.basename(root),
    pending,
    decided,
    rules: [...rules].reverse(),
    counts: { pending: pending.length, decided: listEntries(root, 'decided').length, rules: rules.length },
  };
}

function publicEntry(e: Entry) {
  if (!e.ok) return { ok: false as const, id: e.id, state: e.state, error: e.error, dir: e.dir };
  // Decided items have earned their reveal; pending ones go out blind.
  const item = e.state === 'decided' ? e.item : blind(e.item);
  return { ok: true as const, id: e.id, state: e.state, item };
}

export interface ServerOpts {
  port?: number;
  host?: string;
  onPending?: (ids: string[]) => void;
  budget?: number;
}

export async function serve(root: string, opts: ServerOpts = {}) {
  const clients = new Set<http.ServerResponse>();
  let known = new Set(listEntries(root, 'pending').map((e) => e.id));

  const push = () => {
    const payload = `event: state\ndata: ${JSON.stringify(state(root))}\n\n`;
    for (const c of clients) c.write(payload);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = decodeURIComponent(url.pathname);

    if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(PAGE);
      return;
    }

    if (req.method === 'GET' && route === '/api/state') {
      json(res, 200, state(root));
      return;
    }

    if (req.method === 'GET' && route === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`retry: 1000\n\n`);
      res.write(`event: state\ndata: ${JSON.stringify(state(root))}\n\n`);
      clients.add(res);
      const beat = setInterval(() => res.write(': beat\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(beat);
        clients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && route === '/api/decide') {
      readBody(req)
        .then((body) => {
          const { id, verdict, because } = JSON.parse(body || '{}');
          if (!validId(id)) return json(res, 400, { error: 'unusable id' });
          const v = String(verdict ?? '').trim();
          const why = String(because ?? '').trim();
          if (!v) return json(res, 400, { error: 'a verdict is required' });
          if (!why) return json(res, 400, { error: 'a reason is required — the reason is the rule' });
          const item = decide(root, id, {
            verdict: v,
            because: why,
            rule: ruleLine(why),
            revealed: '',
          });
          item.revealed = revealText(item);
          fs.writeFileSync(path.join(paths(root).decided, id, 'item.json'), JSON.stringify(item, null, 2) + '\n');
          // Rules in the same area as this decision are demonstrably still live.
          bumpHits(root, item.tags);
          const rule = appendRule(root, item);
          const surfaces = sync(root, readRules(root), { budget: opts.budget });
          known.delete(id);
          push();
          return json(res, 200, { map: item.map, revealed: item.revealed, rule, surfaces, verdict: item.verdict });
        })
        .catch((err) => json(res, 400, { error: String(err?.message ?? err) }));
      return;
    }

    if (req.method === 'POST' && route === '/api/revise') {
      readBody(req)
        .then((body) => {
          const { n, text } = JSON.parse(body || '{}');
          if (!Number.isInteger(n)) return json(res, 400, { error: 'which rule?' });
          // Empty means: this verdict earned no rule. The decision is already
          // recorded and keeps its reason; the canon simply does not take a
          // line that would not work as one. Before this, an empty sharpen box
          // fell back to the original reason — so a screen that had just said
          // "your reason will not work as a rule" wrote exactly that reason.
          if (!String(text ?? '').trim()) {
            const gone = removeRule(root, n);
            const surfaces = sync(root, readRules(root), { budget: opts.budget });
            push();
            return json(res, 200, { rule: null, removed: gone, surfaces });
          }
          const rule = reviseRule(root, n, String(text ?? ''));
          const surfaces = sync(root, readRules(root), { budget: opts.budget });
          push();
          return json(res, 200, { rule, surfaces });
        })
        .catch((err) => json(res, 400, { error: String(err?.message ?? err) }));
      return;
    }

    const asset = /^\/a\/([^/]+)\/(.+)$/.exec(route);
    if (req.method === 'GET' && asset) {
      const file = assetPath(root, asset[1], asset[2]);
      if (!file) {
        res.writeHead(404).end('not found');
        return;
      }
      // Media elements need a length and byte ranges — without them <audio>
      // and <video> stall at readyState 0 and never play.
      const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      const size = fs.statSync(file).size;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (!(start >= 0 && start <= end && end < size)) {
          res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
          return;
        }
        res.writeHead(206, {
          'content-type': type,
          'content-length': end - start + 1,
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, {
        'content-type': type,
        'content-length': size,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (route === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });

  const p = paths(root);
  const watchers = [p.pending, p.decided].map((dir) => {
    try {
      return fs.watch(dir, { persistent: true }, debounce(() => {
        const now = new Set(listEntries(root, 'pending').map((e) => e.id));
        const fresh = [...now].filter((id) => !known.has(id));
        known = now;
        push();
        if (fresh.length && opts.onPending) opts.onPending(fresh);
      }));
    } catch {
      return null;
    }
  });

  const port = await listen(server, opts.port ?? 7838, opts.host ?? '127.0.0.1');
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}/`,
    close() {
      for (const w of watchers) w?.close();
      for (const c of clients) c.end();
      server.close();
    },
  };
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function debounce(fn: () => void, ms = 80) {
  let t: NodeJS.Timeout | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
    t.unref?.();
  };
}

/** Takes the next free port if the preferred one is busy. */
function listen(server: http.Server, port: number, host: string, tries = 12): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (p: number, left: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && left > 0) {
          server.removeListener('error', onError);
          attempt(p + 1, left - 1);
        } else reject(err);
      };
      server.once('error', onError);
      server.listen(p, host, () => {
        server.removeListener('error', onError);
        resolve((server.address() as AddressInfo).port);
      });
    };
    attempt(port, tries);
  });
}
