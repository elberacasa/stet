import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
http.createServer((q, r) => {
  const f = path.join(dir, q.url === '/' ? 'variant-a.html' : q.url.split('?')[0]);
  try { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync(f)); }
  catch { r.writeHead(404); r.end('no'); }
}).listen(7900, '127.0.0.1', () => console.log('serving variants on 7900'));
