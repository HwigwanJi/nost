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
import { getDocumentExtensions } from './documentExtensions';

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
// Subset used to disambiguate URL vs exe for BARE values. `.com` is
// excluded because it's overwhelmingly a TLD in modern URLs
// (github.com, weather.com); the rare DOS .com executable can still
// be launched by typing the path explicitly. The other extensions
// have no TLD conflict so we treat them as exe-only.
const STRICT_EXE_RE = /\.(exe|lnk|bat|cmd|msi)$/i;
const TEXT_DOC_EXT_RE = /\.(txt|md|markdown)$/i;
const TRAILING_EXT_RE = /\.([a-z0-9]+)$/i;
const HEX_RE = /^#?[0-9A-Fa-f]{3,8}$/;

export function isUrlLike(v: string): boolean {
  if (URL_PROTO_RE.test(v)) return true; // explicit protocol always wins
  if (v.includes('\\') || v.includes(' ') || v.startsWith('/')) return false;
  // Bare exe-like names (notepad.exe, code.cmd) look like domains to
  // BARE_DOMAIN_RE but the user's intent is "launch this executable".
  // STRICT_EXE_RE excludes `.com` so github.com still classifies as
  // URL. Caught by typePlausibility.test.ts.
  if (STRICT_EXE_RE.test(v)) return false;
  return BARE_DOMAIN_RE.test(v);
}

export function isPathLike(v: string): boolean {
  return WIN_PATH_RE.test(v) || UNC_PATH_RE.test(v) || POSIX_PATH_RE.test(v);
}

export function isExeLike(v: string): boolean {
  return EXE_EXT_RE.test(v);
}

export function isTextDocLike(v: string): boolean {
  return TEXT_DOC_EXT_RE.test(v);
}

/** Does `v` end with a document-like extension?
 *
 *  Honours the user's customised `docExtensions` setting if provided —
 *  this is the SSOT-correct path. Callers that don't have access to the
 *  user setting (e.g. unit tests, main process before settings hydrate)
 *  can omit and we fall back to the DEFAULT_DOCUMENT_EXTENSIONS list
 *  (Office / 한컴 / PDF / open-format defaults).
 *
 *  v1.3.41: signature took only `(v)` and hard-coded a regex of the
 *  defaults. That meant a user who added e.g. `epub` in Settings still
 *  saw their .epub drop get auto-corrected to 'folder' in ItemDialog —
 *  the dialog asked the wrong SSOT. Now both sides agree. */
export function isDocLike(v: string, docExtensions?: readonly string[]): boolean {
  const m = TRAILING_EXT_RE.exec(v);
  if (!m) return false;
  const ext = m[1].toLowerCase();
  const list = getDocumentExtensions(docExtensions ? [...docExtensions] : undefined);
  for (const e of list) {
    if (String(e).toLowerCase().replace(/^\./, '') === ext) return true;
  }
  return false;
}

const ALL_TYPES: Set<PlausibleType> = new Set([
  'url', 'browser', 'folder', 'app', 'doc', 'window', 'text', 'cmd', 'memo',
]);

/**
 * Return the set of types compatible with `rawValue`.
 *
 * Empty value → all types (no signal). Otherwise the value is
 * matched against the rules above and only compatible kinds are
 * returned. `text` survives most prunings since "save the literal
 * string for paste" is a valid save intent for any input.
 */
export function plausibleTypes(
  rawValue: string,
  docExtensions?: readonly string[],
): Set<PlausibleType> {
  const v = rawValue.trim();
  if (!v) return new Set(ALL_TYPES);

  // Multiline blob → text or memo. Both store the literal content;
  // text is for clipboard-paste, memo is for editable notes.
  if (v.includes('\n')) return new Set<PlausibleType>(['memo', 'text']);

  // Hex code → text only here (color-swatch creation is a
  // separate flow that doesn't go through this dialog).
  if (HEX_RE.test(v) && v.length <= 9) return new Set<PlausibleType>(['text']);

  // URL — paths and protocols are exclusive, so a URL value
  // cannot ALSO be a folder/app/window/cmd target.
  if (isUrlLike(v)) {
    return new Set<PlausibleType>(['url', 'browser', 'text']);
  }

  // Windows / UNC / POSIX path → folder / app / doc, never URL.
  if (isPathLike(v)) {
    if (isExeLike(v)) return new Set<PlausibleType>(['app', 'text', 'cmd']);
    // Text docs (.txt/.md/.markdown) — memo is a sensible alt to the
    // standard file-card path; load contents into a memo body. 'doc' is
    // also valid since memo can fall back to a regular doc card.
    if (isTextDocLike(v)) return new Set<PlausibleType>(['memo', 'doc', 'folder', 'app', 'text']);
    // Document extensions (.docx / .pptx / .pdf / .hwp + user custom) →
    // surface 'doc' as the recommended option, with folder/app as
    // alternatives. The `docExtensions` arg threads the user's customised
    // list from settings; omit it and we fall back to defaults. Without
    // 'doc' in this set the auto-correct effect in ItemDialog snaps a
    // dropped .pptx down to 'folder' (v1.3.34 regression, fixed in v1.3.41).
    if (isDocLike(v, docExtensions)) return new Set<PlausibleType>(['doc', 'folder', 'app', 'text']);
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
