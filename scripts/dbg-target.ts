import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const AXE = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8'); const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => { try { localStorage.setItem('fr2:seen', 'true'); localStorage.setItem('fr2:theme', '"light"'); } catch {} });
const p = await ctx.newPage(); await p.goto('file://' + path.resolve('prototype2/index.html') + '#home'); await p.waitForTimeout(300);
await p.click('#labrun'); await p.waitForSelector('#labopen:not([hidden])'); await p.click('.tg[data-bug=help]');
for (const i of [1, 2, 5]) {
  await p.click('#tab' + i); await p.waitForTimeout(250); await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(`axe.run(document,{runOnly:{type:'rule',values:['target-size']}}).then(x=>x.violations.flatMap(v=>v.nodes.map(n=>({t:n.target.join(' '),msg:(n.any[0]||{}).message,html:n.html.slice(0,110)}))))`);
  console.log('tab', i, JSON.stringify(r, null, 1));
}
const rects = await p.evaluate(`[...document.querySelectorAll('.tab')].map(t=>{const r=t.getBoundingClientRect();return [t.id,Math.round(r.top),Math.round(r.height)]})`); console.log(JSON.stringify(rects));
await b.close();
