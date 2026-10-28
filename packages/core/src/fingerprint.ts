import { createHash } from 'node:crypto';
import type { RawNode } from './types.js';

const OVERLAY_ROLES = new Set(['dialog', 'alert', 'status', 'alertdialog']);

/** Serialise sibling lists with repetition BUCKETS: 1 stays 1, 2+ collapses to "x+". Data-driven lists don't explode states. */
function serList(nodes: RawNode[], skipOverlay: boolean): string {
  const parts: string[] = [];
  for (const n of nodes) {
    if (skipOverlay && OVERLAY_ROLES.has(n.r)) continue;
    parts.push(ser(n, skipOverlay));
  }
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let j = i; while (j < parts.length && parts[j] === parts[i]) j++;
    out.push(j - i >= 2 ? parts[i] + '+' : parts[i]);
    i = j;
  }
  return out.join(',');
}
function ser(n: RawNode, skipOverlay: boolean): string {
  return n.k && n.k.length ? `${n.r}(${serList(n.k, skipOverlay)})` : n.r;
}
function collectOverlays(nodes: RawNode[], acc: string[]): void {
  for (const n of nodes) {
    if (OVERLAY_ROLES.has(n.r)) acc.push(ser(n, false));
    else if (n.k) collectOverlays(n.k, acc);
  }
}
const h = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

export interface Fingerprint { coarse: string; fine: string; treeHash: string; overlay: string }

/**
 * Two-level state identity.
 *  coarse = URL template + structural role tree WITHOUT overlays (dialogs/alerts/status)
 *  fine   = coarse + overlay structure + which tab positions are selected
 * Text, ids, counts and data values are never part of identity.
 */
export function fingerprint(urlTemplate: string, tree: RawNode[], tabs: { selected: boolean }[] = []): Fingerprint {
  const treeStr = serList(tree, true);
  const overlays: string[] = []; collectOverlays(tree, overlays);
  const overlay = overlays.sort().join('|');
  const tabsel = tabs.map((t, i) => (t.selected ? i : -1)).filter(i => i >= 0).join('.');
  const treeHash = h(treeStr);
  const coarse = h(urlTemplate + '#' + treeHash);
  const fine = h(coarse + '#' + overlay + '#' + tabsel);
  return { coarse, fine, treeHash, overlay: overlay + '#' + tabsel };
}

/** The coarse key for a stored state (used when URL templates are learned after a state was registered). */
export function coarseFrom(urlTemplate: string, treeHash: string): string { return h(urlTemplate + '#' + treeHash); }

/** Recompute identity from stored parts (used to merge states after URL-template learning). */
export function fineFrom(urlTemplate: string, treeHash: string, overlayKey: string): string {
  const coarse = h(urlTemplate + '#' + treeHash);
  const [overlay, tabsel] = splitOverlayKey(overlayKey);
  return h(coarse + '#' + overlay + '#' + tabsel);
}
function splitOverlayKey(k: string): [string, string] { const i = k.lastIndexOf('#'); return [k.slice(0, i), k.slice(i + 1)]; }
