import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Budget, CrawlGraph, Flow, OracleFinding, TargetConfig } from '@flowright/core';
import { crawl } from '@flowright/explorer/crawler';
import { analyze, checkAssertions } from '@flowright/oracle';
import { compileFlows, findingSpec } from '@flowright/flow-compiler';
import { confirmFinding, replayFlow, replayWithArtifacts, type Confirmation, type ArtifactPaths } from '@flowright/replayer';
import { labelFlows, applyIntents, suggestFieldValues, withFieldValues } from '@flowright/semantic';
import type { LlmProvider } from '@flowright/llm-provider';
import { buildReport, type ReportData } from '@flowright/report';
import { affectedTemplates, routeInArea, selectFlows } from './diff.js';
import { toJUnit } from './junit.js';

export interface PipelineOptions {
  baseUrl: string; cfg: TargetConfig; outDir: string; budget: Budget; title?: string;
  provider?: LlmProvider | null; llmForms?: boolean; changedFiles?: string[];
  artifacts?: boolean; replayFlows?: boolean; confirm?: { attempts: number; need: number }; log?: (m: string) => void;
}
export interface ConfirmedFinding { id: string; finding: OracleFinding; confirmation: Confirmation; artifacts?: ArtifactPaths }
export interface PipelineResult {
  graph: CrawlGraph; findings: ConfirmedFinding[]; unconfirmed: OracleFinding[]; flows: Flow[];
  flowResults: { id: string; name: string; ok: boolean; why?: string }[]; outsideChangedArea: number; reportPath: string; reportInlinePath: string; ms: number;
}

const hasErr = (o: CrawlGraph['edges'][number]['obs']) => o.consoleErrors.length + o.pageErrors.length + o.failedRequests.length + o.badResponses.length > 0;
/** The map shows how each page was FIRST reached (a tree), colored by whether that click raised an error. Drawing every erroring click would bury it: nearly every page links to the broken one. */
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
const sevRank = (s: string) => (s === 'error' ? 0 : 1);

export async function analyzeApp(o: PipelineOptions): Promise<PipelineResult> {
  const log = o.log ?? (() => {}); const t0 = Date.now(); const out = o.outDir; fs.mkdirSync(out, { recursive: true });
  let cfg = o.cfg; const confirmCfg = o.confirm ?? { attempts: 3, need: 2 };

  // optional: let a model propose realistic form values after a short scouting crawl (proposals are validated; explicit user values win)
  if (o.provider && o.llmForms) {
    log('scouting forms for model-suggested values');
    const scout = await crawl(o.baseUrl, cfg, { maxSteps: 40, maxTimeMs: 60_000 });
    const seen = new Map<string, { key: string; fields: Extract<CrawlGraph['edges'][number]['action'], { kind: 'form' }>['fields'] }>();
    for (const e of scout.graph.edges) if (e.action.kind === 'form') seen.set(e.action.label, { key: e.action.label, fields: e.action.fields });
    try { cfg = withFieldValues(cfg, await suggestFieldValues(o.provider, [...seen.values()])); } catch (e) { log(`form-value suggestion failed, using heuristics: ${(e as Error).message}`); }
  }

  log('crawling');
  const res = await crawl(o.baseUrl, cfg, o.budget, { log: m => log('  ' + m) });
  const graph = res.graph;
  const affected = o.changedFiles ? affectedTemplates(o.changedFiles) : null;

  const all = analyze(graph).sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.route.localeCompare(b.route));
  const relevant = affected ? all.filter(f => routeInArea(f.route, affected)) : all;
  const outsideChangedArea = all.length - relevant.length;

  const browser = await chromium.launch();
  try {
    log(`confirming ${relevant.length} candidate finding(s) by replay`);
    const confirmed: ConfirmedFinding[] = []; const unconfirmed: OracleFinding[] = [];
    for (const f of relevant) {
      const c = await confirmFinding(browser, o.baseUrl, cfg, f, confirmCfg.attempts, confirmCfg.need);
      if (c.confirmed) confirmed.push({ id: `F${confirmed.length + 1}`, finding: f, confirmation: c }); else unconfirmed.push(f);
    }
    if (o.artifacts !== false) {
      for (const c of confirmed) {
        const dir = path.join(out, 'artifacts', c.id);
        const r = await replayWithArtifacts(browser, o.baseUrl, cfg, cfg.startPath, c.finding.path, dir);
        c.artifacts = Object.fromEntries(Object.entries(r.paths).map(([k, v]) => [k, path.relative(out, v as string)]));
      }
    }
    fs.mkdirSync(path.join(out, 'repro'), { recursive: true });
    for (const c of confirmed) fs.writeFileSync(path.join(out, 'repro', `${c.id}-${c.finding.kind}.spec.ts`), findingSpec(c.finding, cfg));

    // flows: compile, name (model or observed), select by diff, replay and check assertions deterministically
    let flows = compileFlows(graph, cfg);
    const labels = await labelFlows(o.provider ?? null, graph);
    flows = applyIntents(flows, labels.intents);
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

    // ---- write everything
    const label = (a: { label: string }) => a.label;
    const reportData: ReportData = {
      title: o.title ?? 'Flowright report', target: o.baseUrl, generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC', durationMs: Date.now() - t0,
      findings: confirmed.map(c => ({ id: c.id, kind: c.finding.kind, severity: c.finding.severity, route: c.finding.route, detail: c.finding.detail, occurrences: 1, steps: c.finding.path.map(label), reproduced: c.confirmation.reproduced, attempts: c.confirmation.attempts, repro: findingSpec(c.finding, cfg), artifacts: c.artifacts })),
      unconfirmed: unconfirmed.map(f => ({ kind: f.kind, route: f.route, detail: f.detail })),
      flows: flows.map(f => { const r = flowResults.find(x => x.id === f.id); return { id: f.id, name: f.intent?.name ?? f.name, intent: f.intent?.intent, steps: f.steps.map(label), assertions: (f.intent?.assertions ?? []).map(a => a.kind === 'no-alert' ? 'no alert is showing' : a.kind === 'url-matches' ? `URL matches ${a.pattern}` : `${a.kind.replace('-', ' ')} “${a.text}”`), replay: r ? { ok: r.ok, why: r.why } : undefined }; }),
      graph: { states: graph.states.map(s => ({ id: s.id, route: s.evidence.route, heading: s.evidence.headings[0] ?? '', depth: s.depth, findings: confirmed.filter(c => c.finding.route === s.evidence.route).length })), edges: mapEdges(graph) },
      facts: {
        'Pages found': graph.states.length, 'Clicks and form submits tried': res.steps, 'Crawl time': `${Math.round(res.ms / 1000)} seconds`,
        'Replay drift': Number((res.stats as Record<string, unknown>)?.replayDrift ?? 0), 'Pages that never went quiet': Number((res.stats as Record<string, unknown>)?.settleTimeouts ?? 0),
        ...(affected ? { 'Changed files': o.changedFiles!.length, 'Findings outside the changed area (not verified)': outsideChangedArea } : {}),
      },
      llm: o.provider ? { used: labels.usedModel, calls: o.provider.totals().calls, costUsd: o.provider.totals().costUsd, rejectedAssertions: labels.rejectedAssertions } : undefined,
    };
    const reportPath = path.join(out, 'report.html'), reportInlinePath = path.join(out, 'report.inline.html');
    fs.writeFileSync(path.join(out, 'report-data.json'), JSON.stringify(reportData, null, 2));   // lets `flowright report` re-render without recrawling
    fs.writeFileSync(reportPath, buildReport(reportData, { assets: 'link' }));
    fs.writeFileSync(reportInlinePath, buildReport(reportData, { assets: 'inline', baseDir: out }));
    fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify({ confirmed: confirmed.map(c => ({ id: c.id, kind: c.finding.kind, severity: c.finding.severity, route: c.finding.route, detail: c.finding.detail, confirmation: c.confirmation, artifacts: c.artifacts })), unconfirmed: unconfirmed.map(f => ({ kind: f.kind, route: f.route, detail: f.detail })) }, null, 2));
    fs.writeFileSync(path.join(out, 'flows.json'), JSON.stringify(flows, null, 2));
    fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(graph, null, 2));
    fs.writeFileSync(path.join(out, 'junit.xml'), toJUnit(o.title ?? 'flowright', flowResults.map(f => ({ name: f.name, ok: f.ok, why: f.why })), confirmed.map(c => ({ id: c.id, kind: c.finding.kind, route: c.finding.route, detail: c.finding.detail, severity: c.finding.severity })), (Date.now() - t0) / 1000));
    return { graph, findings: confirmed, unconfirmed, flows, flowResults, outsideChangedArea, reportPath, reportInlinePath, ms: Date.now() - t0 };
  } finally { await browser.close().catch(() => {}); }
}
