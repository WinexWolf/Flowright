import { startLab } from '../packages/engine/test/lab.ts';
import { crawl } from '../packages/explorer/src/crawler.ts';
import { analyzeEverything } from '../packages/oracle/src/index.ts';
const srv = await startLab();
const res = await crawl(srv.url, { name: 'lab', startPath: '/', sandbox: true }, { maxSteps: 90, maxTimeMs: 200000 }, { checks: { a11y: true, keyboard: true } });
for (const s of res.graph.states) console.log(s.id.padEnd(4), s.evidence.route.padEnd(18), 'a11y:', (s.checks?.a11y ?? []).map(v => v.id).join(',') || '-', '| kbd:', (s.checks?.keyboard ?? []).map(k => k.kind + '(' + k.detail.slice(0, 70) + ')').join(' ; ') || '-');
console.log('\nFINDINGS'); for (const f of analyzeEverything(res.graph)) console.log(' ', f.kind.padEnd(10), f.severity.padEnd(8), f.route.padEnd(14), f.detail.slice(0, 110));
await srv.stop();
