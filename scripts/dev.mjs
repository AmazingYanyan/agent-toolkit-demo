import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const children = [];

function run(name, cmd, args, color) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  children.push(child);
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  child.stdout.on('data', (d) => process.stdout.write(prefix + d.toString().replace(/\n$/, '\n')));
  child.stderr.on('data', (d) => process.stderr.write(prefix + d.toString()));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.log(`${prefix}已退出，代码 ${code}`);
  });
  return child;
}

console.log('\n  AI 与 Agent 技术原理演示平台 · 开发模式');
console.log('  前端 http://localhost:5173   后端 http://127.0.0.1:8787\n');

run('api', process.execPath, ['server/index.mjs'], '36');
run('web', process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js')], '35');

function shutdown() {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* noop */
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
