import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import Timeline from './components/Timeline';
import RunPanel, { type Turn } from './components/RunPanel';
import ConfigPanel from './components/ConfigPanel';
import ComparePanel from './components/ComparePanel';
import DetailPanel from './components/DetailPanel';
import { HealthModal, KbModal, McpModal, NodeModal, PromptModal, SettingsModal, SkillModal, ToolSchemaModal } from './components/Modals';
import { CHAPTERS, chapterConfig, getChapter } from './lib/chapters';
import { eventEdges, eventNodes } from './lib/layout';
import type { ArchNode, NodeStatus, RunConfig, RunEvent, RunSummary } from './lib/types';
import { api, streamRun } from './lib/api';
import './styles.css';

type Tab = 'run' | 'config' | 'compare' | 'detail';

export default function App() {
  const [chapterId, setChapterId] = useState('ch01');
  const chapter = getChapter(chapterId);
  const [mode, setMode] = useState<'guided' | 'free'>('guided');
  const [cfg, setCfg] = useState<RunConfig>(() => chapterConfig(getChapter('ch01')));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<RunEvent | null>(null);
  const [activeEdges, setActiveEdges] = useState<string[]>([]);
  const [nodeStatus, setNodeStatus] = useState<Record<string, NodeStatus>>({});
  const [tab, setTab] = useState<Tab>('run');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [health, setHealth] = useState<any>(null);
  const [appConfig, setAppConfig] = useState<any>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [skillIndex, setSkillIndex] = useState<any>(null);
  const [kbStats, setKbStats] = useState<any>(null);
  const [mcpStatus, setMcpStatus] = useState<any>(null);
  const [runStats, setRunStats] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<any>(null);

  // 时间线上被点选的那一步 → 画布上高亮对应的两个节点与它们之间的连线
  const [focusEdges, setFocusEdges] = useState<string[]>([]);
  const [focusNodes, setFocusNodes] = useState<string[]>([]);

  const [showSettings, setShowSettings] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showKb, setShowKb] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showToolSchema, setShowToolSchema] = useState(false);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [nodeInfo, setNodeInfo] = useState<ArchNode | null>(null);

  const currentTurnId = useRef<string | null>(null);
  const deltaBuf = useRef('');
  const flushTimer = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 记录"这次运行"真正用的配置，避免用户事后改开关导致高亮错位
  const runCfgRef = useRef<RunConfig>(cfg);

  const llmOk = health?.checks?.find((c: any) => c.id === 'llm')?.ok ?? false;
  const mcpConnected = (mcpStatus?.servers || []).filter((s: any) => s.connected).length;
  const mcpTotal = (mcpStatus?.servers || []).filter((s: any) => s.enabled).length;
  const mcpOk = mcpConnected > 0;

  const refreshBasics = useCallback(async () => {
    const [h, c, s, si, kb, m] = await Promise.all([
      api.health().catch(() => null),
      api.getConfig().catch(() => null),
      api.skills().catch(() => []),
      api.skillsIndex().catch(() => null),
      api.kb().catch(() => null),
      api.mcpServers().catch(() => null),
    ]);
    setHealth(h);
    setAppConfig(c);
    setSkills(s || []);
    setSkillIndex(si);
    setKbStats(kb);
    setMcpStatus(m);
  }, []);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await api.runs());
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    refreshBasics();
    refreshRuns();
  }, [refreshBasics, refreshRuns]);

  // 章节切换：引导模式恢复预设配置
  useEffect(() => {
    if (mode === 'guided') {
      setCfg(chapterConfig(chapter));
    } else {
      setCfg((c) => ({ ...c, chapter: chapter.id, chapterTitle: chapter.title }));
    }
    setTurns([]);
    setEvents([]);
    setActiveEdges([]);
    setNodeStatus({});
    setSelectedEvent(null);
    setFocusEdges([]);
    setFocusNodes([]);
    setRunStats(null);
    setSnapshot(null);
  }, [chapterId, mode]);

  const flushDelta = useCallback(() => {
    const text = deltaBuf.current;
    deltaBuf.current = '';
    flushTimer.current = null;
    if (!text) return;
    setTurns((prev) =>
      prev.map((t) => (t.id === currentTurnId.current ? { ...t, answer: t.answer + text } : t))
    );
  }, []);

  const pushDelta = useCallback(
    (text: string) => {
      deltaBuf.current += text;
      if (!flushTimer.current) {
        flushTimer.current = setTimeout(flushDelta, 55);
      }
    },
    [flushDelta]
  );

  const handleEvent = useCallback(
    (evt: RunEvent) => {
      setEvents((prev) => [...prev, evt]);
      setNodeStatus((prev) => {
        const next = { ...prev };
        for (const n of eventNodes(evt.event_type, runCfgRef.current, evt.payload)) {
          next[n.id] = n.status as NodeStatus;
        }
        return next;
      });
      const edges = eventEdges(evt.event_type, runCfgRef.current, evt.payload);
      if (edges.length) setActiveEdges(edges);

      const id = currentTurnId.current;
      if (!id) return;

      if (evt.event_type === 'llm_output_delta') {
        pushDelta(evt.payload?.text || '');
        return;
      }

      if (evt.event_type === 'run_completed') {
        // 先清掉残留的流式缓冲，避免最终回答被重复追加
        if (flushTimer.current) {
          clearTimeout(flushTimer.current);
          flushTimer.current = null;
        }
        deltaBuf.current = '';
      }

      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          if (evt.event_type === 'run_completed') {
            return {
              ...t,
              status: 'completed',
              answer: evt.payload?.answer || t.answer,
              stats: evt.payload?.stats || null,
            };
          }
          if (evt.event_type === 'run_failed') {
            return { ...t, status: 'failed', error: evt.payload?.error || '运行失败' };
          }
          return { ...t, events: [...t.events, evt] };
        })
      );
      if (evt.event_type === 'run_completed') {
        setRunStats(evt.payload?.stats);
        setSnapshot(
          evt.payload?.stats
            ? {
                ...runCfgRef.current,
                model: evt.payload.stats.model,
                dataVersion: evt.payload.stats.dataVersion,
                kbVersion: evt.payload.stats.kbVersion,
              }
            : runCfgRef.current
        );
        refreshRuns();
        refreshBasics();
      }
    },
    [pushDelta, refreshRuns, refreshBasics]
  );

  const startRun = useCallback(
    async (question: string) => {
      if (running) return;
      const turnId = `t_${Date.now()}`;
      currentTurnId.current = turnId;
      runCfgRef.current = cfg;
      const history = turns.flatMap((t) =>
        t.status === 'completed' && t.answer
          ? [
              { role: 'user', content: t.question },
              { role: 'assistant', content: t.answer },
            ]
          : []
      );

      setTurns((prev) => [
        ...prev,
        { id: turnId, question, answer: '', events: [], stats: null, error: null, status: 'running' },
      ]);
      // 注意：这里不再清空 events。时间线要保留历次对话，
      // 由 Timeline 按 run_id 分组并用颜色区分每一轮。
      setSelectedEvent(null);
      setActiveEdges([]);
      setFocusEdges([]);
      setFocusNodes([]);
      setNodeStatus({});
      setRunStats(null);
      setRunning(true);
      setSnapshot({ ...cfg, model: appConfig?.model });

      const controller = new AbortController();
      abortRef.current = controller;

      await streamRun(
        { question, config: { ...cfg, chapter: chapter.id, chapterTitle: chapter.title }, history },
        {
          onEvent: handleEvent,
          onError: (msg) => {
            setTurns((prev) =>
              prev.map((t) => (t.id === turnId ? { ...t, status: 'failed', error: msg } : t))
            );
            setRunStats(null);
          },
          onEnd: () => {
            if (flushTimer.current) {
              clearTimeout(flushTimer.current);
              flushTimer.current = null;
            }
            flushDelta();
            setRunning(false);
            abortRef.current = null;
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId && t.status === 'running' ? { ...t, status: 'completed' } : t
              )
            );
          },
        },
        controller.signal
      );
    },
    [cfg, chapter, turns, running, handleEvent, appConfig, flushDelta]
  );

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const clearSession = () => {
    setTurns([]);
    setEvents([]);
    setActiveEdges([]);
    setNodeStatus({});
    setSelectedEvent(null);
    setFocusEdges([]);
    setFocusNodes([]);
    setRunStats(null);
  };

  /** 点时间线 / 运行卡片里的某一步：高亮这一步用到的节点与连线 */
  const selectEvent = useCallback((evt: RunEvent) => {
    const c = runCfgRef.current;
    setSelectedEvent(evt);
    setTab('detail');
    setFocusEdges(eventEdges(evt.event_type, c, evt.payload));
    setFocusNodes(eventNodes(evt.event_type, c, evt.payload).map((n) => n.id));
  }, []);

  const toolTip = useMemo(() => cfg.tools.map((t) => t), [cfg.tools]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'run', label: '运行' },
    { id: 'config', label: '能力' },
    { id: 'compare', label: '对比' },
    { id: 'detail', label: '详情' },
  ];

  const shellClass = `shell ${sidebarOpen ? '' : 'no-side'} ${rightOpen ? '' : 'no-right'}`;

  return (
    <div className={shellClass}>
      {sidebarOpen && (
        <Sidebar
          chapters={CHAPTERS}
          activeId={chapter.id}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            setTab(m === 'free' ? 'config' : 'run');
          }}
          onSelect={setChapterId}
          health={health}
          onOpenHealth={() => setShowHealth(true)}
          onOpenSettings={() => setShowSettings(true)}
          llmOk={llmOk}
          mcpOk={mcpOk}
          mcpText={mcpTotal ? `${mcpConnected}/${mcpTotal} 个 MCP 已连接` : '未配置 MCP 服务器'}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}

      <main className="main">
        <div className="main-head">
          <div className="head-top">
            {!sidebarOpen && (
              <button
                className="icon-btn"
                onClick={() => setSidebarOpen(true)}
                title="展开左侧栏"
                style={{ marginRight: 2 }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 3h10M2 7h10M2 11h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            )}
            <span className="head-no">CH.{chapter.no}</span>
            <span className="head-title">{chapter.title}</span>
            {!rightOpen && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setRightOpen(true)}
              >
                打开右侧面板
              </button>
            )}
          </div>
        </div>

        <Canvas
          cfg={{ ...cfg, modelLabel: appConfig?.apiKeySet ? appConfig?.model : '未配置模型' }}
          toolNames={toolTip}
          servers={(mcpStatus?.servers || []).map((x: any) => ({
            id: x.id,
            short: x.short || x.label,
            type: x.type,
            toolCount: x.toolCount,
            connected: x.connected,
          }))}
          activeEdges={activeEdges}
          focusEdges={focusEdges}
          focusNodes={focusNodes}
          nodeStatus={nodeStatus}
          onSelect={setNodeInfo}
          runCount={events.length}
        />

        <Timeline
          events={events}
          selectedId={selectedEvent?.event_id || null}
          onSelect={selectEvent}
          collapsed={timelineCollapsed}
          onToggle={() => setTimelineCollapsed(!timelineCollapsed)}
          running={running}
        />
      </main>

      {rightOpen && (
        <aside className="right">
          <div className="tabs">
            {tabs.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === 'run' && running && <span className="tab-badge">·</span>}
              </button>
            ))}
            <button
              className="tab"
              style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}
              onClick={() => setShowSettings(true)}
              title="模型服务配置"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ verticalAlign: -2 }}>
                <circle cx="7" cy="7" r="2.1" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M7 1v1.4M7 11.6V13M1 7h1.4M11.6 7H13M2.8 2.8l1 1M10.2 10.2l1 1M11.2 2.8l-1 1M3.8 10.2l-1 1"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button className="icon-btn" style={{ marginLeft: 2 }} onClick={() => setRightOpen(false)} title="收起右侧栏">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5.5 3.5L9 7l-3.5 3.5M11.5 2v10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {tab === 'run' && (
            <RunPanel
              chapter={chapter}
              turns={turns}
              running={running}
              tick={turns[turns.length - 1]?.answer?.length || 0}
              onRun={startRun}
              onStop={stop}
              onClear={clearSession}
              noKey={!llmOk}
              onOpenSettings={() => setShowSettings(true)}
              onSelectEvent={selectEvent}
            />
          )}

          {tab === 'config' && (
            <ConfigPanel
              cfg={cfg}
              onChange={(patch) => setCfg((c) => ({ ...c, ...patch }))}
              skills={skills}
              skillIndex={skillIndex}
              onOpenSkill={setSkillId}
              kbStats={kbStats}
              onOpenKb={() => setShowKb(true)}
              onShowPrompt={() => setShowPrompt(true)}
              mcp={mcpStatus}
              onOpenMcp={() => setShowMcp(true)}
              onOpenToolSchema={() => setShowToolSchema(true)}
              onRefreshMcp={refreshBasics}
              onCfgSaved={refreshBasics}
            />
          )}

          {tab === 'compare' && <ComparePanel runs={runs} onRefresh={refreshRuns} chapter={chapter.id} />}

          {tab === 'detail' && (
            <DetailPanel
              event={selectedEvent}
              runStats={runStats}
              snapshot={snapshot || (events.length ? cfg : null)}
              mcpTrace={mcpStatus?.trace || []}
              onOpenToolSchema={() => setShowToolSchema(true)}
            />
          )}
        </aside>
      )}

      {showSettings && (
        <SettingsModal
          initial={appConfig}
          onClose={() => setShowSettings(false)}
          onSaved={refreshBasics}
        />
      )}
      {showHealth && <HealthModal onClose={() => setShowHealth(false)} onChanged={refreshBasics} />}
      {showPrompt && (
        <PromptModal
          value={cfg.systemPrompt.text}
          onSave={(v) => setCfg((c) => ({ ...c, systemPrompt: { ...c.systemPrompt, text: v } }))}
          onClose={() => setShowPrompt(false)}
        />
      )}
      {showKb && <KbModal onClose={() => setShowKb(false)} onReload={refreshBasics} />}
      {showMcp && <McpModal onClose={() => setShowMcp(false)} onChanged={refreshBasics} />}
      {showToolSchema && (
        <ToolSchemaModal
          cfg={cfg}
          lastPromptEvent={[...events].reverse().find((e) => e.event_type === 'prompt_built') || null}
          onClose={() => setShowToolSchema(false)}
        />
      )}
      {skillId && <SkillModal id={skillId} onClose={() => setSkillId(null)} index={skillIndex} />}
      {nodeInfo && <NodeModal node={nodeInfo} onClose={() => setNodeInfo(null)} />}
    </div>
  );
}
