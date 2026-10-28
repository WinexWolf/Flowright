import { describe, it, expect } from 'vitest';
import { UrlTemplater } from '../src/urlTemplate.js';

const B = 'http://localhost:3000';
describe('UrlTemplater', () => {
  it('templates numeric ids, uuids and long hex', () => {
    const t = new UrlTemplater();
    expect(t.template(`${B}/users/42`)).toBe('/users/:id');
    expect(t.template(`${B}/users/42/orders/7`)).toBe('/users/:id/orders/:id');
    expect(t.template(`${B}/doc/3f2b8c1e-9a4d-4c3e-8f21-0123456789ab`)).toBe('/doc/:uuid');
    expect(t.template(`${B}/f/0123456789abcdef0123`)).toBe('/f/:hex');
  });
  it('keeps query KEYS (sorted) and drops values', () => {
    const t = new UrlTemplater();
    expect(t.template(`${B}/books?page=2&genre=fiction`)).toBe('/books?genre&page');
    expect(t.template(`${B}/books?genre=history&page=9`)).toBe('/books?genre&page');
    expect(t.template(`${B}/books`)).toBe('/books');
  });
  it('templates hash routes like paths', () => {
    const t = new UrlTemplater();
    expect(t.template(`${B}/#/tasks/5`)).toBe('/#/tasks/:id');
    expect(t.template(`${B}/#/tasks`)).toBe('/#/tasks');
    expect(t.template(`${B}/`)).toBe('/');
  });
  it('learns slugs only after enough distinct siblings under one parent', () => {
    const t = new UrlTemplater();
    for (const s of ['dune', 'emma']) t.observe(`${B}/books/${s}`);
    expect(t.template(`${B}/books/dune`)).toBe('/books/dune');       // 2 distinct: not yet generalised
    t.observe(`${B}/books/cosmos`);
    expect(t.template(`${B}/books/dune`)).toBe('/books/:slug');      // 3 distinct: generalised
    expect(t.template(`${B}/books/anything-new`)).toBe('/books/:slug');
  });
  it('never generalises depth-0 segments, so top-level pages stay distinct', () => {
    const t = new UrlTemplater();
    for (const p of ['/about', '/cart', '/contact', '/login', '/products']) t.observe(`${B}${p}`);
    expect(t.template(`${B}/about`)).toBe('/about');
    expect(t.template(`${B}/cart`)).toBe('/cart');
  });
  it('respects staticSegments and urlOverrides', () => {
    const t = new UrlTemplater({ staticSegments: ['profile', 'billing', 'security'], urlOverrides: [{ pattern: '^/legacy/', template: '/legacy/*' }] });
    for (const s of ['profile', 'billing', 'security']) t.observe(`${B}/settings/${s}`);
    expect(t.template(`${B}/settings/billing`)).toBe('/settings/billing');
    expect(t.template(`${B}/legacy/a/b`)).toBe('/legacy/*');
  });
  it('known limitation: three distinct STATIC children under a parent are generalised unless declared static', () => {
    const t = new UrlTemplater();
    for (const s of ['profile', 'billing', 'security']) t.observe(`${B}/settings/${s}`);
    expect(t.template(`${B}/settings/billing`)).toBe('/settings/:slug');
  });
});

describe('UrlTemplater.version (lets a crawler know earlier states must be re-keyed)', () => {
  it('increments only when a genuinely new (parent, child) pair is learned', () => {
    const t = new UrlTemplater(); const v0 = t.version;
    t.observe('http://x/books/dune'); const v1 = t.version;
    t.observe('http://x/books/dune'); expect(t.version).toBe(v1);        // repeat: no change
    t.observe('http://x/books/emma'); expect(t.version).toBeGreaterThan(v1);
    expect(v1).toBeGreaterThan(v0);
  });
});
