// Accessibility audit of prototype2/index.html (landing page + app): axe-core WCAG 2.2 AA + best practice on every screen/theme/state, plus behavior checks.
import fs from 'node:fs'; import path from 'node:path';
import { chromium, type Page, type Browser } from 'playwright';
const FILE = 'file://' + path.resolve('prototype2/index.html'); const AXE = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const ROUTES = ['#home', '#new', '#results', '#finding-F1', '#flows', '#flow-checkout', '#demos', '#prefs'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']; const out: string[] = []; let failures = 0, passes = 0;
const log = (s: string) => { console.log(s); out.push(s); }; const fail = (s: string) => { failures++; log('  FAIL ' + s); };
async function open(b: Browser, o: { theme?: string; size?: number; w?: number; h?: number; motion?: 'reduce' | 'no-preference'; scheme?: 'light' | 'dark'; seen?: boolean } = {}) {
  const ctx = await b.newContext({ viewport: { width: o.w ?? 1280, height: o.h ?? 900 }, reducedMotion: o.motion ?? 'no-preference', colorScheme: o.scheme ?? 'light' });
  await ctx.addInitScript(([t, s, seen]) => { try { if (localStorage.getItem('fr2:theme') === null) { localStorage.setItem('fr2:theme', JSON.stringify(t)); localStorage.setItem('fr2:size', JSON.stringify(s)); if (seen) localStorage.setItem('fr2:seen', 'true'); } } catch { /* */ } }, [o.theme ?? 'light', o.size ?? 100, o.seen !== false] as const);
  return ctx.newPage();
}
async function axe(p: Page, label: string) {
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(async (tags) => { const x = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: tags } }); return { v: x.violations.map((v: any) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 2).map((n: any) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 3).join(' ')) })), passes: x.passes.length }; }, TAGS);
  passes += r.passes; if (r.v.length) { failures += r.v.length; log(`  FAIL ${label}: ${r.v.map((v: any) => `${v.id}(${v.n})`).join(', ')}`); for (const v of r.v) log(`       ${v.impact} ${v.id}: ${v.help}\n         ${v.sample.join('\n         ')}`); } return r;
}
const go = async (p: Page, h: string) => { await p.goto(FILE + h); await p.waitForTimeout(300); };
const b = await chromium.launch();

log('== 1. axe-core on every screen x every theme');
for (const theme of ['light', 'dark', 'contrast']) { const p = await open(b, { theme, scheme: theme === 'dark' ? 'dark' : 'light' }); const before = failures;
  for (const r of ROUTES) { await go(p, r); await axe(p, `${theme} ${r}`); } log(`  ${theme}: ${ROUTES.length} screens, ${failures === before ? 'no violations' : failures - before + ' violation(s)'}`); await p.context().close(); }
{ const p = await open(b, { theme: 'system', scheme: 'dark' }); for (const r of ['#home', '#results']) { await go(p, r); await axe(p, `system-dark ${r}`); } await p.context().close(); }

log('== 2. interactive and animated states');
for (const theme of ['light', 'dark', 'contrast']) {
  const p = await open(b, { theme, scheme: theme === 'dark' ? 'dark' : 'light', motion: 'reduce' });
  await go(p, '#home'); await p.click('#labrun'); await p.waitForSelector('#labopen:not([hidden])'); await axe(p, `${theme} lab finished (all problems shown)`);
  await p.click('.tg[data-bug=help]'); await axe(p, `${theme} lab toggle flipped`);
  for (let i = 1; i < 4; i++) { await p.click('#tab' + i); await p.waitForTimeout(250); await axe(p, `${theme} tour tab ${i + 1}`); }
  await go(p, '#new'); await p.fill('#url', 'example.com'); await p.check('input[value=goal]'); await p.click('button[type=submit]'); await p.waitForTimeout(150); await axe(p, `${theme} form error state`);
  await go(p, '#finding-F1'); await p.click('[data-act=dismiss]'); await p.waitForSelector('dialog[open]'); await axe(p, `${theme} dismiss dialog`); await p.keyboard.press('Escape');
  await go(p, '#demos'); await p.click('[data-seg="1"]'); await axe(p, `${theme} demo timeline step`);
  await p.context().close();
}
{ const p = await open(b, { theme: 'light' }); await go(p, '#home'); await p.click('#labrun'); await p.waitForTimeout(2600); await axe(p, 'light lab MID-RUN (cursor moving, map drawing)'); await p.context().close(); }
{ const p = await open(b, { theme: 'light' }); await go(p, '#new'); await p.click('button[type=submit]'); await p.waitForSelector('#run-status'); await p.waitForTimeout(3000); await axe(p, 'light running screen mid-run');
  await p.click('[data-act=cancel]'); await p.waitForSelector('dialog[open]'); await axe(p, 'light cancel dialog'); await p.keyboard.press('Escape');
  await p.waitForSelector('text=Check complete', { timeout: 40000 }); await axe(p, 'light running screen complete'); await p.context().close(); }

log('== 3. keyboard, focus and screen-reader behavior');
{ const p = await open(b); await go(p, '#results');
  await p.keyboard.press('Tab'); (await p.evaluate(() => document.activeElement?.textContent?.trim())) === 'Skip to main content' ? log('  ok   first Tab stop is the skip link') : fail('first Tab stop is not the skip link');
  await p.keyboard.press('Enter'); (await p.evaluate(() => document.activeElement?.id)) === 'main' ? log('  ok   skip link moves focus to main content') : fail('skip link did not focus main');
  await p.click('.site nav a[data-nav=flows]'); await p.waitForTimeout(200); const f = await p.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.textContent?.trim());
  f === 'H1:Flows' ? log('  ok   after navigating, focus lands on the new page heading') : fail('after navigation focus is ' + f);
  (await p.title()) === 'Flows - Flowright' ? log('  ok   document title updates per screen') : fail('title: ' + await p.title());
  (await p.evaluate(() => document.querySelector('[data-nav=flows]')?.getAttribute('aria-current'))) === 'page' ? log('  ok   current nav item has aria-current="page"') : fail('aria-current missing');
  await go(p, '#results'); let n = 0; const noRing: string[] = [];
  for (let i = 0; i < 60; i++) { await p.keyboard.press('Tab'); const r = await p.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const svg = e.closest('svg a') ? getComputedStyle(e.querySelector('.focusring')!).stroke : ''; return { name: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, svg: !!svg && svg !== 'none' && svg !== 'rgba(0, 0, 0, 0)' }; }); if (!r) break; n++; if (!r.outline && !r.svg) noRing.push(r.name); }
  noRing.length === 0 ? log(`  ok   all ${n} tab stops on Results show a focus indicator`) : fail('no focus indicator on: ' + noRing.join('; '));
  await p.context().close(); }
{ const p = await open(b); await go(p, '#home'); await p.focus('#tab0');
  await p.keyboard.press('ArrowDown'); const a = await p.evaluate(() => ({ sel: document.querySelector('#tab1')?.getAttribute('aria-selected'), foc: document.activeElement?.id }));
  a.sel === 'true' && a.foc === 'tab1' ? log('  ok   tabs: ArrowDown selects and focuses the next tab') : fail('ArrowDown on tabs: ' + JSON.stringify(a));
  await p.keyboard.press('End'); (await p.evaluate(() => document.activeElement?.id)) === 'tab3' ? log('  ok   tabs: End jumps to the last tab') : fail('End key');
  await p.keyboard.press('Home'); (await p.evaluate(() => document.activeElement?.id)) === 'tab0' ? log('  ok   tabs: Home jumps to the first tab') : fail('Home key');
  (await p.evaluate(() => ({ r: document.querySelector('#stage')?.getAttribute('role'), l: document.querySelector('#stage')?.getAttribute('aria-labelledby') }))).l === 'tab0' ? log('  ok   tab panel is labelled by its tab') : fail('tabpanel label');
  await p.context().close(); }
{ const p = await open(b); await go(p, '#home');
  await p.focus('.tg[data-bug=about]'); await p.keyboard.press('Space'); (await p.getAttribute('.tg[data-bug=about]', 'aria-pressed')) === 'true' ? log('  ok   lab toggles work from the keyboard (Space) and expose aria-pressed') : fail('toggle via keyboard');
  await p.focus('#labrun'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  (await p.isDisabled('#labrun')) && !(await p.isDisabled('#labpause')) ? log('  ok   Run check starts from the keyboard; Pause becomes available') : fail('run/pause state');
  (await p.isDisabled('.tg[data-bug=help]')) ? log('  ok   toggles are locked while a run is in progress (no mid-run surprises)') : fail('toggles not locked during run');
  await p.focus('#labpause'); await p.keyboard.press('Enter'); (await p.getAttribute('#labpause', 'aria-pressed')) === 'true' && /Resume/.test(await p.textContent('#labpause') ?? '') ? log('  ok   animation can be paused and resumed (WCAG 2.2.2)') : fail('pause control');
  const d0 = await p.evaluate(() => document.querySelectorAll('#labmap .st.on').length); await p.waitForTimeout(1800); const d1 = await p.evaluate(() => document.querySelectorAll('#labmap .st.on').length);
  d0 === d1 ? log('  ok   while paused, the map genuinely stops advancing') : fail(`paused run still advanced (${d0} -> ${d1})`);
  await p.context().close(); }
{ const p = await open(b, { seen: false }); await go(p, '#home'); await p.waitForTimeout(2400);
  (await p.isDisabled('#labrun')) && !(await p.isDisabled('#labpause')) ? log('  ok   first visit: the demo starts by itself, and the Pause control is already there') : fail('autoplay/pause');
  await p.context().close(); }
{ const p = await open(b, { motion: 'reduce' }); await go(p, '#home'); await p.click('#labrun'); await p.waitForSelector('#labopen:not([hidden])', { timeout: 3000 }).then(() => log('  ok   prefers-reduced-motion: the lab finishes instantly instead of animating'), () => fail('reduced motion lab did not finish quickly'));
  await p.waitForTimeout(300); const t = await p.textContent('#live'); /problems? found/.test(t ?? '') ? log('  ok   the result is announced to screen readers (aria-live)') : fail('live region says: ' + t); await p.context().close(); }
{ const p = await open(b); await go(p, '#finding-F1'); await p.focus('[data-act=dismiss]'); await p.keyboard.press('Enter'); await p.waitForSelector('dialog[open]');
  (await p.evaluate(() => !!document.activeElement?.closest('dialog'))) ? log('  ok   dialog: focus moves inside') : fail('focus not in dialog');
  for (let i = 0; i < 8; i++) await p.keyboard.press('Tab'); (await p.evaluate(() => !!document.activeElement?.closest('dialog'))) ? log('  ok   dialog: Tab stays trapped inside') : fail('focus escaped dialog');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150); (await p.evaluate(() => document.activeElement?.getAttribute('data-act'))) === 'dismiss' ? log('  ok   dialog: Escape closes it and returns focus to the opener') : fail('focus not returned'); await p.context().close(); }
{ const p = await open(b); await go(p, '#new'); await p.fill('#url', 'example.com'); await p.click('button[type=submit]'); await p.waitForTimeout(150);
  (await p.evaluate(() => document.activeElement?.id)) === 'errsum' ? log('  ok   form errors: focus moves to the summary') : fail('focus not on error summary');
  (await p.$('[role=alert]')) ? log('  ok   form errors: announced with role=alert') : fail('no role=alert');
  (await p.evaluate(() => document.getElementById('url')?.getAttribute('aria-invalid'))) === 'true' ? log('  ok   form errors: field marked aria-invalid') : fail('aria-invalid');
  await p.click('#errsum a'); (await p.evaluate(() => document.activeElement?.id)) === 'url' ? log('  ok   form errors: summary links jump to the field') : fail('jump link'); await p.context().close(); }
{ const p = await open(b); await go(p, '#home'); const before = await p.evaluate(() => document.documentElement.dataset.theme); await p.click('#themebtn'); const after = await p.evaluate(() => document.documentElement.dataset.theme);
  before !== after && /Color theme/.test(await p.getAttribute('#themebtn', 'aria-label') ?? '') ? log('  ok   the theme button cycles themes and announces the current one in its label') : fail('theme button'); await p.context().close(); }

log('== 4. reflow at 320 px wide with 150% text, and touch targets');
for (const size of [100, 150]) { const p = await open(b, { w: 320, h: 640, size }); const wide: string[] = [];
  for (const r of ROUTES) { await go(p, r); const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); if (w.sw > w.cw + 1) wide.push(`${r} (${w.sw}px)`); }
  wide.length === 0 ? log(`  ok   320 px wide at ${size}% text: no sideways page scroll on any of ${ROUTES.length} screens`) : fail(`320px/${size}% overflows: ${wide.join(', ')}`); await p.context().close(); }
{ const p = await open(b); const small: string[] = [];
  for (const r of ['#home', '#new', '#results', '#flows', '#demos', '#prefs']) { await go(p, r);
    const s = await p.evaluate(() => [...document.querySelectorAll('button,.btn,select,input:not([type=checkbox]):not([type=radio]):not([type=range]),.site nav a,.choice,.switch,.mode,.tg,.tab,.seg-btn,.sw,.row-link,.lcard')].filter(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e as HTMLElement).offsetParent !== null; }).map(e => { const r = (e as HTMLElement).getBoundingClientRect(); return { n: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.h < 44 || x.w < 44));
    s.forEach(x => small.push(`${r} "${x.n}" ${x.w}x${x.h}`)); }
  small.length === 0 ? log('  ok   every button, field, nav item, toggle and choice is at least 44 x 44 px') : fail('targets under 44px: ' + small.slice(0, 8).join('; ')); await p.context().close(); }

log('== 5. settings really change the page, and controls scale with text size');
{ const p = await open(b); await go(p, '#prefs'); await p.check('input[name=theme][value=contrast]'); await p.waitForTimeout(100);
  (await p.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(0, 0, 0)' ? log('  ok   High contrast theme applies') : fail('contrast theme');
  await p.click('details summary'); const rows = await p.evaluate(() => [...document.querySelectorAll('#audit tr')].map(r => r.textContent!.replace(/\s+/g, ' ').trim())); const bad = rows.filter(r => /Fails/.test(r));
  bad.length === 0 ? log(`  ok   live contrast table: all ${rows.length} pairs pass in the current theme`) : fail('contrast table: ' + bad.join(' | '));
  await p.check('input[name=size][value="150"]'); (await p.evaluate(() => getComputedStyle(document.documentElement).fontSize)) === '24px' ? log('  ok   Text size 150% applies') : fail('text size');
  await p.check('#s-motion'); (await p.evaluate(() => document.documentElement.dataset.motion)) === 'reduce' ? log('  ok   Reduce motion applies') : fail('motion');
  await p.reload(); await p.waitForTimeout(200); (await p.evaluate(() => document.documentElement.dataset.theme)) === 'contrast' ? log('  ok   settings persist after reload') : fail('persist'); await p.context().close(); }
for (const size of [100, 150]) { const p = await open(b, { size }); const bad: string[] = [];
  for (const r of ['#home', '#new', '#results', '#finding-F1', '#flows', '#demos', '#prefs']) { await go(p, r);
    const s = await p.evaluate(() => { const root = parseFloat(getComputedStyle(document.documentElement).fontSize); return [...document.querySelectorAll('button,.btn,input[type=text],input[type=search],select')].filter(e => (e as HTMLElement).offsetParent !== null).map(e => ({ n: (e.textContent || e.id || e.tagName).trim().slice(0, 24), f: parseFloat(getComputedStyle(e).fontSize), root })).filter(x => x.f < x.root * 0.99); });
    s.forEach(x => bad.push(`${r} "${x.n}" ${x.f}px`)); }
  bad.length === 0 ? log(`  ok   at ${size}% every control is at least the base text size`) : fail(`controls smaller than body text at ${size}%: ${bad.slice(0, 6).join('; ')}`); await p.context().close(); }

log('== 6. screenshots');
const shots: [string, any, string][] = [['final-landing', { theme: 'light' }, '#home'], ['final-landing-dark', { theme: 'dark', scheme: 'dark' }, '#home'], ['final-results-contrast', { theme: 'contrast' }, '#results'], ['final-home-mobile', { theme: 'light', w: 390, h: 844 }, '#home'], ['final-results-mobile', { theme: 'light', w: 390, h: 844 }, '#results']];
for (const [name, o, r] of shots) { const p = await open(b, o); await go(p, r); await p.screenshot({ path: `reports/proto2/${name}.png`, fullPage: true }); await p.context().close(); }
await b.close(); log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'}  (${passes} axe rule passes across screens and states)`);
fs.writeFileSync('reports/proto2/audit.txt', out.join('\n')); process.exit(failures ? 1 : 0);
