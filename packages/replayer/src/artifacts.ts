import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';
import type { Action, TargetConfig } from '@flowright/core';
import { perform, trackInflight } from '@flowright/driver';

export interface ArtifactPaths { video?: string; trace?: string; screenshot?: string }
export interface ArtifactResult { ok: boolean; error: string | null; paths: ArtifactPaths }

/**
 * Replay a path while recording evidence a developer can open: a video, a Playwright trace (trace.zip) and a final screenshot.
 * Deterministic and AI-free, same containment and dialog policy as every other session.
 */
export async function replayWithArtifacts(browser: Browser, baseUrl: string, cfg: TargetConfig, startPath: string, steps: Action[], outDir: string, opts: { video?: boolean; trace?: boolean } = {}): Promise<ArtifactResult> {
  fs.mkdirSync(outDir, { recursive: true });
  const viewport = cfg.viewport ?? { width: 1280, height: 720 };
  const ctx = await browser.newContext({ viewport, ...(opts.video === false ? {} : { recordVideo: { dir: outDir, size: viewport } }) });
  const allowed = new Set([new URL(baseUrl).host, ...(cfg.allowedHosts ?? [])]);
  await ctx.route(u => !allowed.has(new URL(u.toString()).host), r => r.abort());
  if (opts.trace !== false) await ctx.tracing.start({ screenshots: true, snapshots: true });
  const page = await ctx.newPage();
  page.on('dialog', d => (cfg.sandbox ? d.accept() : d.dismiss()).catch(() => {}));
  const tr = trackInflight(page); const paths: ArtifactPaths = {}; let error: string | null = null;
  try {
    await page.goto(baseUrl + startPath).catch(() => {}); await tr.settle();
    for (const s of steps) { error = await perform(page, () => tr.settle(), cfg, s); if (error) break; }
    const png = path.join(outDir, 'final.png'); await page.screenshot({ path: png }); paths.screenshot = png;
  } finally {
    if (opts.trace !== false) { const t = path.join(outDir, 'trace.zip'); await ctx.tracing.stop({ path: t }).catch(() => {}); if (fs.existsSync(t)) paths.trace = t; }
    const video = page.video(); await ctx.close();
    if (video) { const p = await video.path().catch(() => ''); if (p && fs.existsSync(p)) { const dest = path.join(outDir, 'video.webm'); fs.renameSync(p, dest); paths.video = dest; } }
  }
  return { ok: error === null, error, paths };
}
