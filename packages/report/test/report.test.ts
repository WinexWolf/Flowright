import { describe, it, expect } from 'vitest';
import { buildReport, type ReportData } from '../src/index.js';

const base = (o: Partial<ReportData> = {}): ReportData => ({
  title: 'Flowright report', target: 'http://localhost:3000', generatedAt: '28 Oct 2026', durationMs: 75_000,
  findings: [], unconfirmed: [], flows: [], graph: { states: [{ id: 's0', route: '/', heading: 'Home', depth: 0, findings: 0 }, { id: 's1', route: '/about', heading: 'About', depth: 1, findings: 0 }], edges: [{ from: 's0', to: 's1', bad: false }] }, facts: { 'Pages found': 2 }, ...o });
const finding = { id: 'F1', kind: 'console-error', severity: 'error' as const, route: '/about', detail: 'console.error: widget failed', occurrences: 2, steps: ['click link “About”'], reproduced: 3, attempts: 3, repro: 'test("x")' };

describe('buildReport', () => {
  it('leads with a plain verdict sentence', () => {
    expect(buildReport(base())).toContain('No problems found across 2 pages.');
    const r = buildReport(base({ findings: [finding] }));
    expect(r).toContain('1 problem found.'); expect(r).toContain('Console error'); expect(r).toContain('/about'); expect(r).toContain('Reproduced in 3 of 3 fresh replays');
  });
  it('separates broken from suspected, and reports set-aside candidates honestly', () => {
    const r = buildReport(base({ findings: [finding, { ...finding, id: 'F2', kind: 'missing-validation', severity: 'suspect' }], unconfirmed: [{ kind: 'dead-click', route: '/x', detail: 'flaky' }] }));
    expect(r).toContain('(1 broken, 1 suspected)'); expect(r).toContain('Form accepts bad input'); expect(r).toContain('1 candidate did not reproduce'); expect(r).toContain('Set aside');
  });
  it('ESCAPES untrusted text (page content must not inject markup)', () => {
    const evil = '<img src=x onerror=alert(1)></code></pre><script>alert(2)</script>';
    const r = buildReport(base({ findings: [{ ...finding, detail: evil, route: evil, steps: [evil], repro: evil }], flows: [{ id: 'f', name: evil, steps: [], assertions: [evil] }] }));
    expect(r).not.toContain('<script>alert'); expect(r).not.toContain('<img src=x'); expect(r).toContain('&lt;script&gt;');
  });
  it('is self-contained: no scripts at all, theme tokens for light and dark, mobile viewport', () => {
    const r = buildReport(base());
    expect(r).not.toMatch(/<script/i); expect(r).toContain('prefers-color-scheme:dark'); expect(r).toContain('data-theme="dark"'); expect(r).toContain('viewport-fit=cover'); expect(r).toContain('env(safe-area-inset-top');
  });
  it('flows show pass, fail with reason, and not-replayed', () => {
    const r = buildReport(base({ flows: [{ id: 'a', name: 'Checkout', steps: ['a', 'b'], assertions: ['heading “Order confirmed”'], replay: { ok: true } }, { id: 'b', name: 'Login', steps: ['a'], assertions: [], replay: { ok: false, why: 'heading missing' } }, { id: 'c', name: 'About', steps: [], assertions: [] }] }));
    expect(r).toContain('Passes'); expect(r).toContain('Fails'); expect(r).toContain('heading missing'); expect(r).toContain('Not replayed'); expect(r).toContain('1 of 2 flows replayed');
  });
  it('draws a route map with a marked finding station and handles a big graph', () => {
    const states = Array.from({ length: 120 }, (_, i) => ({ id: 's' + i, route: '/p/' + i, heading: 'Page ' + i, depth: 1 + (i % 4), findings: i === 3 ? 1 : 0 }));
    const r = buildReport(base({ graph: { states, edges: [{ from: 's3', to: 's4', bad: true }] } }));
    expect(r).toContain('class="st bad"'); expect(r).toContain('class="edge bad"'); expect((r.match(/class="st/g) ?? []).length).toBeLessThanOrEqual(80);
  });
  it('inline mode embeds a screenshot as a data URI; link mode references the file', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const p = (await import('node:path')).join(os.tmpdir(), 'fr-shot.png');
    fs.writeFileSync(p, Buffer.from('89504e470d0a1a0a', 'hex'));
    const f = { ...finding, artifacts: { screenshot: p, video: 'a/video.webm' } };
    expect(buildReport(base({ findings: [f] }), { assets: 'inline' })).toContain('data:image/png;base64,');
    expect(buildReport(base({ findings: [f] }), { assets: 'inline' })).not.toContain('video.webm');
    expect(buildReport(base({ findings: [f] }), { assets: 'link' })).toContain('Watch the video');
  });
});
