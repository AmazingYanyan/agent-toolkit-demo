import fs from 'node:fs';
import path from 'node:path';

const SKILL_DIR = path.join(import.meta.dirname, 'skills');

/**
 * Skill 加载器：按目录读取 SKILL.md，解析 YAML frontmatter。
 * 这是真实的文件加载，不是把一段固定 Prompt 伪装成 Skill。
 *
 * 加载分三步，对应"按需加载"：
 *   1) 索引：只读所有 Skill 的元数据（name / description / keywords），正文留在磁盘
 *   2) 匹配：用当前问题在索引里打分，判断是否命中、命中哪一个
 *   3) 加载：只有命中，才读命中那一个的正文并注入上下文；未命中的正文完全不进内存
 */

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2] };
}

function parseKeywords(value, fallback) {
  const raw = (value || '').trim();
  if (!raw) return [];
  const list = raw
    .replace(/^\[|\]$/g, '')
    .split(/[,，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

export function listSkills() {
  if (!fs.existsSync(SKILL_DIR)) return [];
  const out = [];
  for (const dir of fs.readdirSync(SKILL_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = path.join(SKILL_DIR, dir.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const name = meta.name || dir.name;
    const description = meta.description || '';
    const keywords = parseKeywords(meta.keywords, []);
    // 索引体积只算元数据，不算正文——这是"按需加载"能被观测到的关键数字
    const indexChars = name.length + description.length + keywords.join('').length;
    out.push({
      id: dir.name,
      name,
      description,
      keywords,
      version: meta.version || '—',
      author: meta.author || '—',
      path: `server/skills/${dir.name}/SKILL.md`,
      size: Buffer.byteLength(raw, 'utf8'),
      bodyChars: body.trim().length,
      indexChars,
      assets: fs.readdirSync(path.join(SKILL_DIR, dir.name)).filter((f) => f !== 'SKILL.md'),
      body,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** 索引视图：启动时常驻内存的就是这一份，不含正文 */
export function skillIndex() {
  const all = listSkills();
  return {
    count: all.length,
    indexChars: all.reduce((n, s) => n + s.indexChars, 0),
    totalBodyChars: all.reduce((n, s) => n + s.bodyChars, 0),
    items: all.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      keywords: s.keywords,
      indexChars: s.indexChars,
      bodyChars: s.bodyChars,
      version: s.version,
    })),
  };
}

/**
 * 在索引里用问题做关键词匹配。restrictId 为空表示在所有 Skill 中挑选。
 * 这是真实的字符串匹配，不是假装"模型自己知道该用哪个 Skill"。
 */
export function matchSkill(question, restrictId = null, threshold = 2) {
  const index = skillIndex();
  const pool = restrictId ? index.items.filter((s) => s.id === restrictId) : index.items;
  const q = String(question || '');
  let best = null;

  for (const item of pool) {
    const hits = item.keywords.filter((k) => k && q.includes(k));
    let score = hits.length * 2;
    if (q.includes(item.name)) score += 3;
    if (!best || score > best.score) best = { item, hits, score };
  }

  const matched = Boolean(best && best.score >= threshold);
  return {
    matched,
    threshold,
    scanned: index.count,
    candidates: pool.length,
    item: best?.item || null,
    score: best?.score || 0,
    hits: best?.hits || [],
    keywords: best?.item?.keywords || [],
  };
}

export function loadSkill(id) {
  const all = listSkills();
  const skill = all.find((s) => s.id === id) || null;
  if (!skill) return null;
  return {
    ...skill,
    loadedAt: new Date().toISOString(),
    // 元数据先入上下文，正文按需加载——这是"按需加载"的第三步
    metadataPrompt: `Skill：${skill.name}\n适用说明：${skill.description}`,
    instructionPrompt: skill.body.trim(),
  };
}
