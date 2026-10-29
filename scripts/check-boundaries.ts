// Enforces the architecture rules in CLAUDE.md by scanning imports. Run in CI via `npm run lint:boundaries`.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..', 'packages');
const ALL = ['core', 'driver', 'explorer', 'oracle', 'flow-compiler', 'replayer', 'llm-provider', 'semantic', 'agent', 'report', 'demo', 'engine', 'benchmark', 'cli'].map(p => `@flowright/${p}`);
const only = (allowed: string[]) => ALL.filter(p => !allowed.includes(p));
const FORBIDDEN: Record<string, string[]> = {
  // ground truth: no AI, ever, and no knowledge of anything above it
  core: ALL,
  oracle: only(['@flowright/core']),
  replayer: only(['@flowright/core', '@flowright/driver', '@flowright/oracle']),
  driver: only(['@flowright/core']),
  'flow-compiler': only(['@flowright/core', '@flowright/driver']),
  'llm-provider': ALL,                                                     // the only way to reach a model; depends on nothing of ours
  report: ALL,                                                             // a pure renderer
  explorer: ['@flowright/benchmark', '@flowright/cli', '@flowright/engine', '@flowright/llm-provider', '@flowright/semantic', '@flowright/agent', '@flowright/demo'],
  semantic: ['@flowright/benchmark', '@flowright/cli', '@flowright/engine', '@flowright/explorer', '@flowright/replayer', '@flowright/agent', '@flowright/demo'],
  agent: ['@flowright/benchmark', '@flowright/cli', '@flowright/engine', '@flowright/demo'],
  demo: ['@flowright/benchmark', '@flowright/cli', '@flowright/engine', '@flowright/agent', '@flowright/explorer'],
};
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
let bad = 0, scanned = 0;
for (const [pkg, banned] of Object.entries(FORBIDDEN)) {
  const dir = path.join(root, pkg, 'src'); if (!fs.existsSync(dir)) continue;                // only src: tests may cross boundaries to build fixtures
  for (const f of walk(dir).filter(f => /\.(ts|js|mjs)$/.test(f))) {
    scanned++; const src = fs.readFileSync(f, 'utf8');
    for (const b of banned) if (new RegExp(`from\\s+['"]${b}['"/]`).test(src) || new RegExp(`import\\(['"]${b}['"/]`).test(src)) { console.error(`BOUNDARY VIOLATION: ${pkg} must not import ${b}  (${path.relative(root, f)})`); bad++; }
  }
}
if (bad) process.exit(1);
console.log(`boundaries ok (${scanned} source files checked)`);
