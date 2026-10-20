import fs from 'node:fs';
import path from 'node:path';
import { rawConfig } from './config.mjs';
import { embedder, cosine } from './embedding.mjs';

const KB_DIR = path.join(import.meta.dirname, 'knowledge');

/**
 * 知识库检索：文档 → 分块 → 索引 → 召回 → 注入上下文。
 *
 * 两套索引并存，且都真实执行：
 *   1) BM25 倒排索引（中文二元组切分）—— 不依赖外部服务，永远可用；
 *   2) 向量索引（需要配置 Embedding 模型）—— 余弦相似度，具备语义召回能力。
 * 配置了 Embedding 时默认走混合检索（加权融合），否则自动降级为词法检索，
 * 界面上会明确显示当前实际生效的方式，不会把词法结果说成“语义理解”。
 */

const STOP = new Set([
  '的', '了', '和', '是', '在', '有', '与', '及', '或', '为', '对', '中', '上', '下',
  '什么', '多少', '如何', '是否', '么', '这个', '那个', '以及', '并且', '可以',
]);

export function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const tokens = [];
  const clean = s.replace(/\s+/g, ' ');
  for (const m of clean.matchAll(/[a-z][a-z0-9_.-]*|\d+(?:\.\d+)?%?/g)) {
    tokens.push(m[0]);
  }
  const zh = clean.replace(/[^\u4e00-\u9fa5]+/g, ' ');
  for (const seg of zh.split(' ')) {
    if (!seg) continue;
    for (let i = 0; i < seg.length; i++) {
      if (i + 1 < seg.length) {
        const bi = seg.slice(i, i + 2);
        if (!STOP.has(bi)) tokens.push(bi);
      }
      if (seg.length === 1) tokens.push(seg);
    }
  }
  return tokens;
}

function splitChunks(docText, docId, maxLen = 320) {
  const lines = docText.split(/\r?\n/);
  const chunks = [];
  let title = '未命名';
  let buf = [];
  let heading = '';
  let idx = 0;

  const flush = () => {
    const body = buf.join('\n').trim();
    if (body.length > 0) {
      const sentences = body.split(/(?<=[。；！？])/);
      let cur = '';
      for (const s of sentences) {
        if ((cur + s).length > maxLen && cur) {
          chunks.push({ chunkId: `${docId}-c${idx++}`, title: heading || title, text: cur.trim() });
          cur = s;
        } else {
          cur += s;
        }
      }
      if (cur.trim()) chunks.push({ chunkId: `${docId}-c${idx++}`, title: heading || title, text: cur.trim() });
    }
    buf = [];
  };

  for (const line of lines) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      heading = h[2].trim();
      if (h[1].length === 1) title = heading;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      chunks.push({ chunkId: `${docId}-c${idx++}`, title: heading || title, text: line.replace(/^>\s?/, '').trim() });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return chunks;
}

export class Retriever {
  constructor() {
    this.chunks = [];
    this.docs = [];
    this.df = new Map();
    this.avgdl = 0;
    this.version = 'kb-empty';
    this.vectorState = { status: 'idle', model: null, dim: 0, covered: 0, total: 0, updatedAt: null, error: null };
    this.building = null;
  }

  build() {
    if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });
    const files = fs.readdirSync(KB_DIR).filter((f) => /\.(md|txt)$/i.test(f)).sort();
    const maxLen = Number(rawConfig().retrieval?.chunkSize || 320);
    const chunks = [];
    const docs = [];
    for (const f of files) {
      const docId = f.replace(/\.(md|txt)$/i, '');
      const text = fs.readFileSync(path.join(KB_DIR, f), 'utf8');
      const titleMatch = text.match(/^#\s+(.*)$/m);
      const parts = splitChunks(text, docId, maxLen);
      for (const c of parts) {
        c.docId = docId;
        c.source = f;
        c.tokens = tokenize(`${c.title} ${c.text}`);
        chunks.push(c);
      }
      docs.push({
        docId,
        source: f,
        title: titleMatch ? titleMatch[1].trim() : docId,
        chars: text.length,
        chunkCount: parts.length,
        bytes: Buffer.byteLength(text, 'utf8'),
        updatedAt: fs.statSync(path.join(KB_DIR, f)).mtime.toISOString(),
      });
    }
    this.chunks = chunks;
    this.docs = docs;
    this.df = new Map();
    let totalLen = 0;
    for (const c of chunks) {
      totalLen += c.tokens.length;
      for (const t of new Set(c.tokens)) this.df.set(t, (this.df.get(t) || 0) + 1);
    }
    this.avgdl = chunks.length ? totalLen / chunks.length : 1;
    this.version = `kb-${files.length}docs-${chunks.length}chunks-${maxLen}`;
    this.vectorState = { status: 'idle', model: null, dim: 0, covered: 0, total: chunks.length, updatedAt: null, error: null };
    return this.stats();
  }

  /** 配置变更后重建（文档 / 分块参数） */
  rebuild() {
    this.build();
    if (embedder.ready()) this.buildVectors().catch(() => {});
    return this.stats();
  }

  /**
   * 建立/更新向量索引。已有缓存时只补缺失分块，不重复计费。
   */
  async buildVectors({ force = false } = {}) {
    if (!embedder.ready()) {
      this.vectorState = {
        ...this.vectorState,
        status: 'disabled',
        model: null,
        covered: 0,
        total: this.chunks.length,
        error: null,
      };
      return this.vectorState;
    }
    if (this.building) return this.building;
    const cfg = embedder.cfg();
    const total = this.chunks.length;
    this.vectorState = {
      status: 'building',
      model: cfg.model,
      dim: this.vectorState.dim || 0,
      covered: 0,
      total,
      updatedAt: this.vectorState.updatedAt,
      error: null,
    };
    this.building = (async () => {
      try {
        const res = await embedder.embedBatch(this.chunks.map((c) => c.text), {
          onProgress: (done) => {
            this.vectorState = { ...this.vectorState, covered: done };
          },
        });
        this.chunks.forEach((c, i) => {
          c.vector = res.vectors[i];
        });
        this.vectorState = {
          status: 'ready',
          model: cfg.model,
          dim: res.dim,
          covered: total,
          total,
          requested: res.requested,
          batches: res.batches,
          updatedAt: new Date().toISOString(),
          error: null,
        };
        this.version = `${this.version.replace(/-vec.*$/, '')}-vec${res.dim}`;
      } catch (err) {
        this.vectorState = { ...this.vectorState, status: 'error', error: err.message };
      } finally {
        this.building = null;
      }
      return this.vectorState;
    })();
    return this.building;
  }

  /** 当前实际生效的检索方式 */
  effectiveMode(requested) {
    if (!embedder.ready()) return 'lexical';
    if (this.vectorState.status !== 'ready') return 'lexical';
    if (requested === 'lexical') return 'lexical';
    if (requested === 'vector') return 'vector';
    return 'hybrid';
  }

  stats() {
    const cfg = rawConfig().retrieval || {};
    return {
      documents: this.docs.length,
      chunks: this.chunks.length,
      version: this.version,
      algorithm: 'BM25（中文二元组切分）',
      mode: cfg.mode || 'hybrid',
      vectorWeight: cfg.vectorWeight ?? 0.6,
      chunkSize: cfg.chunkSize || 320,
      totalChars: this.chunks.reduce((n, c) => n + c.text.length, 0),
      embedding: embedder.status(),
      vectorIndex: { ...this.vectorState, total: this.chunks.length },
      files: this.docs.map((d) => d.source),
    };
  }

  /** 文档树：文档 → 分块，供知识库面板逐层展开 */
  documents() {
    return this.docs.map((d) => ({
      ...d,
      chunks: this.chunks
        .filter((c) => c.docId === d.docId)
        .map((c) => ({
          chunkId: c.chunkId,
          title: c.title,
          length: c.text.length,
          tokens: c.tokens.length,
          hasVector: Boolean(c.vector && c.vector.length),
          preview: c.text.slice(0, 90),
        })),
    }));
  }

  chunkDetail(chunkId) {
    const c = this.chunks.find((x) => x.chunkId === chunkId);
    if (!c) return null;
    return {
      chunkId: c.chunkId,
      docId: c.docId,
      source: c.source,
      title: c.title,
      text: c.text,
      length: c.text.length,
      tokens: c.tokens.length,
      tokenSample: [...new Set(c.tokens)].slice(0, 24),
      hasVector: Boolean(c.vector && c.vector.length),
      vectorDim: c.vector?.length || 0,
      vectorPreview: (c.vector || []).slice(0, 10).map((n) => Number(n.toFixed(5))),
      vectorNorm: c.vector
        ? Number(Math.sqrt(c.vector.reduce((s, v) => s + v * v, 0)).toFixed(4))
        : null,
    };
  }

  /** 纯 BM25 打分（返回全部有分的分块，已排序） */
  bm25All(query) {
    const qTokens = [...new Set(tokenize(query))];
    if (!qTokens.length) return [];
    const N = this.chunks.length || 1;
    const k1 = 1.5;
    const b = 0.75;
    const scored = [];
    for (const c of this.chunks) {
      const tf = new Map();
      for (const t of c.tokens) tf.set(t, (tf.get(t) || 0) + 1);
      let score = 0;
      const matched = [];
      for (const q of qTokens) {
        const f = tf.get(q) || 0;
        if (!f) continue;
        matched.push(q);
        const n = this.df.get(q) || 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        const denom = f + k1 * (1 - b + (b * c.tokens.length) / (this.avgdl || 1));
        score += idf * ((f * (k1 + 1)) / denom);
      }
      if (score > 0) scored.push({ chunk: c, score, matched });
    }
    scored.sort((a, b2) => b2.score - a.score);
    return scored;
  }

  async search(query, options = {}) {
    const cfg = rawConfig().retrieval || {};
    const topK = Number(options.topK || cfg.topK || 4);
    if (!this.chunks.length) this.build();

    const requested = options.mode || cfg.mode || 'hybrid';
    const mode = this.effectiveMode(requested);

    const bm25 = this.bm25All(query);
    const bm25Max = bm25[0]?.score || 0;
    const bm25Rank = new Map(bm25.map((r, i) => [r.chunk.chunkId, i + 1]));

    let vecAll = [];
    let queryVector = null;
    if (mode !== 'lexical') {
      if (this.vectorState.status !== 'ready') await this.buildVectors();
      if (this.vectorState.status === 'ready') {
        try {
          const emb = await embedder.embedOne(query);
          queryVector = emb.vector;
          vecAll = this.chunks
            .filter((c) => c.vector && c.vector.length)
            .map((c) => ({ chunk: c, score: cosine(queryVector, c.vector) }))
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score);
        } catch (err) {
          this.vectorState = { ...this.vectorState, status: 'error', error: err.message };
        }
      }
    }
    const vecMax = vecAll[0]?.score || 0;
    const vecRank = new Map(vecAll.map((r, i) => [r.chunk.chunkId, i + 1]));
    const vecMap = new Map(vecAll.map((r) => [r.chunk.chunkId, r.score]));

    const w = Number(cfg.vectorWeight ?? 0.6);
    const candidates = new Map();
    for (const r of bm25) candidates.set(r.chunk.chunkId, { chunk: r.chunk, bm25: r.score, matched: r.matched });
    for (const r of vecAll) {
      if (!candidates.has(r.chunk.chunkId)) candidates.set(r.chunk.chunkId, { chunk: r.chunk, bm25: 0, matched: [] });
    }

    const hits = [...candidates.values()].map((c) => {
      const bn = bm25Max ? c.bm25 / bm25Max : 0;
      const vn = vecMax ? (vecMap.get(c.chunk.chunkId) || 0) / vecMax : 0;
      const score =
        mode === 'lexical' ? bn : mode === 'vector' ? vn : w * vn + (1 - w) * bn;
      return {
        chunkId: c.chunk.chunkId,
        docId: c.chunk.docId,
        title: c.chunk.title,
        text: c.chunk.text,
        source: c.chunk.source,
        length: c.chunk.text.length,
        matched: c.matched,
        bm25: Math.round(c.bm25 * 1000) / 1000,
        bm25Norm: Math.round(bn * 1000) / 1000,
        vector: Math.round((vecMap.get(c.chunk.chunkId) || 0) * 1000) / 1000,
        vectorNorm: Math.round(vn * 1000) / 1000,
        rankBm25: bm25Rank.get(c.chunk.chunkId) || null,
        rankVector: vecRank.get(c.chunk.chunkId) || null,
        score: Math.round(score * 1000) / 1000,
      };
    });

    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, topK);
    return top.map((h, i) => ({ ...h, rank: i + 1 }));
  }

  /** 兼容旧调用：只要片段 */
  searchSimple(query, topK = 4) {
    const bm25 = this.bm25All(query).slice(0, topK);
    return bm25.map((r) => ({
      chunkId: r.chunk.chunkId,
      docId: r.chunk.docId,
      title: r.chunk.title,
      text: r.chunk.text,
      source: r.chunk.source,
      score: Math.round(r.score * 1000) / 1000,
    }));
  }

  addDocument(filename, content) {
    const safe = filename.replace(/[^\w\u4e00-\u9fa5.-]/g, '_');
    const target = path.join(KB_DIR, safe.endsWith('.md') ? safe : `${safe}.md`);
    fs.writeFileSync(target, content, 'utf8');
    this.build();
    if (embedder.ready()) this.buildVectors().catch(() => {});
    return this.stats();
  }

  removeDocument(docId) {
    const doc = this.docs.find((d) => d.docId === docId);
    if (!doc) throw new Error('文档不存在');
    fs.unlinkSync(path.join(KB_DIR, doc.source));
    this.build();
    if (embedder.ready()) this.buildVectors().catch(() => {});
    return this.stats();
  }
}

export const retriever = new Retriever();
