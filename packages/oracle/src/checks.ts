import type { CrawlGraph, OracleFinding } from '@flowright/core';

const IMPACT: Record<string, 'error' | 'suspect'> = { critical: 'error', serious: 'error', moderate: 'suspect', minor: 'suspect' };

/**
 * Accessibility and keyboard findings from the per-state scans. A rule is reported once per page TEMPLATE (not once per product id),
 * and the path to the state is kept so the finding can be replayed and confirmed in a fresh browser like any other.
 * critical/serious axe impacts are errors (real WCAG A/AA failures); moderate/minor are "suspected". Heuristic keyboard checks are never worse than suspected,
 * except a true keyboard trap.
 */
export function analyzeChecks(g: CrawlGraph): OracleFinding[] {
  const out = new Map<string, OracleFinding>();
  for (const s of g.states) {
    const c = s.checks; if (!c) continue;
    for (const v of c.a11y) {
      const signature = `a11y|${s.urlTemplate}|${v.id}`; if (out.has(signature)) continue;
      out.set(signature, { kind: 'a11y', route: s.evidence.route, detail: `${v.help} (${v.id}, ${v.nodes} element${v.nodes === 1 ? '' : 's'})`, severity: IMPACT[v.impact ?? 'minor'] ?? 'suspect', signature, path: s.path, meta: { rule: v.id, impact: v.impact, nodes: v.nodes, sample: v.sample } });
    }
    for (const k of c.keyboard) {
      const signature = `keyboard|${s.urlTemplate}|${k.kind}`; if (out.has(signature)) continue;
      out.set(signature, { kind: 'keyboard', route: s.evidence.route, detail: k.detail, severity: k.kind === 'keyboard-trap' ? 'error' : 'suspect', signature, path: s.path, meta: { keyboard: k.kind, count: k.count } });
    }
  }
  return [...out.values()];
}
