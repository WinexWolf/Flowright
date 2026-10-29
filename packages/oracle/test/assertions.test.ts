import { describe, it, expect } from 'vitest';
import { checkAssertion, sanitizeAssertions } from '../src/assertions.js';
import type { Evidence } from '@flowright/core';

const ev = (o: Partial<Evidence> = {}): Evidence => ({ route: '/order/1001', title: 'Order', headings: ['Order confirmed'], textSample: 'Thank you! Your order #1001 is on its way.', alerts: [], dialogs: [], selectedTabs: [], overflowX: false, brokenImages: 0, emptyMain: false, ...o });

describe('checkAssertion (deterministic)', () => {
  it('url, heading, text', () => {
    expect(checkAssertion({ kind: 'url-matches', pattern: '^/order/\\d+$' }, ev()).ok).toBe(true);
    expect(checkAssertion({ kind: 'url-matches', pattern: '^/cart$' }, ev()).ok).toBe(false);
    expect(checkAssertion({ kind: 'heading', text: 'order confirmed' }, ev()).ok).toBe(true);
    expect(checkAssertion({ kind: 'text-visible', text: 'on its way' }, ev()).ok).toBe(true);
    expect(checkAssertion({ kind: 'text-visible', text: 'refund' }, ev()).ok).toBe(false);
  });
  it('alerts and dialogs', () => {
    expect(checkAssertion({ kind: 'no-alert' }, ev()).ok).toBe(true);
    expect(checkAssertion({ kind: 'no-alert' }, ev({ alerts: ['Name is required'] })).ok).toBe(false);
    expect(checkAssertion({ kind: 'alert-contains', text: 'required' }, ev({ alerts: ['Name is required'] })).ok).toBe(true);
    expect(checkAssertion({ kind: 'dialog-contains', text: 'delete' }, ev({ dialogs: ['Delete this task?'] })).ok).toBe(true);
  });
  it('failures explain themselves', () => { expect(checkAssertion({ kind: 'heading', text: 'Welcome' }, ev()).why).toContain('Welcome'); });
});

describe('sanitizeAssertions (untrusted model output)', () => {
  it('keeps well-formed assertions', () => {
    expect(sanitizeAssertions([{ kind: 'heading', text: 'Hi' }, { kind: 'no-alert' }, { kind: 'url-matches', pattern: '^/x$' }])).toHaveLength(3);
  });
  it('drops malformed, unknown, oversized and invalid-regex items instead of repairing them', () => {
    expect(sanitizeAssertions([null, 5, 'x', { kind: 'heading' }, { kind: 'heading', text: 'a'.repeat(500) }, { kind: 'url-matches', pattern: '(' }, { kind: 'run-code', text: 'rm -rf /' }])).toEqual([]);
  });
  it('is not an array -> empty; respects a cap', () => {
    expect(sanitizeAssertions({ kind: 'no-alert' })).toEqual([]);
    expect(sanitizeAssertions(Array.from({ length: 20 }, () => ({ kind: 'no-alert' })), 3)).toHaveLength(3);
  });
});
