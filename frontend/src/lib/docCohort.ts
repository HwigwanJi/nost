// ── Document cohort tokenizer + comparator ───────────────────────────
//
// SSOT for "how does nost recognise versions of the same document and
// rank them?". Consumers (DocCohortDialog, main.js scan IPC, settings
// preview) all funnel through `detectPattern` + `extractToken` +
// `compareTokens`. Adding a new pattern preset means editing this file
// AND `types.ts::TokenPreset` only — no per-card storage, no scattered
// regex copies.
//
// Why this file ships token logic in the renderer even though main.js
// also classifies files:
//   - The renderer-side classifier is what generates `pattern` (stored
//     in LauncherItem.docCohort) and runs the "다른 파일 선택" rank
//     preview. main.js can re-use the same regex literals (it does, via
//     duplicated constants — see DEFAULT_DOC_EXTS pattern earlier) but
//     never needs the comparator.
//
// All regexes are anchored at the basename, NOT the path — callers
// strip the directory before passing in.
//
// (v1.3.34, doc cohort feature spec — `plans/doc-cohort-v1.md` for the
//  full design narrative.)

import type { TokenPreset } from '../types';

// ── Token extraction ─────────────────────────────────────────────────
//
// Each preset is { regex, extract } where:
//   - regex matches the *full basename* (extension included), with the
//     version token in a named capture group.
//   - extract converts the raw capture into a comparable value object.
//
// The masked pattern returned via `maskFromMatch` uses `{token}` as the
// placeholder so the renderer can show e.g. "기획서_v{ver}.docx" in the
// detection-confirmation dialog.

interface PresetRule {
  /** Regex matching the basename. Token positions captured by name. */
  regex: RegExp;
  /** Token positions (groups) IN PRIORITY ORDER. For composite tokens
   *  the first key is the primary comparator and subsequent keys are
   *  tiebreakers. */
  groups: string[];
  /** Convert each captured string to a numeric/string comparable. The
   *  array maps 1:1 with `groups`. Returns null on extraction failure. */
  toComparable: (caps: Record<string, string>) => Array<number | string> | null;
}

const RX_INT  = '(?<v>\\d+)';
const RX_SEMVER = '(?<v>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)';
const RX_DATE_YYMMDD   = '(?<y>\\d{2})(?<m>\\d{2})(?<d>\\d{2})';
const RX_DATE_YYYYMMDD = '(?<y>\\d{4})(?<m>\\d{2})(?<d>\\d{2})';
const RX_DATE_ISO      = '(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})';
const RX_DATE_DOTTED   = '(?<y>\\d{4})\\.(?<m>\\d{2})\\.(?<d>\\d{2})';

const PRESETS: Record<Exclude<TokenPreset, 'mtime'>, PresetRule> = {
  numeric: {
    // Matches `_v3.docx`, `-v10.pdf`, `_v3_final.docx`.
    regex: new RegExp(`(?<base>.*?)[_\\-]v${RX_INT}(?<suffix>.*?)(?<ext>\\.[^.]+)?$`),
    groups: ['v'],
    toComparable: c => [parseInt(c.v, 10)],
  },
  semver: {
    // Matches `1.2.3` somewhere in the basename (not date-like 1234.56.78).
    regex: new RegExp(`(?<base>.*?)${RX_SEMVER}(?<suffix>.*?)(?<ext>\\.[^.]+)?$`),
    groups: ['v', 'minor', 'patch'],
    toComparable: c => [parseInt(c.v, 10), parseInt(c.minor, 10), parseInt(c.patch, 10)],
  },
  'date-yymmdd': {
    regex: new RegExp(`(?<base>.*?)${RX_DATE_YYMMDD}(?<suffix>.*?)(?<ext>\\.[^.]+)?$`),
    groups: ['y', 'm', 'd'],
    toComparable: c => [parseInt('20' + c.y, 10), parseInt(c.m, 10), parseInt(c.d, 10)],
  },
  'date-yyyymmdd': {
    regex: new RegExp(`(?<base>.*?)${RX_DATE_YYYYMMDD}(?<suffix>.*?)(?<ext>\\.[^.]+)?$`),
    groups: ['y', 'm', 'd'],
    toComparable: c => [parseInt(c.y, 10), parseInt(c.m, 10), parseInt(c.d, 10)],
  },
  'date-iso': {
    regex: new RegExp(`(?<base>.*?)${RX_DATE_ISO}(?<suffix>.*?)(?<ext>\\.[^.]+)?$`),
    groups: ['y', 'm', 'd'],
    toComparable: c => [parseInt(c.y, 10), parseInt(c.m, 10), parseInt(c.d, 10)],
  },
  'date-dotted': {
    regex: new RegExp(`(?<base>.*?)${RX_DATE_DOTTED}(?<suffix>.*?)(?<ext>\\.[^.]+)?$`),
    groups: ['y', 'm', 'd'],
    toComparable: c => [parseInt(c.y, 10), parseInt(c.m, 10), parseInt(c.d, 10)],
  },
  label: {
    // Built dynamically because the label list is user-configurable.
    // We seed an empty regex here; callers use buildLabelRegex below.
    regex: new RegExp('$^'),
    groups: ['label'],
    toComparable: () => null, // overridden in resolveLabelComparator
  },
  // ── Composite presets ────────────────────────────────────────────
  // The user's "20260513_RE4" case: date primary, RE int 2nd. We pick
  // a strict regex (RE must follow `_RE` literal) so it doesn't gobble
  // plain dates without a revision suffix.
  'date-yyyymmdd_re': {
    regex: new RegExp(`(?<base>.*?)${RX_DATE_YYYYMMDD}_RE(?<rev>\\d+)(?<suffix>.*?)(?<ext>\\.[^.]+)?$`),
    groups: ['y', 'm', 'd', 'rev'],
    toComparable: c => [parseInt(c.y, 10), parseInt(c.m, 10), parseInt(c.d, 10), parseInt(c.rev, 10)],
  },
  'date-iso_v': {
    regex: new RegExp(`(?<base>.*?)${RX_DATE_ISO}[_\\-]v(?<rev>\\d+)(?<suffix>.*?)(?<ext>\\.[^.]+)?$`),
    groups: ['y', 'm', 'd', 'rev'],
    toComparable: c => [parseInt(c.y, 10), parseInt(c.m, 10), parseInt(c.d, 10), parseInt(c.rev, 10)],
  },
  'semver-build': {
    regex: new RegExp(`(?<base>.*?)${RX_SEMVER}-build(?<build>\\d+)(?<suffix>.*?)(?<ext>\\.[^.]+)?$`),
    groups: ['v', 'minor', 'patch', 'build'],
    toComparable: c => [parseInt(c.v, 10), parseInt(c.minor, 10), parseInt(c.patch, 10), parseInt(c.build, 10)],
  },
  'label-rev': {
    // Resolved at runtime — see resolveLabelComparator.
    regex: new RegExp('$^'),
    groups: ['label', 'rev'],
    toComparable: () => null,
  },
};

// ── Label regex builder (uses user-configurable label list) ──────────
function buildLabelRegex(labelOrder: string[]): RegExp {
  // Escape special chars in each label so users can't break the regex
  // with hex/punctuation labels.
  const alts = labelOrder
    .map(l => l.replace(/[-\\/\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('|');
  return new RegExp(`(?<base>.*?)[_\\-](?<label>${alts})(?<suffix>.*?)(?<ext>\\.[^.]+)?$`, 'i');
}
function buildLabelRevRegex(labelOrder: string[]): RegExp {
  const alts = labelOrder
    .map(l => l.replace(/[-\\/\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('|');
  return new RegExp(`(?<base>.*?)[_\\-](?<label>${alts})[_\\-]rev(?<rev>\\d+)(?<suffix>.*?)(?<ext>\\.[^.]+)?$`, 'i');
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Result of matching a filename against a preset.
 */
export interface TokenMatch {
  /** The preset that matched. */
  preset: TokenPreset;
  /** Comparable token (array, primary first). null when mtime fallback. */
  token: Array<number | string> | null;
  /** Masked basename — replaces the token portion with `{token}`. Used
   *  as `LauncherItem.docCohort.pattern` and shown to the user in the
   *  detection confirmation dialog. */
  mask: string;
}

/** Strip directory, return just the basename component. */
export function basenameOf(absPath: string): string {
  const cleaned = absPath.replace(/[\\/]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('\\'), cleaned.lastIndexOf('/'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/**
 * Try each enabled preset in order against `basename`. Returns the first
 * match (so users can prioritise composites over plain `numeric`).
 *
 * Returns null when no preset matches — caller falls back to `mtime`.
 */
export function detectPattern(
  basename: string,
  enabledPresets: TokenPreset[],
  labelOrder: string[],
): TokenMatch | null {
  for (const preset of enabledPresets) {
    if (preset === 'mtime') continue; // fallback only, never matches by name
    const match = matchPreset(basename, preset, labelOrder);
    if (match) return match;
  }
  return null;
}

/**
 * Apply ONE specific preset to a filename. Used by the rank step (we
 * already know the binding's preset) and by user-driven "다른 패턴" UI.
 */
export function matchPreset(
  basename: string,
  preset: TokenPreset,
  labelOrder: string[],
): TokenMatch | null {
  if (preset === 'mtime') {
    // Not extractable from the name — caller supplies mtime separately.
    return { preset: 'mtime', token: null, mask: basename };
  }

  if (preset === 'label') {
    const regex = buildLabelRegex(labelOrder);
    const m = regex.exec(basename);
    if (!m || !m.groups) return null;
    const labelIdx = labelOrder.findIndex(l => l.toLowerCase() === m.groups!.label.toLowerCase());
    if (labelIdx < 0) return null;
    return {
      preset,
      token: [labelIdx], // higher index = newer
      mask: rebuildMask(m.groups, ['label']),
    };
  }

  if (preset === 'label-rev') {
    const regex = buildLabelRevRegex(labelOrder);
    const m = regex.exec(basename);
    if (!m || !m.groups) return null;
    const labelIdx = labelOrder.findIndex(l => l.toLowerCase() === m.groups!.label.toLowerCase());
    if (labelIdx < 0) return null;
    return {
      preset,
      token: [labelIdx, parseInt(m.groups.rev, 10)],
      mask: rebuildMask(m.groups, ['label', 'rev']),
    };
  }

  const rule = PRESETS[preset];
  const m = rule.regex.exec(basename);
  if (!m || !m.groups) return null;
  const comparable = rule.toComparable(m.groups);
  if (!comparable) return null;
  return {
    preset,
    token: comparable,
    mask: rebuildMask(m.groups, rule.groups),
  };
}

/**
 * Rebuild the basename with the token portion replaced by `{token}`.
 * Uses the regex named groups: `base` + (token slots) + `suffix` + `ext`.
 * Token slot groups are replaced with a literal `{token}` placeholder so
 * the user sees a single canonical mask regardless of how many parts
 * compose the token.
 */
function rebuildMask(groups: Record<string, string>, tokenGroupNames: string[]): string {
  // We reconstruct from the named groups deterministically rather than
  // re-running the regex with replace because composite tokens have
  // multiple capture positions in arbitrary order in the source pattern,
  // and we want a single `{token}` placeholder anyway.
  // For visual purposes, just splice base + {token} + suffix + ext.
  const base   = groups.base   ?? '';
  const suffix = groups.suffix ?? '';
  const ext    = groups.ext    ?? '';
  // tokenGroupNames is unused for splicing but kept on the signature so
  // future presets that want a more elaborate mask (showing the literal
  // separator between primary/secondary) can read groups directly.
  void tokenGroupNames;
  return `${base}{token}${suffix}${ext}`;
}

/**
 * Compare two extracted tokens — used to rank scan results.
 * Returns: positive if A is newer, negative if A is older, 0 if equal.
 *
 * Composite tokens are compared lexicographically (primary first), which
 * yields the right behaviour for date+revision: same-date entries fall
 * back to the revision tiebreaker.
 */
export function compareTokens(
  a: Array<number | string> | null,
  b: Array<number | string> | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1; // null sorts as oldest
  if (b === null) return 1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) return av - bv;
      continue;
    }
    // Mixed / string fallback — lexical compare.
    const cmp = String(av).localeCompare(String(bv));
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/**
 * Resolve a list of scan results into ranked order (newest first).
 * Files that don't match the preset are dropped UNLESS `mtimeFallback`
 * is set, in which case they're appended at the end sorted by mtime.
 */
export interface ScanCandidate {
  basename: string;
  /** Absolute path. */
  path: string;
  /** OS modification time, Unix ms. Used for mtime fallback ranking. */
  mtime: number;
}

export interface RankedCandidate extends ScanCandidate {
  match: TokenMatch | null;
}

export function rankCandidates(
  candidates: ScanCandidate[],
  preset: TokenPreset,
  labelOrder: string[],
): RankedCandidate[] {
  const annotated = candidates.map<RankedCandidate>(c => ({
    ...c,
    match: matchPreset(c.basename, preset, labelOrder),
  }));

  if (preset === 'mtime') {
    return annotated.sort((a, b) => b.mtime - a.mtime);
  }

  // Matched first (sorted by token desc), then non-matched by mtime as
  // a quiet fallback so the dialog still shows neighbours even when the
  // pattern is wrong.
  const matched   = annotated.filter(a => a.match?.token != null);
  const unmatched = annotated.filter(a => a.match?.token == null);
  matched.sort((a, b) => compareTokens(b.match!.token, a.match!.token));
  unmatched.sort((a, b) => b.mtime - a.mtime);
  return [...matched, ...unmatched];
}
