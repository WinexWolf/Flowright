import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';
import { HeuristicPolicy, minimizeFlow, runAgent } from '../src/index.js';
import { startApp } from '../../benchmark/src/servers.js';
import { TARGETS } from '../../benchmark/src/targets.js';
import { replayFlow } from '@flowright/replayer';

describe('flow minimization (real browser)', () => {
  it('turns a wandering agent path into the short path, and the short path still replays', async () => {
    const shop = await startApp('shop'); const browser = await chromium.launch(); const cfg = TARGETS.shop;
    try {
      const goal = { text: 'add a product to the cart, proceed to checkout and place the order', success: [{ kind: 'heading' as const, text: 'Order confirmed' }] };
      const r = await runAgent(browser, shop.baseUrl, cfg, goal, new HeuristicPolicy(), { maxSteps: 14 });
      expect(r.succeeded).toBe(true);
      const m = await minimizeFlow(browser, shop.baseUrl, cfg, r.flow!, goal.success);
      expect(m.flow.steps.length).toBeLessThan(r.flow!.steps.length);
      expect(m.flow.steps.length).toBeLessThanOrEqual(5);                       // product -> add to cart -> checkout -> form (+ at most one more)
      expect(m.removed).toBe(r.flow!.steps.length - m.flow.steps.length);
      expect((await replayFlow(browser, shop.baseUrl, cfg, m.flow)).ok).toBe(true);
    } finally { await browser.close(); await shop.stop(); }
  });
  it('a flow that is already minimal is returned unchanged', async () => {
    const shop = await startApp('shop'); const browser = await chromium.launch(); const cfg = TARGETS.shop;
    try {
      const goal = { text: 'open about', success: [{ kind: 'heading' as const, text: 'About us' }] };
      const r = await runAgent(browser, shop.baseUrl, cfg, goal, new HeuristicPolicy(), { maxSteps: 6 });
      const m = await minimizeFlow(browser, shop.baseUrl, cfg, r.flow!, goal.success);
      expect(m.flow.steps.length).toBe(1);
    } finally { await browser.close(); await shop.stop(); }
  });
});
