import { describe, it, expect } from 'vitest';
import { detectJourneys, humanStep } from '../src/journeys.js';
import type { Action, CrawlGraph, Edge, Evidence, StateNode, TargetConfig } from '@flowright/core';

const cfg: TargetConfig = { name: 't', startPath: '/', sandbox: true };
const ev = (route: string, h: string, o: Partial<Evidence> = {}): Evidence => ({ route, title: h, headings: [h], textSample: '', alerts: [], dialogs: [], selectedTabs: [], overflowX: false, brokenImages: 0, emptyMain: false, ...o });
const click = (role: string, name: string): Action => ({ kind: 'click', role, name, nth: 0, css: 'x', label: `click ${role} "${name}"` });
const form = (variant: 'valid' | 'empty' | 'invalid', submit: string, fields: [string, string][] = [['name', 'text'], ['email', 'email']], key = 'k', method = 'POST'): Action => ({ kind: 'form', variant, label: `form ${key} [${variant}]`, method, fields: fields.map(([name, type]) => ({ name, type, label: name, required: false, css: '#' + name })), submit: { role: 'button', name: submit, nth: 0, css: '#s' } } as Action);
const st = (id: string, route: string, h: string, path: Action[], o: Partial<Evidence> = {}): StateNode => ({ id, fine: id, coarse: id, treeHash: id, overlay: '#', url: 'http://x' + route, urlTemplate: route, evidence: ev(route, h, o), depth: path.length, path });
const edge = (from: string, to: string, action: Action): Edge => ({ from, to, label: action.label, action, obs: { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], noEffect: false } });

// home -> products -> product -> (Add to cart) -> cart -> checkout -> [valid: order confirmed | empty: errors]
const shop = (): CrawlGraph => {
  const toProducts = click('link', 'Products'), toProduct = click('link', 'Studio Headphones'), add = click('button', 'Add to cart'), toCheckout = click('link', 'Proceed to checkout');
  const placeV = form('valid', 'Place order', [['name', 'text'], ['email', 'email'], ['address', 'text']], 'checkout'), placeE = form('empty', 'Place order', [['name', 'text'], ['email', 'email'], ['address', 'text']], 'checkout');
  const s0 = st('s0', '/', 'Welcome', []), s1 = st('s1', '/products', 'All products', [toProducts]), s2 = st('s2', '/products/:id', 'Studio Headphones', [toProducts, toProduct]);
  const s3 = st('s3', '/cart', 'Your cart', [toProducts, toProduct, add]), s4 = st('s4', '/checkout', 'Checkout', [toProducts, toProduct, add, toCheckout]);
  const s5 = st('s5', '/checkout', 'Checkout', [toProducts, toProduct, add, toCheckout, placeE], { alerts: ['Please enter your name'] }), s6 = st('s6', '/order/:id', 'Order confirmed', [toProducts, toProduct, add, toCheckout, placeV]);
  return { states: [s0, s1, s2, s3, s4, s5, s6], cycles: [], edges: [edge('s0', 's1', toProducts), edge('s1', 's2', toProduct), edge('s2', 's3', add), edge('s3', 's4', toCheckout), edge('s4', 's6', placeV), edge('s4', 's5', placeE)] };
};

describe('detectJourneys (deterministic)', () => {
  const js = detectJourneys(shop(), cfg);
  it('a form whose valid submission goes somewhere is a named transaction, listed first', () => {
    expect(js[0]).toMatchObject({ name: 'Place order', kind: 'transaction', id: 's6' });
    expect(js[0].steps).toEqual(['Open “Products”', 'Open “Studio Headphones”', 'Press “Add to cart”', 'Open “Proceed to checkout”', 'Fill in name, email and address, then press “Place order”']);
    expect(js[0].flow.expect).toMatchObject({ route: '/order/:id', heading: 'Order confirmed' });
  });
  it('empty submissions become labelled variants: a validation error is a good outcome', () => {
    expect(js[0].variants).toHaveLength(1); expect(js[0].variants[0]).toMatchObject({ label: 'with nothing filled in', outcome: 'validation-error' });
    expect(js[0].variants[0].flow.expect.heading).toBe('Checkout');
  });
  it('a variant that goes through anyway is flagged "accepted-anyway" (that is what missing validation looks like)', () => {
    const g = shop(); g.edges = g.edges.map(e => e.to === 's5' ? { ...e, to: 's6' } : e);
    expect(detectJourneys(g, cfg)[0].variants[0].outcome).toBe('accepted-anyway');
  });
  it('a state reached in 3+ steps is a multi-step journey named after the button pressed last', () => {
    expect(js.find(j => j.id === 's3')).toMatchObject({ name: 'Add to cart', kind: 'multi-step' });
  });
  it('shallow states stay plain page flows, after the journeys', () => {
    const kinds = js.map(j => j.kind); expect(kinds.indexOf('page')).toBeGreaterThan(kinds.lastIndexOf('multi-step'));
    expect(js.find(j => j.id === 's1')).toMatchObject({ name: 'Open All products', kind: 'page' });
  });
  it('a password form is a login; a search form is a search', () => {
    const login = form('valid', 'Sign in', [['email', 'email'], ['password', 'password']], 'login'); const search = form('valid', 'Go', [['q', 'search']], 'search', 'GET');
    const g: CrawlGraph = { states: [st('s0', '/', 'Home', []), st('s1', '/account', 'My account', [login]), st('s2', '/search', 'Results', [search])], cycles: [], edges: [edge('s0', 's1', login), edge('s0', 's2', search)] };
    const r = detectJourneys(g, cfg); expect(r.find(j => j.id === 's1')).toMatchObject({ kind: 'auth', name: 'Sign in' }); expect(r.find(j => j.id === 's2')).toMatchObject({ kind: 'search', name: 'Search' });
  });
  it('a generic submit button is named after where it leads', () => {
    const f = form('valid', 'Send', [['m', 'text']], 'c'); const g: CrawlGraph = { states: [st('s0', '/', 'Home', []), st('s1', '/sent', 'Message sent', [f])], cycles: [], edges: [edge('s0', 's1', f)] };
    expect(detectJourneys(g, cfg)[0].name).toBe('Send: Message sent');
  });
  it('journey names are unique and ids match the end state', () => {
    const names = js.map(j => j.name); expect(new Set(names).size).toBe(names.length); for (const j of js) expect(j.flow.id).toBe(j.id);
  });
  it('humanStep reads like a person wrote it', () => {
    expect(humanStep(click('link', 'Cart (3)'))).toBe('Open “Cart”'); expect(humanStep(click('tab', 'Open'))).toBe('Switch to the “Open” tab');
    expect(humanStep(form('empty', 'Save'))).toBe('Press “Save” without filling anything in');
  });
});
