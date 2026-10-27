import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface RunningApp { baseUrl: string; stop: () => Promise<void> }

/** Start a target app on a free port with a given set of injected bugs. A fresh process == a fresh, seeded world. */
export function startApp(app: string, bugs: string[] = []): Promise<RunningApp> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn('node', [path.join(root, 'apps/bench-targets', app, 'server.mjs')], {
      env: { ...process.env, PORT: '0', FLOWRIGHT_BUGS: bugs.join(',') }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    let exited = false, stopping = false;
    const t = setTimeout(() => { child.kill(); reject(new Error(`app ${app} did not start`)); }, 8000);
    child.stdout!.on('data', (d: Buffer) => {
      const m = /READY \S+ (\d+)/.exec(String(d));
      if (m) {
        clearTimeout(t);
        resolve({ baseUrl: `http://127.0.0.1:${m[1]}`, stop: () => new Promise<void>(r => { stopping = true; if (exited) return r(); child.once('exit', () => r()); child.kill(); }) });
      }
    });
    child.on('error', reject);
    child.on('exit', (code, sig) => { exited = true; if (!stopping) console.error(`!! target app ${app} exited unexpectedly (code=${code} signal=${sig})`); });
  });
}
