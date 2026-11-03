import path from 'node:path'; import { chromium } from 'playwright';
const FILE = 'file://' + path.resolve('prototype2/index.html'); const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => { try { if (localStorage.getItem('fr2:theme') === null) { localStorage.setItem('fr2:theme', '"light"'); localStorage.setItem('fr2:seen', 'true'); } } catch {} });
const p = await ctx.newPage(); const errs: string[] = []; p.on('pageerror', e => errs.push(e.message));
const ok = (c: boolean, m: string) => console.log((c ? 'ok   ' : 'FAIL ') + m);
await p.goto(FILE + '#ask'); await p.waitForTimeout(300);
// 1. a sentence the app can do
await p.click('[data-ex="0"]'); await p.click('[data-act=askrun]'); await p.waitForSelector('#ask-done', { timeout: 15000 });
const t1 = await p.innerText('#ask-out'); ok(/Reached in 3 steps/.test(t1) && /Place an order/.test(t1), 'cart sentence: reached in 3 steps (a 4th was a detour) and named "Place an order"'); ok(/Detour/.test(t1) && /Trimmed 1 detour/.test(t1), 'the wrong turn is shown and trimmed');
ok(/Rejected: not on the page/.test(t1) && /1 proposed check was thrown away/.test(t1), 'the made-up check ("Free shipping applied") is rejected');
await p.screenshot({ path: 'reports/proto2/ask-ok.png', fullPage: true });
await p.click('[data-act=addflow]'); await p.waitForSelector('#ask-s a'); ok(true, 'added to my flows');
// 2. a sentence the app cannot do: honest failure
await p.fill('#ask-text', ''); await p.click('[data-ex="3"]'); await p.click('[data-act=askrun]'); await p.waitForSelector('#ask-done:has-text("Couldn")', { timeout: 15000 });
const t2 = await p.innerText('#ask-out'); ok(/did not make up a flow/.test(t2) && !/Add to my flows/.test(t2), '"reset my password": fails honestly, offers no flow');
await p.screenshot({ path: 'reports/proto2/ask-fail.png', fullPage: false });
// 3. empty input
await p.fill('#ask-text', ''); await p.click('[data-act=askrun]'); ok(/Describe something/.test(await p.innerText('#ask-out')), 'empty input asks for a description');
// 4. flows: AI-found flow listed, AI naming panel
await p.goto(FILE + '#flows'); await p.waitForTimeout(200); ok((await p.innerText('#flowlist')).includes('Simulated AI'), 'the AI-found flow appears in Flows with a Simulated AI chip');
await p.click('[data-act=ainame]'); await p.waitForSelector('#ainame-done'); const t3 = await p.innerText('#ainame-out'); ok(/5 flows named\. 2 proposed checks were rejected/.test(t3), 'naming panel: 5 flows named, 2 invented checks rejected');
await p.screenshot({ path: 'reports/proto2/ai-name.png', fullPage: true });
await p.click('[data-act=aiapply]'); await p.waitForTimeout(200); ok((await p.innerText('#flowlist')).includes('Learn about the company'), 'applying the names renames the flows');
// 5. add your own break, then catch it
await p.goto(FILE + '#home'); await p.waitForTimeout(300); const before = await p.locator('.tg').count();
await p.click('#addbreak'); await p.waitForSelector('dialog[open]'); await p.selectOption('#bp', 'contact'); await p.selectOption('#bt', 'alt'); await p.click('dialog button[value=ok]'); await p.waitForTimeout(300);
ok((await p.locator('.tg').count()) === before + 1, 'a new toggle appears for the custom break'); ok((await p.innerText('.toggles')).includes('Image text on Contact'), 'it is named after what and where');
for (const k of ['help', 'dead', 'wide']) await p.click(`.tg[data-bug=${k}]`);
await p.click('#labrun'); await p.waitForSelector('#labopen:not([hidden])'); const found = await p.innerText('#found'); ok(/Image on Contact has no text description/.test(found), 'the lab run catches the custom break');
await p.goto(FILE + '#results'); await p.waitForTimeout(200); ok((await p.innerText('main')).includes('Image on Contact has no text description'), 'it shows in Results'); 
await p.click('a.row-link:has-text("Image on Contact")'); await p.waitForTimeout(300); ok(/image-alt/.test((await p.textContent('main')) ?? ''), 'its finding page has a runnable repro (axe image-alt)');
// 5b. accept a finding as known (this dialog used to never close on submit)
await p.goto(FILE + '#results'); await p.click('a.row-link:has-text("Image on Contact")'); await p.waitForTimeout(200); await p.click('[data-act=dismiss]'); await p.waitForSelector('dialog[open]'); await p.click('dialog button[value=ok]'); await p.waitForTimeout(400);
ok(!(await p.locator('dialog[open]').count()), 'the Accept dialog closes on submit'); ok(/Accepted/.test(await p.innerText('main')), 'the finding now shows as Accepted');
// 6. break the flow from the Ask result
await p.goto(FILE + '#ask'); await p.click('[data-ex="2"]'); await p.click('[data-act=askrun]'); await p.waitForSelector('#ask-done'); await p.click('[data-act=breakflow]'); await p.waitForSelector('dialog[open]'); ok((await p.inputValue('#bp')) === 'help', '"Break it…" opens the builder on the flow\'s last page'); await p.keyboard.press('Escape');
console.log(errs.length ? 'PAGE ERRORS: ' + errs.join('; ') : 'no page errors'); await b.close();
