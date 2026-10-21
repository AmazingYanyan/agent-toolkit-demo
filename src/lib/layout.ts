import type { ArchEdge, ArchNode, RunConfig } from './types';

export const CANVAS_W = 1000;
export const CANVAS_H = 620;

const COL = {
  user: 28,
  app: 176,
  mid: 364,
  cap: 562,
  ext: 758,
};

const TOOL_LABELS: Record<string, { label: string; sub: string }> = {
  get_company_info: { label: '企业工商查询', sub: 'get_company_info · 读演示工商库' },
  get_company_financials: { label: '企业财务查询', sub: 'get_company_financials · 读演示财务库' },
  calculate_ratio: { label: '确定性指标计算', sub: 'calculate_ratio · 程序计算' },
  evaluate_risk_rules: { label: '演示风险规则引擎', sub: 'evaluate_risk_rules · 程序判定' },
};

export function promptBuilderActive(cfg: RunConfig) {
  return Boolean(cfg.systemPrompt?.enabled || cfg.skill || cfg.rag || cfg.multiTurn);
}

/** 从工具名里取 MCP 服务器 id */
export function serverIdOf(toolName: string): string | null {
  if (!toolName) return null;
  const i = toolName.indexOf('__');
  return i > 0 ? toolName.slice(0, i) : null;
}

export interface McpServerBrief {
  id: string;
  short: string;
  type?: string;
  toolCount?: number;
  connected?: boolean;
}

export function buildGraph(cfg: RunConfig, toolNames: string[] = [], servers: McpServerBrief[] = []) {
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const pb = promptBuilderActive(cfg);
  const toolsOn = Boolean(cfg.functionCalling);
  // Skill 能力包：只要开启任意一路按需通道，就画出能力包节点
  const pkgOn = Boolean(cfg.skill) && (cfg.skillRefs !== false || cfg.skillScripts !== false);

  const mcpIds = [...new Set(toolNames.map((t) => serverIdOf(t)).filter(Boolean))] as string[];
  // 兼容旧开关：打开「通过 MCP 接入」时，本地同名工具走演示 MCP
  if (cfg.mcpMode && !mcpIds.includes('demo') && toolNames.some((t) => !serverIdOf(t))) {
    mcpIds.push('demo');
  }
  const localTools = toolsOn
    ? toolNames.filter((t) => !serverIdOf(t) && !(cfg.mcpMode && t === 'get_company_info'))
    : [];
  const mcpUsed = toolsOn ? servers.filter((s) => mcpIds.includes(s.id)) : [];
  const mcpOn = mcpUsed.length > 0;

  const push = (n: ArchNode) => nodes.push(n);

  push({ id: 'user', label: '用户', sub: '提出问题的业务人员', x: COL.user, y: 282, w: 112, h: 66, tone: 'core' });
  push({ id: 'app', label: 'Web 应用', sub: '编排 · 组装 · 调度', x: COL.app, y: 276, w: 148, h: 78, tone: 'core' });

  if (pb) {
    push({
      id: 'prompt_builder',
      label: 'Prompt 构建',
      sub: '拼接指令 · 上下文 · 检索片段',
      x: COL.mid,
      y: pkgOn ? 172 : 152,
      w: 152,
      h: 66,
      tone: 'capability',
    });
  }

  push({ id: 'llm', label: 'LLM', sub: cfg.modelLabel || '大语言模型', x: COL.mid, y: 276, w: 152, h: 78, tone: 'model' });

  if (cfg.skill) {
    push({
      id: 'skill_index',
      label: 'Skill 索引',
      sub: '只存元数据 · 常驻内存',
      x: COL.user,
      y: 88,
      w: 116,
      h: 54,
      tone: 'resource',
    });
    push({
      id: 'skill_loader',
      label: 'Skill 加载器',
      sub: '命中后读主指令',
      x: 168,
      y: 88,
      w: 132,
      h: 54,
      tone: 'capability',
    });
    if (pkgOn) {
      const parts = [
        cfg.skillRefs !== false ? '参考资料' : null,
        cfg.skillScripts !== false ? '确定性脚本' : null,
      ].filter(Boolean);
      push({
        id: 'skill_package',
        label: 'Skill 能力包',
        sub: `${parts.join(' · ')} · 按需触碰`,
        x: 340,
        y: 88,
        w: 160,
        h: 54,
        tone: 'resource',
      });
    }
  }

  if (cfg.rag) {
    const embReady = Boolean(cfg.ragMode && cfg.ragMode !== 'lexical');
    push({
      id: 'retriever',
      label: '检索器',
      sub: embReady ? '词法 + 向量混合' : 'BM25 词法检索',
      x: COL.app,
      y: 452,
      w: 148,
      h: 64,
      tone: 'capability',
    });
    push({ id: 'kb', label: '演示知识库', sub: '分块 · 索引 · 来源', x: COL.mid, y: 452, w: 152, h: 64, tone: 'resource' });
  }

  if (toolsOn) {
    push({ id: 'tool_handler', label: '工具处理器', sub: '校验 · 执行 · 回传', x: COL.cap, y: 276, w: 148, h: 78, tone: 'capability' });
  }

  // 最右列：本地工具与 MCP 服务器统一堆叠，避免互相压住
  const extItems: { id: string; label: string; sub: string; tone: ArchNode['tone']; badge?: string }[] = [];
  for (const t of localTools) {
    const info = TOOL_LABELS[t] || { label: t, sub: t };
    extItems.push({ id: `tool_${t}`, label: info.label, sub: info.sub, tone: 'resource', badge: '本地' });
  }
  for (const s of mcpUsed) {
    extItems.push({
      id: `mcp_${s.id}`,
      label: s.short || s.id,
      sub: `${s.toolCount ?? 0} 个工具 · ${s.type === 'stdio' ? 'stdio' : 'HTTP'}`,
      tone: 'guard',
      badge: 'MCP',
    });
  }

  if (extItems.length) {
    const n = extItems.length;
    const H = n <= 3 ? 58 : n <= 5 ? 50 : 44;
    const GAP = n <= 3 ? 14 : 10;
    const total = n * H + (n - 1) * GAP;
    const centerY = mcpIds.length ? 372 : 314;
    let y = Math.max(58, centerY - total / 2);
    const limit = 560 - H;
    const step = total > 500 ? (500 - n * H) / Math.max(1, n - 1) : GAP;
    for (const item of extItems) {
      push({
        id: item.id,
        label: item.label,
        sub: item.sub,
        x: COL.ext,
        y: Math.min(y, limit),
        w: 200,
        h: H,
        tone: item.tone,
        badge: item.badge,
      });
      y += H + step;
    }
  }

  if (mcpOn) {
    push({ id: 'mcp_client', label: 'MCP Client', sub: 'JSON-RPC · 握手/发现/调用', x: COL.cap, y: 430, w: 148, h: 62, tone: 'guard' });
  }

  const e = (edge: ArchEdge) => edges.push(edge);

  e({ id: 'user->app', from: 'user', to: 'app', kind: 'request' });
  e({ id: 'app->user', from: 'app', to: 'user', kind: 'response' });

  if (pb) {
    e({ id: 'app->prompt_builder', from: 'app', to: 'prompt_builder', kind: 'context' });
    e({ id: 'prompt_builder->llm', from: 'prompt_builder', to: 'llm', kind: 'request' });
  } else {
    e({ id: 'app->llm', from: 'app', to: 'llm', kind: 'request' });
  }

  e({ id: 'llm->app', from: 'llm', to: 'app', kind: 'response' });

  if (cfg.skill) {
    e({ id: 'app->skill_index', from: 'app', to: 'skill_index', kind: 'control', dashed: true, label: '查索引' });
    e({ id: 'skill_index->skill_loader', from: 'skill_index', to: 'skill_loader', kind: 'control', dashed: true, label: '命中才读' });
    if (pkgOn) {
      e({
        id: 'skill_loader->skill_package',
        from: 'skill_loader',
        to: 'skill_package',
        kind: 'control',
        dashed: true,
        label: '挂载清单',
      });
      e({
        id: 'skill_package->prompt_builder',
        from: 'skill_package',
        to: 'prompt_builder',
        kind: 'context',
        label: '按需取用',
      });
    }
    if (pb) e({ id: 'skill_loader->prompt_builder', from: 'skill_loader', to: 'prompt_builder', kind: 'context', label: '注入主指令' });
  }

  if (cfg.rag) {
    e({ id: 'app->retriever', from: 'app', to: 'retriever', kind: 'request' });
    e({ id: 'retriever->app', from: 'retriever', to: 'app', kind: 'data', label: '片段' });
    e({ id: 'retriever->kb', from: 'retriever', to: 'kb', kind: 'data' });
  }

  if (toolsOn) {
    e({ id: 'llm->tool_handler', from: 'llm', to: 'tool_handler', kind: 'control', dashed: true, label: 'tool_calls' });
    e({ id: 'tool_handler->llm', from: 'tool_handler', to: 'llm', kind: 'data', label: '工具结果' });
    for (const t of localTools) {
      e({ id: `tool_handler->tool_${t}`, from: 'tool_handler', to: `tool_${t}`, kind: 'request' });
      e({ id: `tool_${t}->tool_handler`, from: `tool_${t}`, to: 'tool_handler', kind: 'data' });
    }
    if (mcpOn) {
      e({ id: 'tool_handler->mcp_client', from: 'tool_handler', to: 'mcp_client', kind: 'request' });
      e({ id: 'mcp_client->tool_handler', from: 'mcp_client', to: 'tool_handler', kind: 'data', dashed: true });
      for (const s of mcpUsed) {
        e({ id: `mcp_client->mcp_${s.id}`, from: 'mcp_client', to: `mcp_${s.id}`, kind: 'request' });
        e({ id: `mcp_${s.id}->mcp_client`, from: `mcp_${s.id}`, to: 'mcp_client', kind: 'data', dashed: true });
      }
    }
  }

  return { nodes, edges };
}

/** 事件 → 高亮连线。返回该事件正在使用/刚完成的边集合 */
export function eventEdges(evtType: string, cfg: RunConfig, payload: any): string[] {
  const pb = promptBuilderActive(cfg);
  const sid = payload?.serverId || serverIdOf(payload?.toolName || '');
  const mcpEdge = sid ? `mcp_client->mcp_${sid}` : null;
  const mcpBack = sid ? `mcp_${sid}->mcp_client` : null;

  switch (evtType) {
    case 'run_started':
      return ['user->app'];
    case 'system_prompt_applied':
      return pb ? ['app->prompt_builder'] : [];
    case 'skill_index_loaded':
      return ['app->skill_index'];
    case 'skill_matched':
      return payload?.matched ? ['app->skill_index', 'skill_index->skill_loader'] : ['app->skill_index'];
    case 'skill_skipped':
    case 'skill_discovered':
      return ['app->skill_index'];
    case 'skill_loaded':
      return ['skill_index->skill_loader', 'skill_loader->prompt_builder'];
    case 'skill_package_mounted':
      return ['skill_index->skill_loader', 'skill_loader->skill_package'];
    case 'skill_resource_read':
    case 'skill_script_run':
      return ['skill_loader->skill_package', 'skill_package->prompt_builder'];
    case 'skill_tools_unavailable':
      return ['skill_loader->skill_package'];
    case 'rag_search_started':
      return ['app->retriever', 'retriever->kb'];
    case 'rag_search_completed':
      return ['retriever->kb', 'retriever->app'];
    case 'rag_context_injected':
      return pb ? ['retriever->app', 'app->prompt_builder'] : ['retriever->app', 'app->llm'];
    case 'prompt_built':
      return pb ? ['app->prompt_builder', 'prompt_builder->llm'] : ['app->llm'];
    case 'llm_request_started':
      return pb ? ['prompt_builder->llm'] : ['app->llm'];
    case 'llm_output_delta':
      return ['llm->app'];
    case 'tool_call_requested':
      return ['llm->tool_handler'];
    case 'tool_call_started':
      if (sid) return ['tool_handler->mcp_client', mcpEdge!];
      return [`tool_handler->tool_${payload?.toolName}`];
    case 'tool_call_completed':
      if (sid) return [mcpBack!, 'mcp_client->tool_handler', 'tool_handler->llm'];
      return [`tool_${payload?.toolName}->tool_handler`, 'tool_handler->llm'];
    case 'mcp_tools_call':
      return sid ? ['tool_handler->mcp_client', mcpEdge!] : [];
    case 'mcp_connected':
      return ['tool_handler->mcp_client', mcpEdge!];
    case 'mcp_connect_failed':
      return sid ? ['tool_handler->mcp_client', mcpEdge!] : [];
    case 'run_completed':
      return ['llm->app', 'app->user'];
    default:
      return [];
  }
}

/** 事件 → 节点状态 */
export function eventNodes(evtType: string, cfg: RunConfig, payload: any): { id: string; status: string }[] {
  const pb = promptBuilderActive(cfg);
  const sid = payload?.serverId || serverIdOf(payload?.toolName || '');

  switch (evtType) {
    case 'run_started':
      return [{ id: 'user', status: 'success' }];
    case 'prompt_built':
      return pb ? [{ id: 'prompt_builder', status: 'success' }] : [];
    case 'llm_request_started':
    case 'llm_output_delta':
      return [{ id: 'llm', status: 'running' }];
    case 'llm_response_completed':
      return [{ id: 'llm', status: 'success' }];
    case 'skill_index_loaded':
      return [{ id: 'skill_index', status: 'success' }];
    case 'skill_matched':
      return payload?.matched
        ? [
            { id: 'skill_index', status: 'success' },
            { id: 'skill_loader', status: 'running' },
          ]
        : [
            { id: 'skill_index', status: 'success' },
            { id: 'skill_loader', status: 'skipped' },
          ];
    case 'skill_discovered':
      return [{ id: 'skill_index', status: 'success' }];
    case 'skill_loaded':
      return [{ id: 'skill_loader', status: 'success' }];
    case 'skill_package_mounted':
      return [
        { id: 'skill_loader', status: 'success' },
        { id: 'skill_package', status: 'success' },
      ];
    case 'skill_resource_read':
    case 'skill_script_run':
      return [{ id: 'skill_package', status: 'success' }];
    case 'skill_tools_unavailable':
      return [{ id: 'skill_package', status: 'skipped' }];
    case 'skill_skipped':
      return [{ id: 'skill_loader', status: 'skipped' }];
    case 'rag_search_started':
      return [
        { id: 'retriever', status: 'running' },
        { id: 'kb', status: 'running' },
      ];
    case 'rag_search_completed':
      return [
        { id: 'retriever', status: 'success' },
        { id: 'kb', status: 'success' },
      ];
    case 'tools_registered':
      return [{ id: 'tool_handler', status: 'idle' }];
    case 'tool_call_requested':
      return [{ id: 'tool_handler', status: 'running' }];
    case 'tool_call_started':
      if (sid) {
        return [
          { id: 'mcp_client', status: 'running' },
          { id: `mcp_${sid}`, status: 'running' },
        ];
      }
      return [{ id: `tool_${payload?.toolName}`, status: 'running' }];
    case 'tool_call_completed':
      if (sid) {
        return [
          { id: 'mcp_client', status: 'success' },
          { id: `mcp_${sid}`, status: 'success' },
        ];
      }
      return [{ id: `tool_${payload?.toolName}`, status: 'success' }];
    case 'tool_call_failed':
      return sid
        ? [
            { id: `mcp_${sid}`, status: 'error' },
            { id: 'tool_handler', status: 'error' },
          ]
        : [
            { id: `tool_${payload?.toolName}`, status: 'error' },
            { id: 'tool_handler', status: 'error' },
          ];
    case 'mcp_connected':
      return [
        { id: 'mcp_client', status: 'success' },
        { id: `mcp_${sid}`, status: 'success' },
      ];
    case 'mcp_connect_failed':
      return [
        { id: 'mcp_client', status: 'error' },
        { id: `mcp_${sid}`, status: 'error' },
      ];
    case 'run_completed':
      return [{ id: 'app', status: 'success' }];
    case 'run_failed':
      return [{ id: 'app', status: 'error' }];
    default:
      return [];
  }
}
