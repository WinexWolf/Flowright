import type { Browser } from 'playwright';
import { fingerprint, UrlTemplater, type Action, type Assertion, type Evidence, type Flow, type Obs, type TargetConfig } from '@flowright/core';
import { openSession, perform, snapshot } from '@flowright/driver';
import { candidateActions } from '@flowright/explorer';
import { checkAssertions } from '@flowright/oracle';
import { replayPath } from '@flowright/replayer';
import type { Policy } from './policy.js';

export interface Goal { text: string; success: Assertion[] }
export interface AgentBudget { maxSteps: number; maxMs?: number }
export interface AgentStep { n: number; route: string; chose: string; reason: string; error?: string }
export interface AgentResult {
  goal: string; succeeded: boolean; stopReason: 'goal-reached' | 'step-budget' | 'time-budget' | 'no-actions' | 'stuck' | 'policy-error';
  steps: AgentStep[]; path: Action[]; flow?: Flow; finalEvidence?: Evidence; failedAssertions: string[]; observations: Obs[]; ms: number; policy: string; error?: string;
}

/**
 * Goal-directed exploration: instead of enumerating everything (the crawler), pursue ONE goal.
 * The policy (heuristic or LLM) only CHOOSES among actions the driver offers; success is decided by deterministic assertions on the
 * real page; the successful path is compiled into a Flow that replays with no AI. Safety rules are the crawler's (blocklist, modal, off-site).
 */
export async function runAgent(browser: Browser, baseUrl: string, cfg: TargetConfig, goal: Goal, policy: Policy, budget: AgentBudget): Promise<AgentResult> {
  const t0 = Date.now(); const steps: AgentStep[] = []; const path: Action[] = []; const observations: Obs[] = [];
  const history: string[] = []; const visited = new Set<string>(); const seenStates = new Map<string, number>();
  const s = await openSession(browser, baseUrl, cfg);
  const templater = new UrlTemplater(cfg);
  const finish = (r: Partial<AgentResult> & Pick<AgentResult, 'stopReason'>): AgentResult => ({ goal: goal.text, succeeded: false, steps, path, failedAssertions: [], observations, ms: Date.now() - t0, policy: policy.name, ...r });
  try {
    await s.page.goto(baseUrl + cfg.startPath).catch(() => {}); await s.tr.settle();
    for (let n = 1; n <= budget.maxSteps; n++) {
      if (budget.maxMs && Date.now() - t0 > budget.maxMs) return finish({ stopReason: 'time-budget' });
      const snap = await snapshot(s.page);
      visited.add(snap.evidence.route);
      const results = checkAssertions(goal.success, snap.evidence);
      if (goal.success.length && results.every(r => r.ok)) {
        const url = s.page.url(); templater.observe(url); const fp = fingerprint(templater.template(url), snap.tree, snap.tabs);
        const flow: Flow = { id: 'agent', name: goal.text, startPath: cfg.startPath, steps: [...path], expect: { route: snap.evidence.route, treeHash: fp.treeHash, overlay: fp.overlay, heading: snap.evidence.headings[0] }, intent: { name: goal.text, intent: goal.text, assertions: goal.success } };
        return finish({ stopReason: 'goal-reached', succeeded: true, flow, finalEvidence: snap.evidence });
      }
      const key = `${snap.evidence.route}|${snap.evidence.headings[0] ?? ''}|${snap.evidence.dialogs.length}|${snap.evidence.alerts.length}`;
      seenStates.set(key, (seenStates.get(key) ?? 0) + 1);
      if ((seenStates.get(key) ?? 0) >= 4) return finish({ stopReason: 'stuck', finalEvidence: snap.evidence, failedAssertions: results.filter(r => !r.ok).map(r => r.why) });

      const candidates = candidateActions(snap, cfg, baseUrl);
      if (!candidates.length) return finish({ stopReason: 'no-actions', finalEvidence: snap.evidence });
      let choice; try { choice = await policy.choose({ goal: goal.text, evidence: snap.evidence, candidates, history, visitedRoutes: visited }); }
      catch (e) { return finish({ stopReason: 'policy-error', error: (e as Error).message, finalEvidence: snap.evidence }); }
      if (!Number.isInteger(choice.index) || choice.index < 0 || choice.index >= candidates.length) return finish({ stopReason: 'policy-error', error: `policy returned invalid index ${choice.index}`, finalEvidence: snap.evidence });

      const c = candidates[choice.index]; s.resetObs();
      const err = await perform(s.page, () => s.tr.settle(), cfg, c.action);
      steps.push({ n, route: snap.evidence.route, chose: c.action.label, reason: choice.reason, error: err ?? undefined });
      history.push(c.action.label);
      if (err) continue;                                   // could not perform it: try something else next step (history penalises repeats)
      path.push(c.action); observations.push({ ...s.obs });
    }
    const last = await snapshot(s.page);
    return finish({ stopReason: 'step-budget', finalEvidence: last.evidence, failedAssertions: checkAssertions(goal.success, last.evidence).filter(r => !r.ok).map(r => r.why) });
  } finally { await s.ctx.close().catch(() => {}); }
}

/**
 * An agent wanders: it may open Contact and fill a form on its way to checkout. A flow should be the SHORTEST path that still reaches the goal.
 * Greedy minimization: try dropping each step; keep the drop only if a real replay from a fresh browser still satisfies every success assertion.
 * Every removal is verified, so the result can never be a path that does not work.
 */
export async function minimizeFlow(browser: Browser, baseUrl: string, cfg: TargetConfig, flow: Flow, success: Assertion[], opts: { maxReplays?: number } = {}): Promise<{ flow: Flow; removed: number; replays: number }> {
  let steps = [...flow.steps]; let replays = 0; let last: Awaited<ReturnType<typeof replayPath>> | null = null;
  const cap = opts.maxReplays ?? 80;
  // Repeat until a full pass removes nothing: a step that was needed while its dependent step existed (a contact link before a contact form)
  // becomes removable once that dependent is gone, which a single forward pass would never notice. Result: no single step can be dropped (1-minimal).
  for (let changed = true; changed && replays < cap;) {
    changed = false;
    for (let i = 0; i < steps.length && replays < cap;) {
      const trial = steps.filter((_, j) => j !== i);
      const r = await replayPath(browser, baseUrl, cfg, flow.startPath, trial); replays++;
      if (r.ok && r.evidence && checkAssertions(success, r.evidence).every(a => a.ok)) { steps = trial; last = r; changed = true; } else i++;
    }
  }
  if (!last) return { flow, removed: 0, replays };
  return { flow: { ...flow, steps, expect: { ...flow.expect, treeHash: last.treeHash ?? flow.expect.treeHash, overlay: last.overlay ?? flow.expect.overlay } }, removed: flow.steps.length - steps.length, replays };
}
