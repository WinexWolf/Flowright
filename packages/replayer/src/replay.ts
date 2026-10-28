import type { Browser } from 'playwright';
import { fingerprint, type Action, type Evidence, type Flow, type Obs, type OracleFinding, type TargetConfig } from '@flowright/core';
import { openSession, perform, snapshot } from '@flowright/driver';

// NOTE: this package must never import llm-provider or agent (enforced by lint:boundaries). Replay is deterministic.

export interface ReplayResult {
  ok: boolean; reason?: string;
  obs: Obs; evidence?: Evidence; treeHash?: string; overlay?: string;
  noEffect: boolean;                    // did the LAST step change nothing (url, structure, network, DOM)?
}

/** Replay a path in a brand-new browser context. Observations are collected for the LAST step only. */
export async function replayPath(browser: Browser, baseUrl: string, cfg: TargetConfig, startPath: string, steps: Action[]): Promise<ReplayResult> {
  const s = await openSession(browser, baseUrl, cfg);
  try {
    await s.page.goto(baseUrl + startPath).catch(() => {});
    await s.tr.settle();
    for (let i = 0; i < steps.length; i++) {
      const last = i === steps.length - 1;
      let before = { url: '', req: 0, mut: 0, h: '' };
      if (last) {
        const b = await snapshot(s.page); const fp = fingerprint('', b.tree, b.tabs);
        before = { url: s.page.url(), req: s.requests, mut: await s.tr.lastMutation(), h: fp.treeHash + fp.overlay };
        s.resetObs();
      }
      const err = await perform(s.page, () => s.tr.settle(), cfg, steps[i]);
      if (err) return { ok: false, reason: `step ${i + 1} (${steps[i].label}) failed: ${err}`, obs: s.obs, noEffect: false };
      if (last) {
        const snap = await snapshot(s.page); const fp = fingerprint('', snap.tree, snap.tabs);
        const mutated = (await s.tr.lastMutation()) > before.mut;
        const noEffect = s.page.url() === before.url && s.requests === before.req && !mutated && before.h === fp.treeHash + fp.overlay;
        return { ok: true, obs: s.obs, evidence: snap.evidence, treeHash: fp.treeHash, overlay: fp.overlay, noEffect };
      }
    }
    const snap = await snapshot(s.page); const fp = fingerprint('', snap.tree, snap.tabs);
    return { ok: true, obs: s.obs, evidence: snap.evidence, treeHash: fp.treeHash, overlay: fp.overlay, noEffect: false };
  } finally { await s.ctx.close().catch(() => {}); }
}

/** Replay a compiled flow once and check that it arrives in the structure it was recorded to arrive in. */
export async function replayFlow(browser: Browser, baseUrl: string, cfg: TargetConfig, flow: Flow): Promise<ReplayResult> {
  const r = await replayPath(browser, baseUrl, cfg, flow.startPath, flow.steps);
  if (!r.ok) return r;
  if (r.treeHash !== flow.expect.treeHash || r.overlay !== flow.expect.overlay) return { ...r, ok: false, reason: 'arrived in a different state than recorded' };
  return r;
}

export interface ReplayStats { flows: number; runs: number; passed: number; successRate: number; flaky: string[]; failing: string[] }

/** Replay every flow k times; a flow is "flaky" if it passed some runs but not all. */
export async function measureReplay(browser: Browser, baseUrl: string, cfg: TargetConfig, flows: Flow[], k: number): Promise<ReplayStats> {
  let passed = 0, runs = 0; const flaky: string[] = [], failing: string[] = [];
  for (const f of flows) {
    let ok = 0;
    for (let i = 0; i < k; i++) { runs++; if ((await replayFlow(browser, baseUrl, cfg, f)).ok) { ok++; passed++; } }
    if (ok === 0) failing.push(f.id); else if (ok < k) flaky.push(f.id);
  }
  return { flows: flows.length, runs, passed, successRate: runs ? passed / runs : 1, flaky, failing };
}

const routePath = (r: ReplayResult) => (r.evidence?.route ?? '').split('?')[0].replace(/\d+/g, 'N');

/**
 * Did a probe (blank/invalid input) end the same way valid input did? MUST use the same notion of "same" as the oracle's detection rule,
 * otherwise a finding can be raised and then rejected at confirmation. Exact structural equality is too brittle (an accepted blank item
 * adds a zero-width row), so: same structure, OR same route shape with no alert and no dialog on either side.
 */
export function sameProbeOutcome(a: ReplayResult, b: ReplayResult): boolean {
  if (!a.ok || !b.ok || routePath(a) !== routePath(b)) return false;
  if (a.treeHash === b.treeHash && a.overlay === b.overlay) return true;
  const ea = a.evidence, eb = b.evidence; if (!ea || !eb) return false;
  return !ea.alerts.length && !eb.alerts.length && !ea.dialogs.length && !eb.dialogs.length;
}

export interface Confirmation { reproduced: number; attempts: number; confirmed: boolean }

/** Re-run a finding's reproduction path in fresh contexts. Confirmed only if the SAME symptom shows up in at least `need` of `k` attempts. */
export async function confirmFinding(browser: Browser, baseUrl: string, cfg: TargetConfig, f: OracleFinding, k = 3, need = 2): Promise<Confirmation> {
  let reproduced = 0;
  for (let i = 0; i < k; i++) {
    if (await reproducesOnce(browser, baseUrl, cfg, f)) reproduced++;
    if (reproduced >= need) break;
    if (i - reproduced + 1 > k - need) break;       // can no longer reach `need`
  }
  const attempts = reproduced >= need ? Math.min(k, Math.max(need, reproduced)) : k;
  return { reproduced, attempts, confirmed: reproduced >= need };
}

async function reproducesOnce(browser: Browser, baseUrl: string, cfg: TargetConfig, f: OracleFinding): Promise<boolean> {
  if (f.kind === 'missing-validation' && f.probe) {
    const base = f.path.slice(0, -1);
    const a = await replayPath(browser, baseUrl, cfg, cfg.startPath, [...base, f.probe.valid]);
    const b = await replayPath(browser, baseUrl, cfg, cfg.startPath, [...base, f.probe.variant]);
    return sameProbeOutcome(a, b);
  }
  const r = await replayPath(browser, baseUrl, cfg, cfg.startPath, f.path);
  if (!r.ok) return false;
  const e = r.evidence!;
  switch (f.kind) {
    case 'console-error': return r.obs.pageErrors.length > 0 || r.obs.consoleErrors.some(c => !/Failed to load resource/i.test(c));
    case 'failed-request': return r.obs.badResponses.some(x => Number(x.split(' ')[0]) >= 400);
    case 'broken-link': return r.obs.badResponses.some(x => x.startsWith('404 document'));
    case 'dead-click': return r.noEffect;
    case 'overflow': return e.overflowX;
    case 'broken-image': return e.brokenImages > 0;
    case 'empty-route': return e.emptyMain;
    default: return false;
  }
}
