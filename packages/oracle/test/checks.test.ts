import { describe, it, expect } from 'vitest';
import { analyzeChecks } from '../src/checks.js';
import type { CrawlGraph, StateNode, StateChecks, Evidence } from '@flowright/core';

const ev = (route: string): Evidence => ({ route, title: '', headings: [], textSample: '', alerts: [], dialogs: [], selectedTabs: [], overflowX: false, brokenImages: 0, emptyMain: false });
const st = (id: string, tpl: string, checks?: StateChecks): StateNode => ({ id, fine: id, coarse: id, treeHash: id, overlay: '#', url: 'http://x' + tpl, urlTemplate: tpl, evidence: ev(tpl.replace(':id', '7')), depth: 1, path: [], checks });
const G = (states: StateNode[]): CrawlGraph => ({ states, edges: [], cycles: [] });
const v = (id: string, impact: any, nodes = 1) => ({ id, impact, help: id + ' help', nodes });

describe('analyzeChecks', () => {
  it('turns axe violations into findings; critical/serious are errors, moderate/minor are suspected', () => {
    const f = analyzeChecks(G([st('s1', '/a', { a11y: [v('image-alt', 'critical'), v('color-contrast', 'serious'), v('region', 'moderate'), v('tabindex', 'minor')], keyboard: [] })]));
    expect(f.map(x => [x.meta?.rule, x.severity])).toEqual([['image-alt', 'error'], ['color-contrast', 'error'], ['region', 'suspect'], ['tabindex', 'suspect']]);
    expect(f.every(x => x.kind === 'a11y')).toBe(true); expect(f[0].detail).toContain('image-alt, 1 element');
  });
  it('reports a rule once per page TEMPLATE, not once per product id', () => {
    const c = { a11y: [v('image-alt', 'critical')], keyboard: [] };
    expect(analyzeChecks(G([st('s1', '/products/:id', c), st('s2', '/products/:id', c)]))).toHaveLength(1);
    expect(analyzeChecks(G([st('s1', '/a', c), st('s2', '/b', c)]))).toHaveLength(2);
  });
  it('keyboard findings: a trap is an error; the heuristic ones are only suspected', () => {
    const f = analyzeChecks(G([st('s1', '/a', { a11y: [], keyboard: [{ kind: 'keyboard-trap', detail: 'stuck', count: 1 }, { kind: 'no-focus-indicator', detail: 'no ring', count: 3 }, { kind: 'mouse-only', detail: 'div', count: 1 }] })]));
    expect(f.map(x => [x.meta?.keyboard, x.severity])).toEqual([['keyboard-trap', 'error'], ['no-focus-indicator', 'suspect'], ['mouse-only', 'suspect']]);
  });
  it('keeps the path to the state, so the finding can be replayed and confirmed', () => {
    const s = st('s1', '/a', { a11y: [v('x', 'critical')], keyboard: [] }); s.path = [{ kind: 'click', role: 'link', name: 'A', nth: 0, css: 'a', label: 'click link "A"' }];
    expect(analyzeChecks(G([s]))[0].path).toHaveLength(1);
  });
  it('states without scans produce nothing', () => { expect(analyzeChecks(G([st('s1', '/a')]))).toEqual([]); });
});
