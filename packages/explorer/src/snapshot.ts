import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import type { PageSnapshot } from '@flowright/core';

const SCRIPT = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'extract.browser.js'), 'utf8');

/** Extract a PageSnapshot; retries once if a navigation destroys the execution context mid-read. */
export async function snapshot(page: Page): Promise<PageSnapshot> {
  for (let i = 0; ; i++) {
    try { return (await page.evaluate(SCRIPT)) as PageSnapshot; }
    catch (e) {
      if (i >= 2) throw e;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(100);
    }
  }
}

// Injected before any page script runs. Records the time of the last DOM mutation so settle() can wait for the UI to stop changing.
// (A plain string, not a function: transpiler helpers must not leak into page.evaluate/addInitScript.)
const MUTATION_PROBE = `(() => {
  window.__frLastMut = Date.now();
  const bump = () => { window.__frLastMut = Date.now(); };
  new MutationObserver(bump).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
})();`;

/**
 * Wait-for-quiet tracker. A page is "settled" when (a) no requests are in flight, (b) the network has been quiet, AND
 * (c) the DOM has stopped mutating, all for quietMs. The settle() call itself counts as activity, so async work that is
 * about to START after an action (e.g. a SPA hashchange handler that fetches data) is still inside the quiet window.
 * Network-only settling caused stale snapshots on single-page apps, which showed up as replay drift.
 */
export function trackInflight(page: Page) {
  let inflight = 0; let lastActivity = Date.now();
  const bump = () => { lastActivity = Date.now(); };
  page.addInitScript(MUTATION_PROBE).catch(() => {});
  page.on('request', () => { inflight++; bump(); });
  page.on('requestfinished', () => { inflight = Math.max(0, inflight - 1); bump(); });
  page.on('requestfailed', () => { inflight = Math.max(0, inflight - 1); bump(); });
  return {
    get inflight() { return inflight; },
    async settle(quietMs = 150, maxMs = 4000) {
      const start = Date.now(); bump();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      while (Date.now() - start < maxMs) {
        let domQuiet = true;
        try { domQuiet = (await page.evaluate(`Date.now() - (window.__frLastMut || 0)`) as number) >= quietMs; } catch { domQuiet = false; }   // mid-navigation: not quiet
        if (inflight === 0 && Date.now() - lastActivity >= quietMs && domQuiet) return;
        await page.waitForTimeout(40);
      }
    },
  };
}
