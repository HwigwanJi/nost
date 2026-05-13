/**
 * memoMarkdown — tiny zero-dep markdown renderer for the memo editor's
 * preview mode.
 *
 * Why not pull in `marked` / `markdown-it` / `react-markdown`:
 *   The memo subset is intentionally small (heading, list, checkbox,
 *   bold, italic, inline code, plain paragraphs) and the body cap
 *   in practice is a few hundred chars — full-fat markdown libs
 *   are 30~100 KB gzipped just to handle a paragraph and a `**bold**`.
 *   This 80-line implementation covers everything we surface in the
 *   editor toolbar and stays fast on every keystroke.
 *
 * Output: a React node tree. We never use dangerouslySetInnerHTML
 * so XSS through user-typed markdown is impossible — the renderer
 * only emits whitelisted tags + plain text.
 *
 * Subset:
 *   - `# heading`              up to 6 levels
 *   - `- item` / `* item`      unordered list (one level)
 *   - `[ ] task` / `[x] task`  checkboxes (rendered as ☐ / ☑ glyphs;
 *                              click-to-toggle is editor-mode-only)
 *   - `**bold**`               <strong>
 *   - `*italic*` / `_italic_`  <em>
 *   - `` `code` ``             <code>
 *   - blank line               paragraph separator
 *   - everything else          a normal paragraph
 *
 * Order of inline matching: code → bold → italic. Code wins so that
 * markdown-looking content inside backticks renders verbatim.
 */

import type { ReactNode } from 'react';
import React from 'react';

interface RenderOpts {
  /** When provided, checkbox lines call this on click with the line
   *  index + new state. Editor-mode wires it up to mutate the body
   *  in-place; preview-mode (read-only) leaves it undefined. */
  onToggleCheckbox?: (lineIndex: number, checked: boolean) => void;
}

export function renderMemoMarkdown(body: string, opts: RenderOpts = {}): ReactNode[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const out: ReactNode[] = [];

  // Group consecutive list lines so they wrap in a single <ul>.
  let pendingList: { idx: number; line: string }[] = [];
  const flushList = () => {
    if (pendingList.length === 0) return;
    out.push(
      <ul key={`ul-${pendingList[0].idx}`} style={listStyle}>
        {pendingList.map(({ idx, line }) => (
          <li key={idx} style={liStyle}>{renderInline(line)}</li>
        ))}
      </ul>
    );
    pendingList = [];
  };

  lines.forEach((rawLine, i) => {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) {
      flushList();
      out.push(<div key={i} style={{ height: 6 }} aria-hidden="true" />);
      return;
    }

    // Heading
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      // Tag name as a plain string — React.createElement accepts
      // it identically. JSX.IntrinsicElements isn't reachable in
      // this project's TS lib config so we drop the cast.
      const tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      out.push(
        React.createElement(
          tag,
          { key: i, style: headingStyles[level - 1] },
          renderInline(headingMatch[2])
        )
      );
      return;
    }

    // Checkbox (must come before list — same prefix shape)
    const cbMatch = /^\s*\[([ xX])\]\s+(.*)$/.exec(line);
    if (cbMatch) {
      flushList();
      const checked = cbMatch[1].toLowerCase() === 'x';
      out.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '2px 0' }}>
          <button
            type="button"
            onClick={() => opts.onToggleCheckbox?.(i, !checked)}
            disabled={!opts.onToggleCheckbox}
            style={{
              flexShrink: 0,
              marginTop: 1,
              width: 14, height: 14,
              padding: 0,
              border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--text-dim)'}`,
              borderRadius: 3,
              background: checked ? 'var(--accent)' : 'transparent',
              color: '#fff',
              fontSize: 9,
              lineHeight: '11px',
              cursor: opts.onToggleCheckbox ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
            title={opts.onToggleCheckbox ? '클릭으로 체크' : undefined}
          >
            {checked ? '✓' : ''}
          </button>
          <span style={{
            color: checked ? 'var(--text-muted)' : 'inherit',
            textDecoration: checked ? 'line-through' : 'none',
            opacity: checked ? 0.65 : 1,
            lineHeight: 1.5,
          }}>
            {renderInline(cbMatch[2])}
          </span>
        </div>
      );
      return;
    }

    // Bullet list
    const liMatch = /^\s*[-*+•]\s+(.*)$/.exec(line);
    if (liMatch) {
      pendingList.push({ idx: i, line: liMatch[1] });
      return;
    }

    // Plain paragraph
    flushList();
    out.push(
      <p key={i} style={paraStyle}>
        {renderInline(line)}
      </p>
    );
  });

  flushList();
  return out;
}

/* ── Inline formatting tokeniser ──────────────────────────────── */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < text.length) {
    // Inline code first — its content is literal
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        out.push(
          <code key={key++} style={codeStyle}>{text.slice(i + 1, end)}</code>
        );
        i = end + 1;
        continue;
      }
    }
    // Bold ** ... **
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        out.push(<strong key={key++}>{renderInline(text.slice(i + 2, end))}</strong>);
        i = end + 2;
        continue;
      }
    }
    // Italic — `*x*` or `_x_`. Avoid eating the `**` we just handled.
    if ((text[i] === '*' || text[i] === '_') && text[i + 1] !== text[i]) {
      const marker = text[i];
      const end = text.indexOf(marker, i + 1);
      if (end > i + 1) {
        out.push(<em key={key++}>{renderInline(text.slice(i + 1, end))}</em>);
        i = end + 1;
        continue;
      }
    }
    // Plain run — collect until next special char
    let runEnd = i + 1;
    while (
      runEnd < text.length &&
      text[runEnd] !== '`' &&
      !(text[runEnd] === '*' && (text[runEnd + 1] === '*' || /[A-Za-z0-9가-힣]/.test(text[runEnd + 1] ?? ''))) &&
      !(text[runEnd] === '_' && /[A-Za-z0-9]/.test(text[runEnd + 1] ?? ''))
    ) {
      runEnd++;
    }
    out.push(<span key={key++}>{text.slice(i, runEnd)}</span>);
    i = runEnd;
  }

  return out;
}

/* ── Block + inline styles (kept inline for portability) ───────── */
const headingStyles: React.CSSProperties[] = [
  { fontSize: 18, fontWeight: 800, margin: '6px 0 4px', lineHeight: 1.3 },  // h1
  { fontSize: 16, fontWeight: 700, margin: '6px 0 4px', lineHeight: 1.3 },  // h2
  { fontSize: 14, fontWeight: 700, margin: '5px 0 3px', lineHeight: 1.3 },  // h3
  { fontSize: 13, fontWeight: 600, margin: '4px 0 3px', lineHeight: 1.3 },  // h4
  { fontSize: 12, fontWeight: 600, margin: '4px 0 2px', lineHeight: 1.3 },  // h5
  { fontSize: 12, fontWeight: 500, margin: '4px 0 2px', lineHeight: 1.3, color: 'var(--text-muted)' }, // h6
];
const paraStyle: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.55, margin: '2px 0', color: 'var(--text-color)',
};
const listStyle: React.CSSProperties = {
  margin: '2px 0 4px 18px', padding: 0, listStyle: 'disc',
};
const liStyle: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.55, marginBottom: 1,
};
const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace',
  fontSize: 12,
  background: 'var(--surface-hover)',
  padding: '1px 5px',
  borderRadius: 3,
  border: '1px solid var(--border-rgba)',
};
