import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExplorationResult, Budget } from '@flowright/core';
import { startApp } from './servers.js';
import { TARGETS, DEV_APPS, HELDOUT_APPS } from './targets.js';
import { coverage, type Coverage } from './metrics.js';
import type { Labels } from './matcher.js';
import { noopExplorer } from './explorers/noop.js';
import { randomExplorer } from './explorers/random.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true') : d; };

const explorers = (flag('explorer', 'noop,random') as string).split(',');
const includeHeldout = flag('include-heldout') === 'true';
let apps = flag('apps') ? (flag('apps') as string).split(',') : [...DEV_APPS];
if (includeHeldout) apps = [...new Set([...apps, ...HELDOUT_APPS])];
else if (apps.some(a => HELDOUT_APPS.includes(a))) { console.error('Refusing to run a held-out app without --include-heldout'); process.exit(2); }
const budget: Budget = { maxSteps: Number(flag('steps', '150')), maxTimeMs: Number(flag('time', '120000')) };
const seeds = Number(flag('seeds', '3'));
const outFile = flag('out');

// ---- M2 mode: oracle + replay evaluation (recall on injected bugs, false positives, replay success)
if (flag('oracle') === 'true') {
  const { evaluateApp } = await import('./oracleRun.js');
  const which = (flag('bugs', 'dev') as 'dev' | 'heldout');
  if (which === 'heldout' && !includeHeldout) { console.error('--bugs heldout requires --include-heldout'); process.exit(2); }
  const targetApps = flag('apps') ? (flag('apps') as string).split(',') : (which === 'heldout' ? [...DEV_APPS, ...HELDOUT_APPS] : apps.filter(a => DEV_APPS.includes(a)));
  const results = [];
  for (const app of targetApps) {
    process.stderr.write(`[oracle] ${app} (${which})...\n`);
    const r = await evaluateApp(app, which, budget, Number(flag('replay-runs', '3')), (flag('mode', 'isolated') as 'isolated' | 'combined'));
    results.push(r);
    console.log(`\n== ${app} [${which} bugs, ${(r as any).mode}] recall ${r.detected.length}/${r.enabled.length} (strict original rules: ${(r as any).detectedStrict.length}/${r.enabled.length})  | replay success ${(r.replay.successRate * 100).toFixed(1)}% over ${r.replay.runs} runs (${r.replay.flows} flows)  | confirmed ${r.confirmed}, unconfirmed ${r.unconfirmed}`);
    console.log('   detected:', r.detected.join(', ') || '-'); console.log('   missed:  ', r.missed.join(', ') || '-');
    console.log('   false positives on bug-injected app:', r.falsePositives.length ? '' : 'none'); for (const f of r.falsePositives) console.log(`     - [${f.severity}] ${f.kind} @ ${f.route}: ${f.detail}`);
    console.log('   false positives on CLEAN app:', r.cleanFalsePositives.length ? '' : 'none'); for (const f of r.cleanFalsePositives) console.log(`     - [${f.severity}] ${f.kind} @ ${f.route}: ${f.detail}`);
    if (r.replay.flaky.length || r.replay.failing.length) console.log(`   replay flaky: ${r.replay.flaky.join(',') || '-'}  failing: ${r.replay.failing.join(',') || '-'}`);
  }
  const en = results.reduce((a, r) => a + r.enabled.length, 0), de = results.reduce((a, r) => a + r.detected.length, 0);
  const fp = results.reduce((a, r) => a + r.falsePositives.length + r.cleanFalsePositives.length, 0);
  console.log(`\nTOTAL recall ${de}/${en} (${(100 * de / Math.max(1, en)).toFixed(0)}%), false positives ${fp}`);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ which, results }, null, 2));
  process.exit(0);
}

const labelsFor = (app: string): Labels => JSON.parse(fs.readFileSync(path.join(here, '../labels', app + '.json'), 'utf8'));

interface Row { explorer: string; app: string; cov: Coverage; steps: number; ms: number; cost: number; extra?: Record<string, unknown> }

async function runExplorer(name: string, app: string, baseUrl: string, seed: number): Promise<ExplorationResult> {
  const cfg = TARGETS[app];
  if (name === 'noop') return noopExplorer();
  if (name === 'random') return randomExplorer(baseUrl, cfg, budget, seed);
  if (name === 'crawler') { const { crawl } = await import('@flowright/explorer/crawler'); return crawl(baseUrl, cfg, budget); }
  throw new Error('unknown explorer ' + name);
}

const rows: Row[] = []; const details: unknown[] = [];
if (includeHeldout) console.log('\n!! HELD-OUT apps included. Do not tune against these numbers.\n');
for (const app of apps) {
  const labels = labelsFor(app);
  for (const ex of explorers) {
    const n = ex === 'random' ? seeds : 1;
    const covs: Coverage[] = []; let steps = 0, ms = 0; let last: ExplorationResult | undefined;
    for (let s = 1; s <= n; s++) {
      const running = await startApp(app, []);      // clean app for coverage; bug runs arrive with the oracle (M2)
      try {
        const res = await runExplorer(ex, app, running.baseUrl, s); last = res;
        covs.push(coverage(res, labels)); steps += res.steps; ms += res.ms;
      } finally { await running.stop(); }
    }
    const avg = (f: (c: Coverage) => number) => covs.reduce((a, c) => a + f(c), 0) / covs.length;
    const cov: Coverage = { ...covs[0], statesCovered: avg(c => c.statesCovered), flowsCovered: avg(c => c.flowsCovered) };
    rows.push({ explorer: ex + (n > 1 ? ` (mean of ${n})` : ''), app, cov, steps: Math.round(steps / n), ms: Math.round(ms / n), cost: 0, extra: last?.stats });
    details.push({ explorer: ex, app, missingStates: covs.map(c => c.missing), missingFlows: covs.map(c => c.missingFlows), stats: last?.stats });
  }
}

const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);
console.log(pad('explorer', 24) + pad('app', 9) + pad('states', 12) + pad('flows', 10) + pad('steps', 7) + pad('time', 8) + pad('LLM $', 7) + 'recall / FP / replay');
for (const r of rows) {
  const f = (x: number) => Number.isInteger(x) ? String(x) : x.toFixed(1);
  console.log(pad(r.explorer, 24) + pad(r.app, 9) + pad(`${f(r.cov.statesCovered)}/${r.cov.statesTotal}`, 12) + pad(`${f(r.cov.flowsCovered)}/${r.cov.flowsTotal}`, 10) +
    pad(String(r.steps), 7) + pad((r.ms / 1000).toFixed(1) + 's', 8) + pad('$' + r.cost.toFixed(2), 7) + 'n/a (oracle=M2) / n/a / n/a (replayer=M2)');
}
for (const d of details as any[]) if (d.missingStates?.[0]?.length) console.log(`\n[${d.explorer} on ${d.app}] unreached states: ${d.missingStates[0].join(', ')}\n  unreached flows: ${d.missingFlows[0].join(', ') || '-'}`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ rows, details, budget }, null, 2));
