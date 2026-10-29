import { defineConfig } from '@playwright/test';
// Used for running generated specs (flow specs and finding repros). Point it at a directory with --config + the path argument.
export default defineConfig({ testDir: 'reports/specs', testMatch: /.*\.spec\.ts/, workers: 1, timeout: 30000, reporter: 'line' });
