import React from 'react';

/**
 * 轻量 Markdown 渲染器（无第三方依赖，离线可用）。
 * 只覆盖模型回答里真实会出现的语法：标题、加粗、斜体、行内代码、代码块、
 * 有序/无序列表、引用、表格、分隔线、链接。
 */

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[]; start: number }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; text: string }
  | { t: 'hr' }
  | { t: 'table'; head: string[]; rows: string[][] };

const isTableSep = (line: string) => /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');

function splitRow(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return s.split('|').map((c) => c.trim());
}

function parse(src: string): Block[] {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ t: 'code', lang, text: buf.join('\n') });
      continue;
    }

    // 空行
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ t: 'hr' });
      i += 1;
      continue;
    }

    // 标题
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ t: 'h', level: h[1].length, text: h[2].trim() });
      i += 1;
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ t: 'table', head, rows });
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ t: 'quote', text: buf.join('\n') });
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ t: 'ul', items });
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      const start = Number(line.match(/^\s*(\d+)/)?.[1] || 1);
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push({ t: 'ol', items, start });
      continue;
    }

    // 段落：收集到空行或下一个块级标记
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|```|>\s?|\d+[.)]\s|[-*+]\s)/.test(lines[i]) &&
      !(/^\s*([-*_])\1{2,}\s*$/.test(lines[i]))
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    if (!buf.length) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push({ t: 'p', text: buf.join('\n') });
  }

  return blocks;
}

const INLINE =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|~~[^~\n]+~~|\[[^\]\n]*\]\([^)\n]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  INLINE.lastIndex = 0;

  const pushText = (s: string) => {
    if (!s) return;
    out.push(<React.Fragment key={`${keyPrefix}-t${n++}`}>{s}</React.Fragment>);
  };

  while ((m = INLINE.exec(text))) {
    pushText(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-i${n++}`;
    if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('~~')) {
      out.push(<del key={key}>{tok.slice(2, -2)}</del>);
    } else if (tok.startsWith('[')) {
      const mm = tok.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
      out.push(
        <a key={key} href={mm?.[2] || '#'} target="_blank" rel="noreferrer">
          {mm?.[1] || tok}
        </a>
      );
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  pushText(text.slice(last));
  return out;
}

export default function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => parse(text), [text]);

  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case 'h': {
            const Tag = (`h${Math.min(4, Math.max(2, b.level))}` as unknown) as 'h2';
            return <Tag key={k}>{inline(b.text, k)}</Tag>;
          }
          case 'code':
            return (
              <pre key={k} className="md-code">
                <code>{b.text}</code>
              </pre>
            );
          case 'quote':
            return <blockquote key={k}>{inline(b.text, k)}</blockquote>;
          case 'hr':
            return <hr key={k} />;
          case 'ul':
            return (
              <ul key={k}>
                {b.items.map((it, j) => (
                  <li key={`${k}-${j}`}>{inline(it, `${k}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={k} start={b.start}>
                {b.items.map((it, j) => (
                  <li key={`${k}-${j}`}>{inline(it, `${k}-${j}`)}</li>
                ))}
              </ol>
            );
          case 'table':
            return (
              <div key={k} className="md-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={`${k}-h${j}`}>{inline(c, `${k}-h${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={`${k}-r${ri}`}>
                        {row.map((c, ci) => (
                          <td key={`${k}-r${ri}c${ci}`}>{inline(c, `${k}-r${ri}c${ci}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={k}>{inline(b.text, k)}</p>;
        }
      })}
    </div>
  );
}
