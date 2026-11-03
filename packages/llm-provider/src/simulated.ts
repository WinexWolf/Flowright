import { BaseProvider } from './base.js';
import type { LlmRequest } from './types.js';

const STOP = new Set(['the', 'and', 'to', 'of', 'in', 'on', 'my', 'it', 'for', 'then', 'with']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)).map(w => w.replace(/s$/, ''));   // crude plural matching: product == products
const grab = (prompt: string, re: RegExp): unknown => { const m = re.exec(prompt); if (!m) throw new Error('simulated provider could not read the prompt'); return JSON.parse(m[1]); };

const nameFor = (heading: string, via: string, alert: string): string => {
  if (/order confirmed|thank you/i.test(heading)) return 'Place an order';
  if (/message sent/i.test(heading)) return 'Send a message';
  if (/my account|welcome back/i.test(heading)) return 'Log in';
  if (/cart/i.test(heading)) return 'Review the cart';
  if (alert) return `Submit the form with a mistake`;
  if (/^form /.test(via)) return `Submit the form: ${heading}`;
  return heading ? `Visit “${heading}”` : 'Open a page';
};

/**
 * A stand-in for a language model that needs no key and makes NO network call: rule-based, deterministic, and clearly labelled "simulated" everywhere it shows up.
 * It exists so you can see the AI-assisted features end to end: its answers go through exactly the same validators as a real model's would.
 * With `hallucinate` on (the default) it deliberately proposes one made-up check per couple of flows, so you can watch the grounding guard reject it.
 */
export class SimulatedProvider extends BaseProvider {
  readonly name = 'simulated'; readonly simulated = true;
  constructor(private o: { hallucinate?: boolean; logPath?: string } = {}) { super({ logPath: o.logPath }); }

  protected async call(req: LlmRequest) {
    const out = this.answer(req); const text = JSON.stringify(out);
    return { text, usage: { inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: Math.ceil(text.length / 4) }, costUsd: 0, model: 'simulated' };
  }

  private answer(req: LlmRequest): unknown {
    switch (req.schemaName) {
      case 'flow-labels': {
        const states = grab(req.prompt, /States: (\[.*\])\nReply/s) as { id: string; route: string; heading: string; via: string; alert: string }[];
        const hall = this.o.hallucinate !== false;
        return { flows: states.map((s, i) => {
          const name = nameFor(s.heading, s.via, s.alert);
          const assertions: unknown[] = [];
          if (s.heading) assertions.push({ kind: 'heading', text: s.heading });
          assertions.push({ kind: 'url-matches', pattern: `^${s.route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\d+/g, '\\d+')}$` });
          if (hall && i % 2 === 0) assertions.push(i % 4 === 0 ? { kind: 'text-visible', text: 'Free shipping applied' } : { kind: 'alert-contains', text: 'Payment failed' });
          return { id: s.id, name, intent: `A user can ${name.charAt(0).toLowerCase()}${name.slice(1)}`, assertions };
        }) };
      }
      case 'form-values': {
        const fields = grab(req.prompt, /Fields: (\[.*\])\nReply/s) as { name: string; type: string; label: string }[]; const values: Record<string, string> = {};
        for (const f of fields) { const h = `${f.name} ${f.label}`.toLowerCase();
          values[f.name] = f.type === 'email' || /e-?mail/.test(h) ? 'priya.raman@example.com' : /name/.test(h) ? 'Priya Raman' : /phone/.test(h) ? '415 555 0142' : /address/.test(h) ? '221 Market Street' : /search|query|^q$/.test(h) ? 'headphones' : /message|comment/.test(h) ? 'Hello, I have a question about my order.' : f.type === 'password' ? 'Correct-horse-9' : 'Sample value'; }
        return { values };
      }
      case 'agent-step': {
        const goal = new Set(words(String(/Goal: (.*)\n/.exec(req.prompt)?.[1] ?? '')));
        const list = grab(req.prompt, /Available actions: (\[.*\])\n/s) as { i: number; what: string; kind?: string; href?: string }[];
        const taken = String(/Steps already taken: (.*)\n/.exec(req.prompt)?.[1] ?? '');
        let best = 0, bestScore = -Infinity, why = 'no obvious match';
        for (const a of list) {
          const ov = [...new Set(words(`${a.what} ${a.href ?? ''}`))].filter(w => goal.has(w)); const tried = taken.includes(a.what);   // the link's ADDRESS counts too: /products/1 says "product"
          // word overlap with the goal, a nudge toward pages not yet visited, forms (how goals complete), and a penalty for repeating a click
          // a detail page (/products/1) beats a filter (/products?category=audio): go DEEPER toward the goal, not sideways
          const path = (a.href ?? '').split('?')[0].split('#')[0].split('/').filter(Boolean).length, filter = (a.href ?? '').includes('?') ? 0.3 : 0;
          const sc = ov.length * 2 + (a.href ? (tried ? -0.75 : 0.5) + path * 0.3 - filter : 0) + (a.kind === 'form' ? 0.75 : 0) - (tried ? 3 : 0);
          if (sc > bestScore) { bestScore = sc; best = a.i; why = ov.length ? `“${a.what.slice(0, 40)}” mentions ${ov.join(', ')}, which the goal asks for` : a.kind === 'form' ? `“${a.what.slice(0, 40)}” is a form, and goals usually finish by submitting one` : tried ? 'everything left was already tried' : `nothing matches the goal yet, so exploring “${a.what.slice(0, 40)}”`; }
        }
        return { choice: best, reason: why };
      }
      case 'narration': {
        const lines = grab(req.prompt, /Lines: (\[.*\])\n/s) as string[];
        return { lines: lines.map(l => l.replace(/^Open /, 'Head over to ').replace(/^Press /, 'Click ').replace(/^Here’s how to get to/, 'Let’s walk through')) };
      }
      default: throw new Error(`the simulated provider has no scripted answer for “${req.schemaName}”`);
    }
  }
}
