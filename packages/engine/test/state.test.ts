import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { classify, fixedSince, flowChanges, loadState, saveState, acceptFinding, unacceptFinding, type RunRecord } from '../src/state.js';

const run = (o: Partial<RunRecord> = {}): RunRecord => ({ at: 't', target: 'x', scope: 'full', budgetHit: false, findings: [], flows: {}, pages: 5, ...o });

describe('run history', () => {
  it('classifies new, persisting and accepted', () => {
    const m = classify(['a', 'b', 'c'], run({ findings: ['b', 'c'] }), { c: { reason: 'known', at: 't', kind: 'k', route: '/' } });
    expect([m.get('a'), m.get('b'), m.get('c')]).toEqual(['new', 'persisting', 'accepted']);
  });
  it('the very first run has nothing to compare with: everything is new', () => { expect(classify(['a'], undefined, {}).get('a')).toBe('new'); });
  it('"fixed" = in the last run, not in this one', () => { expect(fixedSince(run({ findings: ['a', 'b'] }), { scope: 'full', budgetHit: false, findings: ['b'] })).toEqual(['a']); });
  it('never claims "fixed" from a partial run (PR-scoped, or the budget ran out): that would be a guess', () => {
    const prev = run({ findings: ['a'] });
    expect(fixedSince(prev, { scope: 'diff', budgetHit: false, findings: [] })).toEqual([]);
    expect(fixedSince(prev, { scope: 'full', budgetHit: true, findings: [] })).toEqual([]);
    expect(fixedSince(run({ scope: 'diff', findings: ['a'] }), { scope: 'full', budgetHit: false, findings: [] })).toEqual([]);
    expect(fixedSince(undefined, { scope: 'full', budgetHit: false, findings: [] })).toEqual([]);
  });
  it('flags flows that STOPPED replaying (a regression candidate, never silently re-healed) and ones that started again', () => {
    expect(flowChanges(run({ flows: { a: true, b: false, c: true } }), { a: false, b: true, c: true, d: false })).toEqual({ stopped: ['a'], started: ['b'] });
  });
  it('persists to a folder you can commit, keeps only the last 50 runs, and survives a missing or corrupt file', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-state-')); expect(loadState(d)).toEqual({ runs: [], accepted: {} });
    saveState(d, { runs: Array.from({ length: 60 }, (_, i) => run({ at: String(i) })), accepted: {} }); const st = loadState(d); expect(st.runs).toHaveLength(50); expect(st.runs[49].at).toBe('59');
    fs.writeFileSync(path.join(d, 'history.json'), '{not json'); expect(loadState(d).runs).toEqual([]);
  });
  it('accepting and un-accepting a finding', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-acc-')); acceptFinding(d, 'sig', { reason: 'intended', kind: 'overflow', route: '/p' });
    expect(loadState(d).accepted.sig).toMatchObject({ reason: 'intended', kind: 'overflow' }); expect(unacceptFinding(d, 'sig')).toBe(true); expect(unacceptFinding(d, 'sig')).toBe(false); expect(loadState(d).accepted).toEqual({});
  });
});
