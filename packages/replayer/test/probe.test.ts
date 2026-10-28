import { describe, it, expect } from 'vitest';
import { sameProbeOutcome, type ReplayResult } from '../src/replay.js';
import type { Evidence, Obs } from '@flowright/core';

const obs: Obs = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], noEffect: false };
const ev = (route: string, o: Partial<Evidence> = {}): Evidence => ({ route, title: '', headings: [], textSample: 'x', alerts: [], dialogs: [], selectedTabs: [], overflowX: false, brokenImages: 0, emptyMain: false, ...o });
const r = (route: string, tree: string, o: Partial<Evidence> = {}): ReplayResult => ({ ok: true, obs, noEffect: false, treeHash: tree, overlay: '#0', evidence: ev(route, o) });

describe('sameProbeOutcome (confirmation must agree with detection)', () => {
  it('identical structure on the same route is the same outcome', () => {
    expect(sameProbeOutcome(r('/#/tasks', 'A'), r('/#/tasks', 'A'))).toBe(true);
  });
  it('REGRESSION: an accepted blank item changes structure (zero-width row) but is still the same outcome', () => {
    expect(sameProbeOutcome(r('/#/tasks', 'A'), r('/#/tasks', 'B'))).toBe(true);
  });
  it('an alert on the probe side means the app validated: NOT the same outcome', () => {
    expect(sameProbeOutcome(r('/#/tasks', 'A'), r('/#/tasks', 'B', { alerts: ['Title is required'] }))).toBe(false);
  });
  it('a dialog still open on the probe side means the form was not accepted', () => {
    expect(sameProbeOutcome(r('/#/tasks', 'A'), r('/#/tasks', 'B', { dialogs: ['New task'] }))).toBe(false);
  });
  it('different routes are different outcomes; ids in the route do not matter', () => {
    expect(sameProbeOutcome(r('/#/tasks', 'A'), r('/#/projects', 'A'))).toBe(false);
    expect(sameProbeOutcome(r('/order/1001', 'A'), r('/order/1002', 'A'))).toBe(true);
  });
  it('a failed replay is never "the same"', () => {
    expect(sameProbeOutcome({ ...r('/x', 'A'), ok: false }, r('/x', 'A'))).toBe(false);
  });
});
