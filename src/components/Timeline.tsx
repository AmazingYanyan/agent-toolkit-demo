import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunEvent } from '../lib/types';

const META: Record<string, { label: (p: any) => string; color: string; icon: string }> = {
  run_started: { label: () => '收到任务，开始运行', color: '#33415C', icon: '▶' },
  system_prompt_applied: { label: () => '应用 System Prompt', color: '#2F6F8F', icon: 'P' },
  skill_index_loaded: {
    label: (p) => `读取 Skill 索引：${p.count} 个 · 元数据 ${p.indexChars} 字（正文未读）`,
    color: '#8C6A3F',
    icon: 'S',
  },
  skill_selected: {
    label: (p) =>
      p.selectedCount
        ? `${p.mode === 'all' ? '全部加载' : '自动匹配'}：入选 ${p.selectedCount}/${p.candidates} 个 · 主指令 ${p.totalInstructionChars} 字${
            (p.duplicatePaths || []).length ? ` · ${p.duplicatePaths.length} 处同名资源` : ''
          }`
        : `${p.mode === 'all' ? '全部加载' : '自动匹配'}：${p.candidates} 个候选均未入选，不加载主指令`,
    color: '#8C6A3F',
    icon: 'S',
  },
  skill_loaded: {
    label: (p) => `读取主指令 SKILL.md：${p.name} · ${p.chars} 字${p.total > 1 ? `（${p.order}/${p.total}）` : ''}`,
    color: '#2F6F8F',
    icon: 'S',
  },
  skill_package_mounted: {
    label: (p) =>
      `挂载 ${p.count} 个能力包：${p.skills?.reduce((n: number, s: any) => n + (s.references?.length || 0), 0) || 0} 份资料 / ${
        p.skills?.reduce((n: number, s: any) => n + (s.scripts?.length || 0), 0) || 0
      } 个脚本 · 未读 ${p.unreadChars} 字`,
    color: '#8C6A3F',
    icon: 'S',
  },
  skill_resource_read: {
    label: (p) => `按需读取：${p.skillName} / ${p.title}（${p.chars} 字 · 第 ${p.depth} 层）`,
    color: '#2F6F8F',
    icon: '▤',
  },
  skill_script_run: {
    label: (p) =>
      `执行脚本：${p.skillName} / ${p.name} · 退出码 ${p.exitCode} · 输出 ${p.outputChars} 字（源码 ${p.scriptChars} 字未进上下文）`,
    color: '#B0762A',
    icon: '»',
  },
  skill_tools_unavailable: {
    label: (p) => `能力包未接通：未开启 Function Calling，${p.references} 份资料无法按需读取`,
    color: '#A8AEB7',
    icon: 'S',
  },
  skill_skipped: {
    label: (p) => `本次不加载 Skill 主指令，省下 ${p.savedChars || 0} 字上下文`,
    color: '#A8AEB7',
    icon: 'S',
  },
  skill_discovered: { label: (p) => `发现 Skill：${p.name}`, color: '#8C6A3F', icon: 'S' },
  rag_search_started: {
    label: (p) =>
      `检索知识库：${p.query?.slice(0, 16)}… · ${p.effectiveMode === 'lexical' ? '词法' : p.effectiveMode === 'vector' ? '向量' : '混合'}`,
    color: '#2F6F8F',
    icon: 'R',
  },
  rag_search_completed: { label: (p) => `检索返回 ${p.count} 个片段`, color: '#4A7C59', icon: 'R' },
  rag_context_injected: {
    label: (p) => `注入 ${p.chunks} 个片段（${p.chars} 字）到上下文`,
    color: '#2F6F8F',
    icon: 'R',
  },
  context_dropped: { label: (p) => `丢弃 ${p.droppedMessages} 条历史消息`, color: '#A8AEB7', icon: 'C' },
  tools_registered: {
    label: (p) => `注册工具 ${p.names?.length || 0} 个 · schema ${p.schemaChars || 0} 字`,
    color: '#2F6F8F',
    icon: 'T',
  },
  prompt_built: {
    label: (p) => `构建模型请求（${p.messageCount} 条消息 · ${p.tools?.length || 0} 个工具）`,
    color: '#2F6F8F',
    icon: 'P',
  },
  llm_request_started: { label: (p) => `请求 LLM · 第 ${p.round} 轮`, color: '#C9242B', icon: 'L' },
  llm_response_completed: {
    label: (p) => (p.toolCalls?.length ? `模型提出 ${p.toolCalls.length} 个工具调用` : '模型生成最终回答'),
    color: '#C9242B',
    icon: 'L',
  },
  tool_call_requested: { label: (p) => `模型请求工具：${p.toolName}`, color: '#8C6A3F', icon: '→' },
  permission_checked: {
    label: (p) => (p.allowed ? `权限校验通过（${p.policy || '默认放行'}）` : '权限校验拒绝'),
    color: '#4A7C59',
    icon: '✓',
  },
  tool_call_started: { label: (p) => `执行工具：${p.toolName}`, color: '#8C6A3F', icon: 'E' },
  tool_call_completed: { label: (p) => `工具返回：${p.summary || p.toolName}`, color: '#4A7C59', icon: '✓' },
  tool_call_failed: { label: (p) => `工具失败：${p.toolName}`, color: '#C9242B', icon: '!' },
  tool_call_rejected: { label: (p) => `工具被拒绝：${p.toolName}`, color: '#C9242B', icon: '×' },
  mcp_connected: {
    label: (p) => `${p.server || 'MCP'} 握手完成 · 协议 ${p.protocolVersion} · ${p.tools?.length || 0} 个工具`,
    color: '#6B5B95',
    icon: 'M',
  },
  mcp_connect_failed: { label: (p) => `MCP 连接失败：${p.serverLabel || p.serverId}`, color: '#C9242B', icon: '!' },
  mcp_tools_call: {
    label: (p) => `MCP tools/call：${p.server || p.serverId} / ${p.tool || p.name}`,
    color: '#6B5B95',
    icon: 'M',
  },
  run_completed: { label: () => '运行完成，返回结果', color: '#4A7C59', icon: '■' },
  // ---- 08 结构化输出 ----
  mode_started: { label: (p) => `运行模式：${p.modeLabel} · ${(p.tools || []).length} 个工具`, color: '#6B5B95', icon: 'M' },
  structured_schema_sent: {
    label: (p) => `下发 Schema：${p.schemaName} · ${p.schemaChars} 字（${p.responseFormat}）`,
    color: '#2F6F8F',
    icon: 'J',
  },
  structured_call_completed: {
    label: (p) => `结构化调用：${p.responseFormat} · 返回 ${p.rawChars} 字 · ${p.parsed ? '解析成功' : '解析失败'}`,
    color: '#2F6F8F',
    icon: 'J',
  },
  structured_output_received: {
    label: (p) => `模型返回原文 ${p.rawChars} 字（第 ${p.round} 次）`,
    color: '#2F6F8F',
    icon: 'J',
  },
  schema_validated: {
    label: (p) => (p.ok ? `Schema 校验通过（第 ${p.round} 次）` : `Schema 校验失败：${p.errorCount} 处问题（第 ${p.round} 次）`),
    color: '#4A7C59',
    icon: 'V',
  },
  structured_repair_requested: { label: () => '带着错误清单要求重写一次', color: '#8C6A3F', icon: '↺' },
  structured_fallback: { label: (p) => `退回 ${p.to}：${p.reason?.slice(0, 40)}`, color: '#A8AEB7', icon: '!' },
  rules_evaluated: {
    label: (p) => `规则引擎：${p.triggeredCount} 条触发 / 共 ${(p.results || []).length} 条`,
    color: '#4A7C59',
    icon: 'R',
  },
  structured_answer_rendered: {
    label: (p) => `报告渲染：${p.chars} 字（模板拼装，非模型撰写）`,
    color: '#33415C',
    icon: '¶',
  },
  structured_failed: { label: (p) => `结构化失败：${(p.errors || []).length} 处问题，停止后续流程`, color: '#C9242B', icon: '!' },
  // ---- 11 计划与执行 ----
  plan_requested: { label: (p) => `规划器开始工作：${p.toolCount} 个可用工具`, color: '#6B5B95', icon: 'P' },
  plan_validated: { label: (p) => (p.ok ? '计划校验通过（结构与工具名）' : `计划校验失败：${(p.errors || []).length} 处`), color: '#4A7C59', icon: 'V' },
  plan_repair_requested: { label: () => '计划不合法，要求重写一次', color: '#8C6A3F', icon: '↺' },
  plan_created: { label: (p) => `产出计划：${p.stepCount} 步 · ${p.planChars} 字`, color: '#6B5B95', icon: 'P' },
  plan_step_started: { label: (p) => `执行第 ${p.index}/${p.total} 步：${p.title}`, color: '#8C6A3F', icon: 'E' },
  plan_step_args_resolved: {
    label: (p) =>
      (p.unresolved || []).length
        ? `参数引用未解析：${p.unresolved.length} 处，未执行`
        : `绑定前序结果：${(p.refs || []).length} 个占位符`,
    color: '#2F6F8F',
    icon: '⇄',
  },
  plan_step_completed: {
    label: (p) => (p.ok ? `第 ${p.stepId} 步完成：${p.summary}` : `第 ${p.stepId} 步失败：${p.error}`),
    color: '#4A7C59',
    icon: '✓',
  },
  plan_replan_requested: { label: () => '执行失败，请求重规划（限一次）', color: '#C9242B', icon: '↺' },
  plan_revised: { label: (p) => `计划已修订：${(p.revised_steps || []).length} 步 · ${p.reason?.slice(0, 40)}`, color: '#6B5B95', icon: 'P' },
  plan_revision_failed: { label: () => '重规划失败，按原计划收尾', color: '#C9242B', icon: '!' },
  plan_synthesis_started: {
    label: (p) => `汇总阶段：${p.observations} 条观测 / ${p.observationChars} 字`,
    color: '#2F6F8F',
    icon: 'L',
  },
  plan_synthesis_completed: { label: (p) => `汇总完成：${p.chars} 字`, color: '#2F6F8F', icon: 'L' },
  plan_completed: { label: (p) => `计划执行结束：成功 ${p.okCount} / 失败 ${p.failedCount}`, color: '#33415C', icon: '■' },
  plan_failed: { label: (p) => `计划生成失败：${(p.errors || []).length} 处`, color: '#C9242B', icon: '!' },
  plan_budget_exhausted: { label: (p) => `步数预算用尽，剩余 ${p.remaining} 步未执行`, color: '#C9242B', icon: '!' },
  // ---- 10 ReAct ----
  react_step_started: { label: (p) => `第 ${p.step}/${p.maxSteps} 步：发起模型调用`, color: '#8C6A3F', icon: 'R' },
  react_thought: { label: (p) => `Thought：${String(p.thought || '').slice(0, 30)}…`, color: '#2F6F8F', icon: 'T' },
  react_action: { label: (p) => `Action：${p.action}`, color: '#8C6A3F', icon: '→' },
  react_observation: {
    label: (p) => `Observation：${p.chars} 字${p.ok ? '' : '（工具失败）'}`,
    color: '#4A7C59',
    icon: 'O',
  },
  react_final: { label: (p) => `Final Answer：${p.chars} 字`, color: '#33415C', icon: 'F' },
  react_parse_failed: { label: (p) => `解析失败：${p.reason?.slice(0, 40)}`, color: '#C9242B', icon: '!' },
  react_action_invalid: { label: (p) => `Action 不在清单中：${p.action}`, color: '#C9242B', icon: '!' },
  react_budget_exhausted: { label: (p) => `步数用尽（${p.step} 步）仍未收敛`, color: '#C9242B', icon: '!' },
  // ---- 09 Agent 循环 ----
  agent_goal_set: { label: (p) => `设定目标：${String(p.goal || '').slice(0, 26)}…`, color: '#33415C', icon: 'G' },
  agent_step_started: { label: (p) => `第 ${p.step}/${p.maxSteps} 轮：判断进展`, color: '#33415C', icon: 'A' },
  agent_step_decided: {
    label: (p) =>
      p.done ? '模型判断：目标已达成' : p.action ? `模型决定：调用 ${p.action.tool}` : '模型未给出下一步',
    color: '#2F6F8F',
    icon: 'D',
  },
  agent_observation: { label: (p) => `观测回灌：${p.chars} 字`, color: '#4A7C59', icon: 'O' },
  agent_goal_reached: { label: (p) => `目标达成（第 ${p.step} 轮）`, color: '#4A7C59', icon: '✓' },
  agent_decision_invalid: { label: (p) => `决策格式不合规：${(p.errors || []).length} 处`, color: '#C9242B', icon: '!' },
  agent_action_invalid: { label: (p) => `工具不在清单：${p.tool}`, color: '#C9242B', icon: '!' },
  agent_goal_aborted: { label: (p) => `循环中止：${p.reason}`, color: '#C9242B', icon: '!' },
  agent_budget_exhausted: { label: (p) => `步数预算用尽（${p.step} 步）`, color: '#C9242B', icon: '!' },
  run_failed: { label: (p) => `运行失败：${p.error}`, color: '#C9242B', icon: '!' },
};

/** 多轮对话的颜色：按对话顺序循环，一眼区分「这是第几次」 */
const TURN_COLORS = ['#C9242B', '#2F6F8F', '#4A7C59', '#8C6A3F', '#6B5B95', '#B0762A'];

interface Props {
  events: RunEvent[];
  selectedId: string | null;
  onSelect: (evt: RunEvent) => void;
  collapsed: boolean;
  onToggle: () => void;
  running: boolean;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function clip(text: string, n = 34) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

interface Group {
  runId: string;
  index: number;
  question: string;
  rows: RunEvent[];
  durationMs: number | null;
  status: string;
}

export default function Timeline({ events, selectedId, onSelect, collapsed, onToggle, running }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<'all' | 'current'>('all');
  const rows = events.filter((e) => e.event_type !== 'llm_output_delta');

  // 按 run_id 分组：每次对话一段，互不覆盖
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    const map = new Map<string, number>();
    for (const e of rows) {
      const rid = e.run_id || 'unknown';
      if (!map.has(rid)) {
        map.set(rid, out.length);
        out.push({ runId: rid, index: out.length, question: '', rows: [], durationMs: null, status: 'ok' });
      }
      const g = out[map.get(rid)!];
      g.rows.push(e);
      if (e.event_type === 'run_started') g.question = e.payload?.question || '';
      if (e.event_type === 'run_failed') g.status = 'error';
    }
    for (const g of out) {
      const first = g.rows[0];
      const last = g.rows[g.rows.length - 1];
      if (first && last && last.timestamp) {
        g.durationMs = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();
      }
    }
    return out;
  }, [rows]);

  const currentRunId = groups.length ? groups[groups.length - 1].runId : null;
  const visible = scope === 'current' ? groups.filter((g) => g.runId === currentRunId) : groups;
  const colorOf = (gi: number) => TURN_COLORS[gi % TURN_COLORS.length];

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [rows.length, scope]);

  const totalMs = groups.reduce((n, g) => n + (g.durationMs || 0), 0);

  return (
    <div className={`timeline ${collapsed ? 'collapsed' : ''}`}>
      <div className="timeline-head">
        <span className="timeline-title">执行时间线</span>
        <span className="timeline-meta">
          {groups.length > 1 ? `${groups.length} 次对话 · ` : ''}
          {rows.length} 个事件
          {totalMs ? ` · ${(totalMs / 1000).toFixed(2)}s` : ''}
        </span>
        {running && (
          <span className="run-status" style={{ margin: 0, padding: '2px 8px' }}>
            <span className="spinner" />
          </span>
        )}
        {groups.length > 1 && (
          <div className="tl-scope">
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
              全部 {groups.length}
            </button>
            <button className={scope === 'current' ? 'on' : ''} onClick={() => setScope('current')}>
              只看本次
            </button>
          </div>
        )}
        <button className="timeline-collapse" onClick={onToggle}>
          {collapsed ? '展开' : '收起'}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}>
            <path d="M2 6l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {!collapsed && (
        <div className="timeline-body" ref={bodyRef}>
          {rows.length === 0 ? (
            <div className="tl-empty">
              还没有运行记录。
              <br />
              点击右侧「运行」后，这里会按真实执行顺序记录每一步。
            </div>
          ) : (
            visible.map((g) => {
              const color = colorOf(g.index);
              return (
                <div className="tl-turn" key={g.runId} data-status={g.status}>
                  <div className="tl-turn-head" style={{ borderLeftColor: color }}>
                    <span className="tl-turn-dot" style={{ background: color }} />
                    <span className="tl-turn-name">第 {g.index + 1} 次对话</span>
                    <span className="tl-turn-q" title={g.question}>
                      {clip(g.question, 30)}
                    </span>
                    <span className="tl-turn-meta">
                      {g.rows.length} 事件
                      {g.durationMs ? ` · ${(g.durationMs / 1000).toFixed(2)}s` : ''}
                    </span>
                  </div>
                  {g.rows.map((e) => {
                    const m = META[e.event_type] || { label: () => e.event_type, color: '#A8AEB7', icon: '·' };
                    return (
                      <button
                        key={e.event_id}
                        className={`tl-row ${selectedId === e.event_id ? 'sel' : ''}`}
                        onClick={() => onSelect(e)}
                        style={{ borderLeftColor: color }}
                      >
                        <span className="tl-time">{fmtTime(e.timestamp)}</span>
                        <span className="tl-icon" style={{ background: m.color }}>
                          {m.icon}
                        </span>
                        <span className="tl-text">{m.label(e.payload || {})}</span>
                        <span className="tl-tag">{e.component_id}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
