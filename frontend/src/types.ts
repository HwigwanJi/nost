export interface ContainerSlots {
  up?:    string; // LauncherItem id (cross-space)
  down?:  string;
  left?:  string;
  right?: string;
}

export interface LauncherItem {
  id: string;
  title: string;
  type: 'url' | 'folder' | 'app' | 'window' | 'browser' | 'text' | 'cmd';
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
}

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
  /** Orb size preset. */
  size: 'small' | 'normal';
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
}

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
