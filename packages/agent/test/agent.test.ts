import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { ScriptedProvider } from '@flowright/llm-provider';
import { HeuristicPolicy, LlmPolicy, runAgent, type Policy } from '../src/index.js';
import { startApp, type RunningApp } from '../../benchmark/src/servers.js';
import { TARGETS } from '../../benchmark/src/targets.js';
import { replayFlow } from '@flowright/replayer';
import type { Evidence } from '@flowright/core';
import type { Candidate } from '@flowright/explorer';

let browser: Browser; let shop: RunningApp;
beforeAll(async () => { browser = await chromium.launch(); shop = await startApp('shop'); }, 30000);
afterAll(async () => { await browser.close(); await shop.stop(); });
const cfg = TARGETS.shop;
const ev = (): Evidence => ({ route: '/', title: '', headings: [], textSample: '', alerts: [], dialogs: [], selectedTabs: [], overflowX: false, brokenImages: 0, emptyMain: false });
const cand = (label: string, href?: string): Candidate => ({ action: { kind: 'click', role: 'link', name: label, nth: 0, css: 'a', label: `click link "${label}"` }, text: label, href });

describe('policies (unit)', () => {
  it('heuristic prefers goal-matching, unvisited, not-yet-tried actions', async () => {
    const p = new HeuristicPolicy();
    const c = [cand('About', '/about'), cand('Add to cart', '/cart/add'), cand('Contact', '/contact')];
    expect((await p.choose({ goal: 'add a product to the cart', evidence: ev(), candidates: c, history: [], visitedRoutes: new Set() })).index).toBe(1);
    expect((await p.choose({ goal: 'add a product to the cart', evidence: ev(), candidates: c, history: ['click link "Add to cart"'], visitedRoutes: new Set(['/cart/add']) })).index).not.toBe(1);
  });
  it('LLM policy validates the model’s index (never guesses)', async () => {
    const c = [cand('A'), cand('B')];
    const good = new LlmPolicy(new ScriptedProvider(() => ({ choice: 1, reason: 'B is closer' })));
    expect((await good.choose({ goal: 'g', evidence: ev(), candidates: c, history: [], visitedRoutes: new Set() })).index).toBe(1);
    const bad = new LlmPolicy(new ScriptedProvider(() => ({ choice: 7 })));
    await expect(bad.choose({ goal: 'g', evidence: ev(), candidates: c, history: [], visitedRoutes: new Set() })).rejects.toThrow();
  });
});

describe('agent on the real shop app', () => {
  const goal = { text: 'add a product to the cart, proceed to checkout and place the order', success: [{ kind: 'heading' as const, text: 'Order confirmed' }, { kind: 'url-matches' as const, pattern: '^/order/\\d+$' }] };

  it('reaches the goal with the offline heuristic policy and compiles a flow that REPLAYS with no AI', async () => {
    const r = await runAgent(browser, shop.baseUrl, cfg, goal, new HeuristicPolicy(), { maxSteps: 14, maxMs: 90000 });
    expect(r.stopReason).toBe('goal-reached'); expect(r.succeeded).toBe(true);
    expect(r.finalEvidence?.headings).toContain('Order confirmed');
    expect(r.flow!.steps.length).toBeGreaterThanOrEqual(3);
    const rep = await replayFlow(browser, shop.baseUrl, cfg, r.flow!);
    expect(rep.ok).toBe(true);
  }, 120000);

  it('stops at the step budget instead of looping forever, and says why', async () => {
    const r = await runAgent(browser, shop.baseUrl, cfg, { text: 'x', success: [{ kind: 'heading', text: 'A heading that never exists' }] }, new HeuristicPolicy(), { maxSteps: 3 });
    expect(r.succeeded).toBe(false); expect(['step-budget', 'stuck']).toContain(r.stopReason); expect(r.failedAssertions.length).toBeGreaterThan(0);
  }, 60000);

  it('a policy that returns a bad index is stopped safely', async () => {
    const evil: Policy = { name: 'evil', choose: async () => ({ index: 999, reason: 'oops' }) };
    const r = await runAgent(browser, shop.baseUrl, cfg, goal, evil, { maxSteps: 3 });
    expect(r.stopReason).toBe('policy-error'); expect(r.error).toContain('invalid index');
  }, 60000);

  it('never takes a blocklisted action even if the policy asks for it (non-sandbox target)', async () => {
    const strict = { ...cfg, sandbox: false };
    const picked: string[] = [];
    const spy: Policy = { name: 'spy', choose: async i => { i.candidates.forEach(c => picked.push(c.action.label)); return { index: 0, reason: '' }; } };
    await runAgent(browser, shop.baseUrl, strict, goal, spy, { maxSteps: 6 });
    expect(picked.some(l => /remove|place order|log ?out/i.test(l))).toBe(false);
  }, 60000);
});
