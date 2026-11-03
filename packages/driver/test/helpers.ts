import http from 'node:http';
import type { AddressInfo } from 'node:net';
export interface Srv { url: string; hits: Record<string, number>; stop: () => Promise<void> }
/** A throwaway HTTP server for tests: map "METHOD /path" (or "/path") to an HTML string or a handler. */
export async function serve(routes: Record<string, string | ((req: http.IncomingMessage, res: http.ServerResponse) => void)>): Promise<Srv> {
  const hits: Record<string, number> = {};
  const server = http.createServer((req, res) => {
    const p = (req.url ?? '/').split('?')[0]; const key = `${req.method} ${p}`; hits[key] = (hits[key] ?? 0) + 1;
    const r = routes[key] ?? routes[p];
    if (!r) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>Not found</h1>'); }
    if (typeof r === 'function') return r(req, res);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(r);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits, stop: () => new Promise(r => server.close(() => r())) };
}
export const GOOD = `<!doctype html><html lang="en"><head><title>Good</title></head><body><main><h1>Good page</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A pixel">
<label for="n">Your name</label><input id="n" name="n"><button type="button">Save</button><p>Plenty of contrast in this text.</p><a href="/b">Link one</a> <a href="/c">Link two</a></main></body></html>`;
export const BAD = `<!doctype html><html lang="en"><head><title>Bad</title><style>a,a:focus{outline:none}.lo{color:#999;background:#aaa}</style></head><body><main><h1>Bad page</h1>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button type="button"></button><p class="lo">Low contrast text here</p><a href="/b">Link one</a> <a href="/c">Link two</a>
<div onclick="void 0" style="cursor:pointer;padding:8px">Fake button</div></main></body></html>`;
export const TRAP = `<!doctype html><html lang="en"><head><title>Trap</title></head><body><main><h1>Trap</h1><label for="t">Field</label><input id="t" onkeydown="if(event.key==='Tab'){event.preventDefault()}"><a href="/b">after</a></main></body></html>`;
