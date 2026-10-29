import { execFileSync } from 'node:child_process';
import type { Flow } from '@flowright/core';

export type Impact = { file: string; kind: 'route'; template: string } | { file: string; kind: 'shared' | 'ignored' };

const dyn = (seg: string): string | null => {
  if (/^\(.*\)$/.test(seg) || /^@/.test(seg)) return null;               // route groups and parallel slots are not URL segments
  if (/^\[{1,2}\.{3}.+\]{1,2}$/.test(seg) || /^\[.+\]$/.test(seg) || /^\$.+/.test(seg) || /^:.+/.test(seg)) return ':p';
  return seg;
};
const toTemplate = (segs: string[]) => '/' + segs.map(dyn).filter((s): s is string => !!s && s !== 'index').join('/');

/**
 * Which URL does a changed file serve? Understands the common file-based routers (Next pages + app router, SvelteKit, Remix flat routes,
 * Nuxt pages). Anything that can affect many pages (components, styles, layouts, lockfiles, API routes) is "shared" and widens the run to everything.
 */
export function impactOf(raw: string): Impact {
  const file = raw.replace(/\\/g, '/');
  if (/(^|\/)__tests__\//.test(file) || /^(tests?|e2e|cypress|docs?)\//.test(file) || /\.(test|spec|stories)\.\w+$/.test(file) || /\.(md|txt|png|jpe?g|gif|svg|ico|woff2?)$/i.test(file) || /(^|\/)\.github\//.test(file) || /(^|\/)(README|LICENSE|CHANGELOG)/i.test(file)) return { file, kind: 'ignored' };
  if (/(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file)) return { file, kind: 'shared' };
  let m: RegExpMatchArray | null;
  if ((m = file.match(/(?:^|\/)(?:src\/)?app\/routes\/(.+)\.(?:tsx?|jsx?)$/))) {                       // Remix flat routes: a.b.$id.tsx, _index.tsx
    const parts = m[1].split('.').filter(p => !(/^_/.test(p) && p !== '_index')).map(p => (p === '_index' ? 'index' : p));
    return { file, kind: 'route', template: toTemplate(parts) };
  }
  if ((m = file.match(/(?:^|\/)src\/routes\/(.*?)\/?\+page(?:@\w*)?(?:\.server)?\.(?:svelte|ts|js)$/))) return { file, kind: 'route', template: toTemplate(m[1].split('/').filter(Boolean)) };   // SvelteKit
  if (/(^|\/)src\/routes\/.*\+(layout|error|server)/.test(file)) return { file, kind: 'shared' };
  if (/(?:^|\/)(?:src\/)?app\/(?:.*\/)?(?:layout|template|loading|error|not-found|global-error)\.(?:tsx?|jsx?)$/.test(file)) return { file, kind: 'shared' };
  if ((m = file.match(/(?:^|\/)(?:src\/)?app\/(.*?)\/?page\.(?:tsx?|jsx?|mdx)$/))) return { file, kind: 'route', template: toTemplate(m[1].split('/').filter(Boolean)) };   // Next app router
  if ((m = file.match(/(?:^|\/)(?:src\/)?pages\/(.+)\.(?:tsx?|jsx?|mdx|vue)$/))) {                    // Next pages router, Nuxt pages
    const rel = m[1];
    if (/^api\//.test(rel) || /(^|\/)_/.test(rel.split('/').pop()!) && /^_(app|document|error)$/.test(rel.split('/').pop()!)) return { file, kind: 'shared' };
    return { file, kind: 'route', template: toTemplate(rel.split('/')) };
  }
  if (/\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|html|css|scss|sass|less|styl)$/.test(file)) return { file, kind: 'shared' };
  return { file, kind: 'ignored' };
}

export interface Affected { templates: string[]; runAll: boolean; impacts: Impact[]; nothingToTest: boolean }
export function affectedTemplates(changed: string[]): Affected {
  const impacts = changed.map(impactOf);
  const templates = [...new Set(impacts.filter((i): i is Extract<Impact, { kind: 'route' }> => i.kind === 'route').map(i => i.template))];
  const runAll = impacts.some(i => i.kind === 'shared');
  return { templates, runAll, impacts, nothingToTest: !runAll && templates.length === 0 };
}

const normRoute = (r: string) => r.split('?')[0].replace('/#', '').replace(/\/\d+(?=\/|$)/g, '/:p') || '/';
const tplRegex = (t: string) => new RegExp('^' + t.split('/').map(s => (s === ':p' ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '/?$');

/** A flow is affected if it ends on, or clicks through a link to, a changed route. */
export function selectFlows(flows: Flow[], a: Affected): Flow[] {
  if (a.runAll) return flows; if (a.nothingToTest) return [];
  const res = a.templates.map(tplRegex);
  return flows.filter(f => {
    const routes = [f.expect.route, ...f.steps.map(s => (s.kind === 'click' && s.href ? (() => { try { const u = new URL(s.href); return u.pathname + u.hash; } catch { return s.href!; } })() : ''))].filter(Boolean).map(normRoute);
    return routes.some(r => res.some(re => re.test(r)));
  });
}
export function routeInArea(route: string, a: Affected): boolean { return a.runAll || a.templates.map(tplRegex).some(re => re.test(normRoute(route))); }

/** Files changed relative to a git ref (three-dot: changes on this branch since it diverged). */
export function gitChangedFiles(baseRef: string, cwd = process.cwd()): string[] {
  const run = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\n').map(s => s.trim()).filter(Boolean);
  try { return run(['diff', '--name-only', `${baseRef}...HEAD`]); } catch { return run(['diff', '--name-only', baseRef]); }
}
