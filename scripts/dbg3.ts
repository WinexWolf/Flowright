import { startApp } from '../packages/benchmark/src/servers.ts';
import { TARGETS } from '../packages/benchmark/src/targets.ts';
import { crawl } from '../packages/explorer/src/crawler.ts';
const r = await startApp('shop', ['shop-missing-validation']);
const res = await crawl(r.baseUrl, TARGETS.shop, { maxSteps: 400, maxTimeMs: 400000 });
await r.stop();
const S = new Map(res.graph.states.map(s => [s.id, s]));
for (const e of res.graph.edges.filter(e => e.label.includes('checkout') || e.label.includes('Proceed'))) {
  const a = S.get(e.from)!, b = S.get(e.to)!;
  console.log(e.label.padEnd(52), a.id, a.evidence.route.padEnd(11), '->', b.id, b.evidence.route.padEnd(13), 'alerts:', b.evidence.alerts.length, e.obs.actionError ?? '');
}
console.log('stats', JSON.stringify(res.stats));
import { analyze } from '../packages/oracle/src/index.ts';
import { confirmFinding } from '../packages/replayer/src/index.ts';
import { chromium } from 'playwright';
const fs = analyze(res.graph);
console.log('\nfindings:', fs.map(f => `${f.kind}@${f.route}`).join(' | '));
const mv = fs.find(f => f.kind === 'missing-validation');
console.log('missing-validation present?', !!mv);
if (mv) {
  const r2 = await startApp('shop', ['shop-missing-validation']); const b = await chromium.launch();
  console.log('path', mv.path.map(a => a.label).join(' > '));
  console.log('confirm', JSON.stringify(await confirmFinding(b, r2.baseUrl, TARGETS.shop, mv)));
  await b.close(); await r2.stop();
}
