// stet — notes. What working in this repository taught, as opposed to what its
// owner decided.
//
// The canon holds verdicts: a human looked at two options and chose. Nothing
// held the other half — the facts that were invisible from the code, expensive
// to learn, and cheap to state once known. `weakness()` exists twice, and the
// page has its own copy. `absorbAsset` covers image and audio only. Globs are
// relative to the project root, not to where you are standing.
//
// The evidence that this belongs in a tool rather than in someone's head is
// that three bugs in stet's own build log are bugs that had already been fixed
// *and written up* before being written again — a lazy-loaded element inside a
// collapsed box, a listener attached after the event it waits for, and identity
// inferred from content that varies. The write-up existed each time. It was in
// a document, and a document is not delivered at the moment of the edit.
//
// So a note is stored, scoped and injected exactly like a scoped rule, and
// differs in the two ways that matter:
//
//   a rule is a preference   · binding      · only a human may write one
//   a note is a fact         · informational · an agent writes it the moment it learns it
//
// That second column is the point. An agent cannot decide taste, which is why
// stet exists. But an agent is the best possible author of "here is what just
// cost me an hour", and until now there was nowhere to put it that would ever
// be read again.

import fs from 'node:fs';
import { paths } from './store.js';
import { withLock, writeAtomic } from './lock.js';

export const NOTES_HEADER = `# Notes

What working here taught — facts, not preferences.

A rule is a verdict a human gave and every agent must obey. A note is a landmine
somebody already stepped on. Anything may add one; nothing here is binding.
`;

export interface Note {
  n: number;
  text: string;
  globs: string[];
  learned?: string;
  body: string;
}

export function notesFile(root: string): string {
  return paths(root).notes;
}

export function readNotes(root: string): Note[] {
  try {
    return parseNotes(fs.readFileSync(notesFile(root), 'utf8'));
  } catch {
    return [];
  }
}

export function parseNotes(text: string): Note[] {
  const notes: Note[] = [];
  for (const part of text.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const rest = nl === -1 ? '' : part.slice(nl + 1);
    const m = /^(\d+)\s*[—–-]\s*(.*)$/.exec(heading);
    const n = m ? Number(m[1]) : notes.length + 1;
    const noteText = (m ? m[2] : heading).trim();
    if (!noteText) continue;

    // Same shape as the canon's provenance, and read the same careful way:
    // greedy to the final star, and fields read to the next label rather than
    // to the next full stop, because a full stop is in almost every real glob.
    const prov = /^\s*\*Learned ([^.*]+)\.(.*)\*\s*$/m.exec(rest);
    const tail = prov?.[2] ?? '';
    const globs = (/Globs:\s*(.*?)(?=\s(?:Globs):|$)/.exec(tail)?.[1] ?? '')
      .replace(/\.\s*$/, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    notes.push({
      n,
      text: noteText,
      globs,
      learned: prov?.[1]?.trim(),
      body: rest.split('\n').filter((l) => !/^\s*\*Learned /.test(l)).join('\n').trim(),
    });
  }
  return notes;
}

/**
 * A note that says nothing costs the same tokens as one that says something,
 * and teaches the reader to skip the block. Deliberately lighter than the rule
 * check: a note is allowed to be dull, it is only not allowed to be empty.
 */
export function thin(text: string): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return 'nothing to record';
  if (t.length < 20) return 'too short to be a fact — say what is true and where';
  if (t.includes('?')) return 'a note records something you learned, not something you are asking';
  if (/^(todo|fixme|note:|be careful|careful|watch out|heads up)\b/i.test(t)) {
    return 'say the fact itself — "be careful here" is the part the next agent already knows';
  }
  return null;
}

export function appendNote(root: string, text: string, globs: string[], note?: string): Note {
  const file = notesFile(root);
  return withLock(file, () => {
    const existing = parseNotes(safeRead(file));
    const n = existing.reduce((m, r) => Math.max(m, r.n), 0) + 1;
    const line = text.split('\n')[0].trim().replace(/\s+/g, ' ');
    const date = new Date().toISOString().slice(0, 10);
    const prov = `*Learned ${date}. Globs: ${globs.join(', ')}.*`;
    const body = [text.split('\n').slice(1).join('\n').trim(), note?.trim()].filter(Boolean).join('\n');
    const entry = `\n## ${n} — ${line}\n\n${prov}\n${body ? `\n${body}\n` : ''}`;

    let current = safeRead(file);
    if (!current.trim()) current = NOTES_HEADER;
    writeAtomic(file, current.replace(/\s*$/, '\n') + entry);
    return { n, text: line, globs, learned: date, body };
  });
}

/** Numbers are never reused, for the same reason rules never reuse theirs. */
export function removeNote(root: string, n: number): Note | null {
  const file = notesFile(root);
  return withLock(file, () => {
    const current = safeRead(file);
    const found = parseNotes(current).find((r) => r.n === n);
    if (!found) return null;
    const kept = current
      .split(/(?=^## )/m)
      .filter((part) => !part.startsWith('## ') || parseNotes(part)[0]?.n !== n)
      .join('');
    writeAtomic(file, kept.replace(/\n{3,}$/, '\n'));
    return found;
  });
}

function safeRead(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
