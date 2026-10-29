import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { startApp } from '../../benchmark/src/servers.js';
import { TARGETS } from '../../benchmark/src/targets.js';
import { analyzeApp } from '../src/index.js';

const run = async (bugs: string[], changedFiles?: string[]) => {
  const app = await startApp('shop', bugs); const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-pipe-'));
  try { return { out, r: await analyzeApp({ baseUrl: app.baseUrl, cfg: TARGETS.shop, outDir: out, budget: { maxSteps: 45, maxTimeMs: 150000 }, changedFiles, confirm: { attempts: 3, need: 2 } }) }; }
  finally { await app.stop(); }
};

describe('pipeline end to end (real browser, real shop app)', () => {
  it('finds, CONFIRMS and documents injected bugs, with video, trace, screenshot, repro, report and JUnit', async () => {
    const { out, r } = await run(['shop-broken-link', 'shop-console-error']);
    const kinds = r.findings.map(f => f.finding.kind);
    expect(kinds).toContain('broken-link'); expect(kinds).toContain('console-error');
    for (const f of r.findings) {
      expect(f.confirmation.confirmed).toBe(true);
      for (const k of ['video', 'trace', 'screenshot'] as const) { const p = path.join(out, f.artifacts![k]!); expect(fs.statSync(p).size, `${f.id} ${k}`).toBeGreaterThan(500); }
      expect(fs.readdirSync(path.join(out, 'repro')).some(n => n.startsWith(f.id))).toBe(true);
    }
    const html = fs.readFileSync(path.join(out, 'report.html'), 'utf8'); expect(html).toContain('problems found'); expect(html).toContain('Broken link'); expect(html).toContain('/about');
    expect(fs.readFileSync(path.join(out, 'report.inline.html'), 'utf8')).toContain('data:image/png;base64,');
    const junit = fs.readFileSync(path.join(out, 'junit.xml'), 'utf8'); expect(junit).toContain('<failure'); expect(junit).toContain('findings.broken-link');
    expect(r.flowResults.length).toBeGreaterThan(0);
  });

  it('a clean app produces no confirmed findings, and every replayed flow passes', async () => {
    const { r } = await run([]);
    expect(r.findings).toEqual([]); expect(r.flowResults.filter(f => !f.ok)).toEqual([]);
  });

  it('PR-diff mode: a change to an unrelated route skips verification of findings elsewhere', async () => {
    const { r } = await run(['shop-console-error'], ['pages/contact.tsx']);       // /about is broken but only /contact changed
    expect(r.findings).toEqual([]); expect(r.outsideChangedArea).toBeGreaterThan(0);
  });
});
