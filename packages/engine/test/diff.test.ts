import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { impactOf, affectedTemplates, selectFlows, routeInArea, gitChangedFiles } from '../src/diff.js';
import { toJUnit } from '../src/junit.js';
import type { Flow } from '@flowright/core';

const tpl = (f: string) => { const i = impactOf(f); return i.kind === 'route' ? i.template : i.kind; };

describe('impactOf: file-based routers', () => {
  it('Next pages router', () => {
    expect(tpl('pages/index.tsx')).toBe('/'); expect(tpl('src/pages/products/index.tsx')).toBe('/products'); expect(tpl('pages/products/[id].tsx')).toBe('/products/:p');
    expect(tpl('pages/docs/[...slug].tsx')).toBe('/docs/:p'); expect(tpl('pages/_app.tsx')).toBe('shared'); expect(tpl('pages/api/cart.ts')).toBe('shared');
  });
  it('Next app router: groups and slots are not URL segments; layouts are shared', () => {
    expect(tpl('app/page.tsx')).toBe('/'); expect(tpl('app/(shop)/cart/page.tsx')).toBe('/cart'); expect(tpl('apps/web/app/users/[id]/settings/page.tsx')).toBe('/users/:p/settings');
    expect(tpl('app/layout.tsx')).toBe('shared'); expect(tpl('app/cart/loading.tsx')).toBe('shared'); expect(tpl('app/@modal/login/page.tsx')).toBe('/login');
  });
  it('SvelteKit', () => {
    expect(tpl('src/routes/+page.svelte')).toBe('/'); expect(tpl('src/routes/blog/[slug]/+page.svelte')).toBe('/blog/:p'); expect(tpl('src/routes/blog/+page.server.ts')).toBe('/blog'); expect(tpl('src/routes/+layout.svelte')).toBe('shared');
  });
  it('Remix flat routes and Nuxt pages', () => {
    expect(tpl('app/routes/_index.tsx')).toBe('/'); expect(tpl('app/routes/products.$id.tsx')).toBe('/products/:p'); expect(tpl('app/routes/account.settings.tsx')).toBe('/account/settings');
    expect(tpl('pages/about.vue')).toBe('/about');
  });
  it('shared vs ignored', () => {
    for (const f of ['src/components/Button.tsx', 'styles/app.css', 'package.json', 'package-lock.json', 'src/lib/api.ts']) expect(tpl(f)).toBe('shared');
    for (const f of ['README.md', 'docs/guide.md', 'tests/a.test.ts', 'src/Button.spec.tsx', '.github/workflows/ci.yml', 'public/logo.png', 'src/Button.stories.tsx']) expect(tpl(f)).toBe('ignored');
  });
  it('windows paths work', () => { expect(tpl('pages\\products\\[id].tsx')).toBe('/products/:p'); });
});

describe('affectedTemplates and selectFlows', () => {
  const flow = (id: string, route: string, hrefs: string[] = []): Flow => ({ id, name: id, startPath: '/', steps: hrefs.map(h => ({ kind: 'click', role: 'link', name: 'x', nth: 0, css: 'a', label: 'x', href: 'http://h' + h })), expect: { route, treeHash: '', overlay: '' } } as Flow);
  const flows = [flow('home', '/'), flow('product', '/products/3', ['/products']), flow('cart', '/cart'), flow('order', '/order/1001', ['/cart', '/checkout'])];
  it('a shared change runs everything', () => { const a = affectedTemplates(['src/components/Button.tsx', 'pages/about.tsx']); expect(a.runAll).toBe(true); expect(selectFlows(flows, a)).toHaveLength(4); });
  it('only route files: selects flows that END on or CLICK THROUGH the changed route', () => {
    const a = affectedTemplates(['pages/cart.tsx']); expect(a.runAll).toBe(false);
    expect(selectFlows(flows, a).map(f => f.id).sort()).toEqual(['cart', 'order']);          // order clicks through /cart
  });
  it('dynamic route files match concrete ids', () => { expect(selectFlows(flows, affectedTemplates(['pages/products/[id].tsx'])).map(f => f.id)).toEqual(['product']); });
  it('docs-only change: nothing to test', () => { const a = affectedTemplates(['README.md', 'docs/x.md']); expect(a.nothingToTest).toBe(true); expect(selectFlows(flows, a)).toEqual([]); });
  it('routeInArea gates findings the same way', () => { const a = affectedTemplates(['pages/cart.tsx']); expect(routeInArea('/cart', a)).toBe(true); expect(routeInArea('/about', a)).toBe(false); expect(routeInArea('/anything', affectedTemplates(['src/lib/a.ts']))).toBe(true); });
});

describe('gitChangedFiles (real temporary repo)', () => {
  it('lists files changed on the branch since it diverged from main', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-git-')); const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, stdio: 'pipe' });
    g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(d, 'a.txt'), '1'); g('add', '.'); g('commit', '-qm', 'base');
    g('checkout', '-q', '-b', 'feature'); fs.mkdirSync(path.join(d, 'pages')); fs.writeFileSync(path.join(d, 'pages/cart.tsx'), 'x'); fs.writeFileSync(path.join(d, 'a.txt'), '2'); g('add', '.'); g('commit', '-qm', 'change');
    expect(gitChangedFiles('main', d).sort()).toEqual(['a.txt', 'pages/cart.tsx']);
  });
});

describe('toJUnit', () => {
  it('counts flows and findings, marks failures, and escapes XML', () => {
    const x = toJUnit('suite <1>', [{ name: 'ok flow', ok: true }, { name: 'bad "flow"', ok: false, why: 'a < b & c' }], [{ id: 'F1', kind: 'console-error', route: '/a?b=1&c=2', detail: '<oops>', severity: 'error' }], 12.34);
    expect(x).toContain('tests="3" failures="2"'); expect(x).toContain('suite &lt;1&gt;'); expect(x).toContain('a &lt; b &amp; c'); expect(x).toContain('/a?b=1&amp;c=2'); expect(x).toContain('time="12.3"');
    expect(x.match(/<failure/g)).toHaveLength(2);
  });
});

describe('regression: route folders named like docs/tests are still routes', () => {
  it('pages/docs/... and app/test/... are routes; a top-level docs/ folder is not', () => {
    expect(tpl('pages/docs/[...slug].tsx')).toBe('/docs/:p'); expect(tpl('app/test/page.tsx')).toBe('/test'); expect(tpl('docs/guide.mdx')).toBe('ignored'); expect(tpl('tests/e2e/a.ts')).toBe('ignored');
  });
});
