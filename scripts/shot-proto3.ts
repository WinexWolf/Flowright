import path from 'node:path'; import { chromium } from 'playwright';
const FILE = 'file://' + path.resolve('prototype2/index.html'); const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => { try { localStorage.setItem('fr2:seen', 'true'); localStorage.setItem('fr2:theme', '"light"'); } catch {} });
const p = await ctx.newPage(); await p.goto(FILE + '#home'); await p.waitForTimeout(300);
await p.click('#labrun'); await p.waitForSelector('#labopen:not([hidden])');                 // run 1: help, dead, wide
await p.click('.tg[data-bug=help]'); await p.click('.tg[data-bug=alt]'); await p.click('.tg[data-bug=look]');   // fix Help; add an accessibility problem and a visual change
await p.click('#labrun'); await p.waitForSelector('#labopen:not([hidden])'); await p.waitForTimeout(200);
await p.screenshot({ path: 'reports/proto2/new-hero.png' });
await p.goto(FILE + '#results'); await p.waitForTimeout(300); await p.screenshot({ path: 'reports/proto2/new-results.png', fullPage: true });
await p.goto(FILE + '#home'); await p.waitForTimeout(300); await p.click('#tab4'); await p.waitForTimeout(300); await p.locator('.tour').screenshot({ path: 'reports/proto2/new-tour.png' });
await b.close();
