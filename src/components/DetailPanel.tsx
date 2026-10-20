import { useState } from 'react';
import type { RunEvent } from '../lib/types';

interface Props {
  event: RunEvent | null;
  runStats: any;
  snapshot: any;
  mcpTrace: any[];
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="d-row">
      <div className="d-k">{k}</div>
      <div className="d-v">{v}</div>
    </div>
  );
}

function BusinessView({ evt }: { evt: RunEvent }) {
  const p = evt.payload || {};
  switch (evt.event_type) {
    case 'prompt_built':
      return (
        <>
          <Row k="模型" v={p.model} />
          <Row k="Temperature" v={p.temperature} />
          <Row k="消息数" v={`${p.messageCount} 条 · 约 ${p.approxChars} 字`} />
          <Row k="提供工具" v={p.tools?.length ? p.tools.join('、') : '无'} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 6 }}>
            实际发送的消息
          </div>
          {(p.messages || []).map((m: any, i: number) => (
            <div className="chunk" key={i}>
              <div className="chunk-head">
                <span>{m.role}</span>
                <span>{String(m.content || '').length} 字</span>
              </div>
              <div className="chunk-body" style={{ maxHeight: 120, overflowY: 'auto' }}>
                {m.content}
              </div>
            </div>
          ))}
        </>
      );
    case 'llm_response_completed':
      return (
        <>
          <Row k="轮次" v={`第 ${p.round} 轮`} />
          <Row k="耗时" v={p.durationMs ? `${p.durationMs} ms` : '—'} />
          <Row k="结束原因" v={p.finishReason || '—'} />
          {p.usage && (
            <Row k="Token" v={`输入 ${p.usage.prompt_tokens} · 输出 ${p.usage.completion_tokens}`} />
          )}
          {p.content && (
            <>
              <div className="divider" />
              <div className="mini-label" style={{ marginBottom: 5 }}>
                模型输出文本
              </div>
              <div style={{ fontSize: 11.5, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{p.content}</div>
            </>
          )}
          {p.toolCalls?.length > 0 && (
            <>
              <div className="divider" />
              <div className="mini-label" style={{ marginBottom: 5 }}>
                模型提出的工具调用（结构化输出）
              </div>
              {p.toolCalls.map((t: any, i: number) => (
                <div className="chunk" key={i}>
                  <div className="chunk-head">
                    <span>{t.name}</span>
                    <span>{t.id}</span>
                  </div>
                  <div className="chunk-body" style={{ maxHeight: 80 }}>
                    {t.arguments}
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      );
    case 'tool_call_requested':
    case 'tool_call_started':
      return (
        <>
          <Row k="工具" v={p.toolName} />
          <Row k="调用编号" v={p.callId} />
          {p.via && <Row k="接入方式" v={p.via === 'mcp' ? 'MCP Server' : '本地直连'} />}
          {p.parseError && <Row k="参数解析" v={`失败：${p.parseError}`} />}
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            模型给出的参数
          </div>
          <div className="json-view">{JSON.stringify(p.args ?? p.rawArguments, null, 2)}</div>
        </>
      );
    case 'tool_call_completed':
      return (
        <>
          <Row k="工具" v={p.toolName} />
          <Row k="数据来源" v={p.source || '—'} />
          <Row k="耗时" v={p.durationMs != null ? `${p.durationMs} ms` : '—'} />
          <Row k="业务摘要" v={p.summary} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            工具返回（回传给模型的内容）
          </div>
          <div className="json-view">{JSON.stringify(p.result, null, 2)}</div>
        </>
      );
    case 'rag_search_completed':
      return (
        <>
          <Row k="命中" v={`${p.count} 个片段`} />
          <Row
            k="检索方式"
            v={p.mode === 'lexical' ? 'BM25 词法' : p.mode === 'vector' ? '向量余弦' : `混合（权重 ${p.vectorWeight ?? '—'}）`}
          />
          <Row k="耗时" v={p.durationMs != null ? `${p.durationMs} ms` : '—'} />
          <Row k="索引版本" v={p.kbVersion} />
          <div className="divider" />
          {(p.hits || []).map((h: any) => (
            <div className="chunk" key={h.chunkId}>
              <div className="chunk-head">
                <span>{h.chunkId}</span>
                <span>融合 {h.score}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 3 }}>
                {h.title} · 词法 {h.bm25}（第 {h.rankBm25 ?? '—'} 名）· 向量 {h.vector}（第 {h.rankVector ?? '—'} 名）
              </div>
              <div className="chunk-body" style={{ maxHeight: 110, overflowY: 'auto' }}>
                {h.text}
              </div>
              <div className="score-bar">
                <i style={{ width: `${Math.min(100, h.score * 100)}%` }} />
              </div>
            </div>
          ))}
        </>
      );
    case 'rag_context_injected':
      return (
        <>
          <Row k="注入片段" v={`${p.chunks} 个`} />
          <Row k="注入字数" v={`${p.chars} 字`} />
          <Row k="顺序" v={(p.order || []).join(' → ')} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            实际拼进 system 消息的内容（节选）
          </div>
          <div className="json-view" style={{ fontFamily: 'inherit', fontSize: 11.5, whiteSpace: 'pre-wrap' }}>
            {p.preview}
          </div>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'skill_index_loaded':
      return (
        <>
          <Row k="索引内 Skill" v={`${p.count} 个`} />
          <Row k="元数据体积" v={`${p.indexChars} 字（已读）`} />
          <Row k="全部正文体积" v={`${p.totalBodyChars} 字（此时未读）`} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 6 }}>
            索引条目
          </div>
          {(p.items || []).map((s: any) => (
            <div className="chunk" key={s.id}>
              <div className="chunk-head">
                <span>{s.name}</span>
                <span>
                  元数据 {s.indexChars} 字 / 正文 {s.bodyChars} 字
                </span>
              </div>
              <div style={{ fontSize: 10.8, color: 'var(--ink-3)', lineHeight: 1.6 }}>{s.description}</div>
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 4 }}>
                关键词：{(s.keywords || []).join('、') || '—'}
              </div>
            </div>
          ))}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'skill_matched':
      return (
        <>
          <Row k="扫描索引" v={`${p.scanned} 个 Skill 的元数据`} />
          <Row k="匹配范围" v={p.restrict === 'auto' ? '全部 Skill（自动匹配）' : `指定 Skill：${p.restrict}`} />
          <Row k="得分" v={`${p.score} / 阈值 ${p.threshold}`} />
          <Row k="命中关键词" v={(p.hits || []).join('、') || '—'} />
          <Row k="结论" v={p.matched ? `命中 ${p.name}` : '未命中，不加载任何正文'} />
          <div className="divider" />
          <div className="note">{p.note}</div>
        </>
      );
    case 'skill_skipped':
      return (
        <>
          <Row k="Skill" v={p.name || p.id} />
          <Row k="得分" v={`${p.score} / 阈值 ${p.threshold}`} />
          <Row k="索引体积" v={`${p.indexChars} 字`} />
          <Row k="省下的正文" v={`${p.savedChars} 字`} />
          <div className="divider" />
          <div className="note">{p.note}</div>
        </>
      );
    case 'skill_loaded':
      return (
        <>
          <Row k="Skill" v={p.name} />
          <Row k="版本" v={p.version} />
          <Row k="索引体积（常驻）" v={p.indexChars != null ? `${p.indexChars} 字` : '—'} />
          <Row k="本次读取正文" v={`${p.chars} 字`} />
          <Row k="未加载的正文" v={p.skippedBodyChars != null ? `${p.skippedBodyChars} 字` : '—'} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            注入到上下文的内容（节选）
          </div>
          <div className="json-view" style={{ fontFamily: 'inherit', fontSize: 11.5 }}>
            {p.preview}
          </div>
          {p.note && <div className="note" style={{ marginTop: 8 }}>{p.note}</div>}
        </>
      );
    case 'mcp_connected':
      return (
        <>
          <Row k="服务器" v={`${p.server}（${p.serverId}）`} />
          <Row k="服务端标识" v={p.serverInfo?.name ? `${p.serverInfo.name} v${p.serverInfo.version || '—'}` : '—'} />
          <Row k="协议版本" v={p.protocolVersion} />
          <Row k="传输方式" v={p.transport} />
          <Row k="握手耗时" v={p.latencyMs != null ? `${p.latencyMs} ms` : '—'} />
          <Row k="发现工具" v={`${(p.tools || []).length} 个`} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 6 }}>
            由 tools/list 返回的工具清单
          </div>
          {(p.tools || []).map((t: any) => (
            <div className="chunk" key={t.name}>
              <div className="chunk-head">
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>{t.name}</span>
              </div>
              <div style={{ fontSize: 10.6, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                {(t.description || '').slice(0, 160)}
              </div>
            </div>
          ))}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'mcp_connect_failed':
      return (
        <>
          <Row k="服务器" v={`${p.serverLabel || p.serverId}`} />
          <Row k="错误" v={p.error} />
          <div className="divider" />
          <div className="note warn">{p.note}</div>
        </>
      );
    case 'mcp_tools_call':
      return (
        <>
          <Row k="方法" v={p.method} />
          <Row k="服务器" v={p.server || p.serverId} />
          <Row k="工具" v={p.tool || p.name} />
          <Row k="协议版本" v={p.protocolVersion || '—'} />
          <Row k="往返耗时" v={p.durationMs != null ? `${p.durationMs} ms` : '—'} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            参数（application 侧发给 Server 的 arguments）
          </div>
          <div className="json-view">{JSON.stringify(p.arguments, null, 2)}</div>
          <div className="mini-label" style={{ margin: '8px 0 5px' }}>
            协议往返（真实 JSON-RPC）
          </div>
          <div className="json-view">
            {(p.trace || [])
              .map((t: any) => `${t.direction === '->' ? '→' : '←'} ${t.method || `#${t.id} 响应`}`)
              .join('\n')}
          </div>
        </>
      );
    case 'permission_checked':
      return (
        <>
          <Row k="工具" v={p.toolName} />
          <Row k="结果" v={p.allowed ? '放行' : '拒绝'} />
          <Row k="所需权限" v={p.required || '—'} />
          <Row k="策略" v={p.policy} />
          <div className="divider" />
          <div className="note">{p.reason}</div>
        </>
      );
    case 'run_completed':
      return (
        <>
          <Row k="轮次" v={p.rounds} />
          <Row k="LLM 调用" v={`${p.stats?.llmCalls} 次`} />
          <Row k="工具调用" v={`${p.stats?.toolCalls} 次`} />
          <Row k="总耗时" v={`${((p.stats?.durationMs || 0) / 1000).toFixed(2)} s`} />
          <Row k="数据版本" v={p.stats?.dataVersion} />
          <Row k="知识库版本" v={p.stats?.kbVersion} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            最终回答
          </div>
          <div style={{ fontSize: 11.8, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{p.answer}</div>
        </>
      );
    case 'run_failed':
      return (
        <>
          <Row k="错误" v={p.error} />
          {p.detail && <Row k="详情" v={String(p.detail).slice(0, 600)} />}
          <div className="divider" />
          <div className="note warn">失败发生在真实调用链路上，界面不会替换为伪造的成功结果。</div>
        </>
      );
    default:
      return <div className="json-view">{JSON.stringify(p, null, 2)}</div>;
  }
}

export default function DetailPanel({ event, runStats, snapshot, mcpTrace }: Props) {
  const [raw, setRaw] = useState(false);

  if (!event) {
    return (
      <div className="panel-body panel-pad">
        <div className="section-title">本次运行的配置快照</div>
        {snapshot ? (
          <div>
            <Row k="模型" v={snapshot.model} />
            <Row k="Temperature" v={snapshot.temperature} />
            <Row k="System Prompt" v={snapshot.systemPromptEnabled ? '已启用' : '未启用'} />
            <Row k="多轮上下文" v={snapshot.multiTurn ? '已启用' : '未启用'} />
            <Row k="工具调用" v={snapshot.functionCalling ? snapshot.tools.join('、') || '已开启，未选工具' : '未启用'} />
            <Row k="工具通道" v={snapshot.mcpMode ? '同名能力走 MCP' : '本地函数优先'} />
            <Row
              k="MCP 服务器"
              v={snapshot.mcpServers?.length ? snapshot.mcpServers.join('、') : '本次未使用'}
            />
            <Row k="知识库" v={snapshot.rag ? `已启用（${snapshot.ragMode || 'hybrid'}）` : '未启用'} />
            <Row k="Embedding" v={snapshot.embedding || '未配置'} />
            <Row k="Skill" v={snapshot.skill || '未加载'} />
            <Row k="数据版本" v={snapshot.dataVersion || '—'} />
            <Row k="知识库版本" v={snapshot.kbVersion || '—'} />
          </div>
        ) : (
          <div className="note">还没有运行记录。每次运行都会保存一份配置快照，用于事后对比。</div>
        )}

        {runStats && (
          <>
            <div className="section-title">本次统计</div>
            <Row k="LLM 调用" v={`${runStats.llmCalls} 次`} />
            <Row k="工具调用" v={`${runStats.toolCalls} 次`} />
            <Row k="总耗时" v={`${((runStats.durationMs || 0) / 1000).toFixed(2)} s`} />
            <Row k="Token" v={`入 ${runStats.promptTokens || 0} / 出 ${runStats.completionTokens || 0}`} />
          </>
        )}

        {mcpTrace?.length > 0 && snapshot?.mcpMode && (
          <>
            <div className="section-title">MCP 协议交互</div>
            <div className="json-view">
              {mcpTrace.map((t: any, i: number) => `${t.direction} ${t.method || JSON.stringify(t.payload).slice(0, 70)}`).join('\n')}
            </div>
          </>
        )}

        <div className="note" style={{ marginTop: 14 }}>
          点击画布节点或时间线中的任意一步，可以查看那次调用的真实输入与输出。
        </div>
      </div>
    );
  }

  return (
    <div className="panel-body panel-pad">
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 620 }}>{event.event_type}</div>
          <div style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--mono)', marginTop: 2 }}>
            {event.component_id} · #{event.sequence} · {new Date(event.timestamp).toLocaleTimeString()}
          </div>
        </div>
        <div className="seg" style={{ marginBottom: 0 }}>
          <button className={!raw ? 'on' : ''} onClick={() => setRaw(false)}>
            业务视图
          </button>
          <button className={raw ? 'on' : ''} onClick={() => setRaw(true)}>
            原始事件
          </button>
        </div>
      </div>

      {raw ? <div className="json-view">{JSON.stringify(event, null, 2)}</div> : <BusinessView evt={event} />}
    </div>
  );
}
