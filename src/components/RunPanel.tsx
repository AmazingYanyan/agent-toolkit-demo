import { useEffect, useRef, useState } from 'react';
import type { Chapter, RunEvent } from '../lib/types';
import Markdown from '../lib/markdown';

export interface Turn {
  id: string;
  question: string;
  answer: string;
  events: RunEvent[];
  stats: any;
  error: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

interface Props {
  chapter: Chapter;
  turns: Turn[];
  running: boolean;
  tick: number;
  onRun: (q: string) => void;
  onStop: () => void;
  onClear: () => void;
  noKey: boolean;
  onOpenSettings: () => void;
  onSelectEvent: (e: RunEvent) => void;
}

function ToolCards({ events, onSelect }: { events: RunEvent[]; onSelect: (e: RunEvent) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const calls = events.filter((e) => e.event_type === 'tool_call_completed' || e.event_type === 'tool_call_failed');
  if (!calls.length) return null;
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {calls.map((e) => {
        const isErr = e.event_type === 'tool_call_failed';
        const key = e.event_id;
        return (
          <div className="tool-trace" key={key}>
            <button
              className="tool-trace-head"
              style={{ width: '100%', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => {
                setOpen(open === key ? null : key);
                onSelect(e);
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: isErr ? '#C9242B' : '#4A7C59',
                    color: '#fff',
                    fontSize: 8,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isErr ? '!' : '✓'}
                </span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isErr ? `工具失败 ${e.payload?.toolName}` : e.payload?.summary || e.payload?.toolName}
                </span>
              </span>
              <span style={{ color: 'var(--ink-4)', fontSize: 9.5, flexShrink: 0 }}>
                {e.payload?.durationMs != null ? `${e.payload.durationMs}ms` : ''} {open === key ? '−' : '+'}
              </span>
            </button>
            {open === key && (
              <div className="tool-trace-body">
                {isErr ? e.payload?.error : JSON.stringify(e.payload?.result, null, 2)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RagChips({ events }: { events: RunEvent[] }) {
  const hit = events.find((e) => e.event_type === 'rag_search_completed');
  if (!hit) return null;
  const hits = hit.payload?.hits || [];
  if (!hits.length) {
    return <div className="note warn" style={{ marginTop: 8 }}>检索未命中任何片段，模型不会因此获得额外知识。</div>;
  }
  return (
    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {hits.map((h: any) => (
        <span key={h.chunkId} className="mono-tag" title={h.text}>
          {h.chunkId} · {h.score}
        </span>
      ))}
    </div>
  );
}

function SkillTrace({ events, onSelect }: { events: RunEvent[]; onSelect: (e: RunEvent) => void }) {
  const idx = events.find((e) => e.event_type === 'skill_index_loaded');
  if (!idx) return null;
  const match = events.find((e) => e.event_type === 'skill_matched');
  const loaded = events.find((e) => e.event_type === 'skill_loaded');
  const skipped = events.find((e) => e.event_type === 'skill_skipped');
  const pkg = events.find((e) => e.event_type === 'skill_package_mounted');
  const blocked = events.find((e) => e.event_type === 'skill_tools_unavailable');
  const refs = events.filter((e) => e.event_type === 'skill_resource_read');
  const scripts = events.filter((e) => e.event_type === 'skill_script_run');
  const tail = loaded || skipped;

  return (
    <div className="skill-trace-wrap">
      <div className="skill-trace">
        <button className="st-step" onClick={() => onSelect(idx)}>
          <span className="st-k">索引</span>
          <span className="st-v">
            {idx.payload?.count} 个 · {idx.payload?.indexChars} 字
          </span>
        </button>
        <span className="st-arrow">→</span>
        <button className="st-step" onClick={() => onSelect(match || idx)}>
          <span className="st-k">匹配</span>
          <span className="st-v">
            {match?.payload?.matched ? `命中 · ${match.payload.score} 分` : '未命中'}
          </span>
        </button>
        <span className="st-arrow">→</span>
        <button className="st-step" onClick={() => tail && onSelect(tail)}>
          <span className="st-k">主指令</span>
          <span className="st-v">{loaded ? `${loaded.payload?.chars} 字` : skipped ? '未读' : '—'}</span>
        </button>
        {pkg && (
          <>
            <span className="st-arrow">→</span>
            <button className="st-step" onClick={() => onSelect(pkg)}>
              <span className="st-k">能力包</span>
              <span className="st-v">
                {pkg.payload?.references?.length || 0} 资料 / {pkg.payload?.scripts?.length || 0} 脚本
              </span>
            </button>
          </>
        )}
      </div>

      {pkg && (
        <div className="st-pkg">
          <div className="st-pkg-head">
            <span>按需取用</span>
            <span className="st-pkg-meta">
              资料 {refs.length}/{pkg.payload?.references?.length || 0} · 脚本 {scripts.length}/
              {pkg.payload?.scripts?.length || 0}
            </span>
          </div>
          {refs.length === 0 && scripts.length === 0 && (
            <div className="st-idle">本次没有读取任何资料、也没有执行脚本</div>
          )}
          <div className="st-chips">
            {refs.map((e) => (
              <button className="st-chip ref" key={e.event_id} onClick={() => onSelect(e)}>
                {String(e.payload?.path || '').replace(/^(references|assets)\//, '')} · {e.payload?.chars} 字
              </button>
            ))}
            {scripts.map((e) => (
              <button className="st-chip script" key={e.event_id} onClick={() => onSelect(e)}>
                {e.payload?.name} · 码 {e.payload?.exitCode} · 出 {e.payload?.outputChars} 字
              </button>
            ))}
          </div>
        </div>
      )}

      {blocked && <div className="note warn" style={{ marginTop: 6 }}>{blocked.payload?.note}</div>}
    </div>
  );
}

export default function RunPanel({
  chapter,
  turns,
  running,
  tick,
  onRun,
  onStop,
  onClear,
  noKey,
  onOpenSettings,
  onSelectEvent,
}: Props) {
  const [q, setQ] = useState(chapter.question);
  const [follow, setFollow] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQ(chapter.question);
    setFollow('');
  }, [chapter.id]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [turns.length, tick]);

  const submit = () => {
    const text = q.trim();
    if (!text || running) return;
    onRun(text);
  };

  const submitFollow = () => {
    const text = follow.trim();
    if (!text || running) return;
    onRun(text);
    setFollow('');
  };

  return (
    <div className="panel-body" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-pad" style={{ paddingBottom: 8 }}>
        <div className="field-label">
          <span>{chapter.id === 'ch03' ? '第一轮提问' : '演示问题'}</span>
          <button className="cfg-hint-btn" onClick={() => setQ(chapter.question)}>
            恢复示例
          </button>
        </div>
        <div className="q-box">
          <textarea
            ref={taRef}
            value={q}
            placeholder={chapter.placeholder || '输入问题…'}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <div className="q-actions">
            <button className="btn btn-primary" onClick={submit} disabled={running || !q.trim()}>
              {running ? (
                <>
                  <span className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,.35)' }} />
                  运行中
                </>
              ) : (
                <>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 1.2v7.6L8.4 5 2 1.2z" fill="currentColor" />
                  </svg>
                  运行
                </>
              )}
            </button>
            {running && (
              <button className="btn btn-ghost btn-sm" onClick={onStop}>
                停止
              </button>
            )}
            {!running && turns.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={onClear}>
                清空会话
              </button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink-4)' }}>
              <span className="kbd">⌘</span>
              <span className="kbd" style={{ marginLeft: 2 }}>↵</span>
            </span>
          </div>
        </div>
        {noKey && (
          <div className="note warn" style={{ marginTop: 10 }}>
            尚未配置模型服务，运行会被拒绝。
            <span className="link" style={{ marginLeft: 4 }} onClick={onOpenSettings}>
              去配置
            </span>
          </div>
        )}
      </div>

      <div ref={threadRef} className="panel-pad" style={{ flex: 1, paddingTop: 4 }}>
        {turns.length === 0 && !running && (
          <div style={{ padding: '26px 4px', color: 'var(--ink-4)', fontSize: 11.8, lineHeight: 1.8 }}>
            <div style={{ fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6 }}>怎么用</div>
            <div>在「能力」里打开或关闭某一项能力，回到这里点「运行」。</div>
            <div style={{ marginTop: 4 }}>画布、时间线、详情都由本次运行的真实执行事件驱动。</div>
          </div>
        )}

        <div className="thread">
          {turns.map((t, ti) => (
            <div key={t.id}>
              <div className="turn-q">{t.question}</div>
              <div className="turn-a" style={{ marginTop: 10 }}>
                <div className="a-meta">
                  {t.status === 'running' ? (
                    <span style={{ color: 'var(--brand)' }}>执行中…</span>
                  ) : (
                    <>
                      <span>{t.stats?.model || '—'}</span>
                      {t.stats?.durationMs != null && <span>{(t.stats.durationMs / 1000).toFixed(2)}s</span>}
                      {t.stats?.llmCalls != null && <span>LLM ×{t.stats.llmCalls}</span>}
                      {t.stats?.toolCalls != null && <span>工具 ×{t.stats.toolCalls}</span>}
                      {t.stats?.completionTokens ? <span>{t.stats.completionTokens} tok</span> : null}
                    </>
                  )}
                </div>
                <div className={`a-body ${t.status === 'running' && ti === turns.length - 1 ? 'cursor-blink' : ''}`}>
                  {t.answer ? (
                    <Markdown text={t.answer} />
                  ) : t.status === 'running' ? (
                    ''
                  ) : t.error ? (
                    ''
                  ) : (
                    '（无内容）'
                  )}
                </div>
                {t.error && (
                  <div className="note warn" style={{ marginTop: 8 }}>
                    {t.error}
                  </div>
                )}
                <ToolCards events={t.events} onSelect={onSelectEvent} />
                <RagChips events={t.events} />
                <SkillTrace events={t.events} onSelect={onSelectEvent} />
                {t.stats?.skillDisclosure && (
                  <div className="st-summary">
                    <span>能力包全量预载 {t.stats.skillDisclosure.fullPreloadChars} 字</span>
                    <span className="st-summary-arrow">→</span>
                    <span className="on">本次实际进上下文 {t.stats.skillDisclosure.actualChars} 字</span>
                    <span className="st-summary-save">
                      省 {t.stats.skillDisclosure.savedChars} 字（
                      {Math.round(
                        (t.stats.skillDisclosure.savedChars /
                          Math.max(1, t.stats.skillDisclosure.fullPreloadChars)) *
                          100
                      )}
                      %）
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {running && tick > 0 && (
          <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 10, fontFamily: 'var(--mono)' }}>
            实时输出中…
          </div>
        )}

        {!running && turns.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="field-label">
              <span>{chapter.id === 'ch03' ? '第二轮追问（观察上下文是否生效）' : '继续追问'}</span>
            </div>
            <div className="q-box">
              <textarea
                value={follow}
                placeholder={chapter.placeholder || '基于刚才的回答继续追问…'}
                onChange={(e) => setFollow(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitFollow();
                }}
                style={{ minHeight: 40 }}
              />
              <div className="q-actions">
                <button className="btn btn-ghost btn-sm" onClick={submitFollow} disabled={!follow.trim()}>
                  发送追问
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
