import { chromium } from 'playwright';
import type { Budget, ExplorationResult, TargetConfig, Evidence } from '@flowright/core';
import { snapshot, trackInflight, isBlocked } from '@flowright/explorer';

function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const evKey = (e: Evidence) => [e.route, e.headings.join('/'), e.alerts.join('/'), e.dialogs.join('/').slice(0, 60), e.selectedTabs.join('/')].join('|');

/**
 * Baseline: a seeded random walker. Picks a random visible interactive element each step (and sometimes submits a form
 * with random text). No state graph, no replay, no prioritisation. Any real explorer must beat this.
 */
export async function randomExplorer(baseUrl: string, cfg: TargetConfig, budget: Budget, seed = 1): Promise<ExplorationResult> {
  const rnd = mulberry32(seed); const t0 = Date.now();
  const browser = await chromium.launch();
  const origin = new URL(baseUrl).origin;
  const states = new Map<string, { id: string; evidence: Evidence; depth: number }>();
  const transitions: { from: string; to: string; action: string }[] = []; const seenT = new Set<string>();
  let steps = 0;
  const idOf = (e: Evidence) => { const k = evKey(e); if (!states.has(k)) states.set(k, { id: 's' + states.size, evidence: e, depth: 0 }); return states.get(k)!.id; };

  try {
    while (steps < budget.maxSteps && Date.now() - t0 < budget.maxTimeMs) {
      const ctx = await browser.newContext({ viewport: cfg.viewport ?? { width: 1280, height: 720 } });
      await ctx.route(u => new URL(u.toString()).origin !== origin, r => r.abort());
      const page = await ctx.newPage(); page.on('dialog', d => d.accept().catch(() => {}));
      const tr = trackInflight(page);
      await page.goto(baseUrl + cfg.startPath).catch(() => {}); await tr.settle();
      let snap = await snapshot(page); let cur = idOf(snap.evidence);
      for (let i = 0; i < 20 && steps < budget.maxSteps && Date.now() - t0 < budget.maxTimeMs; i++) {
        const modal = snap.evidence.dialogs.length > 0;
        const cands = snap.interactive.filter(e => !e.disabled && (!modal || e.inModal) && !isBlocked(e.name, cfg) && (!e.href || e.href.startsWith(origin)) && e.target !== '_blank');
        const forms = snap.forms.filter(f => f.submit && (!modal || f.inModal) && !isBlocked(f.submit.name, cfg));
        const total = cands.length + forms.length; if (!total) break;
        const pick = Math.floor(rnd() * total); let label = '';
        try {
          if (pick < cands.length) {
            const e = cands[pick]; label = `click ${e.role} "${e.name}"`;
            await page.locator(e.css).first().click({ timeout: 1500 });
          } else {
            const f = forms[pick - cands.length]; label = `submit ${f.key}`;
            if (rnd() < 0.5) for (const fld of f.fields) { if (['text', 'email', 'password', 'textarea', 'search'].includes(fld.type)) await page.locator(fld.css).first().fill('random' + Math.floor(rnd() * 99), { timeout: 1000 }).catch(() => {}); }
            await page.locator(f.submit!.css).first().click({ timeout: 1500 });
          }
        } catch { steps++; continue; }
        steps++; await tr.settle();
        snap = await snapshot(page); const next = idOf(snap.evidence);
        const tk = cur + '>' + next + '>' + label; if (!seenT.has(tk)) { seenT.add(tk); transitions.push({ from: cur, to: next, action: label }); }
        cur = next;
        if (!page.url().startsWith(origin)) break;
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  return { explorer: `random(seed=${seed})`, states: [...states.values()], transitions, steps, ms: Date.now() - t0, costUsd: 0 };
}
