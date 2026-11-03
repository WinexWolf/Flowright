import { describe, it, expect } from 'vitest';
import { redact, ScriptedProvider } from '../src/index.js';

describe('redact (privacy: nothing personal should reach a model)', () => {
  it('removes emails, JWTs, long tokens and IPs', () => {
    const r = redact('Mail priya.raman+test@corp.example.com token eyJhbGciOi.eyJzdWIiOjF9.sig_abc and key ' + ['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dcAAAA'].join('_') + ' from 10.1.2.3');
    expect(r).not.toMatch(/priya|corp\.example|eyJ|sk_live|10\.1\.2\.3/); expect(r).toContain('[email]'); expect(r).toContain('[token]'); expect(r).toContain('[secret]'); expect(r).toContain('[ip]');
  });
  it('removes real card numbers (Luhn-valid) but leaves ordinary long numbers alone', () => {
    expect(redact('card 4242 4242 4242 4242 ok')).toContain('[card]'); expect(redact('card 4242424242424242')).toContain('[card]');
    expect(redact('order 1234567890123456 total')).toContain('1234567890123456');          // fails Luhn: not a card
  });
  it('removes phone-like numbers but keeps prices, years and short numbers', () => {
    expect(redact('call +1 (415) 555-0142 now')).toContain('[phone]'); expect(redact('call 415-555-0142')).toContain('[phone]');
    expect(redact('Total $1,700 in 2026, 12 pages, 3 min, order #1001')).toBe('Total $1,700 in 2026, 12 pages, 3 min, order #1001');
  });
  it('is idempotent and leaves ordinary text untouched', () => {
    const t = 'Open “Products”, then press “Add to cart”.'; expect(redact(t)).toBe(t); expect(redact(redact('a@b.co'))).toBe('[email]');
  });
});

describe('the provider is the single choke point', () => {
  it('prompts and system messages are redacted before the call, and the log shows only the redacted text', async () => {
    let seen = ''; const p = new ScriptedProvider(req => { seen = req.prompt + '|' + req.system; return { ok: true }; });
    await p.generateJson({ schemaName: 's', prompt: 'user bob@example.com paid with 4242 4242 4242 4242', system: 'admin root@corp.io' }, r => r);
    expect(seen).not.toMatch(/bob@|4242|root@/); expect(p.calls[0].prompt).toContain('[email]'); expect(p.calls[0].prompt).toContain('[card]');
  });
});
