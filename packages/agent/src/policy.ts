import type { Evidence } from '@flowright/core';
import type { LlmProvider } from '@flowright/llm-provider';
import type { Candidate } from '@flowright/explorer';

export interface PolicyInput { goal: string; evidence: Evidence; candidates: Candidate[]; history: string[]; visitedRoutes: Set<string> }
export interface Choice { index: number; reason: string }
/** Decides which available action to take next toward a goal. The agent never trusts a policy: it validates the index. */
export interface Policy { readonly name: string; choose(i: PolicyInput): Promise<Choice> }

const STOP = new Set(['the', 'a', 'an', 'to', 'and', 'of', 'for', 'in', 'on', 'my', 'it', 'is', 'then', 'with', 'then', 'into']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));

/**
 * Offline baseline (no model): scores each candidate by word overlap with the goal, prefers pages not yet visited,
 * and penalises actions it has already taken. Deterministic. Useful as a floor an LLM policy must beat.
 */
export class HeuristicPolicy implements Policy {
  readonly name = 'heuristic';
  async choose(i: PolicyInput): Promise<Choice> {
    const goal = new Set(words(i.goal)); let best = -1, bestScore = -Infinity, why = '';
    i.candidates.forEach((c, idx) => {
      const w = words(c.text); const overlap = w.filter(x => goal.has(x)).length;
      let s = overlap * 2;
      if (c.href && !i.visitedRoutes.has(c.href)) s += 0.5; else if (c.href) s -= 0.75;
      if (i.history.includes(c.action.label)) s -= 3;
      if (c.action.kind === 'form') s += 0.75;                 // forms are how goals complete
      if (s > bestScore) { bestScore = s; best = idx; why = `overlap=${overlap} score=${s.toFixed(2)}`; }
    });
    return { index: best, reason: why };
  }
}

/** Model-driven policy. The reply is validated: an out-of-range index is an error, never a guess. */
export class LlmPolicy implements Policy {
  readonly name = 'llm';
  constructor(private provider: LlmProvider) {}
  async choose(i: PolicyInput): Promise<Choice> {
    const list = i.candidates.map((c, idx) => ({ i: idx, what: c.text.slice(0, 80), kind: c.action.kind, href: c.href }));
    const { data } = await this.provider.generateJson({
      schemaName: 'agent-step',
      system: 'You operate a web app like a user pursuing a goal. Pick exactly one action. Reply with JSON only.',
      prompt: `Goal: ${i.goal}\nCurrent page: ${i.evidence.route} — ${i.evidence.headings.slice(0, 3).join(' / ')}\nVisible text: ${i.evidence.textSample.slice(0, 300)}\nSteps already taken: ${i.history.slice(-6).join(' -> ') || 'none'}\nAvailable actions: ${JSON.stringify(list)}\nReply as {"choice": <index>, "reason": "<short>"}`,
      maxTokens: 300,
    }, raw => {
      const o = raw as { choice?: unknown; reason?: unknown };
      if (typeof o?.choice !== 'number' || !Number.isInteger(o.choice) || o.choice < 0 || o.choice >= i.candidates.length) throw new Error(`choice must be an integer in [0, ${i.candidates.length - 1}]`);
      return { index: o.choice, reason: typeof o.reason === 'string' ? o.reason.slice(0, 200) : '' };
    });
    return data;
  }
}
