// Small text helpers shared across commands.

/**
 * `--globs 'a/**, b/**'` → `['a/**', 'b/**']`.
 *
 * This existed five times across three files with three different parameter
 * names, and not all of them guarded the non-string case — so `--tag` with no
 * value threw where `--globs` with no value returned nothing. One copy, one
 * behaviour: anything that is not a string is no items.
 */
export function commaList(v: unknown): string[] {
  return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
