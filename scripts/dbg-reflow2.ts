import path from 'node:path'; import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 320, height: 640 } });
await ctx.addInitScript(() => { localStorage.setItem('fr2:size', '150'); localStorage.setItem('fr2:theme', '"light"'); localStorage.setItem('fr2:seen', 'true'); });
const p = await ctx.newPage();
for (const r of ['#home', '#new', '#results', '#finding-F1', '#flows', '#flow-checkout', '#demos', '#prefs']) {
  await p.goto('file://' + path.resolve('prototype2/index.html') + r); await p.waitForTimeout(300);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  const off = sw > 321 ? await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const b = e.getBoundingClientRect(); if (b.width === 0 || b.right <= innerWidth + 1) return false; let a = e.parentElement; while (a) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; a = a.parentElement; } return true; }).slice(0, 4).map(e => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} right=${Math.round(e.getBoundingClientRect().right)} "${(e.textContent || '').trim().slice(0, 22)}"`)) : [];
  console.log(r.padEnd(14), sw, off.join(' | '));
}
await b.close();
