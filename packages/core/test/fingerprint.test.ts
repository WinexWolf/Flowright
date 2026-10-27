import { describe, it, expect } from 'vitest';
import { fingerprint, fineFrom } from '../src/fingerprint.js';
import type { RawNode } from '../src/types.js';

const li = (): RawNode => ({ r: 'listitem', k: [{ r: 'link' }, { r: 'button' }] });
const page = (items: number, extra: RawNode[] = []): RawNode[] => [
  { r: 'navigation', k: [{ r: 'link' }, { r: 'link' }, { r: 'link' }] },
  { r: 'main', k: [{ r: 'heading1' }, ...(items ? [{ r: 'list', k: Array.from({ length: items }, li) }] : [{ r: 'heading2' }]), ...extra] },
];
const dialog: RawNode = { r: 'dialog', k: [{ r: 'heading2' }, { r: 'textbox' }, { r: 'button' }] };
const alert: RawNode = { r: 'alert' };

describe('fingerprint: states that must be the SAME', () => {
  it('list with 3 items vs 5 items (data-driven length)', () => {
    expect(fingerprint('/tasks', page(3)).fine).toBe(fingerprint('/tasks', page(5)).fine);
    expect(fingerprint('/tasks', page(2)).fine).toBe(fingerprint('/tasks', page(40)).fine);
  });
  it('different concrete ids behind the same URL template', () => {
    expect(fingerprint('/products/:id', page(3)).fine).toBe(fingerprint('/products/:id', page(3)).fine);
  });
});

describe('fingerprint: states that must be DIFFERENT', () => {
  it('empty list vs one item vs many items (empty-cart vs full-cart)', () => {
    const e = fingerprint('/cart', page(0)).fine, one = fingerprint('/cart', page(1)).fine, many = fingerprint('/cart', page(3)).fine;
    expect(new Set([e, one, many]).size).toBe(3);
  });
  it('different URL templates with identical structure', () => {
    expect(fingerprint('/about', page(0)).coarse).not.toBe(fingerprint('/contact', page(0)).coarse);
  });
  it('same URL, dialog open vs closed: same coarse page, different fine state', () => {
    const closed = fingerprint('/#/tasks', page(3)), open = fingerprint('/#/tasks', page(3, [dialog]));
    expect(open.coarse).toBe(closed.coarse);
    expect(open.fine).not.toBe(closed.fine);
  });
  it('same URL, validation alert present vs absent', () => {
    const a = fingerprint('/checkout', page(0)), b = fingerprint('/checkout', page(0, [alert]));
    expect(b.coarse).toBe(a.coarse);
    expect(b.fine).not.toBe(a.fine);
  });
  it('dialog with inline error vs dialog without', () => {
    const plain = fingerprint('/#/tasks', page(3, [dialog])), withErr = fingerprint('/#/tasks', page(3, [{ r: 'dialog', k: [...dialog.k!, alert] }]));
    expect(withErr.fine).not.toBe(plain.fine);
  });
  it('same URL, different selected tab', () => {
    const tabs = [{ selected: true }, { selected: false }, { selected: false }], tabs2 = [{ selected: false }, { selected: true }, { selected: false }];
    const t: RawNode[] = [{ r: 'main', k: [{ r: 'tab' }, { r: 'tab' }, { r: 'tab' }] }];
    expect(fingerprint('/#/tasks', t, tabs).fine).not.toBe(fingerprint('/#/tasks', t, tabs2).fine);
    expect(fingerprint('/#/tasks', t, tabs).coarse).toBe(fingerprint('/#/tasks', t, tabs2).coarse);
  });
});

describe('fingerprint: recompute after URL-template learning', () => {
  it('fineFrom() reproduces fine for identical inputs, so merging is consistent', () => {
    const fp = fingerprint('/books/:slug', page(3, [dialog]));
    expect(fineFrom('/books/:slug', fp.treeHash, fp.overlay)).toBe(fp.fine);
  });
  it('states that only differed by an un-learned literal slug merge once the template is known', () => {
    const a = fingerprint('/books/dune', page(3)), b = fingerprint('/books/emma', page(3));
    expect(a.fine).not.toBe(b.fine);
    expect(fineFrom('/books/:slug', a.treeHash, a.overlay)).toBe(fineFrom('/books/:slug', b.treeHash, b.overlay));
  });
});
