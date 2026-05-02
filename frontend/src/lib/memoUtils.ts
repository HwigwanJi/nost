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
 * Strip the lightweight markdown markers from a memo body, returning
 * a clean plain-text version for "다른 형식 없이 복사" use cases.
 *
 * What we strip:
 *   - List markers   (-, *, +, • prefix)
 *   - Heading hashes (#, ##, … up to ######)
 *   - Checkbox marks ([ ], [x], [X])
 *   - Bold / italic asterisks (`**word**` → `word`, `*word*` → `word`)
 *   - Inline code backticks
 *
 * What we keep:
 *   - Line breaks (so list-style memos stay legible as paragraphs)
 *   - All other characters
 *
 * Defensive: input that's not a string returns ''.
 */
export function memoBodyToPlain(body: string): string {
  if (!body) return '';
  return body
    .split(/\r?\n/)
    .map(line => line
      .replace(/^\s*[-*+•]\s+/, '')           // list markers
      .replace(/^\s*#{1,6}\s+/, '')            // headings
      .replace(/^\s*\[[ xX]\]\s+/, '')         // checkboxes
      .replace(/\*\*([^*]+)\*\*/g, '$1')       // bold
      .replace(/(?<![*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1')  // italic — avoid eating bold's asterisks
      .replace(/`([^`]+)`/g, '$1')             // inline code
    )
    .join('\n');
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
