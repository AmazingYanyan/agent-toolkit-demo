import { useMemo, useState } from 'react';
import type { ArchEdge, ArchNode, NodeStatus, RunConfig } from '../lib/types';
import { CANVAS_H, CANVAS_W, buildGraph } from '../lib/layout';
void CANVAS_H;
void CANVAS_W;

const TONES: Record<string, { stroke: string; fill: string }> = {
  core: { stroke: '#33415C', fill: '#FFFFFF' },
  model: { stroke: '#C9242B', fill: '#FFF7F7' },
  capability: { stroke: '#2F6F8F', fill: '#F6FAFC' },
  resource: { stroke: '#8C6A3F', fill: '#FCFAF6' },
  guard: { stroke: '#6B5B95', fill: '#FAF8FC' },
  data: { stroke: '#4A7C59', fill: '#F8FBF9' },
};

const EDGE_COLORS: Record<string, string> = {
  request: '#8A94A6',
  response: '#B8AFA6',
  data: '#7FA08A',
  context: '#7FA3B8',
  control: '#BFA88F',
};

function mid(a: ArchNode, b: ArchNode) {
  return { ax: a.x + a.w / 2, ay: a.y + a.h / 2, bx: b.x + b.w / 2, by: b.y + b.h / 2 };
}

function pathFor(a: ArchNode, b: ArchNode, back = false, isReturn = false) {
  const { ax, ay, bx, by } = mid(a, b);
  const dx = bx - ax;
  const dy = by - ay;
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  if (horizontal) {
    const forward = dx > 0;
    if (forward) {
      const sx = a.x + a.w;
      const ex = b.x;
      const k = Math.max(26, (ex - sx) * 0.48);
      return `M${sx} ${ay} C${sx + k} ${ay}, ${ex - k} ${by}, ${ex} ${by}`;
    }
    const sx = a.x;
    const ex = b.x + b.w;
    const shift = isReturn ? -10 : 0;
    const sy = ay + shift;
    const ey = by + shift;
    const k = Math.max(26, (sx - ex) * 0.42);
    return `M${sx} ${sy} C${sx - k} ${sy}, ${ex + k} ${ey}, ${ex} ${ey}`;
  }

  const down = dy > 0;
  const shiftX = isReturn ? 9 : -9;
  const sx = ax + shiftX;
  const sy = down ? a.y + a.h : a.y;
  const ex = bx + shiftX;
  const ey = down ? b.y : b.y + b.h;
  const k = Math.max(20, Math.abs(ey - sy) * 0.5);
  return `M${sx} ${sy} C${sx} ${sy + (down ? k : -k)}, ${ex} ${ey + (down ? -k : k)}, ${ex} ${ey}`;
}

function isBackward(a: ArchNode, b: ArchNode) {
  return b.x + b.w <= a.x + 4;
}

function truncate(text: string, width: number, fontSize = 10) {
  const perChar = fontSize * 0.56;
  const max = Math.floor((width - 26) / perChar);
  if (!text) return '';
  return text.length > max ? text.slice(0, Math.max(2, max - 1)) + '…' : text;
}

interface Props {
  cfg: RunConfig;
  toolNames: string[];
  servers?: any[];
  activeEdges: string[];
  focusEdges: string[];
  focusNodes: string[];
  nodeStatus: Record<string, NodeStatus>;
  onSelect: (node: ArchNode) => void;
  runCount: number;
}

export default function Canvas({
  cfg,
  toolNames,
  servers = [],
  activeEdges,
  focusEdges,
  focusNodes,
  nodeStatus,
  onSelect,
  runCount,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const { nodes, edges } = useMemo(() => buildGraph(cfg, toolNames, servers), [cfg, toolNames, servers]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const activeSet = useMemo(() => new Set(activeEdges), [activeEdges]);
  const focusEdgeSet = useMemo(() => new Set(focusEdges), [focusEdges]);
  const focusNodeSet = useMemo(() => new Set(focusNodes), [focusNodes]);

  // 占位节点只在信息量很少时才出现，避免密集画布上添乱
  const showGhosts = nodes.length <= 4;
  const ghosts: ArchNode[] = [];
  if (showGhosts && !cfg.functionCalling) {
    ghosts.push({
      id: 'ghost_tool',
      label: '外部工具',
      sub: '未接入 · 模型无法访问',
      x: 640,
      y: 268,
      w: 162,
      h: 62,
      tone: 'core',
    });
  }
  if (showGhosts && !cfg.rag) {
    ghosts.push({
      id: 'ghost_kb',
      label: '内部资料',
      sub: '未接入知识库',
      x: 364,
      y: 452,
      w: 152,
      h: 64,
      tone: 'core',
    });
  }

  // 自动取景：按当前节点包围盒自适应，避免稀疏章节里节点被缩得很小
  const all = [...nodes, ...ghosts];
  const minX = Math.min(...all.map((n) => n.x)) - 48;
  const maxX = Math.max(...all.map((n) => n.x + n.w)) + 48;
  const minY = Math.min(...all.map((n) => n.y)) - 52;
  const maxY = Math.max(...all.map((n) => n.y + n.h)) + 44;
  const boxW = Math.max(580, maxX - minX);
  const boxH = Math.max(270, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 + 8;

  const vbW = boxW / zoom;
  const vbH = boxH / zoom;

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <div className="tool-chip">
          <span style={{ color: 'var(--ink-4)' }}>组件</span>
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{nodes.length}</b>
          <span style={{ color: 'var(--ink-4)' }}>· 连线</span>
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{edges.length}</b>
        </div>
        <button className="tool-btn" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.12).toFixed(2)))} title="放大">
          +
        </button>
        <button className="tool-btn" onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.12).toFixed(2)))} title="缩小">
          −
        </button>
        <button className="tool-btn" onClick={() => setZoom(1)} title="适应画布">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 4V1h3M11 8v3H8M1 8v3h3M11 4V1H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="legend">
          <span>
            <i style={{ borderColor: EDGE_COLORS.request }} />
            调用
          </span>
          <span>
            <i style={{ borderColor: EDGE_COLORS.data }} />
            数据回传
          </span>
          <span>
            <i style={{ borderColor: EDGE_COLORS.control, borderTopStyle: 'dashed' }} />
            控制指令
          </span>
        </div>
      </div>

      <svg
        className="canvas-svg"
        viewBox={`${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {Object.entries(EDGE_COLORS).map(([k, color]) => (
            <marker
              key={k}
              id={`arrow-${k}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill={color} />
            </marker>
          ))}
          <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#C9242B" />
          </marker>
        </defs>

        {/* 连线 */}
        {edges.map((e) => {
          const a = nodeMap.get(e.from);
          const b = nodeMap.get(e.to);
          if (!a || !b) return null;
          const focused = focusEdgeSet.has(e.id);
          const active = activeSet.has(e.id) && !focusEdges.length;
          const hot = focused || active;
          const color = hot ? '#C9242B' : EDGE_COLORS[e.kind];
          const d = pathFor(a, b, isBackward(a, b), e.kind === 'data' || e.kind === 'response');
          return (
            <g key={e.id}>
              <path
                className={`edge-path ${hot ? 'edge-active' : ''}`}
                d={d}
                stroke={color}
                strokeWidth={focused ? 2.6 : active ? 2 : 1.35}
                strokeDasharray={e.dashed && !hot ? '5 4' : undefined}
                markerEnd={`url(#arrow-${hot ? 'active' : e.kind})`}
                opacity={focused ? 1 : active ? 1 : focusEdges.length ? 0.34 : 0.85}
                style={focused ? { filter: 'drop-shadow(0 0 4px rgba(201,36,43,.45))' } : undefined}
              />
            </g>
          );
        })}

        {/* 未接入的占位节点 */}
        {ghosts.map((g) => (
          <g key={g.id} opacity={0.5}>
            <rect
              x={g.x}
              y={g.y}
              width={g.w}
              height={g.h}
              rx={10}
              fill="#F7F6F4"
              stroke="#CFCAC3"
              strokeDasharray="4 3"
              strokeWidth={1.1}
            />
            <text x={g.x + 14} y={g.y + g.h / 2 - 3} className="node-label" fill="#9AA1AA" fontSize={12}>
              {g.label}
            </text>
            <text x={g.x + 14} y={g.y + g.h / 2 + 13} className="node-sub">
              {g.sub}
            </text>
          </g>
        ))}

        {/* 节点 */}
        {nodes.map((n) => {
          const tone = TONES[n.tone] || TONES.core;
          const st = nodeStatus[n.id] || 'idle';
          const isRunning = st === 'running';
          const focused = focusNodeSet.has(n.id);
          const dim = focusNodes.length > 0 && !focused;
          return (
            <g
              key={n.id}
              className="node-group"
              onClick={() => onSelect(n)}
              opacity={dim ? 0.45 : 1}
            >
              {focused && (
                <rect
                  x={n.x - 4}
                  y={n.y - 4}
                  width={n.w + 8}
                  height={n.h + 8}
                  rx={13}
                  fill="#C9242B"
                  opacity={0.07}
                  stroke="#C9242B"
                  strokeWidth={2}
                />
              )}
              {isRunning && (
                <rect
                  className="node-running-ring"
                  x={n.x - 3}
                  y={n.y - 3}
                  width={n.w + 6}
                  height={n.h + 6}
                  rx={13}
                  fill="none"
                  stroke="#C9242B"
                  strokeWidth={1.5}
                  style={{ transformOrigin: `${n.x + n.w / 2}px ${n.y + n.h / 2}px` }}
                />
              )}
              <rect
                className="node-rect"
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={10}
                fill={tone.fill}
                stroke={st === 'error' || focused ? '#C9242B' : st === 'skipped' ? '#C6C1BA' : tone.stroke}
                strokeWidth={focused ? 2.2 : st === 'idle' ? 1.15 : 1.7}
                strokeDasharray={st === 'skipped' ? '4 3' : undefined}
              />
              <rect x={n.x} y={n.y + 10} width={2.6} height={n.h - 20} rx={1.5} fill={tone.stroke} />
              <text x={n.x + 15} y={n.y + n.h / 2 - 2} className="node-label">
                {truncate(n.label, n.w, 13)}
              </text>
              <text x={n.x + 15} y={n.y + n.h / 2 + 15} className="node-sub">
                {truncate(n.sub || '', n.w, 10)}
              </text>
              {st === 'success' && (
                <circle cx={n.x + n.w - 13} cy={n.y + 13} r={4} fill="#4A7C59" opacity={0.85} />
              )}
              {st === 'error' && (
                <g>
                  <circle cx={n.x + n.w - 13} cy={n.y + 13} r={5} fill="#C9242B" />
                  <path
                    d={`M${n.x + n.w - 15} ${n.y + 11} l4 4 M${n.x + n.w - 11} ${n.y + 11} l-4 4`}
                    stroke="#fff"
                    strokeWidth={1.3}
                    strokeLinecap="round"
                  />
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {runCount === 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--ink-4)',
            pointerEvents: 'none',
          }}
        >
          点击右侧「运行」后，画布会按真实执行事件逐段点亮
        </div>
      )}
    </div>
  );
}
