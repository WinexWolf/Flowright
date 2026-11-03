import fs from 'node:fs';
import path from 'node:path';

export interface RunRecord { at: string; target: string; scope: 'full' | 'diff'; budgetHit: boolean; findings: string[]; flows: Record<string, boolean>; pages: number }
export interface AcceptedEntry { reason: string; at: string; kind: string; route: string }
export interface ProjectState { runs: RunRecord[]; accepted: Record<string, AcceptedEntry> }
export type Status = 'new' | 'persisting' | 'accepted';

/** The project's memory lives in a small folder you can commit (.flowright/): run history, accepted findings, visual baselines. */
export const stateDir = (root: string) => path.join(root, '.flowright');
export function loadState(dir: string): ProjectState {
  const read = <T>(f: string, d: T): T => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T; } catch { return d; } };
  return { runs: read<RunRecord[]>('history.json', []), accepted: read<Record<string, AcceptedEntry>>('accepted.json', {}) };
}
export function saveState(dir: string, st: ProjectState): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'history.json'), JSON.stringify(st.runs.slice(-50), null, 2));
  fs.writeFileSync(path.join(dir, 'accepted.json'), JSON.stringify(st.accepted, null, 2));
}

/** accepted (a human said "known, fine") > persisting (seen last run too) > new. */
export function classify(signatures: string[], prev: RunRecord | undefined, accepted: Record<string, AcceptedEntry>): Map<string, Status> {
  const before = new Set(prev?.findings ?? []); const m = new Map<string, Status>();
  for (const s of signatures) m.set(s, accepted[s] ? 'accepted' : before.has(s) ? 'persisting' : 'new');
  return m;
}
/**
 * Findings that were there last time and are gone now. Only claimed when BOTH runs were full crawls that finished within budget:
 * a partial or PR-scoped run simply didn't look at everything, and "fixed" would be a guess.
 */
export function fixedSince(prev: RunRecord | undefined, now: Pick<RunRecord, 'scope' | 'budgetHit' | 'findings'>): string[] {
  if (!prev || prev.scope !== 'full' || prev.budgetHit || now.scope !== 'full' || now.budgetHit) return [];
  const cur = new Set(now.findings); return prev.findings.filter(s => !cur.has(s));
}
export function flowChanges(prev: RunRecord | undefined, now: Record<string, boolean>) {
  const stopped: string[] = [], started: string[] = [];
  for (const [id, ok] of Object.entries(now)) { const was = prev?.flows[id]; if (was === true && !ok) stopped.push(id); if (was === false && ok) started.push(id); }
  return { stopped, started };
}
export function acceptFinding(dir: string, signature: string, meta: { reason: string; kind: string; route: string }): void {
  const st = loadState(dir); st.accepted[signature] = { ...meta, at: new Date().toISOString() }; saveState(dir, st);
}
export function unacceptFinding(dir: string, signature: string): boolean {
  const st = loadState(dir); if (!st.accepted[signature]) return false; delete st.accepted[signature]; saveState(dir, st); return true;
}

/** Resolve a finding id (F3) or a raw signature to its signature using a previous run's findings.json. */
export function acceptedFor(runDir: string, idOrSignature: string): { signature: string; kind: string; route: string } | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8')) as { confirmed: { id: string; signature: string; kind: string; route: string }[] };
    return j.confirmed.find(f => f.id === idOrSignature || f.signature === idOrSignature);
  } catch { return undefined; }
}
