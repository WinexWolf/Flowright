import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyze.js';
import type { CrawlGraph, Edge, StateNode, Obs, Action, Evidence } from '@flowright/core';

const ev = (route: string, over: Partial<Evidence> = {}): Evidence => ({ route, title: '', headings: [], textSample: 'x', alerts: [], dialogs: [], selectedTabs: [], overflowX: false, brokenImages: 0, emptyMain: false, ...over });
const st = (id: string, route: string, depth = 1, over: Partial<Evidence> = {}): StateNode => ({ id, fine: id, coarse: id, treeHash: id, overlay: '', url: 'http://x' + route, urlTemplate: route, evidence: ev(route, over), depth, path: [] });
const obs = (o: Partial<Obs> = {}): Obs => ({ consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], noEffect: false, ...o });
const click = (role: string, name: string): Action => ({ kind: 'click', role, name, nth: 0, css: 'x', label: `click ${role} "${name}"` });
const form = (variant: 'valid' | 'empty' | 'invalid', key = '/f|a,b', type = 'email'): Action => ({ kind: 'form', variant, fields: [{ name: 'a', type, label: 'a', required: false, css: 'a' }], submit: null, label: `form ${key} [${variant}]` });
const edge = (from: string, to: string, action: Action, o: Partial<Obs> = {}): Edge => ({ from, to, label: action.label, action, obs: obs(o) });
const G = (states: StateNode[], edges: Edge[]): CrawlGraph => ({ states, edges, cycles: [] });

describe('oracle: real failures', () => {
  it('uncaught exception -> console-error at the destination route', () => {
    const f = analyze(G([st('a', '/'), st('b', '/about')], [edge('a', 'b', click('link', 'About'), { pageErrors: ['TypeError: x'] })]));
    expect(f.map(x => [x.kind, x.route])).toContainEqual(['console-error', '/about']);
  });
  it('5xx xhr -> failed-request; 404 document via link -> broken-link', () => {
    const f = analyze(G([st('a', '/'), st('b', '/p/1'), st('c', '/nope')], [
      edge('a', 'b', click('link', 'P'), { badResponses: ['500 fetch http://x/api/stock/1'] }),
      edge('a', 'c', click('link', 'Help'), { badResponses: ['404 document http://x/nope'] })]));
    expect(f.some(x => x.kind === 'failed-request' && x.route === '/p/1')).toBe(true);
    expect(f.some(x => x.kind === 'broken-link' && x.route === '/nope')).toBe(true);
  });
  it('button with no effect -> dead-click at the SOURCE route', () => {
    const f = analyze(G([st('a', '/p/1')], [edge('a', 'a', click('button', 'Add'), { noEffect: true })]));
    expect(f).toHaveLength(1); expect(f[0]).toMatchObject({ kind: 'dead-click', route: '/p/1' });
  });
  it('overflow, broken images and blank routes are state-level findings', () => {
    const f = analyze(G([st('a', '/', 0), st('b', '/x', 1, { overflowX: true, brokenImages: 2, emptyMain: true })], []));
    expect(f.map(x => x.kind).sort()).toEqual(['broken-image', 'empty-route', 'overflow']);
  });
});

describe('oracle: things that must NOT be reported', () => {
  it('a link to the current page with no effect is not a dead click', () => {
    expect(analyze(G([st('a', '/tasks')], [edge('a', 'a', click('link', 'Tasks'), { noEffect: true })]))).toHaveLength(0);
  });
  it('4xx returned to a deliberately invalid form probe is correct validation', () => {
    const f = analyze(G([st('a', '/f'), st('b', '/f')], [edge('a', 'b', form('empty'), { badResponses: ['422 fetch http://x/api/tasks'] })]));
    expect(f).toHaveLength(0);
  });
  it('the same 4xx on a NON-probe action is reported', () => {
    const f = analyze(G([st('a', '/f')], [edge('a', 'a', click('button', 'Go'), { badResponses: ['403 fetch http://x/api/y'] })]));
    expect(f.some(x => x.kind === 'failed-request')).toBe(true);
  });
  it('crawler action errors are not app findings', () => {
    expect(analyze(G([st('a', '/')], [edge('a', 'a', click('button', 'X'), { actionError: 'timeout', noEffect: true })]))).toHaveLength(0);
  });
  it('browser "Failed to load resource" console lines are not double-counted as console errors', () => {
    const f = analyze(G([st('a', '/'), st('b', '/p')], [edge('a', 'b', click('link', 'P'), { consoleErrors: ['Failed to load resource: 500'], badResponses: ['500 fetch http://x/api/s'] })]));
    expect(f.map(x => x.kind)).toEqual(['failed-request']);
  });
});

describe('oracle: form probes', () => {
  const S = [st('src', '/checkout'), st('ok', '/order'), st('err', '/checkout')];
  it('flags empty/invalid input that ends in the same state as valid input', () => {
    const f = analyze(G(S, [edge('src', 'ok', form('valid')), edge('src', 'ok', form('invalid')), edge('src', 'err', form('empty'))]));
    expect(f).toHaveLength(1); expect(f[0]).toMatchObject({ kind: 'missing-validation', severity: 'suspect', route: '/checkout' });
  });
  it('does not flag a form that rejects bad input', () => {
    expect(analyze(G(S, [edge('src', 'ok', form('valid')), edge('src', 'err', form('invalid')), edge('src', 'err', form('empty'))]))).toHaveLength(0);
  });
  it('does not flag when valid input itself changes nothing (no baseline)', () => {
    expect(analyze(G(S, [edge('src', 'src', form('valid')), edge('src', 'src', form('empty'))]))).toHaveLength(0);
  });
  it('free-text-only form: "invalid" input (x) is not invalid, so it is not flagged; empty still is', () => {
    const t = 'text';
    const f = analyze(G(S, [edge('src', 'ok', form('valid', '/f|a', t)), edge('src', 'ok', form('invalid', '/f|a', t)), edge('src', 'ok', form('empty', '/f|a', t))]));
    expect(f.map(x => x.detail)).toEqual(['form accepted empty input and ended in the same state as valid input']);
  });
  it('accepted-but-structurally-different outcome (blank row added) still counts as accepted', () => {
    const SS = [st('src', '/#/tasks'), st('ok', '/#/tasks'), st('blank', '/#/tasks')];
    const f = analyze(G(SS, [edge('src', 'ok', form('valid', '/f|a', 'text')), edge('src', 'blank', form('empty', '/f|a', 'text'))]));
    expect(f.map(x => x.kind)).toEqual(['missing-validation']);
  });
  it('...but not when the empty submit leaves an alert or the dialog open', () => {
    const SS = [st('src', '/#/tasks'), st('ok', '/#/tasks'), st('err', '/#/tasks', 1, { alerts: ['Title is required'] }), st('open', '/#/tasks', 1, { dialogs: ['New task'] })];
    expect(analyze(G(SS, [edge('src', 'ok', form('valid', '/f|a', 'text')), edge('src', 'err', form('empty', '/f|a', 'text'))]))).toHaveLength(0);
    expect(analyze(G(SS, [edge('src', 'ok', form('valid', '/f|a', 'text')), edge('src', 'open', form('empty', '/f|a', 'text'))]))).toHaveLength(0);
  });
});
