// stet — glob matching. Hand-rolled: this decides whether a rule applies to a
// file and whether a pending decision blocks a write, so it runs inside a
// PreToolUse hook on every tool call.
//
// It deliberately does not compile to a RegExp. `**/` becomes a nested
// quantifier, and nesting a few of them — `a/**/**/**/**/b`, which is a typo
// away — costs eight times more per level. Ten of them takes minutes, and it
// would take them on every write in the session. What follows is the classic
// linear wildcard match with a single backtrack point, which has no such cliff.

const HAS_MAGIC = /[*?{[]/;

/** Repo-relative, forward slashes, no leading ./ */
export function normalise(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Where the token starting at `i` ends: a char class counts as one token. */
function tokenEnd(pat: string, i: number): number {
  if (pat[i] !== '[') return i + 1;
  let j = i + 1;
  if (pat[j] === '!' || pat[j] === '^') j++;
  if (pat[j] === ']') j++; // a leading ] is a literal
  while (j < pat.length && pat[j] !== ']') j++;
  return j < pat.length ? j + 1 : i + 1; // unclosed [ is a literal [
}

/** Does the single token starting at `i` match character `c`? */
function tokenMatches(pat: string, i: number, c: string): boolean {
  if (pat[i] === '?') return true;
  if (pat[i] !== '[') return pat[i] === c;
  const end = tokenEnd(pat, i);
  if (end === i + 1) return pat[i] === c; // unclosed
  let j = i + 1;
  let negate = false;
  if (pat[j] === '!' || pat[j] === '^') {
    negate = true;
    j++;
  }
  let hit = false;
  for (; j < end - 1; j++) {
    if (pat[j + 1] === '-' && j + 2 < end - 1) {
      if (c >= pat[j] && c <= pat[j + 2]) hit = true;
      j += 2;
    } else if (pat[j] === c) hit = true;
  }
  return negate ? !hit : hit;
}

/**
 * One path segment. `*` matches any run of characters except `/`.
 * Linear with one backtrack point — no nested quantifiers, so no cliff.
 */
function segment(pat: string, str: string): boolean {
  let p = 0;
  let s = 0;
  let starP = -1;
  let starS = 0;
  while (s < str.length) {
    if (p < pat.length && pat[p] === '*') {
      starP = ++p;
      starS = s;
      continue;
    }
    if (p < pat.length && tokenMatches(pat, p, str[s])) {
      p = tokenEnd(pat, p);
      s++;
      continue;
    }
    if (starP !== -1) {
      p = starP;
      s = ++starS;
      continue;
    }
    return false;
  }
  while (p < pat.length && pat[p] === '*') p++;
  return p === pat.length;
}

/**
 * Segment lists, with `**` spanning any number of directories including none.
 * Same shape as `segment`: one backtrack point, no recursion.
 */
function segments(pat: string[], str: string[]): boolean {
  let p = 0;
  let s = 0;
  let starP = -1;
  let starS = 0;
  while (s < str.length) {
    if (p < pat.length && pat[p] === '**') {
      starP = ++p;
      starS = s;
      continue;
    }
    if (p < pat.length && segment(pat[p], str[s])) {
      p++;
      s++;
      continue;
    }
    if (starP !== -1) {
      p = starP;
      s = ++starS;
      continue;
    }
    return false;
  }
  while (p < pat.length && pat[p] === '**') p++;
  return p === pat.length;
}

/** `{a,b}` alternatives, capped so nested braces cannot explode. */
export function expand(pattern: string, cap = 64): string[] {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === '{') depth++;
    else if (pattern[i] === '}' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) return [pattern];

  const head = pattern.slice(0, open);
  const tail = pattern.slice(close + 1);
  const parts: string[] = [];
  let level = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    if (pattern[i] === '{') level++;
    else if (pattern[i] === '}') level--;
    else if (pattern[i] === ',' && level === 0) {
      parts.push(pattern.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(pattern.slice(start, close));

  const out: string[] = [];
  for (const part of parts) {
    for (const rest of expand(head + part.trim() + tail, cap)) {
      out.push(rest);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

export function matches(glob: string, filePath: string): boolean {
  const g = normalise(glob);
  const p = normalise(filePath);
  if (!g) return false;
  // A plain directory name governs everything under it — `src/api` is the
  // obvious way to write it and should not silently match nothing.
  if (!HAS_MAGIC.test(g)) return p === g || p.startsWith(`${g}/`);

  const target = p.split('/');
  for (const alt of expand(g)) {
    if (segments(alt.split('/'), target)) return true;
    // `src/**` written without a trailing segment still covers everything below
    if (alt.endsWith('/**') && p.startsWith(`${alt.slice(0, -3)}/`)) return true;
  }
  return false;
}

export function matchesAny(globs: string[] | undefined, filePath: string): boolean {
  if (!Array.isArray(globs)) return false;
  return globs.some((g) => typeof g === 'string' && matches(g, filePath));
}
