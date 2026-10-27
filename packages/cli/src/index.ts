#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { crawl } from '@flowright/explorer/crawler';
import { graphHtml } from '@flowright/explorer';
import type { TargetConfig } from '@flowright/core';

const [cmd, url, ...rest] = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = rest.indexOf('--' + n); return i >= 0 ? (rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : 'true') : d; };

if (cmd !== 'crawl' || !url) {
  console.log(`usage: flowright crawl <baseUrl> [--config target.json] [--steps 300] [--time 300000] [--out reports/run] [--dry-run] [--allow-nonlocal]

Safety: refuses to crawl non-localhost hosts unless --allow-nonlocal is passed, and applies the full destructive-action
blocklist unless the target config says "sandbox": true.`);
  process.exit(cmd ? 1 : 0);
}
const host = new URL(url).hostname;
const local = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!local && flag('allow-nonlocal') !== 'true') { console.error(`Refusing to crawl non-local host "${host}". Pass --allow-nonlocal to confirm you own it and it is safe to click through.`); process.exit(2); }

const cfg: TargetConfig = flag('config') ? JSON.parse(fs.readFileSync(flag('config')!, 'utf8')) : { name: host, startPath: '/', sandbox: false };
const out = flag('out', `reports/${cfg.name}`)!; fs.mkdirSync(out, { recursive: true });
const res = await crawl(url, cfg, { maxSteps: Number(flag('steps', '300')), maxTimeMs: Number(flag('time', '300000')) }, { dryRun: flag('dry-run') === 'true', log: m => console.log('  ' + m) });
fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(res.graph, null, 2));
fs.writeFileSync(path.join(out, 'graph.html'), graphHtml(`Flowright: ${cfg.name}`, res.graph, res.stats ?? {}));
console.log(`\nstates=${res.states.length} transitions=${res.transitions.length} steps=${res.steps} time=${(res.ms / 1000).toFixed(1)}s\nstats: ${JSON.stringify(res.stats)}\nwrote ${out}/graph.json and graph.html`);
