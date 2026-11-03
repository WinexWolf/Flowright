import { chromium, type Browser } from 'playwright';
import {
  fingerprint, fineFrom, coarseFrom, UrlTemplater,
  type Action, type Budget, type CrawlGraph, type Edge, type ExplorationResult, type Obs, type PageSnapshot, type StateNode, type TargetConfig, type Variant,
} from '@flowright/core';
import path from 'node:path';
import { snapshot, openSession, perform as performAction, scanPage, shoot, type Session, type PerformInfo } from '@flowright/driver';
import { isBlocked } from './blocklist.js';
export { valueFor } from '@flowright/driver';
export type { Action, CrawlGraph, Edge, Obs, StateNode, Variant } from '@flowright/core';

export interface CrawlOptions {
  /** How many times the same (control, page-structure) pair may be tried. Scoped per page STRUCTURE so stateful controls
   *  (a dropdown, a tab) are still tried from each kind of page, while the same nav link on 40 near-identical pages is not. */
  maxPerElementKey?: number;
  dryRun?: boolean;               // load the start page, list what would be done, do nothing else
  checks?: { a11y?: boolean; keyboard?: boolean };      // accessibility + keyboard scan of every NEW state (dialogs, error states and tabs included)
  screenshots?: { dir: string; mask?: string[] };       // a stable screenshot of every NEW state, for visual regression
  log?: (msg: string) => void;
}
export type CrawlResult = ExplorationResult & { graph: CrawlGraph };

interface Task { node: StateNode; action: Action; key: string; prio: number; retries?: number }
const idNum = (id: string) => Number(id.slice(1));

export async function crawl(baseUrl: string, cfg: TargetConfig, budget: Budget, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const browser: Browser = await chromium.launch();
  try { return await run(browser, baseUrl, cfg, budget, opts); }
  finally { await browser.close().catch(() => {}); }          // never leak a browser, even if the first page load throws
}

async function run(browser: Browser, baseUrl: string, cfg: TargetConfig, budget: Budget, opts: CrawlOptions): Promise<CrawlResult> {
  const log = opts.log ?? (() => {});
  const maxPerKey = opts.maxPerElementKey ?? 2;
  const t0 = Date.now();
  const allowedHosts = new Set([new URL(baseUrl).host, ...(cfg.allowedHosts ?? [])]);   // used to skip off-site links; hard containment is in openSession
  const templater = new UrlTemplater(cfg);

  const states = new Map<string, StateNode>();            // CURRENT fine fingerprint -> canonical node
  const nodesById = new Map<string, StateNode>();
  const mergedInto = new Map<string, string>();           // duplicate id -> canonical id
  const edges: Edge[] = [];
  const queue: Task[] = [];
  const keyCounts = new Map<string, number>();
  const stats = {
    tasksCreated: 0, executed: 0, skippedBlocked: 0, skippedExternal: 0, skippedKeyCap: 0, actionErrors: 0,
    replayDrift: 0, driftRetried: 0, driftDropped: 0, settleTimeouts: 0, nativeBlockedSubmits: 0, noEffectActions: 0,
    budgetExhausted: '' as string, actionErrorLog: [] as string[],
  };
  let seq = 0; let tplVersion = templater.version;
  const canon = (id: string) => { while (mergedInto.has(id)) id = mergedInto.get(id)!; return id; };

  /**
   * URL templates are LEARNED while crawling (e.g. /books/:slug appears once 3 distinct slugs are seen). When that happens, states that were
   * registered earlier under literal URLs must be re-keyed, or (a) duplicates keep being expanded and (b) the replay drift check compares
   * against a stale fingerprint and wrongly drops valid work.
   */
  function rekey() {
    if (templater.version === tplVersion) return;
    tplVersion = templater.version;
    const next = new Map<string, StateNode>();
    for (const n of [...nodesById.values()].filter(n => !mergedInto.has(n.id)).sort((a, b) => idNum(a.id) - idNum(b.id))) {
      const tpl = templater.template(n.url);
      const fine = fineFrom(tpl, n.treeHash, n.overlay);
      const hit = next.get(fine);
      if (hit) mergedInto.set(n.id, hit.id);
      else { n.urlTemplate = tpl; n.fine = fine; n.coarse = coarseFrom(tpl, n.treeHash); next.set(fine, n); }
    }
    states.clear(); for (const [k, v] of next) states.set(k, v);
    for (let i = queue.length - 1; i >= 0; i--) if (mergedInto.has(queue[i].node.id)) queue.splice(i, 1);   // the canonical twin already has these tasks
  }

  function register(snap: PageSnapshot, url: string, path: Action[], depth: number): { node: StateNode; isNew: boolean } {
    templater.observe(url); rekey();
    const tpl = templater.template(url);
    const fp = fingerprint(tpl, snap.tree, snap.tabs);
    const existing = states.get(fp.fine);
    if (existing) return { node: existing, isNew: false };
    const node: StateNode = { id: 's' + nodesById.size, fine: fp.fine, coarse: fp.coarse, treeHash: fp.treeHash, overlay: fp.overlay, url, urlTemplate: tpl, evidence: snap.evidence, depth, path };
    states.set(fp.fine, node); nodesById.set(node.id, node);
    enumerate(node, snap);
    return { node, isNew: true };
  }

  function enumerate(node: StateNode, snap: PageSnapshot) {
    const modal = snap.evidence.dialogs.length > 0;     // with a modal open, only the modal is actionable
    const push = (action: Action, key: string) => { queue.push({ node, action, key, prio: node.depth * 1e6 + seq++ }); stats.tasksCreated++; };
    for (const el of snap.interactive) {
      if (el.disabled || (modal && !el.inModal)) continue;
      if (el.target === '_blank') { stats.skippedExternal++; continue; }
      let u: URL | null = null; try { u = el.href ? new URL(el.href) : null; } catch { u = null; }
      // javascript: links are in-page handlers (actionable); mailto:/tel:/other schemes and other hosts leave the app
      if (u && u.protocol !== 'javascript:' && (!['http:', 'https:'].includes(u.protocol) || !allowedHosts.has(u.host))) { stats.skippedExternal++; continue; }
      // the blocklist looks at what the control SAYS and where a link GOES: a link named "Sign off" that points at /logout is still a logout
      if (isBlocked(`${el.name} ${u && u.protocol !== 'javascript:' ? u.pathname : ''}`, cfg)) { stats.skippedBlocked++; continue; }
      const hrefT = u && u.protocol !== 'javascript:' ? templater.template(el.href!) : '';
      push({ kind: 'click', role: el.role, name: el.name, nth: el.nth, css: el.css, label: `click ${el.role} "${el.name}"`, href: el.href }, `click|${el.role}|${el.name}|${hrefT}`);
    }
    for (const f of snap.forms) {
      if (modal && !f.inModal) continue;
      if (isBlocked(`${f.submit?.name ?? ''} ${f.action && f.action !== 'inline' ? f.action : ''}`, cfg)) { stats.skippedBlocked++; continue; }
      for (const variant of ['valid', 'empty', 'invalid'] as Variant[]) {
        push({ kind: 'form', variant, fields: f.fields, submit: f.submit ?? null, label: `form ${f.key} [${variant}]`, method: f.method }, `form|${f.key}|${variant}`);
      }
    }
  }

  const perform = (s: Session, a: Action, info?: PerformInfo) => performAction(s.page, () => s.tr.settle(), cfg, a, info);
  const take = async (s: Session) => { const snap = await snapshot(s.page); return { snap, url: s.page.url() }; };
  // Inspect a state the first time it is seen. Order matters: screenshot FIRST (focus rings from the keyboard scan would change it).
  const inspect = async (s: Session, node: StateNode) => {
    try {
      if (opts.screenshots) node.screenshot = await shoot(s.page, path.join(opts.screenshots.dir, node.id + '.png'), opts.screenshots.mask ?? cfg.visualMask);
      if (opts.checks && (opts.checks.a11y || opts.checks.keyboard)) node.checks = await scanPage(s.page, opts.checks);
    } catch (e) { log(`could not inspect ${node.id}: ${(e as Error).message.split('\n')[0]}`); }
  };
  const closeSession = async (s: Session) => { stats.settleTimeouts += s.tr.timeouts; await s.ctx.close().catch(() => {}); };

  // ---- root
  {
    const s = await openSession(browser, baseUrl, cfg);
    try {
      await s.page.goto(baseUrl + cfg.startPath).catch(() => {});
      await s.tr.settle();
      const { snap, url } = await take(s);
      const r = register(snap, url, [], 0);
      await inspect(s, r.node);
    } finally { await closeSession(s); }
  }
  log(`root: ${queue.length} candidate actions`);

  if (opts.dryRun) {
    const g: CrawlGraph = { states: [...states.values()], edges: [], cycles: [] };
    return { explorer: 'crawler(dry-run)', states: g.states.map(n => ({ id: n.id, evidence: n.evidence, depth: n.depth })), transitions: [], steps: 0, ms: Date.now() - t0, costUsd: 0, stats: { ...stats, dryRun: true, wouldRun: queue.map(t => t.action.label) }, graph: g };
  }

  // ---- main loop: shallowest unexplored action first
  while (queue.length) {
    if (stats.executed >= budget.maxSteps) { stats.budgetExhausted = 'steps'; break; }
    if (Date.now() - t0 > budget.maxTimeMs) { stats.budgetExhausted = 'time'; break; }
    if (budget.maxStates && states.size >= budget.maxStates) { stats.budgetExhausted = 'states'; break; }
    let bi = 0; for (let i = 1; i < queue.length; i++) if (queue[i].prio < queue[bi].prio) bi = i;
    const task = queue.splice(bi, 1)[0];
    const capKey = `${task.key}|${task.node.coarse}`;
    if ((keyCounts.get(capKey) ?? 0) >= maxPerKey) { stats.skippedKeyCap++; continue; }
    keyCounts.set(capKey, (keyCounts.get(capKey) ?? 0) + 1);

    const s = await openSession(browser, baseUrl, cfg);
    try {
      await s.page.goto(baseUrl + cfg.startPath).catch(() => {});
      await s.tr.settle();
      let replayErr: string | null = null;
      for (const step of task.node.path) { replayErr = await perform(s, step); if (replayErr) break; }
      if (!replayErr) {
        const here = await take(s);
        templater.observe(here.url); rekey();
        const fp = fingerprint(templater.template(here.url), here.snap.tree, here.snap.tabs);
        if (fp.fine !== task.node.fine) replayErr = 'replay drift: arrived in a different state than recorded';
      }
      if (replayErr) {
        stats.replayDrift++; log(`drift on ${task.action.label} from ${task.node.id}: ${replayErr}`);
        keyCounts.set(capKey, (keyCounts.get(capKey) ?? 1) - 1);        // a drifted attempt must not consume the action's budget
        if ((task.retries ?? 0) < 1 && !mergedInto.has(task.node.id)) { stats.driftRetried++; queue.push({ ...task, retries: (task.retries ?? 0) + 1, prio: task.prio + 1e5 }); }
        else stats.driftDropped++;
        continue;
      }

      const before = { url: s.page.url(), fine: task.node.fine, requests: s.requests, mut: await s.tr.lastMutation() };
      s.resetObs();
      const info: PerformInfo = {};
      const err = await perform(s, task.action, info);
      stats.executed++;
      if (err) {                                  // the crawler failed to perform it: that says nothing about the app, so it is NOT a graph edge
        stats.actionErrors++; if (stats.actionErrorLog.length < 20) stats.actionErrorLog.push(`${task.node.id} ${task.action.label}: ${err}`);
        continue;
      }
      const after = await take(s);
      const { node: dest, isNew } = register(after.snap, after.url, [...task.node.path, task.action], task.node.depth + 1);
      s.obs.domMutated = (await s.tr.lastMutation()) > before.mut;
      s.obs.noEffect = dest.fine === before.fine && after.url === before.url && s.requests === before.requests && !s.obs.domMutated;
      s.obs.nativeBlocked = !!info.nativeBlocked; s.obs.settleTimedOut = !!info.settleTimedOut;
      if (s.obs.noEffect) stats.noEffectActions++;
      if (s.obs.nativeBlocked) stats.nativeBlockedSubmits++;
      edges.push({ from: task.node.id, to: dest.id, label: task.action.label, action: task.action, obs: s.obs });
      if (isNew) await inspect(s, dest);
      if (isNew) log(`new ${dest.id} d${dest.depth} ${dest.evidence.route} [${dest.evidence.headings[0] ?? ''}] via ${task.action.label}`);
    } finally { await closeSession(s); }
  }
  if (!queue.length && !stats.budgetExhausted) stats.budgetExhausted = 'none (frontier empty)';

  // ---- finalise: remap merged ids; merge duplicate edges WITHOUT losing what the second instance observed
  rekey(); tplVersion = -1; rekey();
  const finalStates = [...states.values()].sort((a, b) => idNum(a.id) - idNum(b.id));
  const byKey = new Map<string, Edge>();
  for (const e of edges) {
    const from = canon(e.from), to = canon(e.to);
    const k = `${from}>${to}>${e.label}`; const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { ...e, from, to, obs: { ...e.obs } }); continue; }
    const o = prev.obs;                                    // union of symptoms; "no effect" only if EVERY instance had no effect
    o.consoleErrors = [...new Set([...o.consoleErrors, ...e.obs.consoleErrors])]; o.pageErrors = [...new Set([...o.pageErrors, ...e.obs.pageErrors])];
    o.failedRequests = [...new Set([...o.failedRequests, ...e.obs.failedRequests])]; o.badResponses = [...new Set([...o.badResponses, ...e.obs.badResponses])];
    o.noEffect = o.noEffect && e.obs.noEffect; o.nativeBlocked = !!(o.nativeBlocked && e.obs.nativeBlocked); o.settleTimedOut = !!(o.settleTimedOut || e.obs.settleTimedOut);
  }
  const finalEdges = [...byKey.values()];
  const cycles = findCycles(finalStates.map(s => s.id), finalEdges);

  return {
    explorer: 'crawler',
    states: finalStates.map(n => ({ id: n.id, evidence: n.evidence, depth: n.depth })),
    transitions: finalEdges.map(e => ({ from: e.from, to: e.to, action: e.label })),
    steps: stats.executed, ms: Date.now() - t0, costUsd: 0,
    stats: { ...stats, statesRaw: nodesById.size, statesMerged: finalStates.length, cycles: cycles.length },
    graph: { states: finalStates, edges: finalEdges, cycles },
  };
}

/** Strongly-connected components with more than one node (or a self loop): real loops show up as loops, not timeouts. */
export function findCycles(ids: string[], edges: { from: string; to: string }[]): string[][] {
  const adj = new Map<string, string[]>(ids.map(i => [i, []]));
  for (const e of edges) adj.get(e.from)?.push(e.to);
  let idx = 0; const index = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [], out: string[][] = [];
  const strong = (v: string) => {
    index.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = []; let w: string;
      do { w = stack.pop()!; on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1 || (adj.get(v) ?? []).includes(v)) out.push(comp);
    }
  };
  for (const v of ids) if (!index.has(v)) strong(v);
  return out;
}
