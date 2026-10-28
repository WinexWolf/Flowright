import type { Action, CrawlGraph, Edge, FindingKind, OracleFinding, StateNode } from '@flowright/core';

/**
 * Tier-1 oracle: deterministic rules over raw browser observations. No model, no network, no randomness.
 * A finding is only ever produced from something the browser actually reported, or (for 'suspect' severity)
 * from comparing the outcomes of deliberate probes. Subjective UX opinions never become findings here.
 */
const TEXTY = new Set(['text', 'email', 'password', 'textarea', 'tel', 'url', 'number']);   // 'search' fields are excluded on purpose
// 'invalid' probes fill free text with "x", which IS valid for a title/name field. Only type-constrained fields make an invalid probe meaningful.
const CONSTRAINED = new Set(['email', 'number', 'url', 'tel', 'password', 'date']);
const FORM_LABEL = /^form (.*) \[(valid|empty|invalid)\]$/;
const norm = (s: string) => s.replace(/\d+/g, 'N').replace(/https?:\/\/[^/\s]+/g, '').slice(0, 80);

export function analyze(g: CrawlGraph): OracleFinding[] {
  const byId = new Map(g.states.map(s => [s.id, s]));
  const out: OracleFinding[] = [];
  const add = (kind: FindingKind, at: StateNode, detail: string, path: Action[], severity: 'error' | 'suspect' = 'error', probe?: OracleFinding['probe']) => {
    out.push({ kind, route: at.evidence.route, detail, severity, signature: `${kind}|${at.urlTemplate}|${norm(detail)}`, path, probe });
  };

  // ---- state-level facts
  for (const s of g.states) {
    if (s.evidence.overflowX) add('overflow', s, 'page scrolls horizontally at the test viewport', s.path);
    if (s.evidence.brokenImages > 0) add('broken-image', s, `${s.evidence.brokenImages} visible image(s) failed to load`, s.path);
    if (s.evidence.emptyMain && s.depth > 0) add('empty-route', s, 'route rendered no visible content', s.path);
  }

  // ---- edge-level facts (what the browser reported while an action ran)
  for (const e of g.edges) {
    if (e.obs.actionError) continue;                       // crawler could not perform it; says nothing about the app
    const src = byId.get(e.from), dst = byId.get(e.to); if (!src || !dst) continue;
    const path = [...src.path, e.action];
    const isProbe = e.action.kind === 'form' && e.action.variant !== 'valid';

    if (e.obs.pageErrors.length) add('console-error', dst, `uncaught exception: ${e.obs.pageErrors[0]}`, path);
    const logged = e.obs.consoleErrors.filter(c => !/Failed to load resource/i.test(c));     // network failures are reported via responses below
    if (logged.length) add('console-error', dst, `console.error: ${logged[0]}`, path);

    for (const r of e.obs.badResponses) {
      const m = /^(\d+) (\S+) (.*)$/.exec(r); if (!m) continue;
      const status = Number(m[1]), type = m[2], url = m[3];
      if (status >= 500) add('failed-request', dst, `${status} from ${type} ${new URL(url).pathname}`, path);
      else if (status === 404 && type === 'document') {
        if (e.action.kind === 'click' && e.action.role === 'link') add('broken-link', dst, `link "${e.action.name}" leads to a 404 page`, path);
      } else if (!isProbe && status >= 400) add('failed-request', dst, `${status} from ${type} ${new URL(url).pathname}`, path);
      // 4xx on a deliberately invalid form probe is the app validating correctly, not a failure
    }

    // dead click: a button-like control did nothing at all (links are excluded: a link to the current page is legitimate)
    if (e.action.kind === 'click' && e.obs.noEffect && e.action.role !== 'link') add('dead-click', src, `click on ${e.action.role} "${e.action.name}" had no visible, network, or DOM effect`, path);
  }

  // ---- form probes: compare what happens with valid vs empty vs invalid input
  const groups = new Map<string, Partial<Record<'valid' | 'empty' | 'invalid', Edge>>>();
  for (const e of g.edges) {
    const m = FORM_LABEL.exec(e.label); if (!m || e.obs.actionError) continue;
    const k = `${e.from}|${m[1]}`; if (!groups.has(k)) groups.set(k, {});
    groups.get(k)![m[2] as 'valid' | 'empty' | 'invalid'] = e;
  }
  for (const [, grp] of groups) {
    const valid = grp.valid; if (!valid || valid.action.kind !== 'form') continue;
    if (!valid.action.fields.some(f => TEXTY.has(f.type))) continue;     // checkbox-only / search forms have nothing to validate
    if (valid.to === valid.from) continue;                               // valid input changed nothing observable: no baseline to compare
    const src = byId.get(valid.from)!;
    for (const v of ['empty', 'invalid'] as const) {
      if (v === 'invalid' && !valid.action.fields.some(f => CONSTRAINED.has(f.type))) continue;
      const pe = grp[v]; if (!pe) continue;
      // "accepted" = same outcome as valid input. Exact-state equality is too brittle (an accepted blank item can add a zero-width row),
      // so also accept: both land on the same route template, neither shows an alert, neither still shows a dialog, and both left the form's state.
      const vd = byId.get(valid.to), pd = byId.get(pe.to);
      const sameOutcome = pe.to === valid.to || (!!vd && !!pd && pe.to !== pe.from && vd.urlTemplate === pd.urlTemplate
        && !vd.evidence.alerts.length && !pd.evidence.alerts.length && !vd.evidence.dialogs.length && !pd.evidence.dialogs.length);
      if (!sameOutcome) continue;
      add('missing-validation', src, `form accepted ${v} input and ended in the same state as valid input`, [...src.path, pe.action], 'suspect', { valid: valid.action, variant: pe.action, from: src.id });
    }
  }

  // dedupe by signature, keep the shallowest reproducing path
  const best = new Map<string, OracleFinding>();
  for (const f of out) { const p = best.get(f.signature); if (!p || f.path.length < p.path.length) best.set(f.signature, f); }
  return [...best.values()];
}
