import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SKILL_DIR = path.join(import.meta.dirname, 'skills');
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_RESOURCE_DEPTH = 2;
const DEFAULT_SCRIPT_TIMEOUT = 5000;
const MAX_OUTPUT_CHARS = 12000;

/**
 * Skill 能力包加载器。
 *
 * 一个 Skill 不是一段 Prompt，而是一个目录：
 *   SKILL.md            主指令（路由入口）
 *   manifest.json       资源清单，同时也是「可读 / 可执行」白名单
 *   references/*.md     方法论，按需读取（渐进式披露）
 *   scripts/*.py        确定性程序，受控执行，只回传输出、不读源码
 *   assets/*            模板与静态资源，生成交付物时才读
 *
 * 三件事严格分开：
 *   1) 索引：只读 frontmatter（真实只读到第一个 --- 结束为止），正文留在磁盘
 *   2) 加载：命中才读 SKILL.md 正文
 *   3) 按需：references / scripts / assets 只有在模型主动请求时才触碰
 */

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

/**
 * 只读文件头部直到 frontmatter 结束，用于建立索引。
 * 这里刻意不在索引阶段读全文——否则「正文未读」就是一句空话。
 */
function readFrontmatter(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const chunks = [];
    let pos = 0;
    while (pos < MAX_METADATA_BYTES) {
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      chunks.push(buf.subarray(0, n));
      const text = Buffer.concat(chunks).toString('utf8');
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (m) return { raw: m[1], bytesRead: pos };
      // 头部没有 frontmatter 时，读满第一块就停
      if (pos >= 4096 && !text.startsWith('---')) return { raw: '', bytesRead: pos };
    }
    return { raw: Buffer.concat(chunks).toString('utf8'), bytesRead: pos };
  } finally {
    fs.closeSync(fd);
  }
}

function parseMeta(raw) {
  const meta = {};
  for (const line of raw.split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return meta;
}

function parseKeywords(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(/[,，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 目录与清单
// ---------------------------------------------------------------------------

function skillDir(id) {
  return path.join(SKILL_DIR, id);
}

function readManifest(id) {
  const file = path.join(skillDir(id), 'manifest.json');
  if (!fs.existsSync(file)) {
    return { references: [], scripts: [], assets: [] };
  }
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      references: Array.isArray(json.references) ? json.references : [],
      scripts: Array.isArray(json.scripts) ? json.scripts : [],
      assets: Array.isArray(json.assets) ? json.assets : [],
    };
  } catch {
    return { references: [], scripts: [], assets: [] };
  }
}

/** 安全解析包内相对路径：禁止越界、禁止绝对路径 */
function safeResolve(id, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error('资源路径不能为空');
  }
  const clean = relPath.replace(/^\.\//, '').trim();
  if (clean.includes('..') || path.isAbsolute(clean)) {
    throw new Error(`非法的资源路径：${relPath}`);
  }
  const base = skillDir(id);
  const full = path.resolve(base, clean);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`资源路径越界：${relPath}`);
  }
  return { clean, full };
}

function fileChars(file) {
  try {
    return fs.readFileSync(file, 'utf8').length;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 索引 / 匹配 / 加载
// ---------------------------------------------------------------------------

/** 索引视图：只含元数据，正文一个字节都没读 */
export function skillIndex() {
  if (!fs.existsSync(SKILL_DIR)) {
    return { count: 0, indexChars: 0, metadataBytesRead: 0, items: [] };
  }
  const out = [];
  let metadataBytesRead = 0;
  for (const dir of fs.readdirSync(SKILL_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = path.join(SKILL_DIR, dir.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const { raw, bytesRead } = readFrontmatter(file);
    metadataBytesRead += bytesRead;
    const meta = parseMeta(raw);
    const name = meta.name || dir.name;
    const description = meta.description || '';
    const keywords = parseKeywords(meta.keywords);
    const manifest = readManifest(dir.name);
    out.push({
      id: dir.name,
      name,
      description,
      keywords,
      version: meta.version || '—',
      author: meta.author || '—',
      indexChars: name.length + description.length + keywords.join('').length,
      resources: {
        references: manifest.references.length,
        scripts: manifest.scripts.length,
        assets: manifest.assets.length,
      },
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    count: out.length,
    indexChars: out.reduce((n, s) => n + s.indexChars, 0),
    metadataBytesRead,
    items: out,
  };
}

export function listSkills() {
  return skillIndex().items.map((item) => {
    const file = path.join(skillDir(item.id), 'SKILL.md');
    return {
      ...item,
      path: `server/skills/${item.id}/SKILL.md`,
      bytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
      // 注意：bodyChars 只用于展示「全量预载需要多少」，索引阶段并没有读正文
      bodyChars: fileChars(file),
      hasManifest: fs.existsSync(path.join(skillDir(item.id), 'manifest.json')),
    };
  });
}

/**
 * 多 Skill 选择策略。
 *
 *   ids 为空 → 不加载任何 Skill（界面没勾就等于没选）
 *   mode = 'auto' → 在勾选的 Skill 里按关键词打分，达到阈值的**全部**加载（0 个 / 1 个 / 多个都可能）
 *   mode = 'all'  → 勾选的全部加载，分数只用于展示
 *
 * 返回打分明细与最终入选列表，前端据此展示「为什么是这几个」。
 */
export function matchSkills(question, ids = [], { mode = 'auto', threshold = 2 } = {}) {
  const index = skillIndex();
  const pool = index.items.filter((s) => ids.includes(s.id));
  const q = String(question || '');

  const scored = pool
    .map((item) => {
      const hits = item.keywords.filter((k) => k && q.includes(k));
      let score = hits.length * 2;
      if (q.includes(item.name)) score += 3;
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        score,
        hits,
        keywords: item.keywords,
        matched: score >= threshold,
      };
    })
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  const selected = mode === 'all' ? scored : scored.filter((s) => s.matched);

  return {
    mode,
    threshold,
    scanned: index.count,
    candidates: pool.length,
    scored,
    selected,
    selectedIds: selected.map((s) => s.id),
  };
}

/** 已命中的 Skill：读取 SKILL.md 正文，并挂载资源清单（资源内容仍未读） */
export function loadSkill(id) {
  const file = path.join(skillDir(id), 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  const body = (m ? m[1] : raw).trim();
  const index = skillIndex();
  const item = index.items.find((s) => s.id === id);

  return {
    id,
    name: item?.name || id,
    description: item?.description || '',
    version: item?.version || '—',
    keywords: item?.keywords || [],
    path: `server/skills/${id}/SKILL.md`,
    indexChars: item?.indexChars || 0,
    instructionChars: body.length,
    instruction: body,
    loadedAt: new Date().toISOString(),
  };
}

/**
 * 能力包视图：目录树 + 每个资源的体积与触发条件。
 * 这是「渐进式披露」的可视化底稿——注意这里只 stat 字数，不把内容放进上下文。
 */
export function skillPackage(id) {
  if (!fs.existsSync(skillDir(id))) return null;
  const skill = loadSkill(id);
  if (!skill) return null;
  const manifest = readManifest(id);

  const references = manifest.references.map((r) => {
    const { full } = safeResolve(id, r.path);
    return {
      kind: 'reference',
      path: r.path,
      title: r.title || r.path,
      when: r.when || '',
      triggers: r.triggers || [],
      seeAlso: r.seeAlso || [],
      chars: fileChars(full),
      exists: fs.existsSync(full),
      status: 'unloaded',
    };
  });

  const scripts = manifest.scripts.map((s) => {
    const rel = `scripts/${s.name}`;
    const { full } = safeResolve(id, rel);
    return {
      kind: 'script',
      path: rel,
      name: s.name,
      title: s.title || s.name,
      when: s.when || '',
      argsSchema: s.args || { type: 'object', properties: {} },
      timeoutMs: s.timeoutMs || DEFAULT_SCRIPT_TIMEOUT,
      network: Boolean(s.network),
      sideEffect: s.sideEffect || 'none',
      outputFormat: s.outputFormat || '',
      chars: fileChars(full),
      exists: fs.existsSync(full),
      status: 'not-run',
    };
  });

  const assets = manifest.assets.map((a) => {
    const { full } = safeResolve(id, a.path);
    return {
      kind: 'asset',
      path: a.path,
      title: a.title || a.path,
      when: a.when || '',
      chars: fileChars(full),
      exists: fs.existsSync(full),
      status: 'unloaded',
    };
  });

  const instructionChars = skill.instructionChars;
  const referenceChars = references.reduce((n, r) => n + (r.chars || 0), 0);
  const scriptChars = scripts.reduce((n, s) => n + (s.chars || 0), 0);
  const assetChars = assets.reduce((n, a) => n + (a.chars || 0), 0);

  return {
    ...skill,
    references,
    scripts,
    assets,
    totals: {
      instructionChars,
      referenceChars,
      scriptChars,
      assetChars,
      // 全量预载 = 主指令 + 所有参考 + 所有脚本源码 + 所有资产
      packageChars: instructionChars + referenceChars + scriptChars + assetChars,
      // 最小加载 = 只有主指令（索引另计）
      minChars: instructionChars,
    },
  };
}

// ---------------------------------------------------------------------------
// 按需读取 reference（受控）
// ---------------------------------------------------------------------------

/** 资源白名单：references 与 assets 都可读，scripts 不可读（只可执行） */
function findReadable(id, relPath) {
  const manifest = readManifest(id);
  const clean = String(relPath || '').replace(/^\.\//, '').trim();
  const hit =
    manifest.references.find((r) => r.path === clean) || manifest.assets.find((a) => a.path === clean);
  return hit || null;
}

export function readResource(id, relPath, depth = 1, reason = '') {
  if (depth > MAX_RESOURCE_DEPTH) {
    throw new Error(`资源读取层级已超过上限 ${MAX_RESOURCE_DEPTH} 层，请勿继续嵌套读取`);
  }
  const entry = findReadable(id, relPath);
  if (!entry) {
    const manifest = readManifest(id);
    const list = [...manifest.references, ...manifest.assets].map((x) => x.path);
    throw new Error(
      `资源未登记在白名单中：${relPath}。本 Skill 允许读取的只有：${list.join('、') || '（无）'}`
    );
  }
  const { clean, full } = safeResolve(id, relPath);
  if (!fs.existsSync(full)) throw new Error(`资源文件不存在：${clean}`);

  const text = fs.readFileSync(full, 'utf8');
  return {
    path: clean,
    title: entry.title || clean,
    when: entry.when || '',
    seeAlso: entry.seeAlso || [],
    depth,
    chars: text.length,
    text,
    reason,
    readAt: new Date().toISOString(),
  };
}

/** 供工具定义使用：只暴露标题与体积，不暴露内容 */
export function resourceCatalog(id) {
  const manifest = readManifest(id);
  return {
    references: manifest.references.map((r) => ({
      path: r.path,
      title: r.title || r.path,
      when: r.when || '',
      chars: fileChars(path.join(skillDir(id), r.path)),
    })),
    scripts: manifest.scripts.map((s) => ({
      name: s.name,
      title: s.title || s.name,
      when: s.when || '',
      args: s.args || { type: 'object', properties: {} },
      outputFormat: s.outputFormat || '',
      timeoutMs: s.timeoutMs || DEFAULT_SCRIPT_TIMEOUT,
    })),
    assets: manifest.assets.map((a) => ({
      path: a.path,
      title: a.title || a.path,
      when: a.when || '',
      chars: fileChars(path.join(skillDir(id), a.path)),
    })),
  };
}

/**
 * 仅供界面人工查看某个包内文件（含脚本源码）。
 * 这条路径不参与模型链路：运行时模型拿不到脚本源码，只看得到脚本的输出。
 */
export function readSkillFile(id, relPath) {
  const { clean, full } = safeResolve(id, relPath);
  if (!fs.existsSync(full)) throw new Error(`文件不存在：${clean}`);
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error(`不是文件：${clean}`);
  const text = fs.readFileSync(full, 'utf8');
  return {
    path: clean,
    chars: text.length,
    bytes: stat.size,
    text,
    humanOnly: true,
    note: '这条读取只发生在界面上，不在模型链路里；运行时模型看不到脚本源码',
  };
}

// ---------------------------------------------------------------------------
// 受控执行 script
// ---------------------------------------------------------------------------

const PY_CANDIDATES = [process.env.PYTHON_BIN, 'python3', '/usr/bin/python3'].filter(Boolean);

function validateArgs(scriptName, schema, args) {
  const spec = schema?.properties || {};
  const allowed = Object.keys(spec);
  const input = args && typeof args === 'object' ? args : {};

  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new Error(`脚本 ${scriptName} 不接受参数「${key}」，可用参数：${allowed.join('、') || '（无）'}`);
    }
  }
  for (const req of schema?.required || []) {
    if (input[req] == null) throw new Error(`脚本 ${scriptName} 缺少必填参数「${req}」`);
  }

  const argv = [];
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    const type = spec[key]?.type;
    if (type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`参数「${key}」必须是有限数字`);
      }
    }
    if (type === 'string' && typeof value !== 'string') {
      throw new Error(`参数「${key}」必须是字符串`);
    }
    if (typeof value !== 'number' && typeof value !== 'string') {
      throw new Error(`参数「${key}」只支持数字或字符串`);
    }
    if (typeof value === 'string' && (value.length > 500 || /\n/.test(value))) {
      throw new Error(`参数「${key}」长度或格式不合法`);
    }
    argv.push(`--${key.replace(/_/g, '-')}`, String(value));
  }
  return argv;
}

function spawnOnce(bin, argv, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(bin, argv, {
      cwd,
      // 只给最小环境：不继承任何密钥、代理或凭据
      env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (b) => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += b.toString('utf8');
    });
    child.stderr.on('data', (b) => {
      if (stderr.length < 4000) stderr += b.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

export async function runScript(id, scriptName, args = {}) {
  const manifest = readManifest(id);
  const script = manifest.scripts.find((s) => s.name === scriptName);
  if (!script) {
    const list = manifest.scripts.map((s) => s.name);
    throw new Error(`脚本未登记在白名单中：${scriptName}。本 Skill 允许执行的只有：${list.join('、') || '（无）'}`);
  }

  const { clean, full } = safeResolve(id, `scripts/${script.name}`);
  if (!fs.existsSync(full)) throw new Error(`脚本文件不存在：${clean}`);

  const argv = validateArgs(script.name, script.args, args);
  const timeoutMs = Math.min(Number(script.timeoutMs) || DEFAULT_SCRIPT_TIMEOUT, 15000);
  const scriptText = fs.readFileSync(full, 'utf8');

  let lastErr = null;
  for (const bin of PY_CANDIDATES) {
    try {
      const run = await spawnOnce(bin, [full, ...argv], skillDir(id), timeoutMs);
      const stdout = run.stdout.slice(0, MAX_OUTPUT_CHARS);
      return {
        script: clean,
        name: script.name,
        title: script.title || script.name,
        args,
        argv,
        interpreter: bin,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        stdout,
        stderr: run.stderr.slice(0, 2000),
        durationMs: run.durationMs,
        // 这两个数字是「脚本不占上下文」的证据
        scriptChars: scriptText.length,
        outputChars: stdout.length,
        truncated: run.stdout.length > MAX_OUTPUT_CHARS,
        network: Boolean(script.network),
        sideEffect: script.sideEffect || 'none',
        sourceSentToModel: false,
      };
    } catch (err) {
      lastErr = err;
      if (err.code !== 'ENOENT') break;
    }
  }
  throw new Error(`无法启动脚本解释器：${lastErr?.message || '未知错误'}`);
}

export { MAX_RESOURCE_DEPTH };
