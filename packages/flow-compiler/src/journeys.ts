import type { Action, CrawlGraph, Edge, Flow, StateNode, TargetConfig } from '@flowright/core';
import { compileFlows } from './compile.js';

export type JourneyKind = 'transaction' | 'auth' | 'search' | 'multi-step' | 'page';
export interface JourneyVariant { label: string; outcome: 'validation-error' | 'accepted-anyway'; flow: Flow }
export interface Journey { id: string; name: string; kind: JourneyKind; steps: string[]; flow: Flow; variants: JourneyVariant[] }

type FormAction = Extract<Action, { kind: 'form' }>;
const clean = (s: string) => s.replace(/\s*\(\d+\)\s*$/, '').replace(/[:：.]+$/, '').trim();
const GENERIC = /^(submit|send|save|go|continue|next|ok|done|apply|search)$/i;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One human step, e.g. `Open “Products”` or `Fill in email and password, then press “Sign in”`. */
export function humanStep(a: Action): string {
  if (a.kind === 'click') {
    const n = clean(a.name) || 'that';
    return a.role === 'link' ? `Open “${n}”` : a.role === 'tab' ? `Switch to the “${n}” tab` : `Press “${n}”`;
  }
  const names = a.fields.filter(f => !['checkbox', 'radio'].includes(f.type)).map(f => clean(f.label || f.name).toLowerCase()).filter(Boolean);
  const submit = a.submit ? clean(a.submit.name) : 'Enter';
  if (a.variant === 'empty') return `Press “${submit}” without filling anything in`;
  if (a.variant === 'invalid') return `Enter invalid values and press “${submit}”`;
  return names.length ? `Fill in ${names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]}, then press “${submit}”` : `Press “${submit}”`;
}

/** The form's identity without the probe variant: `form /checkout|name,email [valid]` -> `form /checkout|name,email`. */
const formKeyOf = (a: FormAction) => a.label.replace(/\s\[(?:valid|empty|invalid)\]$/, '');
const kindOf = (a: FormAction): JourneyKind => {
  if (a.fields.some(f => f.type === 'password')) return 'auth';
  if (a.method === 'GET' || a.fields.some(f => f.type === 'search' || /^q$|search|query/i.test(f.name))) return 'search';
  return 'transaction';
};
const heading = (s: StateNode) => s.evidence.headings[0] ?? '';

function journeyName(a: FormAction, to: StateNode, kind: JourneyKind): string {
  const submit = a.submit ? clean(a.submit.name) : '';
  if (kind === 'search') return 'Search';
  if (submit && !GENERIC.test(submit)) return cap(submit.toLowerCase().replace(/^./, c => c)) === submit ? submit : cap(submit);
  const h = heading(to);
  return h ? `${submit || 'Submit'}: ${h}` : submit || 'Submit a form';
}

/**
 * Turn the crawl graph into user JOURNEYS instead of one-flow-per-page. Deterministic rules, no model:
 *  - a form whose VALID submission leads to a different state is a transaction / login / search, named after its submit button ("Place order");
 *    its empty/invalid submissions become variants labelled by what happened (validation error vs. accepted anyway);
 *  - a state reached by 3+ steps is a multi-step journey, named after the button pressed last ("Add to cart");
 *  - everything else is a plain page flow.
 * Order: transactions, logins, searches, multi-step, pages.
 */
export function detectJourneys(g: CrawlGraph, cfg: TargetConfig): Journey[] {
  const flows = compileFlows(g, cfg); const flowOf = new Map(flows.map(f => [f.id, f]));
  const states = new Map(g.states.map(s => [s.id, s])); const out: Journey[] = []; const used = new Set<string>();
  const mk = (id: string, name: string, steps: Action[], to: StateNode): Flow => ({ id, name, startPath: cfg.startPath, steps, expect: { route: to.evidence.route, treeHash: to.treeHash, overlay: to.overlay, heading: heading(to) || undefined } });

  const groups = new Map<string, Edge[]>();
  for (const e of g.edges) if (e.action.kind === 'form') { const k = `${e.from}|${formKeyOf(e.action)}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(e); }
  for (const es of groups.values()) {
    const ok = es.find(e => e.action.kind === 'form' && e.action.variant === 'valid' && e.to !== e.from);
    if (!ok) continue;
    const from = states.get(ok.from), to = states.get(ok.to); if (!from || !to) continue;
    const act = ok.action as FormAction; const kind = kindOf(act); const name = journeyName(act, to, kind);
    const steps = [...from.path, act];
    const variants: JourneyVariant[] = [];
    for (const e of es) {
      if (e.action.kind !== 'form' || e.action.variant === 'valid') continue;
      const d = states.get(e.to); if (!d) continue;
      const blocked = d.evidence.alerts.length > 0 || d.evidence.dialogs.length > 0 || e.to === e.from;
      variants.push({ label: e.action.variant === 'empty' ? 'with nothing filled in' : 'with invalid values', outcome: blocked ? 'validation-error' : 'accepted-anyway', flow: mk(`${to.id}-${e.action.variant}`, `${name} (${e.action.variant})`, [...from.path, e.action], d) });
    }
    out.push({ id: to.id, name, kind, steps: steps.map(humanStep), flow: { ...mk(to.id, name, steps, to), ...(flowOf.get(to.id)?.intent ? { intent: flowOf.get(to.id)!.intent } : {}) }, variants });
    used.add(to.id);
  }
  for (const s of g.states) {
    if (s.depth === 0 || used.has(s.id)) continue;
    const last = s.path[s.path.length - 1]; const f = flowOf.get(s.id)!;
    const multi = s.path.length >= 3;
    const name = multi && last?.kind === 'click' && last.role !== 'link' ? cap(clean(last.name)) : `Open ${heading(s) || s.evidence.route}`;
    out.push({ id: s.id, name, kind: multi ? 'multi-step' : 'page', steps: s.path.map(humanStep), flow: { ...f, name }, variants: [] });
  }
  const seen = new Map<string, number>();                                       // two journeys must never share a name
  for (const j of out) { const n = seen.get(j.name) ?? 0; seen.set(j.name, n + 1); if (n) { j.name = `${j.name} (${j.flow.expect.route})`; j.flow = { ...j.flow, name: j.name }; } }
  const rank: Record<JourneyKind, number> = { transaction: 0, auth: 1, search: 2, 'multi-step': 3, page: 4 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
