/**
 * 真实 MCP Client：以 stdio 方式拉起 MCP Server 子进程，
 * 完成 initialize 握手、tools/list 能力发现、tools/call 真实调用。
 * 所有协议往返都记录到 trace，用于教学面板展示。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const SERVER_PATH = path.join(import.meta.dirname, 'company-server.mjs');

const PROTOCOL_VERSION = '2024-11-05';

class McpClient {
  constructor() {
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.serverInfo = null;
    this.protocolVersion = null;
    this.tools = [];
    this.trace = [];
    this.stderr = '';
  }

  record(direction, payload) {
    this.trace.push({
      at: Date.now(),
      direction,
      method: payload.method || null,
      id: payload.id ?? null,
      payload,
    });
    if (this.trace.length > 60) this.trace.shift();
  }

  async ensureConnected() {
    if (this.child && !this.child.killed && this.protocolVersion) return;
    await this.connect();
  }

  async connect() {
    this.close();
    this.buffer = '';
    this.child = spawn(process.execPath, [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (c) => {
      this.stderr += c;
    });
    this.child.on('exit', () => {
      this.child = null;
      this.protocolVersion = null;
      for (const [, p] of this.pending) p.reject(new Error('MCP Server 进程已退出'));
      this.pending.clear();
    });

    this.record('->', {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'demo-platform-host', version: '1.0.0' },
      },
    });
    const init = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: 'demo-platform-host', version: '1.0.0' },
    });
    this.protocolVersion = init.protocolVersion;
    this.serverInfo = init.serverInfo;
    this.notify('notifications/initialized');

    const list = await this.request('tools/list', {});
    this.tools = list.tools || [];
    return { serverInfo: this.serverInfo, protocolVersion: this.protocolVersion, tools: this.tools };
  }

  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this.record('<-', msg);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || 'MCP 调用失败'));
        else p.resolve(msg.result);
      }
    }
  }

  write(payload) {
    if (!this.child || this.child.killed) throw new Error('MCP Server 未连接');
    this.child.stdin.write(JSON.stringify(payload) + '\n');
  }

  notify(method, params = {}) {
    this.record('->', { jsonrpc: '2.0', method, params });
    this.write({ jsonrpc: '2.0', method, params });
  }

  request(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    if (method !== 'initialize') this.record('->', msg);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.write(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async callTool(name, args) {
    await this.ensureConnected();
    const started = Date.now();
    const result = await this.request('tools/call', { name, arguments: args || {} });
    const text = result?.content?.find((c) => c.type === 'text')?.text || '';
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return {
      data: parsed,
      text,
      isError: Boolean(result?.isError),
      durationMs: Date.now() - started,
    };
  }

  status() {
    return {
      connected: Boolean(this.child && !this.child.killed && this.protocolVersion),
      protocolVersion: this.protocolVersion,
      serverInfo: this.serverInfo,
      tools: this.tools,
      trace: this.trace.slice(-10),
    };
  }

  close() {
    if (this.child && !this.child.killed) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        /* noop */
      }
    }
    this.child = null;
    this.protocolVersion = null;
  }
}

export const mcpClient = new McpClient();
