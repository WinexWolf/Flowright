import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from 'playwright';
import type { A11yViolation, KeyboardIssue, StateChecks } from '@flowright/core';

const req = createRequire(import.meta.url);
let AXE_SRC: string | null = null;
const axeSource = () => (AXE_SRC ??= fs.readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8'));
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** WCAG 2.x A/AA violations on the page as it is RIGHT NOW (open dialogs, error banners, selected tabs included). axe's rules are conservative: a hit is a real failure. */
export async function runAxe(page: Page): Promise<A11yViolation[]> {
  const has = await page.evaluate('typeof window.axe !== "undefined"').catch(() => false);
  if (!has) await page.addScriptTag({ content: axeSource() });
  const res = await page.evaluate(`(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(WCAG)} }, resultTypes: ['violations'] });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: (v.nodes[0] && v.nodes[0].target || []).join(' ').slice(0, 120) }));
  })()`);
  return res as A11yViolation[];
}

const FOCUS_SCRIPT = `(() => {
  const e = document.activeElement; if (!e || e === document.body || e === document.documentElement) return null;
  const props = ['outlineStyle','outlineWidth','boxShadow','borderTopColor','borderBottomColor','backgroundColor','color','textDecorationLine','transform'];
  const snap = () => { const cs = getComputedStyle(e); return props.map(p => cs[p]).join('|'); };
  const cs = getComputedStyle(e);
  const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
  const focused = snap(); try { e.blur(); } catch (x) {} const blurred = snap(); try { e.focus({ focusVisible: true }); } catch (x) {}
  const text = ((e.getAttribute('aria-label') || e.textContent || e.getAttribute('name') || e.tagName) + '').replace(/\\s+/g, ' ').trim();
  return { key: (e.tagName + '#' + e.id + '.' + (e.className && e.className.baseVal === undefined ? e.className : '') + ':' + text).slice(0, 90), name: text.slice(0, 30), indicator: !!ring || focused !== blurred };
})()`;

const MOUSE_ONLY_SCRIPT = `(() => {
  const SEL = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio]';
  const cand = new Set();
  for (const e of [...document.querySelectorAll('div,span,li,td,img,svg,p,section,article')].slice(0, 1500)) {
    if (!e.hasAttribute('onclick') && getComputedStyle(e).cursor !== 'pointer') continue;
    if (e.checkVisibility && !e.checkVisibility()) continue;
    const r = e.getBoundingClientRect(); if (r.width < 8 || r.height < 8) continue;
    if (e.closest(SEL) || e.querySelector(SEL + ',[tabindex]') || e.tabIndex >= 0) continue;
    if (!((e.innerText || '').trim() || e.getAttribute('aria-label'))) continue;
    cand.add(e);
  }
  const top = [...cand].filter(e => { let p = e.parentElement; while (p) { if (cand.has(p)) return false; p = p.parentElement; } return true; });
  return { count: top.length, sample: top.slice(0, 3).map(e => ((e.innerText || e.getAttribute('aria-label') || '') + '').trim().slice(0, 24)) };
})()`;

/** Tab through the page like a keyboard user: is every stop visibly focused, can focus get stuck, are there clickable things a keyboard can't reach? */
export async function keyboardScan(page: Page, max = 40): Promise<KeyboardIssue[]> {
  await page.evaluate('(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, 0); })()');
  const seen = new Set<string>(); const noRing: string[] = []; let same = 0, last = '', trap = '';
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(FOCUS_SCRIPT) as { key: string; name: string; indicator: boolean } | null;
    if (!info) break;
    // Stuck check FIRST: an element we are still on has obviously been seen before, which is not the same as having cycled through the page.
    if (info.key === last) { if (++same >= 2) { trap = info.name; break; } continue; }
    same = 0; last = info.key;
    if (seen.has(info.key)) break;                           // cycled back to an earlier stop: the whole page was visited
    seen.add(info.key); if (!info.indicator) noRing.push(info.name);
  }
  const issues: KeyboardIssue[] = [];
  if (trap) issues.push({ kind: 'keyboard-trap', detail: `Keyboard focus gets stuck on “${trap}”: pressing Tab no longer moves on`, count: 1 });
  if (noRing.length) issues.push({ kind: 'no-focus-indicator', detail: `No visible focus indicator on ${noRing.length === 1 ? '1 control' : noRing.length + ' controls'}, for example “${noRing.slice(0, 3).join('”, “')}”`, count: noRing.length });
  const mouse = await page.evaluate(MOUSE_ONLY_SCRIPT) as { count: number; sample: string[] };
  if (mouse.count) issues.push({ kind: 'mouse-only', detail: `${mouse.count === 1 ? '1 clickable element is' : mouse.count + ' clickable elements are'} unreachable by keyboard, for example “${mouse.sample.join('”, “')}”`, count: mouse.count });
  return issues;
}

export async function scanPage(page: Page, o: { a11y?: boolean; keyboard?: boolean }): Promise<StateChecks> {
  return { a11y: o.a11y ? await runAxe(page).catch(() => []) : [], keyboard: o.keyboard ? await keyboardScan(page).catch(() => []) : [] };
}
