/**
 * MCP Streamable HTTP 传输客户端。
 *
 * 协议要点（MCP 2025-06-18 / 2024-11-05 共同部分）：
 *   1. 所有 JSON-RPC 消息都以 POST 发到同一个 endpoint；
 *   2. 服务端在 initialize 响应头返回 Mcp-Session-Id，后续请求必须带上；
 *   3. 响应可能是 application/json，也可能是 text/event-stream（SSE），
 *      因此必须同时解析两种载体，不能只当 REST 用；
 *   4. 通知（notification）没有 id，服务端返回 202 且没有响应体。
 *
 * 这里刻意不用第三方 SDK：教学面板需要把每一次协议往返原文展示出来。
 */

const PROTOCOL_VERSION = '2025-06-18';

function trimBase(url) {
  return String(url || '').trim();
}

export class HttpMcpClient {
  constructor(server, options = {}) {
    this.server = server;
    this.timeoutMs = options.timeoutMs || 30000;
    this.sessionId = null;
    this.protocolVersion = null;
    this.serverInfo = null;
    this.instructions = '';
    this.tools = [];
    this.trace = [];
    this.nextId = 1;
    this.connected = false;
    this.lastError = null;
    this.latencyMs = null;
  }

  record(direction, payload, note) {
    this.trace.push({
      at: new Date().toISOString(),
      direction,
      method: payload?.method || null,
      id: payload?.id ?? null,
      note: note || null,
      payload,
    });
    if (this.trace.length > 40) this.trace.shift();
  }

  headers() {
    const h = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.server.headers || {}),
    };
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) h['mcp-protocol-version'] = this.protocolVersion;
    return h;
  }

  async post(payload) {
    const url = trimBase(this.server.url);
    if (!url) throw new Error('未配置 MCP URL');
    const isNotification = payload.id === undefined;
    this.record('->', payload);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg =
        err.name === 'TimeoutError'
          ? `请求超时（${this.timeoutMs}ms）`
          : err.cause?.code === 'ENOTFOUND'
            ? '域名解析失败，请检查网络或代理'
            : err.message;
      throw new Error(`MCP 网络错误：${msg}`);
    }

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => '');
      throw new Error(`鉴权失败（HTTP ${res.status}）。请检查 Authorization 是否正确、是否已过期。${body.slice(0, 160)}`);
    }
    if (res.status === 202 || (isNotification && !res.headers.get('content-type'))) {
      res.body?.cancel?.().catch(() => {});
      return null;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`MCP 返回 HTTP ${res.status}：${body.slice(0, 200)}`);
    }
    if (isNotification) {
      res.body?.cancel?.().catch(() => {});
      return null;
    }

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) {
      return this.readSse(res, payload.id);
    }
    const text = await res.text();
    if (!text.trim()) return null;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      throw new Error(`MCP 响应不是合法 JSON：${text.slice(0, 160)}`);
    }
    this.record('<-', msg);
    return msg;
  }

  /** 从 SSE 流中取出与请求 id 匹配的那条响应；期间的通知只记录不阻塞 */
  async readSse(res, id) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = raw
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim());
          if (!dataLines.length) continue;
          let msg;
          try {
            msg = JSON.parse(dataLines.join('\n'));
          } catch {
            continue;
          }
          this.record('<-', msg, 'sse');
          if (msg.id === id) {
            result = msg;
            break;
          }
        }
        if (result) break;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    if (!result) throw new Error('SSE 响应流意外结束，未收到匹配的 JSON-RPC 响应');
    return result;
  }

  async request(method, params = {}, timeoutMs) {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    const prev = this.timeoutMs;
    if (timeoutMs) this.timeoutMs = timeoutMs;
    try {
      const msg = await this.post(payload);
      if (!msg) throw new Error(`MCP 未返回响应：${method}`);
      if (msg.error) {
        const e = new Error(msg.error.message || `MCP 调用失败：${method}`);
        e.code = msg.error.code;
        e.data = msg.error.data;
        throw e;
      }
      return msg.result;
    } finally {
      this.timeoutMs = prev;
    }
  }

  async notify(method, params = {}) {
    await this.post({ jsonrpc: '2.0', method, params });
  }

  async connect() {
    this.connected = false;
    this.lastError = null;
    const started = Date.now();
    try {
      const init = await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { roots: { listChanged: false }, elicitation: {} },
        clientInfo: { name: 'agent-principle-demo', version: '1.1.0' },
      });
      this.protocolVersion = init?.protocolVersion || PROTOCOL_VERSION;
      this.serverInfo = init?.serverInfo || null;
      this.instructions = init?.instructions || '';
      try {
        await this.notify('notifications/initialized');
      } catch {
        /* 部分服务端不要求，忽略 */
      }
      const list = await this.request('tools/list', {});
      this.tools = list?.tools || [];
      this.connected = true;
      this.latencyMs = Date.now() - started;
      return this.status();
    } catch (err) {
      this.lastError = err.message;
      this.connected = false;
      this.latencyMs = Date.now() - started;
      throw err;
    }
  }

  async ensureConnected() {
    if (this.connected) return;
    await this.connect();
  }

  async callTool(name, args = {}) {
    await this.ensureConnected();
    const started = Date.now();
    const result = await this.request('tools/call', { name, arguments: args || {} }, Math.max(this.timeoutMs, 45000));
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
      type: 'http',
      url: this.server.url,
      enabled: this.server.enabled !== false,
      connected: this.connected,
      protocolVersion: this.protocolVersion,
      serverInfo: this.serverInfo,
      instructions: this.instructions,
      toolCount: this.tools.length,
      tools: this.tools,
      latencyMs: this.latencyMs,
      sessionId: this.sessionId,
      error: this.lastError,
      trace: this.trace.slice(-12),
    };
  }

  close() {
    this.connected = false;
    this.sessionId = null;
    this.protocolVersion = null;
  }
}
