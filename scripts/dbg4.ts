import { startApp } from '../packages/benchmark/src/servers.ts';
import { TARGETS } from '../packages/benchmark/src/targets.ts';
import { crawl } from '../packages/explorer/src/crawler.ts';
const r = await startApp('tasks', ['tasks-missing-validation']);
const res = await crawl(r.baseUrl, TARGETS.tasks, { maxSteps: 400, maxTimeMs: 400000 });
await r.stop();
const S = new Map(res.graph.states.map(s => [s.id, s]));
for (const e of res.graph.edges.filter(e => /inline\|title/.test(e.label))) {
  const a = S.get(e.from)!, b = S.get(e.to)!;
  console.log(e.label.padEnd(36), a.id, '->', b.id, b.urlTemplate.padEnd(10), 'fine', b.fine.slice(0, 6), 'dialogs', b.evidence.dialogs.length, 'alerts', b.evidence.alerts.length, 'headings', JSON.stringify(b.evidence.headings));
}
