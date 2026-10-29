import path from 'node:path'; import { chromium } from 'playwright';
const FILE = 'file://' + path.resolve('prototype2/index.html'); const errs: string[] = [];
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => { try { localStorage.setItem('fr2:seen', 'true'); } catch {} });
const p = await ctx.newPage(); p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(FILE + '#home'); await p.waitForTimeout(600); await p.screenshot({ path: 'reports/proto2/landing-top.png' });
await p.click('#labrun'); await p.waitForTimeout(4200); await p.screenshot({ path: 'reports/proto2/lab-mid.png' });
await p.waitForSelector('#verdict .chip.bad', { timeout: 40000 }); await p.waitForFunction(() => !document.querySelector('#labopen')?.hasAttribute('hidden'), null, { timeout: 40000 }); await p.screenshot({ path: 'reports/proto2/lab-done.png' });
console.log('lab verdict:', await p.textContent('#verdict'), '| found:', (await p.$$eval('#found li', l => l.map(x => x.textContent))).join(' / '));
await p.screenshot({ path: 'reports/proto2/landing-full.png', fullPage: true });
for (const [h, n] of [['#results', 'results'], ['#finding-F2', 'finding'], ['#new', 'new'], ['#flows', 'flows'], ['#demos', 'demos'], ['#prefs', 'prefs']]) { await p.goto(FILE + h); await p.waitForTimeout(350); await p.screenshot({ path: `reports/proto2/${n}.png`, fullPage: true }); }
await p.goto(FILE + '#new'); await p.click('button[type=submit]'); await p.waitForSelector('#run-status'); await p.waitForTimeout(3800); await p.screenshot({ path: 'reports/proto2/running.png' });
await b.close(); console.log('errors:', errs.length ? errs.join('\n') : 'none');
