import fs from 'node:fs';

export interface ReportFinding { id: string; kind: string; severity: 'error' | 'suspect'; route: string; detail: string; occurrences: number; steps: string[]; reproduced: number; attempts: number; repro?: string; artifacts?: { video?: string; trace?: string; screenshot?: string } }
export interface ReportFlow { id: string; name: string; intent?: string; steps: string[]; assertions: string[]; replay?: { ok: boolean; why?: string } }
export interface ReportGraph { states: { id: string; route: string; heading: string; depth: number; findings: number }[]; edges: { from: string; to: string; bad: boolean }[] }
export interface ReportData {
  title: string; target: string; generatedAt: string; durationMs: number;
  findings: ReportFinding[]; unconfirmed: { kind: string; route: string; detail: string }[]; flows: ReportFlow[]; graph: ReportGraph;
  facts: Record<string, string | number>; llm?: { used: boolean; calls: number; costUsd: number; rejectedAssertions: number };
}
export interface ReportOptions { assets?: 'link' | 'inline'; baseDir?: string }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const KIND_LABEL: Record<string, string> = {
  'console-error': 'Console error', 'failed-request': 'Failed network request', 'broken-link': 'Broken link', 'dead-click': 'Control does nothing',
  'overflow': 'Page scrolls sideways', 'broken-image': 'Broken image', 'empty-route': 'Blank page', 'missing-validation': 'Form accepts bad input', 'page-error': 'Uncaught exception',
};
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const dur = (ms: number) => ms < 90_000 ? `${Math.round(ms / 1000)} seconds` : `${Math.round(ms / 60_000)} minutes`;

function headline(d: ReportData): { h: string; lede: string } {
  const errs = d.findings.filter(f => f.severity === 'error').length, sus = d.findings.length - errs;
  const pages = d.graph.states.length, flowsOk = d.flows.filter(f => f.replay?.ok).length, flowsRun = d.flows.filter(f => f.replay).length;
  const h = d.findings.length === 0 ? `No problems found across ${plural(pages, 'page')}.`
    : `${plural(d.findings.length, 'problem')} found${errs && sus ? ` (${errs} broken, ${sus} suspected)` : ''}.`;
  const parts = [`Flowright clicked through ${plural(pages, 'page')} and ${plural(d.graph.edges.length, 'transition')} in ${dur(d.durationMs)}.`];
  if (d.findings.length) parts.push(`Every finding below reproduced when replayed from a fresh browser${d.unconfirmed.length ? `; ${plural(d.unconfirmed.length, 'candidate')} did not reproduce and ${d.unconfirmed.length === 1 ? 'was' : 'were'} set aside` : ''}.`);
  if (flowsRun) parts.push(`${flowsOk} of ${plural(flowsRun, 'flow')} replayed to the same place on a second visit.`);
  return { h, lede: parts.join(' ') };
}

function routeMap(g: ReportGraph): string {
  const states = g.states.slice(0, 80); const byDepth = new Map<number, typeof states>();
  for (const s of states) { if (!byDepth.has(s.depth)) byDepth.set(s.depth, []); byDepth.get(s.depth)!.push(s); }
  const GX = 176, GY = 118, PAD = 40, PADX = 96; const pos = new Map<string, { x: number; y: number }>(); let maxW = 0;
  for (const [d, row] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) { row.forEach((s, i) => pos.set(s.id, { x: PADX + i * GX, y: PAD + d * GY })); maxW = Math.max(maxW, PADX * 2 + (row.length - 1) * GX); }
  const maxD = Math.max(0, ...byDepth.keys()); const H = PAD * 2 + maxD * GY + 40;
  const seen = new Set<string>(); let edges = '';
  for (const e of g.edges) {
    const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b || e.from === e.to) continue;
    const k = `${e.from}>${e.to}`; if (seen.has(k)) continue; seen.add(k);
    const my = (a.y + b.y) / 2; edges += `<path class="edge${e.bad ? ' bad' : ''}" d="M${a.x},${a.y + 11} C${a.x},${my} ${b.x},${my} ${b.x},${b.y - 11}"/>`;
  }
  const short = (s: string, n: number) => /* labels are centered under their dot, so keep them narrower than the column */ s.length > n ? s.slice(0, n - 1) + '…' : s;
  const nodes = states.map(s => { const p = pos.get(s.id)!; const bad = s.findings > 0;
    return `<g class="st${bad ? ' bad' : ''}" transform="translate(${p.x},${p.y})"><title>${esc(s.route)}${s.heading ? ' — ' + esc(s.heading) : ''}${bad ? ` (${plural(s.findings, 'finding')})` : ''}</title>`
      + `${bad ? '<circle class="halo" r="17"/>' : ''}<circle class="dot" r="9"/><text class="rt" y="30" text-anchor="middle">${esc(short(s.route, 20))}</text>`
      + `<text class="hd" y="45" text-anchor="middle">${esc(short(s.heading, 22))}</text></g>`; }).join('');
  return `<svg class="routemap" viewBox="0 0 ${Math.max(maxW, 480)} ${H}" style="width:100%;min-width:${Math.min(Math.max(maxW, 480), 960)}px;height:auto" role="img" aria-label="Map of ${states.length} pages and the clicks between them">${edges}${nodes}</svg>`;
}

function inlineImg(p: string | undefined, o: ReportOptions): string {
  if (!p) return '';
  try { const full = o.baseDir ? `${o.baseDir}/${p}` : p; return `<img class="shot" alt="Screenshot after the last step" src="data:image/png;base64,${fs.readFileSync(full).toString('base64')}">`; } catch { return ''; }
}

function findingHtml(f: ReportFinding, o: ReportOptions): string {
  const a = f.artifacts ?? {}; const link = o.assets !== 'inline';
  const evidence = o.assets === 'inline' ? inlineImg(a.screenshot, o)
    : [a.screenshot ? `<img class="shot" alt="Screenshot after the last step" src="${esc(a.screenshot)}">` : '', a.video ? `<a href="${esc(a.video)}">Watch the video</a>` : '', a.trace ? `<a href="${esc(a.trace)}">Open the Playwright trace</a>` : ''].join(' ');
  void link;
  return `<details class="finding ${f.severity}"><summary><span class="sev">${f.severity === 'error' ? 'Broken' : 'Suspected'}</span><span class="what">${esc(KIND_LABEL[f.kind] ?? f.kind)}</span><code class="where">${esc(f.route)}</code><span class="why">${esc(f.detail)}</span></summary>`
    + `<div class="body"><div><h4>How to get there</h4><ol>${f.steps.map(s => `<li>${esc(s)}</li>`).join('') || '<li>Open the start page</li>'}</ol>`
    + `<p class="small">Reproduced in ${f.reproduced} of ${plural(f.attempts, 'fresh replay')}${f.occurrences > 1 ? `; seen ${f.occurrences} times during the crawl` : ''}.</p></div>`
    + `<div>${evidence ? `<h4>Evidence</h4><div class="ev">${evidence}</div>` : ''}${f.repro ? `<h4>Runnable repro</h4><p class="small">This Playwright test fails while the bug exists and passes once it is fixed.</p><pre><code>${esc(f.repro)}</code></pre>` : ''}</div></div></details>`;
}

export function buildReport(d: ReportData, o: ReportOptions = {}): string {
  const { h, lede } = headline(d);
  const findings = d.findings.length ? d.findings.map(f => findingHtml(f, o)).join('') : '<p class="none">Nothing broke on any path the crawler could reach.</p>';
  const flows = d.flows.length ? `<div class="scroll"><table><thead><tr><th>Flow</th><th>Steps</th><th>Should end with</th><th>On replay</th></tr></thead><tbody>${d.flows.map(f =>
    `<tr><td><strong>${esc(f.name)}</strong>${f.intent && f.intent !== f.name ? `<div class="small">${esc(f.intent)}</div>` : ''}</td><td class="num">${f.steps.length}</td><td class="small">${f.assertions.map(esc).join('<br>') || '—'}</td>`
    + `<td>${f.replay ? (f.replay.ok ? '<span class="ok">Passes</span>' : `<span class="no">Fails</span><div class="small">${esc(f.replay.why ?? '')}</div>`) : '<span class="small">Not replayed</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="none">No flows were compiled.</p>';
  const facts = Object.entries(d.facts).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const llm = d.llm ? `<div><dt>Language model</dt><dd>${d.llm.used ? `${plural(d.llm.calls, 'call')}, ${d.llm.rejectedAssertions} proposed ${d.llm.rejectedAssertions === 1 ? 'assertion' : 'assertions'} rejected as not true on the page, $${d.llm.costUsd.toFixed(4)}` : 'Not used; names and assertions come from what was observed'}</dd></div>` : '';
  const unconf = d.unconfirmed.length ? `<h3>Set aside</h3><p class="small">These looked wrong once but did not reproduce on replay, so they are not counted.</p><ul class="small">${d.unconfirmed.map(u => `<li>${esc(KIND_LABEL[u.kind] ?? u.kind)} at <code>${esc(u.route)}</code>: ${esc(u.detail)}</li>`).join('')}</ul>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(d.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;800&family=Spline+Sans+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#EEF1F4;--surface:#FFFFFF;--ink:#17212B;--mut:#566474;--line:#D2D9E1;--track:#2A5DB0;--pass:#0F7A68;--bad:#C4262E;--warn:#9A6200;--halo:rgba(196,38,46,.16);
 box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0F151C;--surface:#161F29;--ink:#E6EBF0;--mut:#93A1B1;--line:#2A3745;--track:#7FA8F0;--pass:#4CC2AC;--bad:#FF7A70;--warn:#E3B04B;--halo:rgba(255,122,112,.2)}}
:root[data-theme="dark"]{--bg:#0F151C;--surface:#161F29;--ink:#E6EBF0;--mut:#93A1B1;--line:#2A3745;--track:#7FA8F0;--pass:#4CC2AC;--bad:#FF7A70;--warn:#E3B04B;--halo:rgba(255,122,112,.2)}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.55 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:48px 24px 96px}
h1{font-size:clamp(30px,5vw,52px);line-height:1.08;font-weight:800;letter-spacing:-.02em;margin:0 0 14px;max-width:18em}
h2{font-size:22px;font-weight:800;margin:56px 0 12px;letter-spacing:-.01em}h3{font-size:17px;margin:28px 0 6px}h4{font-size:14px;margin:0 0 6px;font-weight:600;color:var(--mut)}
.target{color:var(--mut);margin:0 0 18px;font-size:15px}.lede{font-size:18px;max-width:40em;margin:0;color:var(--ink)}
code,pre{font-family:"Spline Sans Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.small{font-size:14px;color:var(--mut)}.none{color:var(--mut)}.num{text-align:right;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--surface)}
.routemap{display:block}.routemap .edge{fill:none;stroke:var(--mut);stroke-opacity:.35;stroke-width:1.5}.routemap .edge.bad{stroke:var(--bad);stroke-opacity:.9;stroke-width:2}
.routemap .dot{fill:var(--track)}.routemap .st.bad .dot{fill:var(--bad)}.routemap .halo{fill:var(--halo);stroke:var(--bad);stroke-width:1.5}
.routemap text{fill:var(--ink);font:500 11px "Spline Sans Mono",ui-monospace,monospace}.routemap .hd{fill:var(--mut);font:400 11px "Hanken Grotesk",system-ui,sans-serif}
.finding{background:var(--surface);border:1px solid var(--line);border-left-width:5px;border-radius:4px;margin:0 0 10px}.finding.error{border-left-color:var(--bad)}.finding.suspect{border-left-color:var(--warn)}
.finding summary{cursor:pointer;display:grid;grid-template-columns:auto auto 1fr;gap:4px 14px;align-items:baseline;padding:14px 16px;list-style:none}.finding summary::-webkit-details-marker{display:none}
.finding summary:focus-visible{outline:2px solid var(--track);outline-offset:2px}
.sev{font-weight:800;color:var(--bad)}.finding.suspect .sev{color:var(--warn)}.what{font-weight:600}.where{color:var(--mut);justify-self:end}.why{grid-column:1/-1;color:var(--mut);font-size:14px}
.body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:24px;padding:4px 16px 18px}@media (max-width:760px){.body{grid-template-columns:1fr}.where{justify-self:start}}
ol{margin:0;padding-left:20px}pre{background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:12px;overflow-x:auto;max-height:320px;margin:6px 0 0}
.shot{max-width:100%;border:1px solid var(--line);border-radius:4px;display:block;margin-bottom:8px}.ev a{margin-right:16px}a{color:var(--track)}
table{border-collapse:collapse;width:100%;min-width:640px}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;font-size:15px}th{font-size:13px;color:var(--mut);font-weight:600}tr:last-child td{border-bottom:0}
.ok{color:var(--pass);font-weight:600}.no{color:var(--bad);font-weight:600}
dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px 28px;margin:0}dt{font-size:13px;color:var(--mut)}dd{margin:0;font-weight:600}
@media (prefers-reduced-motion:no-preference){.finding[open]>.body{animation:in .18s ease-out}@keyframes in{from{opacity:.4}to{opacity:1}}}
</style></head><body><main>
<header><p class="target">Crawled ${esc(d.target)} on ${esc(d.generatedAt)}.</p><h1>${esc(h)}</h1><p class="lede">${esc(lede)}</p></header>
<section><h2>Route map</h2><div class="scroll">${routeMap(d.graph)}</div><p class="small">Each dot is a page state and each line shows the click that first reached it. Red dots are where a finding was observed, and red lines are clicks that triggered an error.</p></section>
<section><h2>What broke</h2>${findings}${unconf}</section>
<section><h2>Flows</h2>${flows}</section>
<section><h2>Run details</h2><dl>${facts}${llm}</dl></section>
</main></body></html>`;
}
