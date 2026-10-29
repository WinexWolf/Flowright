// Produces the artifacts shown to a human: a real report (shop with all dev bugs injected), plus a desktop and a phone demo of the minimized checkout.
import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright';
import { startApp } from '../packages/benchmark/src/servers.ts';
import { TARGETS } from '../packages/benchmark/src/targets.ts';
import { analyzeApp } from '../packages/engine/src/index.ts';
import { HeuristicPolicy, minimizeFlow, runAgent } from '../packages/agent/src/index.ts';
import { renderDemo, SilentTts, extractFrames, probe } from '../packages/demo/src/index.ts';

const OUT = 'reports/showcase'; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const cfg = TARGETS.shop;
const bugs = JSON.parse(fs.readFileSync('packages/benchmark/labels/bugs.json', 'utf8')).bugs.filter((b: any) => b.app === 'shop' && b.split === 'dev').map((b: any) => b.id);
console.log('1/3 analyze shop with bugs:', bugs.join(', '));
const buggy = await startApp('shop', bugs);
const r = await analyzeApp({ baseUrl: buggy.baseUrl, cfg, outDir: OUT, budget: { maxSteps: 220, maxTimeMs: 400000 }, title: 'Flowright: Shopfront', log: m => console.log(' ', m) });
await buggy.stop();
console.log('   confirmed:', r.findings.map(f => `${f.id} ${f.finding.kind} ${f.finding.route}`).join(' | '), '| set aside:', r.unconfirmed.length, '| flows ok:', r.flowResults.filter(f => f.ok).length + '/' + r.flowResults.length);

console.log('2/3 agent + minimize on the CLEAN shop');
const app = await startApp('shop'); const browser = await chromium.launch();
const goal = { text: 'add a product to the cart, proceed to checkout and place the order', success: [{ kind: 'heading' as const, text: 'Order confirmed' }] };
const a = await runAgent(browser, app.baseUrl, cfg, goal, new HeuristicPolicy(), { maxSteps: 14 });
const m = await minimizeFlow(browser, app.baseUrl, cfg, a.flow!, goal.success);
const flow = { ...m.flow, intent: { name: 'Place an order', intent: 'Buy a product', assertions: goal.success } };
fs.writeFileSync(path.join(OUT, 'checkout-flow.json'), JSON.stringify(flow, null, 2));
console.log(`   agent ${a.path.length} steps -> minimized ${flow.steps.length} (${m.replays} verification replays)`);

console.log('3/3 demos');
const d = await renderDemo(browser, app.baseUrl, cfg, flow, { outDir: path.join(OUT, 'demo-desktop'), device: 'desktop' });
const dp = await probe(d.mp4!); console.log('   desktop', d.mp4, JSON.stringify(dp));
const p = await renderDemo(browser, app.baseUrl, cfg, flow, { outDir: path.join(OUT, 'demo-phone'), device: 'phone', tts: new SilentTts() });
const pp = await probe(p.mp4!); console.log('   phone  ', p.mp4, JSON.stringify(pp));
const fd = await extractFrames(d.mp4!, [0.8, dp.durationSec * 0.35, dp.durationSec * 0.6, dp.durationSec * 0.85], path.join(OUT, 'frames-desktop'));
const fp = await extractFrames(p.mp4!, [0.8, pp.durationSec * 0.4, pp.durationSec * 0.75], path.join(OUT, 'frames-phone'));
console.log('frames', fd.length, fp.length);
await browser.close(); await app.stop(); console.log('DONE');
