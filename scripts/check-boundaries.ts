// Enforces CLAUDE.md boundary rules by scanning imports. Run in CI via `npm run lint:boundaries`.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..', 'packages');
const FORBIDDEN: Record<string, string[]> = {
  oracle: ['@flowright/llm-provider', '@flowright/agent'],
  replayer: ['@flowright/llm-provider', '@flowright/agent'],
  core: ['@flowright/explorer', '@flowright/benchmark', '@flowright/cli', '@flowright/oracle', '@flowright/replayer', '@flowright/agent', '@flowright/llm-provider'],
  explorer: ['@flowright/benchmark', '@flowright/cli'],
};
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
let bad = 0;
for (const [pkg, banned] of Object.entries(FORBIDDEN)) {
  const dir = path.join(root, pkg); if (!fs.existsSync(dir)) continue;
  for (const f of walk(dir).filter(f => /\.(ts|js|mjs)$/.test(f))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const b of banned) if (new RegExp(`from\\s+['"]${b}`).test(src) || new RegExp(`import\\(['"]${b}`).test(src)) { console.error(`BOUNDARY VIOLATION: ${path.relative(root, f)} imports ${b}`); bad++; }
  }
}
if (bad) process.exit(1);
console.log('boundaries ok');
