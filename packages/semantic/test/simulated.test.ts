import { describe, it, expect } from 'vitest';
import { SimulatedProvider } from '@flowright/llm-provider';
import { labelFlows, suggestFieldValues } from '../src/index.js';
import { polishNarration, narrateFlow } from '../../demo/src/narrate.js';
import { LlmPolicy } from '../../agent/src/policy.js';
import type { CrawlGraph, Evidence, Flow, StateNode } from '@flowright/core';

const ev = (route: string, h: string, o: Partial<Evidence> = {}): Evidence => ({ route, title: h, headings: [h], textSample: h + ' body', alerts: [], dialogs: [], selectedTabs: [], overflowX: false, brokenImages: 0, emptyMain: false, ...o });
const st = (id: string, route: string, h: string, label: string): StateNode => ({ id, fine: id, coarse: id, treeHash: id, overlay: '#', url: 'http://x' + route, urlTemplate: route, evidence: ev(route, h), depth: 1, path: [{ kind: 'click', role: 'link', name: h, nth: 0, css: 'a', label }] });
const graph: CrawlGraph = { states: [st('s0', '/', 'Welcome', 'x'), st('s1', '/order/7', 'Order confirmed', 'click link "Place"'), st('s2', '/sent', 'Message sent', 'click link "Send"'), st('s3', '/about', 'About us', 'click link "About"')], edges: [], cycles: [] };

describe('the simulated model goes through the SAME checks as a real one', () => {
  it('names flows like a person would, and the guard REJECTS its deliberately made-up checks', async () => {
    const p = new SimulatedProvider(); const r = await labelFlows(p, graph);
    expect(r.usedModel).toBe(true); expect(r.rejectedAssertions).toBeGreaterThan(0);
    expect(r.intents.get('s1')!.name).toBe('Place an order'); expect(r.intents.get('s2')!.name).toBe('Send a message');
    for (const i of r.intents.values()) for (const a of i.assertions) expect(JSON.stringify(a)).not.toMatch(/Free shipping|Payment failed/);   // nothing invented survives
    expect(p.simulated).toBe(true); expect(p.totals().costUsd).toBe(0);
  });
  it('with hallucination off, nothing is rejected', async () => { expect((await labelFlows(new SimulatedProvider({ hallucinate: false }), graph)).rejectedAssertions).toBe(0); });
  it('form values only for real fields, sensible by field name', async () => {
    const v = await suggestFieldValues(new SimulatedProvider(), [{ key: 'k', fields: [{ name: 'email', type: 'email', label: 'Email', required: true, css: '#e' }, { name: 'full_name', type: 'text', label: 'Full name', required: true, css: '#n' }, { name: 'q', type: 'search', label: 'Search', required: false, css: '#q' }] }]);
    expect(v).toEqual({ email: 'priya.raman@example.com', full_name: 'Priya Raman', q: 'headphones' });
  });
  it('the agent policy picks a valid action that matches the goal, with a reason', async () => {
    const c = (t: string) => ({ action: { kind: 'click' as const, role: 'link', name: t, nth: 0, css: 'a', label: `click link "${t}"` }, text: t });
    const choice = await new LlmPolicy(new SimulatedProvider()).choose({ goal: 'add a product to the cart', evidence: ev('/', 'Home'), candidates: [c('About'), c('Add to cart'), c('Contact')], history: [], visitedRoutes: new Set() });
    expect(choice.index).toBe(1); expect(choice.reason).toContain('cart');
  });
  it('narration keeps every control name (the same rule that protects against a real model dropping one)', async () => {
    const flow: Flow = { id: 'f', name: 'x', startPath: '/', steps: [{ kind: 'click', role: 'link', name: 'Products', nth: 0, css: 'a', label: 'click link "Products"' }], expect: { route: '/p', treeHash: '', overlay: '', heading: 'All products' } };
    const lines = narrateFlow(flow); const r = await polishNarration(new SimulatedProvider(), lines, flow);
    expect(r.rejected).toBe(0); expect(r.lines[1].text).toContain('Products'); expect(r.lines[1].text).not.toBe(lines[1].text);
  });
  it('an unknown request fails loudly instead of inventing an answer', async () => {
    await expect(new SimulatedProvider().generateJson({ schemaName: 'something-else', prompt: 'x' }, r => r)).rejects.toThrow(/no scripted answer/);
  });
});
