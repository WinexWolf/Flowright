import path from 'node:path'; import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 320, height: 640 } });
await ctx.addInitScript(() => { localStorage.setItem('fr:size', '150'); localStorage.setItem('fr:theme', '"light"'); });
const p = await ctx.newPage();
for (const r of ['#new', '#results', '#finding-F1', '#flows', '#flow-checkout', '#demos-checkout', '#prefs']) {
  await p.goto('file://' + path.resolve('prototype/index.html') + r); await p.waitForTimeout(250);
  const off = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const b = e.getBoundingClientRect(); if (b.width === 0 || b.right <= innerWidth + 1) return false; let a = e.parentElement; while (a) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return false; a = a.parentElement; } return true; }).slice(0, 6).map(e => `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''} right=${Math.round(e.getBoundingClientRect().right)} w=${Math.round(e.getBoundingClientRect().width)} "${(e.textContent || '').trim().slice(0, 28)}"`));
  console.log(r, 'scrollWidth', await p.evaluate(() => document.documentElement.scrollWidth), '\n  ', off.join('\n   '));
}
await b.close();
