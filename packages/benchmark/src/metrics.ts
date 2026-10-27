import type { ExplorationResult } from '@flowright/core';
import { matches, type Labels } from './matcher.js';

export interface Coverage {
  statesCovered: number; statesTotal: number; missing: string[];
  flowsCovered: number; flowsTotal: number; missingFlows: string[];
}

/**
 * State coverage: a labeled state counts if ANY explored state's evidence satisfies it.
 * Flow coverage: every labeled state of the flow is matched AND each consecutive pair is connected by a path
 * in the explored transition graph (so "saw both pages" isn't enough; the explorer must have found the way).
 */
export function coverage(result: ExplorationResult, labels: Labels): Coverage {
  const matched = new Map<string, Set<string>>();
  for (const l of labels.states) {
    matched.set(l.id, new Set(result.states.filter(st => matches(l, st.evidence)).map(st => st.id)));
  }
  const missing = labels.states.filter(l => matched.get(l.id)!.size === 0).map(l => l.id);

  const adj = new Map<string, string[]>();
  for (const t of result.transitions) {
    if (!adj.has(t.from)) adj.set(t.from, []);
    adj.get(t.from)!.push(t.to);
  }
  const reachable = (from: Set<string>, to: Set<string>): boolean => {
    const seen = new Set<string>(from); const q = [...from];
    while (q.length) {
      const cur = q.shift()!;
      for (const n of adj.get(cur) ?? []) {
        if (to.has(n)) return true;
        if (!seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
    return false;
  };
  const missingFlows = labels.flows.filter(f => {
    for (let i = 0; i + 1 < f.states.length; i++) {
      const a = matched.get(f.states[i])!, b = matched.get(f.states[i + 1])!;
      if (!a.size || !b.size || !reachable(a, b)) return true;
    }
    return false;
  }).map(f => f.id);

  return {
    statesCovered: labels.states.length - missing.length, statesTotal: labels.states.length, missing,
    flowsCovered: labels.flows.length - missingFlows.length, flowsTotal: labels.flows.length, missingFlows,
  };
}
