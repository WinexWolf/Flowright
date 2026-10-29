// Re-render the showcase demos from the saved flow (after changing narration/overlay code) without recrawling.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { startApp } from '../packages/benchmark/src/servers.ts';
import { TARGETS } from '../packages/benchmark/src/targets.ts';
import { renderDemo, SilentTts, extractFrames, probe } from '../packages/demo/src/index.ts';
const flow = JSON.parse(fs.readFileSync('reports/showcase/checkout-flow.json', 'utf8'));
const app = await startApp('shop'); const browser = await chromium.launch(); const cfg = TARGETS.shop;
const d = await renderDemo(browser, app.baseUrl, cfg, flow, { outDir: 'reports/showcase/demo-desktop', device: 'desktop' });
const p = await renderDemo(browser, app.baseUrl, cfg, flow, { outDir: 'reports/showcase/demo-phone', device: 'phone', tts: new SilentTts() });
for (const [n, r] of [['desktop', d], ['phone', p]] as const) console.log(n, r.mp4, JSON.stringify(await probe(r.mp4!)), r.cues.map(c => c.text).join(' | '));
const dp = await probe(d.mp4!); await extractFrames(d.mp4!, [0.8, dp.durationSec * 0.35, dp.durationSec * 0.6, dp.durationSec * 0.85], 'reports/showcase/frames-desktop');
const pp = await probe(p.mp4!); await extractFrames(p.mp4!, [0.8, pp.durationSec * 0.4, pp.durationSec * 0.75], 'reports/showcase/frames-phone');
await browser.close(); await app.stop(); console.log('DONE');
