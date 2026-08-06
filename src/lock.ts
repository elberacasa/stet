// stet — a file lock, so parallel agents cannot corrupt the canon.
//
// RULES.md is read-modify-write on every path that touches it: append reads the
// file to find the next number, revise rewrites one heading, bumpHits rewrites
// provenance lines. With one agent that is fine. With twenty running at once —
// a fan-out workflow, parallel subagents, two terminals — it loses updates and
// duplicates rule numbers. Measured before this existed: twenty concurrent
// writes produced sixteen rules with ten distinct numbers.
//
// `open(…, 'wx')` fails if the path exists, and that check-and-create is atomic
// at the filesystem, which is the whole mechanism. No dependency, and it works
// across processes rather than only within one.

import fs from 'node:fs';
import path from 'node:path';

/** Sleep without a dependency and without spinning a CPU. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface LockOpts {
  /** Give up acquiring after this long. */
  timeoutMs?: number;
  /** A lock older than this is assumed to belong to a process that died. */
  staleMs?: number;
}

/**
 * Runs `fn` with an exclusive lock on `file`. Always releases, including when
 * `fn` throws — a leaked lock would wedge every later write.
 */
export function withLock<T>(file: string, fn: () => T, opts: LockOpts = {}): T {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const staleMs = opts.staleMs ?? 20_000;
  const lock = `${file}.lock`;
  const started = Date.now();
  let fd: number | null = null;

  for (;;) {
    try {
      fs.mkdirSync(path.dirname(lock), { recursive: true });
      fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Someone holds it. If they died holding it, take it.
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue; // it vanished between the check and the stat — try again
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out waiting for ${path.basename(lock)} — another stet is holding it`);
      }
      sleep(15 + Math.floor(Math.random() * 25)); // jitter, so waiters do not sync up
    }
  }

  try {
    return fn();
  } finally {
    try {
      if (fd !== null) fs.closeSync(fd);
    } catch {
      /* already closed */
    }
    fs.rmSync(lock, { force: true });
  }
}

/**
 * Write a file so no reader can ever observe half of it. Rename within a
 * directory is atomic, so a concurrent reader sees either the old file or the
 * new one — never a truncated AGENTS.md.
 */
export function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
