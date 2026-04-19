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
}

export type AppMode = 'normal' | 'pin' | 'node' | 'deck';

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

export interface AppData {
  spaces: Space[];
  settings: AppSettings;
  shortcut: string;
  collapsedSpaceIds?: string[];  // UI state: which spaces are collapsed
  nodeGroups?: NodeGroup[];      // linked item groups for split-screen
  decks?: Deck[];               // sequential launch groups
  dismissedSuggestions?: string[]; // DEPRECATED — kept for migration; read via migrateData
  dismissals?: Record<string, { at: number; count: number }>; // ghost dismissal cooldown: value → last dismiss time + count
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
