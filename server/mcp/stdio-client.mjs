/**
 * MCP stdio 传输客户端：以子进程方式拉起 MCP Server，
 * 通过换行分隔的 JSON-RPC 收发消息（每条消息一行，不使用 Content-Length 头）。
 * 与 HTTP 传输客户端保持同一套方法签名，便于注册表统一调用。
 */
import { spawn } from 'node:child_process';

const PROTOCOL_VERSION = '2024-11-05';

export class StdioMcpClient {
  constructor(server, options = {}) {
    this.server = server;
    this.timeoutMs = options.timeoutMs || 20000;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.serverInfo = null;
    this.protocolVersion = null;
    this.instructions = '';
    this.tools = [];
    this.trace = [];
    this.stderr = '';
    this.connected = false;
    this.lastError = null;
    this.latencyMs = null;
  }

  record(direction, payload) {
    this.trace.push({
      at: new Date().toISOString(),
      direction,
      method: payload?.method || null,
      id: payload?.id ?? null,
      payload,
    });
    if (this.trace.length > 40) this.trace.shift();
  }

  async connect() {
    this.close();
    this.buffer = '';
    this.lastError = null;
    const started = Date.now();
    const cmd = this.server.command || process.execPath;
    const args = this.server.args || [];
    try {
      this.child = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        cwd: this.server.cwd || undefined,
      });
    } catch (err) {
      this.lastError = err.message;
      throw new Error(`无法启动 MCP Server：${err.message}`);
    }

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (c) => {
      this.stderr = (this.stderr + c).slice(-2000);
    });
    this.child.on('error', (err) => {
      this.lastError = err.message;
    });
    this.child.on('exit', () => {
      this.child = null;
      this.connected = false;
      this.protocolVersion = null;
      for (const [, p] of this.pending) p.reject(new Error('MCP Server 进程已退出'));
      this.pending.clear();
    });

    const init = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: 'agent-principle-demo', version: '1.1.0' },
    });
    this.protocolVersion = init.protocolVersion;
    this.serverInfo = init.serverInfo;
    this.instructions = init.instructions || '';
    this.notify('notifications/initialized');

    const list = await this.request('tools/list', {});
    this.tools = list.tools || [];
    this.connected = true;
    this.latencyMs = Date.now() - started;
    return this.status();
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

  request(method, params = {}, timeoutMs) {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    this.record('->', msg);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}`));
      }, timeoutMs || this.timeoutMs);
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

  async ensureConnected() {
    if (this.child && !this.child.killed && this.connected) return;
    await this.connect();
  }

  async callTool(name, args = {}) {
    await this.ensureConnected();
    const started = Date.now();
    const result = await this.request('tools/call', { name, arguments: args || {} });
    const text = (result?.content || [])
      .filter((c) => c?.type === 'text')
      .map((c) => c.text)
      .join('\n');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return {
      isError: Boolean(result?.isError),
      text,
      json: parsed,
      structured: result?.structuredContent || null,
      durationMs: Date.now() - started,
    };
  }

  status() {
    return {
      id: this.server.id,
      label: this.server.label,
      short: this.server.short || this.server.label,
      type: 'stdio',
      url: this.server.command ? `stdio: ${this.server.command}` : 'stdio',
      enabled: this.server.enabled !== false,
      connected: Boolean(this.child && !this.child.killed && this.connected),
      protocolVersion: this.protocolVersion,
      serverInfo: this.serverInfo,
      instructions: this.instructions,
      toolCount: this.tools.length,
      tools: this.tools,
      latencyMs: this.latencyMs,
      error: this.lastError,
      trace: this.trace.slice(-12),
      stderr: this.stderr.slice(-400),
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
    this.connected = false;
    this.protocolVersion = null;
  }
}
