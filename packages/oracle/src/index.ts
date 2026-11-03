import { analyze } from './analyze.js';
import { analyzeChecks } from './checks.js';
import type { CrawlGraph, OracleFinding } from '@flowright/core';
export * from './analyze.js';
export * from './assertions.js';
export { analyzeChecks } from './checks.js';
/** Every deterministic finding: browser signals, form probes, accessibility and keyboard. */
export const analyzeEverything = (g: CrawlGraph): OracleFinding[] => [...analyze(g), ...analyzeChecks(g)];
