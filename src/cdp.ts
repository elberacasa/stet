// stet — a minimal DevTools Protocol client, so capture can set a real
// viewport instead of asking for a window and hoping.
//
// `--window-size=320,740` asks the platform for a window that small, and the
// platform is entitled to refuse. What comes back is a page laid out at the
// minimum width and cropped to the size you asked for: an image with the right
// dimensions and the wrong content, which reports success while being wrong.
// Emulation.setDeviceMetricsOverride sets the viewport the page actually lays
// out against, which is the thing a matched capture is claiming to control.
//
// Node ships a WebSocket client, so this costs no dependency.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
}

export class Chrome {
  private ws!: WebSocket;
  private proc!: ChildProcess;
  private profile!: string;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private waiters = new Map<string, Array<() => void>>();

  static async launch(bin: string, timeoutMs = 20_000): Promise<Chrome> {
    const c = new Chrome();
    c.profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-cdp-'));
    c.proc = spawn(
      bin,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--remote-debugging-port=0',
        `--user-data-dir=${c.profile}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const url = await c.endpoint(timeoutMs);
    await c.connect(url, timeoutMs);
    return c;
  }

  /** Chrome writes the port it chose into the profile once it is listening. */
  private async endpoint(timeoutMs: number): Promise<string> {
    const file = path.join(this.profile, 'DevToolsActivePort');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const [port, route] = fs.readFileSync(file, 'utf8').split('\n');
        if (port && route) return `ws://127.0.0.1:${port.trim()}${route.trim()}`;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error('chrome did not open a debugging port');
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  private connect(url: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error('timed out connecting to chrome')), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('could not connect to chrome'));
      });
      ws.addEventListener('message', (ev) => this.onMessage(String(ev.data)));
    });
  }

  private onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const id = msg.id as number | undefined;
    if (id !== undefined) {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve((msg.result ?? {}) as Record<string, unknown>);
      return;
    }
    const method = msg.method as string | undefined;
    if (!method) return;
    const list = this.waiters.get(method) ?? [];
    this.waiters.delete(method);
    for (const fn of list) fn();
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  /** Resolves on the next occurrence of an event, or after `timeoutMs`. */
  once(method: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => resolve();
      this.waiters.set(method, [...(this.waiters.get(method) ?? []), done]);
      setTimeout(done, timeoutMs);
    });
  }

  /**
   * A fresh target per shot: no cookie, cache or scroll position carries from
   * one variant into the next, which is what makes the frames comparable.
   */
  async shot(url: string, width: number, height: number, settleMs: number): Promise<Buffer> {
    const { targetId } = (await this.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const { sessionId } = (await this.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    try {
      await this.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 600,
      }, sessionId);
      await this.send('Page.enable', {}, sessionId);
      const loaded = this.once('Page.loadEventFired', 15_000);
      await this.send('Page.navigate', { url }, sessionId);
      await loaded;
      await new Promise((r) => setTimeout(r, settleMs));
      const res = (await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId)) as { data: string };
      return Buffer.from(res.data, 'base64');
    } finally {
      await this.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  /** What the page actually laid out against — proof the viewport took. */
  async viewportOf(url: string, width: number, height: number): Promise<number> {
    const { targetId } = (await this.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const { sessionId } = (await this.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    try {
      await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, sessionId);
      await this.send('Page.enable', {}, sessionId);
      const loaded = this.once('Page.loadEventFired', 15_000);
      await this.send('Page.navigate', { url }, sessionId);
      await loaded;
      const r = (await this.send('Runtime.evaluate', { expression: 'innerWidth', returnByValue: true }, sessionId)) as {
        result?: { value?: number };
      };
      return r.result?.value ?? -1;
    } finally {
      await this.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  async close(): Promise<void> {
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
    try {
      this.proc?.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    fs.rmSync(this.profile, { recursive: true, force: true });
  }
}
