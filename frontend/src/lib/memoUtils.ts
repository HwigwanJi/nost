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
