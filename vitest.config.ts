import { defineConfig } from 'vitest/config';
// Default run: fast unit + real-browser tests. Slow end-to-end pipeline tests are *.e2e.test.ts and run with `npm run test:e2e`.
export default defineConfig({ test: { include: ['packages/**/test/**/*.test.ts'], exclude: ['**/*.e2e.test.ts', '**/node_modules/**'], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false } });
