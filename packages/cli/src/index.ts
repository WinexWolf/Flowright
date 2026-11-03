#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Assertion, Flow, TargetConfig } from '@flowright/core';
import { crawl } from '@flowright/explorer/crawler';
import { graphHtml } from '@flowright/explorer';
import { analyzeApp, affectedTemplates, gitChangedFiles, shouldFail, stateDir, acceptFinding, unacceptFinding, acceptedFor, loadState, renderSuite, writeSuite, toSlack, verdict } from '@flowright/engine';
import type { Journey } from '@flowright/flow-compiler';
import { AnthropicProvider, SimulatedProvider, type LlmProvider } from '@flowright/llm-provider';
import { HeuristicPolicy, LlmPolicy, minimizeFlow, runAgent } from '@flowright/agent';
import { narrateFlow, polishNarration, renderDemo } from '@flowright/demo';
import { buildReport } from '@flowright/report';

const [cmd, ...argv] = process.argv.slice(2);
const flags = new Map<string, string>(); const pos: string[] = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const nx = argv[i + 1]; if (nx !== undefined && !nx.startsWith('--')) { flags.set(a.slice(2), nx); i++; } else flags.set(a.slice(2), 'true'); } else pos.push(a); }
const flag = (n: string, d?: string) => flags.get(n) ?? d;
const has = (n: string) => flags.get(n) === 'true';
const url = pos[0];

const HELP = `flowright: find broken front-end flows without clicking through them yourself

  flowright analyze <url>   crawl, find problems, confirm each by replay, record video + trace, write a report
      --out DIR  --config target.json  --steps 300  --time 300000
      --diff GITREF | --changed a.tsx,b.tsx   only verify what a change could affect
      --llm  --llm-forms   use a language model (needs ANTHROPIC_API_KEY); proposals are always verified by deterministic checks
      --simulate-ai   see the AI features with NO key and no model: a scripted stand-in, clearly labelled, answering through the same validators
      --no-artifacts  --no-replay  --allow-nonlocal
      --fail-on error|suspect|new|none   (default error; "new" fails only on problems that were not there last run; accepted ones never fail)
      --no-a11y  --no-keyboard   skip the accessibility / keyboard checks (on by default, every page state)
      --no-visual  --update-baseline   visual regression against .flowright/baselines (on by default; the first run just saves baselines)
      --device mobile   run everything as a phone (390x844, touch)
      --state-dir DIR   project root for .flowright/ (history, accepted findings, baselines; default: current folder)
      --export DIR   also write the discovered journeys as a plain Playwright project
      --summary-md FILE  --slack-webhook URL  --report-url URL   PR comment / Slack output (also appends to $GITHUB_STEP_SUMMARY)
  flowright accept <F-id|signature> --from RUNDIR --reason "..."   mark a finding as known and fine (it stops failing builds)
  flowright unaccept <signature>   |   flowright history   show the last runs
  flowright export --from RUNDIR --out DIR   turn the journeys of a previous run into a Playwright project
  flowright agent <url> --goal "..." --success-heading "Order confirmed"   pursue ONE goal and compile the path into a replayable flow
      [--success-url REGEX] [--success-text TEXT] [--max-steps 15] [--llm | --simulate-ai] [--out DIR]
  flowright demo <url> (--goal ... --success-heading ... | --flows flows.json --flow ID)   record a narrated product demo (mp4 + captions)
      [--device desktop|phone] [--no-zoom] [--llm] [--out DIR]
  flowright report <outDir>   re-render report.html from a previous analyze run (no recrawl)
  flowright diff (--base GITREF | --changed a,b)   show which routes a change affects
  flowright crawl <url> [--dry-run]   crawl only, write the state graph

Safety: refuses non-local hosts without --allow-nonlocal; destructive-looking actions are blocked unless the target config says "sandbox": true.
Exit codes: 0 ok, 1 confirmed problems found, 2 usage or tool error.`;

function die(msg: string, code = 2): never { console.error(msg); process.exit(code); }
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(HELP); process.exit(cmd ? 0 : 2); }

function needUrl(): string {
  if (!url) die(`missing <url>\n\n${HELP}`);
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !has('allow-nonlocal')) die(`Refusing to run against non-local host “${host}”. Pass --allow-nonlocal to confirm you own it and it is safe to click through.`);
  return url;
}
const loadCfg = (host: string): TargetConfig => flag('config') ? JSON.parse(fs.readFileSync(flag('config')!, 'utf8')) : { name: host, startPath: '/', sandbox: false };
function provider(out: string): LlmProvider | null {
  if (has('simulate-ai')) { fs.mkdirSync(out, { recursive: true }); console.log('AI is SIMULATED: no model is called and nothing is sent anywhere. Answers are scripted, but pass through the same checks a real model would.'); return new SimulatedProvider({ logPath: path.join(out, 'llm-calls.jsonl') }); }
  if (!has('llm')) return null;
  fs.mkdirSync(out, { recursive: true });
  const p = AnthropicProvider.fromEnv({ logPath: path.join(out, 'llm-calls.jsonl'), budget: { maxCalls: Number(flag('llm-max-calls', '200')) } });
  if (!p) die('--llm needs the ANTHROPIC_API_KEY environment variable. Run without --llm to use deterministic names and assertions.');
  return p;
}
function goalFromFlags() {
  const success: Assertion[] = [];
  if (flag('success-heading')) success.push({ kind: 'heading', text: flag('success-heading')! });
  if (flag('success-url')) success.push({ kind: 'url-matches', pattern: flag('success-url')! });
  if (flag('success-text')) success.push({ kind: 'text-visible', text: flag('success-text')! });
  if (!flag('goal')) die('--goal "..." is required');
  if (!success.length) die('give at least one success check: --success-heading, --success-url or --success-text (success is decided by the page, never by the model)');
  return { text: flag('goal')!, success };
}

async function main() {
  if (cmd === 'diff') {
    const files = flag('changed') ? flag('changed')!.split(',') : flag('base') ? gitChangedFiles(flag('base')!) : die('give --base GITREF or --changed a,b');
    const a = affectedTemplates(files);
    console.log(a.nothingToTest ? 'No UI-affecting changes: nothing to test.' : a.runAll ? 'A shared file changed: every flow is affected.' : `Affected routes: ${a.templates.join(', ')}`);
    for (const i of a.impacts) console.log(`  ${i.kind.padEnd(7)} ${i.file}${i.kind === 'route' ? '  ->  ' + i.template : ''}`);
    return 0;
  }
  if (cmd === 'report') {
    const dir = pos[0] ?? die('usage: flowright report <outDir>'); const f = path.join(dir, 'report-data.json');
    if (!fs.existsSync(f)) die(`${f} not found (run analyze first)`);
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(path.join(dir, 'report.html'), buildReport(data, { assets: 'link' })); fs.writeFileSync(path.join(dir, 'report.inline.html'), buildReport(data, { assets: 'inline', baseDir: dir }));
    console.log(`Re-rendered ${dir}/report.html`); return 0;
  }
  const root = flag('state-dir', process.cwd())!;
  if (cmd === 'accept') {
    const id = pos[0], from = flag('from'); if (!id || !from || !flag('reason')) die('usage: flowright accept <F-id|signature> --from RUNDIR --reason "why this is fine"');
    const f = acceptedFor(from, id); if (!f) die(`no finding “${id}” in ${from}/findings.json`);
    acceptFinding(stateDir(root), f.signature, { reason: flag('reason')!, kind: f.kind, route: f.route }); console.log(`Accepted ${f.kind} at ${f.route}. It will no longer fail builds. (${stateDir(root)}/accepted.json)`); return 0;
  }
  if (cmd === 'unaccept') { if (!pos[0]) die('usage: flowright unaccept <signature>'); console.log(unacceptFinding(stateDir(root), pos[0]) ? 'Removed.' : 'That finding was not accepted.'); return 0; }
  if (cmd === 'history') {
    const st = loadState(stateDir(root)); if (!st.runs.length) { console.log('No runs recorded yet.'); return 0; }
    for (const r of st.runs.slice(-15)) console.log(`${r.at.slice(0, 16).replace('T', ' ')}  ${r.scope.padEnd(4)}  ${String(r.findings.length).padStart(2)} findings  ${String(r.pages).padStart(3)} pages  ${r.target}`);
    console.log(`\n${Object.keys(st.accepted).length} accepted finding(s).`); return 0;
  }
  if (cmd === 'export') {
    const from = flag('from'), to = flag('out'); if (!from || !to) die('usage: flowright export --from RUNDIR --out DIR');
    const journeys = JSON.parse(fs.readFileSync(path.join(from, 'journeys.json'), 'utf8')) as Journey[]; const tcfg = JSON.parse(fs.readFileSync(path.join(from, 'target.json'), 'utf8')) as TargetConfig;
    const files = renderSuite({ name: tcfg.name, cfg: tcfg, journeys }); writeSuite(to, files); console.log(`Wrote ${files.length} files to ${to}. Run: cd ${to} && npm install && BASE_URL=${tcfg.name.startsWith('http') ? tcfg.name : 'http://localhost:3000'} npm test`); return 0;
  }
  const base = needUrl(); const cfg0 = loadCfg(new URL(base).hostname); const cfg: TargetConfig = flag('device') === 'mobile' ? { ...cfg0, device: 'mobile' } : cfg0;
  const out = flag('out', `reports/${cfg.name.replace(/[^\w.-]+/g, '_')}`)!; const budget = { maxSteps: Number(flag('steps', '300')), maxTimeMs: Number(flag('time', '300000')) };

  if (cmd === 'crawl') {
    fs.mkdirSync(out, { recursive: true });
    const res = await crawl(base, cfg, budget, { dryRun: has('dry-run'), log: m => console.log('  ' + m) });
    fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(res.graph, null, 2));
    fs.writeFileSync(path.join(out, 'graph.html'), graphHtml(`Flowright: ${cfg.name}`, res.graph, res.stats ?? {}));
    console.log(`\nstates=${res.states.length} transitions=${res.transitions.length} steps=${res.steps} time=${(res.ms / 1000).toFixed(1)}s\nwrote ${out}/graph.json and graph.html`);
    return 0;
  }

  if (cmd === 'analyze') {
    const changed = flag('changed') ? flag('changed')!.split(',') : flag('diff') ? gitChangedFiles(flag('diff')!) : undefined;
    const prov = provider(out);
    const r = await analyzeApp({ baseUrl: base, cfg, outDir: out, budget, provider: prov, llmForms: has('llm-forms') || has('simulate-ai'), changedFiles: changed, artifacts: !has('no-artifacts'), replayFlows: !has('no-replay'), log: m => console.log(m), title: `Flowright: ${cfg.name}`,
      checks: { a11y: !has('no-a11y'), keyboard: !has('no-keyboard') }, stateRoot: root, visual: has('no-visual') ? false : { update: has('update-baseline') }, exportDir: flag('export'), reportUrl: flag('report-url') });
    console.log(`\n${verdict(r.summary)}`);
    const tag = (s: string) => (s === 'new' ? 'NEW      ' : s === 'accepted' ? 'accepted ' : 'open     ');
    for (const f of r.findings) {
      console.log(`  ${f.id.padEnd(4)} ${tag(f.status)} ${f.finding.severity === 'error' ? 'BROKEN   ' : 'SUSPECTED'} ${f.finding.kind.padEnd(14)} ${f.finding.route}  ${f.finding.detail}`);
      if (process.env.GITHUB_ACTIONS && f.status !== 'accepted') console.log(`::${f.finding.severity === 'error' ? 'error' : 'warning'} title=Flowright ${f.finding.kind}::${f.finding.route}: ${f.finding.detail.replace(/\r?\n/g, ' ')}`);
    }
    if (r.fixed.length) console.log(`  Fixed since the last run: ${r.fixed.map(f => `${f.kind} at ${f.route}`).join(', ')}`);
    if (r.flowsStoppedReplaying.length) console.log(`  ${r.flowsStoppedReplaying.length} flow(s) that replayed last time no longer do: the UI changed or something regressed. Flowright never silently re-heals them.`);
    if (r.unconfirmed.length) console.log(`  (${r.unconfirmed.length} candidate(s) did not reproduce and were set aside)`);
    if (r.visual.created) console.log(`  Saved ${r.visual.created} visual baseline(s) in ${stateDir(root)}/baselines (commit them).`);
    const bad = r.flowResults.filter(f => !f.ok); console.log(`Flows: ${r.flowResults.length - bad.length}/${r.flowResults.length} replayed correctly.${prov ? ` LLM calls: ${prov.totals().calls}.` : ' No language model was used.'}`);
    console.log(`Report: ${r.reportPath}`);
    const md = fs.readFileSync(path.join(out, 'summary.md'), 'utf8');
    if (flag('summary-md')) fs.writeFileSync(flag('summary-md')!, md);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    if (flag('slack-webhook')) { try { const res = await fetch(flag('slack-webhook')!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toSlack(r.summary)) }); console.log(res.ok ? 'Posted to Slack.' : `Slack returned ${res.status}`); } catch (e) { console.log(`Could not post to Slack: ${(e as Error).message}`); } }
    return shouldFail(r, flag('fail-on', 'error') as 'error' | 'suspect' | 'new' | 'none') ? 1 : 0;
  }

  const browser = await chromium.launch();
  try {
    if (cmd === 'agent') {
      const prov = provider(out); const goal = goalFromFlags();
      const r = await runAgent(browser, base, cfg, goal, prov ? new LlmPolicy(prov) : new HeuristicPolicy(), { maxSteps: Number(flag('max-steps', '15')), maxMs: Number(flag('time', '120000')) });
      for (const s of r.steps) console.log(`  ${String(s.n).padStart(2)}. ${s.chose}${s.error ? '   (failed: ' + s.error + ')' : ''}`);
      console.log(r.succeeded ? `\nGoal reached in ${r.path.length} step(s).` : `\nGoal NOT reached (${r.stopReason}).${r.failedAssertions.length ? ' ' + r.failedAssertions.join('; ') : ''}`);
      if (r.flow && !has('no-minimize')) { const m = await minimizeFlow(browser, base, cfg, r.flow, goal.success); r.flow = m.flow; console.log(`Minimized: dropped ${m.removed} unnecessary step(s) (${m.replays} verification replays), ${m.flow.steps.length} remain.`); }
      if (r.flow) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'agent-flow.json'), JSON.stringify(r.flow, null, 2)); console.log(`Compiled flow: ${out}/agent-flow.json (replays with no AI)`); }
      return r.succeeded ? 0 : 1;
    }
    if (cmd === 'demo') {
      const prov = provider(out); let flow: Flow | undefined;
      if (flag('flows')) { const all = JSON.parse(fs.readFileSync(flag('flows')!, 'utf8')) as Flow[]; flow = all.find(f => f.id === flag('flow')); if (!flow) die(`flow “${flag('flow')}” not found in ${flag('flows')}; ids: ${all.map(f => f.id).slice(0, 20).join(', ')}`); }
      else { const g = goalFromFlags(); const r = await runAgent(browser, base, cfg, g, prov ? new LlmPolicy(prov) : new HeuristicPolicy(), { maxSteps: Number(flag('max-steps', '15')), maxMs: 120000 }); if (!r.flow) die(`could not reach the goal (${r.stopReason}); nothing to record`, 1); flow = r.flow; if (!has('no-minimize')) { const m = await minimizeFlow(browser, base, cfg, flow, g.success); flow = m.flow; console.log(`  minimized: dropped ${m.removed} detour step(s)`); } }
      let narration = narrateFlow(flow);
      if (prov) { const p = await polishNarration(prov, narration, flow); narration = p.lines; if (p.rejected) console.log(`  ${p.rejected} rewritten line(s) dropped a control name and were kept as originally written`); }
      const d = await renderDemo(browser, base, cfg, flow, { outDir: out, device: flag('device') === 'phone' ? 'phone' : 'desktop', zoom: !has('no-zoom'), narration, log: m => console.log('  ' + m) });
      console.log(`\nDemo recorded (${(d.durationMs / 1000).toFixed(0)}s, ${d.steps} steps): ${d.mp4 ?? d.webm}\nCaptions: ${d.vtt}\nScript: ${d.script}`);
      return 0;
    }
  } finally { await browser.close().catch(() => {}); }
  die(`unknown command “${cmd}”\n\n${HELP}`);
}
main().then(c => process.exit(c ?? 0), e => { console.error(`error: ${(e as Error).message}`); process.exit(2); });
