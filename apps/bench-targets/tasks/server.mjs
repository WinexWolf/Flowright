// "TaskBoard": hash-routed vanilla-JS SPA with modals, tabs, and per-session API state.
import { createApp } from '../_lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));

createApp({
  name: 'tasks',
  seed: () => ({
    tasks: [
      { id: 1, title: 'Write launch plan', done: false, project: 1, priority: 'high', description: 'Outline the Q4 launch.' },
      { id: 2, title: 'Fix login redirect', done: true, project: 2, priority: 'medium', description: 'Users bounce after login.' },
      { id: 3, title: 'Design settings page', done: false, project: 1, priority: 'low', description: 'Tabs for profile and alerts.' },
      { id: 4, title: 'Update onboarding copy', done: false, project: 3, priority: 'medium', description: 'Shorter intro text.' },
      { id: 5, title: 'Archive old tickets', done: true, project: 2, priority: 'low', description: 'Clean the backlog.' },
    ],
    nextId: 6,
    projects: [{ id: 1, name: 'Launch' }, { id: 2, name: 'Platform' }, { id: 3, name: 'Growth' }],
    profile: { name: 'Demo User', email: 'demo@example.com' },
    notifications: { email: true, push: false },
  }),
  handler: async ({ url, state, json, send, sendJson, bug, req }) => {
    const p = url.pathname;
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
        .replace('/*__BUGS__*/', `window.__BUGS = ${JSON.stringify(['tasks-dead-mark-done', 'tasks-console-error', 'tasks-failing-api', 'tasks-missing-validation', 'tasks-layout-overflow', 'tasks-broken-link'].filter(bug))};`);
      return send(200, html);
    }
    if (p === '/api/tasks' && req.method === 'GET') return sendJson(200, state.tasks);
    if (p === '/api/tasks' && req.method === 'POST') {
      if (!bug('tasks-missing-validation') && !String(json.title || '').trim()) return sendJson(422, { error: 'Title is required' });
      const t = { id: state.nextId++, title: json.title || '', done: false, project: Number(json.project) || 1, priority: json.priority || 'medium', description: '' };
      state.tasks.push(t); return sendJson(201, t);
    }
    const tm = p.match(/^\/api\/tasks\/(\d+)$/);
    if (tm) {
      const t = state.tasks.find(x => x.id === Number(tm[1]));
      if (!t) return sendJson(404, { error: 'not found' });
      if (req.method === 'GET') return sendJson(200, t);
      if (req.method === 'PATCH') { Object.assign(t, json); return sendJson(200, t); }
      if (req.method === 'DELETE') { state.tasks = state.tasks.filter(x => x !== t); return sendJson(200, { ok: true }); }
    }
    if (p === '/api/projects') {
      if (bug('tasks-failing-api')) return sendJson(500, { error: 'projects service unavailable' });
      return sendJson(200, state.projects.map(pr => ({ ...pr, tasks: state.tasks.filter(t => t.project === pr.id).length })));
    }
    if (p === '/api/profile') { if (req.method === 'POST') Object.assign(state.profile, json); return sendJson(200, state.profile); }
    if (p === '/api/notifications') { if (req.method === 'POST') Object.assign(state.notifications, json); return sendJson(200, state.notifications); }
    return sendJson(404, { error: 'not found' });
  },
});
