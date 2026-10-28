import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { fingerprint } from '@flowright/core';
import { snapshot } from '@flowright/driver';

let browser: Browser; let page: Page;
beforeAll(async () => { browser = await chromium.launch(); page = await browser.newPage(); });
afterAll(async () => { await browser.close(); });
const fp = async (html: string, tpl: string) => { await page.setContent(html); const s = await snapshot(page); return fingerprint(tpl, s.tree, s.tabs); };
const shell = (main: string) => `<nav><a href="/">Home</a><a href="/cart">Cart</a></nav><main>${main}</main>`;

describe('real DOM: same vs different pages', () => {
  it('two product pages that differ only in text and price are the SAME state', async () => {
    const a = await fp(shell('<h1>Studio Headphones</h1><p>$129</p><button>Add to cart</button>'), '/products/:id');
    const b = await fp(shell('<h1>Desk Lamp</h1><p>$39 on sale!</p><button>Add to cart</button>'), '/products/:id');
    expect(a.fine).toBe(b.fine);
  });
  it('empty cart vs cart with items are DIFFERENT', async () => {
    const e = await fp(shell('<h1>Cart</h1><p>Your cart is empty.</p>'), '/cart');
    const f = await fp(shell('<h1>Cart</h1><ul><li>Lamp <button>Remove</button></li><li>Bottle <button>Remove</button></li></ul><a href="/checkout">Checkout</a>'), '/cart');
    expect(e.fine).not.toBe(f.fine);
  });
  it('a modal opening over the same page changes only the fine key', async () => {
    const base = shell('<h1>Tasks</h1><button>New task</button>');
    const closed = await fp(base, '/#/tasks');
    const open = await fp(base + '<div role="dialog"><h2>New task</h2><input aria-label="Title"><button>Create</button></div>', '/#/tasks');
    expect(open.coarse).toBe(closed.coarse); expect(open.fine).not.toBe(closed.fine);
  });
  it('hidden elements do not affect identity', async () => {
    const a = await fp(shell('<h1>Menu</h1><div style="display:none"><a href="/x">Hidden</a></div>'), '/m');
    const b = await fp(shell('<h1>Menu</h1>'), '/m');
    expect(a.fine).toBe(b.fine);
  });
  it('extracts form groups with fields and the right submit button', async () => {
    await page.setContent(shell('<form action="/login" method="post"><label>Email <input name="email" type="email"></label><label>Password <input name="password" type="password"></label><button type="submit">Sign in</button></form>'));
    const s = await snapshot(page);
    expect(s.forms).toHaveLength(1);
    expect(s.forms[0].fields.map(f => f.name)).toEqual(['email', 'password']);
    expect(s.forms[0].submit?.name).toBe('Sign in');
    expect(s.interactive.some(i => i.name === 'Sign in')).toBe(false);   // driven as part of the form, not a loose click
  });
  it('a modal restricts actionable elements via inModal', async () => {
    await page.setContent(shell('<button>Behind</button><div role="dialog"><button>Inside</button></div>'));
    const s = await snapshot(page);
    expect(s.interactive.find(i => i.name === 'Inside')?.inModal).toBe(true);
    expect(s.interactive.find(i => i.name === 'Behind')?.inModal).toBe(false);
  });
});

describe('regression: zero-size wrapper around a fixed-position modal', () => {
  it('modal inside an empty wrapper is still part of the tree and changes the fine key', async () => {
    const base = '<main><h1>Tasks</h1><button>New task</button></main><div id="overlay"></div>';
    const closed = await fp(base, '/#/tasks');
    const open = await fp(base.replace('<div id="overlay"></div>', '<div id="overlay"><div style="position:fixed;inset:0"><div role="dialog"><h2>New task</h2><button>Create</button></div></div></div>'), '/#/tasks');
    expect(open.coarse).toBe(closed.coarse);
    expect(open.fine).not.toBe(closed.fine);
  });
});
