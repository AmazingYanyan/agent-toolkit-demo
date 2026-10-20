import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const INDEX_DIR = path.join(DATA_DIR, 'index');

/** 本地密钥文件（不提交仓库）。首次启动时用于播种 MCP 服务器配置。 */
const IFIND_KEY_FILE = path.join(ROOT, 'IFIND密钥.txt');
const TYC_KEY_FILE = path.join(ROOT, '天眼查密钥.md');

const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.2,
  timeoutMs: 90000,
  maxToolRounds: 4,
  currency: '元',
  // Embedding：留空 baseUrl 表示沿用上面的对话模型地址
  embedding: {
    enabled: false,
    baseUrl: '',
    apiKey: '',
    model: '',
    dimensions: 0,
    batchSize: 16,
  },
  // 检索模式：lexical=仅 BM25；vector=仅向量；hybrid=两者加权融合
  retrieval: {
    mode: 'hybrid',
    vectorWeight: 0.6,
    topK: 4,
    chunkSize: 320,
  },
  // MCP 服务器列表；为空时由 seedMcpServers() 播种
  mcpServers: [],
};

function readKeyFile(p) {
  try {
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').trim().split(/\s+/)[0] || '';
  } catch {
    return '';
  }
}

/**
 * 首次运行（或 data/config.json 被清空）时，从本地密钥文件播种真实的 MCP 服务器。
 * 密钥只写入 data/config.json，该目录已在 .gitignore 中。
 */
export function seedMcpServers() {
  const ifind = readKeyFile(IFIND_KEY_FILE);
  const tyc = readKeyFile(TYC_KEY_FILE);
  const list = [
    {
      id: 'demo',
      label: '演示工商库（本地）',
      short: '演示 MCP',
      type: 'stdio',
      command: process.execPath,
      args: [path.join(ROOT, 'server/mcp/company-server.mjs')],
      enabled: true,
      builtin: true,
    },
  ];
  if (ifind) {
    list.push(
      {
        id: 'ifind',
        label: '同花顺 iFinD · 证券数据',
        short: '同花顺 iFinD',
        type: 'http',
        url: 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-mcp',
        headers: { Authorization: ifind },
        enabled: true,
      },
      {
        id: 'kuaicha',
        label: '同花顺 · 快查企业',
        short: '快查企业',
        type: 'http',
        url: 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/kuaicha-enterprise-mcp',
        headers: { Authorization: ifind },
        enabled: true,
      },
      {
        id: 'law',
        label: '同花顺 · 法规库',
        short: '法规库',
        type: 'http',
        url: 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-law-mcp',
        headers: { Authorization: ifind },
        enabled: true,
      }
    );
  }
  if (tyc) {
    list.push({
      id: 'tyc',
      label: '天眼查 · 企业数据',
      short: '天眼查',
      type: 'http',
      url: 'https://mcp.tianyancha.com/mcp',
      headers: { Authorization: tyc },
      enabled: true,
    });
  }
  return list;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_DIR)) fs.mkdirSync(INDEX_DIR, { recursive: true });
}

function normalize(cfg) {
  const merged = {
    ...DEFAULTS,
    ...cfg,
    embedding: { ...DEFAULTS.embedding, ...(cfg.embedding || {}) },
    retrieval: { ...DEFAULTS.retrieval, ...(cfg.retrieval || {}) },
  };
  if (!Array.isArray(merged.mcpServers) || merged.mcpServers.length === 0) {
    merged.mcpServers = seedMcpServers();
  }
  if (!merged.embedding.baseUrl) merged.embedding.baseUrl = merged.baseUrl;
  return merged;
}

export function loadConfig() {
  ensureDir();
  let file = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      file = {};
    }
  }
  const env = {
    baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY,
    model: process.env.OPENAI_MODEL || process.env.LLM_MODEL,
  };
  const merged = normalize(file);
  for (const [k, v] of Object.entries(env)) {
    if (v && !merged[k]) merged[k] = v;
  }
  return merged;
}

export function saveConfig(patch) {
  ensureDir();
  const current = loadConfig();
  const next = { ...current, ...patch };
  if (patch.embedding) next.embedding = { ...current.embedding, ...patch.embedding };
  if (patch.retrieval) next.retrieval = { ...current.retrieval, ...patch.retrieval };
  // 不允许把换行/空白混入密钥
  if (typeof next.apiKey === 'string') next.apiKey = next.apiKey.trim();
  if (next.embedding && typeof next.embedding.apiKey === 'string') {
    next.embedding.apiKey = next.embedding.apiKey.trim();
  }
  if (typeof next.baseUrl === 'string') next.baseUrl = next.baseUrl.trim().replace(/\/+$/, '');
  if (next.embedding?.baseUrl) next.embedding.baseUrl = next.embedding.baseUrl.trim().replace(/\/+$/, '');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function mask(v) {
  const s = String(v || '');
  if (s.length <= 8) return s ? '••••' : '';
  return `••••••••${s.slice(-4)}`;
}

/** MCP 服务器对外展示时脱敏 header */
export function maskServers(servers) {
  return (servers || []).map((s) => {
    const headers = {};
    for (const [k, v] of Object.entries(s.headers || {})) {
      headers[k] = /authorization|token|key|cookie/i.test(k) ? mask(v) : v;
    }
    return {
      id: s.id,
      label: s.label,
      short: s.short || s.label,
      type: s.type || 'http',
      url: s.url || '',
      command: s.command ? path.basename(String(s.command)) : '',
      enabled: s.enabled !== false,
      builtin: Boolean(s.builtin),
      headers,
      hasAuth: Object.keys(s.headers || {}).length > 0,
    };
  });
}

/** 对外返回时对密钥脱敏，前端永远拿不到明文 */
export function publicConfig() {
  const c = loadConfig();
  return {
    ...c,
    apiKey: c.apiKey ? mask(c.apiKey) : '',
    apiKeySet: Boolean(c.apiKey),
    embedding: {
      ...c.embedding,
      apiKey: c.embedding.apiKey ? mask(c.embedding.apiKey) : '',
      apiKeySet: Boolean(c.embedding.apiKey),
    },
    mcpServers: maskServers(c.mcpServers),
  };
}

export function rawConfig() {
  return loadConfig();
}

/** 更新单个 MCP 服务器（合并式），供前端管理面板调用 */
export function updateMcpServer(id, patch) {
  const cfg = loadConfig();
  const servers = cfg.mcpServers.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s, ...patch };
    // 掩码值不回写
    if (patch.headers) {
      const headers = { ...(s.headers || {}) };
      for (const [k, v] of Object.entries(patch.headers)) {
        if (typeof v === 'string' && v.includes('••')) continue;
        headers[k] = v;
      }
      next.headers = headers;
    }
    return next;
  });
  return saveConfig({ mcpServers: servers });
}

export function addMcpServer(server) {
  const cfg = loadConfig();
  const id = String(server.id || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 20);
  if (!id) throw new Error('服务器标识只能包含字母、数字、下划线与连字符');
  if (cfg.mcpServers.some((s) => s.id === id)) throw new Error(`已存在同名服务器：${id}`);
  const next = [
    ...cfg.mcpServers,
    {
      id,
      label: server.label || id,
      short: server.short || server.label || id,
      type: server.type === 'stdio' ? 'stdio' : 'http',
      url: server.url || '',
      command: server.command || '',
      args: server.args || [],
      headers: server.headers || {},
      enabled: server.enabled !== false,
    },
  ];
  saveConfig({ mcpServers: next });
  return publicConfig();
}

export function removeMcpServer(id) {
  const cfg = loadConfig();
  const target = cfg.mcpServers.find((s) => s.id === id);
  if (target?.builtin) throw new Error('内置演示服务器不可删除，可以停用');
  return saveConfig({ mcpServers: cfg.mcpServers.filter((s) => s.id !== id) });
}

export { ROOT, DATA_DIR, INDEX_DIR };
