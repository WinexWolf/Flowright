import type { Browser, BrowserContext, Page } from 'playwright';
import type { Obs, TargetConfig } from '@flowright/core';
import { trackInflight } from './snapshot.js';

export interface Session { ctx: BrowserContext; page: Page; tr: ReturnType<typeof trackInflight>; obs: Obs; requests: number; resetObs: () => void }
export const freshObs = (): Obs => ({ consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], noEffect: false });

/**
 * One isolated browser session: fresh context (so the target sees a brand-new visitor), same-host containment,
 * auto-accepted dialogs, popups closed, and observation of console/page errors and failed/bad responses.
 * Used by BOTH the crawler and the replayer so replay can't diverge from exploration.
 */
export async function openSession(browser: Browser, baseUrl: string, cfg: TargetConfig): Promise<Session> {
  const allowed = new Set([new URL(baseUrl).host, ...(cfg.allowedHosts ?? [])]);
  const ctx = await browser.newContext({ viewport: cfg.viewport ?? { width: 1280, height: 720 }, storageState: cfg.storageState });
  await ctx.route(u => !allowed.has(new URL(u.toString()).host), r => r.abort());
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  const s: Session = { ctx, page, tr: trackInflight(page), obs: freshObs(), requests: 0, resetObs() { s.obs = freshObs(); } };
  page.on('request', () => { s.requests++; });
  page.on('console', m => { if (m.type() === 'error') s.obs.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => s.obs.pageErrors.push(String(e.message).slice(0, 300)));
  page.on('requestfailed', r => { if (allowed.has(new URL(r.url()).host)) s.obs.failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`); });
  page.on('response', r => { const t = r.request().resourceType(); if (r.status() >= 400 && ['document', 'xhr', 'fetch'].includes(t)) s.obs.badResponses.push(`${r.status()} ${t} ${r.url()}`); });
  page.on('popup', p => { p.close().catch(() => {}); });
  return s;
}
