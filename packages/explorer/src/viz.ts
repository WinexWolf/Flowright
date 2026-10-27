import type { CrawlGraph } from './crawler.js';

/** Self-contained HTML visualisation of the state graph: layered by depth, hover for details. No external assets. */
export function graphHtml(title: string, g: CrawlGraph, stats: Record<string, unknown>): string {
  const data = JSON.stringify({
    states: g.states.map(s => ({ id: s.id, depth: s.depth, route: s.evidence.route, head: s.evidence.headings[0] ?? '', dialogs: s.evidence.dialogs.length, alerts: s.evidence.alerts.length, overflow: s.evidence.overflowX })),
    edges: g.edges.map(e => ({ from: e.from, to: e.to, label: e.label, bad: e.obs.consoleErrors.length + e.obs.pageErrors.length + e.obs.failedRequests.length + e.obs.badResponses.length, dead: e.obs.noEffect, err: !!e.obs.actionError })),
    cycles: g.cycles, stats,
  }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>:root{--bg:#fff;--fg:#111;--mut:#666;--ok:#2563eb;--bad:#dc2626;--dead:#d97706}@media(prefers-color-scheme:dark){:root{--bg:#111827;--fg:#f3f4f6;--mut:#9ca3af}}
body{font-family:system-ui;margin:0;background:var(--bg);color:var(--fg)}header{padding:12px 20px}pre{color:var(--mut);font-size:12px;white-space:pre-wrap}
svg{width:100%;height:auto}text{fill:var(--fg);font-size:11px}.e{stroke:var(--mut);fill:none;opacity:.35}.e.bad{stroke:var(--bad);opacity:.9}.e.dead{stroke:var(--dead);opacity:.9}
.n rect{fill:var(--bg);stroke:var(--ok);stroke-width:1.5}.n.ov rect{stroke:var(--bad)}</style></head><body>
<header><h2 style="margin:0">${title}</h2><pre id="stats"></pre><div style="font-size:12px;color:var(--mut)">Red edges: console/network errors during the action · Amber: action had no effect (dead click) · Red node border: horizontal overflow</div></header>
<svg id="g"></svg><script>
const D=${data};document.getElementById('stats').textContent=JSON.stringify(D.stats)+(D.cycles.length?'\\ncycles: '+D.cycles.map(c=>c.join('→')).join('  |  '):'');
const byD={};D.states.forEach(s=>(byD[s.depth]=byD[s.depth]||[]).push(s));
const W=190,H=46,GX=24,GY=90,pos={};let maxW=0;
Object.keys(byD).forEach(d=>{byD[d].forEach((s,i)=>{pos[s.id]={x:20+i*(W+GX),y:20+d*GY};});maxW=Math.max(maxW,20+byD[d].length*(W+GX));});
const maxD=Math.max(...Object.keys(byD).map(Number),0);const svg=document.getElementById('g');
svg.setAttribute('viewBox','0 0 '+maxW+' '+(40+(maxD+1)*GY));
let h='<defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#888"/></marker></defs>';
const seen=new Set();D.edges.forEach(e=>{if(e.from===e.to&&!e.err&&!e.dead)return;const a=pos[e.from],b=pos[e.to];if(!a||!b)return;const k=e.from+e.to+(e.bad?'b':'')+(e.dead?'d':'');if(seen.has(k))return;seen.add(k);
h+='<path class="e'+(e.bad?' bad':e.dead?' dead':'')+'" marker-end="url(#a)" d="M'+(a.x+W/2)+','+(a.y+H)+' C'+(a.x+W/2)+','+(a.y+H+30)+' '+(b.x+W/2)+','+(b.y-30)+' '+(b.x+W/2)+','+b.y+'"><title>'+e.label.replace(/</g,'&lt;')+'</title></path>';});
D.states.forEach(s=>{const p=pos[s.id];h+='<g class="n'+(s.overflow?' ov':'')+'" transform="translate('+p.x+','+p.y+')"><rect width="'+W+'" height="'+H+'" rx="6"/><text x="8" y="18">'+s.id+' '+(s.route.length>26?s.route.slice(0,25)+'…':s.route).replace(/</g,'&lt;')+'</text><text x="8" y="35" style="fill:var(--mut)">'+(s.head||'').slice(0,28).replace(/</g,'&lt;')+(s.dialogs?' ◻':'')+(s.alerts?' ⚠':'')+'</text></g>';});
svg.innerHTML=h;</script></body></html>`;
}
