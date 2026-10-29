import { describe, it, expect } from 'vitest';
import { ScriptedProvider } from '@flowright/llm-provider';
import { describeAction, narrateFlow, polishNarration } from '../src/narrate.js';
import { captionMs, toSrt, toVtt } from '../src/timing.js';
import type { Action, Flow } from '@flowright/core';

const click = (role: string, name: string): Action => ({ kind: 'click', role, name, nth: 0, css: 'x', label: `click ${role} "${name}"` });
const form = (variant: 'valid' | 'empty' | 'invalid'): Action => ({ kind: 'form', variant, label: 'f', formKey: 'k', method: 'POST', fields: [{ name: 'name', type: 'text', label: 'Full name', required: false, css: '#a' }, { name: 'email', type: 'email', label: 'Email:', required: false, css: '#b' }, { name: 'ok', type: 'checkbox', label: 'Agree', required: false, css: '#c' }], submit: { role: 'button', name: 'Place order', nth: 0, css: '#s' } } as Action);
const flow = (steps: Action[], o: Partial<Flow> = {}): Flow => ({ id: 'f', name: '/order/1 — Order confirmed', startPath: '/', steps, expect: { route: '/order/1', treeHash: '', overlay: '', heading: 'Order confirmed' }, ...o });

describe('narration (deterministic)', () => {
  it('describes each kind of action in plain words', () => {
    expect(describeAction(click('link', 'Products'))).toBe('Open “Products”.');
    expect(describeAction(click('button', 'Add to cart'))).toBe('Press “Add to cart”.');
    expect(describeAction(click('tab', 'Open'))).toBe('Switch to the “Open” tab.');
    expect(describeAction(click('link', 'Cart (3)'))).toBe('Open “Cart”.');                // dynamic counts are not narrated
    expect(describeAction(form('valid'))).toBe('Fill in full name and email, then press “Place order”.');   // checkbox omitted, colon stripped
    expect(describeAction(form('empty'))).toContain('without filling anything in');
  });
  it('wraps the steps in an intro and an outro that name the destination', () => {
    const l = narrateFlow(flow([click('link', 'Products')]));
    expect(l).toHaveLength(3); expect(l[0].text).toBe('Here’s how to get to “Order confirmed”.'); expect(l[0].step).toBeNull(); expect(l[1].step).toBe(0); expect(l[2].text).toContain('Order confirmed');
  });
  it('a goal-driven (agent) flow is introduced as a task and closes on the page it reached', () => {
    const l = narrateFlow(flow([click('link', 'About')], { id: 'agent', name: 'open the about page', intent: { name: 'open the about page', intent: 'Open the about page.', assertions: [] }, expect: { route: '/about', treeHash: '', overlay: '', heading: 'About us' } }));
    expect(l[0].text).toBe('Here’s how to open the about page.'); expect(l[l.length - 1].text).toBe('And that’s “About us”.');
  });
  it('prefers the intent name when a flow has one', () => { expect(narrateFlow(flow([], { intent: { name: 'Place an order', intent: '', assertions: [] } }))[0].text).toContain('Place an order'); });
});

describe('polishNarration keeps narration truthful', () => {
  const lines = narrateFlow(flow([click('link', 'Products'), click('button', 'Add to cart')]));
  it('accepts friendlier wording that keeps every quoted control name', async () => {
    const p = new ScriptedProvider(() => ({ lines: ['Let’s head to “Order confirmed”.', 'First, open “Products”.', 'Now hit “Add to cart”.', 'And there’s “Order confirmed”.'] }));
    const r = await polishNarration(p, lines, flow([])); expect(r.rejected).toBe(0); expect(r.lines[1].text).toBe('First, open “Products”.');
  });
  it('REJECTS a rewrite that drops or renames a control (falls back to the accurate line)', async () => {
    const p = new ScriptedProvider(() => ({ lines: [lines[0].text, 'Click the shop button.', lines[2].text, lines[3].text] }));
    const r = await polishNarration(p, lines, flow([])); expect(r.rejected).toBe(1); expect(r.lines[1].text).toBe(lines[1].text);
  });
  it('a wrong number of lines is an error, not a guess', async () => {
    await expect(polishNarration(new ScriptedProvider(() => ({ lines: ['only one'] })), lines, flow([]))).rejects.toThrow();
  });
});

describe('timing and caption files', () => {
  it('captions stay up long enough to read, never under 1.8 s', () => {
    expect(captionMs('Open “Products”.')).toBeGreaterThanOrEqual(1800);
    expect(captionMs('word '.repeat(30))).toBeGreaterThan(captionMs('word '.repeat(10)));
  });
  it('writes valid WebVTT and SRT', () => {
    const cues = [{ start: 0, end: 2500, text: 'Hello' }, { start: 3_661_005, end: 3_663_000, text: 'Later' }];
    expect(toVtt(cues)).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello\n\n01:01:01.005 --> 01:01:03.000\nLater\n');
    expect(toSrt(cues)).toContain('1\n00:00:00,000 --> 00:00:02,500\nHello'); expect(toSrt(cues)).toContain('2\n01:01:01,005');
  });
});
