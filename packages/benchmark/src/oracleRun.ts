import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { OracleFinding } from '@flowright/core';
import { crawl } from '@flowright/explorer/crawler';
import { analyze } from '@flowright/oracle';
import { confirmFinding, measureReplay } from '@flowright/replayer';
import { compileFlows } from '@flowright/flow-compiler';
import { startApp } from './servers.js';
import { TARGETS } from './targets.js';
import type { Budget } from '@flowright/core';

const here = path.dirname(fileURLToPath(import.meta.url));
interface Bug { id: string; app: string; kind: string; split: 'dev' | 'heldout'; where: string; match: { kinds: string[]; route: string } }
const allBugs = (): Bug[] => JSON.parse(fs.readFileSync(path.join(here, '../labels/bugs.json'), 'utf8')).bugs;
interface Errata { id: string; app: string; kinds: string[]; route: string }
const errata = (): Errata[] => JSON.parse(fs.readFileSync(path.join(here, '../labels/errata.json'), 'utf8')).defects;
const isErrata = (app: string, f: OracleFinding) => errata().some(e => e.app === app && e.kinds.includes(f.kind) && new RegExp(e.route).test(f.route));
const hits = (b: Bug, f: OracleFinding) => b.match.kinds.includes(f.kind) && new RegExp(b.match.route).test(f.route);

export interface OracleRunResult {
  app: string; split: string; enabled: string[]; detected: string[]; missed: string[];
  recall: number; confirmed: number; unconfirmed: number; falsePositives: { kind: string; route: string; detail: string; severity: string }[];
  cleanFalsePositives: { kind: string; route: string; detail: string; severity: string }[];
  replay: { flows: number; runs: number; successRate: number; flaky: string[]; failing: string[] };
  crawlMs: number; found: { kind: string; route: string; severity: string; confirmed: boolean; matches: string[] }[];
}

/** Crawl -> oracle -> confirm by replay. Returns only CONFIRMED findings (reproduced in >=2 of 3 fresh-context replays). */
async function findConfirmed(app: string, bugs: string[], budget: Budget, browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const running = await startApp(app, bugs);
  try {
    const cfg = TARGETS[app];
    const res = await crawl(running.baseUrl, cfg, budget);
    const raw = analyze(res.graph);
    const confirmed: OracleFinding[] = [], unconfirmed: OracleFinding[] = [];
    for (const f of raw) ((await confirmFinding(browser, running.baseUrl, cfg, f)).confirmed ? confirmed : unconfirmed).push(f);
    return { res, raw, confirmed, unconfirmed, running, cfg };
  } catch (e) { await running.stop(); throw e; }
}

export interface PerBug { bug: string; detected: boolean; confirmedFindings: number; falsePositives: Brief[]; errata: Brief[] }
type Brief = { kind: string; route: string; detail: string; severity: string };
const brief = (f: OracleFinding): Brief => ({ kind: f.kind, route: f.route, detail: f.detail.slice(0, 90), severity: f.severity });

/**
 * mode 'isolated': one injected bug per crawl (standard mutation-style evaluation; bugs cannot mask each other).
 * mode 'combined': all selected bugs injected at once (also reported, because masking happens in real apps too).
 */
export async function evaluateApp(app: string, which: 'dev' | 'heldout', budget: Budget, replayK = 3, mode: 'isolated' | 'combined' = 'isolated'): Promise<OracleRunResult & { perBug: PerBug[]; mode: string }> {
  const browser = await chromium.launch();
  try {
    const enabled = allBugs().filter(b => b.app === app && b.split === which);
    const clean = await findConfirmed(app, [], budget, browser);
    const flows = compileFlows(clean.res.graph, clean.cfg);
    const replay = await measureReplay(browser, clean.running.baseUrl, clean.cfg, flows, replayK);
    await clean.running.stop();

    const t0 = Date.now(); const perBug: PerBug[] = []; const detected = new Set<string>(); const fpSeen = new Map<string, Brief>(); const errSeen = new Map<string, Brief>();
    const found: OracleRunResult['found'] = []; let confirmedN = 0, unconfirmedN = 0;
    const runs: Bug[][] = mode === 'isolated' ? enabled.map(b => [b]) : [enabled];
    for (const set of runs) {
      const d = await findConfirmed(app, set.map(b => b.id), budget, browser); await d.running.stop();
      confirmedN += d.confirmed.length; unconfirmedN += d.unconfirmed.length;
      for (const b of set) if (d.confirmed.some(f => hits(b, f))) detected.add(b.id);
      const fps: Brief[] = [], errs: Brief[] = [];
      for (const f of d.confirmed) {
        if (set.some(b => hits(b, f))) continue;
        if (isErrata(app, f)) { errs.push(brief(f)); errSeen.set(f.signature, brief(f)); } else { fps.push(brief(f)); fpSeen.set(f.signature, brief(f)); }
      }
      for (const b of set) perBug.push({ bug: b.id, detected: d.confirmed.some(f => hits(b, f)), confirmedFindings: d.confirmed.length, falsePositives: fps, errata: errs });
      for (const f of [...d.confirmed.map(f => ({ f, c: true })), ...d.unconfirmed.map(f => ({ f, c: false }))]) found.push({ kind: f.f.kind, route: f.f.route, severity: f.f.severity, confirmed: f.c, matches: set.filter(b => hits(b, f.f)).map(b => b.id) });
    }
    const cleanFP = clean.confirmed.filter(f => !isErrata(app, f)).map(brief);
    return {
      mode, perBug, app, split: which, enabled: enabled.map(b => b.id), detected: [...detected], missed: enabled.filter(b => !detected.has(b.id)).map(b => b.id),
      recall: enabled.length ? detected.size / enabled.length : 1, confirmed: confirmedN, unconfirmed: unconfirmedN,
      falsePositives: [...fpSeen.values()], cleanFalsePositives: cleanFP,
      replay: { flows: replay.flows, runs: replay.runs, successRate: replay.successRate, flaky: replay.flaky, failing: replay.failing },
      crawlMs: Date.now() - t0, found,
    } as OracleRunResult & { perBug: PerBug[]; mode: string; errata?: Brief[] } & { errata: Brief[] };
  } finally { await browser.close(); }
}
