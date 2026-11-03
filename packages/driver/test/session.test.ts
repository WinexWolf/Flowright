import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { TargetConfig } from '@flowright/core';
import { openSession, authenticatedState } from '../src/index.js';
import { serve, type Srv } from './helpers.js';

let browser: Browser; let srv: Srv;
const login = `<!doctype html><html lang="en"><head><title>Login</title></head><body><main><h1>Log in</h1><form method="post" action="/login"><label>Email <input name="email" type="email"></label><label>Password <input name="password" type="password"></label><button type="submit">Sign in</button></form></main></body></html>`;
beforeAll(async () => {
  srv = await serve({
    '/login': login,
    'POST /login': (req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { const f = new URLSearchParams(b); const ok = f.get('email') === 'me@x.io' && f.get('password') === 's3cret';
      if (ok) { res.writeHead(303, { 'set-cookie': 'sid=ok; Path=/', location: '/account' }); res.end(); } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(login.replace('<h1>', '<p role="alert">Bad login</p><h1>')); } }); },
    '/account': (req, res) => { const authed = /sid=ok/.test(req.headers.cookie ?? ''); res.writeHead(authed ? 200 : 302, authed ? { 'content-type': 'text/html' } : { location: '/login' }); res.end(authed ? '<!doctype html><html lang="en"><head><title>A</title></head><body><main><h1>My account</h1></main></body></html>' : ''); },
    'POST /__reset': (_q, res) => { res.writeHead(204); res.end(); },
    '/vp': '<!doctype html><html lang="en"><head><title>V</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>vp</h1></main></body></html>',
  });
  browser = await chromium.launch();
});
afterAll(async () => { await browser.close(); await srv.stop(); });
const cfg = (o: Partial<TargetConfig> = {}): TargetConfig => ({ name: 't', startPath: '/account', sandbox: true, ...o });
const auth = { loginPath: '/login', fields: { email: 'me@x.io', password: 's3cret' }, submit: 'Sign in', successPath: '/account' };

describe('login as session setup', () => {
  it('a session starts authenticated: the protected page opens instead of redirecting to /login', async () => {
    const s = await openSession(browser, srv.url, cfg({ auth }));
    await s.page.goto(srv.url + '/account'); expect(s.page.url()).toContain('/account'); expect(await s.page.textContent('h1')).toBe('My account');
    await s.ctx.close();
  });
  it('without auth the same page bounces to the login form', async () => {
    const s = await openSession(browser, srv.url, cfg()); await s.page.goto(srv.url + '/account'); expect(s.page.url()).toContain('/login'); await s.ctx.close();
  });
  it('login traffic is setup, not part of the flow: observations and request counts start clean', async () => {
    const s = await openSession(browser, srv.url, cfg({ auth })); expect(s.requests).toBe(0); expect(s.obs.badResponses).toEqual([]); await s.ctx.close();
  });
  it('wrong credentials stop the run LOUDLY instead of silently crawling logged-out', async () => {
    await expect(openSession(browser, srv.url, cfg({ auth: { ...auth, fields: { email: 'me@x.io', password: 'nope' } } }))).rejects.toThrow(/auth: after logging in the page is .*login/);
  });
  it('${ENV:NAME} keeps secrets out of the config file; a missing variable is a clear error', async () => {
    process.env.FR_TEST_PW = 's3cret';
    const s = await openSession(browser, srv.url, cfg({ auth: { ...auth, fields: { email: 'me@x.io', password: '${ENV:FR_TEST_PW}' } } })); await s.page.goto(srv.url + '/account'); expect(s.page.url()).toContain('/account'); await s.ctx.close();
    delete process.env.FR_TEST_PW;
    await expect(openSession(browser, srv.url, cfg({ auth: { ...auth, fields: { email: 'me@x.io', password: '${ENV:FR_NOT_SET_ANYWHERE}' } } }))).rejects.toThrow(/environment variable FR_NOT_SET_ANYWHERE is not set/);
  });
  it('successText works as the success check; fields can be addressed by label', async () => {
    const s = await openSession(browser, srv.url, cfg({ auth: { loginPath: '/login', fields: { Email: 'me@x.io', Password: 's3cret' }, submit: 'Sign in', successText: 'My account' } })); await s.ctx.close();
  });
  it('recordings can log in OUTSIDE the video: authenticatedState returns a reusable session', async () => {
    const state = await authenticatedState(browser, srv.url, cfg({ auth })) as { cookies: { name: string }[] };
    expect(state.cookies.some(c => c.name === 'sid')).toBe(true);
    expect(await authenticatedState(browser, srv.url, cfg())).toBeUndefined();
  });
});

describe('data reset and device', () => {
  it('resetUrl is POSTed before every fresh session', async () => {
    const before = srv.hits['POST /__reset'] ?? 0;
    for (let i = 0; i < 3; i++) await (await openSession(browser, srv.url, cfg({ resetUrl: '/__reset' }))).ctx.close();
    expect((srv.hits['POST /__reset'] ?? 0) - before).toBe(3);
  });
  it('a missing reset endpoint never breaks a run', async () => { await (await openSession(browser, srv.url, cfg({ resetUrl: '/no-such-endpoint' }))).ctx.close(); });
  it('mobile mode is a 390 px touch device; desktop is 1280', async () => {
    const m = await openSession(browser, srv.url, cfg({ device: 'mobile' })); await m.page.goto(srv.url + '/vp');
    expect(await m.page.evaluate('innerWidth')).toBe(390); expect(await m.page.evaluate("matchMedia('(pointer: coarse)').matches")).toBe(true); await m.ctx.close();
    const d = await openSession(browser, srv.url, cfg()); await d.page.goto(srv.url + '/vp'); expect(await d.page.evaluate('innerWidth')).toBe(1280); await d.ctx.close();
  });
});
