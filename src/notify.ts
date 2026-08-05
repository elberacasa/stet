// stet — notification. It comes to you; that is one of the three fixes.
// Never fatal, never blocking, never a dependency.

import { spawn } from 'node:child_process';

export function notify(title: string, body: string, url?: string): void {
  try {
    if (process.platform === 'darwin') {
      const say = `display notification ${q(body)} with title ${q(title)} sound name "Submarine"`;
      const p = spawn('osascript', ['-e', say], { stdio: 'ignore', detached: true });
      p.on('error', () => fallback(title, body, url));
      p.unref();
      return;
    }
    if (process.platform === 'linux') {
      const p = spawn('notify-send', [title, body], { stdio: 'ignore', detached: true });
      p.on('error', () => fallback(title, body, url));
      p.unref();
      return;
    }
  } catch {
    /* falls through */
  }
  fallback(title, body, url);
}

/** A bell and a printed line. Works everywhere, costs nothing. */
function fallback(title: string, body: string, url?: string): void {
  process.stdout.write(`\x07\n  ${title} — ${body}${url ? `\n  ${url}` : ''}\n\n`);
}

/** AppleScript string literal. */
function q(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

export function open(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const p = spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    p.on('error', () => {});
    p.unref();
  } catch {
    /* the URL is printed anyway */
  }
}
