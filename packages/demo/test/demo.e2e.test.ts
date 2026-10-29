import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { chromium } from 'playwright';
import { HeuristicPolicy, runAgent } from '@flowright/agent';
import { renderDemo, SilentTts, probe, hasFfmpeg } from '../src/index.js';
import { startApp } from '../../benchmark/src/servers.js';
import { TARGETS } from '../../benchmark/src/targets.js';

describe('demo rendering (real browser + ffmpeg)', () => {
  it('records a narrated demo: video, captions in sync with real steps, mp4, and an audio track when a voice is supplied', async () => {
    expect(await hasFfmpeg()).toBe(true);
    const shop = await startApp('shop'); const browser = await chromium.launch(); const cfg = TARGETS.shop;
    try {
      const a = await runAgent(browser, shop.baseUrl, cfg, { text: 'open the about page', success: [{ kind: 'heading', text: 'About us' }] }, new HeuristicPolicy(), { maxSteps: 5 });
      expect(a.flow).toBeTruthy();
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-demo-'));
      const silent = await renderDemo(browser, shop.baseUrl, cfg, a.flow!, { outDir: path.join(out, 'a') });
      expect(silent.cues).toHaveLength(a.flow!.steps.length + 2);                           // intro + one cue per step + outro
      expect(silent.cues[1].text).toMatch(/Open “/);                                        // the caption describes the REAL action
      for (let i = 1; i < silent.cues.length; i++) expect(silent.cues[i].start).toBeGreaterThanOrEqual(silent.cues[i - 1].end - 5);   // cues never overlap
      expect(fs.statSync(silent.webm).size).toBeGreaterThan(5000);
      const pv = await probe(silent.mp4!); expect(pv).toMatchObject({ hasVideo: true, hasAudio: false, width: 1280, height: 720 });
      expect(pv.durationSec * 1000).toBeGreaterThan(silent.cues.reduce((t, c) => t + (c.end - c.start), 0) * 0.8);
      expect(fs.readFileSync(silent.vtt, 'utf8').startsWith('WEBVTT')).toBe(true); const script = fs.readFileSync(silent.script, 'utf8'); expect(script).toContain('Open “About”'); expect(script).toContain('And that’s “About us”');

      const voiced = await renderDemo(browser, shop.baseUrl, cfg, a.flow!, { outDir: path.join(out, 'b'), device: 'phone', tts: new SilentTts() });
      expect(voiced.hasAudio).toBe(true);
      expect(await probe(voiced.mp4!)).toMatchObject({ hasAudio: true, hasVideo: true });      // narration clip muxed in; phone is staged on a 16:9 canvas
    } finally { await browser.close(); await shop.stop(); }
  });
});
