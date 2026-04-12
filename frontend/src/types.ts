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
  dismissedSuggestions?: string[]; // ghost card dismissed values (permanent until reset)
}

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
