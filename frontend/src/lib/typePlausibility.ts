/**
 * typePlausibility — given an in-progress value, return the set of
 * LauncherItem types that could plausibly be its type.
 *
 * Rationale: when the user has pasted "https://github.com" into the
 * value field, asking them to also pick "is this a folder or an
 * app?" is brain-tax for an answer that's already obvious. The
 * dialog shows only plausible types up front; an opt-in "다른 유형
 * 보기" toggle reveals everything for the rare override case.
 *
 * Design notes:
 *   - Empty value returns ALL types (no signal yet).
 *   - We intentionally include `text` in *almost* every plausible
 *     set: any value can be saved as a clipboard-copy text card,
 *     so hiding it would surprise users who explicitly want that.
 *     Multiline values narrow to text-only (no other type makes
 *     sense for paragraph blobs).
 *   - URL detection is generous: full https:// AND bare
 *     "github.com/foo" both qualify, since users paste both.
 *   - Path detection covers Windows drive paths, UNC, and POSIX —
 *     the launcher targets Windows but symlinks / WSL / network
 *     shares can produce any of the three.
 *   - The result is a Set so caller can do O(1) `has()` checks
 *     when filtering type cards on each render.
 *
 * This is the SSOT for "what types make sense for X". Don't
 * duplicate the predicates anywhere else — call this and intersect.
 */

import type { LauncherItem } from '../types';

export type PlausibleType = LauncherItem['type'];

const URL_PROTO_RE = /^https?:\/\//i;
// Bare domain heuristic: at least two dotted segments, allowed chars
// are URL-safe. Excludes obvious paths by rejecting backslash and
// caller-side path detection takes precedence anyway.
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i;
const WIN_PATH_RE = /^[A-Za-z]:[\\/]/;
const UNC_PATH_RE = /^\\\\[^\\]+\\/;
const POSIX_PATH_RE = /^\//;
const EXE_EXT_RE = /\.(exe|lnk|bat|cmd|com|msi)$/i;
const HEX_RE = /^#?[0-9A-Fa-f]{3,8}$/;

export function isUrlLike(v: string): boolean {
  if (URL_PROTO_RE.test(v)) return true;
  if (v.includes('\\') || v.includes(' ') || v.startsWith('/')) return false;
  return BARE_DOMAIN_RE.test(v);
}

export function isPathLike(v: string): boolean {
  return WIN_PATH_RE.test(v) || UNC_PATH_RE.test(v) || POSIX_PATH_RE.test(v);
}

export function isExeLike(v: string): boolean {
  return EXE_EXT_RE.test(v);
}

const ALL_TYPES: Set<PlausibleType> = new Set([
  'url', 'browser', 'folder', 'app', 'window', 'text', 'cmd',
]);

/**
 * Return the set of types compatible with `rawValue`.
 *
 * Empty value → all types (no signal). Otherwise the value is
 * matched against the rules above and only compatible kinds are
 * returned. `text` survives most prunings since "save the literal
 * string for paste" is a valid save intent for any input.
 */
export function plausibleTypes(rawValue: string): Set<PlausibleType> {
  const v = rawValue.trim();
  if (!v) return new Set(ALL_TYPES);

  // Multiline blob → only text. URLs / paths / window titles /
  // cmd are all single-line by convention.
  if (v.includes('\n')) return new Set<PlausibleType>(['text']);

  // Hex code → text only here (color-swatch creation is a
  // separate flow that doesn't go through this dialog).
  if (HEX_RE.test(v) && v.length <= 9) return new Set<PlausibleType>(['text']);

  // URL — paths and protocols are exclusive, so a URL value
  // cannot ALSO be a folder/app/window/cmd target.
  if (isUrlLike(v)) {
    return new Set<PlausibleType>(['url', 'browser', 'text']);
  }

  // Windows / UNC / POSIX path → folder or app, never URL.
  if (isPathLike(v)) {
    if (isExeLike(v)) return new Set<PlausibleType>(['app', 'text', 'cmd']);
    return new Set<PlausibleType>(['folder', 'app', 'text']);
  }

  // Bare exe / cmd-like file (no path prefix) — power-user
  // shortcut for "notepad.exe" / "code.cmd".
  if (isExeLike(v)) {
    return new Set<PlausibleType>(['app', 'cmd', 'text']);
  }

  // Free text. Long blobs → text only (window titles and
  // commands are short by convention).
  if (v.length > 100 || v.split(/\s+/).length > 12) {
    return new Set<PlausibleType>(['text']);
  }

  // Short ambiguous string — could be a window title, text snippet,
  // or single-shot cmd. Show all three, hide path/URL types.
  return new Set<PlausibleType>(['window', 'text', 'cmd']);
}
