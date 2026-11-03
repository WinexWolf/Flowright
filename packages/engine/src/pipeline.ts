import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Budget, CrawlGraph, Flow, OracleFinding, TargetConfig } from '@flowright/core';
import { crawl } from '@flowright/explorer/crawler';
import { analyzeEverything, checkAssertions } from '@flowright/oracle';
import { findingSpec, detectJourneys, type Journey } from '@flowright/flow-compiler';
import { confirmFinding, replayFlow, replayPath, replayWithArtifacts, type Confirmation, type ArtifactPaths } from '@flowright/replayer';
import { shoot } from '@flowright/driver';
import { labelFlows, applyIntents, suggestFieldValues, withFieldValues } from '@flowright/semantic';
import type { LlmProvider } from '@flowright/llm-provider';
import { buildReport, type ReportData, type ReportFinding } from '@flowright/report';
import { affectedTemplates, routeInArea, selectFlows } from './diff.js';
import { toJUnit } from './junit.js';
import { acceptedFor, classify, fixedSince, flowChanges, loadState, saveState, stateDir, type RunRecord, type Status } from './state.js';
import { compareImages, runVisual, type VisualChange } from './visual.js';
import { toMarkdown, toSlack, type RunSummary } from './summary.js';
import { renderSuite, writeSuite } from './export.js';

export interface PipelineOptions {
  baseUrl: string; cfg: TargetConfig; outDir: string; budget: Budget; title?: string;
  provider?: LlmProvider | null; llmForms?: boolean; changedFiles?: string[];
  artifacts?: boolean; replayFlows?: boolean; confirm?: { attempts: number; need: number }; log?: (m: string) => void;
  /** Accessibility + keyboard scans on every discovered state. Off unless asked for (the CLI turns them on). */
  checks?: { a11y?: boolean; keyboard?: boolean };
  /** Project root: where `.flowright/` (history, accepted findings, visual baselines) lives. Leave unset for a stateless run. */
  stateRoot?: string;
  /** Visual regression against baselines in `.flowright/baselines`. Needs `stateRoot`. `update` accepts every change as the new baseline. */
  visual?: boolean | { update?: boolean; maxRatio?: number };
  exportDir?: string; reportUrl?: string;
}
export interface ConfirmedFinding { id: string; finding: OracleFinding; confirmation: Confirmation; artifacts?: ArtifactPaths; status: Status; visual?: VisualChange }
export interface PipelineResult {
  graph: CrawlGraph; findings: ConfirmedFinding[]; unconfirmed: OracleFinding[]; journeys: Journey[]; flows: Flow[];
  flowResults: { id: string; name: string; ok: boolean; why?: string }[]; fixed: { kind: string; route: string; detail: string }[]; flowsStoppedReplaying: string[];
  firstRun: boolean; visual: { changed: number; created: number; same: number }; outsideChangedArea: number; summary: RunSummary;
  reportPath: string; reportInlinePath: string; ms: number;
}

const hasErr = (o: CrawlGraph['edges'][number]['obs']) => o.consoleErrors.length + o.pageErrors.length + o.failedRequests.length + o.badResponses.length > 0;
const sevRank = (s: string) => (s === 'error' ? 0 : 1);
const GROUP: Record<string, ReportFinding['group']> = { a11y: 'a11y', keyboard: 'a11y', 'visual-change': 'visual' };

/** The map shows how each page was FIRST reached (a tree), colored by whether that click raised an error. */
function mapEdges(g: CrawlGraph) {
  const depth = new Map(g.states.map(s => [s.id, s.depth])); const out = new Map<string, { from: string; to: string; bad: boolean }>();
  for (const s of g.states) {
    if (s.depth === 0) continue;
    const into = g.edges.filter(e => e.to === s.id && e.from !== s.id);
    const e = into.find(x => depth.get(x.from) === s.depth - 1) ?? into[0];
    if (e) out.set(`${e.from}>${e.to}`, { from: e.from, to: e.to, bad: hasErr(e.obs) });
  }
  return [...out.values()];
}

/** Fail the build? Accepted findings never fail it. `new` = only problems that were not there last run (CI-friendly for existing apps). */
export function shouldFail(r: Pick<PipelineResult, 'findings'>, failOn: 'error' | 'suspect' | 'new' | 'none' = 'error'): boolean {
  if (failOn === 'none') return false;
  const live = r.findings.filter(f => f.status !== 'accepted');
  if (failOn === 'new') return live.some(f => f.status === 'new' && f.finding.severity === 'error');
  return live.some(f => failOn === 'suspect' || f.finding.severity === 'error');
}

export async function analyzeApp(o: PipelineOptions): Promise<PipelineResult> {
  const log = o.log ?? (() => {}); const t0 = Date.now(); const out = o.outDir; fs.mkdirSync(out, { recursive: true });
  let cfg = o.cfg; const confirmCfg = o.confirm ?? { attempts: 3, need: 2 };
  const sdir = o.stateRoot ? stateDir(o.stateRoot) : undefined; const vOpts = typeof o.visual === 'object' ? o.visual : {}; const visualOn = !!o.visual && !!sdir;
  const screensDir = path.join(out, 'screens');

  if (o.provider && o.llmForms) {                                    // optional: a model proposes realistic form values after a short scouting crawl
    log('scouting forms for model-suggested values');
    const scout = await crawl(o.baseUrl, cfg, { maxSteps: 40, maxTimeMs: 60_000 });
    const seen = new Map<string, { key: string; fields: Extract<CrawlGraph['edges'][number]['action'], { kind: 'form' }>['fields'] }>();
    for (const e of scout.graph.edges) if (e.action.kind === 'form') seen.set(e.action.label, { key: e.action.label, fields: e.action.fields });
    try { cfg = withFieldValues(cfg, await suggestFieldValues(o.provider, [...seen.values()])); } catch (e) { log(`form-value suggestion failed, using heuristics: ${(e as Error).message}`); }
  }

  log('crawling');
  const res = await crawl(o.baseUrl, cfg, o.budget, { log: m => log('  ' + m), checks: o.checks, screenshots: visualOn ? { dir: screensDir, mask: cfg.visualMask } : undefined });
  const graph = res.graph; const stats = res.stats as Record<string, unknown>;
  const budgetHit = ['steps', 'time', 'states'].includes(String(stats.budgetExhausted));
  const affected = o.changedFiles ? affectedTemplates(o.changedFiles) : null;

  const all = analyzeEverything(graph).sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.route.localeCompare(b.route));
  const relevant = affected ? all.filter(f => routeInArea(f.route, affected)) : all;
  const outsideChangedArea = all.length - relevant.length;

  const browser = await chromium.launch();
  try {
    log(`confirming ${relevant.length} candidate finding(s) by replay`);
    const confirmed: ConfirmedFinding[] = []; const unconfirmed: OracleFinding[] = [];
    for (const f of relevant) {
      const c = await confirmFinding(browser, o.baseUrl, cfg, f, confirmCfg.attempts, confirmCfg.need);
      if (c.confirmed) confirmed.push({ id: '', finding: f, confirmation: c, status: 'new' }); else unconfirmed.push(f);
    }

    // ---- visual regression: compare with baselines, then re-shoot the changed pages in a fresh browser to rule out flakes
    let visual = { changed: 0, created: 0, same: 0 };
    if (visualOn && sdir) {
      const vr = runVisual({ graph, screensDir, baselineDir: path.join(sdir, 'baselines'), outDir: out, update: vOpts.update, maxRatio: vOpts.maxRatio });
      visual = { changed: 0, created: vr.created, same: vr.same };
      const tmp = path.join(out, 'visual', '_confirm'); fs.mkdirSync(tmp, { recursive: true });
      for (const ch of vr.changed) {
        const st = graph.states.find(s => s.id === ch.stateId)!; const base = path.join(out, ch.baseline);
        const r = await replayPath(browser, o.baseUrl, cfg, cfg.startPath, st.path, async p => { const f = path.join(tmp, ch.stateId + '.png'); await shoot(p, f, cfg.visualMask); return f; });
        const again = r.ok && typeof r.extra === 'string' && !compareImages(fs.readFileSync(base), fs.readFileSync(r.extra), { maxRatio: vOpts.maxRatio }).same;
        if (!again) { unconfirmed.push({ kind: 'visual-change', route: ch.route, detail: 'looked different once, but not when re-shot in a fresh browser', severity: 'suspect', signature: `visual-change|${st.urlTemplate}|${st.fine}`, path: st.path }); continue; }
        const pct = ch.sizeMismatch ? 'the page size changed' : `${(ch.ratio * 100).toFixed(1)}% of the page differs`;
        confirmed.push({ id: '', status: 'new', visual: ch, confirmation: { reproduced: 2, attempts: 2, confirmed: true },
          finding: { kind: 'visual-change', route: ch.route, detail: `Looks different from the saved baseline: ${pct}`, severity: 'suspect', signature: `visual-change|${st.urlTemplate}|${st.fine}`, path: st.path, meta: { ratio: ch.ratio, baseline: ch.baseline, current: ch.current, diff: ch.diff } } });
        visual.changed++;
      }
    }
    confirmed.sort((a, b) => sevRank(a.finding.severity) - sevRank(b.finding.severity) || a.finding.route.localeCompare(b.finding.route)); confirmed.forEach((c, i) => { c.id = `F${i + 1}`; });

    // ---- history: what is new, what is still open, what was fixed
    const state = sdir ? loadState(sdir) : { runs: [], accepted: {} }; const prev = state.runs[state.runs.length - 1];
    const statuses = classify(confirmed.map(c => c.finding.signature), prev, state.accepted);
    for (const c of confirmed) c.status = statuses.get(c.finding.signature) ?? 'new';

    if (o.artifacts !== false) {
      for (const c of confirmed.filter(x => x.finding.kind !== 'visual-change')) {
        const dir = path.join(out, 'artifacts', c.id);
        const r = await replayWithArtifacts(browser, o.baseUrl, cfg, cfg.startPath, c.finding.path, dir);
        c.artifacts = Object.fromEntries(Object.entries(r.paths).map(([k, v]) => [k, path.relative(out, v as string)]));
      }
    }
    fs.mkdirSync(path.join(out, 'repro'), { recursive: true });
    for (const c of confirmed) fs.writeFileSync(path.join(out, 'repro', `${c.id}-${c.finding.kind}.spec.ts`), findingSpec(c.finding, cfg));

    // ---- journeys and flows (named after what a user does), replayed with their intent checks
    const journeys = detectJourneys(graph, cfg);
    const labels = await labelFlows(o.provider ?? null, graph);
    let flows = applyIntents(journeys.flatMap(j => [j.flow, ...j.variants.filter(v => v.outcome === 'validation-error').map(v => v.flow)]), labels.intents);
    if (affected) flows = selectFlows(flows, affected);
    const flowResults: PipelineResult['flowResults'] = [];
    if (o.replayFlows !== false) {
      log(`replaying ${flows.length} flow(s)`);
      for (const f of flows) {
        const r = await replayFlow(browser, o.baseUrl, cfg, f); let why: string | undefined;
        if (!r.ok) why = 'did not arrive at the recorded page structure';
        else if (f.intent?.assertions.length && r.evidence) { const bad = checkAssertions(f.intent.assertions, r.evidence).filter(a => !a.ok); if (bad.length) why = bad.map(b => b.why).join('; '); }
        flowResults.push({ id: f.id, name: f.intent?.name ?? f.name, ok: !why, why });
      }
    }

    const sigs = confirmed.map(c => c.finding.signature);
    const record: RunRecord = { at: new Date().toISOString(), target: o.baseUrl, scope: affected ? 'diff' : 'full', budgetHit, findings: sigs, flows: Object.fromEntries(flowResults.map(f => [f.id, f.ok])), pages: graph.states.length };
    const fixedSigs = fixedSince(prev, record).filter(s => !s.startsWith('visual-change|'));
    const fixed = fixedSigs.map(s => { const [kind, route] = s.split('|'); return { kind, route, detail: 'no longer reproduces' }; });
    const flowDelta = flowChanges(prev, record.flows);
    if (sdir) { state.runs.push(record); saveState(sdir, state); }
    const firstRun = !prev;

    // ---- outputs
    const label = (a: { label: string }) => a.label; const live = confirmed.filter(c => c.status !== 'accepted');
    const reportData: ReportData = {
      title: o.title ?? 'Flowright report', target: o.baseUrl, generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC', durationMs: Date.now() - t0,
      findings: confirmed.map(c => ({ id: c.id, kind: c.finding.kind, severity: c.finding.severity, route: c.finding.route, detail: c.finding.detail, occurrences: 1, steps: c.finding.path.map(label), reproduced: c.confirmation.reproduced, attempts: c.confirmation.attempts, repro: findingSpec(c.finding, cfg), artifacts: c.artifacts, status: c.status, group: GROUP[c.finding.kind] ?? 'bug', visual: c.visual ? { ratio: c.visual.ratio, baseline: c.visual.baseline, current: c.visual.current, diff: c.visual.diff } : undefined })),
      unconfirmed: unconfirmed.map(f => ({ kind: f.kind, route: f.route, detail: f.detail })),
      flows: flows.filter(f => !journeys.some(j => j.flow.id === f.id)).map(f => ({ id: f.id, name: f.name, steps: f.steps.map(label), assertions: [], replay: flowResults.find(x => x.id === f.id) })),
      journeys: journeys.map(j => ({ name: labels.intents.get(j.id)?.name && j.kind === 'page' ? labels.intents.get(j.id)!.name : j.name, kind: j.kind, steps: j.steps, variants: j.variants.map(v => ({ label: v.label, outcome: v.outcome })), replay: (() => { const r = flowResults.find(x => x.id === j.id); return r ? { ok: r.ok, why: r.why } : undefined; })() })),
      fixed, firstRun, visual: { changed: visual.changed, created: visual.created },
      graph: { states: graph.states.map(s => ({ id: s.id, route: s.evidence.route, heading: s.evidence.headings[0] ?? '', depth: s.depth, findings: confirmed.filter(c => c.finding.route === s.evidence.route && c.status !== 'accepted').length })), edges: mapEdges(graph) },
      facts: {
        'Pages found': graph.states.length, 'Clicks and form submits tried': res.steps, 'Crawl time': `${Math.round(res.ms / 1000)} seconds`,
        'Replay drift': Number(stats.replayDrift ?? 0), 'Pages that never went quiet': Number(stats.settleTimeouts ?? 0),
        ...(o.checks?.a11y || o.checks?.keyboard ? { 'Accessibility scanned': `${graph.states.filter(s => s.checks).length} states (WCAG 2.x A/AA${o.checks.keyboard ? ' + keyboard' : ''})` } : {}),
        ...(visualOn ? { 'Visual baselines': visual.created ? `${visual.created} created (first look at these pages)` : `${visual.same} unchanged` } : {}),
        ...(o.cfg.device === 'mobile' ? { Device: 'phone (390 x 844, touch)' } : {}),
        ...(Object.keys(state.accepted).length ? { 'Accepted findings': Object.keys(state.accepted).length } : {}),
        ...(flowDelta.stopped.length ? { 'Flows that stopped replaying': flowDelta.stopped.length } : {}),
        ...(affected ? { 'Changed files': o.changedFiles!.length, 'Findings outside the changed area (not verified)': outsideChangedArea } : {}),
      },
      llm: o.provider ? { used: labels.usedModel, calls: o.provider.totals().calls, costUsd: o.provider.totals().costUsd, rejectedAssertions: labels.rejectedAssertions, simulated: o.provider.simulated === true } : undefined,
    };
    const reportPath = path.join(out, 'report.html'), reportInlinePath = path.join(out, 'report.inline.html');
    fs.writeFileSync(path.join(out, 'report-data.json'), JSON.stringify(reportData, null, 2));
    fs.writeFileSync(reportPath, buildReport(reportData, { assets: 'link' }));
    fs.writeFileSync(reportInlinePath, buildReport(reportData, { assets: 'inline', baseDir: out }));
    fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify({ confirmed: confirmed.map(c => ({ id: c.id, signature: c.finding.signature, status: c.status, kind: c.finding.kind, severity: c.finding.severity, route: c.finding.route, detail: c.finding.detail, confirmation: c.confirmation, artifacts: c.artifacts })), unconfirmed: unconfirmed.map(f => ({ kind: f.kind, route: f.route, detail: f.detail })), fixed }, null, 2));
    fs.writeFileSync(path.join(out, 'journeys.json'), JSON.stringify(journeys, null, 2));
    fs.writeFileSync(path.join(out, 'flows.json'), JSON.stringify(flows, null, 2));
    fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(graph, null, 2));
    fs.writeFileSync(path.join(out, 'target.json'), JSON.stringify(cfg, null, 2));
    fs.writeFileSync(path.join(out, 'junit.xml'), toJUnit(o.title ?? 'flowright', flowResults.map(f => ({ name: f.name, ok: f.ok, why: f.why })), live.map(c => ({ id: c.id, kind: c.finding.kind, route: c.finding.route, detail: c.finding.detail, severity: c.finding.severity })), (Date.now() - t0) / 1000));
    const summary: RunSummary = { title: o.title ?? 'Flowright', target: o.baseUrl, pages: graph.states.length, flows: { passed: flowResults.filter(f => f.ok).length, total: flowResults.length }, findings: confirmed.map(c => ({ id: c.id, severity: c.finding.severity, kind: c.finding.kind, route: c.finding.route, detail: c.finding.detail, status: c.status })), fixed, firstRun, visual: { changed: visual.changed, created: visual.created }, reportUrl: o.reportUrl, durationSec: (Date.now() - t0) / 1000 };
    fs.writeFileSync(path.join(out, 'summary.md'), toMarkdown(summary)); fs.writeFileSync(path.join(out, 'slack.json'), JSON.stringify(toSlack(summary), null, 2));
    if (o.exportDir) { writeSuite(o.exportDir, renderSuite({ name: o.title ?? cfg.name, cfg, journeys })); log(`exported a Playwright suite to ${o.exportDir}`); }
    return { graph, findings: confirmed, unconfirmed, journeys, flows, flowResults, fixed, flowsStoppedReplaying: flowDelta.stopped, firstRun, visual, outsideChangedArea, summary, reportPath, reportInlinePath, ms: Date.now() - t0 };
  } finally { await browser.close().catch(() => {}); }
}
export { acceptedFor };
