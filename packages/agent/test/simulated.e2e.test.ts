import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';
import { LlmPolicy, minimizeFlow, runAgent } from '../src/index.js';
import { SimulatedProvider } from '@flowright/llm-provider';
import { startApp } from '../../benchmark/src/servers.js';
import { TARGETS } from '../../benchmark/src/targets.js';
import { replayFlow } from '@flowright/replayer';

describe('the SIMULATED AI, driving a real browser (no key, no network)', () => {
  it('reaches a goal on the shop app, minimizes it, and the result replays with no AI', async () => {
    const shop = await startApp('shop'); const browser = await chromium.launch(); const cfg = TARGETS.shop; const sim = new SimulatedProvider();
    try {
      const goal = { text: 'add a product to the cart, proceed to checkout and place the order', success: [{ kind: 'heading' as const, text: 'Order confirmed' }] };
      const r = await runAgent(browser, shop.baseUrl, cfg, goal, new LlmPolicy(sim), { maxSteps: 15 });
      expect(r.succeeded, 'the simulated agent must reach the goal the heuristic one reaches').toBe(true);
      expect(sim.calls.length).toBeGreaterThan(0); expect(sim.totals().costUsd).toBe(0);
      const m = await minimizeFlow(browser, shop.baseUrl, cfg, r.flow!, goal.success);
      expect(m.flow.steps.length).toBeLessThanOrEqual(5);
      expect((await replayFlow(browser, shop.baseUrl, cfg, m.flow)).ok).toBe(true);
    } finally { await browser.close(); await shop.stop(); }
  });
  it('an impossible goal ends honestly: not reached, no flow invented', async () => {
    const shop = await startApp('shop'); const browser = await chromium.launch(); const cfg = TARGETS.shop;
    try {
      const r = await runAgent(browser, shop.baseUrl, cfg, { text: 'reset my password', success: [{ kind: 'heading' as const, text: 'Password reset' }] }, new LlmPolicy(new SimulatedProvider()), { maxSteps: 6 });
      expect(r.succeeded).toBe(false);
    } finally { await browser.close(); await shop.stop(); }
  });
});
