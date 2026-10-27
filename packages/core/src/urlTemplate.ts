import type { TargetConfig } from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns concrete URLs into templates (/users/42 -> /users/:id) so data-driven pages collapse.
 * Rules, in order: per-target overrides, numeric ids, UUIDs, long hex, then LEARNED slugs:
 * a segment under a parent that has been seen with >= learnThreshold distinct children becomes :slug
 * (only at depth >= 2, and never for config.staticSegments).
 * Query strings keep their KEYS (sorted) but drop values; hash routes ("#/a/b") are templated like paths.
 */
export class UrlTemplater {
  private seen = new Map<string, Set<string>>();
  constructor(private cfg: Pick<TargetConfig, 'staticSegments' | 'urlOverrides'> = {}, private learnThreshold = 3) {}

  /** Record a URL so learned rules can kick in. Call for every visited URL before template(). */
  observe(url: string): void {
    const { pathSegs, hashSegs } = this.split(url);
    for (const segs of [pathSegs, hashSegs]) {
      for (let i = 1; i < segs.length; i++) {
        const parent = segs.slice(0, i).join('/');
        if (!this.seen.has(parent)) this.seen.set(parent, new Set());
        this.seen.get(parent)!.add(segs[i]);
      }
    }
  }

  template(url: string): string {
    const u = new URL(url, 'http://x');
    const raw = u.pathname + u.hash;
    for (const o of this.cfg.urlOverrides ?? []) if (new RegExp(o.pattern).test(raw)) return o.template;
    const { pathSegs, hashSegs } = this.split(url);
    const p = '/' + this.seg(pathSegs).join('/');
    const h = hashSegs.length ? '#/' + this.seg(hashSegs).join('/') : '';
    const keys = [...new Set([...u.searchParams.keys()])].sort();
    return p + (keys.length ? '?' + keys.join('&') : '') + h;
  }

  private split(url: string) {
    const u = new URL(url, 'http://x');
    const pathSegs = u.pathname.split('/').filter(Boolean);
    const hashSegs = u.hash.startsWith('#/') ? u.hash.slice(2).split('/').filter(Boolean) : [];
    return { pathSegs, hashSegs };
  }

  private seg(segs: string[]): string[] {
    const statics = new Set(this.cfg.staticSegments ?? []);
    return segs.map((s, i) => {
      if (/^\d+$/.test(s)) return ':id';
      if (UUID.test(s)) return ':uuid';
      if (/^[0-9a-f]{16,}$/i.test(s)) return ':hex';
      if (i >= 1 && !statics.has(s)) {
        const parent = segs.slice(0, i).join('/');
        if ((this.seen.get(parent)?.size ?? 0) >= this.learnThreshold) return ':slug';
      }
      return s;
    });
  }
}
