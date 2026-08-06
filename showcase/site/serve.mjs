// Serves the showcase pages for capture and review.
//
// Read the file BEFORE writing any header. The first version wrote 200 and
// then read; a missing file threw after the headers were already sent, the
// catch wrote them a second time, and ERR_HTTP_HEADERS_SENT took the whole
// server down. That is why it kept dying between captures.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http
  .createServer((req, res) => {
    // Strip the query first. Checking for '/' before stripping meant '/?v=2'
    // resolved to the directory itself and was refused by the traversal guard,
    // so any cache-busting link 403'd.
    const clean = req.url.split('?')[0].split('#')[0];
    const rel = clean === '/' ? '/index.html' : clean;
    const file = path.join(dir, decodeURIComponent(rel));
    if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('no');
      return;
    }
    let body;
    try {
      body = fs.readFileSync(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    res.end(body);
  })
  .listen(7900, '127.0.0.1', () => console.log('showcase on http://127.0.0.1:7900/'));
