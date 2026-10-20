import type { Chapter } from '../lib/types';

interface Props {
  chapters: Chapter[];
  activeId: string;
  mode: 'guided' | 'free';
  onMode: (m: 'guided' | 'free') => void;
  onSelect: (id: string) => void;
  health: any;
  onOpenHealth: () => void;
  onOpenSettings: () => void;
  llmOk: boolean;
  mcpOk: boolean;
  mcpText?: string;
  onCollapse: () => void;
}

export default function Sidebar({
  chapters,
  activeId,
  mode,
  onMode,
  onSelect,
  health,
  onOpenHealth,
  onOpenSettings,
  llmOk,
  mcpOk,
  mcpText,
  onCollapse,
}: Props) {
  const open = chapters.filter((c) => !c.locked);
  const locked = chapters.filter((c) => c.locked);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-row">
          <div className="brand-mark">AI</div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onCollapse} title="收起左侧栏">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8.5 3.5L5 7l3.5 3.5M2.5 2v10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mode-switch">
        <button className={mode === 'guided' ? 'on' : ''} onClick={() => onMode('guided')}>
          引导讲解
        </button>
        <button className={mode === 'free' ? 'on' : ''} onClick={() => onMode('free')}>
          自由探索
        </button>
      </div>

      <div className="chapter-list">
        <div className="chapter-group-label">第一阶段 · 可演示</div>
        {open.map((c) => (
          <button
            key={c.id}
            className={`chapter-item ${activeId === c.id ? 'active' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <span className="chapter-no">{c.no}</span>
            <span className="grow">
              <span className="chapter-name">{c.title}</span>
            </span>
          </button>
        ))}

        <div className="chapter-group-label">第二阶段 · 待开放</div>
        {locked.map((c) => (
          <button key={c.id} className="chapter-item locked" disabled>
            <span className="chapter-no">{c.no}</span>
            <span className="grow">
              <span className="chapter-name">{c.title}</span>
            </span>
            <span className="lock-chip">待开放</span>
          </button>
        ))}
      </div>

      <div className="sidebar-foot">
        <button className="status-line" onClick={onOpenHealth} style={{ width: '100%', textAlign: 'left' }}>
          <span className={`dot ${llmOk ? 'ok' : 'bad'}`} />
          <span className="grow">{llmOk ? '模型服务已配置' : '未配置模型服务'}</span>
          <span style={{ color: 'var(--ink-4)', fontSize: 10 }}>自检</span>
        </button>
        <div className="status-line">
          <span className={`dot ${mcpOk ? 'ok' : 'idle'}`} />
          <span className="grow">{mcpText || (mcpOk ? 'MCP 已连接' : 'MCP 未连接')}</span>
        </div>
        <div className="status-line">
          <span className="dot ok" />
          <span className="grow">演示数据：2 家虚构企业</span>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={onOpenSettings}>
          模型服务配置
        </button>
      </div>
    </aside>
  );
}
