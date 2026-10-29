import { BaseProvider } from './base.js';
import { LlmError, type LlmBudget, type LlmRequest } from './types.js';

export interface AnthropicOptions {
  apiKey: string; model?: string; baseUrl?: string; fetchImpl?: typeof fetch; logPath?: string; budget?: LlmBudget;
  /** USD per million tokens. Left unset, cost is reported as 0 and `pricingKnown` is false: we never invent prices. */
  pricing?: { inputPerMTok: number; outputPerMTok: number };
}

/** Anthropic Messages API over plain fetch (no SDK dependency). NOTE: not exercised against the live API in this repo's tests; see docs. */
export class AnthropicProvider extends BaseProvider {
  readonly name = 'anthropic';
  readonly pricingKnown: boolean;
  constructor(private cfg: AnthropicOptions) { super({ logPath: cfg.logPath, budget: cfg.budget }); this.pricingKnown = !!cfg.pricing; }

  static fromEnv(extra: Partial<AnthropicOptions> = {}): AnthropicProvider | null {
    const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) return null;
    return new AnthropicProvider({ apiKey, model: process.env.FLOWRIGHT_MODEL, ...extra });
  }

  protected async call(req: LlmRequest, feedback?: string) {
    const model = this.cfg.model ?? 'claude-sonnet-5-5';
    const f = this.cfg.fetchImpl ?? fetch;
    const prompt = feedback ? `${req.prompt}\n\nYour previous reply was rejected: ${feedback}\nReply with ONLY valid JSON matching the requested shape.` : req.prompt;
    let res: Response | undefined;
    for (let i = 0; i < 2; i++) {
      res = await f(`${this.cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: req.maxTokens ?? 1500, system: req.system, messages: [{ role: 'user', content: prompt }] }),
      });
      if (res.status === 429 || res.status >= 500) { if (i === 0) { await new Promise(r => setTimeout(r, 400)); continue; } }
      break;
    }
    const r = res!;
    if (!r.ok) throw new LlmError(`Anthropic API ${r.status}: ${(await r.text()).slice(0, 200)}`, r.status, r.status === 429 || r.status >= 500 ? true : false);
    const j = await r.json() as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (j.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
    const usage = { inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 };
    const p = this.cfg.pricing;
    const costUsd = p ? (usage.inputTokens * p.inputPerMTok + usage.outputTokens * p.outputPerMTok) / 1e6 : 0;
    return { text, usage, costUsd, model };
  }
}
