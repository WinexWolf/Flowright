// Tiny zero-dependency server helper shared by the benchmark target apps.
// Every browser session (cookie) gets its own fresh, seeded state, so a fresh
// browser context == a fresh app state. This is what makes replay deterministic.
import http from 'node:http';
import crypto from 'node:crypto';

export function createApp({ name, seed, handler }) {
  const BUGS = new Set((process.env.FLOWRIGHT_BUGS || '').split(',').map(s => s.trim()).filter(Boolean));
  const sessions = new Map();
  const bug = (id) => BUGS.has(id);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]));
    let sid = cookies.sid;
    const headers = {};
    if (!sid || !sessions.has(sid)) {
      sid = crypto.randomBytes(8).toString('hex');
      sessions.set(sid, seed());
      headers['Set-Cookie'] = `sid=${sid}; Path=/; HttpOnly`;
    }
    const state = sessions.get(sid);
    let body = '';
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
      for await (const chunk of req) body += chunk;
    }
    const ctype = req.headers['content-type'] || '';
    const form = ctype.includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(body)) : {};
    let json = {}; try { json = ctype.includes('json') && body ? JSON.parse(body) : {}; } catch { json = {}; }

    const send = (status, content, type = 'text/html; charset=utf-8', extra = {}) => {
      res.writeHead(status, { 'Content-Type': type, ...headers, ...extra });
      res.end(content);
    };
    const redirect = (to) => send(303, '', 'text/plain', { Location: to });
    const sendJson = (status, obj) => send(status, JSON.stringify(obj), 'application/json');

    if (url.pathname === '/__health') return send(200, 'ok', 'text/plain');
    if (url.pathname === '/favicon.ico') return send(204, '', 'text/plain');
    try {
      await handler({ req, url, state, form, json, send, redirect, sendJson, bug });
    } catch (e) {
      send(500, `<h1>Server error</h1><pre>${String(e)}</pre>`);
    }
  });

  const port = Number(process.env.PORT || 0);
  server.listen(port, '127.0.0.1', () => {
    console.log(`READY ${name} ${server.address().port}`);
  });
  return server;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
