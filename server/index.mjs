import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  loadConfig,
  publicConfig,
  saveConfig,
  rawConfig,
  ROOT,
  DATA_DIR,
  updateMcpServer,
  addMcpServer,
  removeMcpServer,
} from './config.mjs';
import { ensureDb, readDb, resetDb, computeMetrics, runRules, findCompany } from './db.mjs';
import { TOOL_REGISTRY } from './tools.mjs';
import { retriever } from './rag.mjs';
import { embedder } from './embedding.mjs';
import { listSkills, loadSkill, skillIndex } from './skills.mjs';
import { probeModel } from './llm.mjs';
import { createEmitter, executeRun } from './runner.mjs';
import { mcpRegistry } from './mcp/registry.mjs';
import { createRun, appendEvent, finishRun, getRun, listRuns, clearRuns } from './runs.mjs';

const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: '8mb' }));

ensureDb();
retriever.build();
// 启动后异步把向量索引补齐；没有配置 Embedding 时这一步直接跳过
if (embedder.ready()) {
  retriever.buildVectors().catch(() => {});
}
// 后台预热 MCP 连接，避免首次打开配置页等待
setTimeout(() => {
  mcpRegistry.syncAll().catch(() => {});
}, 1200);

const activeRuns = new Map();

// ---------------- 配置 ----------------
app.get('/api/config', (_req, res) => {
  res.json(publicConfig());
});

app.post('/api/config', (req, res) => {
  const { baseUrl, apiKey, model, temperature, timeoutMs, embedding, retrieval } = req.body || {};
  const patch = {};
  if (typeof baseUrl === 'string') patch.baseUrl = baseUrl;
  if (typeof model === 'string') patch.model = model;
  if (typeof temperature === 'number') patch.temperature = temperature;
  if (typeof timeoutMs === 'number') patch.timeoutMs = timeoutMs;
  if (embedding && typeof embedding === 'object') {
    const e = {};
    for (const k of ['enabled', 'baseUrl', 'model', 'dimensions', 'batchSize']) {
      if (embedding[k] !== undefined) e[k] = embedding[k];
    }
    if (typeof embedding.apiKey === 'string' && !embedding.apiKey.includes('••')) e.apiKey = embedding.apiKey;
    patch.embedding = e;
  }
  if (retrieval && typeof retrieval === 'object') {
    const r = {};
    for (const k of ['mode', 'vectorWeight', 'topK', 'chunkSize']) {
      if (retrieval[k] !== undefined) r[k] = retrieval[k];
    }
    patch.retrieval = r;
  }
  // 只有用户真的填了新密钥才覆盖，掩码值不回写
  if (typeof apiKey === 'string' && !apiKey.includes('••')) patch.apiKey = apiKey;
  saveConfig(patch);

  // 知识库参数或向量模型变了 → 重建索引
  const cfg = rawConfig();
  if (patch.retrieval?.chunkSize) retriever.rebuild();
  if (patch.embedding) {
    if (cfg.embedding.enabled) retriever.buildVectors().catch(() => {});
    else retriever.rebuild();
  }
  res.json(publicConfig());
});

app.post('/api/probe', async (_req, res) => {
  const result = await probeModel(rawConfig());
  res.json(result);
});

app.post('/api/embedding/probe', async (_req, res) => {
  if (!embedder.ready()) {
    return res.json({
      ok: false,
      reason: embedder.cfg().enabled
        ? 'Embedding 配置不完整：需要 Base URL、模型名称，以及可选的 API Key'
        : 'Embedding 开关未打开',
    });
  }
  const probe = await embedder.probe();
  if (probe.ok) await retriever.buildVectors().catch(() => {});
  res.json({ ...probe, index: retriever.vectorState, stats: retriever.stats().embedding });
});

// ---------------- 自检 ----------------
app.get('/api/health', async (_req, res) => {
  const cfg = loadConfig();
  const db = readDb();
  const kb = retriever.stats();
  const skills = listSkills();
  const mcp = mcpRegistry.statusAll();
  const enabledServers = mcp.servers.filter((s) => s.enabled);
  const connected = enabledServers.filter((s) => s.connected);
  const checks = [
    { id: 'server', label: '本地后端服务', ok: true, detail: `127.0.0.1:${PORT}` },
    {
      id: 'llm',
      label: '模型服务配置',
      ok: Boolean(cfg.apiKey),
      detail: cfg.apiKey ? `${cfg.model} @ ${cfg.baseUrl}` : '未配置 API Key，所有需要模型调用的章节将无法运行',
    },
    {
      id: 'db',
      label: '演示数据库',
      ok: db.companies?.length > 0,
      detail: `${db.companies?.length || 0} 家企业 · 版本 ${db.version}`,
    },
    {
      id: 'kb',
      label: '知识库索引',
      ok: kb.chunks > 0,
      detail: `${kb.documents} 篇文档 / ${kb.chunks} 个分块 · ${
        kb.embedding.ready ? `向量 ${kb.vectorIndex.dim} 维 + BM25` : 'BM25 词法'
      }`,
    },
    {
      id: 'embedding',
      label: 'Embedding 模型',
      ok: kb.embedding.ready,
      detail: kb.embedding.ready
        ? `${kb.embedding.model} · ${kb.vectorIndex.dim || '—'} 维 · 已索引 ${kb.vectorIndex.covered}/${kb.chunks} 块`
        : '未配置，检索降级为词法匹配',
      optional: true,
    },
    {
      id: 'skill',
      label: 'Skill 文件',
      ok: skills.length > 0,
      detail: skills.map((s) => s.name).join('、') || '未发现 SKILL.md',
    },
    {
      id: 'mcp',
      label: 'MCP 服务器',
      ok: connected.length > 0,
      detail: enabledServers.length
        ? `${connected.length}/${enabledServers.length} 已连接：${connected.map((s) => s.short || s.label).join('、') || '暂无'}`
        : '未配置任何 MCP 服务器',
      optional: true,
    },
  ];
  res.json({
    checks,
    mcp: { servers: enabledServers.map((s) => ({ id: s.id, short: s.short, connected: s.connected, error: s.error })) },
    blocking: checks.filter((c) => !c.ok && !c.optional).map((c) => c.id),
  });
});

// ---------------- 工具 / 知识库 / Skill ----------------
app.get('/api/tools', (_req, res) => {
  res.json(
    Object.entries(TOOL_REGISTRY).map(([name, t]) => ({
      name,
      ...t.meta,
      source: 'local',
      description: t.definition.function.description,
      parameters: t.definition.function.parameters,
    }))
  );
});

app.get('/api/kb', (_req, res) => {
  res.json({
    ...retriever.stats(),
    docTree: retriever.documents(),
    chunkList: retriever.chunks.map((c) => ({
      chunkId: c.chunkId,
      docId: c.docId,
      title: c.title,
      length: c.text.length,
      tokens: c.tokens.length,
      hasVector: Boolean(c.vector?.length),
      preview: c.text.slice(0, 90),
    })),
    pipeline: [
      { step: 1, title: '落入磁盘', text: `${retriever.stats().documents} 个 .md 文件，位于 server/knowledge/` },
      { step: 2, title: '按标题分块', text: `按 # 标题切分并按句兜底，单块不超过 ${retriever.stats().chunkSize} 字` },
      { step: 3, title: '建立索引', text: '倒排索引（BM25）' + (retriever.stats().embedding.ready ? ' + 向量索引（余弦）' : '，未配置向量') },
      { step: 4, title: '召回排序', text: retriever.stats().embedding.ready ? '词法分与向量分加权融合，取 TopK' : '仅按 BM25 分词打分，取 TopK' },
      { step: 5, title: '注入上下文', text: '按顺序拼成 system 消息随问题提交，模型参数不变' },
    ],
  });
});

app.get('/api/kb/chunk/:id', (req, res) => {
  const c = retriever.chunkDetail(req.params.id);
  if (!c) return res.status(404).json({ error: '未找到分块' });
  res.json(c);
});

app.post('/api/kb/upload', (req, res) => {
  const { filename, content } = req.body || {};
  if (!content) return res.status(400).json({ error: '内容为空' });
  try {
    const stats = retriever.addDocument(filename || 'uploaded.md', content);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/kb/:docId', (req, res) => {
  try {
    res.json(retriever.removeDocument(req.params.docId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/kb/search', async (req, res) => {
  const { query, topK, mode } = req.body || {};
  if (!query) return res.status(400).json({ error: '缺少 query' });
  try {
    const hits = await retriever.search(query, { topK: topK || 4, mode });
    res.json({
      hits,
      mode: retriever.effectiveMode(mode),
      requested: mode || rawConfig().retrieval?.mode,
      stats: retriever.stats(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kb/reindex', async (_req, res) => {
  retriever.rebuild();
  if (embedder.ready()) await retriever.buildVectors({ force: false }).catch(() => {});
  res.json(retriever.stats());
});

app.get('/api/skills', (_req, res) => {
  res.json(listSkills().map(({ body, ...rest }) => rest));
});

app.get('/api/skills/index', (_req, res) => {
  res.json(skillIndex());
});

app.get('/api/skills/:id', (req, res) => {
  const skill = loadSkill(req.params.id);
  if (!skill) return res.status(404).json({ error: '未找到 Skill' });
  res.json(skill);
});

// ---------------- MCP ----------------
app.get('/api/mcp/servers', (_req, res) => {
  const status = mcpRegistry.statusAll();
  res.json({
    ...status,
    catalog: mcpRegistry.toolCatalog(),
    trace: mcpRegistry.mergedTrace(24),
  });
});

app.post('/api/mcp/sync', async (_req, res) => {
  try {
    await mcpRegistry.syncAll({ force: true });
    res.json({ ok: true, ...mcpRegistry.statusAll(), catalog: mcpRegistry.toolCatalog(), trace: mcpRegistry.mergedTrace(24) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/mcp/servers/:id/test', async (req, res) => {
  const st = await mcpRegistry.connect(req.params.id, { force: true });
  res.json({ ok: st.connected, server: st, trace: mcpRegistry.mergedTrace(12) });
});

app.patch('/api/mcp/servers/:id', (req, res) => {
  try {
    updateMcpServer(req.params.id, req.body || {});
    mcpRegistry.connect(req.params.id, { force: true }).catch(() => {});
    res.json(publicConfig());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/mcp/servers', (req, res) => {
  try {
    res.json(addMcpServer(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/mcp/servers/:id', (req, res) => {
  try {
    res.json(removeMcpServer(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 兼容旧接口
app.get('/api/mcp/status', (_req, res) => {
  res.json(mcpRegistry.legacyStatus());
});

app.post('/api/mcp/connect', async (_req, res) => {
  await mcpRegistry.syncAll({ force: true });
  res.json({ ok: true, ...mcpRegistry.legacyStatus() });
});

app.post('/api/mcp/disconnect', (_req, res) => {
  mcpRegistry.closeAll();
  res.json({ ok: true });
});

// ---------------- 演示数据 ----------------
app.get('/api/demo-data', (_req, res) => {
  const db = readDb();
  res.json({
    ...db,
    companies: db.companies.map((c) => ({ ...c, metrics: computeMetrics(c) })),
  });
});

app.post('/api/demo-data/reset', (_req, res) => {
  const db = resetDb();
  res.json({ ok: true, version: db.version });
});

app.get('/api/demo-data/:id', (req, res) => {
  const company = findCompany(req.params.id);
  if (!company) return res.status(404).json({ error: '未找到企业' });
  const metrics = computeMetrics(company);
  res.json({ company, metrics, rules: runRules(metrics) });
});

// ---------------- 运行 ----------------
app.post('/api/run', async (req, res) => {
  const { question, config, history } = req.body || {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ error: '问题不能为空' });
  }
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    return res.status(400).json({
      error: '未配置模型服务。请先在右上角「设置」中填写 Base URL、API Key 与模型名称，再运行。',
      code: 'NO_API_KEY',
    });
  }

  const runId = `run_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const runCfg = { ...config, chapter: config?.chapter || 'free' };
  const run = createRun({
    runId,
    chapter: runCfg.chapter,
    chapterTitle: runCfg.chapterTitle || '',
    question: String(question).trim(),
    snapshot: {
      chapter: runCfg.chapter,
      model: cfg.model,
      temperature: runCfg.temperature,
      systemPromptEnabled: Boolean(runCfg.systemPrompt?.enabled),
      multiTurn: Boolean(runCfg.multiTurn),
      functionCalling: Boolean(runCfg.functionCalling),
      tools: runCfg.tools || [],
      mcpMode: Boolean(runCfg.mcpMode),
      rag: Boolean(runCfg.rag),
      ragMode: runCfg.ragMode || cfg.retrieval?.mode,
      embedding: embedder.ready() ? cfg.embedding.model : null,
      skill: runCfg.skill || null,
      skillAuto: Boolean(runCfg.skillAuto),
    },
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  send({ type: 'run_created', runId });

  const controller = new AbortController();
  activeRuns.set(runId, controller);

  const emitter = createEmitter(runId, (evt) => {
    appendEvent(runId, evt);
    send(evt);
  });

  req.on('close', () => {
    controller.abort();
  });

  try {
    const result = await executeRun({
      runId,
      question: String(question).trim(),
      cfg: runCfg,
      history: Array.isArray(history) ? history.slice(-8) : [],
      emit: emitter.emit,
      signal: controller.signal,
    });
    finishRun(runId, { status: 'completed', answer: result.answer, stats: result.stats });
  } catch (err) {
    finishRun(runId, { status: 'failed', error: err.message });
  } finally {
    activeRuns.delete(runId);
    send({ type: 'stream_end', runId });
    if (!res.writableEnded) res.end();
  }
});

app.post('/api/run/:id/cancel', (req, res) => {
  const c = activeRuns.get(req.params.id);
  if (c) {
    c.abort();
    finishRun(req.params.id, { status: 'cancelled' });
    return res.json({ ok: true });
  }
  res.status(404).json({ ok: false, error: '该运行已结束或不存在' });
});

app.get('/api/runs', (_req, res) => {
  res.json(listRuns());
});

app.get('/api/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: '未找到运行记录' });
  res.json(run);
});

app.delete('/api/runs', (_req, res) => {
  clearRuns();
  res.json({ ok: true });
});

// ---------------- 静态资源 ----------------
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        '<html><body style="font-family:system-ui;padding:40px"><h2>前端尚未构建</h2><p>开发模式请访问 <a href="http://localhost:5173">http://localhost:5173</a>，或先执行 <code>npm run build</code>。</p></body></html>'
      );
  });
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] http://127.0.0.1:${PORT}`);
  console.log(`[server] 模型：${loadConfig().model} · 数据目录：${DATA_DIR}`);
  console.log(`[server] MCP 服务器：${(loadConfig().mcpServers || []).map((s) => `${s.id}(${s.type})`).join(', ')}`);
});
