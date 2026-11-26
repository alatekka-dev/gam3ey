// Runs the API server and the Vite dev server together (works on Windows, macOS and Linux).
import { spawn } from 'node:child_process';
const run = (ws) => spawn('npm', ['run', 'dev', '--workspace', ws], { stdio: 'inherit', shell: true });
const procs = [run('server'), run('client')];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop); process.on('SIGTERM', stop);
