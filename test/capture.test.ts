import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { DEFAULT_VIEWS, parseVariants, parseViews, plan, toVariants } from '../src/capture.js';

describe('capture rig', () => {
  it('parses the view forms people write', () => {
    expect(parseViews('desktop:1280x800,mobile:390x780')).toEqual([
      { name: 'desktop', width: 1280, height: 800 },
      { name: 'mobile', width: 390, height: 780 },
    ]);
    expect(parseViews('1280x800')).toEqual([{ name: '1280w', width: 1280, height: 800 }]);
    expect(parseViews(' desktop:1280x800 , mobile:390x780 ')).toHaveLength(2);
  });

  it('refuses a view it cannot honour rather than guessing', () => {
    expect(() => parseViews('huge')).toThrow(/write it as/);
    expect(() => parseViews('1280')).toThrow(/write it as/);
    expect(() => parseViews('')).toThrow(/no views/);
  });

  it('parses variants and keeps their order', () => {
    expect(parseVariants(['A=http://x/?v=a', 'B=http://x/?v=b'])).toEqual([
      { label: 'A', url: 'http://x/?v=a' },
      { label: 'B', url: 'http://x/?v=b' },
    ]);
    // a URL with = in the query must survive
    expect(parseVariants(['A=http://x/?a=1&b=2'])[0].url).toBe('http://x/?a=1&b=2');
    expect(() => parseVariants(['nope'])).toThrow(/write it as/);
    expect(() => parseVariants(['=http://x'])).toThrow(/write it as/);
  });

  it('plans every variant at every view — the full matched grid', () => {
    const shots = plan(
      [{ label: 'A', url: 'http://x/a' }, { label: 'B', url: 'http://x/b' }],
      parseViews('desktop:1280x800,mobile:390x780'),
      '/out',
    );
    expect(shots).toHaveLength(4);
    expect(shots.map((s) => path.basename(s.file))).toEqual([
      'A-desktop.png', 'A-mobile.png', 'B-desktop.png', 'B-mobile.png',
    ]);
    // every variant is captured at exactly the same set of views, which is the
    // property that makes flipping meaningful
    const views = new Set(shots.map((s) => s.view.name));
    for (const label of ['A', 'B']) {
      expect(new Set(shots.filter((s) => s.label === label).map((s) => s.view.name))).toEqual(views);
    }
  });

  it('emits variants keyed by view, ready for item.json', () => {
    const shots = plan([{ label: 'A', url: 'http://x/a' }], DEFAULT_VIEWS, '/repo/captures');
    const variants = toVariants(shots, '/repo') as Array<{ label: string; blocks: Array<Record<string, string>> }>;
    expect(variants).toHaveLength(1);
    expect(variants[0].blocks).toEqual([
      { kind: 'image', src: 'captures/A-desktop.png', view: 'desktop' },
      { kind: 'image', src: 'captures/A-mobile.png', view: 'mobile' },
    ]);
  });
});
