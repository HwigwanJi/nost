export interface ContainerSlots {
  up?:    string; // LauncherItem id (cross-space)
  down?:  string;
  left?:  string;
  right?: string;
}

/**
 * Widget descriptor — embedded in a LauncherItem when type === 'widget'.
 *
 * Why a separate field rather than encoding everything in `value`:
 * widgets have multiple structured config fields (kind, options) and
 * future widget kinds will diverge in shape. Treating `widget` as a
 * tagged-union sub-document keeps each kind's options strongly typed.
 *
 * Why widget-as-LauncherItem rather than a parallel `widgets[]` array:
 * widgets share the grid, drag-reorder, pair-layout, color/rename,
 * and persistence story with normal cards. Replicating that
 * infrastructure for a separate array is half the codebase. The cost
 * is gating: every place that LAUNCHES an item needs to skip widgets
 * (they don't launch — they self-render). Search through item.type
 * === 'widget' for those gates.
 */
export type WidgetKind = 'media-control' | 'color-swatch';
// extensible later: 'clock' | 'weather' | 'task-counter' | …

export interface MediaControlWidgetOptions {
  /** Reserved for future targeted-session pinning. v1 always uses
   *  Windows' "current" media session. */
  preferredAppId?: string;
}

export interface ColorSwatchOptions {
  /** Full hex string with leading "#" — `#RRGGBB`. We normalise
   *  3-char shorthand and uppercase at write time so the renderer
   *  can render `#RRGGBB` deterministically. */
  hex: string;
  /** Optional friendly label. When absent, the widget falls back to
   *  the LauncherItem's `title`. Pantone-style: hex always shown,
   *  name is supplementary. */
  name?: string;
}

/**
 * Discriminated union of widget kinds — `kind` is the discriminator,
 * `options` is the kind-specific payload. Renderers branch on
 * `widget.kind` and can rely on the matching options shape thanks
 * to the narrowing.
 */
export type WidgetData =
  | { kind: 'media-control';  options?: MediaControlWidgetOptions }
  | { kind: 'color-swatch';   options: ColorSwatchOptions };

/**
 * Memo (사라지는 메모) — embedded in a LauncherItem when type === 'memo'.
 *
 * Why a separate sub-document rather than reusing `value` for the body:
 * memos carry a *time dimension* (TTL, last-touched, trash) that no other
 * card type cares about. Folding it into `value` would force every
 * non-memo code path to interpret JSON-in-a-string. Following the same
 * tagged-union pattern as `widget`.
 *
 * Lifecycle:
 *   - Created: createdAt = now, expiresAt = now + defaultTtl, lastTouchedAt = now
 *   - Edited / 점 톡 살리기: lastTouchedAt = now, expiresAt = now + defaultTtl (RESET)
 *   - 핀: pinned=true on the parent LauncherItem — expiresAt is ignored
 *   - 만료 (now > expiresAt && !pinned): trashedAt is set to that moment
 *   - 휴지통 보관 만료 (now - trashedAt > trashRetentionHours): hard-delete
 *
 * The body's first non-empty line is the card title — single source of
 * truth, no separate title field. Migration of legacy items keeps the
 * LauncherItem.title in sync at write time so other places (search,
 * accessibility) can read item.title without parsing the body.
 */
export interface MemoData {
  /** Plain text body. First non-empty line acts as the title. */
  body: string;
  /** Unix ms when the memo was first created. */
  createdAt: number;
  /** Unix ms when the memo expires (auto-trashes). Ignored when item.pinned. */
  expiresAt: number;
  /** Unix ms of the last edit OR 점 톡 살리기. Used to display "마지막 수정". */
  lastTouchedAt: number;
  /** Unix ms when the memo entered the trash. Absent = active memo. */
  trashedAt?: number;
}

/** Memo subsystem settings — lives on AppSettings.memo. */
export interface MemoSettings {
  /** New-memo TTL in days. 1~90. Per-memo expiresAt is BAKED at creation;
   *  changing this here only affects future memos and future "톡 살리기"
   *  resets. (Decision 1 from plans/memo-feature-v1.md.) */
  defaultTtlDays: number;
  /** Trash retention before hard-delete: 24h / 72h / 168h (1w). */
  trashRetentionHours: 24 | 72 | 168;
  /** Optional override for txt export folder. Empty = use default
   *  (`%APPDATA%/nost/memos/`) chosen by main process. */
  exportFolder?: string;
}

export interface LauncherItem {
  id: string;
  title: string;
  /**
   * v1.3.34 — `'doc'` is a first-class type now. Previously every file
   * that wasn't an `.exe/.lnk` got bucketed into `'app'`; that erased
   * the user-meaningful distinction between an executable and a
   * document, and made the doc-cohort feature impossible to gate on
   * type alone. Launch behaviour is identical to `'app'` (Windows
   * shell-execute via `launchOrFocusApp`) — only the classification
   * and the rendered icon/hover differ. Migration of existing `'app'`
   * cards happens in useAppData.migrateData.
   */
  type: 'url' | 'folder' | 'app' | 'doc' | 'window' | 'browser' | 'text' | 'cmd' | 'widget' | 'memo';
  /**
   * For type !== 'widget': the launchable payload (URL, file path, cmd line, …).
   * For type === 'widget': not used — widgets render from `widget.kind` instead.
   * Kept as an empty string for back-compat with any code that reads it
   * unconditionally; widget-aware code paths should branch on `type`.
   */
  value: string;
  icon?: string; // material symbol name or data URL
  iconType?: 'material' | 'image';
  color?: string; // hex
  clickCount?: number;
  lastClickedAt?: number; // epoch ms — drives freshness/staleness signals
  pinned?: boolean;
  monitor?: number;  // preferred monitor (1-indexed); undefined = no preference
  exePath?: string;  // for 'window' items: exe path to relaunch when window is closed
  hiddenInSpace?: boolean; // item lives in a space but is hidden from space grid (e.g. in container slot)
  // Container
  isContainer?: boolean;
  slots?: ContainerSlots;
  // Widget — populated only when type === 'widget'. Consumers must
  // treat the absence of this field as "regular launchable item" even
  // for type === 'widget' (defensive; the migration writes it but a
  // future bug shouldn't crash the renderer).
  widget?: WidgetData;
  // Memo — populated only when type === 'memo'. Same defensive policy
  // as `widget`: if absent on a 'memo'-typed item, render as if empty.
  memo?: MemoData;
  /**
   * Document cohort (v1.3.34+) — when present, the card represents the
   * "latest version of a family of files". Set lazily the first time the
   * user invokes "최신 버전 확인" on a doc-like card; never auto-populated
   * at card creation (the user is presumed to register the latest file).
   *
   * Stored fields are minimal on purpose — token rules live globally in
   * AppSettings.docCohort so per-card storage doesn't drift. The pattern
   * field captures the masked basename (e.g. "기획서_v{ver}.docx") which
   * is regenerated from `tokenType` on every scan, but caching it here
   * lets the next "최신 확인" skip the detection dialog.
   */
  docCohort?: DocCohortBinding;
}

/**
 * Per-card cohort binding — establishes WHICH file family a card belongs
 * to. Token rules themselves (how to compare two filenames) live in
 * `AppSettings.docCohort` as the SSOT so adding a new preset doesn't
 * require touching every card.
 */
export interface DocCohortBinding {
  /** Absolute directory to scan (the dirname of the card's `value` at
   *  the moment the cohort was first established). */
  directory: string;
  /** Masked basename with a single `{token}` placeholder for the version
   *  position. e.g. `"기획서_v{ver}.docx"` for `_v{numeric}` matching, or
   *  `"{date}_RE{ver}_제안서.docx"` for the date+revision composite. */
  pattern: string;
  /** Which global token preset's comparator + extractor to use when
   *  ranking files matched by `pattern`. */
  tokenType: TokenPreset;
}

/**
 * Token preset — encodes BOTH how to extract a token from a filename
 * AND how to rank two extracted tokens. Composites carry an implicit
 * priority order (primary key, secondary tiebreaker).
 *
 *   numeric            _v3 _v10               (single int, larger = newer)
 *   semver             1.2.3                  (semver, larger = newer)
 *   date-yymmdd        240513                 (compact 6-digit date)
 *   date-yyyymmdd      20240513               (compact 8-digit date)
 *   date-iso           2024-05-13             (dashed)
 *   date-dotted        2024.05.13             (dotted)
 *   label              draft/review/final     (user-defined hierarchy)
 *   date-yyyymmdd_re   20260513_RE4           (date primary, RE int 2nd)
 *   date-iso_v         2024-05-13_v2          (date primary, _v int 2nd)
 *   semver-build       1.2.3-build42          (semver primary, build int 2nd)
 *   label-rev          final_rev2             (label primary, _rev int 2nd)
 *   mtime              (no filename token)    OS modification time fallback
 */
export type TokenPreset =
  | 'numeric' | 'semver'
  | 'date-yymmdd' | 'date-yyyymmdd' | 'date-iso' | 'date-dotted'
  | 'label'
  | 'date-yyyymmdd_re' | 'date-iso_v' | 'semver-build' | 'label-rev'
  | 'mtime';

/** Default order — user can drag-reorder in 콘텐츠 규칙 > 문서. */
export const DEFAULT_DOC_LABEL_ORDER = ['draft', 'wip', 'review', 'revised', 'final'] as const;

export interface DocCohortSettings {
  /** Token presets the user has enabled. Order in this array DOES matter
   *  — auto-detection tries them top-down and picks the first that matches. */
  enabledPresets: TokenPreset[];
  /** Label hierarchy for the `label` and `label-rev` token kinds.
   *  Earlier = older, later = newer. */
  labelOrder: string[];
}

export const DEFAULT_DOC_COHORT_SETTINGS: DocCohortSettings = {
  enabledPresets: [
    // Composites first so date+revision wins over plain numeric on filenames
    // that happen to match both shapes (the user's "20260513_RE4" case).
    'date-yyyymmdd_re', 'date-iso_v', 'semver-build', 'label-rev',
    'semver', 'date-yyyymmdd', 'date-yymmdd', 'date-iso', 'date-dotted',
    'numeric', 'label',
    'mtime',
  ],
  labelOrder: [...DEFAULT_DOC_LABEL_ORDER],
};

export interface Space {
  id: string;
  name: string;
  items: LauncherItem[];
  color?: string;
  icon?: string;  // emoji or material symbol name
  sortMode?: 'custom' | 'usage';
  pinnedIds?: string[];

  // ── Layout pairing (Phase 3) ───────────────────────────────
  // Rows are either solo (1 space, full width) or a pair (2 spaces splitting the
  // width). `pairedWithNext=true` means this space shares its row with the NEXT
  // space in the array. Enforced invariant (see enforcePairInvariant): a chain
  // of pairs is impossible — `spaces[i].pairedWithNext === true` guarantees
  // `spaces[i+1].pairedWithNext === false`.
  pairedWithNext?: boolean;
  // Fraction of the pair's width occupied by THIS (the left) space. Only read
  // when pairedWithNext is true. Clamped to [0.25, 0.75]; default 0.5.
  splitRatio?: number;

  /** @deprecated replaced by pairedWithNext/splitRatio; dropped in migrateData() */
  widthWeight?: number;
  /** @deprecated replaced by pairedWithNext/splitRatio; dropped in migrateData() */
  columnSpan?: 1 | 2;
}

export interface FloatingButtonSettings {
  /** Master toggle: off = no floating window. */
  enabled: boolean;
  /** Orb fill opacity in the idle (not-hovered) state, 0.3–1.0. */
  idleOpacity: number;
  /** Orb size in pixels (28–72 typical). Legacy 'small' / 'normal' values
   *  from pre-v1.3.8 settings are migrated at read time in main.js. */
  size: number | 'small' | 'normal';
  /** Hide the orb automatically while a fullscreen app has focus. */
  hideOnFullscreen: boolean;
  /** Last stored position. Defaults to bottom-right on primary display when absent. */
  position?: { x: number; y: number };
}

export interface AppSettings {
  opacity: number;
  closeAfterOpen: boolean;
  shortcut: string;
  theme: 'light' | 'dark';
  autoLaunch?: boolean;          // start with Windows
  autoHide?: boolean;            // hide when focus is lost
  accentColor?: string;          // custom accent color (hex)
  documentExtensions?: string[]; // file extensions treated as documents
  monitorDirections?: Record<number, 'w' | 'a' | 's' | 'd' | 'c'>; // Key assigned to each monitor: wasd = direction, c = current
  floatingButton?: FloatingButtonSettings; // Phase 1: main FAB only
  /**
   * Global pixel size of the floating SPACE/NODE/DECK badges (the small
   * round chips pinned on monitor edges — NOT the main FAB orb, which has
   * its own `floatingButton.size`). One value applies to every badge so
   * the user gets a consistent visual rhythm across pinned refs; per-badge
   * sizing was deliberately rejected to keep the overlay legible at a
   * glance. Range matches the FAB slider (28..72 px) for muscle memory.
   */
  badgeSize?: number;
  /**
   * Launcher window size, expressed as a percentage of the active
   * monitor's work area (25..100). Same semantic as the `/75`
   * slash command: `setBounds(workArea * pct/100, centered)`. NOT a
   * content zoom — the BrowserWindow itself shrinks/grows on screen.
   *
   * Single source of truth for every code path that resizes the
   * launcher: `/N` slash command, status-bar slider, settings dialog
   * preset, and cold-start initial sizing all read/write this field.
   * Persisted, so the size survives restarts and applies on every
   * subsequent invocation.
   */
  windowSizePct?: number;
  /**
   * Where to place the launcher window when it opens.
   *   'cursor' → centre on the monitor that currently has the mouse
   *              cursor (default; matches "go to the screen the user
   *              is looking at" intuition for global-shortcut triggers)
   *   'last'   → restore the last on-screen position the user had it
   *              at; persists across hide/show. Useful for users who
   *              keep the launcher pinned in a corner and don't want
   *              it teleporting between monitors.
   * Setting is read in `toggleMainWindow` (main.js). Defaults to
   * 'cursor' to preserve historic behaviour when absent.
   */
  windowOpenAt?: 'cursor' | 'last';
  license?: License;             // Phase 5: paid-tier entitlement cache
  memo?: MemoSettings;           // Memo feature (v1.3.16+)
  /**
   * "Has the browser extension EVER connected to this install?" — set
   * to true the first time main.js receives an SSE handshake from the
   * Chrome extension, never reset by code (only manual clear via
   * Settings → 데이터 → 초기화). Drives the "calm-by-default" extension
   * notification rule (v1.3.33+):
   *   - `false` → user has never connected the extension. After the
   *     40 s grace, fire ONE passive tip in the notification center
   *     suggesting install.
   *   - `true`  → user has confirmed the extension works at least once.
   *     Subsequent disconnects (Chrome service worker sleeping while
   *     unfocused) are SILENT — we don't pop a notification on every
   *     sleep cycle. If a real failure happens *at the use-site*
   *     (smart scan returns no tabs, browser-tab card launch reports
   *     no bridge), the consumer surfaces an actionable notification
   *     at that moment instead.
   */
  extensionEverConnected?: boolean;
  /**
   * Doc cohort token rules — single source of truth for "how to recognise
   * the latest file in a family". Applied uniformly when ANY doc card
   * invokes "최신 버전 확인". See DocCohortSettings for the shape.
   * Absent on legacy installs; migrateData seeds DEFAULT_DOC_COHORT_SETTINGS.
   */
  docCohort?: DocCohortSettings;
}

/** Default launcher size = full work area on cold start when the
 *  field is absent. */
export const DEFAULT_WINDOW_SIZE_PCT = 100;
export const WINDOW_SIZE_PCT_MIN = 25;
export const WINDOW_SIZE_PCT_MAX = 100;
/** Presets shown in the status-bar dropdown and settings preset modal.
 *  Mirrors the canonical `/N` slash commands plus a couple of in-between
 *  steps for fine control without typing. */
export const WINDOW_SIZE_PCT_PRESETS = [25, 33, 50, 66, 75, 100] as const;

/** Default pixel size for floating badges — matches the historical
 *  hardcoded constant in Badge.tsx so users on existing installs see no
 *  visual change after the upgrade. */
export const DEFAULT_BADGE_SIZE = 46;

/** Memo defaults — applied at migration time when settings.memo is absent. */
export const DEFAULT_MEMO_SETTINGS: MemoSettings = {
  defaultTtlDays: 7,
  trashRetentionHours: 24,
};

/** Memo TTL configuration limits. */
export const MEMO_TTL_DAYS_MIN = 1;
export const MEMO_TTL_DAYS_MAX = 90;

// ── Notifications (v1.3.16+) ─────────────────────────────────────
//
// In-app bell-icon + popover, modelled after Slack/GitHub/Notion.
// Calm-by-default: no auto-popups, no toast duplication, no count
// badges (only a single 6px dot when there's something unread).
// The store keeps every notification ever shown until either
// `dismissedAt` is set or 30 days pass since `createdAt` (whichever
// comes first) — sweep happens at app start.
//
// Why a flat array rather than a stream of events:
//   - Volume is low (we expect <10 alive at any time)
//   - Renderer needs random access for dismiss / mark-read
//   - No need for fan-out subscribers (single panel consumer)
//
// Sources writing notifications:
//   - electron-updater "update available" / "downloaded"  → update
//   - License sync — trial expiring, period ending        → billing
//   - First-touch discoveries (e.g. first memo created)   → discovery
//   - Errors the user must know about (ext disconnect,    → system
//     boot failures, license sync failures)
//   - Lightweight prompts / tutorial nudges               → tip
// Future: mission-style billing-day rewards.

export type NotificationKind = 'update' | 'billing' | 'discovery' | 'system' | 'tip';

export interface NotificationAction {
  /** Korean label shown on the row's accent button. */
  label: string;
  /** What happens on click — handled by App.tsx's central dispatcher
   *  (see `handleNotificationAction`). Adding a new intent is an O(1)
   *  switch case there. */
  intent:
    | 'check-update'      // re-trigger update check
    | 'install-update'    // call electronAPI.installUpdate()
    | 'open-billing'      // open paywall / billing settings
    | 'open-tour'         // start an onboarding tour
    | 'open-settings'     // open settings dialog (optional tab in payload)
    | 'open-trash'        // open memo trash
    | 'noop';             // dismiss-only (handler still runs)
  /** Optional payload — e.g. settings tab id, tour id. Free-form so
   *  individual sources can ride along without expanding NotificationKind. */
  payload?: string;
}

export interface AppNotification {
  /** UUID-ish, generated at creation. */
  id: string;
  kind: NotificationKind;
  /** One-line headline (≤ ~40 chars renders cleanly without ellipsis). */
  title: string;
  /** Optional second line — clamped to 2 lines in the panel. */
  body?: string;
  action?: NotificationAction;
  /** Unix ms — used both for relative-time display and 30-day sweep. */
  createdAt: number;
  /** Unix ms when the panel was first opened with this notification
   *  visible. Read state is "have you seen the panel since this
   *  arrived" — there's no per-row click-to-read affordance. */
  readAt?: number;
  /** Unix ms when ✕ was clicked or "모두 비우기" ran. Dismissed
   *  notifications stay in the array (for audit / undo) but are
   *  filtered out of the panel. The 30-day sweep eventually purges
   *  them. */
  dismissedAt?: number;
  /** Optional dedup key — sources that fire repeatedly (e.g. update
   *  available pinging every check) set a stable key so we don't
   *  pile up identical notifications. Caller is responsible for
   *  consistency; the store treats it as opaque. */
  dedupKey?: string;
}

/** Hard-purge anything older than this even if not dismissed.
 *  Prevents the array from growing unbounded for users who never
 *  open the bell. */
export const NOTIFICATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// ── Licensing & Entitlement (Phase 5) ─────────────────────────────
//
// The license record is the client-side cache of what the backend knows about
// this user's subscription. Authoritative source is the server's
// /api/license/verify endpoint; the client stores the last verified snapshot
// so offline usage has a grace window (see LICENSE_GRACE_DAYS below).
//
// `tier === 'pro'` is ONLY honoured when:
//   - status === 'active' AND periodEndsAt > now, OR
//   - status === 'trial'  AND trialEndsAt  > now, OR
//   - status === 'active' AND periodEndsAt + GRACE > now (7-day soft expiry)
//
// Anything outside of that collapses to effective free-tier. The hook
// `useEntitlement` (see hooks/useEntitlement.ts) centralises this policy so
// component call sites never reinvent the predicate.

export type LicenseTier = 'free' | 'pro';

export type LicenseStatus =
  | 'none'          // never signed in / paid
  | 'trial'         // in free-trial window
  | 'active'        // paid, billing-key live
  | 'past_due'      // last auto-charge failed; in grace window
  | 'canceled'      // user canceled; active until periodEndsAt
  | 'expired';      // past periodEndsAt + grace

export interface License {
  tier: LicenseTier;
  status: LicenseStatus;
  /** Server-issued email or user id; for display. */
  identity?: string;
  /** Unix ms when the trial started locally (trial is client-awarded once). */
  trialStartedAt?: number;
  /** Unix ms when the trial expires. */
  trialEndsAt?: number;
  /** Unix ms when the current paid period ends (renewal target). */
  periodEndsAt?: number;
  /** Server-issued opaque token used with /license/verify. */
  licenseKey?: string;
  /** Device fingerprint registered with the server (ours). */
  deviceId?: string;
  /** Last successful /license/verify timestamp — used for offline grace. */
  lastVerifiedAt?: number;
}

/** Free-plan limits. A Pro subscription removes every cap.
 *  Tuned 2026-05-15 per founder decision:
 *    - totalCards 16 (was 20) — tighter to push earlier upgrade signal
 *    - 노드/덱/플로팅뱃지/위젯 1 — "맛보기 1개씩" 일관 정책
 *    - presets 1 — 프리셋 2/3 잠금
 *    - containerEnabled false — 컨테이너 슬롯 Pro 전용
 *    - memo: 마크다운 에디터 / .md 저장 / 폴더 sync 모두 Pro 전용 (false)
 */
export const FREE_LIMITS = {
  /** Max cards across ALL spaces in the active preset. */
  totalCards: 16,
  /** Max spaces in the active preset. */
  spaces: 4,
  /** Max nodes in the active preset. */
  nodes: 1,
  /** Max decks in the active preset. */
  decks: 1,
  /** Max floating badges (any type). */
  floatingBadges: 1,
  /** Max widget cards (media, future kinds). */
  widgets: 1,
  /** Presets 2 and 3 are Pro-only; preset 1 is always free. */
  presets: 1,
  /** Container feature (slot-based cards) is Pro-only. */
  containerEnabled: false,
  /** Markdown rich editor for memo body (live preview + toolbar). Pro. */
  memoMarkdownEditor: false,
  /** Save memo body as .md file. Pro. */
  memoMdExport: false,
  /** Auto-mirror memos to a user-chosen folder (Obsidian vault style). Pro. */
  memoFolderSync: false,
} as const;

/** Trial window length in milliseconds. */
export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** Offline-verify grace window — if server unreachable, Pro remains valid
 *  up to this many days past the last successful verification. */
export const LICENSE_GRACE_DAYS = 7;


export type AppMode = 'normal' | 'pin' | 'node' | 'deck' | 'clean';

export interface Deck {
  id: string;
  name: string;
  itemIds: string[];
  monitor?: number;
}

export interface NodeGroup {
  id: string;
  name: string;       // user-defined workflow name
  itemIds: string[];  // 2~3 item IDs linked together
  monitor?: number;   // preferred monitor for launch
  /** Material Symbol name to show in the node header + on the
   *  floating badge. Falls back to 'hub' when absent (the historic
   *  hardcoded value) so existing stores render unchanged after
   *  upgrade. Same picker pattern as space.icon. */
  icon?: string;
}

/**
 * Floating badge — a pinned-out-of-main-window shortcut to a Space / Node / Deck.
 *
 * All badges render inside ONE overlay BrowserWindow to keep RAM flat (vs one
 * window per badge). The overlay uses `setIgnoreMouseEvents(true, {forward: true})`
 * so clicks pass through the empty canvas, and only flips to capture mode while
 * the pointer is hovering a badge rect.
 */
export interface FloatingBadge {
  id: string;                  // unique (generated at pin time)
  refType: 'space' | 'node' | 'deck';
  refId: string;               // Space.id / NodeGroup.id / Deck.id
  x: number;                   // screen coords (absolute, multi-monitor)
  y: number;
}

/**
 * Preset — a fully independent "board" of spaces + nodes + decks. The app
 * ships with exactly 3 presets (ids '1' / '2' / '3'); the user switches
 * between them via the pill toggle next to the search bar. Everything that
 * represents *user workspace* lives here. Truly global concerns (shortcut,
 * theme, accent, dismissal cooldowns) stay on AppData root.
 */
export interface Preset {
  id: '1' | '2' | '3';
  label: string;                // user-editable, default "프리셋 N"
  spaces: Space[];
  nodeGroups?: NodeGroup[];
  decks?: Deck[];
  collapsedSpaceIds?: string[];
  floatingBadges?: FloatingBadge[];
}

export type PresetId = Preset['id'];

/**
 * App data as seen by components — the active preset's workspace fields are
 * always populated at the top level by the `useAppData` flat-view shim, so
 * hundreds of `data.spaces.map(...)` call sites keep compiling. On-disk the
 * authoritative owner of these fields is `presets[activePresetId]`; the
 * shim mirrors it upward on every render and shreds writes back down.
 */
export interface AppData {
  // ── Active preset's workspace (flat view) ──────────────────────
  // These are *mirrors* of presets[activePresetId] — treat as read-only from
  // the component side; mutate via the hook's `save`, which redirects into
  // the owning preset.
  spaces: Space[];
  nodeGroups?: NodeGroup[];
  decks?: Deck[];
  collapsedSpaceIds?: string[];
  floatingBadges?: FloatingBadge[];

  // ── Preset machinery ───────────────────────────────────────────
  presets: Preset[];             // always length 3 (ids '1' / '2' / '3')
  activePresetId: PresetId;

  // ── Global ─────────────────────────────────────────────────────
  settings: AppSettings;
  shortcut: string;
  dismissedSuggestions?: string[]; // DEPRECATED — migrated into dismissals
  dismissals?: Record<string, { at: number; count: number }>;
  /** Completed-tour ids so we don't auto-start the same one twice. */
  completedTours?: string[];
  /** Bell-icon notification list. Append-only from sources; dismiss
   *  flips dismissedAt. 30-day sweep at app start. See `AppNotification`
   *  for the lifecycle and dedup model. */
  notifications?: AppNotification[];
}

// How long a dismissed suggestion stays hidden (ms). After this window elapses,
// the suggestion may reappear if its signal is still strong.
export const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// An item that hasn't been clicked in this long is considered "stale" and gets
// a subtle visual hint prompting the user to review it.
export const STALE_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export interface ChromeTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface WindowEntry {
  ProcessName: string;
  MainWindowTitle: string;
  FolderPath?: string;  // actual filesystem path (Explorer windows only)
  ExePath?: string;     // executable path (non-Explorer windows)
  HWND?: number;        // window handle for focusing
}

export interface ScanPayload {
  windows: WindowEntry[];
  browserTabs: ChromeTab[];
}
