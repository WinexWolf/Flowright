import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { PNG } from 'pngjs';
import { compareImages, runVisual } from '../src/visual.js';
import type { CrawlGraph, StateNode } from '@flowright/core';

const png = (w: number, h: number, fill: (x: number, y: number) => [number, number, number]) => { const p = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, [r, g, b] = fill(x, y); p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255; } return PNG.sync.write(p); };
const white = (w = 100, h = 100) => png(w, h, () => [255, 255, 255]);

describe('compareImages', () => {
  it('identical images are the same', () => { const d = compareImages(white(), white()); expect(d).toMatchObject({ same: true, ratio: 0, changedPixels: 0 }); expect(d.diff).toBeUndefined(); });
  it('a real change is detected, with the share of pixels and a diff image', () => {
    const b = png(100, 100, (x, y) => (x < 20 && y < 20 ? [255, 0, 0] : [255, 255, 255]));
    const d = compareImages(white(), b); expect(d.same).toBe(false); expect(d.ratio).toBeCloseTo(0.04, 2); expect(d.diff).toBeInstanceOf(Buffer);
  });
  it('tiny changes under the tolerance are noise, not regressions', () => {
    const b = png(100, 100, (x, y) => (x === 0 && y === 0 ? [0, 0, 0] : [255, 255, 255])); expect(compareImages(white(), b).same).toBe(true);        // 1 pixel of 10,000
    expect(compareImages(white(), b, { maxRatio: 0 }).same).toBe(false);                                                                          // unless you ask for exactness
  });
  it('slight colour differences (anti-aliasing) are ignored by the per-pixel threshold', () => { expect(compareImages(white(), png(100, 100, () => [250, 250, 250])).changedPixels).toBe(0); });
  it('different sizes always count as changed', () => { expect(compareImages(white(100, 100), white(100, 150))).toMatchObject({ same: false, sizeMismatch: true, ratio: 1 }); });
});

describe('runVisual (baselines)', () => {
  const setup = (shot: Buffer) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-vis-')); const screens = path.join(root, 'screens'); fs.mkdirSync(screens); fs.writeFileSync(path.join(screens, 's1.png'), shot);
    const state = { id: 's1', fine: 'fine1', screenshot: 's1.png', evidence: { route: '/p' } } as unknown as StateNode; return { root, screens, g: { states: [state], edges: [], cycles: [] } as CrawlGraph, base: path.join(root, 'base'), out: path.join(root, 'out') }; };
  it('first run creates the baseline and is never a failure', () => { const s = setup(white()); const r = runVisual({ graph: s.g, screensDir: s.screens, baselineDir: s.base, outDir: s.out }); expect(r).toMatchObject({ created: 1, same: 0, changed: [] }); expect(fs.existsSync(path.join(s.base, 'fine1.png'))).toBe(true); });
  it('second run with the same page: same. Changed page: reported with baseline, current and diff images', () => {
    const s = setup(white()); runVisual({ graph: s.g, screensDir: s.screens, baselineDir: s.base, outDir: s.out });
    expect(runVisual({ graph: s.g, screensDir: s.screens, baselineDir: s.base, outDir: s.out }).same).toBe(1);
    fs.writeFileSync(path.join(s.screens, 's1.png'), png(100, 100, (x) => (x < 50 ? [0, 0, 255] : [255, 255, 255])));
    const r = runVisual({ graph: s.g, screensDir: s.screens, baselineDir: s.base, outDir: s.out }); expect(r.changed).toHaveLength(1);
    for (const f of [r.changed[0].baseline, r.changed[0].current, r.changed[0].diff!]) expect(fs.existsSync(path.join(s.out, f)), f).toBe(true);
    expect(r.changed[0].ratio).toBeCloseTo(0.5, 1);
  });
  it('--update accepts the change as the new baseline', () => {
    const s = setup(white()); runVisual({ graph: s.g, screensDir: s.screens, baselineDir: s.base, outDir: s.out });
    fs.writeFileSync(path.join(s.screens, 's1.png'), png(100, 100, () => [0, 0, 255]));
    expect(runVisual({ graph: s.g, screensDir: s.screens, baselineDir: s.base, outDir: s.out, update: true }).changed).toHaveLength(1);
    expect(runVisual({ graph: s.g, screensDir: s.screens, baselineDir: s.base, outDir: s.out }).changed).toHaveLength(0);
  });
});
