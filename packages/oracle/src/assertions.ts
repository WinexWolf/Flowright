import type { Assertion, Evidence } from '@flowright/core';

const ci = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

export interface AssertionResult { ok: boolean; why: string }

/** Deterministic: decides whether an assertion holds on observed page evidence. No model is involved, ever. */
export function checkAssertion(a: Assertion, ev: Evidence): AssertionResult {
  switch (a.kind) {
    case 'url-matches': { const ok = new RegExp(a.pattern).test(ev.route); return { ok, why: ok ? '' : `route ${ev.route} does not match /${a.pattern}/` }; }
    case 'heading': { const ok = ev.headings.some(h => ci(h, a.text)); return { ok, why: ok ? '' : `no heading contains “${a.text}” (headings: ${ev.headings.slice(0, 4).join(' | ') || 'none'})` }; }
    case 'text-visible': { const ok = ci(ev.textSample, a.text) || ev.headings.some(h => ci(h, a.text)); return { ok, why: ok ? '' : `text “${a.text}” is not visible` }; }
    case 'alert-contains': { const ok = ev.alerts.some(x => ci(x, a.text)); return { ok, why: ok ? '' : `no alert contains “${a.text}”` }; }
    case 'dialog-contains': { const ok = ev.dialogs.some(x => ci(x, a.text)); return { ok, why: ok ? '' : `no dialog contains “${a.text}”` }; }
    case 'no-alert': { const ok = ev.alerts.length === 0; return { ok, why: ok ? '' : `unexpected alert: ${ev.alerts[0]}` }; }
  }
}
export const checkAssertions = (as: Assertion[], ev: Evidence) => as.map(a => ({ assertion: a, ...checkAssertion(a, ev) }));

/** Validate untrusted (model-produced) JSON into well-formed assertions. Anything malformed is dropped, never repaired. */
export function sanitizeAssertions(raw: unknown, max = 6): Assertion[] {
  if (!Array.isArray(raw)) return [];
  const out: Assertion[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    const pattern = typeof o.pattern === 'string' ? o.pattern : '';
    if (o.kind === 'no-alert') out.push({ kind: 'no-alert' });
    else if (o.kind === 'url-matches' && pattern && pattern.length <= 160) { try { new RegExp(pattern); out.push({ kind: 'url-matches', pattern }); } catch { /* invalid regex: drop */ } }
    else if (['heading', 'text-visible', 'alert-contains', 'dialog-contains'].includes(o.kind as string) && text && text.length <= 120) out.push({ kind: o.kind as 'heading', text });
    if (out.length >= max) break;
  }
  return out;
}
