import { BaseProvider } from './base.js';
import type { LlmRequest } from './types.js';

/** Deterministic stand-in for tests and offline runs: `respond` returns the JSON the "model" would have produced. */
export class ScriptedProvider extends BaseProvider {
  readonly name = 'scripted';
  constructor(private respond: (req: LlmRequest, attempt: number) => unknown | Promise<unknown>, opts: { logPath?: string } = {}) { super(opts); }
  private attempts = new Map<string, number>();
  protected async call(req: LlmRequest, feedback?: string) {
    const n = feedback ? (this.attempts.get(req.schemaName) ?? 0) + 1 : 0; this.attempts.set(req.schemaName, n);
    const out = await this.respond(req, n);
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    return { text, usage: { inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: Math.ceil(text.length / 4) }, costUsd: 0, model: 'scripted' };
  }
}
