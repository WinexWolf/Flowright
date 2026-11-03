import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

/**
 * A screenshot that is the same twice in a row: animations and carets off, fonts loaded, scroll reset, and any `mask` selectors
 * (clocks, avatars, ads) hidden. Without this, pixel diffs are mostly noise.
 */
export async function shoot(page: Page, file: string, mask: string[] = []): Promise<string> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const css = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}${mask.length ? mask.map(m => `${m}{visibility:hidden!important}`).join('') : ''}`;
  const handle = await page.addStyleTag({ content: css });
  try {
    await page.evaluate('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true').catch(() => {});
    await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css' });
  } finally { await handle.evaluate((el: Element) => el.remove()).catch(() => {}); }
  return path.basename(file);
}
