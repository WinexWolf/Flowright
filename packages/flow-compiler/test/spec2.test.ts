import { describe, it, expect } from 'vitest';
import { flowSpec, findingSpec } from '../src/compile.js';
import type { Action, Flow, OracleFinding, TargetConfig } from '@flowright/core';

const click: Action = { kind: 'click', role: 'link', name: 'About', nth: 0, css: 'a', label: 'click link "About"' };
const flow = (o: Partial<Flow> = {}): Flow => ({ id: 'f', name: 'About', startPath: '/', steps: [click], expect: { route: '/about', treeHash: '', overlay: '', heading: 'About us' }, ...o });
const cfg = (o: Partial<TargetConfig> = {}): TargetConfig => ({ name: 't', startPath: '/', sandbox: true, ...o });
const finding = (kind: string, meta: Record<string, unknown> = {}): OracleFinding => ({ kind: kind as OracleFinding['kind'], route: '/about', detail: 'detail text', severity: 'error', signature: 's', path: [click], meta });

describe('login in generated specs', () => {
  const auth = { loginPath: '/login', fields: { email: 'me@x.io', password: '${ENV:APP_PW}' }, submit: 'Sign in', successPath: '/account' };
  it('logs in as setup before the flow; secrets come from the environment, never the file', () => {
    const c = flowSpec(flow(), cfg({ auth }));
    expect(c).toContain('setup: log in'); expect(c).toContain('process.env.APP_PW'); expect(c).not.toContain('${ENV:'); expect(c).toContain("waitForURL(u => u.toString().includes(\"/account\"))");
    expect(c.indexOf('log in')).toBeLessThan(c.indexOf('step 1'));
  });
  it('no auth, no login code', () => { expect(flowSpec(flow(), cfg())).not.toContain('log in'); });
});

describe('verified intent checks become real assertions', () => {
  it('each assertion kind maps to Playwright code', () => {
    const c = flowSpec(flow({ intent: { name: 'n', intent: 'i', assertions: [{ kind: 'url-matches', pattern: '^/about$' }, { kind: 'text-visible', text: 'Since 2012' }, { kind: 'alert-contains', text: 'required' }, { kind: 'dialog-contains', text: 'Delete' }, { kind: 'no-alert' }] } }), cfg());
    expect(c).toContain('new RegExp("^/about$")'); expect(c).toContain('getByText("Since 2012")'); expect(c).toContain("getByRole('alert').filter({ hasText: \"required\" })"); expect(c).toContain("getByRole('dialog')"); expect(c).toContain("getByRole('alert')).toHaveCount(0)");
  });
});

describe('accessibility, keyboard and visual repros', () => {
  it('a11y repro asserts the specific rule is gone, using axe', () => {
    const c = findingSpec(finding('a11y', { rule: 'image-alt' }), cfg());
    expect(c).toContain("import AxeBuilder from '@axe-core/playwright'"); expect(c).toContain('v.id === "image-alt"'); expect(c).toContain("withTags(['wcag2a'");
  });
  it('keyboard repros cover focus indicators, traps and mouse-only controls', () => {
    expect(findingSpec(finding('keyboard', { keyboard: 'no-focus-indicator' }), cfg())).toContain('visible focus indicator');
    expect(findingSpec(finding('keyboard', { keyboard: 'keyboard-trap' }), cfg())).toContain('Tab must move focus on');
    expect(findingSpec(finding('keyboard', { keyboard: 'mouse-only' }), cfg())).toContain('reachable by keyboard');
  });
  it('visual repro uses a snapshot assertion with a tolerance', () => { expect(findingSpec(finding('visual-change'), cfg())).toContain('toHaveScreenshot("-about.png"'); });
  it('non-a11y repros do not import axe', () => { expect(findingSpec(finding('console-error'), cfg())).not.toContain('axe'); });
});
