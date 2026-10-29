import type { FormGroup, TargetConfig } from '@flowright/core';
import type { LlmProvider } from '@flowright/llm-provider';

/** Ask a model for realistic values for form fields. Only values for fields that really exist are accepted. */
export async function suggestFieldValues(provider: LlmProvider, forms: Pick<FormGroup, 'key' | 'fields'>[], app = 'a web app'): Promise<Record<string, string>> {
  const fields = forms.flatMap(f => f.fields.map(x => ({ form: f.key, name: x.name, type: x.type, label: x.label, required: x.required, options: x.options })));
  const textual = fields.filter(f => !['checkbox', 'radio', 'select'].includes(f.type));
  if (!textual.length) return {};
  const known = new Set(textual.map(f => f.name));
  const { data } = await provider.generateJson({
    schemaName: 'form-values',
    system: 'You generate realistic, harmless test data for web forms. Reply with JSON only.',
    prompt: `The app is ${app}. For each field below give ONE realistic VALID value that a real user would type, so the form can be submitted successfully.\nFields: ${JSON.stringify(textual)}\nReply as {"values": {"<field name>": "<value>"}}. Use only the field names listed.`,
  }, raw => {
    const v = (raw as { values?: unknown })?.values;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('expected {"values": {name: string}}');
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (known.has(k) && typeof val === 'string' && val.length <= 200) out[k] = val;
    return out;
  });
  return data;
}

/** Merge suggestions into a target config. Precedence: the user's explicit fieldValues > model suggestions. */
export function withFieldValues(cfg: TargetConfig, suggestions: Record<string, string>): TargetConfig {
  return { ...cfg, fieldValues: { ...suggestions, ...(cfg.fieldValues ?? {}) } };
}
