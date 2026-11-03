import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { scanPage, shoot, keyboardScan } from '../src/index.js';
import { serve, GOOD, BAD, TRAP, type Srv } from './helpers.js';

let browser: Browser; let srv: Srv;
beforeAll(async () => { browser = await chromium.launch(); srv = await serve({ '/good': GOOD, '/bad': BAD, '/trap': TRAP, '/modal': `<!doctype html><html lang="en"><head><title>M</title></head><body><main><h1>Modal</h1><button id="o" type="button" onclick="document.getElementById('d').hidden=false">Open</button><div id="d" role="dialog" hidden><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" id="x"><button type="button" onclick="this.parentNode.hidden=true">Close</button></div></main></body></html>` }); });
afterAll(async () => { await browser.close(); await srv.stop(); });
const open = async (p: string) => { const page = await (await browser.newContext()).newPage(); await page.goto(srv.url + p); return page; };

describe('accessibility scan (axe) on a real page', () => {
  it('an accessible page has no WCAG violations and no keyboard issues', async () => {
    const page = await open('/good'); const c = await scanPage(page, { a11y: true, keyboard: true });
    expect(c.a11y).toEqual([]); expect(c.keyboard).toEqual([]);
  });
  it('finds a missing alt, an unnamed button and low contrast, with impact levels', async () => {
    const page = await open('/bad'); const c = await scanPage(page, { a11y: true });
    const ids = c.a11y.map(v => v.id);
    expect(ids).toEqual(expect.arrayContaining(['image-alt', 'button-name', 'color-contrast']));
    expect(c.a11y.find(v => v.id === 'image-alt')?.impact).toBe('critical');
    expect(c.a11y.find(v => v.id === 'color-contrast')?.nodes).toBeGreaterThan(0);
  });
  it('scans the page AS IT IS NOW: an open dialog is checked, a closed one is not', async () => {
    const page = await open('/modal');
    expect((await scanPage(page, { a11y: true })).a11y.map(v => v.id)).not.toContain('image-alt');   // dialog is hidden: its image is not rendered
    await page.click('#o'); expect((await scanPage(page, { a11y: true })).a11y.map(v => v.id)).toContain('image-alt');
  });
  it('skips scans that are switched off', async () => {
    const page = await open('/bad'); expect(await scanPage(page, {})).toEqual({ a11y: [], keyboard: [] });
  });
});

describe('keyboard scan', () => {
  it('flags controls with no visible focus indicator, and mouse-only clickables', async () => {
    const page = await open('/bad'); const k = await keyboardScan(page);
    expect(k.map(x => x.kind)).toEqual(expect.arrayContaining(['no-focus-indicator', 'mouse-only']));
    expect(k.find(x => x.kind === 'mouse-only')?.detail).toContain('Fake button');
  });
  it('detects a keyboard trap', async () => {
    const page = await open('/trap'); expect((await keyboardScan(page)).map(x => x.kind)).toContain('keyboard-trap');
  });
  it('a normal page (links and fields with default focus rings) is clean', async () => {
    const page = await open('/good'); expect(await keyboardScan(page)).toEqual([]);
  });
});

describe('screenshots for visual regression', () => {
  it('two screenshots of the same page are byte-identical (so a diff means something changed)', async () => {
    const page = await open('/good'); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-shot-'));
    await shoot(page, path.join(d, 'a.png')); await shoot(page, path.join(d, 'b.png'));
    expect(fs.readFileSync(path.join(d, 'a.png')).equals(fs.readFileSync(path.join(d, 'b.png')))).toBe(true);
  });
  it('masked selectors are hidden, so dynamic regions cannot cause diffs', async () => {
    const page = await (await browser.newContext()).newPage(); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-mask-'));
    await page.setContent('<main><h1>Clock</h1><div id="clock" style="background:#f00;height:40px"></div></main>');
    await shoot(page, path.join(d, 'masked.png'), ['#clock']);
    await page.evaluate("document.getElementById('clock').style.background = '#00f'");
    await shoot(page, path.join(d, 'masked2.png'), ['#clock']);
    expect(fs.readFileSync(path.join(d, 'masked.png')).equals(fs.readFileSync(path.join(d, 'masked2.png')))).toBe(true);
  });
});
