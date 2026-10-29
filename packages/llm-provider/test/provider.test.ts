import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { AnthropicProvider, ScriptedProvider, extractJson, LlmBudgetError } from '../src/index.js';

const okBody = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
const asObj = (r: unknown) => { if (!r || typeof r !== 'object') throw new Error('not an object'); return r as { a: number }; };

describe('extractJson', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here you go: {"a":[1,2]} hope it helps')).toEqual({ a: [1, 2] });
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });
  it('throws when there is no JSON', () => { expect(() => extractJson('no json here')).toThrow(); });
});

describe('AnthropicProvider (faked network; NOT the live API)', () => {
  it('sends the right request and returns validated data with usage', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const p = new AnthropicProvider({ apiKey: 'k', model: 'm', fetchImpl: (async (url: string, init: RequestInit) => { seen = { url, init }; return okBody('{"a":1}'); }) as unknown as typeof fetch });
    const r = await p.generateJson({ schemaName: 's', prompt: 'hi', system: 'sys' }, asObj);
    expect(r.data).toEqual({ a: 1 }); expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages');
    const h = seen!.init.headers as Record<string, string>; expect(h['x-api-key']).toBe('k'); expect(h['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(seen!.init.body as string)).toMatchObject({ model: 'm', system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
  });
  it('retries once when the JSON is invalid, feeding the error back', async () => {
    const bodies: string[] = [];
    const replies = ['this is not json', '{"a":2}'];
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: (async (_u: string, init: RequestInit) => { bodies.push(init.body as string); return okBody(replies.shift()!); }) as unknown as typeof fetch });
    const r = await p.generateJson({ schemaName: 's', prompt: 'hi' }, asObj);
    expect(r.data.a).toBe(2); expect(bodies).toHaveLength(2); expect(bodies[1]).toContain('previous reply was rejected');
    expect(p.calls.map(c => c.ok)).toEqual([false, true]);
  });
  it('gives up with a clear error after the retry also fails', async () => {
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: (async () => okBody('nope')) as unknown as typeof fetch });
    await expect(p.generateJson({ schemaName: 's', prompt: 'hi' }, asObj)).rejects.toThrow(/failed after retry/);
  });
  it('retries a 500 once, then succeeds', async () => {
    let n = 0;
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: (async () => (++n === 1 ? new Response('boom', { status: 500 }) : okBody('{"a":3}'))) as unknown as typeof fetch });
    expect((await p.generateJson({ schemaName: 's', prompt: 'x' }, asObj)).data.a).toBe(3); expect(n).toBe(2);
  });
  it('does not retry a 401 and surfaces it', async () => {
    let n = 0;
    const p = new AnthropicProvider({ apiKey: 'bad', fetchImpl: (async () => { n++; return new Response('unauthorized', { status: 401 }); }) as unknown as typeof fetch });
    await expect(p.generateJson({ schemaName: 's', prompt: 'x' }, asObj)).rejects.toThrow(/401/); expect(n).toBe(1);
  });
  it('reports cost only when pricing is supplied (never invents prices)', async () => {
    const mk = (pricing?: { inputPerMTok: number; outputPerMTok: number }) => new AnthropicProvider({ apiKey: 'k', pricing, fetchImpl: (async () => okBody('{"a":1}')) as unknown as typeof fetch });
    expect((await mk().generateJson({ schemaName: 's', prompt: 'x' }, asObj)).costUsd).toBe(0);
    expect((await mk({ inputPerMTok: 1_000_000, outputPerMTok: 2_000_000 }).generateJson({ schemaName: 's', prompt: 'x' }, asObj)).costUsd).toBe(20);
  });
  it('fromEnv returns null without a key', () => { const k = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; expect(AnthropicProvider.fromEnv()).toBeNull(); if (k) process.env.ANTHROPIC_API_KEY = k; });
});

describe('call log and budget', () => {
  it('appends every call (inputs, outputs, usage) to a JSONL log', async () => {
    const f = path.join(os.tmpdir(), `fr-llm-${Date.now()}.jsonl`);
    const p = new ScriptedProvider(() => ({ a: 1 }), { logPath: f });
    await p.generateJson({ schemaName: 'x', prompt: 'hello' }, asObj);
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(1); expect(lines[0]).toMatchObject({ schemaName: 'x', prompt: 'hello', ok: true });
    expect(p.totals().calls).toBe(1);
  });
  it('enforces a call budget', async () => {
    const p = new ScriptedProvider(() => ({ a: 1 })); (p as unknown as { opts: unknown }).opts = { budget: { maxCalls: 1 } };
    await p.generateJson({ schemaName: 'x', prompt: 'a' }, asObj);
    await expect(p.generateJson({ schemaName: 'x', prompt: 'b' }, asObj)).rejects.toBeInstanceOf(LlmBudgetError);
  });
});
