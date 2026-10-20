import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { RunSummary } from '../lib/types';
import Markdown from '../lib/markdown';

interface Props {
  runs: RunSummary[];
  onRefresh: () => void;
  chapter: string;
}

const CFG_ROWS = [
  { key: 'model', label: '模型' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'systemPromptEnabled', label: 'System Prompt', fmt: (v: any) => (v ? '已启用' : '未启用') },
  { key: 'multiTurn', label: '多轮上下文', fmt: (v: any) => (v ? '已启用' : '未启用') },
  {
    key: 'tools',
    label: '工具',
    fmt: (v: any, s: any) => (s.functionCalling ? v?.join('、') || '未选' : '未启用'),
  },
  { key: 'mcpMode', label: 'MCP 接入', fmt: (v: any) => (v ? '是' : '否') },
  { key: 'rag', label: '知识库检索', fmt: (v: any) => (v ? '已启用' : '未启用') },
  { key: 'skill', label: 'Skill', fmt: (v: any) => v || '未加载' },
];

function AnswerCard({
  run,
  tag,
  large,
}: {
  run: RunSummary;
  tag: 'A' | 'B';
  large?: boolean;
}) {
  return (
    <div className={`cmp-card ${large ? 'large' : ''}`}>
      <div className="cmp-card-head">
        <span className="cmp-tag">{tag}</span>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="cmp-card-title">{run.chapterTitle || run.chapter}</span>
          <span className="cmp-card-sub">
            {run.durationMs ? `${(run.durationMs / 1000).toFixed(2)}s` : '—'} · LLM ×{run.llmCalls ?? '—'} · 工具 ×
            {run.toolCalls ?? '—'}
          </span>
        </span>
      </div>
      <div className="cmp-card-body">
        {run.answer ? (
          <Markdown text={run.answer} />
        ) : (
          <span style={{ color: 'var(--ink-4)' }}>（无回答）</span>
        )}
      </div>
    </div>
  );
}

function DiffTable({ A, B }: { A: RunSummary; B: RunSummary }) {
  return (
    <div>
      {CFG_ROWS.map((row) => {
        const va = row.fmt ? row.fmt(A.snapshot?.[row.key], A.snapshot) : A.snapshot?.[row.key];
        const vb = row.fmt ? row.fmt(B.snapshot?.[row.key], B.snapshot) : B.snapshot?.[row.key];
        const diff = String(va) !== String(vb);
        return (
          <div className="kv" key={row.key}>
            <span className="kv-k">{row.label}</span>
            <span className="kv-v" style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <span style={{ color: diff ? 'var(--brand)' : 'var(--ink)' }}>{String(va ?? '—')}</span>
              <span style={{ color: 'var(--ink-4)' }}>/</span>
              <span style={{ color: diff ? 'var(--brand)' : 'var(--ink)' }}>{String(vb ?? '—')}</span>
            </span>
          </div>
        );
      })}
      <div className="kv">
        <span className="kv-k">LLM 调用次数</span>
        <span className="kv-v">
          {A.llmCalls ?? '—'} / {B.llmCalls ?? '—'}
        </span>
      </div>
      <div className="kv">
        <span className="kv-k">工具调用次数</span>
        <span className="kv-v">
          {A.toolCalls ?? '—'} / {B.toolCalls ?? '—'}
        </span>
      </div>
      <div className="kv">
        <span className="kv-k">执行耗时</span>
        <span className="kv-v">
          {A.durationMs ? (A.durationMs / 1000).toFixed(2) + 's' : '—'} /{' '}
          {B.durationMs ? (B.durationMs / 1000).toFixed(2) + 's' : '—'}
        </span>
      </div>
    </div>
  );
}

function CompareOverlay({
  A,
  B,
  mismatch,
  onClose,
}: {
  A: RunSummary;
  B: RunSummary;
  mismatch: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="cmp-overlay" onClick={onClose}>
      <div className="cmp-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmp-overlay-head">
          <div>
            <div style={{ fontSize: 14, fontWeight: 650 }}>同题对比</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
              {A.question}
            </div>
          </div>
          <span className="mono-tag" style={{ marginLeft: 'auto' }}>
            ESC 关闭
          </span>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        {mismatch && (
          <div className="note warn" style={{ margin: '10px 16px 0' }}>
            两条记录的问题不同，差异无法归因到能力配置。对比应在同一问题下进行。
          </div>
        )}
        <div className="cmp-overlay-grid">
          <AnswerCard run={A} tag="A" large />
          <AnswerCard run={B} tag="B" large />
        </div>
        <div className="cmp-overlay-foot">
          <div className="mini-label" style={{ marginBottom: 6 }}>
            执行差异（红色为不同）
          </div>
          <DiffTable A={A} B={B} />
        </div>
      </div>
    </div>
  );
}

export default function ComparePanel({ runs, onRefresh, chapter }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? runs : runs.filter((r) => r.chapter === chapter);
  const [picked, setPicked] = useState<string[]>([]);
  const [detail, setDetail] = useState<Record<string, any>>({});
  const [expand, setExpand] = useState(false);

  useEffect(() => {
    if (picked.length !== 2) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, any> = {};
      for (const id of picked) {
        if (detail[id]) {
          out[id] = detail[id];
          continue;
        }
        try {
          out[id] = await api.run(id);
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setDetail((d) => ({ ...d, ...out }));
    })();
    return () => {
      cancelled = true;
    };
  }, [picked]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (picked.length === 2) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [picked.length]);

  const toggle = (id: string) => {
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= 2) return [p[1], id];
      return [...p, id];
    });
  };

  const A = picked[0] ? runs.find((r) => r.runId === picked[0]) : null;
  const B = picked[1] ? runs.find((r) => r.runId === picked[1]) : null;
  const mismatch = Boolean(A && B && A.question !== B.question);

  return (
    <div className="panel-body" ref={scrollRef}>
      <div className="panel-pad" style={{ paddingBottom: 8 }}>
        <div className="field-label">
          <span>选择两次运行进行对比（最多 2 条）</span>
          <span style={{ display: 'flex', gap: 5 }}>
            <button className="cfg-hint-btn" onClick={() => setShowAll(!showAll)}>
              {showAll ? '只显示本章' : '显示全部章节'}
            </button>
            <button className="cfg-hint-btn" onClick={onRefresh}>
              刷新
            </button>
          </span>
        </div>
        <div className="note" style={{ fontSize: 10.5 }}>
          对比必须以相同问题为前提。回答更长、工具更多，都不等于效果更好——要看事实是否正确、证据是否可追溯。
        </div>
      </div>

      {visible.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-4)', fontSize: 11.5 }}>
          还没有可对比的运行记录。
        </div>
      )}

      {A && B && (
        <>
          {mismatch && (
            <div className="note warn" style={{ margin: '10px 12px 0' }}>
              两条记录的问题不同，差异无法归因到能力配置。对比应在同一问题下进行。
            </div>
          )}

          <div className="cmp-toolbar">
            <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>回答内容（已按 Markdown 渲染）</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setExpand(true)}>
              放大对比
            </button>
          </div>

          <div className="cmp-stack">
            <AnswerCard run={A} tag="A" />
            <AnswerCard run={B} tag="B" />
          </div>

          <div className="section-title" style={{ padding: '0 14px' }}>
            执行差异
          </div>
          <DiffTable A={A} B={B} />
          <div className="panel-pad">
            <div className="note">
              红色表示两次配置存在差异。请结合时间线判断差异由哪一步引起，再判断这种差异是否真的带来业务价值。
            </div>
          </div>
        </>
      )}

      <div style={{ borderTop: '1px solid var(--line-2)' }}>
        {visible.slice(0, 12).map((r) => {
          const idx = picked.indexOf(r.runId);
          return (
            <button key={r.runId} className={`run-pick ${idx >= 0 ? 'sel' : ''}`} onClick={() => toggle(r.runId)}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: '1.5px solid',
                  borderColor: idx >= 0 ? 'var(--brand)' : '#CFCAC3',
                  background: idx >= 0 ? 'var(--brand)' : '#fff',
                  color: '#fff',
                  fontSize: 10,
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                  fontWeight: 700,
                }}
              >
                {idx >= 0 ? (idx === 0 ? 'A' : 'B') : ''}
              </span>
              <span className="grow">
                <span className="run-pick-q">{r.question}</span>
                <span className="run-pick-meta">
                  {r.chapterTitle || r.chapter} · {new Date(r.createdAt).toLocaleTimeString()} · LLM×{r.llmCalls ?? '—'} · 工具×
                  {r.toolCalls ?? '—'}
                  {r.status !== 'completed' ? ` · ${r.status}` : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {(!A || !B) && visible.length > 0 && (
        <div className="panel-pad">
          <div className="note">再选择一条记录即可开始对比。</div>
        </div>
      )}

      {expand && A && B && (
        <CompareOverlay A={A} B={B} mismatch={mismatch} onClose={() => setExpand(false)} />
      )}
    </div>
  );
}
