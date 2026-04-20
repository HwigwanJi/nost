// Electron API bridge — wraps window.electronAPI with type safety
// Falls back gracefully in browser dev mode

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export interface ElectronAPI {
  hideApp: () => void;
  openUrl: (url: string, closeAfter: boolean) => void;
  openPath: (folder: string, closeAfter: boolean) => void;
  openFolder: (folder: string, closeAfter: boolean) => void;
  focusWindow: (title: string, closeAfter: boolean) => Promise<{ success: boolean; error?: string }>;
  launchOrFocusApp: (exePath: string, closeAfter: boolean, monitor?: number) => Promise<{ success: boolean; action?: 'focused' | 'launched'; error?: string }>;
  runCmd: (command: string, closeAfter: boolean) => void;
  copyText: (text: string, closeAfter: boolean) => void;
  getOpenWindows: () => Promise<{ windows: import('./types').WindowEntry[]; browserTabs: import('./types').ChromeTab[] }>;
  setOpacity: (opacity: number) => void;
  updateShortcut: (shortcut: string) => void;
  detectDialog: () => Promise<{ isDialog: boolean; title?: string; className?: string }>;
  jumpToDialogFolder: (folderPath: string) => void;
  storeLoad: () => Promise<unknown>;
  storeSave: (data: unknown) => Promise<boolean>;
  getWindowPosition: () => Promise<[number, number]>;
  moveWindow: (x: number, y: number) => void;
  windowDragEnd: () => void;
  exportData: () => Promise<{ success: boolean; filePath?: string; reason?: string }>;
  importData: () => Promise<{ success: boolean; data?: unknown; reason?: string }>;
  pickFolder: () => Promise<string | null>;
  pickExe: () => Promise<string | null>;
  getFileIcon: (filePath: string) => Promise<string | null>;
  getExtensionBridgeStatus: () => Promise<{
    connected: boolean;
    tabsCount: number;
    lastTabsUpdateAt: number;
    lastExtensionConnectedAt: number;
  }>;
  openExtensionInstallHelper: (targetBrowser: 'chrome' | 'whale') => Promise<{
    success: boolean;
    extensionDir?: string;
    openedFolder?: boolean;
    openedChromePage?: boolean;
    openedWhalePage?: boolean;
    copiedPath?: boolean;
    browser?: 'chrome' | 'whale';
    browserExePath?: string;
    reason?: string;
  }>;
  tileWindows: (items: { type: string; value: string; title: string }[]) => Promise<{ success: boolean; debug?: string; error?: string }>;
  maximizeWindow: (args: { item: { type: string; value: string; title: string }; monitor?: number }) => Promise<{ success: boolean }>;
  resizeActiveWindow: (pct: number) => Promise<{ success: boolean }>;
  checkForUpdates: () => Promise<{ status: 'up-to-date' | 'update-available' | 'dev-mode' | 'error'; version?: string; newVersion?: string; message?: string }>;
  installUpdate: () => void;
  onUpdateAvailable: (cb: (info: { version: string }) => void) => void;
  onUpdateDownloadProgress: (cb: (info: { percent: number } | null) => void) => void;
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => void;
  onMonitorsChanged: (cb: (monitors: Array<{ index: number; id: number; isPrimary: boolean; bounds: { x: number; y: number; width: number; height: number }; workArea: { x: number; y: number; width: number; height: number }; scaleFactor: number }>) => void) => void;
  getRecentItems: () => Promise<Array<{ title: string; value: string; type: 'folder' | 'app'; lastAccessed: string }>>;
  readClipboard: () => Promise<string>;
  analyzeClipboard: () => Promise<{ type: 'url' | 'app' | 'folder' | 'none'; value?: string; label?: string }>;
  checkWindowsAlive: (titles: string[]) => Promise<Record<string, boolean>>;
  checkFileExists: (filePath: string) => Promise<boolean>;
  checkItemsForTile: (items: { type: string; value: string; title: string }[]) => Promise<Array<{ idx: number; alive: boolean; note: string }>>;
  launchItemsForTile: (items: { type: string; value: string; title: string }[]) => Promise<{ waitMs: number; identifiers: Array<{ type: string; value: string; title: string; tabTitle: string }> }>;
  runTilePs: (args: { identifiers: Array<{ type: string; value: string; title: string; tabTitle: string }>; waitMs: number; monitor?: number }) => Promise<{ success: boolean; error: string }>;
  snapWindow: (item: { type: string; value: string; title: string }, zone: 'left' | 'right' | 'top') => Promise<{ success: boolean }>;
  getMonitors: () => Promise<Array<{ index: number; id: number; isPrimary: boolean; bounds: { x: number; y: number; width: number; height: number }; workArea: { x: number; y: number; width: number; height: number }; scaleFactor: number }>>;
  identifyMonitors: () => Promise<{ count: number }>;
  getUserHome: () => string;
  getFilePath: (file: File) => string | null;
  openGuide: () => void;
  signalReady: () => void;
  setLoadingStatus: (msg: string) => void;
  log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, extra?: unknown) => void;
  openLogsFolder: () => void;
  // Floating orb (Phase 1)
  notifyFloatingSettingsChanged: () => void;
  onFloatingSettingsChanged: (cb: () => void) => void;
  onFloatingOpenSettings: (cb: () => void) => void;
  // Floating badges (Phase 2)
  pinBadge: (
    refType: 'space' | 'node' | 'deck',
    refId: string,
    screenX?: number,
    screenY?: number,
  ) => Promise<{ success: boolean; id?: string; reason?: string }>;
  syncBadges: () => void;
  onBadgesLaunchItem: (cb: (payload: { refType: 'space' | 'node' | 'deck'; refId: string; itemId: string }) => void) => void;
  onBadgesLaunchRef: (cb: (payload: { refType: 'space' | 'node' | 'deck'; refId: string }) => void) => void;
  onBadgesRevealSpace: (cb: (payload: { refId: string }) => void) => void;
  onBadgesUpdated: (cb: (badges: import('./types').FloatingBadge[]) => void) => void;
}

function noop(..._args: unknown[]) { /* dev-mode no-op */ }

export const electronAPI: ElectronAPI = window.electronAPI ?? {
  hideApp: noop,
  openUrl: noop,
  openPath: noop,
  openFolder: noop,
  focusWindow: async () => ({ success: false }),
  launchOrFocusApp: async () => ({ success: false, error: 'dev-mode' }),
  runCmd: noop,
  copyText: noop,
  getOpenWindows: async () => ({ windows: [], browserTabs: [] }),
  setOpacity: noop,
  updateShortcut: noop,
  detectDialog: async () => ({ isDialog: false }),
  jumpToDialogFolder: noop,
  storeLoad: async () => null,
  storeSave: async () => true,
  getWindowPosition: async () => [0, 0] as [number, number],
  moveWindow: noop,
  windowDragEnd: noop,
  exportData: async () => ({ success: false, reason: 'dev-mode' }),
  importData: async () => ({ success: false, reason: 'dev-mode' }),
  pickFolder: async () => null,
  pickExe: async () => null,
  getFileIcon: async () => null,
  getExtensionBridgeStatus: async () => ({ connected: false, tabsCount: 0, lastTabsUpdateAt: 0, lastExtensionConnectedAt: 0 }),
  openExtensionInstallHelper: async (_targetBrowser: 'chrome' | 'whale') => ({ success: false, reason: 'dev-mode' }),
  tileWindows: async () => ({ success: false }),
  maximizeWindow: async () => ({ success: false }),
  resizeActiveWindow: async () => ({ success: false }),
  checkForUpdates: async () => ({ status: 'dev-mode' as const }),
  installUpdate: noop,
  onUpdateAvailable: noop,
  onUpdateDownloadProgress: noop,
  onUpdateDownloaded: noop,
  onMonitorsChanged: noop,
  getRecentItems: async () => [],
  readClipboard: async () => '',
  analyzeClipboard: async () => ({ type: 'none' as const }),
  checkWindowsAlive: async () => ({}),
  checkFileExists: async () => false,
  checkItemsForTile: async () => [],
  launchItemsForTile: async () => ({ waitMs: 1000, identifiers: [] }),
  runTilePs: async () => ({ success: false, debug: '', error: '' }),
  snapWindow: async () => ({ success: false }),
  getMonitors: async () => [],
  identifyMonitors: async () => ({ count: 1 }),
  getUserHome: () => '',
  getFilePath: () => null,
  openGuide: noop,
  signalReady: noop,
  setLoadingStatus: noop,
  log: noop,
  openLogsFolder: noop,
  notifyFloatingSettingsChanged: noop,
  onFloatingSettingsChanged: noop,
  onFloatingOpenSettings: noop,
  pinBadge: async () => ({ success: false, reason: 'dev-mode' }),
  syncBadges: noop,
  onBadgesLaunchItem: noop,
  onBadgesLaunchRef: noop,
  onBadgesRevealSpace: noop,
  onBadgesUpdated: noop,
};
