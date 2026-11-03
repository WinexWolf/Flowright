import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
import type { TargetConfig } from '@flowright/core';
import type { Srv } from '../../driver/test/helpers.js';
import { startLab, st } from './lab.js';
import { analyzeApp, shouldFail, acceptFinding, stateDir, type PipelineOptions } from '../src/index.js';

let srv: Srv; let work: string;
beforeAll(async () => { work = fs.mkdtempSync(path.join(process.cwd(), 'reports', 'e2e-feat-')); srv = await startLab(); }, 30000);
afterAll(async () => { await srv.stop(); fs.rmSync(work, { recursive: true, force: true }); });

const cfg = (o: Partial<TargetConfig> = {}): TargetConfig => ({ name: 'lab', startPath: '/', sandbox: true, ...o });
const run = (name: string, o: Partial<PipelineOptions> = {}, c: TargetConfig = cfg()) => analyzeApp({ baseUrl: srv.url, cfg: c, outDir: path.join(work, name), budget: { maxSteps: 90, maxTimeMs: 240000 }, artifacts: false, replayFlows: false, ...o });
/** Run Playwright as a child process WITHOUT blocking: the app under test is served from this very process, so a synchronous spawn would starve it. */
const pw = (cfgFile: string) => new Promise<{ status: number | null; passed: number; failed: number }>(resolve => {
  const c = spawn('npx', ['playwright', 'test', '--config', cfgFile, '--reporter=json'], { env: { ...process.env, BASE_URL: srv.url } }); let out = '';
  c.stdout.on('data', d => { out += d; }); c.on('close', code => { let j: { stats?: { expected?: number; unexpected?: number } } = {}; try { j = JSON.parse(out); } catch { /* no json */ } resolve({ status: code, passed: j.stats?.expected ?? 0, failed: j.stats?.unexpected ?? 0 }); });
});
const pwConfig = (dir: string, testDir: string) => { const f = path.join(dir, 'pw.config.ts'); fs.writeFileSync(f, `import { defineConfig } from '@playwright/test'; export default defineConfig({ testDir: ${JSON.stringify(testDir)}, workers: 1, timeout: 30000 });`); return f; };

describe('accessibility and keyboard checks on a real crawl', () => {
  it('finds, CONFIRMS and documents accessibility problems; clean pages stay clean', async () => {
    st.fixed = false; const r = await run('a11y', { checks: { a11y: true, keyboard: true } });
    const a11y = r.findings.filter(f => f.finding.kind === 'a11y'); const rules = a11y.map(f => f.finding.meta?.rule);
    expect(rules).toEqual(expect.arrayContaining(['image-alt', 'color-contrast']));
    expect(r.findings.find(f => f.finding.kind === 'keyboard')?.finding.detail).toContain('Fake button');
    for (const f of [...a11y, ...r.findings.filter(f => f.finding.kind === 'keyboard')]) expect(f.confirmation.confirmed, f.finding.detail).toBe(true);
    expect(r.findings.filter(f => ['/', '/form', '/sent'].includes(f.finding.route))).toEqual([]);           // no false alarms on accessible pages
    const html = fs.readFileSync(r.reportPath, 'utf8'); expect(html).toContain('<h2>Accessibility</h2>'); expect(html).toContain('Accessibility');
    const spec = fs.readdirSync(path.join(work, 'a11y', 'repro')).find(f => f.includes('a11y'))!; expect(fs.readFileSync(path.join(work, 'a11y', 'repro', spec), 'utf8')).toContain('AxeBuilder');
  });
  it('the generated a11y repro FAILS while the problem exists and PASSES once it is fixed', async () => {
    st.fixed = false; const r = await run('a11y-repro', { checks: { a11y: true } });
    const f = r.findings.find(x => x.finding.meta?.rule === 'image-alt')!; const dir = path.join(work, 'a11y-repro', 'repro'); const only = path.join(work, 'a11y-repro', 'only'); fs.mkdirSync(only, { recursive: true });
    fs.copyFileSync(path.join(dir, fs.readdirSync(dir).find(n => n.startsWith(f.id + '-'))!), path.join(only, 'repro.spec.ts'));
    const cf = pwConfig(path.join(work, 'a11y-repro'), only);
    st.fixed = false; expect(await pw(cf)).toMatchObject({ failed: 1, passed: 0 });
    st.fixed = true; expect(await pw(cf)).toMatchObject({ failed: 0, passed: 1 });
    st.fixed = false;
  });
});

describe('run history: new, still open, fixed, accepted', () => {
  it('tracks findings across runs and never fails a build for something you accepted', async () => {
    const root = path.join(work, 'hist-root'); const o = { checks: { a11y: true }, stateRoot: root };
    st.fixed = false;
    const r1 = await run('h1', o); expect(r1.firstRun).toBe(true); expect(r1.findings.length).toBeGreaterThan(0); expect(r1.findings.every(f => f.status === 'new')).toBe(true);
    const r2 = await run('h2', o); expect(r2.firstRun).toBe(false); expect(r2.findings.every(f => f.status === 'persisting')).toBe(true); expect(r2.fixed).toEqual([]); expect(r2.fixed).toEqual([]);
    expect(fs.readFileSync(path.join(work, 'h2', 'summary.md'), 'utf8')).toContain('0 new problems');
    expect(shouldFail(r2, 'error')).toBe(true); expect(shouldFail(r2, 'new')).toBe(false);                    // pre-existing problems do not fail a PR in "new" mode
    st.fixed = true; const r3 = await run('h3', o); expect(r3.fixed.map(f => f.kind)).toContain('a11y'); expect(fs.readFileSync(r3.reportPath, 'utf8')).toContain('Fixed since the last run');
    st.fixed = false; const r4 = await run('h4', o); expect(r4.findings.filter(f => f.finding.kind === 'a11y').every(f => f.status === 'new')).toBe(true);                    // it came back: new again
    for (const f of r4.findings) acceptFinding(stateDir(root), f.finding.signature, { reason: 'known', kind: f.finding.kind, route: f.finding.route });
    const r5 = await run('h5', o); expect(r5.findings.every(f => f.status === 'accepted')).toBe(true); expect(shouldFail(r5, 'error')).toBe(false); expect(r5.summary.findings.length).toBeGreaterThan(0);
  });
});

describe('visual regression', () => {
  it('is STABLE (same page twice = no change), catches a real change with images, and --update accepts it', async () => {
    const root = path.join(work, 'vis-root'); st.theme = '#3b82f6'; const o = { stateRoot: root, visual: true as const };
    const v1 = await run('v1', o); expect(v1.visual.created).toBeGreaterThan(0); expect(v1.findings.filter(f => f.finding.kind === 'visual-change')).toEqual([]);
    const v2 = await run('v2', o); expect(v2.visual).toMatchObject({ changed: 0 }); expect(v2.visual.same).toBe(v1.visual.created);                       // identical screenshots across two fresh crawls
    st.theme = '#ef4444'; const v3 = await run('v3', o); const ch = v3.findings.filter(f => f.finding.kind === 'visual-change');
    expect(ch).toHaveLength(1); expect(ch[0].finding.route).toBe('/gallery'); expect(ch[0].visual!.ratio).toBeGreaterThan(0.05);
    for (const f of [ch[0].visual!.baseline, ch[0].visual!.current, ch[0].visual!.diff!]) expect(fs.existsSync(path.join(work, 'v3', f)), f).toBe(true);
    expect(fs.readFileSync(v3.reportPath, 'utf8')).toContain('<h2>Visual changes</h2>'); expect(shouldFail({ findings: ch }, 'error')).toBe(false);                    // visual changes are suspected, never build-breaking by default
    const v4 = await run('v4', { ...o, visual: { update: true } }); expect(v4.findings.filter(f => f.finding.kind === 'visual-change')).toHaveLength(1);
    const v5 = await run('v5', o); expect(v5.visual.changed).toBe(0);                                                                                  // new normal
    st.theme = '#3b82f6';
  });
});

describe('login, journeys and export', () => {
  const auth = { loginPath: '/login', fields: { email: 'me@x.io', password: 'pw' }, submit: 'Sign in', successPath: '/account' };
  it('authenticated pages are crawled; every flow (and recording) starts logged in', async () => {
    const r = await run('auth', { replayFlows: true, artifacts: false }, cfg({ auth }));
    const routes = r.graph.states.map(s => s.evidence.route); expect(routes).toContain('/account'); expect(routes).toContain('/account/secret');
    expect(r.flowResults.length).toBeGreaterThan(0); expect(r.flowResults.filter(f => !f.ok)).toEqual([]);
    const noAuth = await run('noauth', {}); expect(noAuth.graph.states.map(s => s.evidence.route)).not.toContain('/account/secret');
  });
  it('detects journeys, replays them, and exports a plain Playwright project that PASSES', async () => {
    const exportDir = path.join(work, 'suite'); const r = await run('journeys', { replayFlows: true, exportDir });
    const send = r.journeys.find(j => j.name === 'Send message'); expect(send).toMatchObject({ kind: 'transaction' }); expect(send!.variants.some(v => v.outcome === 'validation-error')).toBe(true);
    expect(r.flowResults.filter(f => !f.ok)).toEqual([]);
    const files = fs.readdirSync(path.join(exportDir, 'tests', 'journeys')); expect(files).toContain('send-message.spec.ts'); expect(files.some(f => f.includes('nothing-filled-in'))).toBe(true);
    const res = await pw(pwConfig(exportDir, path.join(exportDir, 'tests'))); expect(res.failed).toBe(0); expect(res.passed).toBeGreaterThanOrEqual(files.length);
    expect(fs.readFileSync(path.join(work, 'journeys', 'report.html'), 'utf8')).toContain('Send message');
  });
});

describe('mobile device mode', () => {
  it('a page that fits on a desktop but not on a phone is caught only in mobile mode', async () => {
    const d = await run('desk', {}); expect(d.findings.filter(f => f.finding.kind === 'overflow')).toEqual([]);
    const m = await run('mob', {}, cfg({ device: 'mobile' })); const o = m.findings.filter(f => f.finding.kind === 'overflow'); expect(o.map(f => f.finding.route)).toContain('/wide');
    expect(fs.readFileSync(m.reportPath, 'utf8')).toContain('phone (390 x 844, touch)');
  });
});
