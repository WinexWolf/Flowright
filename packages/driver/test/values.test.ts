import { describe, it, expect } from 'vitest';
import { valueFor } from '../src/actions.js';
import type { FieldSpec, TargetConfig } from '@flowright/core';

const f = (name: string, type = 'text', label = name): FieldSpec => ({ name, type, label, required: false, css: '#x' });
const cfg = (o: Partial<TargetConfig> = {}): TargetConfig => ({ name: 't', startPath: '/', sandbox: true, ...o });

describe('valueFor precedence and variants', () => {
  it('empty variant is null (blank), invalid variant is deliberately bad', () => {
    expect(valueFor(f('email', 'email'), 'empty', cfg())).toBeNull();
    expect(valueFor(f('email', 'email'), 'invalid', cfg())).toBe('not-an-email');
  });
  it('exact fieldValues beat substring formValues and heuristics', () => {
    const c = cfg({ formValues: { name: 'Substring Name' }, fieldValues: { q: 'laptops', username: 'priya' } });
    expect(valueFor(f('q', 'search', 'Search'), 'valid', c)).toBe('laptops');
    expect(valueFor(f('username'), 'valid', c)).toBe('priya');
    expect(valueFor(f('fullname', 'text', 'Full name'), 'valid', c)).toBe('Substring Name');
  });
  it('a short model-suggested key like "q" does not leak into unrelated fields', () => {
    const c = cfg({ fieldValues: { q: 'laptops' } });
    expect(valueFor(f('quantity', 'number', 'Quantity'), 'valid', c)).toBe('1');
  });
  it('fieldValues apply to VALID only, never to empty/invalid probes', () => {
    const c = cfg({ fieldValues: { email: 'a@b.co' } });
    expect(valueFor(f('email', 'email'), 'empty', c)).toBeNull();
    expect(valueFor(f('email', 'email'), 'invalid', c)).toBe('not-an-email');
  });
});
