import type { Browser, BrowserContext, Page } from 'playwright';
import type { Obs, TargetConfig } from '@flowright/core';
import { trackInflight } from './snapshot.js';

export interface Session { ctx: BrowserContext; page: Page; tr: ReturnType<typeof trackInflight>; obs: Obs; requests: number; resetObs: () => void }
export const freshObs = (): Obs => ({ consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], noEffect: false });

/** Browser-context options for a target: desktop by default, or a phone-sized touch device. */
export function contextOptionsFor(cfg: TargetConfig) {
  const base = cfg.device === 'mobile'
    ? { viewport: cfg.viewport ?? { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: cfg.viewport ?? { width: 1280, height: 720 } };
  return { ...base, storageState: cfg.storageState };
}

const resolveSecret = (v: string) => v.replace(/\$\{ENV:([A-Za-z0-9_]+)\}/g, (_m, n: string) => {
  const x = process.env[n]; if (x === undefined) throw new Error(`auth: environment variable ${n} is not set`); return x;
});

/** Apps with a shared database need a known starting point: POST the reset URL before every fresh session. A missing endpoint never breaks a run. */
export async function resetTarget(baseUrl: string, cfg: TargetConfig): Promise<void> {
  if (!cfg.resetUrl) return;
  try { await fetch(new URL(cfg.resetUrl, baseUrl), { method: 'POST' }); } catch { /* ignore */ }
}

/**
 * Log in as part of SESSION SETUP (not as a recorded step): every fresh context starts authenticated, so replay stays deterministic
 * and no session leaks state into another. Fails loudly: silently crawling logged-out would produce a misleading "all clear".
 */
export async function loginIfNeeded(page: Page, baseUrl: string, cfg: TargetConfig, settle: () => Promise<unknown>): Promise<void> {
  const a = cfg.auth; if (!a) return;
  await page.goto(baseUrl + a.loginPath).catch(() => {}); await settle();
  const entries = Object.entries(a.fields);
  for (const [name, raw] of entries) {
    let loc = page.locator(`[name="${name}"]`).first();
    if (!(await loc.count())) loc = page.getByLabel(name).first();
    await loc.fill(resolveSecret(raw), { timeout: 4000 });
  }
  if (a.submit) await page.getByRole('button', { name: a.submit, exact: true }).first().click({ timeout: 4000 });
  else await page.locator(`[name="${entries[entries.length - 1][0]}"]`).first().press('Enter', { timeout: 4000 });
  await settle();
  if (a.successPath && !page.url().includes(a.successPath)) throw new Error(`auth: after logging in the page is ${page.url()}, expected it to contain “${a.successPath}”. Check the credentials and field names in your config.`);
  if (a.successText && !(await page.getByText(a.successText).first().isVisible().catch(() => false))) throw new Error(`auth: login did not show “${a.successText}”`);
}

/**
 * One isolated browser session: fresh context (so the target sees a brand-new visitor), same-host containment,
 * dialog policy, popups closed, and observation of console/page errors and failed/bad responses.
 * Used by the crawler, the replayer and the agent so replay can't diverge from exploration.
 */
export async function openSession(browser: Browser, baseUrl: string, cfg: TargetConfig): Promise<Session> {
  const allowed = new Set([new URL(baseUrl).host, ...(cfg.allowedHosts ?? [])]);
  await resetTarget(baseUrl, cfg);
  const ctx = await browser.newContext(contextOptionsFor(cfg));
  await ctx.route(u => !allowed.has(new URL(u.toString()).host), r => r.abort());
  const page = await ctx.newPage();
  // confirm()/prompt() dialogs: accepting is how a flow proceeds, but it can also confirm a destructive action, so only sandbox targets accept.
  page.on('dialog', d => (cfg.sandbox ? d.accept() : d.dismiss()).catch(() => {}));
  const s: Session = { ctx, page, tr: trackInflight(page), obs: freshObs(), requests: 0, resetObs() { s.obs = freshObs(); } };
  page.on('request', () => { s.requests++; });
  page.on('console', m => { if (m.type() === 'error') s.obs.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => s.obs.pageErrors.push(String(e.message).slice(0, 300)));
  page.on('requestfailed', r => { if (allowed.has(new URL(r.url()).host)) s.obs.failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`); });
  page.on('response', r => { const t = r.request().resourceType(); if (r.status() >= 400 && ['document', 'xhr', 'fetch'].includes(t)) s.obs.badResponses.push(`${r.status()} ${t} ${r.url()}`); });
  page.on('popup', p => { p.close().catch(() => {}); });
  if (cfg.auth) {
    try { await loginIfNeeded(page, baseUrl, cfg, () => s.tr.settle()); }
    catch (e) { await ctx.close().catch(() => {}); throw e; }
    s.requests = 0; s.resetObs();                       // login traffic is setup, not part of any flow
  }
  return s;
}

/** Log in once in a throwaway context and return its storage state, so recordings (videos, demos) start authenticated WITHOUT showing the login. */
export async function authenticatedState(browser: Browser, baseUrl: string, cfg: TargetConfig) {
  if (!cfg.auth) return cfg.storageState;
  await resetTarget(baseUrl, cfg);
  const ctx = await browser.newContext(contextOptionsFor({ ...cfg, storageState: undefined }));
  try { const page = await ctx.newPage(); const tr = trackInflight(page); await loginIfNeeded(page, baseUrl, cfg, () => tr.settle()); return await ctx.storageState(); }
  finally { await ctx.close().catch(() => {}); }
}
