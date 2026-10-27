import type { ExplorationResult } from '@flowright/core';
/** Placeholder explorer: visits nothing. Establishes the floor of the benchmark. */
export async function noopExplorer(): Promise<ExplorationResult> {
  return { explorer: 'noop', states: [], transitions: [], steps: 0, ms: 0, costUsd: 0 };
}
