// Items are written by agents, so malformed input is the normal case, not the
// exceptional one. Every failure here used to be either a TypeError naming an
// internal property — `Cannot read properties of undefined (reading 'A')` —
// or, worse, silent acceptance: a decision with one option, a decision with no
// question, a block of a kind nothing renders. Those queued successfully and
// produced a decision screen the human could not act on.
//
// The messages are written to be read by whatever wrote the item, so each one
// says what is wrong and what to do instead.
import type { Item } from './types.js';

/** Required fields per block kind, keyed by the `kind` an item may declare. */
const BLOCK_FIELDS: Record<string, string[]> = {
  code: ['text'],
  diff: ['text'],
  text: ['text'],
  image: ['src'],
  audio: ['src'],
  url: ['href'],
};

const KINDS = Object.keys(BLOCK_FIELDS);
const ID = /^[a-z0-9._-]+$/;

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Every problem with an item, in the order a person would fix them. Empty means
 * it is safe to queue.
 */
export function problems(input: unknown): string[] {
  const out: string[] = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return ['the item must be a JSON object — see `stet schema` for a worked example'];
  }
  const item = input as Partial<Item> & Record<string, unknown>;

  if (!isStr(item.id)) out.push('"id" is required — a short slug like "hero-type"; it becomes the directory name');
  else if (!ID.test(item.id)) out.push(`"id" may only contain a-z, 0-9, dot, dash and underscore — got ${JSON.stringify(item.id)}`);

  if (!isStr(item.question)) {
    out.push('"question" is required — the one line the human reads before choosing');
  }

  const variants = item.variants;
  if (!Array.isArray(variants)) {
    out.push('"variants" is required — an array of what the human is choosing between');
  } else if (variants.length === 0) {
    // One variant is deliberate and documented: it is the "good enough to
    // ship?" gate, where the verdict is accept or reject rather than A or B.
    // Zero is the only count that cannot mean anything.
    out.push('"variants" is empty — give at least one thing to rule on');
  } else {
    const labels: string[] = [];
    variants.forEach((v, i) => {
      const where = `variants[${i}]`;
      if (v === null || typeof v !== 'object') return void out.push(`${where} must be an object with "label" and "blocks"`);
      const variant = v as unknown as Record<string, unknown>;
      if (!isStr(variant.label)) out.push(`${where}.label is required — usually "A" and "B"`);
      else labels.push(variant.label);
      if (!Array.isArray(variant.blocks)) {
        out.push(`${where}.blocks is required — an array of blocks; use [] if this variant is described only by the map`);
      } else {
        variant.blocks.forEach((b, j) => {
          const at = `${where}.blocks[${j}]`;
          if (b === null || typeof b !== 'object') return void out.push(`${at} must be an object with a "kind"`);
          const block = b as unknown as Record<string, unknown>;
          const kind = block.kind;
          if (!isStr(kind) || !KINDS.includes(kind)) {
            // Silently accepted before, and the page renders nothing for it —
            // an empty variant with no error anywhere.
            out.push(`${at}.kind ${JSON.stringify(kind ?? null)} is not one of: ${KINDS.join(', ')}`);
            return;
          }
          for (const field of BLOCK_FIELDS[kind]) {
            if (!isStr(block[field])) out.push(`${at} is a ${kind} block, so it needs a non-empty "${field}"`);
          }
        });
      }
    });
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
    if (dupes.length) out.push(`two variants share the label ${JSON.stringify(dupes[0])} — labels must be distinct`);

    // The map is what the human is told after they choose. Without it the
    // reveal is empty and the blind test has nothing to reveal, which is the
    // entire point of the exercise.
    const map = item.map;
    if (map === null || typeof map !== 'object' || Array.isArray(map)) {
      out.push('"map" is required — what each label really is, e.g. {"A":"serif, left-aligned","B":"sans, centred"}. It is never sent to the page before a verdict.');
    } else {
      for (const label of labels) {
        if (!isStr((map as Record<string, unknown>)[label])) {
          out.push(`"map" has no entry for variant ${JSON.stringify(label)} — the reveal would tell the human nothing`);
        }
      }
    }
  }

  for (const key of ['globs', 'tags'] as const) {
    const v = item[key];
    if (v !== undefined && (!Array.isArray(v) || v.some((s) => !isStr(s)))) {
      out.push(`"${key}" must be an array of strings`);
    }
  }
  return out;
}

/** Throws with every problem at once, so a caller fixes one round, not five. */
export function assertItem(input: unknown): asserts input is Item {
  const found = problems(input);
  if (!found.length) return;
  throw new Error(
    `this item cannot be queued:\n` +
      found.map((p) => `       · ${p}`).join('\n') +
      `\n       run \`stet schema\` for a worked example`,
  );
}
