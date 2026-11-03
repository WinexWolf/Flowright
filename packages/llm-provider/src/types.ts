export interface LlmRequest { schemaName: string; prompt: string; system?: string; maxTokens?: number }
export interface LlmUsage { inputTokens: number; outputTokens: number }
export interface LlmResponse<T> { data: T; usage: LlmUsage; costUsd: number; raw: string }
export interface LlmCallRecord { provider: string; model: string; schemaName: string; prompt: string; response: string; usage: LlmUsage; costUsd: number; ms: number; ok: boolean; error?: string; at: string }

/** The only way anything in Flowright talks to a model. Swap providers without touching callers. */
export interface LlmProvider {
  readonly name: string;
  /** true for the built-in stand-in: no model is called and every result must be labelled as simulated. */
  readonly simulated?: boolean;
  /** Ask for JSON and VALIDATE it. `validate` must throw on malformed data; the provider retries once with the error fed back. */
  generateJson<T>(req: LlmRequest, validate: (raw: unknown) => T): Promise<LlmResponse<T>>;
  readonly calls: LlmCallRecord[];
  totals(): { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
}
export class LlmError extends Error { constructor(msg: string, readonly status?: number, readonly retryable = false) { super(msg); } }
export class LlmBudgetError extends Error {}
export interface LlmBudget { maxCalls?: number; maxCostUsd?: number }
