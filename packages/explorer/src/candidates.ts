import type { Action, PageSnapshot, TargetConfig } from '@flowright/core';
import { isBlocked } from './blocklist.js';

export interface Candidate { action: Action; text: string; href?: string }

/**
 * The actions a user could take on this page right now, in a stable order. Applies the same safety rules as the crawler:
 * a modal restricts actions to the modal, off-site links are excluded, and blocklisted controls (by name AND link target) are excluded.
 * Forms are offered with VALID input only (an agent pursuing a goal is not probing for validation bugs).
 */
export function candidateActions(snap: PageSnapshot, cfg: TargetConfig, baseUrl: string): Candidate[] {
  const host = new URL(baseUrl).host; const allowed = new Set([host, ...(cfg.allowedHosts ?? [])]);
  const modal = snap.evidence.dialogs.length > 0; const out: Candidate[] = [];
  for (const el of snap.interactive) {
    if (el.disabled || (modal && !el.inModal) || el.target === '_blank') continue;
    let u: URL | null = null; try { u = el.href ? new URL(el.href) : null; } catch { u = null; }
    if (u && u.protocol !== 'javascript:' && (!['http:', 'https:'].includes(u.protocol) || !allowed.has(u.host))) continue;
    if (isBlocked(`${el.name} ${u && u.protocol !== 'javascript:' ? u.pathname : ''}`, cfg)) continue;
    out.push({ action: { kind: 'click', role: el.role, name: el.name, nth: el.nth, css: el.css, label: `click ${el.role} "${el.name}"`, href: el.href }, text: el.name, href: u && u.protocol !== 'javascript:' ? u.pathname + u.search + u.hash : undefined });
  }
  for (const f of snap.forms) {
    if (modal && !f.inModal) continue;
    if (isBlocked(`${f.submit?.name ?? ''} ${f.action && f.action !== 'inline' ? f.action : ''}`, cfg)) continue;
    const text = `${f.submit?.name ?? 'submit'} ${f.fields.map(x => x.label || x.name).join(' ')} ${f.action ?? ''}`;
    out.push({ action: { kind: 'form', variant: 'valid', fields: f.fields, submit: f.submit ?? null, label: `form ${f.key} [valid]`, method: f.method }, text });
  }
  return out;
}
