import type { Action, Flow } from '@flowright/core';
import type { LlmProvider } from '@flowright/llm-provider';

export interface NarrationLine { text: string; step: number | null }       // step === null for the intro and outro lines

const clean = (s: string) => s.replace(/\s*\(\d+\)\s*$/, '').replace(/[:：]\s*$/, '').trim();       // "Cart (3)" -> "Cart"
const list = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function describeAction(a: Action): string {
  if (a.kind === 'click') {
    const n = clean(a.name) || 'that';
    switch (a.role) {
      case 'link': return `Open “${n}”.`;
      case 'tab': return `Switch to the “${n}” tab.`;
      case 'checkbox': case 'switch': case 'radio': return `Turn “${n}” on or off.`;
      case 'clickable': return `Select “${n}”.`;
      default: return `Press “${n}”.`;
    }
  }
  const names = a.fields.filter(f => !['checkbox', 'radio'].includes(f.type)).map(f => clean(f.label || f.name).toLowerCase()).filter(Boolean);
  const submit = a.submit ? clean(a.submit.name) : 'Enter';
  if (a.variant === 'empty') return `Press “${submit}” without filling anything in.`;
  if (a.variant === 'invalid') return `Enter something invalid and press “${submit}”.`;
  return names.length ? `Fill in ${list(names)}, then press “${submit}”.` : `Press “${submit}”.`;
}

export const flowTitle = (f: Flow) => f.intent?.name || f.expect.heading || f.name;

/** Deterministic narration: an intro, one line per step, an outro. Always accurate because it is derived from the recorded actions. */
export function narrateFlow(f: Flow): NarrationLine[] {
  const t = flowTitle(f); const end = f.expect.heading || t;
  // A flow found by the goal agent is a TASK ("buy a product"), not a place, so it is introduced as one; crawled flows are introduced by destination.
  const task = f.id === 'agent' && f.intent?.intent ? f.intent.intent.trim().replace(/[.!]+$/, '') : '';
  const intro = task ? `Here’s how to ${task.charAt(0).toLowerCase()}${task.slice(1)}.` : `Here’s how to get to “${t}”.`;
  return [{ text: intro, step: null }, ...f.steps.map((s, i) => ({ text: describeAction(s), step: i })), { text: `And that’s “${end}”.`, step: null }];
}

const quoted = (s: string) => [...s.matchAll(/“([^”]+)”/g)].map(m => m[1].toLowerCase());

/**
 * Let a model make the wording more natural. The model may rephrase but must keep every quoted control name,
 * so narration can never describe a button that does not exist. A line that drops one falls back to the deterministic text.
 */
export async function polishNarration(provider: LlmProvider, lines: NarrationLine[], f: Flow): Promise<{ lines: NarrationLine[]; rejected: number }> {
  const { data } = await provider.generateJson({
    schemaName: 'narration', system: 'You write short, friendly narration for a product demo video. Reply with JSON only.',
    prompt: `Rewrite each line to sound natural when spoken, in the same order, one sentence each, under 20 words. KEEP every quoted name (“like this”) exactly.\nFlow: ${flowTitle(f)}\nLines: ${JSON.stringify(lines.map(l => l.text))}\nReply as {"lines":["..."]}`,
  }, raw => { const a = (raw as { lines?: unknown })?.lines; if (!Array.isArray(a) || a.length !== lines.length || a.some(x => typeof x !== 'string')) throw new Error(`expected exactly ${lines.length} string lines`); return a as string[]; });
  let rejected = 0;
  const out = lines.map((l, i) => {
    const p = data[i].trim(); const keeps = quoted(l.text).every(q => p.toLowerCase().includes(q));
    if (!p || p.length > 160 || !keeps) { rejected++; return l; } return { ...l, text: p };
  });
  return { lines: out, rejected };
}
