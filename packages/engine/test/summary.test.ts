import { describe, it, expect } from 'vitest';
import { toMarkdown, toSlack, verdict, type RunSummary } from '../src/summary.js';
import { renderSuite } from '../src/export.js';
import type { Journey } from '@flowright/flow-compiler';
import type { Flow, TargetConfig } from '@flowright/core';

const S = (o: Partial<RunSummary> = {}): RunSummary => ({ title: 'Flowright: shop', target: 'http://x', pages: 12, flows: { passed: 11, total: 11 }, findings: [], fixed: [], firstRun: false, visual: { changed: 0, created: 0 }, durationSec: 75, ...o });
const F = (id: string, status: 'new' | 'persisting' | 'accepted', sev: 'error' | 'suspect' = 'error') => ({ id, severity: sev, kind: 'broken-link', route: '/help', detail: 'Help | leads to 404', status });

describe('PR summary', () => {
  it('a clean run says so', () => { expect(verdict(S())).toBe('No problems found across 12 pages.'); expect(toMarkdown(S())).toContain('11 of 11 flows replayed'); });
  it('leads with what is NEW (that is what a reviewer needs), then what is still open', () => {
    const s = S({ findings: [F('F1', 'persisting'), F('F2', 'new'), F('F3', 'accepted')] }); expect(verdict(s)).toBe('1 new problem, 1 still open.');
    const md = toMarkdown(s); expect(md.indexOf('| **new** |')).toBeLessThan(md.indexOf('| open |')); expect(md).toContain('accepted');
  });
  it('accepted findings never count as problems', () => { expect(verdict(S({ findings: [F('F1', 'accepted')] }))).toBe('No problems found across 12 pages.'); });
  it('the first run does not pretend to know what is new', () => { expect(verdict(S({ firstRun: true, findings: [F('F1', 'new')] }))).toBe('1 problem found.'); });
  it('escapes table-breaking characters, mentions fixed items and visual changes, links the report', () => {
    const md = toMarkdown(S({ findings: [F('F1', 'new')], fixed: [{ kind: 'overflow', route: '/p', detail: 'd' }], visual: { changed: 2, created: 0 }, reportUrl: 'https://ci/report' }));
    expect(md).toContain('Help \\| leads'); expect(md).toContain('Fixed since the last run (1)'); expect(md).toContain('2 pages look different'); expect(md).toContain('[Open the full report](https://ci/report)');
  });
  it('Slack payload: header, summary, top findings, button', () => {
    const p = toSlack(S({ findings: [F('F1', 'new')], reportUrl: 'https://ci/r' })); expect(p.text).toContain('1 new problem'); expect(JSON.stringify(p.blocks)).toContain(':red_circle:'); expect(JSON.stringify(p.blocks)).toContain('https://ci/r');
  });
});

describe('Playwright suite export (no lock-in)', () => {
  const cfg: TargetConfig = { name: 'shop', startPath: '/', sandbox: true };
  const flow = (id: string, name: string): Flow => ({ id, name, startPath: '/', steps: [], expect: { route: '/x', treeHash: '', overlay: '', heading: 'X' } });
  const J = (id: string, name: string, kind: Journey['kind'], variants: Journey['variants'] = []): Journey => ({ id, name, kind, steps: [], flow: flow(id, name), variants });
  it('writes a runnable project: config, package.json, README, tests grouped by journeys and pages', () => {
    const files = renderSuite({ name: 'Shop', cfg, journeys: [J('s6', 'Place order', 'transaction', [{ label: 'with nothing filled in', outcome: 'validation-error', flow: flow('s5', 'Place order (empty)') }, { label: 'with invalid values', outcome: 'accepted-anyway', flow: flow('s7', 'x') }]), J('s1', 'Open All products', 'page')] });
    const paths = files.map(f => f.path);
    expect(paths).toEqual(expect.arrayContaining(['playwright.config.ts', 'package.json', 'README.md', 'flowright.target.json', 'tests/journeys/place-order.spec.ts', 'tests/journeys/place-order-with-nothing-filled-in.spec.ts', 'tests/pages/open-all-products.spec.ts']));
    expect(paths.some(p => p.includes('invalid-values'))).toBe(false);          // an "accepted anyway" variant is a bug, not a test to ship
    expect(files.find(f => f.path === 'README.md')!.content).toContain('Nothing here needs Flowright');
  });
  it('file names are unique even when journey names collide', () => {
    const paths = renderSuite({ name: 'S', cfg, journeys: [J('a', 'Save', 'transaction'), J('b', 'Save', 'transaction')] }).map(f => f.path).filter(p => p.startsWith('tests/'));
    expect(new Set(paths).size).toBe(2);
  });
});
