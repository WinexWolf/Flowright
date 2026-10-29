import type { Assertion, CrawlGraph, Flow, FlowIntent, StateNode } from '@flowright/core';
import { checkAssertion, sanitizeAssertions } from '@flowright/oracle';
import type { LlmProvider } from '@flowright/llm-provider';

const titleOf = (s: StateNode) => s.evidence.headings[0] || s.evidence.title || s.evidence.route;

/** Deterministic assertions straight from what was observed: always true on the state they came from. */
export function observedAssertions(s: StateNode): Assertion[] {
  const out: Assertion[] = [];
  if (s.evidence.headings[0]) out.push({ kind: 'heading', text: s.evidence.headings[0] });
  if (s.evidence.alerts.length === 0 && s.evidence.dialogs.length === 0) out.push({ kind: 'no-alert' });
  return out;
}

export interface LabelResult { intents: Map<string, FlowIntent>; rejectedAssertions: number; usedModel: boolean }

/**
 * Name each discovered state as a user goal and propose what must be true on arrival.
 * With no provider, names/assertions are derived deterministically. With one, the model proposes and EVERY assertion is
 * grounded: it must hold on the evidence the state was discovered with, otherwise it is rejected (hallucination guard).
 */
export async function labelFlows(provider: LlmProvider | null, graph: CrawlGraph, opts: { max?: number } = {}): Promise<LabelResult> {
  const states = graph.states.filter(s => s.depth > 0).slice(0, opts.max ?? 40);
  const intents = new Map<string, FlowIntent>(); let rejected = 0;
  for (const s of states) intents.set(s.id, { name: titleOf(s), intent: `Reach “${titleOf(s)}”`, assertions: observedAssertions(s) });
  if (!provider || !states.length) return { intents, rejectedAssertions: 0, usedModel: false };

  const byId = new Map(states.map(s => [s.id, s]));
  const brief = states.map(s => ({ id: s.id, route: s.evidence.route, heading: s.evidence.headings[0] ?? '', via: s.path[s.path.length - 1]?.label ?? '', alert: s.evidence.alerts[0] ?? '', dialog: (s.evidence.dialogs[0] ?? '').slice(0, 60) }));
  const { data } = await provider.generateJson({
    schemaName: 'flow-labels',
    system: 'You name user flows in a web app and say what must be true when each flow ends. Reply with JSON only.',
    prompt: `Each item is a page state reached by a user. Give each a short user-goal name (max 6 words, e.g. “Place an order”) and 1-3 assertions that must hold on arrival.\nAssertion kinds: {"kind":"heading","text":...} {"kind":"text-visible","text":...} {"kind":"url-matches","pattern":<regex>} {"kind":"alert-contains","text":...} {"kind":"dialog-contains","text":...} {"kind":"no-alert"}.\nOnly assert things you can SEE in the item's data.\nStates: ${JSON.stringify(brief)}\nReply as {"flows":[{"id":"s3","name":"...","intent":"...","assertions":[...]}]}`,
  }, raw => {
    const arr = (raw as { flows?: unknown })?.flows; if (!Array.isArray(arr)) throw new Error('expected {"flows":[...]}');
    return arr as { id?: unknown; name?: unknown; intent?: unknown; assertions?: unknown }[];
  });
  for (const f of data) {
    const s = typeof f.id === 'string' ? byId.get(f.id) : undefined; if (!s) continue;     // unknown ids are ignored
    const proposed = sanitizeAssertions(f.assertions);
    const grounded = proposed.filter(a => checkAssertion(a, s.evidence).ok);
    rejected += proposed.length - grounded.length;
    const base = intents.get(s.id)!;
    const name = typeof f.name === 'string' && f.name.trim() && f.name.length <= 60 ? f.name.trim() : base.name;
    const intent = typeof f.intent === 'string' && f.intent.trim() && f.intent.length <= 160 ? f.intent.trim() : base.intent;
    intents.set(s.id, { name, intent, assertions: grounded.length ? grounded : base.assertions });
  }
  return { intents, rejectedAssertions: rejected, usedModel: true };
}

/** Attach intents to compiled flows (flow.id is the state id). */
export function applyIntents(flows: Flow[], intents: Map<string, FlowIntent>): Flow[] {
  return flows.map(f => ({ ...f, intent: intents.get(f.id) ?? f.intent }));
}
