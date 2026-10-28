import { chromium } from 'playwright';
import { startApp } from '../packages/benchmark/src/servers.ts';
const a = await startApp('tasks', []); console.log('app up', a.baseUrl);
const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
await p.goto(a.baseUrl); console.log('title', await p.title());
await b.close(); await a.stop(); console.log('clean exit');
