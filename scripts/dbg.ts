import { startApp } from '../packages/benchmark/src/servers.ts';
const a = await startApp('shop', []);
console.log('started', a.baseUrl);
const r = await fetch(a.baseUrl + '/__health'); console.log('health', r.status);
await a.stop(); console.log('stopped');
