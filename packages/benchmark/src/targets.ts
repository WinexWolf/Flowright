import type { TargetConfig } from '@flowright/core';

/** Per-app explorer configuration. These are sandboxed benchmark apps, so destructive-looking actions are allowed. */
export const TARGETS: Record<string, TargetConfig> = {
  shop: { name: 'shop', startPath: '/', sandbox: true, blockedActionPatterns: ['log ?out|sign ?out'], formValues: { email: 'demo@example.com', password: 'password123' }, viewport: { width: 1280, height: 720 } },
  tasks: { name: 'tasks', startPath: '/', sandbox: true, blockedActionPatterns: ['log ?out|sign ?out'], formValues: { email: 'demo@example.com' }, viewport: { width: 1280, height: 720 } },
  library: { name: 'library', startPath: '/', sandbox: true, blockedActionPatterns: ['log ?out|sign ?out'], formValues: { email: 'member@example.com', password: 'password123' }, viewport: { width: 1280, height: 720 } },
};
export const DEV_APPS = ['shop', 'tasks'];
export const HELDOUT_APPS = ['library'];
