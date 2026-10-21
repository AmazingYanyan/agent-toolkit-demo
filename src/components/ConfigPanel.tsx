import { useEffect, useMemo, useState } from 'react';
import type { RunConfig } from '../lib/types';
import { api } from '../lib/api';

interface Props {
  cfg: RunConfig;
  onChange: (patch: Partial<RunConfig>) => void;
  skills: any[];
  skillIndex: any;
  onOpenSkill: (id: string) => void;
  kbStats: any;
  onOpenKb: () => void;
  onShowPrompt: () => void;
  mcp?: any;
  onOpenMcp: () => void;
  onOpenToolSchema: () => void;
  onRefreshMcp: () => void;
  onCfgSaved: () => void;
}

const LOCAL_TOOLS = [
  { name: 'get_company_info', label: '企业工商查询', desc: '演示库：注册资本、登记状态' },
  { name: 'get_company_financials', label: '企业财务查询', desc: '演示库：营收、资产负债、现金流' },
  { name: 'calculate_ratio', label: '确定性指标计算', desc: '由程序算比率，不靠口算' },
  { name: 'evaluate_risk_rules', label: '演示风险规则引擎', desc: '阈值是否触发由程序判定' },
];

/** 五种运行模式：决定「谁在控制流程」 */
const MODE_OPTIONS: { id: RunConfig['agentMode']; label: string; desc: string }[] = [
  { id: 'off', label: '单轮问答', desc: '问一次答一次，由应用固定编排' },
  { id: 'structured', label: '结构化输出', desc: '按 Schema 输出 JSON，程序校验并判定' },
  { id: 'agent', label: '目标循环', desc: '模型自己判断还缺什么，直到声明完成' },
  { id: 'react', label: 'ReAct', desc: '文本协议 Thought / Action / Observation' },
  { id: 'plan', label: 'Plan-and-Execute', desc: '先出计划，再逐步执行，失败可修订' },
];

function Switch({ on, locked, onClick }: { on: boolean; locked?: boolean; onClick: () => void }) {
  return (
    <button
      className={`switch ${on ? 'on' : ''} ${locked ? 'locked' : ''}`}
      onClick={() => !locked && onClick()}
      aria-pressed={on}
    />
  );
}

function Row({
  title,
  desc,
  detail,
  on,
  locked,
  onToggle,
  extra,
  badge,
}: {
  title: string;
  desc?: string;
  detail?: string;
  on: boolean;
  locked?: boolean;
  onToggle?: () => void;
  extra?: React.ReactNode;
  badge?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`cfg-row ${locked ? 'disabled' : ''}`}>
      <div className="cfg-row-main">
        <div className="cfg-row-title">
          {title}
          {badge && <span className="mono-tag">{badge}</span>}
          {detail && (
            <button className="cfg-hint-btn" onClick={() => setOpen(!open)}>
              {open ? '收起' : '这是什么'}
            </button>
          )}
        </div>
        {desc && <div className="cfg-row-desc">{desc}</div>}
        {open && detail && (
          <div className="note" style={{ marginTop: 6, fontSize: 10.5 }}>
            {detail}
          </div>
        )}
        {extra}
      </div>
      <Switch on={on} locked={locked} onClick={() => onToggle?.()} />
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span className={`checkbox ${on ? 'on' : ''}`}>
      {on && (
        <svg viewBox="0 0 10 10" fill="none">
          <path d="M1.5 5.2l2.2 2.2L8.5 2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

/** 单个 MCP 服务器下的工具清单，默认折叠，只显示已选数量 */
function ServerTools({
  group,
  selected,
  onToggle,
  onToggleAll,
}: {
  group: any;
  selected: string[];
  onToggle: (name: string) => void;
  onToggleAll: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = group.tools.filter((t: any) => selected.includes(t.name));

  return (
    <div className={`mcp-group ${group.connected ? '' : 'bad'}`}>
      <div className="mcp-group-head" onClick={() => setOpen(!open)}>
        <span className={`dot ${group.connected ? 'ok' : 'bad'}`} style={{ marginTop: 0 }} />
        <span className="grow">
          <span className="mcp-group-name">{group.short || group.serverLabel}</span>
          <span className="mcp-group-meta">
            {group.connected ? `${group.toolCount} 个工具` : group.error || '未连接'}
            {picked.length > 0 && ` · 已选 ${picked.length}`}
          </span>
        </span>
        <span className="mcp-quick">
          <button
            className="cfg-hint-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleAll(true);
            }}
          >
            全选
          </button>
          <button
            className="cfg-hint-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleAll(false);
            }}
          >
            清空
          </button>
        </span>
        <span className="mcp-caret">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="mcp-tools">
          {group.tools.map((t: any) => (
            <div className="sub-item" key={t.name} onClick={() => onToggle(t.name)} style={{ cursor: 'pointer' }}>
              <Check on={selected.includes(t.name)} />
              <span className="grow" title={t.description}>
                {t.label || t.bare}
              </span>
              <span className="mono-tag" title={t.description}>
                {t.bare}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ConfigPanel({
  cfg,
  onChange,
  skills,
  skillIndex,
  onOpenSkill,
  kbStats,
  onOpenKb,
  onShowPrompt,
  mcp,
  onOpenMcp,
  onOpenToolSchema,
  onRefreshMcp,
  onCfgSaved,
}: Props) {
  const [pkgs, setPkgs] = useState<Record<string, any>>({});

  const skillsKey = cfg.skills.join(',');
  useEffect(() => {
    if (!cfg.skills.length) {
      setPkgs({});
      return;
    }
    let alive = true;
    Promise.all(cfg.skills.map((id) => api.skill(id).catch(() => null))).then((list) => {
      if (!alive) return;
      const map: Record<string, any> = {};
      for (const p of list) if (p) map[p.id] = p;
      setPkgs(map);
    });
    return () => {
      alive = false;
    };
  }, [skillsKey]);

  const toggleSkill = (id: string) => {
    onChange({ skills: cfg.skills.includes(id) ? cfg.skills.filter((x) => x !== id) : [...cfg.skills, id] });
  };

  const selectedTotals = useMemo(() => {
    const list = cfg.skills.map((id) => pkgs[id]).filter(Boolean);
    if (!list.length) return null;
    return {
      instructionChars: list.reduce((n, p) => n + (p.totals?.instructionChars || 0), 0),
      packageChars: list.reduce((n, p) => n + (p.totals?.packageChars || 0), 0),
      references: list.reduce((n, p) => n + (p.references?.length || 0), 0),
      scripts: list.reduce((n, p) => n + (p.scripts?.length || 0), 0),
    };
  }, [cfg.skills, pkgs]);

  const toggleTool = (name: string) => {
    const has = cfg.tools.includes(name);
    onChange({ tools: has ? cfg.tools.filter((t) => t !== name) : [...cfg.tools, name] });
  };

  const groups = mcp?.catalog || [];
  const mcpToolCount = groups.reduce((n: number, g: any) => n + g.tools.length, 0);
  const pickedMcp = cfg.tools.filter((t) => t.includes('__')).length;

  const emb = kbStats?.embedding;
  const vec = kbStats?.vectorIndex;
  const vecReady = emb?.ready && vec?.status === 'ready';

  const ragModeLabel = useMemo(() => {
    const m = cfg.ragMode || 'hybrid';
    if (!emb?.ready) return '词法（未配置向量）';
    return m === 'lexical' ? '仅 BM25 词法' : m === 'vector' ? '仅向量余弦' : '混合（词法 + 向量）';
  }, [cfg.ragMode, emb?.ready]);

  return (
    <div className="panel-body">
      {/* 模型与输入 */}
      <div className="cfg-group">
        <div className="cfg-group-head">
          <span className="cfg-group-icon" style={{ background: 'var(--core)' }}>
            1
          </span>
          <span className="cfg-group-name">模型与输入</span>
          <span className="cfg-group-hint">改变模型看到什么</span>
        </div>

        <Row
          title="System Prompt"
          desc="以 system 角色发送的指令，约束角色与输出结构"
          detail="System Prompt 只影响模型「怎么答」：角色设定、口径、输出格式。它不会给模型新增任何外部数据访问能力。开启后，画布会出现 Prompt 构建节点。"
          on={cfg.systemPrompt.enabled}
          onToggle={() => onChange({ systemPrompt: { ...cfg.systemPrompt, enabled: !cfg.systemPrompt.enabled } })}
          extra={
            cfg.systemPrompt.enabled ? (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={onShowPrompt}>
                查看 / 编辑指令内容
              </button>
            ) : undefined
          }
        />

        <Row
          title="多轮上下文"
          desc="把历史消息重新发给模型；关闭则只发当前这一句"
          detail="模型本身不记忆。打开后，应用会把之前的问答按顺序放进本次请求；关闭后，历史只存在界面上，不会发出去。可以用时间线里的「构建模型请求」事件核对。"
          on={cfg.multiTurn}
          onToggle={() => onChange({ multiTurn: !cfg.multiTurn })}
        />

        <div className="cfg-row">
          <div className="cfg-row-main">
            <div className="cfg-row-title">Temperature</div>
            <div className="cfg-row-desc">越低越稳定，越高越发散。演示建议 0.2</div>
            <div className="slider-row">
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={cfg.temperature}
                onChange={(e) => onChange({ temperature: Number(e.target.value) })}
              />
              <span className="num-pill">{cfg.temperature.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 运行模式 */}
      <div className="cfg-group">
        <div className="cfg-group-head">
          <span className="cfg-group-icon" style={{ background: 'var(--guard)' }}>
            2
          </span>
          <span className="cfg-group-name">运行模式</span>
          <span className="cfg-group-hint">谁控制流程</span>
        </div>
        <div className="mode-grid">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.id}
              className={`mode-chip ${cfg.agentMode === m.id ? 'on' : ''}`}
              onClick={() => onChange({ agentMode: m.id })}
              title={m.desc}
            >
              <span className="mode-chip-label">{m.label}</span>
            </button>
          ))}
        </div>
        <div className="note" style={{ marginTop: 4, fontSize: 10.5 }}>
          {MODE_OPTIONS.find((m) => m.id === cfg.agentMode)?.desc}
        </div>
      </div>

      {/* 外部能力 */}
      <div className="cfg-group">
        <div className="cfg-group-head">
          <span className="cfg-group-icon" style={{ background: 'var(--capability)' }}>
            3
          </span>
          <span className="cfg-group-name">外部能力</span>
          <span className="cfg-group-hint">让模型拿到外部数据</span>
        </div>

        {cfg.agentMode !== 'off' ? (
          <div className="cfg-row">
            <div className="cfg-row-main">
              <div className="cfg-row-title">
                可用工具
                <span className="mono-tag">{cfg.tools.length} 个</span>
              </div>
              <div className="cfg-row-desc">
                本模式不使用原生 tools 参数：工具清单以文本形式交给模型，由它「说出」要调用什么
              </div>
            </div>
          </div>
        ) : (
          <Row
            title="工具调用 Function Calling"
            desc="模型提出结构化调用请求，由应用校验并执行"
            detail="开启后，模型会拿到工具清单（名称、说明、参数结构）。注意三件事是分开的：工具已注册 ≠ 模型本次一定会调用 ≠ 应用一定允许执行。时间线会分别记录这三步。"
            on={cfg.functionCalling}
            onToggle={() =>
              onChange({
                functionCalling: !cfg.functionCalling,
                tools: cfg.functionCalling ? [] : cfg.tools,
                mcpMode: !cfg.functionCalling ? cfg.mcpMode : false,
              })
            }
          />
        )}

        {(cfg.functionCalling || cfg.agentMode !== 'off') && (
          <>
            <div className="tool-source-bar">
              <span>
                执行路径：本地函数 {LOCAL_TOOLS.length} 个 · MCP 工具 {mcpToolCount} 个（{groups.length} 台服务器）
              </span>
              <span style={{ display: 'flex', gap: 5 }}>
                <button className="cfg-hint-btn" onClick={onRefreshMcp}>
                  刷新
                </button>
                <button className="cfg-hint-btn" onClick={onOpenMcp}>
                  管理服务器
                </button>
              </span>
            </div>

            <div className="sub-label">① 本地函数（进程内直接执行）</div>
            <div className="sub-row">
              {LOCAL_TOOLS.map((t) => {
                const on = cfg.tools.includes(t.name);
                return (
                  <div className="sub-item" key={t.name} onClick={() => toggleTool(t.name)} style={{ cursor: 'pointer' }}>
                    <Check on={on} />
                    <span className="grow">{t.label}</span>
                    <span className="mono-tag" title={t.desc}>
                      {t.name}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="sub-label" style={{ marginTop: 10 }}>
              ② MCP 工具（由 MCP Server 声明并执行）
            </div>
            {groups.length === 0 && (
              <div className="note" style={{ margin: '6px 0' }}>
                还没有可用的 MCP 服务器。点「管理服务器」可添加远程 MCP 或查看连接失败原因。
              </div>
            )}

            {groups.map((g: any) => (
              <ServerTools
                key={g.serverId}
                group={g}
                selected={cfg.tools}
                onToggle={toggleTool}
                onToggleAll={(on) => {
                  const names = g.tools.map((t: any) => t.name);
                  onChange({
                    tools: on
                      ? [...new Set([...cfg.tools, ...names])]
                      : cfg.tools.filter((t) => !names.includes(t)),
                  });
                }}
              />
            ))}

            {pickedMcp > 0 && (
              <div className="note" style={{ marginTop: 6, fontSize: 10.5 }}>
                本次已选 {pickedMcp} 个 MCP 工具。运行时应用会先连上对应服务器、走 tools/list 拿定义，再按模型的请求走
                tools/call。
              </div>
            )}

            <button className="btn btn-ghost btn-sm schema-btn" onClick={onOpenToolSchema}>
              查看本次实际发送给 LLM 的完整工具 Schema
            </button>
          </>
        )}

        <Row
          title="本地演示：同名工具改走 MCP"
          desc="把查企业工商从「本地函数」换成「MCP 工具」，用来对比两条执行路径"
          detail="这是给演示准备的对照开关：get_company_info 本来由本地函数直接执行，打开后改由本地演示 MCP Server 的 tools/call 执行。两条路的输入输出完全一样，差别只在「谁在执行、跳了几次协议」。它不改变 Function Calling 的工作方式，也不让模型变聪明——同一份 tools 清单，只是执行端换了个地方。真实场景里 MCP 的价值在于把工具交给外部团队、内网系统或云端统一维护，而不是提升模型能力。"
          on={cfg.mcpMode}
          locked={!cfg.functionCalling}
          badge={cfg.mcpMode ? '走 MCP' : '走本地'}
          onToggle={() => onChange({ mcpMode: !cfg.mcpMode })}
        />
      </div>

      {/* 知识与经验 */}
      <div className="cfg-group">
        <div className="cfg-group-head">
          <span className="cfg-group-icon" style={{ background: 'var(--resource)' }}>
            4
          </span>
          <span className="cfg-group-name">知识与经验</span>
          <span className="cfg-group-hint">改变回答依据</span>
        </div>

        <Row
          title="知识库检索 RAG"
          desc={`${kbStats?.documents || 0} 篇文档 · ${kbStats?.chunks || 0} 个分块 · ${ragModeLabel}`}
          detail="开启后，运行时先把问题交给检索器，命中片段作为 system 消息随问题一起提交。模型参数没有被修改，改文档即改依据。向量检索需要配置 Embedding 模型；未配置时只用 BM25 词法匹配。"
          on={cfg.rag}
          onToggle={() => onChange({ rag: !cfg.rag })}
          extra={
            cfg.rag ? (
              <div className="rag-mode">
                <div className="rag-mode-tabs">
                  {[
                    { id: 'lexical', label: '词法' },
                    { id: 'vector', label: '向量' },
                    { id: 'hybrid', label: '混合' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      className={`rag-mode-tab ${(cfg.ragMode || 'hybrid') === m.id ? 'on' : ''} ${
                        m.id !== 'lexical' && !emb?.ready ? 'disabled' : ''
                      }`}
                      onClick={() => emb?.ready && onChange({ ragMode: m.id as any })}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <span className="mini-label" style={{ marginLeft: 2 }}>
                  {emb?.ready
                    ? `${emb.model} · ${vec?.dim || '—'} 维 · 已索引 ${vec?.covered || 0}/${kbStats?.chunks || 0} 块`
                    : '未配置 Embedding，仅词法'}
                </span>
              </div>
            ) : undefined
          }
        />

        {cfg.rag && (
          <div className="cfg-row" style={{ paddingTop: 8 }}>
            <div className="cfg-row-main">
              <div className="cfg-row-title">召回数量 TopK</div>
              <div className="cfg-row-desc">命中片段越多，上下文越长，噪声也越多</div>
              <div className="slider-row">
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={cfg.topK}
                  onChange={(e) => onChange({ topK: Number(e.target.value) })}
                  style={{ width: 120 }}
                />
                <span className="num-pill">{cfg.topK}</span>
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onOpenKb}>
                  查看知识库
                </button>
              </div>
            </div>
          </div>
        )}

        <Row
          title="Skill 专家方法"
          desc={
            cfg.skills.length
              ? `已选 ${cfg.skills.length} 个 · 主指令合计 ${selectedTotals?.instructionChars ?? '…'} 字`
              : '未选择（可多选，按需加载）'
          }
          detail="Skill 是一个能力包：SKILL.md 只是入口与路由，方法论拆进 references/，确定性计算放进 scripts/，模板放进 assets/。这里是多选的——选几个，运行时按策略决定加载哪几个主指令；资源与脚本一律带 skill_id，所以多个同时加载也不会读错文件。它不改变模型参数，也不直接提供数据。"
          on={cfg.skills.length > 0}
          onToggle={() =>
            onChange({
              skills: cfg.skills.length
                ? []
                : [skills.find((s) => s.id === 'financial-risk')?.id || skills[0]?.id].filter(Boolean),
            })
          }
        />

        {skills.length > 0 && (
          <div className="sub-row">
            {skills.map((s) => {
              const on = cfg.skills.includes(s.id);
              return (
                <div key={s.id} className="sub-item" style={{ cursor: 'pointer' }} onClick={() => toggleSkill(s.id)}>
                  <Check on={on} />
                  <span className="grow">{s.name}</span>
                  {on && (
                    <span className="mono-tag" title="主指令体积">
                      {pkgs[s.id]?.totals?.instructionChars ?? s.bodyChars} 字
                    </span>
                  )}
                  <button
                    className="cfg-hint-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSkill(s.id);
                    }}
                  >
                    能力包
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {cfg.skills.length > 0 && (
          <>
            <div className="cfg-row" style={{ paddingTop: 6 }}>
              <div className="cfg-row-main">
                <div className="cfg-row-title">选择策略</div>
                <div className="cfg-row-desc">
                  {cfg.skillMode === 'all'
                    ? '勾选的全部加载主指令，分数只用于展示'
                    : '按问题挑，可能 0 个、1 个或多个；未达阈值则不加载'}
                </div>
              </div>
              <div className="seg" style={{ marginBottom: 0 }}>
                <button className={cfg.skillMode !== 'all' ? 'on' : ''} onClick={() => onChange({ skillMode: 'auto' })}>
                  自动匹配
                </button>
                <button className={cfg.skillMode === 'all' ? 'on' : ''} onClick={() => onChange({ skillMode: 'all' })}>
                  全部加载
                </button>
              </div>
            </div>

            <div className="cfg-row">
              <div className="cfg-row-main">
                <div className="cfg-row-title">
                  按需读取参考资料
                  <span className="mono-tag">references / assets</span>
                </div>
                <div className="cfg-row-desc">模型主动请求才读，其余留在磁盘</div>
              </div>
              <Switch on={cfg.skillRefs} onClick={() => onChange({ skillRefs: !cfg.skillRefs })} />
            </div>

            <div className="cfg-row">
              <div className="cfg-row-main">
                <div className="cfg-row-title">
                  按需执行脚本
                  <span className="mono-tag">scripts</span>
                </div>
                <div className="cfg-row-desc">只回传标准输出，源码不进上下文</div>
              </div>
              <Switch on={cfg.skillScripts} onClick={() => onChange({ skillScripts: !cfg.skillScripts })} />
            </div>

            {!cfg.functionCalling && (
              <div className="note warn" style={{ marginTop: 6 }}>
                未开启 Function Calling：模型只能读主指令，读不到资料、也跑不了脚本。
              </div>
            )}

            {selectedTotals && (
              <div className="note" style={{ marginTop: 6, fontSize: 10.5 }}>
                已选 {cfg.skills.length} 个 · 主指令 {selectedTotals.instructionChars} 字 · {selectedTotals.references} 份资料 /{' '}
                {selectedTotals.scripts} 个脚本 · 全量预载 {selectedTotals.packageChars} 字
              </div>
            )}
          </>
        )}
      </div>

      {/* 第二阶段 */}
      <div className="cfg-group" style={{ opacity: 0.55 }}>
        <div className="cfg-group-head">
          <span className="cfg-group-icon" style={{ background: 'var(--guard)' }}>
            5
          </span>
          <span className="cfg-group-name">Agent 运行与安全治理</span>
          <span className="cfg-group-hint">第二阶段</span>
        </div>
        {['多步骤 Agent 循环', 'ReAct 运行模式', 'Plan-and-Execute', '权限校验与人工确认', '审计日志'].map((t) => (
          <div className="cfg-row" key={t}>
            <div className="cfg-row-main">
              <div className="cfg-row-title">{t}</div>
            </div>
            <span className="lock-chip">待开放</span>
          </div>
        ))}
      </div>
    </div>
  );
}
