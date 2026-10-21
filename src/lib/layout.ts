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
  return Boolean(cfg.systemPrompt?.enabled || cfg.skills?.length || cfg.rag || cfg.multiTurn);
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
  const mode = cfg.agentMode && cfg.agentMode !== 'off' ? cfg.agentMode : null;
  if (mode) return buildModeGraph(cfg, toolNames, servers, mode);

  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const pb = promptBuilderActive(cfg);
  const toolsOn = Boolean(cfg.functionCalling);
  // Skill 能力包：只要开启任意一路按需通道，就画出能力包节点
  const pkgOn = Boolean(cfg.skills?.length) && (cfg.skillRefs !== false || cfg.skillScripts !== false);

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

  if (cfg.skills?.length) {
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

  if (cfg.skills?.length) {
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
  const mode = cfg.agentMode && cfg.agentMode !== 'off' ? cfg.agentMode : null;
  if (mode) return modeEventEdges(mode, evtType, payload);

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
    case 'skill_selected':
      return payload?.selectedCount
        ? ['app->skill_index', 'skill_index->skill_loader']
        : ['app->skill_index'];
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
  const mode = cfg.agentMode && cfg.agentMode !== 'off' ? cfg.agentMode : null;
  if (mode) return modeEventNodes(mode, evtType, payload);

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
    case 'skill_selected':
      return payload?.selectedCount
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

// ===========================================================================
// 08–11 章：Agent 运行模式的画布拓扑
//
// 与 01–07 章不同，这几章的重点不是「能力有没有开」，而是「控制流怎么走」。
// 因此画布上出现的是规划器、解析器、判定器与执行器，而不是 SKILL / RAG 那些能力节点。
// ===========================================================================

const MODE_COL = { user: 28, app: 172, mid: 352, cap: 528, ext: 742 };

function modeExtColumn(
  cfg: RunConfig,
  toolNames: string[],
  servers: McpServerBrief[],
  push: (n: ArchNode) => void
) {
  const localTools = toolNames.filter((t) => !serverIdOf(t));
  const mcpIds = [...new Set(toolNames.map((t) => serverIdOf(t)).filter(Boolean))] as string[];
  const mcpUsed = servers.filter((s) => mcpIds.includes(s.id));

  const items: { id: string; label: string; sub: string; tone: ArchNode['tone']; badge?: string }[] = [];
  for (const t of localTools) {
    const info = TOOL_LABELS[t] || { label: t, sub: t };
    items.push({ id: `tool_${t}`, label: info.label, sub: info.sub, tone: 'resource', badge: '本地' });
  }
  for (const s of mcpUsed) {
    items.push({
      id: `mcp_${s.id}`,
      label: s.short || s.id,
      sub: `${s.toolCount ?? 0} 个工具 · ${s.type === 'stdio' ? 'stdio' : 'HTTP'}`,
      tone: 'guard',
      badge: 'MCP',
    });
  }

  if (!items.length) return { localTools, mcpUsed };

  const n = items.length;
  const H = n <= 3 ? 58 : n <= 5 ? 50 : 44;
  const GAP = n <= 3 ? 14 : 10;
  const total = n * H + (n - 1) * GAP;
  let y = Math.max(50, 320 - total / 2);
  for (const item of items) {
    push({
      id: item.id,
      label: item.label,
      sub: item.sub,
      x: MODE_COL.ext,
      y,
      w: 200,
      h: H,
      tone: item.tone,
      badge: item.badge,
    });
    y += H + GAP;
  }
  return { localTools, mcpUsed };
}

export function buildModeGraph(
  cfg: RunConfig,
  toolNames: string[],
  servers: McpServerBrief[],
  mode: 'structured' | 'agent' | 'react' | 'plan'
) {
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const push = (n: ArchNode) => nodes.push(n);
  const e = (edge: ArchEdge) => edges.push(edge);
  const toolsOn = toolNames.length > 0;

  push({ id: 'user', label: '用户', sub: '提出目标', x: MODE_COL.user, y: 282, w: 112, h: 66, tone: 'core' });
  push({ id: 'app', label: 'Web 应用', sub: '编排 · 执行 · 校验', x: MODE_COL.app, y: 276, w: 148, h: 78, tone: 'core' });
  e({ id: 'user->app', from: 'user', to: 'app', kind: 'request' });
  e({ id: 'app->user', from: 'app', to: 'user', kind: 'response' });

  if (mode === 'structured') {
    push({ id: 'llm', label: 'LLM', sub: '按 Schema 抽取', x: MODE_COL.mid, y: 276, w: 140, h: 74, tone: 'model' });
    push({
      id: 'structurer',
      label: '结构化约束',
      sub: 'response_format + 校验',
      x: MODE_COL.cap,
      y: 276,
      w: 158,
      h: 74,
      tone: 'capability',
    });
    push({ id: 'rules', label: '规则引擎', sub: '阈值判定 · 确定性', x: MODE_COL.ext, y: 276, w: 164, h: 74, tone: 'data' });
    push({
      id: 'renderer',
      label: '报告渲染',
      sub: '模板拼装 · 非模型撰写',
      x: MODE_COL.ext,
      y: 384,
      w: 164,
      h: 58,
      tone: 'capability',
    });

    e({ id: 'app->llm', from: 'app', to: 'llm', kind: 'request' });
    e({ id: 'llm->structurer', from: 'llm', to: 'structurer', kind: 'control', dashed: true, label: 'response_format' });
    e({ id: 'structurer->rules', from: 'structurer', to: 'rules', kind: 'data', label: '校验通过' });
    e({ id: 'rules->renderer', from: 'rules', to: 'renderer', kind: 'data' });
    e({ id: 'renderer->app', from: 'renderer', to: 'app', kind: 'response', label: '成稿' });
    return { nodes, edges };
  }

  // 三种循环模式共享骨架：LLM 在中间，循环的控制节点在上方，工具在右侧
  push({ id: 'llm', label: 'LLM', sub: mode === 'plan' ? '规划 + 汇总' : '推理 + 决策', x: MODE_COL.mid, y: 276, w: 150, h: 74, tone: 'model' });

  if (mode === 'plan') {
    push({ id: 'planner', label: '规划器', sub: '产出结构化计划', x: MODE_COL.mid, y: 116, w: 150, h: 64, tone: 'capability' });
    push({ id: 'executor', label: '执行器', sub: '按步骤执行 · 失败重规划', x: MODE_COL.cap, y: 116, w: 158, h: 64, tone: 'capability' });
    e({ id: 'app->llm', from: 'app', to: 'llm', kind: 'context', label: '目标' });
    e({ id: 'llm->planner', from: 'llm', to: 'planner', kind: 'control', dashed: true, label: '出计划' });
    e({ id: 'planner->executor', from: 'planner', to: 'executor', kind: 'data', label: '计划' });
    if (toolsOn) {
      e({ id: 'executor->tool_handler', from: 'executor', to: 'tool_handler', kind: 'request' });
      e({ id: 'tool_handler->executor', from: 'tool_handler', to: 'executor', kind: 'data', label: '观测' });
    }
    e({ id: 'executor->llm', from: 'executor', to: 'llm', kind: 'context', label: '观测汇总' });
    e({ id: 'llm->app', from: 'llm', to: 'app', kind: 'response', label: '结论' });
  } else if (mode === 'react') {
    push({ id: 'react_parser', label: 'ReAct 解析', sub: 'Thought / Action / Final', x: MODE_COL.mid, y: 116, w: 150, h: 64, tone: 'capability' });
    e({ id: 'app->llm', from: 'app', to: 'llm', kind: 'request' });
    e({ id: 'llm->react_parser', from: 'llm', to: 'react_parser', kind: 'control', dashed: true, label: '原始文本' });
    if (toolsOn) {
      e({ id: 'react_parser->tool_handler', from: 'react_parser', to: 'tool_handler', kind: 'request', label: 'Action' });
      e({ id: 'tool_handler->llm', from: 'tool_handler', to: 'llm', kind: 'data', label: 'Observation' });
    }
    e({ id: 'react_parser->app', from: 'react_parser', to: 'app', kind: 'response', label: 'Final' });
  } else {
    push({ id: 'agent_judge', label: '进展判定', sub: 'done? 还缺什么', x: MODE_COL.mid, y: 116, w: 150, h: 64, tone: 'capability' });
    e({ id: 'app->llm', from: 'app', to: 'llm', kind: 'request' });
    e({ id: 'llm->agent_judge', from: 'llm', to: 'agent_judge', kind: 'control', dashed: true, label: '决策 JSON' });
    if (toolsOn) {
      e({ id: 'agent_judge->tool_handler', from: 'agent_judge', to: 'tool_handler', kind: 'request', label: 'next_action' });
      e({ id: 'tool_handler->llm', from: 'tool_handler', to: 'llm', kind: 'data', label: 'Observation' });
    }
    e({ id: 'agent_judge->app', from: 'agent_judge', to: 'app', kind: 'response', label: 'answer' });
  }

  if (toolsOn) {
    push({
      id: 'tool_handler',
      label: '工具处理器',
      sub: '校验 · 执行 · 回传',
      x: MODE_COL.cap,
      y: 276,
      w: 150,
      h: 74,
      tone: 'capability',
    });
  }

  modeExtColumn(cfg, toolNames, servers, push);

  for (const t of toolNames.filter((x) => !serverIdOf(x))) {
    e({ id: `tool_handler->tool_${t}`, from: 'tool_handler', to: `tool_${t}`, kind: 'request' });
    e({ id: `tool_${t}->tool_handler`, from: `tool_${t}`, to: 'tool_handler', kind: 'data' });
  }

  return { nodes, edges };
}

/** 模式化事件的连线映射 */
export function modeEventEdges(mode: string, evtType: string, payload: any): string[] {
  if (mode === 'structured') {
    switch (evtType) {
      case 'prompt_built':
      case 'structured_schema_sent':
        return ['app->llm', 'llm->structurer'];
      case 'structured_call_completed':
      case 'structured_output_received':
        return ['llm->structurer'];
      case 'schema_validated':
        return payload?.ok ? ['llm->structurer', 'structurer->rules'] : ['llm->structurer'];
      case 'structured_repair_requested':
      case 'structured_fallback':
        return ['llm->structurer'];
      case 'rules_evaluated':
        return ['structurer->rules', 'rules->renderer'];
      case 'structured_answer_rendered':
        return ['rules->renderer', 'renderer->app'];
      case 'run_completed':
        return ['renderer->app', 'app->user'];
      default:
        return [];
    }
  }

  if (mode === 'plan') {
    switch (evtType) {
      case 'plan_requested':
      case 'plan_validated':
      case 'plan_repair_requested':
        return ['app->llm', 'llm->planner'];
      case 'plan_created':
        return ['llm->planner', 'planner->executor'];
      case 'plan_step_started':
      case 'plan_step_args_resolved':
        return ['planner->executor', 'executor->tool_handler'];
      case 'plan_step_completed':
        return ['tool_handler->executor'];
      case 'plan_replan_requested':
      case 'plan_revised':
        return ['executor->llm', 'llm->planner'];
      case 'tool_call_completed':
        return ['tool_handler->executor'];
      case 'plan_synthesis_started':
      case 'plan_synthesis_completed':
        return ['executor->llm'];
      case 'plan_completed':
        return ['llm->app'];
      case 'run_completed':
        return ['llm->app', 'app->user'];
      default:
        return [];
    }
  }

  if (mode === 'react') {
    switch (evtType) {
      case 'react_step_started':
        return ['app->llm'];
      case 'react_thought':
        return ['llm->react_parser'];
      case 'react_action':
        return ['react_parser->tool_handler'];
      case 'react_observation':
        return ['tool_handler->llm'];
      case 'react_final':
        return ['react_parser->app'];
      case 'react_parse_failed':
      case 'react_action_invalid':
        return ['llm->react_parser'];
      case 'run_completed':
        return ['react_parser->app', 'app->user'];
      default:
        return [];
    }
  }

  switch (evtType) {
    case 'agent_step_started':
      return ['app->llm'];
    case 'agent_step_decided':
      return payload?.action ? ['llm->agent_judge', 'agent_judge->tool_handler'] : ['llm->agent_judge'];
    case 'agent_observation':
      return ['tool_handler->llm'];
    case 'agent_goal_reached':
      return ['agent_judge->app'];
    case 'agent_decision_invalid':
    case 'agent_action_invalid':
      return ['llm->agent_judge'];
    case 'run_completed':
      return ['agent_judge->app', 'app->user'];
    default:
      return [];
  }
}

/** 模式化事件的节点状态映射 */
export function modeEventNodes(mode: string, evtType: string, payload: any): { id: string; status: string }[] {
  if (mode === 'structured') {
    switch (evtType) {
      case 'prompt_built':
        return [{ id: 'app', status: 'success' }];
      case 'structured_schema_sent':
        return [{ id: 'llm', status: 'running' }];
      case 'structured_call_completed':
      case 'structured_output_received':
        return [{ id: 'llm', status: 'success' }];
      case 'schema_validated':
        return [{ id: 'structurer', status: payload?.ok ? 'success' : 'error' }];
      case 'rules_evaluated':
        return [
          { id: 'rules', status: 'success' },
          { id: 'structurer', status: 'success' },
        ];
      case 'structured_answer_rendered':
        return [{ id: 'renderer', status: 'success' }];
      case 'structured_failed':
        return [
          { id: 'structurer', status: 'error' },
          { id: 'rules', status: 'skipped' },
        ];
      case 'run_completed':
        return [{ id: 'app', status: 'success' }];
      case 'run_failed':
        return [{ id: 'app', status: 'error' }];
      default:
        return [];
    }
  }

  if (mode === 'plan') {
    switch (evtType) {
      case 'plan_requested':
        return [{ id: 'planner', status: 'running' }];
      case 'plan_validated':
        return [{ id: 'planner', status: payload?.ok ? 'success' : 'error' }];
      case 'plan_created':
        return [
          { id: 'planner', status: 'success' },
          { id: 'executor', status: 'running' },
        ];
      case 'plan_step_started':
      case 'plan_step_args_resolved':
        return [{ id: 'executor', status: 'running' }];
      case 'plan_step_completed':
        return [{ id: 'executor', status: payload?.ok ? 'running' : 'error' }];
      case 'plan_revised':
        return [{ id: 'planner', status: 'success' }];
      case 'plan_synthesis_started':
        return [{ id: 'llm', status: 'running' }];
      case 'plan_synthesis_completed':
        return [{ id: 'llm', status: 'success' }];
      case 'plan_completed':
        return [{ id: 'executor', status: 'success' }];
      case 'plan_failed':
        return [
          { id: 'planner', status: 'error' },
          { id: 'executor', status: 'skipped' },
        ];
      case 'run_completed':
        return [{ id: 'app', status: 'success' }];
      case 'run_failed':
        return [{ id: 'app', status: 'error' }];
      default:
        return [];
    }
  }

  if (mode === 'react') {
    switch (evtType) {
      case 'react_step_started':
        return [{ id: 'llm', status: 'running' }];
      case 'react_thought':
        return [
          { id: 'llm', status: 'success' },
          { id: 'react_parser', status: 'running' },
        ];
      case 'react_action':
        return [{ id: 'react_parser', status: 'success' }];
      case 'react_observation':
        return [{ id: 'llm', status: 'running' }];
      case 'react_final':
        return [{ id: 'react_parser', status: 'success' }];
      case 'react_parse_failed':
        return [{ id: 'react_parser', status: 'error' }];
      case 'run_completed':
        return [{ id: 'app', status: 'success' }];
      case 'run_failed':
        return [{ id: 'app', status: 'error' }];
      default:
        return [];
    }
  }

  switch (evtType) {
    case 'agent_goal_set':
      return [{ id: 'agent_judge', status: 'running' }];
    case 'agent_step_started':
      return [{ id: 'llm', status: 'running' }];
    case 'agent_step_decided':
      return [
        { id: 'llm', status: 'success' },
        { id: 'agent_judge', status: 'success' },
      ];
    case 'agent_observation':
      return [{ id: 'llm', status: 'running' }];
    case 'agent_goal_reached':
      return [{ id: 'agent_judge', status: 'success' }];
    case 'agent_decision_invalid':
      return [{ id: 'agent_judge', status: 'error' }];
    case 'agent_budget_exhausted':
      return [{ id: 'agent_judge', status: 'error' }];
    case 'run_completed':
      return [{ id: 'app', status: 'success' }];
    case 'run_failed':
      return [{ id: 'app', status: 'error' }];
    default:
      return [];
  }
}
