export interface SummaryFinding { id: string; severity: 'error' | 'suspect'; kind: string; route: string; detail: string; status: 'new' | 'persisting' | 'accepted' }
export interface RunSummary {
  title: string; target: string; pages: number; flows: { passed: number; total: number }; findings: SummaryFinding[];
  fixed: { kind: string; route: string; detail: string }[]; firstRun: boolean; visual: { changed: number; created: number }; reportUrl?: string; durationSec: number;
}
const KIND: Record<string, string> = { 'console-error': 'Console error', 'failed-request': 'Failed request', 'broken-link': 'Broken link', 'dead-click': 'Dead control', overflow: 'Sideways scroll', 'broken-image': 'Broken image', 'empty-route': 'Blank page', 'missing-validation': 'Form accepts bad input', a11y: 'Accessibility', keyboard: 'Keyboard', 'visual-change': 'Visual change' };
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const plural = (n: number, a: string, b = a + 's') => `${n} ${n === 1 ? a : b}`;

export function verdict(s: RunSummary): string {
  const live = s.findings.filter(f => f.status !== 'accepted'), fresh = live.filter(f => f.status === 'new');
  if (!live.length) return `No problems found across ${plural(s.pages, 'page')}.`;
  return s.firstRun ? `${plural(live.length, 'problem')} found.` : `${plural(fresh.length, 'new problem')}, ${live.length - fresh.length} still open.`;
}

/** Markdown for a PR comment or $GITHUB_STEP_SUMMARY. New problems first: that is what a reviewer needs to see. */
export function toMarkdown(s: RunSummary): string {
  const order = { new: 0, persisting: 1, accepted: 2 } as const;
  const rows = [...s.findings].sort((a, b) => order[a.status] - order[b.status] || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  const L = [`## ${s.title}: ${verdict(s)}`, '', `Checked ${plural(s.pages, 'page')} in ${s.durationSec < 90 ? Math.round(s.durationSec) + ' s' : Math.round(s.durationSec / 60) + ' min'}. ${s.flows.passed} of ${plural(s.flows.total, 'flow')} replayed correctly.${s.reportUrl ? ` [Open the full report](${s.reportUrl}).` : ''}`, ''];
  if (rows.length) {
    L.push('| | Severity | What | Where | Detail |', '|---|---|---|---|---|');
    for (const f of rows) L.push(`| ${f.status === 'new' ? '**new**' : f.status === 'accepted' ? 'accepted' : 'open'} | ${f.severity === 'error' ? 'Broken' : 'Suspected'} | ${KIND[f.kind] ?? f.kind} | \`${esc(f.route)}\` | ${esc(f.detail)} |`);
    L.push('');
  }
  if (s.fixed.length) L.push(`**Fixed since the last run (${s.fixed.length}):** ${s.fixed.map(f => `${KIND[f.kind] ?? f.kind} at \`${esc(f.route)}\``).join(', ')}`, '');
  if (s.visual.changed) L.push(`**Visual changes:** ${plural(s.visual.changed, 'page')} look different from the baseline.`, '');
  return L.join('\n').trimEnd() + '\n';
}

/** Slack incoming-webhook payload (Block Kit). */
export function toSlack(s: RunSummary): { text: string; blocks: unknown[] } {
  const live = s.findings.filter(f => f.status !== 'accepted'); const top = live.filter(f => f.status === 'new').concat(live.filter(f => f.status !== 'new')).slice(0, 8);
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: `${s.title}: ${verdict(s)}`.slice(0, 150) } },
    { type: 'section', text: { type: 'mrkdwn', text: `${plural(s.pages, 'page')} checked, ${s.flows.passed}/${s.flows.total} flows replay${s.fixed.length ? `, ${s.fixed.length} fixed` : ''}${s.visual.changed ? `, ${plural(s.visual.changed, 'visual change')}` : ''}.` } },
  ];
  if (top.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: top.map(f => `${f.status === 'new' ? ':red_circle:' : ':white_circle:'} *${KIND[f.kind] ?? f.kind}* at \`${f.route}\`: ${f.detail.slice(0, 120)}`).join('\n') } });
  if (s.reportUrl) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open report' }, url: s.reportUrl }] });
  return { text: `${s.title}: ${verdict(s)}`, blocks };
}
