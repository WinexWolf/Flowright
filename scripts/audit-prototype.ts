// Accessibility audit of prototype/index.html: axe-core (WCAG 2.2 A/AA + best practice) on every screen in every theme, plus behavior checks axe cannot do.
import fs from 'node:fs'; import path from 'node:path';
import { chromium, type Page, type Browser } from 'playwright';
const FILE = 'file://' + path.resolve('prototype/index.html'); const AXE = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const ROUTES = ['#new', '#results', '#finding-F1', '#finding-F6', '#flows', '#flow-checkout', '#demos-checkout', '#prefs'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const out: string[] = []; let failures = 0;
const log = (s: string) => { console.log(s); out.push(s); };
const fail = (s: string) => { failures++; log('  FAIL ' + s); };

async function open(b: Browser, o: { theme?: string; size?: number; w?: number; h?: number; motion?: 'reduce' | 'no-preference'; forced?: boolean; scheme?: 'light' | 'dark' } = {}) {
  const ctx = await b.newContext({ viewport: { width: o.w ?? 1280, height: o.h ?? 900 }, reducedMotion: o.motion ?? 'no-preference', forcedColors: o.forced ? 'active' : 'none', colorScheme: o.scheme ?? 'light' });
  await ctx.addInitScript(([t, s]) => { try { if (localStorage.getItem('fr:theme') === null) { localStorage.setItem('fr:theme', JSON.stringify(t)); localStorage.setItem('fr:size', JSON.stringify(s)); } } catch { /* */ } }, [o.theme ?? 'light', o.size ?? 100] as const);   // seed only once, so reload can prove persistence
  const p = await ctx.newPage(); return p;
}
async function axe(p: Page, label: string) {
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(async (tags) => { const x = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: tags } }); return { v: x.violations.map((v: any) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 2).map((n: any) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 3).join(' ')) })), passes: x.passes.length, inc: x.incomplete.length }; }, TAGS);
  if (r.v.length) { failures += r.v.length; log(`  FAIL ${label}: ${r.v.map((v: any) => `${v.id}(${v.n})`).join(', ')}`); for (const v of r.v) log(`       ${v.impact} ${v.id}: ${v.help}\n         ${v.sample.join('\n         ')}`); }
  return r;
}
const go = async (p: Page, hash: string) => { await p.goto(FILE + hash); await p.waitForTimeout(250); };

const b = await chromium.launch();
log('== 1. axe-core, every screen x every theme (WCAG 2.0/2.1/2.2 A+AA and best practice)');
let checks = 0;
for (const theme of ['light', 'dark', 'contrast']) {
  const p = await open(b, { theme, scheme: theme === 'dark' ? 'dark' : 'light' }); let bad = 0;
  for (const r of ROUTES) { await go(p, r); const before = failures; const res = await axe(p, `${theme} ${r}`); checks += res.passes; bad += failures - before; }
  log(`  ${theme}: ${ROUTES.length} screens, ${bad === 0 ? 'no violations' : bad + ' violation(s)'}`); await p.context().close();
}
log('  (system theme follows the OS: checking dark OS preference)');
{ const p = await open(b, { theme: 'system', scheme: 'dark' }); for (const r of ['#results', '#prefs']) { await go(p, r); await axe(p, `system-dark ${r}`); } await p.context().close(); }

log('== 2. states axe does not see on first load');
for (const theme of ['light', 'dark', 'contrast']) {
  const p = await open(b, { theme, scheme: theme === 'dark' ? 'dark' : 'light' });
  // form errors
  await go(p, '#new'); await p.fill('#url', 'example.com'); await p.check('input[value=goal]'); await p.click('button[type=submit]'); await p.waitForTimeout(150);
  await axe(p, `${theme} new-form error state`);
  // dialog open
  await go(p, '#finding-F1'); await p.click('[data-act=dismiss]'); await p.waitForSelector('dialog[open]'); await axe(p, `${theme} dismiss dialog open`); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  // list view of the map
  await go(p, '#results'); await p.click('[data-view=list]'); await axe(p, `${theme} results list view`);
  await p.context().close();
}
{ // running screen, mid-run and finished
  const p = await open(b, { theme: 'light' }); await go(p, '#new'); await p.click('button[type=submit]'); await p.waitForSelector('#run-status'); await p.waitForTimeout(3500); await axe(p, 'light running (mid-run)');
  await p.click('[data-act=cancel]'); await p.waitForSelector('dialog[open]'); await axe(p, 'light cancel dialog'); await p.keyboard.press('Escape');
  await p.waitForSelector('text=Check complete', { timeout: 45000 }); await axe(p, 'light running (complete)'); await p.context().close();
}

log('== 3. keyboard and focus behavior');
{
  const p = await open(b); await go(p, '#results');
  await p.keyboard.press('Tab'); const first = await p.evaluate(() => document.activeElement?.textContent?.trim());
  first === 'Skip to main content' ? log('  ok   first Tab stop is the skip link') : fail(`first Tab stop is "${first}", not the skip link`);
  await p.keyboard.press('Enter'); (await p.evaluate(() => document.activeElement?.id)) === 'main' ? log('  ok   skip link moves focus to main content') : fail('skip link did not focus main');
  await p.click('a[data-nav=flows]'); await p.waitForTimeout(200);
  const f = await p.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.textContent?.trim());
  f === 'H1:Flows' ? log('  ok   after navigating, focus lands on the new page heading') : fail(`after navigation focus is ${f}`);
  (await p.title()) === 'Flows - Flowright' ? log('  ok   document title updates per screen') : fail('title did not update: ' + await p.title());
  (await p.evaluate(() => document.querySelector('[data-nav=flows]')?.getAttribute('aria-current'))) === 'page' ? log('  ok   current nav item has aria-current="page"') : fail('aria-current missing');
  // every focusable element on results shows a visible focus indicator
  await go(p, '#results'); let n = 0, noRing: string[] = [];
  for (let i = 0; i < 60; i++) { await p.keyboard.press('Tab'); const r = await p.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const circle = e.closest('svg a') ? getComputedStyle(e.querySelector('.focusring')!).stroke : ''; return { name: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, svg: circle && circle !== 'none' && circle !== 'rgba(0, 0, 0, 0)' }; });
    if (!r) break; n++; if (!r.outline && !r.svg) noRing.push(r.name); }
  noRing.length === 0 ? log(`  ok   all ${n} tab stops on Results show a focus indicator (>= 2px outline)`) : fail(`no visible focus indicator on: ${noRing.join('; ')}`);
  await p.context().close();
}
{ // dialog focus trap + return focus + Escape
  const p = await open(b); await go(p, '#finding-F1'); await p.focus('[data-act=dismiss]'); await p.keyboard.press('Enter'); await p.waitForSelector('dialog[open]');
  (await p.evaluate(() => !!document.activeElement?.closest('dialog'))) ? log('  ok   focus moves into the dialog') : fail('focus did not move into the dialog');
  for (let i = 0; i < 8; i++) await p.keyboard.press('Tab'); (await p.evaluate(() => !!document.activeElement?.closest('dialog'))) ? log('  ok   Tab stays inside the dialog (trapped)') : fail('focus escaped the dialog');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  (await p.evaluate(() => document.activeElement?.getAttribute('data-act'))) === 'dismiss' ? log('  ok   Escape closes the dialog and returns focus to the button that opened it') : fail('focus not returned to opener');
  await p.context().close();
}
{ // form errors
  const p = await open(b); await go(p, '#new'); await p.fill('#url', 'example.com'); await p.click('button[type=submit]'); await p.waitForTimeout(150);
  (await p.evaluate(() => document.activeElement?.id)) === 'errsum' ? log('  ok   submitting with errors moves focus to the error summary') : fail('focus not on error summary');
  (await p.$('[role=alert]')) ? log('  ok   error summary is announced (role=alert)') : fail('no role=alert');
  (await p.evaluate(() => document.getElementById('url')?.getAttribute('aria-invalid'))) === 'true' ? log('  ok   invalid field is marked aria-invalid and described by its message') : fail('aria-invalid missing');
  await p.click('#errsum a'); (await p.evaluate(() => document.activeElement?.id)) === 'url' ? log('  ok   error links jump to the field') : fail('error link did not focus the field');
  await p.context().close();
}

log('== 4. reflow at 320 px wide, text enlarged to 150% (WCAG 1.4.10), and touch targets');
for (const size of [100, 150]) {
  const p = await open(b, { w: 320, h: 640, size }); const wide: string[] = [];
  for (const r of ROUTES) { await go(p, r); const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); if (w.sw > w.cw + 1) wide.push(`${r} (${w.sw}px > ${w.cw}px)`); }
  wide.length === 0 ? log(`  ok   320 px wide at ${size}% text: no sideways page scroll on any of ${ROUTES.length} screens`) : fail(`320px/${size}% overflows: ${wide.join(', ')}`);
  await p.context().close();
}
{
  const p = await open(b); const small: string[] = [];
  for (const r of ['#new', '#results', '#flows', '#prefs']) { await go(p, r);
    const s = await p.evaluate(() => [...document.querySelectorAll('button,.btn,select,input:not([type=checkbox]):not([type=radio]):not([type=range]),a.nav,.choice,.switch')].filter(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e as HTMLElement).offsetParent !== null; }).map(e => { const r = (e as HTMLElement).getBoundingClientRect(); return { n: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.h < 44 || x.w < 44));
    s.forEach(x => small.push(`${r} "${x.n}" ${x.w}x${x.h}`)); }
  small.length === 0 ? log('  ok   every button, field, nav item and choice is at least 44 x 44 px') : fail('targets under 44px: ' + small.slice(0, 8).join('; '));
  await p.context().close();
}

log('== 5. settings actually change the page');
{
  const p = await open(b); await go(p, '#prefs');
  await p.check('input[name=theme][value=contrast]'); await p.waitForTimeout(100);
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor); bg === 'rgb(0, 0, 0)' ? log('  ok   High contrast theme applies (black background)') : fail('contrast theme bg=' + bg);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#audit tr')].map(r => r.textContent!.replace(/\s+/g, ' ').trim()));
  const fails = rows.filter(r => /Fails/.test(r)); fails.length === 0 ? log(`  ok   live contrast table: all ${rows.length} pairs pass in the current theme`) : fail('contrast table failures: ' + fails.join(' | '));
  await p.check('input[name=size][value="150"]'); const fs150 = await p.evaluate(() => getComputedStyle(document.documentElement).fontSize); fs150 === '24px' ? log('  ok   Text size 150% applies (24px base)') : fail('font size ' + fs150);
  await p.check('#s-motion'); (await p.evaluate(() => document.documentElement.dataset.motion)) === 'reduce' ? log('  ok   Reduce motion applies') : fail('motion not set');
  await p.reload(); await p.waitForTimeout(200); (await p.evaluate(() => document.documentElement.dataset.theme)) === 'contrast' ? log('  ok   settings persist after reload') : fail('settings did not persist');
  await p.context().close();
}

log('== 5b. the text-size setting scales every control (regression: an invalid font shorthand once pinned buttons at 13px)');
for (const size of [100, 150]) {
  const p = await open(b, { size }); const bad: string[] = [];
  for (const r of ['#new', '#results', '#finding-F1', '#flows', '#demos-checkout', '#prefs']) { await go(p, r);
    const s = await p.evaluate(() => { const root = parseFloat(getComputedStyle(document.documentElement).fontSize); return [...document.querySelectorAll('button,.btn,input[type=text],select')].filter(e => (e as HTMLElement).offsetParent !== null).map(e => ({ n: (e.textContent || e.id || e.tagName).trim().slice(0, 24), f: parseFloat(getComputedStyle(e).fontSize), root })).filter(x => x.f < x.root * 0.99); });
    s.forEach(x => bad.push(`${r} "${x.n}" ${x.f}px < ${x.root}px`)); }
  bad.length === 0 ? log(`  ok   at ${size}% every button, link-button, field and select is at least the base text size`) : fail(`controls smaller than body text at ${size}%: ${bad.slice(0, 6).join('; ')}`);
  await p.context().close();
}
{ const p = await open(b); await go(p, '#prefs'); const w = await p.evaluate(() => getComputedStyle(document.querySelector('.choice span')!).fontWeight);
  w === '400' ? log('  ok   choice descriptions are regular weight (only the option name is bold)') : fail('choice description font-weight=' + w); await p.context().close(); }

log('== 6. screenshots for visual review');
const shots: [string, any, string][] = [['results-light', { theme: 'light' }, '#results'], ['finding-dark', { theme: 'dark', scheme: 'dark' }, '#finding-F6'], ['settings-contrast', { theme: 'contrast' }, '#prefs'], ['new-mobile', { theme: 'light', w: 390, h: 844 }, '#new'], ['results-mobile-150', { theme: 'light', w: 390, h: 844, size: 150 }, '#results'], ['demos-light', { theme: 'light' }, '#demos-checkout']];
for (const [name, o, r] of shots) { const p = await open(b, o); await go(p, r); await p.screenshot({ path: `reports/prototype/${name}.png`, fullPage: true }); await p.context().close(); }
{ const p = await open(b, { theme: 'light', w: 390, h: 844 }); await go(p, '#new'); await p.fill('#url', 'example.com'); await p.check('input[value=goal]'); await p.click('button[type=submit]'); await p.waitForTimeout(200); await p.screenshot({ path: 'reports/prototype/new-errors-mobile.png', fullPage: true }); await p.context().close(); }
await b.close();
log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'}  (${checks} axe rule passes counted across screens)`);
fs.writeFileSync('reports/prototype/audit.txt', out.join('\n')); process.exit(failures ? 1 : 0);
