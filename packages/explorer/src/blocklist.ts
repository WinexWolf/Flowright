import type { TargetConfig } from '@flowright/core';

/** Words that suggest a destructive or externally-visible action. Applied in full to non-sandbox targets. */
export const DEFAULT_BLOCK = '(delete|remove|destroy|cancel (my )?(account|subscription)|log ?out|sign ?out|pay( now)?|purchase|buy now|place order|send|invite|unsubscribe|deactivate)';

export function isBlocked(label: string, cfg: TargetConfig): boolean {
  // sandbox targets may run destructive-looking actions, except what the target config itself blocks
  const pats = cfg.sandbox ? (cfg.blockedActionPatterns ?? ['log ?out|sign ?out']) : [DEFAULT_BLOCK, ...(cfg.blockedActionPatterns ?? [])];
  return pats.some(p => new RegExp(p, 'i').test(label));
}
