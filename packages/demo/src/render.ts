import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';
import type { Flow, TargetConfig } from '@flowright/core';
import { locate, trackInflight, valueFor } from '@flowright/driver';
import { narrateFlow, flowTitle, type NarrationLine } from './narrate.js';
import { captionMs, toSrt, toVtt, type Cue } from './timing.js';
import { encodeMp4, hasFfmpeg, type AudioClip, type TtsProvider } from './media.js';

const OVERLAY = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'overlay.browser.js'), 'utf8');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface DemoOptions { outDir: string; device?: 'desktop' | 'phone'; zoom?: boolean; wpm?: number; accent?: string; narration?: NarrationLine[]; tts?: TtsProvider; mp4?: boolean; log?: (m: string) => void }
export interface DemoResult { webm: string; mp4?: string; vtt: string; srt: string; script: string; cues: Cue[]; durationMs: number; steps: number; hasAudio: boolean }

/**
 * Record a flow as a narrated product demo. Narration comes FIRST and sets the pacing (a caption stays up as long as it needs to be read, or as long as
 * the synthesized audio runs); every action is then performed for real, so what the video shows is exactly what the app does.
 */
export async function renderDemo(browser: Browser, baseUrl: string, cfg: TargetConfig, flow: Flow, o: DemoOptions): Promise<DemoResult> {
  const log = o.log ?? (() => {}); fs.mkdirSync(o.outDir, { recursive: true });
  const phone = o.device === 'phone'; const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 720 };
  const lines = o.narration ?? narrateFlow(flow); const wpm = o.wpm ?? 150;

  // narration-first: with a voice, durations come from real audio; otherwise from reading speed
  const clips: { line: NarrationLine; ms: number; audio?: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (o.tts) { const r = await o.tts.synthesize(lines[i].text, path.join(o.outDir, `line-${i}.wav`)); clips.push({ line: lines[i], ms: r.durationMs + 500, audio: r.path }); }
    else clips.push({ line: lines[i], ms: captionMs(lines[i].text, wpm) });
  }

  const ctx = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, recordVideo: { dir: o.outDir, size: viewport } });
  const allowed = new Set([new URL(baseUrl).host, ...(cfg.allowedHosts ?? [])]);
  await ctx.route(u => !allowed.has(new URL(u.toString()).host), r => r.abort());
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage(); page.on('dialog', d => (cfg.sandbox ? d.accept() : d.dismiss()).catch(() => {}));
  const tr = trackInflight(page); const t0 = Date.now(); const now = () => Date.now() - t0;
  const cues: Cue[] = []; const audio: AudioClip[] = []; let current = '';

  const fr = async (fn: string, ...args: unknown[]) => { try { await page.evaluate(([f, a]) => (window as unknown as { __fr: Record<string, (...x: unknown[]) => void> }).__fr?.[f as string]?.(...(a as unknown[])), [fn, args] as const); } catch { /* page navigating */ } };
  const restore = async () => { await fr('config', { fs: phone ? 17 : 22, accent: o.accent ?? '#3B82F6' }); await fr('phone', phone); await fr('caption', current); };
  const say = async (i: number) => { current = clips[i].line.text; await restore(); return { start: now(), ms: clips[i].ms, audio: clips[i].audio }; };
  const hold = async (c: { start: number; ms: number; audio?: string }) => {
    const rest = c.ms - (now() - c.start); if (rest > 0) await sleep(rest);
    cues.push({ start: c.start, end: now(), text: current }); if (c.audio) audio.push({ path: c.audio, startMs: c.start });
  };
  const centerOf = async (loc: ReturnType<Page['locator']>) => { const b = await loc.boundingBox(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; };
  const aim = async (loc: ReturnType<Page['locator']>, ms = 650) => {
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    let p = await centerOf(loc);
    if (p && o.zoom !== false && !phone && (await page.evaluate(() => window.scrollY)) === 0) { await fr('zoom', p.x, p.y, 1.15, 450); await sleep(520); p = (await centerOf(loc)) ?? p; }   // only on an unscrolled page, where viewport coords are page coords
    if (p) { await fr('cursorTo', p.x, p.y, ms); await sleep(ms + 80); await fr('ripple', p.x, p.y); }
    return p;
  };

  try {
    await page.goto(baseUrl + flow.startPath).catch(() => {}); await tr.settle(); await restore();
    await fr('card', flowTitle(flow), phone ? '' : 'Product walkthrough');
    const intro = await say(0); await hold(intro); await fr('cardOff'); await sleep(350);

    for (let i = 0; i < flow.steps.length; i++) {
      const a = flow.steps[i]; const c = await say(i + 1);
      await sleep(Math.min(900, c.ms * 0.3));
      if (a.kind === 'click') {
        const loc = await locate(page, a); await aim(loc); await loc.click({ timeout: 2500 }).catch(e => log(`click failed: ${(e as Error).message.split('\n')[0]}`));
      } else {
        for (const f of a.fields) {
          const loc = page.locator(f.css).first();
          if (f.type === 'select') { if (a.variant !== 'empty') { await aim(loc, 450); await loc.selectOption({ index: 0 }, { timeout: 1500 }).catch(() => {}); } continue; }
          if (f.type === 'checkbox' || f.type === 'radio') { if (a.variant === 'valid') { await aim(loc, 450); await loc.check({ timeout: 1500 }).catch(() => {}); } continue; }
          const v = valueFor(f, a.variant, cfg);
          if (v === null) continue;                                     // blank on purpose: nothing to type
          await aim(loc, 450); await loc.click({ timeout: 1500 }).catch(() => {}); await loc.fill('').catch(() => {}); await loc.pressSequentially(v, { delay: 45 }).catch(() => {});
        }
        if (a.submit) { const b = await locate(page, a.submit); await aim(b, 500); await b.click({ timeout: 2500 }).catch(() => {}); } else await page.keyboard.press('Enter');
      }
      await tr.settle(); await fr('unzoom'); await restore(); await hold(c);
    }
    const outro = await say(lines.length - 1); await hold(outro); await fr('caption', '');
    await sleep(500);
  } finally {
    const video = page.video(); await ctx.close();
    var webmPath = ''; if (video) { const p = await video.path(); webmPath = path.join(o.outDir, 'demo.webm'); if (p !== webmPath) fs.renameSync(p, webmPath); }
  }
  const durationMs = now();
  const vtt = path.join(o.outDir, 'demo.vtt'), srt = path.join(o.outDir, 'demo.srt'), script = path.join(o.outDir, 'script.md');
  fs.writeFileSync(vtt, toVtt(cues)); fs.writeFileSync(srt, toSrt(cues));
  fs.writeFileSync(script, `# ${flowTitle(flow)}\n\n${cues.map(c => `- ${(c.start / 1000).toFixed(1)}s: ${c.text}`).join('\n')}\n`);
  let mp4: string | undefined;
  if (o.mp4 !== false && (await hasFfmpeg())) { mp4 = path.join(o.outDir, 'demo.mp4'); await encodeMp4(webmPath, mp4, { clips: audio, stage: phone }); }
  for (const c of clips) if (c.audio) fs.rmSync(c.audio, { force: true });
  return { webm: webmPath, mp4, vtt, srt, script, cues, durationMs, steps: flow.steps.length, hasAudio: audio.length > 0 };
}
