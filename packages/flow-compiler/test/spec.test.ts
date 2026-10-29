import { describe, it, expect } from 'vitest';
import { findingSpec, flowSpec } from '../src/compile.js';
import type { Action, OracleFinding, TargetConfig, Flow } from '@flowright/core';

const cfg: TargetConfig = { name: 't', startPath: '/', sandbox: true };
const form = (variant: 'valid' | 'empty' | 'invalid'): Action => ({ kind: 'form', variant, label: 'form x', formKey: 'x', method: 'POST',
  fields: [{ name: 'title', type: 'text', label: 'Title', required: false, css: '#etitle' }], submit: { role: 'button', name: 'Save changes', nth: 0, css: '#save' } } as Action);
const click: Action = { kind: 'click', role: 'button', name: 'Mark as done', nth: 0, css: '#t', label: 'click button "Mark as done"' };
const finding = (kind: string, path: Action[]): OracleFinding => ({ kind, route: '/x', detail: 'd', severity: 'error', signature: 's', path, occurrences: 1 } as unknown as OracleFinding);

describe('generated specs (regressions found by running them)', () => {
  it('the EMPTY variant clears a prefilled field instead of leaving it untouched', () => {
    const code = findingSpec(finding('missing-validation', [form('empty')]), cfg);
    expect(code).toContain('.fill("")');
  });
  it('valid input is filled with a real value, not blank', () => {
    expect(flowSpec({ id: 'f', name: 'f', startPath: '/', steps: [form('valid')], expect: { route: '/', treeHash: '', overlay: '' } } as unknown as Flow, cfg)).not.toContain('.fill("")');
  });
  it('a console-error repro actually listens for console errors (it used to assert only on uncaught exceptions)', () => {
    const code = findingSpec(finding('console-error', [click]), cfg);
    expect(code).toContain("page.on('console'");
    expect(code).toContain('consoleErrors');
  });
  it('a dead-click repro compares the whole page and URL, not the HTML length', () => {
    const code = findingSpec(finding('dead-click', [click]), cfg);
    expect(code).not.toContain('.length');
    expect(code).toContain('innerHTML');
    expect(code).toContain('page.url()');
  });
});
