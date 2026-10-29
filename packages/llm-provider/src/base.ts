import fs from 'node:fs';
import type { LlmBudget, LlmCallRecord, LlmProvider, LlmRequest, LlmResponse } from './types.js';
import { LlmBudgetError } from './types.js';

/** Pull a JSON value out of model text: strips code fences and surrounding prose. Throws if none is found. */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch { /* fall through to scan */ }
  const start = t.search(/[[{]/); if (start < 0) throw new Error('no JSON found in model output');
  const open = t[start], close = open === '{' ? '}' : ']';
  for (let end = t.lastIndexOf(close); end > start; end = t.lastIndexOf(close, end - 1)) { try { return JSON.parse(t.slice(start, end + 1)); } catch { /* shrink */ } }
  throw new Error('model output contained no parseable JSON');
}

export abstract class BaseProvider implements LlmProvider {
  abstract readonly name: string;
  readonly calls: LlmCallRecord[] = [];
  constructor(protected opts: { logPath?: string; budget?: LlmBudget } = {}) {}
  protected abstract call(req: LlmRequest, feedback?: string): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; costUsd: number; model: string }>;

  totals() { return this.calls.reduce((t, c) => ({ calls: t.calls + 1, inputTokens: t.inputTokens + c.usage.inputTokens, outputTokens: t.outputTokens + c.usage.outputTokens, costUsd: t.costUsd + c.costUsd }), { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }); }
  private record(r: LlmCallRecord) { this.calls.push(r); if (this.opts.logPath) fs.appendFileSync(this.opts.logPath, JSON.stringify(r) + '\n'); }

  async generateJson<T>(req: LlmRequest, validate: (raw: unknown) => T): Promise<LlmResponse<T>> {
    const b = this.opts.budget, t = this.totals();
    if (b?.maxCalls !== undefined && t.calls >= b.maxCalls) throw new LlmBudgetError(`LLM call budget exhausted (${b.maxCalls})`);
    if (b?.maxCostUsd !== undefined && t.costUsd >= b.maxCostUsd) throw new LlmBudgetError(`LLM cost budget exhausted ($${b.maxCostUsd})`);
    let feedback: string | undefined; let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now(); let text = '';
      try {
        const r = await this.call(req, feedback); text = r.text;
        const data = validate(extractJson(text));
        this.record({ provider: this.name, model: r.model, schemaName: req.schemaName, prompt: req.prompt, response: text, usage: r.usage, costUsd: r.costUsd, ms: Date.now() - t0, ok: true, at: new Date().toISOString() });
        return { data, usage: r.usage, costUsd: r.costUsd, raw: text };
      } catch (e) {
        lastErr = (e as Error).message; feedback = lastErr;
        this.record({ provider: this.name, model: '', schemaName: req.schemaName, prompt: req.prompt, response: text, usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, ms: Date.now() - t0, ok: false, error: lastErr, at: new Date().toISOString() });
        if ((e as { retryable?: boolean }).retryable === false) throw e;
      }
    }
    throw new Error(`${this.name}: ${req.schemaName} failed after retry: ${lastErr}`);
  }
}
