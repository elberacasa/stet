// Adversarial stress test for the server and the page it serves.
// Items are authored by an agent, so their contents are untrusted input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..');
const { init } = await import(`${REPO}/dist/store.js`);
const { serve, state } = await import(`${REPO}/dist/server.js`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-srv-'));
init(root);
const fail = [];
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!cond) fail.push(name);
};

function put(id, item) {
  const dir = path.join(root, '.stet', 'pending', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'item.json'), JSON.stringify({ id, ...item }));
}
// Sentinels, so a leak is unambiguous and cannot be confused with prose.
const SECRET_A = 'MAPSECRET-ALPHA';
const SECRET_B = 'MAPSECRET-BETA';
const twoVariants = (extra = {}) => ({
  created: '2026-08-06T10:00:00Z',
  question: 'Which one?',
  map: { A: SECRET_A, B: SECRET_B },
  variants: [
    { label: 'A', blocks: [{ kind: 'text', text: 'one' }] },
    { label: 'B', blocks: [{ kind: 'text', text: 'two' }] },
  ],
  ...extra,
});

const server = await serve(root, { port: 0 });
const base = server.url.replace(/\/$/, '');
const get = (p) => fetch(`${base}${p}`);
const post = (p, body) =>
  fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

try {
  // ── 1. two tabs deciding the same item ─────────────────────────────────
  console.log('\n1. two tabs commit the same decision at once');
  {
    put('contested', twoVariants());
    const [a, b] = await Promise.all([
      post('/api/decide', { id: 'contested', verdict: 'A', because: 'the first tab decided this' }),
      post('/api/decide', { id: 'contested', verdict: 'B', because: 'the second tab decided this' }),
    ]);
    const codes = [a.status, b.status].sort();
    ok('exactly one commit wins', codes[0] === 200 && codes[1] >= 400, `statuses ${codes.join(' and ')}`);
    const md = fs.readFileSync(path.join(root, '.stet', 'RULES.md'), 'utf8');
    const n = (md.match(/^## /gm) ?? []).length;
    ok('only one rule is written', n === 1, `${n} rules in the canon`);
    ok('the item is decided exactly once', fs.existsSync(path.join(root, '.stet/decided/contested')) &&
      !fs.existsSync(path.join(root, '.stet/pending/contested')));
  }

  // ── 2. script in an agent-authored item ────────────────────────────────
  console.log('\n2. hostile item content reaching the page');
  {
    put('xss', twoVariants({
      question: '<script>window.__pwned=1</script>',
      notes: '<img src=x onerror="window.__pwned=2">',
      variants: [
        { label: 'A', blocks: [{ kind: 'text', text: '</pre><script>window.__pwned=3</script>' }] },
        { label: 'B', blocks: [{ kind: 'url', href: 'javascript:window.__pwned=4', title: 'click me' }] },
      ],
    }));
    const body = await (await get('/api/state')).text();
    // The page renders from this JSON, so the payload must survive as data…
    ok('hostile strings are carried as data, not stripped', body.includes('__pwned'));
    // …and the page must be the thing that neutralises them. Check the renderer.
    const page = await (await get('/')).text();
    ok('the renderer escapes before inserting', /function esc\(/.test(page) && page.includes('replace(/&/g'));
    ok('no javascript: URL is emitted by the page source', !/href="\s*javascript:/i.test(page));
    // The scheme guard must be deliberate. Before it existed, a javascript:
    // href was defused only because asset() failed to recognise the scheme and
    // turned it into a relative path — defence by accident, which stops working
    // the moment that check is widened.
    ok('URL schemes are refused on purpose, not by accident', page.includes('function safeUrl('));
  }

  // ── 3. an item that cannot be parsed ───────────────────────────────────
  console.log('\n3. an unparseable item');
  {
    const dir = path.join(root, '.stet', 'pending', 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'item.json'), '{ not json at all');
    const s = await (await get('/api/state')).json();
    const bad = s.pending.filter((e) => !e.ok);
    ok('it is surfaced, never skipped', bad.length === 1, `${bad.length} broken entries reported`);
    ok('with a reason a human can act on', typeof bad[0]?.error === 'string' && bad[0].error.length > 10);
    ok('and it does not take the good ones down', s.pending.some((e) => e.ok));
  }

  // ── 4. many live SSE clients ───────────────────────────────────────────
  console.log('\n4. many browser tabs listening at once');
  {
    const ctrls = [];
    const opened = [];
    for (let i = 0; i < 25; i++) {
      const c = new AbortController();
      ctrls.push(c);
      opened.push(fetch(`${base}/events`, { signal: c.signal }).then((r) => r.status).catch(() => 0));
    }
    const codes = await Promise.all(opened);
    ok('every tab is served', codes.every((c) => c === 200), `${codes.filter((c) => c === 200).length}/25`);
    // the server must still answer normal requests while they are held open
    const t0 = Date.now();
    const s = await get('/api/state');
    ok('the server still responds with 25 held open', s.status === 200, `${Date.now() - t0}ms`);
    for (const c of ctrls) c.abort();
    await new Promise((r) => setTimeout(r, 300));
    const after = await get('/api/state');
    ok('and after they all disconnect', after.status === 200);
  }

  // ── 5. a burst of new decisions ────────────────────────────────────────
  console.log('\n5. a fan-out queueing decisions in a burst');
  {
    for (let i = 0; i < 40; i++) put(`burst-${i}`, twoVariants());
    await new Promise((r) => setTimeout(r, 400));
    const t0 = Date.now();
    const s = await (await get('/api/state')).json();
    const ms = Date.now() - t0;
    ok('all of them are listed', s.pending.filter((e) => e.ok && e.id.startsWith('burst-')).length === 40);
    ok('state stays fast', ms < 500, `${ms}ms for ${s.pending.length} pending`);
  }

  // ── 6. the blind guarantee, under everything above ─────────────────────
  console.log('\n6. the blind guarantee');
  {
    const parsed = JSON.parse(await (await get('/api/state')).text());
    const leaked = parsed.pending.filter((e) => e.ok && 'map' in e.item);
    ok('no pending item ever carries its map', leaked.length === 0, `${parsed.pending.length} pending checked`);
    ok('decided items do carry it — they were earned', parsed.decided.every((e) => !e.ok || 'map' in e.item));
    // Serialise the pending half alone: the decided half is allowed the secret,
    // so searching the whole payload would flag correct behaviour as a leak.
    const pendingOnly = JSON.stringify(parsed.pending);
    ok('no map text reaches the page by any other route',
      !pendingOnly.includes(SECRET_A) && !pendingOnly.includes(SECRET_B),
      `${parsed.pending.length} pending serialised and searched`);
  }

  // ── 7. malformed and hostile requests ──────────────────────────────────
  console.log('\n7. malformed requests');
  {
    const cases = [
      ['POST /api/decide with no body', () => fetch(`${base}/api/decide`, { method: 'POST' })],
      ['POST /api/decide with garbage', () => post('/api/decide', undefined)],
      ['decide an id that does not exist', () => post('/api/decide', { id: 'nope', verdict: 'A', because: 'x' })],
      ['decide with no verdict', () => post('/api/decide', { id: 'burst-1', verdict: '', because: 'x' })],
      ['decide with no reason', () => post('/api/decide', { id: 'burst-1', verdict: 'A', because: '' })],
      ['revise a rule that does not exist', () => post('/api/revise', { n: 9999, text: 'nope' })],
      ['revise with no number', () => post('/api/revise', { text: 'nope' })],
      ['an unknown route', () => get('/../../etc/passwd')],
      ['an asset outside the item', () => get('/a/burst-1/../../../RULES.md')],
      ['an asset that does not exist', () => get('/a/burst-1/nope.png')],
    ];
    let crashed = 0;
    for (const [name, fn] of cases) {
      try {
        const r = await fn();
        if (r.status >= 500) crashed++;
      } catch {
        crashed++;
      }
    }
    ok('nothing returns 500 or drops the connection', crashed === 0, `${cases.length} cases`);
    ok('the server is still alive afterwards', (await get('/api/state')).status === 200);
  }

  // ── 8. a decision arriving while one is being committed ────────────────
  console.log('\n8. a new decision lands mid-commit');
  {
    const before = state(root).counts.rules;
    const committing = post('/api/decide', { id: 'burst-2', verdict: 'A', because: 'committed while another arrived' });
    put('late-arrival', twoVariants());
    const r = await committing;
    ok('the commit is unaffected', r.status === 200);
    await new Promise((res) => setTimeout(res, 300));
    const s = state(root);
    ok('exactly one rule was added', s.counts.rules === before + 1, `${before} → ${s.counts.rules}`);
    ok('the late arrival is listed', s.pending.some((e) => e.ok && e.id === 'late-arrival'));
  }
} finally {
  server.close();
}

console.log(`\n${fail.length ? `FAILED: ${fail.join(', ')}` : 'all server stress checks passed'}`);
fs.rmSync(root, { recursive: true, force: true });
process.exit(fail.length ? 1 : 0);
