// Starts the API and the website together for development (npm run dev).
// This replaces the "concurrently" package, so nothing extra has to be installed.
// Works on Windows, macOS and Linux.
//
// Usage: npm run dev            API (Firestore) + website
//        npm run dev:memory     API (in memory database, lost when stopped) + website
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const memory = process.argv.includes('--memory');

// Find the vite start file inside node_modules. If it is missing, explain how to fix it.
let viteBin;
try {
  const require = createRequire(path.join(root, 'package.json'));
  viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
} catch {
  console.error('\nVite is not installed. Run this in the project folder, then try again:\n\n  npm install\n');
  process.exit(1);
}

// Colours for the [api] and [web] labels in the terminal.
const colour = { api: '\x1b[32m', web: '\x1b[36m' };
const reset = '\x1b[0m';

// Prints each line from a process with its label in front, like "[api] ...".
function pipe(name, stream, out) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) out.write(`${colour[name]}[${name}]${reset} ${line}\n`);
  });
}

// Starts one process (node itself, so no shell is needed and Windows paths are safe).
const children = [];
function start(name, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...extraEnv, FORCE_COLOR: '1' } });
  pipe(name, child.stdout, process.stdout);
  pipe(name, child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${colour[name]}[${name}]${reset} stopped${code ? ` with code ${code}` : ''}`);
    stopAll(code || 0);
  });
  children.push(child);
}

// When one process stops, or Ctrl+C is pressed, stop the other one too.
let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

start('api', ['--watch', 'server/index.js'], memory ? { DB_DRIVER: 'memory' } : {});
start('web', [viteBin]);
