import { describe, it, expect } from 'vitest';
import { ScriptedProvider } from '@flowright/llm-provider';
import { labelFlows, suggestFieldValues, withFieldValues, applyIntents } from '../src/index.js';
import type { CrawlGraph, Evidence, StateNode, Flow } from '@flowright/core';

const ev = (route: string, h: string, o: Partial<Evidence> = {}): Evidence => ({ route, title: h, headings: [h], textSample: h + ' body text', alerts: [], dialogs: [], selectedTabs: [], overflowX: false, brokenImages: 0, emptyMain: false, ...o });
const st = (id: string, route: string, h: string, depth = 1): StateNode => ({ id, fine: id, coarse: id, treeHash: id, overlay: '#', url: 'http://x' + route, urlTemplate: route, evidence: ev(route, h), depth, path: [{ kind: 'click', role: 'link', name: h, nth: 0, css: 'a', label: `click link "${h}"` }] });
const graph: CrawlGraph = { states: [st('s0', '/', 'Home', 0), st('s1', '/checkout', 'Checkout'), st('s2', '/order/1', 'Order confirmed')], edges: [], cycles: [] };

describe('suggestFieldValues', () => {
  const forms = [{ key: '/checkout|name,email', fields: [{ name: 'name', type: 'text', label: 'Full name', required: true, css: '#n' }, { name: 'email', type: 'email', label: 'Email', required: true, css: '#e' }, { name: 'agree', type: 'checkbox', label: 'Agree', required: false, css: '#a' }] }];
  it('accepts values only for real fields and ignores invented ones', async () => {
    const p = new ScriptedProvider(() => ({ values: { name: 'Priya Raman', email: 'priya@example.com', ghost: 'x', agree: 'yes' } }));
    expect(await suggestFieldValues(p, forms)).toEqual({ name: 'Priya Raman', email: 'priya@example.com' });   // checkbox + unknown dropped
  });
  it('a malformed reply is retried, then surfaces as an error (never silently wrong)', async () => {
    const p = new ScriptedProvider(() => ({ nope: 1 }));
    await expect(suggestFieldValues(p, forms)).rejects.toThrow();
  });
  it('makes no call when there is nothing to fill', async () => {
    const p = new ScriptedProvider(() => ({ values: {} })); expect(await suggestFieldValues(p, [])).toEqual({}); expect(p.calls).toHaveLength(0);
  });
  it('explicit user values beat model suggestions', () => {
    const cfg = withFieldValues({ name: 't', startPath: '/', sandbox: true, fieldValues: { email: 'me@corp.com' } }, { email: 'model@x.com', name: 'Model' });
    expect(cfg.fieldValues).toEqual({ email: 'me@corp.com', name: 'Model' });
  });
});

describe('labelFlows', () => {
  it('without a model: deterministic names and observed assertions', async () => {
    const r = await labelFlows(null, graph);
    expect(r.usedModel).toBe(false); expect(r.intents.get('s2')!.name).toBe('Order confirmed');
    expect(r.intents.get('s2')!.assertions).toContainEqual({ kind: 'heading', text: 'Order confirmed' });
    expect(r.intents.has('s0')).toBe(false);                       // the root is not a flow
  });
  it('with a model: uses its names, KEEPS grounded assertions, REJECTS hallucinated ones', async () => {
    const p = new ScriptedProvider(() => ({ flows: [{ id: 's2', name: 'Place an order', intent: 'Buy something', assertions: [
      { kind: 'heading', text: 'Order confirmed' },            // true on the page
      { kind: 'text-visible', text: 'Free shipping applied' }, // invented: not on the page
      { kind: 'url-matches', pattern: '^/order/\\d+$' },       // true
      { kind: 'alert-contains', text: 'Payment failed' },      // invented
    ] }] }));
    const r = await labelFlows(p, graph);
    expect(r.usedModel).toBe(true); expect(r.rejectedAssertions).toBe(2);
    const i = r.intents.get('s2')!; expect(i.name).toBe('Place an order');
    expect(i.assertions).toEqual([{ kind: 'heading', text: 'Order confirmed' }, { kind: 'url-matches', pattern: '^/order/\\d+$' }]);
  });
  it('ignores unknown state ids and falls back when every assertion is hallucinated', async () => {
    const p = new ScriptedProvider(() => ({ flows: [{ id: 's99', name: 'Ghost', assertions: [] }, { id: 's1', name: 'Pay', assertions: [{ kind: 'text-visible', text: 'Totally made up' }] }] }));
    const r = await labelFlows(p, graph);
    expect(r.intents.has('s99')).toBe(false);
    expect(r.intents.get('s1')!.name).toBe('Pay'); expect(r.intents.get('s1')!.assertions).toContainEqual({ kind: 'heading', text: 'Checkout' });  // fell back to observed
  });
  it('an over-long name is rejected in favor of the observed one', async () => {
    const p = new ScriptedProvider(() => ({ flows: [{ id: 's1', name: 'x'.repeat(200), assertions: [] }] }));
    expect((await labelFlows(p, graph)).intents.get('s1')!.name).toBe('Checkout');
  });
  it('applyIntents attaches intents by flow id', async () => {
    const r = await labelFlows(null, graph);
    const flows = [{ id: 's2', name: 'x', startPath: '/', steps: [], expect: { route: '/', treeHash: '', overlay: '' } }] as Flow[];
    expect(applyIntents(flows, r.intents)[0].intent?.name).toBe('Order confirmed');
  });
});
