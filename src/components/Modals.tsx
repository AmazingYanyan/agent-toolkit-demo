import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { ArchNode } from '../lib/types';

export function Modal({
  title,
  sub,
  onClose,
  children,
  footer,
  wide,
  xwide,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  xwide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''} ${xwide ? 'xwide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {sub && <div className="modal-sub">{sub}</div>}
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function SettingsModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    baseUrl: initial?.baseUrl || '',
    apiKey: '',
    model: initial?.model || '',
    temperature: initial?.temperature ?? 0.2,
  });
  const [emb, setEmb] = useState({
    enabled: Boolean(initial?.embedding?.enabled),
    baseUrl: initial?.embedding?.baseUrl || '',
    apiKey: '',
    model: initial?.embedding?.model || '',
    batchSize: initial?.embedding?.batchSize || 10,
  });
  const [ret, setRet] = useState({
    chunkSize: initial?.retrieval?.chunkSize || 320,
    vectorWeight: initial?.retrieval?.vectorWeight ?? 0.6,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [embMsg, setEmbMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const buildPatch = () => ({ ...form, embedding: { ...emb }, retrieval: { ...ret } });

  const save = async () => {
    setBusy(true);
    try {
      await api.saveConfig(buildPatch());
      setMsg({ ok: true, text: '已保存到本地后端配置文件（不会下发到浏览器）' });
      onSaved();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const probe = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.saveConfig(buildPatch());
      const r = await api.probe();
      setMsg({
        ok: r.ok,
        text: r.ok
          ? `连接成功：${r.model}${r.reply ? ` · 返回「${r.reply}」` : ''}`
          : `${r.reason}${r.detail ? '：' + r.detail : ''}`,
      });
      onSaved();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const probeEmb = async () => {
    setBusy(true);
    setEmbMsg(null);
    try {
      await api.saveConfig(buildPatch());
      const r = await api.probeEmbedding();
      setEmbMsg({
        ok: r.ok,
        text: r.ok
          ? `向量接口可用：${r.model} · ${r.dimensions} 维 · ${r.latencyMs}ms｜索引已覆盖 ${r.index?.covered || 0}/${r.index?.total || 0} 个分块`
          : r.reason,
      });
      onSaved();
    } catch (e: any) {
      setEmbMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="模型服务配置"
      sub="密钥只保存在本地后端 config.json，前端永远拿不到明文"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={probe} disabled={busy}>
            保存并测试对话模型
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            保存
          </button>
        </>
      }
    >
      <div className="section-title" style={{ marginTop: 0 }}>
        对话模型（OpenAI 兼容）
      </div>
      <div className="form-row">
        <label>Base URL</label>
        <input
          className="input"
          value={form.baseUrl}
          placeholder="https://api.openai.com/v1"
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
        />
        <div className="mini-label" style={{ marginTop: 4 }}>
          也可填 DeepSeek、通义、内网网关地址；末尾会自动去掉多余斜杠
        </div>
      </div>
      <div className="form-row">
        <label>API Key</label>
        <input
          className="input"
          type="password"
          value={form.apiKey}
          placeholder={initial?.apiKey ? `已配置：${initial.apiKey}（留空则不修改）` : 'sk-...'}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        />
      </div>
      <div className="form-row">
        <label>模型名称</label>
        <input
          className="input"
          value={form.model}
          placeholder="gpt-4o-mini / deepseek-chat / qwen-plus"
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        />
        <div className="mini-label" style={{ marginTop: 4 }}>
          该模型必须支持 Function Calling，否则第 4、5 章会失败——失败会如实显示原因
        </div>
      </div>
      <div className="form-row">
        <label>默认 Temperature</label>
        <div className="slider-row">
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={form.temperature}
            onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
          />
          <span className="num-pill">{form.temperature.toFixed(1)}</span>
        </div>
      </div>
      {msg && (
        <div className={`note ${msg.ok ? '' : 'warn'}`} style={{ marginTop: 6 }}>
          {msg.text}
        </div>
      )}

      <div className="divider" style={{ margin: '16px 0 12px' }} />

      <div className="section-title" style={{ marginTop: 0 }}>
        Embedding 向量模型（RAG 语义检索）
      </div>
      <div className="cfg-row" style={{ paddingTop: 0 }}>
        <div className="cfg-row-main">
          <div className="cfg-row-title">启用向量检索</div>
          <div className="cfg-row-desc">
            关闭时 RAG 只用 BM25 词法匹配；打开后会真实调用 /embeddings 建立向量索引
          </div>
        </div>
        <button
          className={`switch ${emb.enabled ? 'on' : ''}`}
          onClick={() => setEmb({ ...emb, enabled: !emb.enabled })}
          aria-pressed={emb.enabled}
        />
      </div>
      <div className="form-row">
        <label>Base URL（留空沿用上方对话模型地址）</label>
        <input
          className="input"
          value={emb.baseUrl}
          placeholder={form.baseUrl || 'https://api.openai.com/v1'}
          onChange={(e) => setEmb({ ...emb, baseUrl: e.target.value })}
        />
      </div>
      <div className="two-col">
        <div className="form-row">
          <label>API Key（留空沿用上方）</label>
          <input
            className="input"
            type="password"
            value={emb.apiKey}
            placeholder={initial?.embedding?.apiKey ? `已配置：${initial.embedding.apiKey}` : '留空沿用'}
            onChange={(e) => setEmb({ ...emb, apiKey: e.target.value })}
          />
        </div>
        <div className="form-row">
          <label>模型名称</label>
          <input
            className="input"
            value={emb.model}
            placeholder="text-embedding-v4 / text-embedding-3-small"
            onChange={(e) => setEmb({ ...emb, model: e.target.value })}
          />
        </div>
      </div>
      <div className="form-row">
        <label>每批文本数</label>
        <input
          className="input"
          type="number"
          min={1}
          max={64}
          value={emb.batchSize}
          onChange={(e) => setEmb({ ...emb, batchSize: Number(e.target.value) })}
        />
        <div className="mini-label" style={{ marginTop: 4 }}>
          部分服务商单次请求最多 10 条，超出会报错；索引结果会缓存到 data/index/embeddings.json，换模型自动失效
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={probeEmb} disabled={busy}>
          保存并测试向量接口
        </button>
        <span className="mini-label">测试会顺带把缺的分块向量补齐</span>
      </div>
      {embMsg && (
        <div className={`note ${embMsg.ok ? '' : 'warn'}`} style={{ marginTop: 8 }}>
          {embMsg.text}
        </div>
      )}

      <div className="divider" style={{ margin: '16px 0 12px' }} />

      <div className="section-title" style={{ marginTop: 0 }}>
        检索参数
      </div>
      <div className="two-col">
        <div className="form-row">
          <label>分块长度上限（字）</label>
          <input
            className="input"
            type="number"
            min={120}
            max={1200}
            step={20}
            value={ret.chunkSize}
            onChange={(e) => setRet({ ...ret, chunkSize: Number(e.target.value) })}
          />
        </div>
        <div className="form-row">
          <label>向量权重（混合检索）</label>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={ret.vectorWeight}
              onChange={(e) => setRet({ ...ret, vectorWeight: Number(e.target.value) })}
            />
            <span className="num-pill">{ret.vectorWeight.toFixed(1)}</span>
          </div>
        </div>
      </div>
      <div className="note" style={{ marginTop: 4 }}>
        改分块长度会重新切分文档；向量权重只影响「混合」模式，计算方式为 融合分 = 权重 × 向量分 + (1 −
        权重) × 词法分。
      </div>

      <div className="note" style={{ marginTop: 12 }}>
        本项目演示数据为虚构企业与虚构制度。调用外部模型或 MCP 时，问题文本会离开本机，请勿粘贴真实客户信息。
      </div>
    </Modal>
  );
}

export function HealthModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<any>(null);

  const load = async () => setData(await api.health());
  useEffect(() => {
    load();
  }, []);

  return (
    <Modal
      title="系统自检"
      sub="某项能力不可用时，只影响依赖它的章节"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await api.saveConfig({});
              await fetch('/api/demo-data/reset', { method: 'POST' });
              onChanged();
              load();
            }}
          >
            重置演示数据
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      {!data ? (
        <div className="mini-label">检查中…</div>
      ) : (
        <>
          {data.checks.map((c: any) => (
            <div className="health-row" key={c.id}>
              <span className={`dot ${c.ok ? 'ok' : c.optional ? 'warn' : 'bad'}`} style={{ marginTop: 5 }} />
              <div className="grow">
                <div style={{ fontWeight: 550 }}>
                  {c.label}
                  {c.optional && (
                    <span className="mono-tag" style={{ marginLeft: 6 }}>
                      可选
                    </span>
                  )}
                </div>
                <div className="health-detail">{c.detail}</div>
              </div>
            </div>
          ))}
          {data.blocking?.length > 0 && (
            <div className="note warn" style={{ marginTop: 12 }}>
              存在阻塞项：{data.blocking.join('、')}。请先在「模型服务配置」中完成设置。
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export function SkillModal({
  id,
  onClose,
  index,
}: {
  id: string;
  onClose: () => void;
  index?: any;
}) {
  const [skill, setSkill] = useState<any>(null);
  useEffect(() => {
    api.skill(id).then(setSkill).catch(() => setSkill(null));
  }, [id]);

  return (
    <Modal
      title={skill?.name || 'Skill'}
      sub={skill ? `${skill.path} · 元数据 ${skill.indexChars} 字 / 正文 ${skill.bodyChars} 字 · v${skill.version}` : '读取中…'}
      onClose={onClose}
      wide
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          关闭
        </button>
      }
    >
      {skill && (
        <>
          <div className="note" style={{ marginBottom: 12 }}>
            {skill.description}
          </div>

          <div className="section-title" style={{ marginTop: 2 }}>
            Skill 是怎么被加载的
          </div>
          <div className="skill-flow">
            <div className="sf-head">
              <span>三步：索引 → 匹配 → 加载</span>
              <span className="mono-tag">{index?.count ?? 1} 个 Skill 在索引中</span>
            </div>
            <div className="sf-step">
              <span className="sf-no">1</span>
              <div>
                <b>启动时只读索引</b>
                <span className="sf-sub">
                  全部 {index?.count ?? 1} 个 Skill 的元数据合计 {index?.indexChars ?? skill.indexChars} 字常驻内存；
                  所有 SKILL.md 的正文合计 {index?.totalBodyChars ?? skill.bodyChars} 字，此时一个字节都没读
                </span>
              </div>
            </div>
            <div className="sf-arrow">↓ 用户提问后，用问题文本在索引里做关键词打分</div>
            <div className="sf-step">
              <span className="sf-no">2</span>
              <div>
                <b>命中判断</b>
                <span className="sf-sub">
                  命中关键词：{skill.keywords?.join('、') || '—'}；达到阈值才进入第 3 步，否则本次不加载任何正文
                </span>
              </div>
            </div>
            <div className="sf-arrow">↓ 只读命中的这一个</div>
            <div className="sf-step">
              <span className="sf-no">3</span>
              <div>
                <b>读取正文并注入上下文</b>
                <span className="sf-sub">
                  本 Skill 正文 {skill.bodyChars} 字；其余 {(index?.totalBodyChars ?? 0) - skill.bodyChars > 0
                    ? `${(index?.totalBodyChars ?? 0) - skill.bodyChars} 字`
                    : '0 字'}{' '}
                  始终留在磁盘上
                </span>
              </div>
            </div>
          </div>

          <div className="mini-label" style={{ margin: '14px 0 6px' }}>
            SKILL.md 正文（就是上面第 3 步才读取的内容）
          </div>
          <div className="json-view" style={{ fontFamily: 'inherit', fontSize: 12, lineHeight: 1.8, maxHeight: 340, overflowY: 'auto' }}>
            {skill.body}
          </div>
        </>
      )}
    </Modal>
  );
}

export function PromptModal({
  value,
  onSave,
  onClose,
}: {
  value: string;
  onSave: (v: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  return (
    <Modal
      title="System Prompt"
      sub="这段内容会以 system 角色发送，只影响回答方式，不新增能力"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(text);
              onClose();
            }}
          >
            保存
          </button>
        </>
      }
    >
      <textarea
        className="input"
        style={{ minHeight: 160, lineHeight: 1.7, resize: 'vertical' }}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="note" style={{ marginTop: 10 }}>
        提示：可以试着删掉「不得编造未提供的财务数据」，再运行一次，观察输出是否变得更容易夸大。
      </div>
    </Modal>
  );
}

/* ------------------------------ MCP 管理 ------------------------------ */

export function McpModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ id: '', label: '', url: '', token: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => setData(await api.mcpServers().catch(() => null));
  useEffect(() => {
    load();
  }, []);

  const sync = async () => {
    setBusy('all');
    try {
      await api.mcpSync();
      await load();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const test = async (id: string) => {
    setBusy(id);
    try {
      const r = await api.mcpTest(id);
      setMsg(r.ok ? `${id} 连接正常，发现 ${r.server?.toolCount || 0} 个工具` : `${id} 连接失败：${r.server?.error}`);
      await load();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (id: string, enabled: boolean) => {
    await api.mcpToggle(id, enabled);
    await load();
    onChanged();
  };

  const remove = async (id: string) => {
    if (!window.confirm(`确认移除 MCP 服务器 ${id}？`)) return;
    try {
      await api.mcpRemove(id);
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const add = async () => {
    try {
      await api.mcpAdd({
        id: form.id,
        label: form.label || form.id,
        short: form.label || form.id,
        type: 'http',
        url: form.url,
        headers: form.token ? { Authorization: form.token } : {},
      });
      setAdding(false);
      setForm({ id: '', label: '', url: '', token: '' });
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const servers = data?.servers || [];
  const connected = servers.filter((s: any) => s.connected).length;

  return (
    <Modal
      title="MCP 服务器"
      sub={data ? `${connected}/${servers.length} 台已连接 · 共 ${(data.catalog || []).reduce((n: number, g: any) => n + g.tools.length, 0)} 个工具` : '读取中…'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => setAdding(!adding)}>
            {adding ? '取消新增' : '新增服务器'}
          </button>
          <button className="btn btn-ghost" onClick={sync} disabled={busy === 'all'}>
            {busy === 'all' ? '重连中…' : '全部重连'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      {msg && <div className="note" style={{ marginBottom: 10 }}>{msg}</div>}

      {adding && (
        <div className="add-server">
          <div className="two-col">
            <div className="form-row">
              <label>服务器标识（英文，用于工具前缀）</label>
              <input className="input" value={form.id} placeholder="my-mcp" onChange={(e) => setForm({ ...form, id: e.target.value })} />
            </div>
            <div className="form-row">
              <label>显示名称</label>
              <input className="input" value={form.label} placeholder="我的数据服务" onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <label>MCP Endpoint（Streamable HTTP）</label>
            <input className="input" value={form.url} placeholder="https://example.com/mcp" onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </div>
          <div className="form-row">
            <label>Authorization（可选，按服务商要求填写）</label>
            <input className="input" type="password" value={form.token} placeholder="API Key 或 Bearer Token" onChange={(e) => setForm({ ...form, token: e.target.value })} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={add}>
            添加并连接
          </button>
        </div>
      )}

      <div className="mcp-list">
        {servers.map((s: any) => {
          const cat = (data.catalog || []).find((g: any) => g.serverId === s.id);
          const isOpen = open[s.id];
          return (
            <div className={`mcp-card ${s.connected ? '' : 'bad'}`} key={s.id}>
              <div className="mcp-card-head">
                <span className={`dot ${s.connected ? 'ok' : 'bad'}`} style={{ marginTop: 0 }} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="mcp-card-title">
                    {s.label}
                    <span className="mono-tag" style={{ marginLeft: 6 }}>
                      {s.id}
                    </span>
                    <span className="mono-tag" style={{ marginLeft: 4 }}>
                      {s.type === 'stdio' ? 'stdio' : 'http'}
                    </span>
                    {s.serverInfo?.version && (
                      <span className="mono-tag" style={{ marginLeft: 4 }}>
                        v{s.serverInfo.version}
                      </span>
                    )}
                  </div>
                  <div className="mcp-card-sub" title={s.url}>
                    {s.url}
                  </div>
                </div>
                <div className="mcp-card-actions">
                  <button className="cfg-hint-btn" onClick={() => test(s.id)} disabled={busy === s.id}>
                    {busy === s.id ? '连接中…' : '测试'}
                  </button>
                  <button className="cfg-hint-btn" onClick={() => toggle(s.id, !s.enabled)}>
                    {s.enabled ? '停用' : '启用'}
                  </button>
                  {!s.builtin && (
                    <button className="cfg-hint-btn" onClick={() => remove(s.id)}>
                      移除
                    </button>
                  )}
                </div>
              </div>

              <div className="mcp-card-meta">
                <span>{s.connected ? `${s.toolCount} 个工具` : '未连接'}</span>
                {s.protocolVersion && <span>协议 {s.protocolVersion}</span>}
                {s.latencyMs != null && <span>{s.latencyMs}ms</span>}
                <span>{s.transport}</span>
                {!s.enabled && <span className="warn-text">已停用</span>}
                {s.error && <span className="warn-text" title={s.error}>{s.error.slice(0, 46)}</span>}
                {s.connected && (
                  <button className="cfg-hint-btn" style={{ marginLeft: 'auto' }} onClick={() => setOpen({ ...open, [s.id]: !isOpen })}>
                    {isOpen ? '收起工具' : '查看工具'}
                  </button>
                )}
              </div>

              {isOpen && cat && (
                <div className="mcp-card-tools">
                  {cat.tools.map((t: any) => (
                    <div className="mcp-tool-row" key={t.name}>
                      <span className="mono-tag">{t.name}</span>
                      <span className="mcp-tool-desc">{t.description?.slice(0, 110)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {data?.trace?.length > 0 && (
        <>
          <div className="mini-label" style={{ margin: '14px 0 6px' }}>
            最近的协议往返（真实 JSON-RPC，按时间排序，多条服务器混排）
          </div>
          <div className="json-view" style={{ maxHeight: 200 }}>
            {data.trace.slice(-8).map((t: any, i: number) => (
              <div key={i} className="trace-line">
                <span className={`trace-dir ${t.direction === '->' ? 'out' : 'in'}`}>{t.direction}</span>
                <span className="mono-tag">{t.serverId}</span>
                <span className="trace-method">{t.method || (t.id != null ? `#${t.id} 响应` : 'notification')}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/* ------------------------------ 知识库 ------------------------------ */

export function KbModal({ onClose, onReload }: { onClose: () => void; onReload: () => void }) {
  const [kb, setKb] = useState<any>(null);
  const [mode, setMode] = useState<'lexical' | 'vector' | 'hybrid'>('hybrid');
  const [q, setQ] = useState('怎么判断一家公司还不还得起债');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [chunk, setChunk] = useState<any>(null);
  const [hitDetail, setHitDetail] = useState<any>(null);

  const load = async () => setKb(await api.kb());
  useEffect(() => {
    load();
  }, []);

  const search = async () => {
    setBusy(true);
    try {
      const r = await api.search(q, 4, mode);
      setRes(r);
      setHitDetail(r.hits?.[0] || null);
    } catch (e: any) {
      setRes({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  const reindex = async () => {
    setBusy(true);
    try {
      await api.reindex();
      await load();
      onReload();
    } finally {
      setBusy(false);
    }
  };

  const openChunk = async (id: string) => {
    const c = await api.chunk(id);
    setChunk(c);
  };

  const injected = useMemo(() => {
    if (!res?.hits?.length) return '';
    return res.hits.map((h: any, i: number) => `[片段${i + 1}] 来源：${h.source} / ${h.title}\n${h.text}`).join('\n\n');
  }, [res]);

  const emb = kb?.embedding;
  const vec = kb?.vectorIndex;

  return (
    <Modal
      title="知识库：文档 → 分块 → 索引 → 召回 → 注入"
      sub={kb ? `${kb.documents} 篇文档 · ${kb.chunks} 个分块 · ${emb?.ready ? `向量 ${vec?.dim} 维 + BM25` : 'BM25 词法'}` : '读取中…'}
      onClose={onClose}
      xwide
      footer={
        <>
          <button className="btn btn-ghost" onClick={reindex} disabled={busy}>
            {busy ? '处理中…' : '重建索引'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      {kb && (
        <>
          <div className="kb-pipe">
            {kb.pipeline.map((p: any, i: number) => (
              <div className="kb-pipe-step" key={p.step}>
                <span className="kb-pipe-no">{p.step}</span>
                <div>
                  <b>{p.title}</b>
                  <span>{p.text}</span>
                </div>
                {i < kb.pipeline.length - 1 && <span className="kb-pipe-arrow">→</span>}
              </div>
            ))}
          </div>

          <div className="kb-stats">
            <div>
              <span className="kb-stat-k">文档</span>
              <span className="kb-stat-v">{kb.documents}</span>
            </div>
            <div>
              <span className="kb-stat-k">分块</span>
              <span className="kb-stat-v">{kb.chunks}</span>
            </div>
            <div>
              <span className="kb-stat-k">总字数</span>
              <span className="kb-stat-v">{(kb.totalChars / 1000).toFixed(1)}k</span>
            </div>
            <div>
              <span className="kb-stat-k">分块上限</span>
              <span className="kb-stat-v">{kb.chunkSize} 字</span>
            </div>
            <div>
              <span className="kb-stat-k">向量模型</span>
              <span className="kb-stat-v">{emb?.ready ? emb.model : '未配置'}</span>
            </div>
            <div>
              <span className="kb-stat-k">向量覆盖</span>
              <span className="kb-stat-v">
                {vec?.status === 'ready' ? `${vec.covered}/${kb.chunks}` : vec?.status === 'building' ? '构建中' : '—'}
              </span>
            </div>
          </div>

          <div className="kb-grid">
            <div className="kb-pane">
              <div className="kb-pane-head">
                <span>磁盘上的文档（server/knowledge/）</span>
                <span className="mini-label">点击展开分块</span>
              </div>
              <div className="kb-doc-list">
                {(kb.docTree || []).map((d: any) => (
                  <div key={d.docId}>
                    <div className={`kb-doc ${openDoc === d.docId ? 'open' : ''}`} onClick={() => setOpenDoc(openDoc === d.docId ? null : d.docId)}>
                      <span className="kb-doc-caret">{openDoc === d.docId ? '▾' : '▸'}</span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="kb-doc-title">{d.title}</div>
                        <div className="kb-doc-sub">
                          {d.source} · {d.chunkCount} 块 · {(d.bytes / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    </div>
                    {openDoc === d.docId && (
                      <div className="kb-chunk-list">
                        {d.chunks.map((c: any) => (
                          <div className="kb-chunk" key={c.chunkId} onClick={() => openChunk(c.chunkId)}>
                            <span className="mono-tag">{c.chunkId}</span>
                            <span className="grow kb-chunk-title">{c.title}</span>
                            <span className="kb-chunk-meta">
                              {c.length} 字 / {c.tokens} 词素 {c.hasVector ? '· 已向量化' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="kb-pane">
              <div className="kb-pane-head">
                <span>分块内容与向量</span>
                {chunk && <span className="mono-tag">{chunk.chunkId}</span>}
              </div>
              {!chunk ? (
                <div className="note" style={{ margin: 10 }}>
                  在左侧点开任意文档，再点一个分块，这里会显示原文、分词结果与向量片段。
                </div>
              ) : (
                <div className="kb-chunk-detail">
                  <div className="kb-kv">
                    <span>来源</span>
                    <b>
                      {chunk.source} / {chunk.title}
                    </b>
                  </div>
                  <div className="kb-kv">
                    <span>长度</span>
                    <b>
                      {chunk.length} 字 · {chunk.tokens} 个词素
                    </b>
                  </div>
                  <div className="kb-text">{chunk.text}</div>
                  <div className="mini-label" style={{ margin: '8px 0 4px' }}>
                    分词结果（BM25 用，中文按二元组切分）
                  </div>
                  <div className="kb-tokens">
                    {chunk.tokenSample.map((t: string, i: number) => (
                      <span className="kb-token" key={i}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="mini-label" style={{ margin: '8px 0 4px' }}>
                    向量（前 10 维 / 共 {chunk.vectorDim || 0} 维，L2 范数 {chunk.vectorNorm ?? '—'}）
                  </div>
                  {chunk.hasVector ? (
                    <div className="kb-vec">
                      {chunk.vectorPreview.map((v: number, i: number) => (
                        <span key={i} className={v >= 0 ? 'pos' : 'neg'}>
                          {v}
                        </span>
                      ))}
                      <span className="dots">…</span>
                    </div>
                  ) : (
                    <div className="note">该分块尚未向量化（未配置 Embedding 或索引未构建）。</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="kb-search">
            <div className="kb-pane-head">
              <span>检索测试：同一问题，三种召回方式对比</span>
              <span className="mini-label">融合分 = 权重 × 向量分 + (1 − 权重) × 词法分</span>
            </div>
            <div className="kb-search-bar">
              <select className="input kb-select" value={mode} onChange={(e) => setMode(e.target.value as any)}>
                <option value="lexical">仅 BM25 词法</option>
                <option value="vector" disabled={!emb?.ready}>
                  仅向量余弦
                </option>
                <option value="hybrid" disabled={!emb?.ready}>
                  混合
                </option>
              </select>
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入一个问题" />
              <button className="btn btn-primary" onClick={search} disabled={busy}>
                {busy ? '检索中…' : '检索'}
              </button>
            </div>

            {res?.error && <div className="note warn" style={{ margin: 10 }}>{res.error}</div>}

            {res?.hits && (
              <>
                <div className="kb-hit-head">
                  <span>排名</span>
                  <span>分块</span>
                  <span>融合分</span>
                  <span>词法</span>
                  <span>向量</span>
                  <span>词法排名</span>
                  <span>向量排名</span>
                </div>
                {res.hits.map((h: any) => (
                  <div
                    key={h.chunkId}
                    className={`kb-hit ${hitDetail?.chunkId === h.chunkId ? 'on' : ''}`}
                    onClick={() => setHitDetail(h)}
                  >
                    <span className="kb-hit-rank">{h.rank}</span>
                    <span className="kb-hit-id">
                      {h.chunkId}
                      <i>{h.title}</i>
                    </span>
                    <span className="kb-hit-score">{h.score}</span>
                    <span>{h.bm25}</span>
                    <span>{h.vector}</span>
                    <span>{h.rankBm25 ?? '—'}</span>
                    <span>{h.rankVector ?? '—'}</span>
                  </div>
                ))}
                {hitDetail && (
                  <div className="kb-hit-detail">
                    <div className="mini-label">
                      命中片段（{hitDetail.source} / {hitDetail.title}，命中词：{hitDetail.matched?.join('、') || '—'}）
                    </div>
                    <div className="kb-text">{hitDetail.text}</div>
                  </div>
                )}

                <div className="kb-inject">
                  <div className="kb-pane-head">
                    <span>最终拼成 system 消息提交给模型的内容</span>
                    <span className="mono-tag">{injected.length} 字</span>
                  </div>
                  <div className="kb-inject-body">{injected}</div>
                  <div className="note" style={{ margin: '6px 10px 10px' }}>
                    模型参数没有被修改。换一批文档、换一种召回方式，注入内容就会变——这就是「改文档即改依据」。
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

const NODE_INFO: Record<string, { what: string; role: string }> = {
  user: { what: '提出问题的业务人员', role: '只提供自然语言问题，不直接接触任何数据接口。' },
  app: { what: 'Web 应用 / 编排层', role: '接收问题、组装请求、决定是否执行工具、把结果送回模型。它是唯一持有凭据和权限判断的组件。' },
  llm: { what: '大语言模型服务', role: '只处理传入的上下文并生成输出。它不能主动打开数据库、不能主动联网。' },
  prompt_builder: { what: 'Prompt 构建器', role: '把 System Prompt、历史消息、检索片段、Skill 说明拼成本次请求的消息数组。' },
  tool_handler: { what: '工具调用处理器', role: '解析模型给出的结构化请求，校验参数与权限，执行工具，再把结果作为工具消息回传模型。' },
  skill_index: {
    what: 'Skill 索引',
    role: '启动时只读每个 Skill 目录的元数据（名称、适用说明、关键词），正文不读。索引常驻内存，体积很小，可以放很多个 Skill。',
  },
  skill_loader: {
    what: 'Skill 加载器',
    role: '只在问题命中索引后才读取那一个 SKILL.md 的正文，并作为 system 消息注入本次请求。未命中的 Skill 正文始终留在磁盘上。',
  },
  retriever: {
    what: '检索器',
    role: '把问题转成检索式：配置了 Embedding 时同时算词法与向量分并加权融合，未配置时只走 BM25。',
  },
  kb: { what: '演示知识库', role: '磁盘上的虚构制度文档，已切分为带来源的分块并建立索引。改文档即改依据。' },
  mcp_client: { what: 'MCP Client', role: '在应用进程内，负责与 MCP Server 完成握手、能力发现与调用。模型本身不实现 MCP 通信。' },
  mcp_server: { what: 'MCP Server', role: '独立的服务进程，通过 JSON-RPC 声明自己能提供哪些工具，并执行真实查询。' },
};

export function NodeModal({ node, onClose }: { node: ArchNode; onClose: () => void }) {
  const base = node.id.startsWith('tool_') ? node.id.slice(5) : node.id;
  const isMcp = node.id.startsWith('mcp_') && node.id !== 'mcp_client';
  const info =
    NODE_INFO[node.id] ||
    NODE_INFO[base] ||
    (node.id.startsWith('tool_')
      ? {
          what: '工具（由程序实现）',
          role: '模型只能提出调用请求；真正的参数校验、权限判断与数据访问都发生在程序这一侧。',
        }
      : isMcp
        ? {
            what: `MCP Server：${node.label}`,
            role: '远程或本地独立服务，按 MCP 协议声明工具并执行真实查询。应用通过 JSON-RPC 调用它，模型看不到协议细节。',
          }
        : { what: node.label, role: node.sub || '' });

  return (
    <Modal title={node.label} sub={node.sub} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>关闭</button>}>
      <div className="d-row">
        <div className="d-k">这是什么</div>
        <div className="d-v">{info.what}</div>
      </div>
      <div className="d-row">
        <div className="d-k">它负责什么</div>
        <div className="d-v">{info.role}</div>
      </div>
      <div className="d-row">
        <div className="d-k">组件编号</div>
        <div className="d-v" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
          {node.id}
        </div>
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        节点状态完全由后端真实执行事件驱动：运行中会呼吸高亮，成功打勾，失败变红。不存在前端自行播放的假动画。
      </div>
    </Modal>
  );
}
