// stet — glob matching. Hand-rolled: this decides whether a rule applies to a
// file and whether a pending decision blocks a write, so it runs on every tool
// call and must not pull in a dependency.

const SPECIAL = /[.+^${}()|[\]\\]/g;

function escapeRe(s: string): string {
  return s.replace(SPECIAL, '\\$&');
}

/** Supports `**`, `*`, `?`, `{a,b}` and character classes. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` crosses directories and also matches zero of them.
        if (glob[i + 2] === '/') {
          re += '(?:[^/]*\\/)*';
          i += 3;
          continue;
        }
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      i++;
      continue;
    }
    if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end !== -1) {
        re += `(?:${glob.slice(i + 1, end).split(',').map((p) => escapeRe(p.trim())).join('|')})`;
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const end = glob.indexOf(']', i);
      if (end !== -1) {
        re += glob.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    re += escapeRe(c);
    i++;
  }
  return new RegExp(`^${re}$`);
}

const HAS_MAGIC = /[*?{[]/;

/** Repo-relative, forward slashes, no leading ./ */
export function normalise(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function matches(glob: string, path: string): boolean {
  const g = normalise(glob);
  const p = normalise(path);
  if (!g) return false;
  // A plain directory name governs everything under it — `src/api` is the
  // obvious way to write it and should not silently match nothing.
  if (!HAS_MAGIC.test(g)) return p === g || p.startsWith(`${g}/`);
  if (globToRegExp(g).test(p)) return true;
  // `src/**` should also cover `src/a/b.ts` when written without the trailing slash form
  if (g.endsWith('/**') && p.startsWith(`${g.slice(0, -3)}/`)) return true;
  return false;
}

export function matchesAny(globs: string[] | undefined, path: string): boolean {
  return !!globs?.some((g) => matches(g, path));
}
