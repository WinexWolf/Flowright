import { chromium } from 'playwright';
import { startApp } from '../packages/benchmark/src/servers.ts';
import { TARGETS } from '../packages/benchmark/src/targets.ts';
import { crawl } from '../packages/explorer/src/crawler.ts';
import { analyze } from '../packages/oracle/src/index.ts';
import { replayPath } from '../packages/replayer/src/replay.ts';
const app = await startApp('tasks', ['tasks-missing-validation']); const cfg = TARGETS.tasks;
const t0 = Date.now(); const res = await crawl(app.baseUrl, cfg, { maxSteps: 600, maxTimeMs: 900000 }, { log: m => console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', m) }); console.log('crawl done', ((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(res.stats).slice(0, 400));
const mv = analyze(res.graph).filter(f => f.kind === 'missing-validation');
console.log('findings:', mv.map(f => f.detail + ' @' + f.route));
const b = await chromium.launch();
for (const f of mv) {
  const base = f.path.slice(0, -1);
  const a = await replayPath(b, app.baseUrl, cfg, cfg.startPath, [...base, f.probe!.valid]);
  const c = await replayPath(b, app.baseUrl, cfg, cfg.startPath, [...base, f.probe!.variant]);
  console.log('valid  :', a.ok, a.evidence?.route, 'tree', a.treeHash, 'overlay', a.overlay, 'alerts', a.evidence?.alerts.length, 'dialogs', a.evidence?.dialogs.length);
  console.log('variant:', c.ok, c.evidence?.route, 'tree', c.treeHash, 'overlay', c.overlay, 'alerts', c.evidence?.alerts.length, 'dialogs', c.evidence?.dialogs.length);
  console.log('exact-equal treeHash?', a.treeHash === c.treeHash);
}
await b.close(); await app.stop();
