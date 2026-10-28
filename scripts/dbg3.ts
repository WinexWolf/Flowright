import { chromium } from 'playwright';
import fs from 'node:fs';
const SCRIPT = fs.readFileSync('packages/explorer/src/extract.browser.js', 'utf8');
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent('<nav><a href="/">Home</a></nav><main><form action="/search" method="get"><input name="q" type="search" aria-label="Search"><button>Go</button></form><div onclick="x()">Open card</div></main>');
const r: any = await p.evaluate(SCRIPT);
console.log(JSON.stringify(r.forms), '\n', JSON.stringify(r.interactive.map((i: any) => i.role + ':' + i.name)));
console.log(SCRIPT.includes('clickables'), SCRIPT.length);
await b.close();
