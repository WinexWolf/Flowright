import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  fingerprint, fineFrom, UrlTemplater,
  type Budget, type Evidence, type ExplorationResult, type FieldSpec, type PageSnapshot, type TargetConfig,
} from '@flowright/core';
import { snapshot, trackInflight } from './snapshot.js';
import { isBlocked } from './blocklist.js';

// ---------------------------------------------------------------- types
export type Variant = 'valid' | 'empty' | 'invalid';
export type Action =
  | { kind: 'click'; role: string; name: string; nth: number; css: string; label: string }
  | { kind: 'form'; variant: Variant; fields: FieldSpec[]; submit: { css: string; name: string; role: string; nth: number } | null; label: string };

export interface Obs {
  consoleErrors: string[]; pageErrors: string[]; failedRequests: string[]; badResponses: string[];
  noEffect: boolean; actionError?: string;
}
export interface StateNode {
  id: string; fine: string; coarse: string; treeHash: string; overlay: string;
  url: string; urlTemplate: string; evidence: Evidence; depth: number; path: Action[];
}
export interface Edge { from: string; to: string; label: string; obs: Obs }
export interface CrawlGraph { states: StateNode[]; edges: Edge[]; cycles: string[][] }
export interface CrawlOptions {
  maxPerElementKey?: number;      // how many times the same (role,name,href-template) action may be tried across states
  dryRun?: boolean;               // load the start page, list what would be done, do nothing else
  log?: (msg: string) => void;
}
export type CrawlResult = ExplorationResult & { graph: CrawlGraph };

interface Task { node: StateNode; action: Action; key: string; prio: number }
interface Session { ctx: BrowserContext; page: Page; tr: ReturnType<typeof trackInflight>; obs: Obs; requests: number }

const freshObs = (): Obs => ({ consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], noEffect: false });

// ---------------------------------------------------------------- form value heuristics (deterministic; an LLM replaces this in M3)
export function valueFor(f: FieldSpec, variant: Variant, cfg: TargetConfig): string | null {
  if (variant === 'empty') return null;
  const t = f.type;
  if (variant === 'invalid') {
    if (t === 'email') return 'not-an-email';
    if (t === 'number') return '-1';
    return 'x';
  }
  const hay = `${f.name} ${f.label}`.toLowerCase();
  for (const [k, v] of Object.entries(cfg.formValues ?? {})) {
    if (f.name.toLowerCase() === k.toLowerCase() || t === k || hay.includes(k.toLowerCase())) return v;
  }
  if (t === 'email' || /e-?mail/.test(hay)) return 'test@example.com';
  if (t === 'password') return 'Password123!';
  if (t === 'tel' || /phone/.test(hay)) return '5551234567';
  if (t === 'number') return '1';
  if (t === 'date') return '2025-01-15';
  if (t === 'url') return 'https://example.com';
  if (/zip|postal/.test(hay)) return '94105';
  if (/card/.test(hay)) return '4242424242424242';
  if (/address|street/.test(hay)) return '1 Test Street';
  if (/name/.test(hay)) return 'Test User';
  if (/title|subject/.test(hay)) return 'Test item';
  if (/search|query|^q$/.test(hay)) return 'test';
  return 'test';
}

// ---------------------------------------------------------------- crawler
export async function crawl(baseUrl: string, cfg: TargetConfig, budget: Budget, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const log = opts.log ?? (() => {});
  const maxPerKey = opts.maxPerElementKey ?? 2;
  const t0 = Date.now();
  const origin = new URL(baseUrl).origin;
  const allowedHosts = new Set([new URL(baseUrl).host, ...(cfg.allowedHosts ?? [])]);
  const templater = new UrlTemplater(cfg);
  const browser: Browser = await chromium.launch();

  const states = new Map<string, StateNode>();            // fine fingerprint -> node
  const edges: Edge[] = [];
  const queue: Task[] = [];
  const keyCounts = new Map<string, number>();
  const stats = { tasksCreated: 0, executed: 0, skippedBlocked: 0, skippedExternal: 0, skippedKeyCap: 0, actionErrors: 0, replayDrift: 0, budgetExhausted: '' as string, noEffectActions: 0 };
  let seq = 0;

  // ----- sessions: a fresh browser context per branch, so server/session state never bleeds between branches
  async function newSession(): Promise<Session> {
    const ctx = await browser.newContext({ viewport: cfg.viewport ?? { width: 1280, height: 720 }, storageState: cfg.storageState });
    await ctx.route(u => !allowedHosts.has(new URL(u.toString()).host), r => r.abort());   // containment: never leave the target
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept().catch(() => {}));
    const s: Session = { ctx, page, tr: trackInflight(page), obs: freshObs(), requests: 0 };
    page.on('request', () => { s.requests++; });
    page.on('console', m => { if (m.type() === 'error') s.obs.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => s.obs.pageErrors.push(String(e.message).slice(0, 300)));
    page.on('requestfailed', r => { if (allowedHosts.has(new URL(r.url()).host)) s.obs.failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`); });
    page.on('response', r => { const t = r.request().resourceType(); if (r.status() >= 400 && ['document', 'xhr', 'fetch'].includes(t)) s.obs.badResponses.push(`${r.status()} ${r.url()}`); });
    page.on('popup', p => { p.close().catch(() => {}); });
    return s;
  }

  // ----- registering states + enumerating the actions available in them
  function register(snap: PageSnapshot, url: string, path: Action[], depth: number): { node: StateNode; isNew: boolean } {
    templater.observe(url);
    const tpl = templater.template(url);
    const fp = fingerprint(tpl, snap.tree, snap.tabs);
    const existing = states.get(fp.fine);
    if (existing) return { node: existing, isNew: false };
    const node: StateNode = { id: 's' + states.size, fine: fp.fine, coarse: fp.coarse, treeHash: fp.treeHash, overlay: fp.overlay, url, urlTemplate: tpl, evidence: snap.evidence, depth, path };
    states.set(fp.fine, node);
    enumerate(node, snap);
    return { node, isNew: true };
  }

  function enumerate(node: StateNode, snap: PageSnapshot) {
    const modal = snap.evidence.dialogs.length > 0;     // with a modal open, only the modal is actionable
    const push = (action: Action, key: string) => { queue.push({ node, action, key, prio: node.depth * 1e6 + seq++ }); stats.tasksCreated++; };
    for (const el of snap.interactive) {
      if (el.disabled || (modal && !el.inModal)) continue;
      const label = `click ${el.role} "${el.name}"`;
      if (el.target === '_blank') { stats.skippedExternal++; continue; }
      if (el.href && !allowedHosts.has(new URL(el.href).host)) { stats.skippedExternal++; continue; }
      if (isBlocked(el.name, cfg)) { stats.skippedBlocked++; continue; }
      const hrefT = el.href ? templater.template(el.href) : '';
      push({ kind: 'click', role: el.role, name: el.name, nth: el.nth, css: el.css, label }, `click|${el.role}|${el.name}|${hrefT}`);
    }
    for (const f of snap.forms) {
      if (modal && !f.inModal) continue;
      if (f.submit && isBlocked(f.submit.name, cfg)) { stats.skippedBlocked++; continue; }
      for (const variant of ['valid', 'empty', 'invalid'] as Variant[]) {
        push({ kind: 'form', variant, fields: f.fields, submit: f.submit ?? null, label: `form ${f.key} [${variant}]` }, `form|${f.key}|${variant}`);
      }
    }
  }

  // ----- performing actions (used for both replay and exploration)
  async function locate(page: Page, a: { role: string; name: string; nth: number; css: string }) {
    if (a.name) {
      const byRole = page.getByRole(a.role as Parameters<Page['getByRole']>[0], { name: a.name, exact: true });
      if (await byRole.count() > a.nth) return byRole.nth(a.nth);
    }
    return page.locator(a.css).first();     // fallback selector captured at discovery time
  }
  async function perform(s: Session, a: Action): Promise<string | null> {
    try {
      if (a.kind === 'click') {
        await (await locate(s.page, a)).click({ timeout: 2500 });
      } else {
        for (const f of a.fields) {
          const loc = s.page.locator(f.css).first();
          if (f.type === 'select') { if (a.variant !== 'empty' && f.options?.length) await loc.selectOption({ index: 0 }, { timeout: 1500 }); continue; }
          if (f.type === 'checkbox' || f.type === 'radio') { if (a.variant === 'valid') await loc.check({ timeout: 1500 }).catch(() => {}); continue; }
          const v = valueFor(f, a.variant, cfg);
          if (v !== null) await loc.fill(v, { timeout: 1500 });
        }
        if (a.submit) await (await locate(s.page, a.submit)).click({ timeout: 2500 });
        else if (a.fields.length) await s.page.locator(a.fields[a.fields.length - 1].css).first().press('Enter', { timeout: 1500 });
      }
      await s.tr.settle();
      return null;
    } catch (e) { return String((e as Error).message).split('\n')[0].slice(0, 160); }
  }

  const take = async (s: Session) => { const snap = await snapshot(s.page); return { snap, url: s.page.url() }; };

  // ----- start
  let root: StateNode;
  {
    const s = await newSession();
    await s.page.goto(baseUrl + cfg.startPath).catch(() => {});
    await s.tr.settle();
    const { snap, url } = await take(s);
    root = register(snap, url, [], 0).node;
    await s.ctx.close();
  }
  log(`root ${root.url}: ${queue.length} candidate actions`);

  if (opts.dryRun) {
    await browser.close();
    const g: CrawlGraph = { states: [...states.values()], edges: [], cycles: [] };
    return { explorer: 'crawler(dry-run)', states: g.states.map(n => ({ id: n.id, evidence: n.evidence, depth: n.depth })), transitions: [], steps: 0, ms: Date.now() - t0, costUsd: 0, stats: { ...stats, dryRun: true, wouldRun: queue.map(t => t.action.label) }, graph: g };
  }

  // ----- main loop: shallowest unexplored action first
  try {
    while (queue.length) {
      if (stats.executed >= budget.maxSteps) { stats.budgetExhausted = 'steps'; break; }
      if (Date.now() - t0 > budget.maxTimeMs) { stats.budgetExhausted = 'time'; break; }
      if (budget.maxStates && states.size >= budget.maxStates) { stats.budgetExhausted = 'states'; break; }
      let bi = 0; for (let i = 1; i < queue.length; i++) if (queue[i].prio < queue[bi].prio) bi = i;
      const task = queue.splice(bi, 1)[0];
      if ((keyCounts.get(task.key) ?? 0) >= maxPerKey) { stats.skippedKeyCap++; continue; }
      keyCounts.set(task.key, (keyCounts.get(task.key) ?? 0) + 1);

      const s = await newSession();
      try {
        await s.page.goto(baseUrl + cfg.startPath).catch(() => {});
        await s.tr.settle();
        // replay the path that reaches the source state
        let replayErr: string | null = null;
        for (const step of task.node.path) { replayErr = await perform(s, step); if (replayErr) break; }
        if (!replayErr) {
          const here = await take(s);
          templater.observe(here.url);
          const fp = fingerprint(templater.template(here.url), here.snap.tree, here.snap.tabs);
          if (fp.fine !== task.node.fine) replayErr = 'replay drift: arrived in a different state than recorded';
        }
        if (replayErr) { stats.replayDrift++; log(`drift on ${task.action.label} from ${task.node.id}: ${replayErr}`); continue; }

        const before = { url: s.page.url(), fine: task.node.fine, requests: s.requests };
        s.obs = freshObs();
        const err = await perform(s, task.action);
        stats.executed++;
        if (err) { stats.actionErrors++; s.obs.actionError = err; edges.push({ from: task.node.id, to: task.node.id, label: task.action.label, obs: s.obs }); continue; }
        const after = await take(s);
        const { node: dest, isNew } = register(after.snap, after.url, [...task.node.path, task.action], task.node.depth + 1);
        s.obs.noEffect = dest.fine === before.fine && after.url === before.url && s.requests === before.requests;
        if (s.obs.noEffect) stats.noEffectActions++;
        edges.push({ from: task.node.id, to: dest.id, label: task.action.label, obs: s.obs });
        if (isNew) log(`new ${dest.id} d${dest.depth} ${dest.evidence.route} [${dest.evidence.headings[0] ?? ''}] via ${task.action.label}`);
      } finally { await s.ctx.close().catch(() => {}); }
    }
    if (!queue.length && !stats.budgetExhausted) stats.budgetExhausted = 'none (frontier empty)';
  } finally { await browser.close(); }

  // ----- finalise: URL templates may have been learned after early states were registered; merge states that now coincide
  const canon = new Map<string, StateNode>(); const remap = new Map<string, string>();
  for (const n of [...states.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))) {
    const tpl = templater.template(n.url);
    const fine = fineFrom(tpl, n.treeHash, n.overlay);
    const c = canon.get(fine);
    if (c) remap.set(n.id, c.id); else { n.urlTemplate = tpl; n.fine = fine; canon.set(fine, n); remap.set(n.id, n.id); }
  }
  const seenE = new Set<string>(); const finalEdges: Edge[] = [];
  for (const e of edges) {
    const f = remap.get(e.from) ?? e.from, t = remap.get(e.to) ?? e.to;
    const k = `${f}>${t}>${e.label}`; if (seenE.has(k)) continue; seenE.add(k); finalEdges.push({ ...e, from: f, to: t });
  }
  const finalStates = [...canon.values()];
  const cycles = findCycles(finalStates.map(s => s.id), finalEdges);

  const result: CrawlResult = {
    explorer: 'crawler',
    states: finalStates.map(n => ({ id: n.id, evidence: n.evidence, depth: n.depth })),
    transitions: finalEdges.map(e => ({ from: e.from, to: e.to, action: e.label })),
    steps: stats.executed, ms: Date.now() - t0, costUsd: 0,
    stats: { ...stats, statesRaw: states.size, statesMerged: finalStates.length, cycles: cycles.length },
    graph: { states: finalStates, edges: finalEdges, cycles },
  };
  return result;
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
