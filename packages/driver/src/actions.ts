import type { Page } from 'playwright';
import type { Action, FieldSpec, TargetConfig, Variant } from '@flowright/core';

/** Deterministic form-value heuristics (an LLM replaces this in M3). */
export function valueFor(f: FieldSpec, variant: Variant, cfg: TargetConfig): string | null {
  if (variant === 'empty') return null;
  const t = f.type;
  if (variant === 'invalid') {
    if (t === 'email') return 'not-an-email';
    if (t === 'number') return '-1';
    return 'x';
  }
  const hay = `${f.name} ${f.label}`.toLowerCase();
  for (const [k, v] of Object.entries(cfg.formValues ?? {})) {
    if (f.name.toLowerCase() === k.toLowerCase() || t === k || hay.includes(k.toLowerCase())) return v;
  }
  if (t === 'email' || /e-?mail/.test(hay)) return 'test@example.com';
  if (t === 'password') return 'Password123!';
  if (t === 'tel' || /phone/.test(hay)) return '5551234567';
  if (t === 'number') return '1';
  if (t === 'date') return '2025-01-15';
  if (t === 'url') return 'https://example.com';
  if (/zip|postal/.test(hay)) return '94105';
  if (/card/.test(hay)) return '4242424242424242';
  if (/address|street/.test(hay)) return '1 Test Street';
  if (/name/.test(hay)) return 'Test User';
  if (/title|subject/.test(hay)) return 'Test item';
  if (/search|query|^q$/.test(hay)) return 'test';
  return 'test';
}

/** Role+name locator first (what a user sees), CSS path captured at discovery time as fallback. */
export async function locate(page: Page, a: { role: string; name: string; nth: number; css: string }) {
  if (a.name && a.role !== 'clickable') {        // role-less clickables have no ARIA role to query by
    const byRole = page.getByRole(a.role as Parameters<Page['getByRole']>[0], { name: a.name, exact: true });
    if (await byRole.count() > a.nth) return byRole.nth(a.nth);
  }
  return page.locator(a.css).first();
}

/** Perform one action and wait for the page to settle. Returns an error message, or null on success. No AI anywhere in this path. */
export interface PerformInfo { nativeBlocked?: boolean; settleTimedOut?: boolean }
export async function perform(page: Page, settle: () => Promise<unknown>, cfg: TargetConfig, a: Action, info: PerformInfo = {}): Promise<string | null> {
  try {
    if (a.kind === 'click') {
      await (await locate(page, a)).click({ timeout: 2500 });
    } else {
      for (const f of a.fields) {
        const loc = page.locator(f.css).first();
        if (f.type === 'select') { if (a.variant !== 'empty' && f.options?.length) await loc.selectOption({ index: 0 }, { timeout: 1500 }); continue; }
        if (f.type === 'checkbox' || f.type === 'radio') { if (a.variant === 'valid') await loc.check({ timeout: 1500 }).catch(() => {}); continue; }
        const v = valueFor(f, a.variant, cfg);
        if (v !== null) await loc.fill(v, { timeout: 1500 });
      }
      if (a.submit) {
        const btn = await locate(page, a.submit);
        // Is the browser's own validation (required / type=email / pattern) going to stop this submit? That is not a dead click.
        info.nativeBlocked = await btn.evaluate((el: Element) => { const f = (el as HTMLButtonElement).form; return !!f && !f.noValidate && !f.checkValidity(); }).catch(() => false);
        await btn.click({ timeout: 2500 });
      }
      else if (a.fields.length) await page.locator(a.fields[a.fields.length - 1].css).first().press('Enter', { timeout: 1500 });
    }
    info.settleTimedOut = (await settle()) === true;
    return null;
  } catch (e) { return String((e as Error).message).split('\n')[0].slice(0, 160); }
}
