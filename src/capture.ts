// stet — matched capture. The rig that makes a variant the whole running thing
// rather than a picture of part of it.
//
// Vesper solved this with stills.json: a list of fixed camera positions replayed
// identically for every variant, so the only difference in the frame is the
// thing being decided. The web equivalent is URLs times viewports, and it has
// to be one command or nobody does it — which is exactly what happened the
// first time this project tried, by hand, and gave up on the mobile pair.
//
// Zero dependencies still holds: this drives a browser the machine already has.
// No install, no supply chain, nothing downloaded. When there is no browser it
// says so and prints the plan, so an agent with its own browser tools can run
// the same rig rather than inventing one.

import fs from 'node:fs';
import path from 'node:path';

export interface View {
  name: string;
  width: number;
  height: number;
}

export interface Shot {
  label: string;
  view: View;
  url: string;
  file: string;
}

export const DEFAULT_VIEWS: View[] = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 780 },
];

/** `desktop:1280x800,mobile:390x780` — or just `1280x800`. */
export function parseViews(spec: string): View[] {
  const views: View[] = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(?:([A-Za-z0-9._-]+):)?(\d+)x(\d+)$/.exec(part);
    if (!m) throw new Error(`unusable view "${part}" — write it as name:1280x800`);
    views.push({ name: m[1] ?? `${m[2]}w`, width: Number(m[2]), height: Number(m[3]) });
  }
  if (!views.length) throw new Error('no views given');
  return views;
}

/** `A=http://…` pairs, in the order they were written. */
export function parseVariants(args: string[]): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq < 1) throw new Error(`unusable variant "${a}" — write it as A=http://localhost:5173/?v=a`);
    out.push({ label: a.slice(0, eq), url: a.slice(eq + 1) });
  }
  if (out.length < 1) throw new Error('give at least one variant, as A=<url>');
  return out;
}

const CANDIDATES: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

/** A Chromium already on this machine, or null. `$CHROME_PATH` wins. */
export function findBrowser(): string | null {
  const env = process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  for (const c of CANDIDATES[process.platform] ?? []) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Every variant at every view: the full matched grid. */
export function plan(variants: Array<{ label: string; url: string }>, views: View[], outDir: string): Shot[] {
  const shots: Shot[] = [];
  for (const v of variants) {
    for (const view of views) {
      shots.push({ label: v.label, view, url: v.url, file: path.join(outDir, `${v.label}-${view.name}.png`) });
    }
  }
  return shots;
}

export interface CaptureResult {
  shot: Shot;
  ok: boolean;
  bytes: number;
  /** The width the page actually laid out against. Must equal the view width. */
  laidOutAt: number;
  error?: string;
}

/** Width in the PNG header — proof of what was produced, not what was asked. */
function pngWidth(file: string): number {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(24);
    fs.readSync(fd, head, 0, 24, 0);
    fs.closeSync(fd);
    return head.readUInt32BE(16);
  } catch {
    return 0;
  }
}

/**
 * One browser, one fresh target per shot. The viewport is set through
 * Emulation, not by asking for a window: a window request below the platform
 * minimum is silently widened, and the page is then laid out wide and cropped
 * to the size you asked for — an image with the right dimensions and the wrong
 * content. `laidOutAt` records what the page actually saw, so that failure is
 * visible rather than plausible.
 */
export async function capture(shots: Shot[], browser: string, opts: { settleMs?: number } = {}): Promise<CaptureResult[]> {
  const settle = opts.settleMs ?? 350;
  const { Chrome } = await import('./cdp.js');
  const chrome = await Chrome.launch(browser);
  const results: CaptureResult[] = [];
  try {
    for (const shot of shots) {
      fs.mkdirSync(path.dirname(shot.file), { recursive: true });
      try {
        const png = await chrome.shot(shot.url, shot.view.width, shot.view.height, settle);
        fs.writeFileSync(shot.file, png);
        const laidOutAt = await chrome.viewportOf(shot.url, shot.view.width, shot.view.height);
        results.push({
          shot,
          ok: png.length > 0 && pngWidth(shot.file) === shot.view.width,
          bytes: png.length,
          laidOutAt,
        });
      } catch (err) {
        results.push({ shot, ok: false, bytes: 0, laidOutAt: -1, error: String((err as Error).message) });
      }
    }
  } finally {
    await chrome.close();
  }
  return results;
}

/** The variants array for an item.json, with every capture keyed by its view. */
export function toVariants(shots: Shot[], from: string): Array<{ label: string; blocks: unknown[] }> {
  const byLabel = new Map<string, Shot[]>();
  for (const s of shots) byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s]);
  return [...byLabel.entries()].map(([label, list]) => ({
    label,
    blocks: list.map((s) => ({
      kind: 'image',
      src: path.relative(from, s.file).split(path.sep).join('/'),
      view: s.view.name,
    })),
  }));
}
