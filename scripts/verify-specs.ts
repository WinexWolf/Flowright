// End-to-end check of the generated Playwright specs: do they run, do flow specs pass, do finding repros FAIL while the bug exists
// and PASS when it doesn't? (A repro that cannot fail, or cannot pass, is worthless to a developer.)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { startApp } from '../packages/benchmark/src/servers.ts';
import { TARGETS } from '../packages/benchmark/src/targets.ts';
import { crawl } from '../packages/explorer/src/crawler.ts';
import { analyze } from '../packages/oracle/src/index.ts';
import { compileFlows, flowSpec, findingSpec } from '../packages/flow-compiler/src/index.ts';

const app = process.argv[2] ?? 'tasks';
const bugs = JSON.parse(fs.readFileSync('packages/benchmark/labels/bugs.json', 'utf8')).bugs.filter((b: any) => b.app === app && b.split === 'dev').map((b: any) => b.id);
const cfg = TARGETS[app];
const dir = 'reports/specs'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });

const buggy = await startApp(app, bugs);
const res = await crawl(buggy.baseUrl, cfg, { maxSteps: 600, maxTimeMs: 400000 });
const findings = analyze(res.graph);
const flows = compileFlows(res.graph, cfg).slice(0, 4);
flows.forEach((f, i) => fs.writeFileSync(`${dir}/flow-${i}.spec.ts`, flowSpec(f, cfg)));
findings.forEach((f, i) => fs.writeFileSync(`${dir}/finding-${i}-${f.kind}.spec.ts`, findingSpec(f, cfg)));
console.log(`generated ${flows.length} flow specs and ${findings.length} finding repros (bugs enabled: ${bugs.join(', ')})`);

const run = (base: string) => {
  const r = spawnSync('npx', ['playwright', 'test', dir, '--reporter=json', '--workers=1', '--timeout=30000'], { env: { ...process.env, BASE_URL: base }, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const j = JSON.parse(r.stdout || '{}'); const out: Record<string, string> = {};
  const walk = (s: any) => { for (const sp of s.specs ?? []) out[sp.file] = sp.tests[0]?.results[0]?.status ?? 'unknown'; for (const c of s.suites ?? []) walk(c); };
  for (const s of j.suites ?? []) walk(s); return out;
};
const onBuggy = run(buggy.baseUrl); await buggy.stop();
const clean = await startApp(app, []); const onClean = run(clean.baseUrl); await clean.stop();

let ok = 0, bad = 0;
console.log('\nspec'.padEnd(46) + 'buggy app'.padEnd(12) + 'clean app'.padEnd(12) + 'verdict');
for (const f of Object.keys(onBuggy).sort()) {
  const isFlow = f.startsWith('flow-'); const b = onBuggy[f], c = onClean[f];
  const good = isFlow ? (b === 'passed' && c === 'passed') : (b === 'failed' && c === 'passed');
  good ? ok++ : bad++;
  console.log(f.padEnd(46) + String(b).padEnd(12) + String(c).padEnd(12) + (good ? 'OK' : 'UNEXPECTED'));
}
console.log(`\n${ok} behaved correctly, ${bad} unexpected (flow specs must pass on both; finding repros must fail on the buggy app and pass on the clean one)`);
fs.writeFileSync('reports/spec-verification.json', JSON.stringify({ app, onBuggy, onClean, ok, bad }, null, 2));
