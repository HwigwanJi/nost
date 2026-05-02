/**
 * Memo (사라지는 메모) — utility module.
 *
 * Pure functions used by both the data layer (auto-purge sweep) and
 * the UI (gauge fraction, body→title parsing, TTL math).
 *
 * Design notes:
 *   - All time values are absolute Unix ms (UTC). Render-time `now` is
 *     passed in by callers so tests can fake the clock and so a single
 *     render pass uses one consistent timestamp.
 *   - The "수명 게이지" representation depends on the *configured*
 *     defaultTtlDays at memo creation time, NOT the current setting —
 *     because TTL is baked-into-memo (Decision 1 in the spec). We
 *     reconstruct the original total by treating `expiresAt - createdAt`
 *     as the source of truth, falling back to settings only when the
 *     memo has been extended (lastTouchedAt > createdAt).
 */

import type { LauncherItem, MemoData, MemoSettings, AppData, Space, Preset } from '../types';
import { MEMO_TTL_DAYS_MIN, MEMO_TTL_DAYS_MAX, DEFAULT_MEMO_SETTINGS } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clamp a TTL day count to the supported range (1~90). */
export function clampTtlDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_MEMO_SETTINGS.defaultTtlDays;
  return Math.max(MEMO_TTL_DAYS_MIN, Math.min(MEMO_TTL_DAYS_MAX, Math.round(days)));
}

/** Resolve effective memo settings (filling in defaults + clamping). */
export function resolveMemoSettings(s: Partial<MemoSettings> | undefined): MemoSettings {
  const merged = { ...DEFAULT_MEMO_SETTINGS, ...(s ?? {}) };
  merged.defaultTtlDays = clampTtlDays(merged.defaultTtlDays);
  if (merged.trashRetentionHours !== 24 && merged.trashRetentionHours !== 72 && merged.trashRetentionHours !== 168) {
    merged.trashRetentionHours = 24;
  }
  return merged;
}

/**
 * First non-empty line of the body — used as the card title and as the
 * filename slug for txt export. Returns "(빈 메모)" when the body has
 * no visible content (used as a placeholder; empty memos are auto-
 * deleted on close, so this is a transient state).
 */
export function memoTitleFromBody(body: string): string {
  if (!body) return '(빈 메모)';
  const lines = body.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw
      // Strip leading list / heading / checkbox markup so the title
      // reads as "할 일" rather than "- 할 일".
      .replace(/^\s*[-*+•]\s+/, '')
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*\[[ xX]\]\s+/, '')
      .trim();
    if (line.length > 0) return line.slice(0, 80);
  }
  return '(빈 메모)';
}

/**
 * Strip lightweight markdown markers + bullet glyphs from a memo
 * body, returning a clean plain-text version. Targets the user's
 * two real-world pain points:
 *
 *   1. GPT-pasted text → memo. Memo holds the markdown. User wants
 *      to paste this into PowerPoint as plain text but the OS
 *      "paste as plain text" loses the line breaks. So they need a
 *      conversion that strips MARKERS while PRESERVING line breaks.
 *
 *   2. Mixed bullet styles. PowerPoint already provides its own
 *      bullets — pasting a "- item" line ends up with double
 *      bullets ("• - item"). We need to strip the leading bullet
 *      glyph before paste.
 *
 * What we strip:
 *   - List markers   (-, *, +, • → ▪ ▶ ● ○ ■ □ ▸ ※ ▶︎ ‣ prefix)
 *   - Numbered lists (1. 2. 3.) — most paste destinations re-number
 *     anyway and the user explicitly mentioned "말머리표 제거".
 *   - Heading hashes (#, ##, … up to ######)
 *   - Checkbox marks ([ ], [x], [X])
 *   - Bold / italic asterisks (`**word**` → `word`, `*word*` → `word`)
 *   - Inline code backticks
 *
 * What we keep:
 *   - Line breaks (so list-style memos stay legible as paragraphs).
 *   - Indentation (so nested lists keep their hierarchy after the
 *     leading marker is stripped).
 *   - All other characters.
 */
const BULLET_CLASS = '[-*+•→▪▶●○■□▸※‣◦∙·]';
export function memoBodyToPlain(body: string): string {
  if (!body) return '';
  return body
    .split(/\r?\n/)
    .map(line => line
      .replace(new RegExp(`^(\\s*)${BULLET_CLASS}\\s+`), '$1')   // bullet glyphs
      .replace(/^(\s*)\d+[.)]\s+/, '$1')        // numbered lists "1. " or "1) "
      .replace(/^(\s*)#{1,6}\s+/, '$1')         // headings
      .replace(/^(\s*)\[[ xX]\]\s+/, '$1')      // checkboxes
      .replace(/\*\*([^*]+)\*\*/g, '$1')        // bold
      .replace(/(?<![*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1')  // italic
      .replace(/`([^`]+)`/g, '$1')              // inline code
    )
    .join('\n');
}

/**
 * Strip ONLY bullet glyphs and numbered-list markers — keep all
 * other markdown intact. Useful when pasting a snippet whose
 * destination already provides bullets (PowerPoint, Google Slides)
 * but you still want the bold/italic/headings to survive.
 */
export function memoStripBullets(body: string): string {
  if (!body) return '';
  return body
    .split(/\r?\n/)
    .map(line => line
      .replace(new RegExp(`^(\\s*)${BULLET_CLASS}\\s+`), '$1')
      .replace(/^(\s*)\d+[.)]\s+/, '$1')
      .replace(/^(\s*)\[[ xX]\]\s+/, '$1')
    )
    .join('\n');
}

/**
 * Strip ONLY inline formatting (**, *, `) and heading hashes —
 * keep bullets and structure. Useful when the destination already
 * styles headings + lists differently (Notion, Slack).
 */
export function memoStripFormatting(body: string): string {
  if (!body) return '';
  return body
    .split(/\r?\n/)
    .map(line => line
      .replace(/^(\s*)#{1,6}\s+/, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(?<![*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
    )
    .join('\n');
}

/**
 * Collapse runs of 2+ blank lines to a single blank line, and trim
 * trailing whitespace per line. Doesn't touch any other content —
 * just tightens the visual rhythm before paste.
 */
export function memoCompactBlankLines(body: string): string {
  if (!body) return '';
  return body
    .split(/\r?\n/)
    .map(l => l.replace(/[ \t]+$/, ''))   // trailing whitespace
    .reduce<string[]>((acc, line) => {
      if (line.trim() === '' && acc.length > 0 && acc[acc.length - 1].trim() === '') return acc;
      acc.push(line);
      return acc;
    }, [])
    .join('\n')
    .replace(/^\s*\n/, '')   // drop leading blank
    .replace(/\n\s*$/, '');  // drop trailing blank
}

/**
 * HTML → markdown converter.
 *
 * The user's real "마크다운으로 정리" use case: copy a rendered
 * answer from ChatGPT / Notion / Claude. The system clipboard then
 * carries TWO formats:
 *   - text/plain : flat string ("Heading 1\nBullet\n…")
 *   - text/html  : `<h1>Heading 1</h1><ul><li>Bullet</li>…</ul>`
 *
 * `<textarea>` only ever receives the plain version when pasted,
 * so the rich structure is silently lost the moment the user hits
 * Ctrl+V — the heuristic markdownify can only guess at structure
 * after the fact. By capturing `text/html` at paste time and
 * pairing it with its plain twin, we can fully reconstruct
 * `# Heading 1` / `- Bullet` from the original DOM.
 *
 * Scope:
 *   Headings (h1-h6), bold, italic, inline code, code blocks,
 *   ordered + unordered lists with arbitrary nesting, links,
 *   paragraphs, line breaks, blockquotes, horizontal rules.
 *   Tables collapse to plain text rows (a future-feature TODO).
 *
 * Known wrappers we strip:
 *   - Office's <!--StartFragment--> markers
 *   - Empty <span style="..."> nesting that GPT often emits
 */
export function htmlToMarkdown(rawHtml: string): string {
  if (!rawHtml || typeof document === 'undefined') return '';
  // Office / GPT clipboard often wraps the actual content in
  // <html><body>...<!--StartFragment-->...<!--EndFragment--></body></html>.
  // Trim to the fragment when present so the wrapper doesn't pollute output.
  const fragMatch = rawHtml.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/);
  const html = fragMatch ? fragMatch[1] : rawHtml;
  const container = document.createElement('div');
  container.innerHTML = html;
  return walkHtml(container).replace(/\n{3,}/g, '\n\n').trim();
}

function walkHtml(node: Node, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // Collapse runs of whitespace inside text nodes — HTML treats
    // them as a single space, but the textContent we'd otherwise
    // return preserves indentation that's purely visual.
    const t = node.textContent ?? '';
    return t.replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const inner = (depth = listDepth) =>
    Array.from(el.childNodes).map(c => walkHtml(c, depth)).join('');

  switch (tag) {
    case 'h1': return `\n\n# ${inner().trim()}\n\n`;
    case 'h2': return `\n\n## ${inner().trim()}\n\n`;
    case 'h3': return `\n\n### ${inner().trim()}\n\n`;
    case 'h4': return `\n\n#### ${inner().trim()}\n\n`;
    case 'h5': return `\n\n##### ${inner().trim()}\n\n`;
    case 'h6': return `\n\n###### ${inner().trim()}\n\n`;
    case 'strong': case 'b': {
      const t = inner().trim();
      return t ? `**${t}**` : '';
    }
    case 'em': case 'i': {
      const t = inner().trim();
      return t ? `*${t}*` : '';
    }
    case 'code': {
      const parent = el.parentElement?.tagName.toLowerCase();
      if (parent === 'pre') return inner();
      const t = (el.textContent ?? '').trim();
      return t ? `\`${t}\`` : '';
    }
    case 'pre': {
      // Try to detect language from class="language-xxx" on inner code
      const codeEl = el.querySelector('code');
      let lang = '';
      if (codeEl) {
        const cls = codeEl.className.match(/language-([\w-]+)/);
        lang = cls?.[1] ?? '';
      }
      const text = (codeEl?.textContent ?? el.textContent ?? '').replace(/\s+$/, '');
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      const label = inner().trim();
      if (!href) return label;
      return `[${label}](${href})`;
    }
    case 'ul':
      return '\n' + Array.from(el.children)
        .filter(c => c.tagName.toLowerCase() === 'li')
        .map(li => '  '.repeat(listDepth) + '- ' + walkHtml(li, listDepth + 1).trim())
        .join('\n') + '\n';
    case 'ol': {
      let i = 1;
      return '\n' + Array.from(el.children)
        .filter(c => c.tagName.toLowerCase() === 'li')
        .map(li => '  '.repeat(listDepth) + `${i++}. ` + walkHtml(li, listDepth + 1).trim())
        .join('\n') + '\n';
    }
    case 'li': {
      // Strip nested ul/ol from immediate children — they're rendered
      // separately by the parent ul/ol loop above. We keep their text
      // by recursing manually so deeply-nested lists survive.
      let parts: string[] = [];
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const t = (child as HTMLElement).tagName.toLowerCase();
          if (t === 'ul' || t === 'ol') {
            parts.push('\n' + walkHtml(child, listDepth));
            continue;
          }
        }
        parts.push(walkHtml(child, listDepth));
      }
      return parts.join('').trim();
    }
    case 'p': return inner().trim() + '\n\n';
    case 'br': return '\n';
    case 'blockquote': {
      const text = inner().trim();
      return '\n' + text.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
    }
    case 'hr': return '\n---\n\n';
    case 'div': case 'section': case 'article':
      // Block-level containers — emit children + a paragraph break
      // so visual layout survives even when the source uses <div>
      // instead of <p> (Notion habit).
      return inner() + '\n';
    case 'table': case 'thead': case 'tbody': case 'tr':
      return inner() + '\n';
    case 'td': case 'th':
      return inner().trim() + ' | ';
    default:
      return inner();
  }
}

/** True when the html clipboard payload carries actual structural
 *  tags worth converting (vs. a wrapped plain-text blob like
 *  `<span style="font-family:'Courier'">just text</span>`). */
export function htmlHasStructure(html: string): boolean {
  if (!html) return false;
  return /<(h[1-6]|strong|b|em|i|ul|ol|li|p|code|pre|a|blockquote|hr)[\s>]/i.test(html);
}

/**
 * Markdown-ify the body, with priority given to recently-pasted
 * rich HTML segments. For each paste in `pastes`, find its plain
 * twin inside `body` and substitute the html→markdown conversion.
 * Sections of body NOT covered by any paste fall back to the
 * heuristic `memoBodyToMarkdown` (which guesses headings from
 * line shape + position).
 *
 * We process pastes longest-first so a short paste's plain text
 * (which might be a substring of a longer paste's plain text)
 * doesn't corrupt the longer one's substitution.
 */
export function memoBodyToMarkdownWithPastes(
  body: string,
  pastes: Array<{ plain: string; html: string }>,
): string {
  if (!body) return '';
  if (!pastes.length) return memoBodyToMarkdown(body);

  // Sort by plain length desc so longer matches commit first.
  const sorted = [...pastes].sort((a, b) => b.plain.length - a.plain.length);

  // Build a mask string: same length as body, true where a paste
  // already claimed the span. Then run heuristic markdownify only
  // over the unclaimed segments and stitch together.
  type Seg = { from: number; to: number; out: string };
  const claimed: Seg[] = [];
  let work = body;

  for (const p of sorted) {
    if (!p.plain || !p.html) continue;
    const idx = work.indexOf(p.plain);
    if (idx < 0) continue;
    const overlapping = claimed.some(c => !(idx + p.plain.length <= c.from || idx >= c.to));
    if (overlapping) continue;
    const md = htmlToMarkdown(p.html);
    if (!md) continue;
    claimed.push({ from: idx, to: idx + p.plain.length, out: md });
  }

  if (claimed.length === 0) return memoBodyToMarkdown(body);

  claimed.sort((a, b) => a.from - b.from);
  let cursor = 0;
  const out: string[] = [];
  for (const c of claimed) {
    if (c.from > cursor) {
      const seg = body.slice(cursor, c.from);
      out.push(memoBodyToMarkdown(seg));
    }
    out.push(c.out);
    cursor = c.to;
  }
  if (cursor < body.length) {
    out.push(memoBodyToMarkdown(body.slice(cursor)));
  }
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * "마크다운으로 정리" — promote ad-hoc plain text into structured
 * markdown the way StackEdit / Obsidian's "auto-format" do.
 *
 * Heuristics (intentionally conservative — we'd rather under-format
 * than wrongly tag a regular sentence as a heading):
 *
 *   1. First non-empty line gets `# ` (= H1) IF it's short (≤ 40
 *      chars), has no trailing punctuation other than `?`, and has no
 *      existing markdown markers.
 *
 *   2. A line is treated as a heading-2 (`## `) when:
 *        a. surrounded by blank lines (or BOF/EOF) on both sides,
 *        b. ≤ 60 chars, no period/exclamation,
 *        c. followed by at least one non-empty content line.
 *      This catches "Section name\n\nbody…" patterns common in
 *      pasted assistant output.
 *
 *   3. Lines starting with a non-standard bullet glyph (•, ▪, ▶, etc.)
 *      get rewritten to canonical `- ` markdown bullets.
 *
 *   4. Numbered lists with `1)` or `1.` are normalised to `1. `.
 *
 *   5. Existing markdown is preserved verbatim — we never re-format
 *      a line that already starts with `#`, `-`, `*`, `+`, `>`, or
 *      a number+period.
 *
 *   6. Trailing whitespace is trimmed and 3+ blank lines collapse
 *      to a single blank line (paragraph breaks stay).
 *
 * This is a heuristic. It will sometimes turn a short statement
 * into a heading by mistake. The user can hit ⌘Z / Ctrl+Z in the
 * memo editor — we never write back to the body, only return a
 * cleaned string for clipboard copy.
 */
export function memoBodyToMarkdown(body: string): string {
  if (!body) return '';
  const rawLines = body.split(/\r?\n/).map(l => l.replace(/[ \t]+$/, ''));

  const isAlreadyMarkdownLine = (line: string) => {
    const t = line.trimStart();
    return /^#{1,6}\s/.test(t)
        || /^[-*+]\s/.test(t)
        || /^\d+\.\s/.test(t)
        || /^>\s/.test(t)
        || /^\[[ xX]\]\s/.test(t);
  };

  const looksLikeHeading = (line: string, maxLen: number): boolean => {
    const t = line.trim();
    if (!t) return false;
    if (t.length > maxLen) return false;
    // No sentence-ending punctuation. Question marks are OK
    // (section titles "Why now?" are common).
    if (/[.!。!]\s*$/.test(t)) return false;
    // Avoid promoting lines that contain colons mid-sentence with
    // long tails — those are usually "Key: value" prose, not titles.
    if (/:\s+\S{20,}/.test(t)) return false;
    return true;
  };

  // Pre-scan: which line is the first non-empty? Treat as H1 candidate.
  const firstNonEmptyIdx = rawLines.findIndex(l => l.trim().length > 0);

  const out: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (!trimmed) { out.push(''); continue; }

    if (isAlreadyMarkdownLine(line)) {
      out.push(line);
      continue;
    }

    // Bullet glyph normalisation (•, ▪, ▶, ●, etc → "- ")
    const bulletMatch = line.match(new RegExp(`^(\\s*)${BULLET_CLASS}\\s+(.*)$`));
    if (bulletMatch) {
      out.push(`${bulletMatch[1]}- ${bulletMatch[2]}`);
      continue;
    }

    // "1)" → "1. "
    const numbered = line.match(/^(\s*)(\d+)\)\s+(.*)$/);
    if (numbered) {
      out.push(`${numbered[1]}${numbered[2]}. ${numbered[3]}`);
      continue;
    }

    // H1 — first content line, short, headingy.
    if (i === firstNonEmptyIdx && looksLikeHeading(line, 40)) {
      out.push(`# ${trimmed}`);
      continue;
    }

    // H2 — surrounded by blank lines (or BOF/EOF) and short.
    const prev = i > 0 ? rawLines[i - 1].trim() : '';
    const next = i < rawLines.length - 1 ? rawLines[i + 1].trim() : '';
    const isolatedAbove = prev === '';
    const isolatedBelow = next === '';
    const followedByContent = !isolatedBelow || rawLines.slice(i + 1).some(l => l.trim().length > 0);
    if (isolatedAbove && isolatedBelow && followedByContent && looksLikeHeading(line, 60)) {
      out.push(`## ${trimmed}`);
      continue;
    }

    // Otherwise, leave the line alone — but trim leading whitespace
    // that's pure indentation under a non-list context, since
    // markdown treats that as a code block.
    out.push(line);
  }

  // Collapse 3+ blank lines to 1.
  return out
    .reduce<string[]>((acc, line) => {
      if (line.trim() === '' && acc.length >= 2 && acc[acc.length - 1].trim() === '' && acc[acc.length - 2].trim() === '') return acc;
      acc.push(line);
      return acc;
    }, [])
    .join('\n')
    .replace(/^\s*\n/, '')
    .replace(/\n\s*$/, '');
}

/** Body without the first non-empty line (= preview body for cards). */
export function memoBodyPreview(body: string, maxLines = 3): string {
  if (!body) return '';
  const lines = body.split(/\r?\n/);
  // Find the first non-empty line; preview starts AFTER it.
  let firstNonEmptyIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) { firstNonEmptyIdx = i; break; }
  }
  if (firstNonEmptyIdx === -1) return '';
  const rest = lines.slice(firstNonEmptyIdx + 1);
  // Drop leading empty lines after the title.
  while (rest.length > 0 && rest[0].trim().length === 0) rest.shift();
  return rest.slice(0, maxLines).join('\n');
}

/**
 * Construct a fresh MemoData for a brand-new memo.
 * Uses the *current* settings.defaultTtlDays for the bake.
 */
export function createMemoData(now: number, ttlDays: number, body = ''): MemoData {
  const days = clampTtlDays(ttlDays);
  return {
    body,
    createdAt: now,
    expiresAt: now + days * DAY_MS,
    lastTouchedAt: now,
  };
}

/**
 * Reset the TTL on an existing memo (편집 / 점 톡 살리기).
 * The new expiresAt = now + ttlDays. Doesn't touch createdAt or body.
 */
export function extendMemoTtl(memo: MemoData, now: number, ttlDays: number): MemoData {
  const days = clampTtlDays(ttlDays);
  return {
    ...memo,
    lastTouchedAt: now,
    expiresAt: now + days * DAY_MS,
  };
}

/**
 * The "total life" the memo was originally given — used to compute
 * gauge fraction. We can't read settings here because per-memo TTL
 * may differ from current setting (Decision 1).
 *
 * For freshly created memos: lastTouchedAt === createdAt, so we use
 * `expiresAt - createdAt`. After "살리기" or edits, lastTouchedAt
 * advances and we use `expiresAt - lastTouchedAt` (the live "this many
 * days from the last touch").
 */
export function memoTotalLifeMs(memo: MemoData): number {
  // After any 살리기/편집, the gauge resets to full. So the "total"
  // is always relative to the last touch.
  const total = memo.expiresAt - memo.lastTouchedAt;
  if (total > 0) return total;
  // Defensive: if someone mutates the memo poorly, fall back to 1d.
  return DAY_MS;
}

/**
 * Days remaining (rounded up — "1일 남음" until the actual moment of
 * expiration). Returns null for pinned items (TTL ignored).
 */
export function memoDaysLeft(item: LauncherItem, now: number): number | null {
  if (!item.memo) return null;
  if (item.pinned) return null;
  const ms = item.memo.expiresAt - now;
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/** Hours remaining — for the 24h-or-less UI ("3시간 남음"). */
export function memoHoursLeft(item: LauncherItem, now: number): number | null {
  if (!item.memo) return null;
  if (item.pinned) return null;
  const ms = item.memo.expiresAt - now;
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
}

/**
 * Gauge fraction in [0, 1] — 1 = freshly created/extended, 0 = expired.
 * Used by both the 7-pip gauge (1~7d) and the thin bar (14d+).
 */
export function memoGaugeFraction(item: LauncherItem, now: number): number {
  if (!item.memo) return 0;
  if (item.pinned) return 1;  // pinned shows full bar (or no bar — caller decides)
  const total = memoTotalLifeMs(item.memo);
  const left = item.memo.expiresAt - now;
  if (left <= 0) return 0;
  if (left >= total) return 1;
  return left / total;
}

/** True if the memo will expire in the next 24h (and isn't pinned/trashed). */
export function memoIsExpiringSoon(item: LauncherItem, now: number): boolean {
  if (!item.memo || item.pinned || item.memo.trashedAt) return false;
  const left = item.memo.expiresAt - now;
  return left > 0 && left <= DAY_MS;
}

/** True if the memo is past its expiry and not yet trashed (=> auto-purge candidate). */
export function memoIsExpired(item: LauncherItem, now: number): boolean {
  if (!item.memo || item.pinned || item.memo.trashedAt) return false;
  return item.memo.expiresAt <= now;
}

/**
 * Auto-purge sweep applied at app start (and once per day on focus —
 * caller decides). Returns a mutated AppData with:
 *   - Expired non-trashed non-pinned memos: trashedAt set to expiresAt
 *   - Trashed memos past retention: hard-removed from items[]
 *
 * Returns the SAME reference (===) when nothing changed, so callers can
 * skip persistence in the no-op case.
 */
export function purgeExpiredMemos(data: AppData, now: number): AppData {
  const settings = resolveMemoSettings(data.settings.memo);
  const retentionMs = settings.trashRetentionHours * 60 * 60 * 1000;
  let touched = false;

  const sweepSpace = (s: Space): Space => {
    const next: LauncherItem[] = [];
    let spaceTouched = false;
    for (const item of s.items) {
      if (item.type !== 'memo' || !item.memo) {
        next.push(item);
        continue;
      }
      // Hard-delete: trashed past retention
      if (item.memo.trashedAt && now - item.memo.trashedAt > retentionMs) {
        spaceTouched = true;
        continue; // drop entirely
      }
      // Soft-trash: expired, not pinned, not yet trashed
      if (!item.pinned && !item.memo.trashedAt && item.memo.expiresAt <= now) {
        spaceTouched = true;
        next.push({ ...item, memo: { ...item.memo, trashedAt: item.memo.expiresAt } });
        continue;
      }
      next.push(item);
    }
    if (!spaceTouched) return s;
    touched = true;
    return { ...s, items: next };
  };

  const sweepPreset = (p: Preset): Preset => {
    const newSpaces = p.spaces.map(sweepSpace);
    const changed = newSpaces.some((s, i) => s !== p.spaces[i]);
    return changed ? { ...p, spaces: newSpaces } : p;
  };

  const newPresets = data.presets.map(sweepPreset);
  if (!touched) return data;

  // Mirror the active preset's swept spaces back to the flat-view.
  const active = newPresets.find(p => p.id === data.activePresetId) ?? newPresets[0];
  return {
    ...data,
    presets: newPresets,
    spaces: active.spaces,
  };
}

/**
 * Slugify the title for filename use (txt export). Strips characters
 * Windows can't put in filenames, collapses whitespace, and keeps it
 * to 40 chars to leave room for the date suffix.
 */
export function slugifyTitle(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')   // forbidden in NTFS
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || '메모').slice(0, 40);
}

/** YYYYMMDD for the current local date (used in export filenames). */
export function todayYmd(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
