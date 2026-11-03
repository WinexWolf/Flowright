import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { CrawlGraph } from '@flowright/core';

export interface DiffResult { same: boolean; ratio: number; sizeMismatch: boolean; diff?: Buffer; changedPixels: number; total: number }
/** Pixel diff. `pixelThreshold` is per-pixel colour tolerance (anti-aliasing noise); `maxRatio` is the share of pixels allowed to differ. Different sizes always count as changed. */
export function compareImages(a: Buffer, b: Buffer, o: { pixelThreshold?: number; maxRatio?: number } = {}): DiffResult {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return { same: false, ratio: 1, sizeMismatch: true, changedPixels: Math.max(A.width * A.height, B.width * B.height), total: Math.max(A.width * A.height, B.width * B.height) };
  const diff = new PNG({ width: A.width, height: A.height });
  const changed = pixelmatch(A.data, B.data, diff.data, A.width, A.height, { threshold: o.pixelThreshold ?? 0.1, includeAA: false });
  const total = A.width * A.height; const ratio = changed / total;
  return { same: ratio <= (o.maxRatio ?? 0.002), ratio, sizeMismatch: false, diff: changed ? PNG.sync.write(diff) : undefined, changedPixels: changed, total };
}

export interface VisualChange { stateId: string; route: string; key: string; ratio: number; sizeMismatch: boolean; baseline: string; current: string; diff?: string }
export interface VisualResult { created: number; same: number; changed: VisualChange[]; updated: boolean }

/**
 * Compare this run's screenshots with the baselines in the project's .flowright/ folder.
 * A state is identified by its fingerprint (page structure), so a page whose STRUCTURE changed is a new page, not a visual regression.
 * No baseline yet: create it (first run is never a failure). `update`: accept every change as the new normal.
 */
export function runVisual(o: { graph: CrawlGraph; screensDir: string; baselineDir: string; outDir: string; update?: boolean; maxRatio?: number; pixelThreshold?: number }): VisualResult {
  const res: VisualResult = { created: 0, same: 0, changed: [], updated: !!o.update };
  fs.mkdirSync(o.baselineDir, { recursive: true }); const vdir = path.join(o.outDir, 'visual'); fs.mkdirSync(vdir, { recursive: true });
  for (const s of o.graph.states) {
    if (!s.screenshot) continue;
    const cur = path.join(o.screensDir, s.screenshot); if (!fs.existsSync(cur)) continue;
    const base = path.join(o.baselineDir, `${s.fine}.png`);
    if (!fs.existsSync(base)) { fs.copyFileSync(cur, base); res.created++; continue; }
    const d = compareImages(fs.readFileSync(base), fs.readFileSync(cur), { maxRatio: o.maxRatio, pixelThreshold: o.pixelThreshold });
    if (d.same) { res.same++; continue; }
    const bFile = `${s.id}-baseline.png`, cFile = `${s.id}-current.png`, dFile = `${s.id}-diff.png`;
    fs.copyFileSync(base, path.join(vdir, bFile)); fs.copyFileSync(cur, path.join(vdir, cFile)); if (d.diff) fs.writeFileSync(path.join(vdir, dFile), d.diff);
    res.changed.push({ stateId: s.id, route: s.evidence.route, key: s.fine, ratio: d.ratio, sizeMismatch: d.sizeMismatch, baseline: `visual/${bFile}`, current: `visual/${cFile}`, diff: d.diff ? `visual/${dFile}` : undefined });
    if (o.update) fs.copyFileSync(cur, base);
  }
  return res;
}
