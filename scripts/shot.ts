import { chromium } from 'playwright';
const [file, out, w, h, dark] = process.argv.slice(2);
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: Number(w), height: Number(h) }, colorScheme: dark === 'dark' ? 'dark' : 'light' })).newPage();
await p.goto('file://' + file); await p.waitForTimeout(600);
// open the first finding so the evidence and repro are visible in the screenshot
await p.evaluate(() => document.querySelector('details.finding')?.setAttribute('open', ''));
await p.screenshot({ path: out, fullPage: true }); console.log('ok'); await b.close();
