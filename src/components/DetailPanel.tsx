import { useState } from 'react';
import type { RunEvent } from '../lib/types';

interface Props {
  event: RunEvent | null;
  runStats: any;
  snapshot: any;
  mcpTrace: any[];
  onOpenToolSchema?: () => void;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="d-row">
      <div className="d-k">{k}</div>
      <div className="d-v">{v}</div>
    </div>
  );
}

function BusinessView({ evt, onOpenToolSchema }: { evt: RunEvent; onOpenToolSchema?: () => void }) {
  const p = evt.payload || {};
  switch (evt.event_type) {
    case 'prompt_built':
      return (
        <>
          <Row k="模型" v={p.model} />
          <Row k="Temperature" v={p.temperature} />
          <Row k="消息数" v={`${p.messageCount} 条 · 约 ${p.approxChars} 字`} />
          <Row k="工具来源" v={p.toolSource === 'skill' ? 'Skill 能力包' : p.toolSource === 'mcp' ? 'MCP Server' : p.toolSource === 'mixed' ? '本地函数 + MCP' : p.toolSource === 'structured' ? '结构化输出模式' : p.toolSource === 'plan' ? 'Plan-and-Execute' : p.toolSource === 'react' ? 'ReAct' : p.toolSource === 'agent' ? '目标循环' : '本地函数'} />
          {p.responseFormatType && <Row k="输出约束" v={p.responseFormatType} />}
          <Row k="提供工具" v={p.tools?.length ? p.tools.join('、') : '无'} />
          <Row k="tools 字段体积" v={p.schemaChars ? `${p.schemaChars} 字（会随请求一起进入模型输入）` : '本次不带 tools'} />
          {onOpenToolSchema && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onOpenToolSchema}>
              查看完整工具 Schema 与请求体
            </button>
          )}
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
          {p.via && (
            <Row
              k="执行路径"
              v={p.via === 'mcp' ? '通过 MCP Server 执行' : p.via === 'skill' ? 'Skill 能力包（应用侧受控）' : '本地函数直接执行'}
            />
          )}
          {p.source && !p.via && (
            <Row
              k="请求来源"
              v={p.source === 'mcp' ? 'MCP Server 声明的工具' : p.source === 'skill' ? 'Skill 能力包工具' : '本地函数'}
            />
          )}
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
    case 'skill_selected':
      return (
        <>
          <Row
            k="选择策略"
            v={p.mode === 'all' ? '全部加载（勾选的全进上下文）' : `自动匹配（阈值 ${p.threshold} 分，可 0/1/多个）`}
          />
          <Row k="扫描 / 勾选 / 入选" v={`${p.scanned} 个索引 · ${p.candidates} 个勾选 · ${p.selectedCount} 个入选`} />
          <Row k="主指令合计" v={`${p.totalInstructionChars} 字`} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            打分明细
          </div>
          {(p.scored || []).map((s: any) => (
            <div className={`score-row ${s.matched ? 'hit' : ''}`} key={s.id}>
              <span className="sr-name">{s.name}</span>
              <span className="sr-score">{s.score} 分</span>
              <span className="sr-hits">{(s.hits || []).join('、') || '—'}</span>
            </div>
          ))}
          {(p.duplicatePaths || []).length > 0 && (
            <>
              <div className="divider" />
              <div className="mini-label" style={{ marginBottom: 5 }}>
                跨 Skill 同名资源（必须靠 skill_id 区分）
              </div>
              {(p.duplicatePaths || []).map((d: any) => (
                <div className="chunk" key={d.path}>
                  <div className="chunk-head">
                    <span>{d.path}</span>
                    <span>{d.skills.join(' / ')}</span>
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'skill_skipped':
      return (
        <>
          <Row k="勾选的 Skill" v={(p.ids || []).join('、') || '—'} />
          <Row k="策略" v={p.mode === 'all' ? '全部加载' : `自动匹配（阈值 ${p.threshold} 分）`} />
          {(p.scored || []).length > 0 && <Row k="最高得分" v={`${p.scored[0]?.score ?? 0} 分`} />}
          <Row k="省下的主指令" v={`${p.savedChars || 0} 字`} />
          <div className="divider" />
          <div className="note">{p.note}</div>
        </>
      );
    case 'skill_loaded':
      return (
        <>
          <Row k="Skill" v={p.name} />
          <Row k="版本" v={p.version} />
          {p.total > 1 && <Row k="本次第几个" v={`第 ${p.order} / ${p.total} 个主指令`} />}
          <Row k="索引体积（常驻）" v={p.indexChars != null ? `${p.indexChars} 字` : '—'} />
          <Row k="本次读取主指令" v={`${p.chars} 字`} />
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
    case 'skill_package_mounted':
      return (
        <>
          <Row k="已挂载" v={`${p.count} 个 Skill 能力包`} />
          <Row k="主指令合计" v={`${p.totals?.instructionChars} 字（已进上下文）`} />
          <Row k="能力包全量" v={`${p.totals?.packageChars} 字`} />
          <Row k="尚未读取" v={`${p.unreadChars} 字`} />
          {(p.duplicatePaths || []).length > 0 && (
            <Row k="同名资源" v={`${(p.duplicatePaths || []).length} 处（靠 skill_id 区分）`} />
          )}
          {(p.sharedKeywords || []).length > 0 && (
            <Row k="关键词重叠" v={(p.sharedKeywords || []).join('、')} />
          )}
          <div className="divider" />
          {(p.skills || []).map((sk: any) => (
            <div className="pkg-block" key={sk.skillId}>
              <div className="pkg-block-head">
                <span className="pkg-block-id">{sk.skillId}</span>
                <span>{sk.name}</span>
                <span className="pkg-block-meta">
                  主指令 {sk.instructionChars} 字 · 包 {sk.packageChars} 字
                </span>
              </div>
              <div className="mini-label" style={{ margin: '4px 0 4px' }}>
                references（{sk.references?.length || 0} 份，当前只有标题与体积）
              </div>
              {(sk.references || []).map((r: any) => (
                <div className="chunk" key={r.path}>
                  <div className="chunk-head">
                    <span>{r.path}</span>
                    <span>{r.chars} 字 · 未读</span>
                  </div>
                  <div style={{ fontSize: 10.6, color: 'var(--ink-3)', lineHeight: 1.6 }}>{r.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 3 }}>适用：{r.when}</div>
                </div>
              ))}
              <div className="mini-label" style={{ margin: '8px 0 4px' }}>
                scripts（{sk.scripts?.length || 0} 个，只登记用途与参数）
              </div>
              {(sk.scripts || []).map((s: any) => (
                <div className="chunk" key={s.name}>
                  <div className="chunk-head">
                    <span>{s.name}</span>
                    <span>源码 {s.chars} 字 · 未执行</span>
                  </div>
                  <div style={{ fontSize: 10.6, color: 'var(--ink-3)', lineHeight: 1.6 }}>{s.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 3 }}>
                    适用：{s.when} · 超时 {s.timeoutMs}ms · 网络 {s.network ? '开启' : '关闭'} · 副作用 {s.sideEffect}
                  </div>
                </div>
              ))}
              {(sk.assets || []).length > 0 && (
                <>
                  <div className="mini-label" style={{ margin: '8px 0 4px' }}>
                    assets（{sk.assets.length} 个，未读）
                  </div>
                  {(sk.assets || []).map((a: any) => (
                    <div className="chunk" key={a.path}>
                      <div className="chunk-head">
                        <span>{a.path}</span>
                        <span>{a.chars} 字</span>
                      </div>
                      <div style={{ fontSize: 10.6, color: 'var(--ink-3)' }}>{a.title}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'skill_resource_read':
      return (
        <>
          <Row k="所属 Skill" v={`${p.skillName}（${p.skillId}）`} />
          <Row k="读取文件" v={p.path} />
          <Row k="标题" v={p.title} />
          <Row k="体积" v={`${p.chars} 字`} />
          <Row k="嵌套层级" v={`第 ${p.depth} 层`} />
          {p.reason && <Row k="模型给出的理由" v={p.reason} />}
          <Row k="累计读取资料" v={`${p.cumulativeRefChars} 字`} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            已读取
          </div>
          <div className="mono-tag-list">
            {(p.loaded || []).map((x: string) => (
              <span className="mono-tag" key={x}>
                {x}
              </span>
            ))}
          </div>
          <div className="mini-label" style={{ margin: '10px 0 5px' }}>
            本次未读取（仍在磁盘上）
          </div>
          <div className="mono-tag-list">
            {(p.stillUnloaded || []).map((x: string) => (
              <span className="mono-tag dim" key={x}>
                {x}
              </span>
            ))}
          </div>
          {(p.seeAlso || []).length > 0 && (
            <div className="note" style={{ marginTop: 8 }}>
              这份资料还指向：{(p.seeAlso || []).join('、')}。是否继续往下读由模型决定，层级上限为 2 层。
            </div>
          )}
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            返回给模型的内容（节选）
          </div>
          <div className="json-view" style={{ fontFamily: 'inherit', fontSize: 11.5, whiteSpace: 'pre-wrap' }}>
            {p.preview}
          </div>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'skill_script_run':
      return (
        <>
          <Row k="所属 Skill" v={`${p.skillName}（${p.skillId}）`} />
          <Row k="脚本" v={`${p.name}（${p.script}）`} />
          <Row k="用途" v={p.title} />
          <Row k="退出码" v={p.timedOut ? '超时被杀' : p.exitCode} />
          <Row k="耗时" v={`${p.durationMs} ms`} />
          <Row k="解释器" v={p.interpreter} />
          <Row k="网络 / 副作用" v={`${p.network ? '开启' : '关闭'} / ${p.sideEffect}`} />
          <div className="divider" />
          <Row k="传入参数" v={<code>{JSON.stringify(p.args)}</code>} />
          <Row k="实际命令行" v={<code>{`python3 ${p.script} ${(p.argv || []).join(' ')}`}</code>} />
          <div className="divider" />
          <div className="ctx-compare">
            <div className="ctx-item bad">
              <span>脚本源码</span>
              <b>{p.scriptChars} 字</b>
              <em>没有进上下文</em>
            </div>
            <div className="ctx-item good">
              <span>标准输出</span>
              <b>{p.outputChars} 字</b>
              <em>回传给模型</em>
            </div>
          </div>
          <div className="mini-label" style={{ margin: '10px 0 5px' }}>
            标准输出
          </div>
          <pre className="json-view">{p.stdout}</pre>
          {p.stderr && (
            <>
              <div className="mini-label" style={{ margin: '8px 0 5px' }}>
                标准错误
              </div>
              <pre className="json-view">{p.stderr}</pre>
            </>
          )}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'skill_tools_unavailable':
      return (
        <>
          <Row k="已加载 Skill" v={(p.skills || []).join('、') || '—'} />
          <Row k="未触达资料" v={`${p.references} 份`} />
          <Row k="未触达脚本" v={`${p.scripts} 个`} />
          <div className="divider" />
          <div className="note warn">{p.note}</div>
        </>
      );
    case 'mode_started':
      return (
        <>
          <Row k="运行模式" v={p.modeLabel} />
          <Row k="可用工具" v={p.tools?.length ? p.tools.join('、') : '无'} />
          <Row k="步数预算" v={p.maxSteps} />
          <div className="divider" />
          <div className="note">{p.note}</div>
        </>
      );

    // ---------- 08 结构化输出 ----------
    case 'structured_schema_sent':
      return (
        <>
          <Row k="Schema" v={p.schemaName} />
          <Row k="约束方式" v={`${p.responseFormat}${p.strict ? '（strict）' : ''}`} />
          <Row k="Schema 体积" v={`${p.schemaChars} 字`} />
          <Row k="顶层字段" v={(p.fields || []).join('、')} />
          <Row k="整个请求体" v={`${p.requestBytes} 字节`} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            随请求发出的 Schema（这是约束，不是建议）
          </div>
          <pre className="json-view">{JSON.stringify(p.schema, null, 2)}</pre>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'structured_output_received':
    case 'structured_call_completed':
      return (
        <>
          <Row k="约束方式" v={p.responseFormat || '—'} />
          <Row k="返回体积" v={`${p.rawChars} 字`} />
          <Row k="能否解析为 JSON" v={p.parsed ? '可以' : `不可以：${p.parseError}`} />
          {p.durationMs != null && <Row k="耗时" v={`${p.durationMs} ms`} />}
          {p.usage && <Row k="Token" v={`入 ${p.usage.prompt_tokens} / 出 ${p.usage.completion_tokens}`} />}
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            模型返回的原文
          </div>
          <pre className="json-view">{p.raw || '（空）'}</pre>
          {p.note && <div className="note" style={{ marginTop: 8 }}>{p.note}</div>}
        </>
      );
    case 'schema_validated':
      return (
        <>
          <Row k="第几次校验" v={`第 ${p.round} 次`} />
          <Row k="结论" v={p.ok ? '通过' : `未通过（${p.errorCount} 处）`} />
          {!p.ok && (
            <>
              <div className="divider" />
              <div className="mini-label" style={{ marginBottom: 5 }}>
                具体问题（由应用逐字段校验得出）
              </div>
              {(p.errors || []).map((e: string, i: number) => (
                <div className="chunk" key={i}>
                  <div className="chunk-body" style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
                    {e}
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'rules_evaluated':
      return (
        <>
          <Row k="执行者" v="确定性规则引擎（无模型参与）" />
          <Row k="触发" v={`${p.triggeredCount} 条${p.unknownCount ? ` · 无法判定 ${p.unknownCount} 条` : ''}`} />
          <Row k="结论" v={p.verdict} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            输入与推导
          </div>
          <pre className="json-view">{JSON.stringify(p.derived, null, 2)}</pre>
          <div className="mini-label" style={{ margin: '8px 0 5px' }}>
            逐条判定
          </div>
          {(p.results || []).map((r: any) => (
            <div className={`score-row ${r.status === 'triggered' ? 'hit' : ''}`} key={r.id}>
              <span className="sr-name">
                {r.id} {r.name}
              </span>
              <span className="sr-score">{r.status === 'triggered' ? '触发' : r.status === 'not_triggered' ? '未触发' : '无法判定'}</span>
              <span className="sr-hits">{r.reason}</span>
            </div>
          ))}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'structured_answer_rendered':
      return (
        <>
          <Row k="来源" v={`${p.source}（模板 ${p.template}）`} />
          <Row k="成稿体积" v={`${p.chars} 字`} />
          <Row k="模型调用次数" v={`${p.llmCalls} 次`} />
          <div className="divider" />
          <div className="note">{p.note}</div>
        </>
      );
    case 'structured_failed':
      return (
        <>
          <Row k="问题数" v={`${(p.errors || []).length} 处`} />
          <div className="divider" />
          {(p.errors || []).map((e: string, i: number) => (
            <div className="chunk" key={i}>
              <div className="chunk-body" style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
                {e}
              </div>
            </div>
          ))}
          <div className="note warn" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'structured_fallback':
      return (
        <>
          <Row k="原方式" v={p.from} />
          <Row k="改为" v={p.to} />
          <Row k="原因" v={p.reason} />
          <div className="divider" />
          <div className="note">{p.note}</div>
        </>
      );

    // ---------- 11 计划与执行 ----------
    case 'plan_requested':
      return (
        <>
          <Row k="目标" v={p.goal} />
          <Row k="可用工具" v={`${p.toolCount} 个：${(p.tools || []).join('、')}`} />
          <Row k="步数上限" v={p.maxSteps} />
          <Row k="Schema" v={`${p.schemaName} · ${p.schemaChars} 字`} />
          <div className="divider" />
          <div className="note">{p.note}</div>
        </>
      );
    case 'plan_validated':
      return (
        <>
          <Row k="结论" v={p.ok ? '计划合法' : '计划不合法'} />
          {!p.ok && (
            <>
              <div className="divider" />
              {(p.errors || []).map((e: string, i: number) => (
                <div className="chunk" key={i}>
                  <div className="chunk-body" style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
                    {e}
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'plan_created':
      return (
        <>
          <Row k="目标" v={p.goal} />
          <Row k="步骤数" v={`${p.stepCount} 步`} />
          <Row k="计划体积" v={`${p.planChars} 字`} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            规划理由
          </div>
          <div style={{ fontSize: 10.8, lineHeight: 1.7, color: 'var(--ink-2)' }}>{p.reasoning}</div>
          <div className="mini-label" style={{ margin: '8px 0 5px' }}>
            计划步骤
          </div>
          <div className="plan-steps">
            {(p.steps || []).map((s: any) => (
              <div className="plan-step" key={s.id}>
                <span className="plan-step-no">{s.id}</span>
                <div>
                  <div className="plan-step-title">
                    {s.title}
                    <span className="plan-step-tool">{s.tool}</span>
                  </div>
                  <div className="plan-step-extra">
                    参数 <code>{JSON.stringify(s.args)}</code>
                    <br />
                    期望 {s.expect}
                  </div>
                </div>
                <span />
              </div>
            ))}
          </div>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'plan_step_started':
      return (
        <>
          <Row k="第几步" v={`${p.index} / ${p.total}`} />
          <Row k="步骤" v={p.title} />
          <Row k="工具" v={p.tool} />
          <Row k="期望" v={p.expect} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            计划给出的参数（可能含占位符）
          </div>
          <pre className="json-view">{JSON.stringify(p.args, null, 2)}</pre>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'plan_step_args_resolved':
      return (
        <>
          <Row k="结论" v={(p.unresolved || []).length ? '有引用未解析，未执行' : '全部解析成功'} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            原始参数
          </div>
          <pre className="json-view">{JSON.stringify(p.original, null, 2)}</pre>
          <div className="mini-label" style={{ margin: '8px 0 5px' }}>
            绑定后的参数
          </div>
          <pre className="json-view">{JSON.stringify(p.resolved, null, 2)}</pre>
          {(p.refs || []).length > 0 && (
            <>
              <div className="mini-label" style={{ margin: '8px 0 5px' }}>
                绑定明细
              </div>
              {(p.refs || []).map((r: any, i: number) => (
                <div className="score-row" key={i}>
                  <span className="sr-name">{r.from}</span>
                  <span className="sr-score">{String(r.value)}</span>
                  <span className="sr-hits">{r.rule}</span>
                </div>
              ))}
            </>
          )}
          {(p.unresolved || []).length > 0 && (
            <>
              <div className="mini-label" style={{ margin: '8px 0 5px' }}>
                未解析
              </div>
              {(p.unresolved || []).map((u: any, i: number) => (
                <div className="chunk" key={i}>
                  <div className="chunk-body" style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
                    {u.from} — {u.reason}
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'plan_step_completed':
      return (
        <>
          <Row k="步骤" v={`第 ${p.stepId} 步`} />
          <Row k="结果" v={p.ok ? '成功' : '失败'} />
          <Row k="摘要" v={p.summary} />
          {p.error && <Row k="错误" v={p.error} />}
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            观测结果（会进入后续步骤与汇总）
          </div>
          <pre className="json-view">{p.observation || '（无输出）'}</pre>
        </>
      );
    case 'plan_revised':
      return (
        <>
          <Row k="修订理由" v={p.reason} />
          <Row k="剩余步骤" v={`${p.remaining} 步`} />
          <div className="divider" />
          <div className="plan-steps">
            {(p.revised_steps || []).map((s: any) => (
              <div className="plan-step" key={s.id}>
                <span className="plan-step-no">{s.id}</span>
                <div>
                  <div className="plan-step-title">
                    {s.title}
                    <span className="plan-step-tool">{s.tool}</span>
                  </div>
                  <div className="plan-step-extra">
                    参数 <code>{JSON.stringify(s.args)}</code>
                  </div>
                </div>
                <span />
              </div>
            ))}
          </div>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'plan_synthesis_started':
      return (
        <>
          <Row k="观测条数" v={p.observations} />
          <Row k="观测体积" v={`${p.observationChars} 字`} />
          <div className="divider" />
          <div className="note">{p.note}</div>
        </>
      );
    case 'plan_completed':
      return (
        <>
          <Row k="执行步数" v={p.executed} />
          <Row k="成功 / 失败" v={`${p.okCount} / ${p.failedCount}`} />
          <Row k="是否重规划" v={p.revised ? '是' : '否'} />
          <div className="divider" />
          <div className="note">{p.note}</div>
        </>
      );

    // ---------- 10 ReAct ----------
    case 'react_thought':
      return (
        <>
          <Row k="第几步" v={`第 ${p.step} 步`} />
          {p.durationMs != null && <Row k="本轮耗时" v={`${p.durationMs} ms`} />}
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            Thought（模型显式写出来的，不是内部思维链）
          </div>
          <div className="trace-row thought">
            <div className="trace-body">{p.thought}</div>
          </div>
          <div className="mini-label" style={{ margin: '8px 0 5px' }}>
            本轮原始输出
          </div>
          <pre className="json-view">{p.raw}</pre>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'react_action':
      return (
        <>
          <Row k="第几步" v={`第 ${p.step} 步`} />
          <Row k="Action" v={p.action} />
          <Row k="调用编号" v={p.callId} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            Action Input（从文本里解析出来的参数）
          </div>
          <pre className="json-view">{JSON.stringify(p.args, null, 2)}</pre>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'react_observation':
      return (
        <>
          <Row k="第几步" v={`第 ${p.step} 步`} />
          <Row k="结果" v={p.ok ? '成功' : '失败'} />
          <Row k="体积" v={`${p.chars} 字`} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            回灌给模型的 Observation
          </div>
          <pre className="json-view">{p.observation}</pre>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'react_parse_failed':
      return (
        <>
          <Row k="第几步" v={`第 ${p.step} 步`} />
          <Row k="原因" v={p.reason} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            模型原文（解析不出来的就是这段）
          </div>
          <pre className="json-view">{p.raw}</pre>
          <div className="note warn" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );

    // ---------- 09 Agent 循环 ----------
    case 'agent_goal_set':
      return (
        <>
          <Row k="目标" v={p.goal} />
          <Row k="可用工具" v={(p.tools || []).join('、') || '无'} />
          <Row k="步数上限" v={p.maxSteps} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            终止条件
          </div>
          {(p.stopConditions || []).map((s: string, i: number) => (
            <div className="chunk" key={i}>
              <div className="chunk-body" style={{ fontSize: 10.5 }}>
                {s}
              </div>
            </div>
          ))}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'agent_step_decided':
      return (
        <>
          <Row k="第几轮" v={`第 ${p.step} 轮`} />
          <Row k="判断" v={p.assessment} />
          <Row k="是否结束" v={p.done ? '是（目标达成）' : '否'} />
          {p.action && (
            <>
              <Row k="下一步工具" v={p.action.tool} />
              <Row k="理由" v={p.action.why} />
              <div className="divider" />
              <div className="mini-label" style={{ marginBottom: 5 }}>
                参数
              </div>
              <pre className="json-view">{JSON.stringify(p.action.args, null, 2)}</pre>
            </>
          )}
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
        </>
      );
    case 'agent_observation':
      return (
        <>
          <Row k="第几轮" v={`第 ${p.step} 轮`} />
          <Row k="结果" v={p.ok ? '成功' : '失败'} />
          <Row k="体积" v={`${p.chars} 字`} />
          <div className="divider" />
          <div className="mini-label" style={{ marginBottom: 5 }}>
            写回对话的观测
          </div>
          <pre className="json-view">{p.observation}</pre>
          <div className="note" style={{ marginTop: 8 }}>{p.note}</div>
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
          {p.stats?.skillDisclosure && <DisclosureBlock d={p.stats.skillDisclosure} />}
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

/** 渐进式披露的实际开销：全量预载 vs 本次真正进上下文 */
function DisclosureBlock({ d }: { d: any }) {
  return (
    <>
      <div className="section-title">渐进式披露开销</div>
      <Row k="加载的 Skill" v={`${d.skillCount ?? 1} 个：${(d.skillNames || [d.name]).join('、')}`} />
      <Row k="索引常驻" v={`${d.indexChars} 字`} />
      <Row k="主指令合计" v={`${d.instructionChars} 字`} />
      <Row k="本次读取资料" v={`${d.refsLoaded?.length || 0} 份 / ${d.refChars} 字（共 ${d.refsTotal} 字）`} />
      <Row k="本次执行脚本" v={`${d.scriptsRun?.length || 0} 个 / 输出 ${d.scriptOutputChars} 字`} />
      <Row k="脚本源码未进上下文" v={`${d.scriptSourceChars} 字`} />
      {(d.perSkill || []).length > 1 && (
        <>
          <div className="mini-label" style={{ margin: '8px 0 4px' }}>
            分 Skill 明细
          </div>
          {(d.perSkill || []).map((p: any) => (
            <div className="score-row" key={p.skillId}>
              <span className="sr-name">{p.name}</span>
              <span className="sr-score">{p.instructionChars} 字</span>
              <span className="sr-hits">
                资料 {p.refsLoaded?.length || 0} 份 · 脚本 {p.scriptsRun?.length || 0} 个
              </span>
            </div>
          ))}
        </>
      )}
      <div className="ctx-compare">
        <div className="ctx-item bad">
          <span>全量预载</span>
          <b>{d.fullPreloadChars} 字</b>
          <em>把所有资料和源码一次塞进去</em>
        </div>
        <div className="ctx-item good">
          <span>本次实际</span>
          <b>{d.actualChars} 字</b>
          <em>只取用到的那一部分</em>
        </div>
      </div>
      <Row k="省下" v={`${d.savedChars} 字（约 ${Math.round((d.savedChars / Math.max(1, d.fullPreloadChars)) * 100)}%）`} />
      <Row k="未读资料 / 未跑脚本" v={`${d.refsSkipped} 份 / ${d.scriptsNotRun} 个`} />
      <div className="note" style={{ marginTop: 6 }}>
        字数为准确字符数；Token 以模型接口返回的 usage 为准（本次 入 {d.tokenUsage?.prompt ?? 0} / 出{' '}
        {d.tokenUsage?.completion ?? 0}），两者不是同一口径，不可直接换算。
      </div>
    </>
  );
}

export default function DetailPanel({ event, runStats, snapshot, mcpTrace, onOpenToolSchema }: Props) {
  const [raw, setRaw] = useState(false);

  if (!event) {
    return (
      <div className="panel-body panel-pad">
        <div className="section-title">本次运行的配置快照</div>
        {snapshot ? (
          <div>
            <Row k="模型" v={snapshot.model} />
            <Row k="运行模式" v={snapshot.agentModeLabel || (snapshot.agentMode && snapshot.agentMode !== 'off' ? snapshot.agentMode : '单轮问答')} />
            <Row k="Temperature" v={snapshot.temperature} />
            <Row k="System Prompt" v={snapshot.systemPromptEnabled ? '已启用' : '未启用'} />
            <Row k="多轮上下文" v={snapshot.multiTurn ? '已启用' : '未启用'} />
            <Row k="工具调用" v={snapshot.functionCalling ? snapshot.tools.join('、') || '已开启，未选工具' : '未启用'} />
            <Row
              k="执行路径"
              v={snapshot.mcpMode ? '演示对照：同名工具改走 MCP' : '本地函数直接执行（MCP 工具按服务器前缀区分）'}
            />
            <Row
              k="MCP 服务器"
              v={snapshot.mcpServers?.length ? snapshot.mcpServers.join('、') : '本次未使用'}
            />
            <Row k="知识库" v={snapshot.rag ? `已启用（${snapshot.ragMode || 'hybrid'}）` : '未启用'} />
            <Row k="Embedding" v={snapshot.embedding || '未配置'} />
            <Row
              k="Skill"
              v={
                snapshot.skills?.length
                  ? `${snapshot.skills.length} 个：${snapshot.skills.join('、')}`
                  : snapshot.skill || '未加载'
              }
            />
            {(snapshot.skills?.length || snapshot.skill) && (
              <>
                <Row
                  k="选择策略"
                  v={
                    (snapshot.skillMode || (snapshot.skillAuto === false ? 'all' : 'auto')) === 'all'
                      ? '全部加载'
                      : '自动匹配'
                  }
                />
                <Row k="按需读资料" v={snapshot.skillRefs ? '已开启（references / assets）' : '已关闭'} />
                <Row k="按需跑脚本" v={snapshot.skillScripts ? '已开启（scripts）' : '已关闭'} />
              </>
            )}
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
            {runStats.skillDisclosure && <DisclosureBlock d={runStats.skillDisclosure} />}
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

      {raw ? <div className="json-view">{JSON.stringify(event, null, 2)}</div> : <BusinessView evt={event} onOpenToolSchema={onOpenToolSchema} />}
    </div>
  );
}
