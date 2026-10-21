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

/** 演示用的示例参数：让「试跑脚本」一键就能看到真实输出 */
const DEMO_ARGS: Record<string, any> = {
  'calculate_ratios.py': { assets: 1000, liabilities: 750, revenue_current: 800, revenue_prior: 1000, ocf: -100 },
  'validate_data.py': { assets: 1000, liabilities: 750, revenue_current: 800, revenue_prior: 1000, ocf: -100 },
  'check_clause_coverage.py': { present: 'party,payment,breach', contract_type: 'purchase' },
};

export function SkillModal({
  id,
  onClose,
  index,
}: {
  id: string;
  onClose: () => void;
  index?: any;
}) {
  const [pkg, setPkg] = useState<any>(null);
  const [sel, setSel] = useState('SKILL.md');
  const [file, setFile] = useState<any>(null);
  const [argsText, setArgsText] = useState('{}');
  const [runOut, setRunOut] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [showSrc, setShowSrc] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .skill(id)
      .then((p) => {
        setPkg(p);
        setSel('SKILL.md');
      })
      .catch(() => setPkg(null));
  }, [id]);

  const scriptOf = useMemo(() => {
    const m: Record<string, any> = {};
    for (const s of pkg?.scripts || []) m[s.path] = s;
    return m;
  }, [pkg]);

  useEffect(() => {
    if (!pkg) return;
    setRunOut(null);
    setShowSrc(false);
    setErr(null);
    if (sel === 'SKILL.md') {
      setFile({ path: 'SKILL.md', text: pkg.instruction, chars: pkg.instructionChars, humanOnly: false });
      return;
    }
    const s = scriptOf[sel];
    if (s) {
      setArgsText(JSON.stringify(DEMO_ARGS[s.name] || {}, null, 1));
      api.skillSource(id, sel).then(setFile).catch(() => setFile(null));
      return;
    }
    api.skillResource(id, sel).then(setFile).catch(() => setFile(null));
  }, [sel, pkg, id, scriptOf]);

  const activeScript = scriptOf[sel];

  const runIt = async () => {
    if (!activeScript) return;
    setBusy(true);
    setErr(null);
    try {
      const args = JSON.parse(argsText || '{}');
      setRunOut(await api.skillRun(id, activeScript.name, args));
    } catch (e: any) {
      setErr(e.message || '执行失败');
    } finally {
      setBusy(false);
    }
  };

  const total = pkg?.totals || {};

  return (
    <Modal
      title={pkg?.name || 'Skill'}
      sub={
        pkg
          ? `${pkg.path} · v${pkg.version} · 索引 ${index?.indexChars ?? pkg.indexChars} 字 / 能力包 ${total.packageChars || 0} 字`
          : '读取中…'
      }
      onClose={onClose}
      xwide
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          关闭
        </button>
      }
    >
      {pkg && (
        <>
          <div className="note" style={{ marginBottom: 12 }}>
            {pkg.description}
          </div>

          <div className="pkg-stats">
            <div className="pkg-stat">
              <span>索引（常驻）</span>
              <b>{index?.indexChars ?? pkg.indexChars} 字</b>
            </div>
            <div className="pkg-stat">
              <span>主指令 SKILL.md</span>
              <b>{total.instructionChars} 字</b>
            </div>
            <div className="pkg-stat">
              <span>references 合计</span>
              <b>{total.referenceChars} 字</b>
            </div>
            <div className="pkg-stat">
              <span>scripts 源码</span>
              <b>{total.scriptChars} 字</b>
            </div>
            <div className="pkg-stat">
              <span>assets</span>
              <b>{total.assetChars} 字</b>
            </div>
            <div className="pkg-stat accent">
              <span>全量预载</span>
              <b>{total.packageChars} 字</b>
            </div>
          </div>

          <div className="skill-flow" style={{ marginBottom: 14 }}>
            <div className="sf-head">
              <span>渐进式披露：索引 → 主指令 → 按需取用</span>
              <span className="mono-tag">4 步</span>
            </div>
            <div className="sf-step">
              <span className="sf-no">1</span>
              <div>
                <b>只读文件头</b>
                <span className="sf-sub">
                  {index?.count ?? 1} 个 Skill 的元数据合计 {index?.indexChars ?? pkg.indexChars} 字进索引；正文一个字节都没读
                </span>
              </div>
            </div>
            <div className="sf-arrow">↓ 用问题文本在索引里打分，达到阈值才继续</div>
            <div className="sf-step">
              <span className="sf-no">2</span>
              <div>
                <b>加载主指令</b>
                <span className="sf-sub">{total.instructionChars} 字。它只是入口与路由，不是全部方法论</span>
              </div>
            </div>
            <div className="sf-arrow">↓ 主指令里写明「什么情况下读哪份、跑哪个」</div>
            <div className="sf-step">
              <span className="sf-no">3</span>
              <div>
                <b>按需读资料</b>
                <span className="sf-sub">
                  {pkg.references?.length || 0} 份 reference 共 {total.referenceChars} 字，只有模型主动请求的那一份会进上下文
                </span>
              </div>
            </div>
            <div className="sf-arrow">↓ 需要确定性计算时</div>
            <div className="sf-step">
              <span className="sf-no">4</span>
              <div>
                <b>按需跑脚本</b>
                <span className="sf-sub">
                  {pkg.scripts?.length || 0} 个脚本共 {total.scriptChars} 字源码；模型只拿到标准输出，源码不进上下文
                </span>
              </div>
            </div>
          </div>

          <div className="pkg-explorer">
            <div className="pkg-side">
              <button className={`pkg-file ${sel === 'SKILL.md' ? 'on' : ''}`} onClick={() => setSel('SKILL.md')}>
                <span className="pkg-file-name">SKILL.md</span>
                <span className="pkg-file-tag on">主指令</span>
              </button>

              <div className="pkg-side-group">
                <div className="pkg-side-title">
                  references/ <span>{pkg.references?.length || 0}</span>
                </div>
                {(pkg.references || []).map((r: any) => (
                  <button
                    key={r.path}
                    className={`pkg-file ${sel === r.path ? 'on' : ''}`}
                    onClick={() => setSel(r.path)}
                  >
                    <span className="pkg-file-name">{r.path.replace('references/', '')}</span>
                    <span className="pkg-file-chars">{r.chars}</span>
                  </button>
                ))}
              </div>

              <div className="pkg-side-group">
                <div className="pkg-side-title">
                  scripts/ <span>{pkg.scripts?.length || 0}</span>
                </div>
                {(pkg.scripts || []).map((s: any) => (
                  <button
                    key={s.path}
                    className={`pkg-file ${sel === s.path ? 'on' : ''}`}
                    onClick={() => setSel(s.path)}
                  >
                    <span className="pkg-file-name">{s.name}</span>
                    <span className="pkg-file-tag run">只执行</span>
                  </button>
                ))}
              </div>

              <div className="pkg-side-group">
                <div className="pkg-side-title">
                  assets/ <span>{pkg.assets?.length || 0}</span>
                </div>
                {(pkg.assets || []).map((a: any) => (
                  <button
                    key={a.path}
                    className={`pkg-file ${sel === a.path ? 'on' : ''}`}
                    onClick={() => setSel(a.path)}
                  >
                    <span className="pkg-file-name">{a.path.replace('assets/', '')}</span>
                    <span className="pkg-file-chars">{a.chars}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pkg-main">
              <div className="pkg-main-head">
                <span className="pkg-main-path">{sel}</span>
                <span className="pkg-main-meta">{file?.chars ?? 0} 字</span>
                {file?.humanOnly && <span className="mono-tag">界面查看 · 模型不读</span>}
              </div>

              {activeScript && (
                <div className="pkg-run">
                  <div className="pkg-run-head">
                    <b>{activeScript.title}</b>
                    <span className="pkg-run-meta">
                      超时 {activeScript.timeoutMs}ms · 网络 {activeScript.network ? '开启' : '关闭'} · 副作用{' '}
                      {activeScript.sideEffect}
                    </span>
                  </div>
                  <div className="pkg-run-sub">{activeScript.when}</div>
                  <div className="pkg-run-args">
                    <span className="mini-label">参数（按 args schema 校验）</span>
                    <textarea
                      className="input mono"
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                      spellCheck={false}
                      style={{ minHeight: 92, fontSize: 11 }}
                    />
                  </div>
                  <div className="pkg-run-actions">
                    <button className="btn btn-primary btn-sm" onClick={runIt} disabled={busy}>
                      {busy ? '执行中…' : '运行脚本'}
                    </button>
                    <span className="pkg-run-hint">
                      走的是运行时同一条执行链路：白名单 + 参数校验 + 超时 + 最小环境
                    </span>
                  </div>
                  {err && <div className="note warn">{err}</div>}
                  {runOut && (
                    <div className="pkg-run-out">
                      <div className="pkg-run-out-head">
                        <span>
                          退出码 <b>{runOut.exitCode}</b>
                        </span>
                        <span>{runOut.durationMs} ms</span>
                        <span>
                          源码 {runOut.scriptChars} 字未进上下文 / 输出 {runOut.outputChars} 字回传
                        </span>
                      </div>
                      <pre className="json-view">{runOut.stdout || runOut.stderr}</pre>
                    </div>
                  )}

                  <div className="pkg-src">
                    <button className="cfg-hint-btn" onClick={() => setShowSrc(!showSrc)}>
                      {showSrc ? '收起源码' : '查看脚本源码（仅界面可见，模型不读）'}
                    </button>
                    {showSrc && file?.text && <pre className="json-view pkg-file-view">{file.text}</pre>}
                  </div>
                </div>
              )}

              {!activeScript && file && (
                <pre className="json-view pkg-file-view">{file.text}</pre>
              )}
              {!activeScript && !file && <div className="note">读取中…</div>}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

/** 「本次实际发送给 LLM 的完整工具 Schema」面板 */
export function ToolSchemaModal({
  cfg,
  lastPromptEvent,
  onClose,
}: {
  cfg: any;
  lastPromptEvent: any;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [tab, setTab] = useState<'tools' | 'body' | 'explain'>('tools');
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 预览用的配置必须用真实字段名，后端直接读 cfg.functionCalling / cfg.tools
  const key = JSON.stringify({
    functionCalling: cfg.functionCalling,
    tools: cfg.tools,
    mcpMode: cfg.mcpMode,
    skill: cfg.skills,
    skillRefs: cfg.skillRefs,
    skillScripts: cfg.skillScripts,
    agentMode: cfg.agentMode,
    systemPrompt: { enabled: cfg.systemPrompt?.enabled, text: cfg.systemPrompt?.text },
    temperature: cfg.temperature,
  });

  useEffect(() => {
    let alive = true;
    setErr(null);
    api
      .toolSchema(JSON.parse(key))
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [key]);

  const actual = lastPromptEvent?.payload || null;
  const defs: any[] = actual?.toolsSchema || preview?.defs || [];
  const body: any = actual?.requestBody || preview?.body || null;
  const isActual = Boolean(actual?.toolsSchema);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal
      title="本次实际发送给 LLM 的工具定义"
      sub={
        isActual
          ? '来源：本次运行的「构建模型请求」事件，就是请求体里真实的 tools 字段'
          : '来源：按当前能力配置即时预览（尚未运行）。点「运行」后这里会换成实际发出的那一份'
      }
      onClose={onClose}
      xwide
      footer={
        <>
          <span className="mini-label" style={{ marginRight: 'auto' }}>
            工具 {defs.length} 个 · schema {JSON.stringify(defs).length} 字 · 请求体{' '}
            {body ? JSON.stringify(body).length : 0} 字
          </span>
          <button className="btn btn-ghost" onClick={() => copy(JSON.stringify(defs, null, 2))}>
            {copied ? '已复制' : '复制 tools JSON'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'tools' ? 'on' : ''} onClick={() => setTab('tools')}>
          工具清单（{defs.length}）
        </button>
        <button className={tab === 'body' ? 'on' : ''} onClick={() => setTab('body')}>
          完整请求体
        </button>
        <button className={tab === 'explain' ? 'on' : ''} onClick={() => setTab('explain')}>
          这说明什么
        </button>
      </div>

      {err && <div className="note warn">{err}</div>}

      {tab === 'explain' && (
        <div className="schema-explain">
          <div className="se-item">
            <b>工具没有装进模型里</b>
            <span>
              模型权重里没有任何一个工具。每一次请求，应用都把下面这份 JSON 放在 <code>tools</code> 字段里一起发出去；
              模型只是在这次请求给定的清单里，决定要不要发起调用。
            </span>
          </div>
          <div className="se-item">
            <b>清单是每次请求重新递给它的</b>
            <span>
              所以「这次勾了哪些工具」直接决定「模型这次能做什么」。不勾，模型就只能凭已有参数回答；勾了，它才有资格提请求。
            </span>
          </div>
          <div className="se-item">
            <b>提请求 ≠ 会执行</b>
            <span>
              模型输出只是 <code>tool_calls</code> 这一段结构化文本。真正的执行发生在应用侧：权限校验、参数校验、
              选择本地函数还是 MCP Server，全部由应用决定。
            </span>
          </div>
          <div className="se-item">
            <b>schema 决定了模型的「理解上限」</b>
            <span>
              <code>description</code> 写得含糊，模型就会调错；<code>parameters</code> 没写清楚枚举与必填，模型就会给错参数。
              工具好不好用，一半在实现，一半在这段说明。
            </span>
          </div>
          <div className="se-item">
            <b>为什么 schema 也占上下文</b>
            <span>
              这份 JSON 会随请求一起进入模型的输入。工具越多、说明越长，占用的输入 token 越多——
              这也是为什么 MCP 场景下要控制工具数量，而不是一次性挂上几十个。
            </span>
          </div>
          {preview?.skillBlocked && <div className="note warn">{preview.skillBlocked}</div>}
        </div>
      )}

      {tab === 'tools' && (
        <>
          {!defs.length ? (
            <div className="note">
              {preview?.modeNote ? (
                <>
                  {preview.modeNote}
                  <br />
                  可用工具：{(preview.availableTools || []).join('、') || '无'}
                </>
              ) : (
                <>
                  本次请求不带 <code>tools</code> 参数。模型拿不到任何工具定义，只能凭已有参数回答。
                  <br />
                  打开「工具调用 Function Calling」并勾选工具后，再回来这里就能看到真实的清单。
                </>
              )}
            </div>
          ) : (
            <div className="schema-tools">
              {defs.map((d: any) => {
                const name = d.function?.name || '';
                const open = openTool === name;
                return (
                  <div className={`schema-tool ${open ? 'open' : ''}`} key={name}>
                    <button className="schema-tool-head" onClick={() => setOpenTool(open ? null : name)}>
                      <span className="schema-tool-name">{name}</span>
                      <span className="schema-tool-desc">{d.function?.description?.slice(0, 90)}</span>
                      <span className="schema-tool-toggle">{open ? '−' : '+'}</span>
                    </button>
                    {open && (
                      <pre className="json-view">{JSON.stringify(d.function?.parameters, null, 2)}</pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="mini-label" style={{ margin: '14px 0 6px' }}>
            完整 tools 数组（就是请求体里那一段）
          </div>
          <pre className="json-view schema-json">{JSON.stringify(defs, null, 2)}</pre>
        </>
      )}

      {tab === 'body' && (
        <>
          <div className="note" style={{ marginBottom: 8 }}>
            {isActual
              ? '这是本次运行真实 POST 给 /chat/completions 的请求体。messages 里能看到上下文是怎么拼出来的。'
              : '这是按当前配置组装出的请求体预览，消息内容用占位符代替。'}
          </div>
          <pre className="json-view schema-json">{JSON.stringify(body, null, 2)}</pre>
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
