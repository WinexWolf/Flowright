import type { Browser } from 'playwright';
import { fingerprint, UrlTemplater, type Action, type Assertion, type Evidence, type Flow, type Obs, type TargetConfig } from '@flowright/core';
import { openSession, perform, snapshot } from '@flowright/driver';
import { candidateActions } from '@flowright/explorer';
import { checkAssertions } from '@flowright/oracle';
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
