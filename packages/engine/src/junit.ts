const x = (s: unknown) => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
export interface JFlow { name: string; ok: boolean; why?: string }
export interface JFinding { id: string; kind: string; route: string; detail: string; severity: 'error' | 'suspect' }

/** JUnit XML so any CI system can show flow replays and confirmed findings as test results. Findings are failures; flows fail when replay or assertions fail. */
export function toJUnit(suite: string, flows: JFlow[], findings: JFinding[], seconds = 0): string {
  const failures = flows.filter(f => !f.ok).length + findings.length;
  const cases = [
    ...flows.map(f => `<testcase classname="flows" name="${x(f.name)}">${f.ok ? '' : `<failure message="${x(f.why ?? 'replay failed')}"/>`}</testcase>`),
    ...findings.map(f => `<testcase classname="findings.${x(f.kind)}" name="${x(f.id + ' ' + f.route)}"><failure type="${x(f.severity)}" message="${x(f.detail)}"/></testcase>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="${x(suite)}" tests="${flows.length + findings.length}" failures="${failures}" time="${seconds.toFixed(1)}">\n${cases.join('\n')}\n</testsuite></testsuites>\n`;
}
