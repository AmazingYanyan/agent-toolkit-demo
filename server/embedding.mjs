/**
 * Embedding 提供方（OpenAI 兼容 /embeddings 接口）。
 *
 * 这里不假装“内置向量能力”：没有配置模型时 enabled=false，
 * 检索就只能走 BM25 词法匹配，界面上如实标注。
 * 配置后：文本 → 向量 → 余弦相似度；向量结果按 (模型 + 文本) 的哈希缓存到磁盘，
 * 换模型会自动失效，避免旧向量与新模型混用。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { rawConfig, INDEX_DIR } from './config.mjs';

const CACHE_PATH = path.join(INDEX_DIR, 'embeddings.json');

function hash(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

export class Embedder {
  constructor() {
    this.cache = { model: '', dim: 0, vectors: {} };
    this.loaded = false;
    this.lastError = null;
    this.dirty = false;
    this.timer = null;
  }

  cfg() {
    const c = rawConfig().embedding || {};
    const baseUrl = (c.baseUrl || rawConfig().baseUrl || '').replace(/\/+$/, '');
    return {
      enabled: Boolean(c.enabled),
      baseUrl,
      apiKey: c.apiKey || '',
      model: c.model || '',
      dimensions: Number(c.dimensions || 0),
      batchSize: Math.min(64, Math.max(1, Number(c.batchSize || 16))),
    };
  }

  /** 只有开关打开 + 有模型 + 有关键信息才算可用 */
  ready() {
    const c = this.cfg();
    return Boolean(c.enabled && c.model && c.baseUrl && (c.apiKey || /localhost|127\.0\.0\.1/.test(c.baseUrl)));
  }

  status() {
    const c = this.cfg();
    return {
      enabled: c.enabled,
      ready: this.ready(),
      model: c.model || null,
      baseUrl: c.baseUrl || null,
      hasKey: Boolean(c.apiKey),
      dimensions: this.cache.model === c.model ? this.cache.dim : c.dimensions || null,
      cachedVectors: Object.keys(this.cache.vectors || {}).length,
      cacheModel: this.cache.model || null,
      lastError: this.lastError,
      note: this.ready()
        ? `已接入 Embedding 模型 ${c.model}，检索可用向量语义召回`
        : '未配置 Embedding 模型，检索仅使用 BM25 词法匹配',
    };
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(CACHE_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        this.cache = { model: raw.model || '', dim: raw.dim || 0, vectors: raw.vectors || {} };
      }
    } catch {
      this.cache = { model: '', dim: 0, vectors: {} };
    }
  }

  persistSoon() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.persist();
    }, 800);
  }

  persist() {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(INDEX_DIR, { recursive: true });
      fs.writeFileSync(
        CACHE_PATH,
        JSON.stringify({
          model: this.cache.model,
          dim: this.cache.dim,
          updatedAt: new Date().toISOString(),
          vectors: this.cache.vectors,
        }),
        'utf8'
      );
      this.dirty = false;
    } catch {
      /* 缓存写失败不影响检索 */
    }
  }

  /** 换模型即清空旧缓存 */
  ensureModel(model, dim) {
    this.load();
    if (this.cache.model !== model) {
      this.cache = { model, dim: dim || 0, vectors: {} };
      this.dirty = true;
    }
    if (dim && !this.cache.dim) this.cache.dim = dim;
  }

  async post(input) {
    const c = this.cfg();
    if (!c.baseUrl) throw new Error('未配置 Embedding 的 Base URL');
    const body = { model: c.model, input };
    if (c.dimensions > 0) body.dimensions = c.dimensions;
    const headers = { 'Content-Type': 'application/json' };
    if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`;

    let res;
    try {
      res = await fetch(`${c.baseUrl}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
    } catch (err) {
      throw new Error(
        err.name === 'TimeoutError' ? 'Embedding 请求超时（60s）' : `Embedding 网络错误：${err.message}`
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Embedding 接口返回 HTTP ${res.status}：${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const items = data?.data;
    if (!Array.isArray(items) || !items.length) throw new Error('Embedding 接口未返回向量');
    return items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
  }

  /** 批量 embedding，命中缓存的不再请求 */
  async embedBatch(texts, { onProgress } = {}) {
    if (!this.ready()) throw new Error('Embedding 未配置');
    const c = this.cfg();
    this.load();
    this.ensureModel(c.model, c.dimensions);

    const out = new Array(texts.length).fill(null);
    const missing = [];
    texts.forEach((t, i) => {
      const v = this.cache.vectors[hash(`${c.model}::${t}`)];
      if (Array.isArray(v) && v.length) out[i] = v;
      else missing.push(i);
    });

    let batches = 0;
    for (let i = 0; i < missing.length; i += c.batchSize) {
      const slice = missing.slice(i, i + c.batchSize);
      const vectors = await this.post(slice.map((idx) => texts[idx]));
      if (vectors.length !== slice.length) throw new Error('Embedding 返回条数与输入不一致');
      slice.forEach((idx, k) => {
        out[idx] = vectors[k];
        this.cache.vectors[hash(`${c.model}::${texts[idx]}`)] = vectors[k];
      });
      if (!this.cache.dim) this.cache.dim = vectors[0].length;
      batches += 1;
      this.dirty = true;
      onProgress?.(Math.min(missing.length, i + slice.length), missing.length);
      this.persistSoon();
    }
    this.persist();

    return { vectors: out, requested: missing.length, batches, dim: this.cache.dim };
  }

  async embedOne(text) {
    const { vectors, dim } = await this.embedBatch([text]);
    return { vector: vectors[0], dim };
  }

  async probe() {
    const started = Date.now();
    try {
      const { vector, dim } = await this.embedOne('这是一次向量维度测试。');
      this.lastError = null;
      return {
        ok: true,
        model: this.cfg().model,
        dimensions: dim || vector.length,
        latencyMs: Date.now() - started,
        preview: vector.slice(0, 8).map((n) => Number(n.toFixed(4))),
      };
    } catch (err) {
      this.lastError = err.message;
      return { ok: false, reason: err.message };
    }
  }

  clearCache() {
    this.cache = { model: '', dim: 0, vectors: {} };
    this.dirty = true;
    this.persist();
  }
}

export const embedder = new Embedder();

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
