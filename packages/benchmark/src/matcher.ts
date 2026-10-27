import type { Evidence } from '@flowright/core';

export interface LabeledState {
  id: string; route: string; heading?: string; text?: string; notText?: string;
  alert?: string; noAlert?: boolean; dialog?: string; noDialog?: boolean; selectedTab?: string;
}
export interface LabeledFlow { id: string; states: string[] }
export interface Labels { app: string; split: 'dev' | 'heldout'; states: LabeledState[]; flows: LabeledFlow[] }

const ci = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

/**
 * Does observed evidence satisfy a hand-written label?
 * Deliberately uses only user-visible evidence (route, headings, text, alerts, dialogs, tabs) and NEVER the
 * explorer's fingerprint, so coverage can't be inflated by the explorer's own idea of "same state".
 */
export function matches(l: LabeledState, ev: Evidence): boolean {
  if (!new RegExp(l.route).test(ev.route)) return false;
  if (l.heading && !ev.headings.some(h => ci(h, l.heading!))) return false;
  if (l.text && !ci(ev.textSample, l.text)) return false;
  if (l.notText && ci(ev.textSample, l.notText)) return false;
  if (l.alert && !ev.alerts.some(a => ci(a, l.alert!))) return false;
  if (l.noAlert && ev.alerts.length > 0) return false;
  if (l.dialog && !ev.dialogs.some(d => ci(d, l.dialog!))) return false;
  if (l.noDialog && ev.dialogs.length > 0) return false;
  if (l.selectedTab && !ev.selectedTabs.some(t => t.toLowerCase() === l.selectedTab!.toLowerCase())) return false;
  return true;
}
