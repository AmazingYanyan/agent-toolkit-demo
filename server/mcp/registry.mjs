/**
 * 多 MCP 服务器注册表。
 *
 * 与旧实现的区别：不再只有一个“演示 MCP Server”，而是把配置里的每个服务器
 * （本地 stdio + 多个远程 Streamable HTTP）统一纳管，工具按服务器做命名空间，
 * 这样模型看到的工具名能唯一，面板也能说清“这个工具到底来自谁”。
 */
import fs from 'node:fs';
import { loadConfig } from '../config.mjs';
import { HttpMcpClient } from './http-client.mjs';
import { StdioMcpClient } from './stdio-client.mjs';

const SEP = '__';

/** 工具名 → 服务器 id（本地工具没有分隔符） */
export function toolServerId(name) {
  const i = String(name || '').indexOf(SEP);
  if (i <= 0) return null;
  return name.slice(0, i);
}

export function bareToolName(name) {
  const i = String(name || '').indexOf(SEP);
  return i <= 0 ? name : name.slice(i + SEP.length);
}

class McpRegistry {
  constructor() {
    this.clients = new Map();
    this.statusCache = new Map();
    this.lastSyncAt = 0;
    this.syncing = null;
  }

  servers() {
    return loadConfig().mcpServers || [];
  }

  serverById(id) {
    return this.servers().find((s) => s.id === id) || null;
  }

  client(id) {
    const def = this.serverById(id);
    if (!def) return null;
    const existing = this.clients.get(id);
    // 配置变了就丢旧连接，避免用旧 URL/旧密钥
    if (existing && existing.server.url !== def.url) {
      existing.close();
      this.clients.delete(id);
    }
    if (this.clients.has(id)) return this.clients.get(id);
    const c =
      def.type === 'stdio'
        ? new StdioMcpClient(def, { timeoutMs: 20000 })
        : new HttpMcpClient(def, { timeoutMs: 30000 });
    this.clients.set(id, c);
    return c;
  }

  /** 连接单个服务器；失败只记录错误，不抛出（面板要能显示哪一台坏了） */
  async connect(id, { force = false } = {}) {
    const def = this.serverById(id);
    if (!def) throw new Error(`未知的 MCP 服务器：${id}`);
    if (def.enabled === false) {
      const st = { ...this.baseStatus(def), connected: false, error: '已停用' };
      this.statusCache.set(id, st);
      return st;
    }
    const c = this.client(id);
    if (!force && c.connected) {
      const st = c.status();
      this.statusCache.set(id, st);
      return st;
    }
    try {
      const st = await c.connect();
      this.statusCache.set(id, st);
      return st;
    } catch (err) {
      const st = { ...this.baseStatus(def), connected: false, error: err.message };
      this.statusCache.set(id, st);
      return st;
    }
  }

  baseStatus(def) {
    const cached = this.statusCache.get(def.id);
    return {
      id: def.id,
      label: def.label,
      short: def.short || def.label,
      type: def.type || 'http',
      url: def.url || (def.command ? `stdio: ${def.command}` : ''),
      enabled: def.enabled !== false,
      connected: false,
      protocolVersion: cached?.protocolVersion || null,
      serverInfo: cached?.serverInfo || null,
      instructions: cached?.instructions || '',
      toolCount: cached?.toolCount ?? 0,
      tools: cached?.tools || [],
      latencyMs: cached?.latencyMs ?? null,
      error: cached?.error || null,
      trace: cached?.trace || [],
      transport: def.type === 'stdio' ? 'stdio + JSON-RPC（行分隔）' : 'Streamable HTTP（POST + SSE）',
    };
  }

  /** 并行连接所有启用的服务器 */
  async syncAll({ force = false } = {}) {
    if (this.syncing && !force) return this.syncing;
    const list = this.servers();
    this.syncing = (async () => {
      await Promise.all(list.map((s) => this.connect(s.id, { force })));
      this.lastSyncAt = Date.now();
      this.syncing = null;
      return this.statusAll();
    })();
    return this.syncing;
  }

  statusAll() {
    const list = this.servers();
    return {
      lastSyncAt: this.lastSyncAt,
      servers: list.map((s) => {
        const cached = this.statusCache.get(s.id);
        const c = this.clients.get(s.id);
        const live = c?.connected ? c.status() : null;
        return {
          ...this.baseStatus(s),
          ...(live || {}),
          ...(cached && !live ? { error: cached.error, connected: false } : {}),
          enabled: s.enabled !== false,
          transport: s.type === 'stdio' ? 'stdio + JSON-RPC（行分隔）' : 'Streamable HTTP（POST + SSE）',
        };
      }),
    };
  }

  /** 所有可用工具，带服务器来源，供配置页分组建表 */
  toolCatalog() {
    const servers = this.statusAll().servers;
    return servers
      .filter((s) => s.enabled)
      .map((s) => ({
        serverId: s.id,
        serverLabel: s.label,
        short: s.short,
        type: s.type,
        connected: s.connected,
        error: s.error,
        toolCount: s.toolCount,
        tools: (s.tools || []).map((t) => ({
          name: `${s.id}${SEP}${t.name}`,
          bare: t.name,
          serverId: s.id,
          label: t.title || t.annotations?.title || t.name,
          description: t.description || '',
          schema: t.inputSchema || null,
          readOnly: t.annotations?.readOnlyHint ?? null,
        })),
      }));
  }

  toolMeta(fullName) {
    const sid = toolServerId(fullName);
    if (!sid) return null;
    const s = this.clients.get(sid);
    if (!s) return null;
    const bare = bareToolName(fullName);
    const t = (s.tools || []).find((x) => x.name === bare);
    if (!t) return null;
    return { serverId: sid, server: this.serverById(sid), tool: t };
  }

  /** 把选中的工具名解析为 OpenAI tools 定义，按服务器归组 */
  async resolveTools(names = []) {
    const wanted = new Map();
    for (const n of names) {
      const sid = toolServerId(n);
      if (!sid) continue;
      if (!wanted.has(sid)) wanted.set(sid, []);
      wanted.get(sid).push(bareToolName(n));
    }

    const groups = [];
    const defs = [];
    for (const [sid, tools] of wanted) {
      const st = await this.connect(sid);
      if (!st.connected) {
        groups.push({
          serverId: sid,
          serverLabel: st.label,
          connected: false,
          error: st.error || '未连接',
          tools: [],
        });
        continue;
      }
      const client = this.client(sid);
      const picked = (client.tools || []).filter((t) => tools.includes(t.name));
      for (const t of picked) {
        defs.push({
          type: 'function',
          function: {
            name: `${sid}${SEP}${t.name}`,
            description: `[${st.short || st.label}] ${t.description || ''}`.slice(0, 1000),
            parameters: t.inputSchema || { type: 'object', properties: {} },
          },
        });
      }
      groups.push({
        serverId: sid,
        serverLabel: st.label,
        short: st.short,
        connected: true,
        type: st.type,
        protocolVersion: st.protocolVersion,
        serverInfo: st.serverInfo,
        latencyMs: st.latencyMs,
        tools: picked.map((t) => ({ name: t.name, description: t.description })),
        missing: tools.filter((n) => !(client.tools || []).some((t) => t.name === n)),
      });
    }
    return { defs, groups };
  }

  async callTool(fullName, args) {
    const sid = toolServerId(fullName);
    const bare = bareToolName(fullName);
    if (!sid) throw new Error(`不是 MCP 工具：${fullName}`);
    const c = this.client(sid);
    if (!c) throw new Error(`未找到 MCP 服务器：${sid}`);
    const started = Date.now();
    const res = await c.callTool(bare, args);
    const st = this.serverById(sid);
    return {
      ...res,
      serverId: sid,
      serverLabel: st?.label || sid,
      bare,
      wallMs: Date.now() - started,
      trace: c.status().trace,
      protocolVersion: c.protocolVersion,
    };
  }

  /** 合并所有服务器的最近协议往返，按时间排序后截断 */
  mergedTrace(limit = 30) {
    const all = [];
    for (const [id, c] of this.clients) {
      for (const t of c.trace || []) all.push({ ...t, serverId: id });
    }
    all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return all.slice(-limit);
  }

  closeAll() {
    for (const [, c] of this.clients) c.close();
    this.clients.clear();
    this.statusCache.clear();
  }

  /** 兼容旧接口：返回第一个已连接服务器的状态 */
  legacyStatus() {
    const all = this.statusAll().servers;
    const connected = all.filter((s) => s.connected);
    return {
      connected: connected.length > 0,
      connectedCount: connected.length,
      total: all.length,
      protocolVersion: connected[0]?.protocolVersion || null,
      serverInfo: connected[0]?.serverInfo || null,
      tools: all.flatMap((s) => (s.tools || []).map((t) => ({ ...t, serverId: s.id }))),
      trace: this.mergedTrace(12),
      servers: all,
    };
  }
}

export const mcpRegistry = new McpRegistry();
export { SEP as TOOL_SEP };
