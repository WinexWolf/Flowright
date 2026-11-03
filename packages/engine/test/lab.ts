import { serve, type Srv } from '../../driver/test/helpers.js';

/** A small purpose-built app with known problems, used by the end-to-end tests. Mutable `st` lets a test "fix" or "change" the app between runs. */
export const st = { fixed: false, theme: '#3b82f6' };
const IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><nav aria-label="Main"><a href="/">Home</a> <a href="/about">About</a> <a href="/form">Contact</a> <a href="/login">Log in</a> <a href="/account">Account</a> <a href="/gallery">Gallery</a> <a href="/wide">Wide</a></nav><main>${body}</main></body></html>`;
const formPage = (alert = '') => page('Contact', `<h1>Contact</h1>${alert}<form method="post" action="/send" novalidate><label>Name <input name="name" type="text"></label> <label>Email <input name="email" type="email"></label> <button type="submit">Send message</button></form>`);

export async function startLab(): Promise<Srv> {
  return serve({
    '/': page('Home', '<h1>Welcome</h1><p>A small test app.</p>'),
    '/about': (_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(page('About', st.fixed ? `<h1>About</h1><img src="${IMG}" alt="A pixel"><p>Readable text here.</p><button type="button" onclick="void 0">Do it</button>` : `<h1>About</h1><img src="${IMG}"><p style="color:#999;background:#aaa">Hard to read text</p><div onclick="void 0" style="cursor:pointer;padding:8px">Fake button</div>`)); },
    '/form': formPage(),
    'POST /send': (q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { const f = new URLSearchParams(b); if (!f.get('name') || !/^\S+@\S+\.\S+$/.test(f.get('email') ?? '')) { r.writeHead(200, { 'content-type': 'text/html' }); r.end(formPage('<div role="alert">Please enter your name and a valid email</div>')); } else { r.writeHead(303, { location: '/sent' }); r.end(); } }); },
    '/sent': page('Sent', '<h1>Message sent</h1>'),
    '/gallery': (_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(page('Gallery', `<h1>Gallery</h1><div style="background:${st.theme};height:140px"></div>`)); },
    '/wide': page('Wide', '<h1>Wide</h1><div style="width:700px;height:20px;background:#ccc"></div>'),
    '/login': page('Log in', '<h1>Log in</h1><form method="post" action="/login"><label>Email <input name="email" type="email"></label> <label>Password <input name="password" type="password"></label> <button type="submit">Sign in</button></form>'),
    'POST /login': (q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { const f = new URLSearchParams(b); if (f.get('email') === 'me@x.io' && f.get('password') === 'pw') { r.writeHead(303, { 'set-cookie': 'sid=ok; Path=/', location: '/account' }); r.end(); } else { r.writeHead(303, { location: '/login' }); r.end(); } }); },
    '/account': (q, r) => { if (!/sid=ok/.test(q.headers.cookie ?? '')) { r.writeHead(302, { location: '/login' }); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(page('Account', '<h1>My account</h1><a href="/account/secret">Private area</a>')); },
    '/account/secret': (q, r) => { if (!/sid=ok/.test(q.headers.cookie ?? '')) { r.writeHead(302, { location: '/login' }); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(page('Private', '<h1>Private area</h1>')); },
  });
}
