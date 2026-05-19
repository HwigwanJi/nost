// Electron API bridge — wraps window.electronAPI with type safety
// Falls back gracefully in browser dev mode

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export interface ElectronAPI {
  hideApp: () => void;
  requestCloseAfter: () => void;
  openUrl: (url: string, closeAfter: boolean) => void;
  openPath: (folder: string, closeAfter: boolean) => void;
  openFolder: (folder: string, closeAfter: boolean) => void;
  focusWindow: (title: string, closeAfter: boolean) => Promise<{ success: boolean; error?: string }>;
  launchOrFocusApp: (exePath: string, closeAfter: boolean, monitor?: number) => Promise<{ success: boolean; action?: 'focused' | 'launched'; error?: string }>;
  runCmd: (command: string, closeAfter: boolean) => void;
  copyText: (text: string, closeAfter: boolean) => void;
  getOpenWindows: () => Promise<{ windows: import('./types').WindowEntry[]; browserTabs: import('./types').ChromeTab[] }>;
  setOpacity: (opacity: number) => void;
  /** Set the launcher's physical size as % of the active monitor's
   *  work area (25..100). Same semantic as `/N` slash commands.
   *  Main clamps + persists into settings.windowSizePct + applies
   *  setBounds so every code path stays in sync. */
  /** Resize the launcher to `pct` % of the active monitor's work area.
   *  `anchor` controls which corner/edge stays fixed:
   *    - 'center' (default): grow/shrink from center (history default)
   *    - 'bottom-right': keep bottom-right corner fixed — used by the
   *      status-bar slider (which sits in the bottom-right area) so
   *      the thumb doesn't drift away from the user's cursor mid-drag. */
  setWindowSizePct: (pct: number, anchor?: 'center' | 'bottom-right') => void;
  /** Snapshot of the launcher's process-tree resource usage. cpuPct
   *  is normalised to % of total system CPU (0..100) so the number
   *  is comparable to Task Manager. perProc breaks down the same
   *  numbers per child process for the status-bar tooltip. */
  getResourceStats: () => Promise<{
    cpuPct: number;
    memMB: number;
    procs: number;
    cores: number;
    perProc: Array<{ type: string; cpuPct: number; memMB: number }>;
  }>;
  setSuppressAutoHide: (suppress: boolean, source?: string) => void;
  setAutoHide: (autoHide: boolean) => void;
  setWindowOpenAt: (mode: 'cursor' | 'last') => void;
  readTextFile: (filePath: string, maxBytes?: number) => Promise<
    | { ok: true; text: string; encoding: string }
    | { ok: false; reason: 'too-large' | 'read-error'; size?: number; error?: string }
  >;

  // ── Auth ─────────────────────────────────────────────────────
  authGetSession: () => Promise<unknown | null>;
  authSetSession: (session: unknown | null) => Promise<boolean>;
  authOpenOAuthUrl: (url: string) => Promise<unknown>;
  authConsumePendingDeepLink: () => Promise<string | null>;
  onAuthDeepLink: (cb: (url: string) => void) => () => void;
  /** Generic encrypted KV (safeStorage) for supabase-js short-lived
   *  keys — PKCE verifier, refresh nonces — so the OAuth round-trip
   *  survives a fresh-instance handoff (Windows dev-mode `nost://`
   *  click sometimes spawns a new electron.exe and the renderer's
   *  in-memory cache is born empty). */
  authKvGet: (key: string) => Promise<string | null>;
  authKvSet: (key: string, value: string | null) => Promise<boolean>;
  authKvList: () => Promise<Record<string, string>>;
  /** Stable per-install device identity (uuid + hostname + platform).
   *  Phase 2 sync uses these to identify which PC produced each snapshot
   *  edit and to enforce Free device quotas. deviceId persists across
   *  app restarts (electron-store) — hostname/platform read live. */
  deviceGetInfo: () => Promise<{ deviceId: string; hostname: string; platform: string }>;
  updateShortcut: (shortcut: string) => void;
  /** Pause / resume the launcher's global shortcut while the in-app
   *  capture UI is recording a new combo. v1.3.46+. */
  pauseGlobalShortcut:  () => void;
  resumeGlobalShortcut: () => void;
  detectDialog: () => Promise<{ isDialog: boolean; title?: string; className?: string }>;
  jumpToDialogFolder: (folderPath: string) => void;
  storeLoad: () => Promise<unknown>;
  storeSave: (data: unknown) => Promise<boolean>;
  getWindowPosition: () => Promise<[number, number]>;
  moveWindow: (x: number, y: number) => void;
  windowDragEnd: () => void;
  exportData: () => Promise<{ success: boolean; filePath?: string; reason?: string }>;
  autoBackupData: (reason?: string) => Promise<{ success: boolean; filePath?: string; reason?: string }>;
  openUserDataFolder: (sub?: string) => Promise<{ success: boolean; reason?: string }>;
  importData: () => Promise<{ success: boolean; data?: unknown; formatVersion?: number; reason?: string }>;
  pickAndReadText: (kind: 'bookmarks-html' | 'markdown' | 'any') => Promise<{ success: boolean; text?: string; fileName?: string; reason?: string }>;
  pickFolder: () => Promise<string | null>;
  pickExe: () => Promise<string | null>;
  getFileIcon: (filePath: string) => Promise<string | null>;
  /** Download the first acceptable favicon candidate as a data URL.
   *  Resolves to null if every candidate fails or returns a placeholder.
   *  Runs in main process — bypasses renderer CSP and rejects 1×1 placeholders. */
  downloadFavicon: (candidates: string[]) => Promise<string | null>;
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
  /** Open the Chrome Web Store page for the nost-bridge extension in
   *  the user's default browser. Recommended path post-2026-04 store
   *  approval — replaces the dev-mode "load unpacked" flow as the
   *  primary install method. */
  openExtensionStore: () => Promise<{ success: boolean; url?: string; reason?: string; error?: string }>;
  /** Best-effort: register the extension as an "external extension" via
   *  HKCU registry so Chrome shows a one-click "활성화" notification
   *  on next launch. Failure is silent — caller should always also
   *  open the store URL as a guaranteed fallback. */
  registerExtensionExternal: () => Promise<{ success: boolean; reason?: string; error?: string }>;
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
  // v1.3.34: optional docExtensions arg drives the new 'doc' return type.
  // Renderer should pass `data.settings.documentExtensions` so user-customised
  // doc lists apply uniformly across every clipboard entry point.
  analyzeClipboard: (docExtensions?: string[]) => Promise<{
    type: 'url' | 'app' | 'folder' | 'doc' | 'hex' | 'text' | 'image' | 'none';
    value?: string;
    label?: string;
    html?: string;
    // image-only: base64 data URL preview (96 px max width) + raw bytes
    // estimate. The file isn't on disk yet — only in the OS clipboard;
    // the renderer triggers `saveClipboardImage()` to materialise it.
    preview?: string;
    width?: number;
    height?: number;
    byteSize?: number;
  }>;
  /**
   * Document cohort directory scan. Returns files whose basename matches
   * `mask` (the `{token}` placeholder is expanded to a permissive wildcard
   * in main.js). Caller layers `rankCandidates` from `lib/docCohort.ts`
   * to sort by the user's selected token preset.
   */
  listDocCohort: (directory: string, mask: string) => Promise<{
    ok: boolean;
    error?: 'invalid-args' | 'unsafe-path' | 'traversal' | 'readdir-failed' | 'unexpected';
    message?: string;
    items: Array<{ basename: string; path: string; mtime: number; size: number }>;
  }>;
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
  /** Renderer perf — ship a `{ [counterName]: count }` aggregate to
   *  main every 10 s. See frontend/src/lib/perf.ts. Fire-and-forget. */
  perfReport: (payload: Record<string, number>) => void;
  /** Subscribe to "main window was dragged-resized" events so the
   *  status-bar slider can refresh from the new windowSizePct SSOT.
   *  Returns an unsubscribe function. */
  onWindowSizePctChanged: (cb: (pct: number) => void) => () => void;
  // Floating badges (Phase 2)
  pinBadge: (
    refType: 'space' | 'node' | 'deck',
    refId: string,
    screenX?: number,
    screenY?: number,
  ) => Promise<{ success: boolean; id?: string; reason?: string }>;
  syncBadges: () => void;
  // Returns an unsubscribe function — call it from useEffect cleanup so
  // listeners don't pile up. Pre-fix this returned void, which caused one
  // badge click to launch N times after N effect re-runs.
  onBadgesLaunchItem: (cb: (payload: { refType: 'space' | 'node' | 'deck'; refId: string; itemId: string }) => void) => () => void;
  onBadgesLaunchRef:  (cb: (payload: { refType: 'space' | 'node' | 'deck'; refId: string }) => void) => () => void;
  notifyBadgesLaunchDone: (payload: { refType: 'space' | 'node' | 'deck'; refId: string }) => void;
  // Both return unsubscribe fns — call from useEffect cleanup. The
  // pre-fix void return triggered a listener pile-up bug under unstable
  // deps, surfaced by Node's MaxListenersExceededWarning at ~10. See
  // App.tsx's badges effect for the canonical consumption pattern.
  onBadgesRevealSpace: (cb: (payload: { refId: string }) => void) => () => void;
  onBadgesUpdated: (cb: (badges: import('./types').FloatingBadge[]) => void) => () => void;
  // ── Media widget — write side only ──────────────────────────────
  // We dropped the read side (NowPlaying via SMTC) after the YouTube
  // freeze. The widget is a control surface — keys go out, no state
  // comes back. mediaFocusSource taps the extension's tab list to
  // bring the audible browser tab to front when the wrapper is clicked.
  mediaCommand: (action: 'play-pause' | 'next' | 'prev' | 'stop' | 'vol-up' | 'vol-down' | 'mute') => void;
  mediaFocusSource: () => Promise<{ tabId: number; title: string; url: string } | null>;
  // ── Image card (v1.3.46+) ───────────────────────────────────────
  saveClipboardImage: () => Promise<
    | { success: true; path: string; width: number; height: number; byteSize: number }
    | { success: false; reason: string }
  >;
  copyImageToClipboard: (filePath: string, closeAfter?: boolean) => void;
  deleteImageFile: (filePath: string) => Promise<{ success: boolean; reason?: string }>;

  // ── Color picker (screen-capture eyedropper) ────────────────────
  pickColorFromScreen: () => Promise<{ success: boolean; hex?: string; reason?: string }>;
  // ── Memo (사라지는 메모) ────────────────────────────────────────
  /** Export a memo body to a .txt file. Returns the absolute path on
   *  success. Caller can pass `openAfter: true` to shell-open immediately. */
  exportMemoTxt: (args: { body: string; slug: string; customFolder?: string; openAfter?: boolean }) =>
    Promise<{ success: boolean; filePath?: string; reason?: string }>;
  /** OS save-as dialog flow. User picks the location; we write the
   *  file. Caller should NOT delete the memo on success — this is a
   *  snapshot, not a move. */
  saveMemoAs: (args: { body: string; slug: string; format?: 'txt' | 'md' }) =>
    Promise<{ success: boolean; filePath?: string; reason?: string }>;
  /** Write to temp + shell-open in the user's default text editor.
   *  Mapped to the editor's "메모장에서 열기" button. */
  openMemoExternal: (args: { body: string; slug: string }) =>
    Promise<{ success: boolean; filePath?: string; reason?: string }>;
  openMemoFolder: (customFolder?: string) => Promise<{ success: boolean; filePath?: string; reason?: string }>;
  getMemoDefaultFolder: () => Promise<string>;

  /** Subscribe to "store was overwritten externally" notifications.
   *  Main fires this after import-data writes the imported tree;
   *  renderer reloads via reloadFromStore (which also migrates). */
  onAppDataReloaded: (cb: () => void) => () => void;

  // ── Satellite ItemDialog (card add/edit) ────────────────────────
  /** Open the satellite card-edit dialog in its own BrowserWindow.
   *  See plans/satellite-dialogs.md. Payload mirrors the props the
   *  inline ItemDialog used to take. */
  openItemDialog: (payload: unknown) => void;
  /** Subscribe to action events (save / request-advanced / pick-on-
   *  screen / toast) emitted by the satellite. Returns unsubscribe. */
  onItemDialogAction: (cb: (action: ItemDialogAction) => void) => () => void;
  /** Fires when the satellite window is destroyed. App.tsx uses this
   *  to reset its local dialog state. Returns unsubscribe. */
  onItemDialogClosed: (cb: () => void) => () => void;

  // ── Satellite ItemWizard (quick-add / manual-add) ───────────────
  openItemWizard: (payload: unknown) => void;
  onItemWizardAction: (cb: (action: ItemWizardAction) => void) => () => void;
  onItemWizardClosed: (cb: () => void) => () => void;

  // ── Satellite SettingsDialog ────────────────────────────────────
  openSettingsDialog: (payload: unknown) => void;
  onSettingsDialogAction: (cb: (action: SettingsDialogAction) => void) => () => void;
  onSettingsDialogClosed: (cb: () => void) => () => void;

  // ── Satellite DocCohortDialog ───────────────────────────────────
  openDocCohortDialog: (payload: unknown) => void;
  onDocCohortDialogAction: (cb: (action: DocCohortDialogAction) => void) => () => void;
  onDocCohortDialogClosed: (cb: () => void) => () => void;

  // ── Satellite BatchDropDialog ───────────────────────────────────
  openBatchDropDialog: (payload: unknown) => void;
  onBatchDropDialogAction: (cb: (action: BatchDropDialogAction) => void) => () => void;
  onBatchDropDialogClosed: (cb: () => void) => () => void;

  // ── Satellite ContainerSlotPicker ───────────────────────────────
  openContainerSlotPicker: (payload: unknown) => void;
  onContainerSlotPickerAction: (cb: (action: ContainerSlotPickerAction) => void) => () => void;
  onContainerSlotPickerClosed: (cb: () => void) => () => void;
}

export type DocCohortDialogAction =
  | { kind: 'commit'; next: { value: string; pattern: string; tokenType: import('./types').TokenPreset; directory: string } };

export type BatchDropDialogAction =
  | { kind: 'confirm'; spaceId: string; items: Omit<import('./types').LauncherItem, 'id'>[] };

export type ContainerSlotPickerAction =
  | { kind: 'save'; slots: import('./types').ContainerSlots; removals: import('./components/ContainerSlotPicker').PendingRemoval[]; newItems: import('./components/ContainerSlotPicker').PendingNewItem[] };

/** ItemWizard satellite actions. save: full item commit (handleSaveItem).
 *  save-as-memo: clipboard text routed to addMemo store path. */
export type ItemWizardAction =
  | { kind: 'save'; spaceId: string; item: Omit<import('./types').LauncherItem, 'id'> }
  | { kind: 'save-as-memo'; spaceId: string; body: string };

/** SettingsDialog satellite actions. save fires LIVE during slider
 *  drags and toggle clicks — high frequency, small payload. */
export type SettingsDialogAction =
  | { kind: 'save'; settings: import('./types').AppSettings }
  | { kind: 'start-tutorial'; quest: unknown }
  | { kind: 'open-memo-trash' }
  | { kind: 'extend-all-memos' }
  | { kind: 'empty-memo-trash' };

/** Action payloads emitted by the ItemDialog satellite. Each kind maps
 *  1-to-1 to a callback prop the inline dialog used to receive. */
export type ItemDialogAction =
  | { kind: 'save'; spaceId: string; item: import('./types').LauncherItem | Omit<import('./types').LauncherItem, 'id'>; targetPresetId?: '1' | '2' | '3' }
  | { kind: 'request-advanced'; spaceId: string }
  | { kind: 'pick-on-screen'; item: Omit<import('./types').LauncherItem, 'id'> }
  | { kind: 'toast'; msg: string; opts?: { duration?: number } };

function noop(..._args: unknown[]) { /* dev-mode no-op */ }

export const electronAPI: ElectronAPI = window.electronAPI ?? {
  hideApp: noop,
  requestCloseAfter: noop,
  openUrl: noop,
  openPath: noop,
  openFolder: noop,
  focusWindow: async () => ({ success: false }),
  launchOrFocusApp: async () => ({ success: false, error: 'dev-mode' }),
  runCmd: noop,
  copyText: noop,
  getOpenWindows: async () => ({ windows: [], browserTabs: [] }),
  setOpacity: noop,
  setWindowSizePct: noop,
  getResourceStats: async () => ({ cpuPct: 0, memMB: 0, procs: 0, cores: 1, perProc: [] }),
  setSuppressAutoHide: noop,
  setAutoHide: noop,
  setWindowOpenAt: noop,
  readTextFile: async () => ({ ok: false, reason: 'read-error', error: 'dev-mode' }),
  authGetSession: async () => null,
  authSetSession: async () => true,
  authOpenOAuthUrl: async () => ({}),
  authConsumePendingDeepLink: async () => null,
  onAuthDeepLink: () => () => {},
  authKvGet: async () => null,
  authKvSet: async () => true,
  authKvList: async () => ({}),
  deviceGetInfo: async () => ({ deviceId: 'noop-device', hostname: 'unknown', platform: 'unknown' }),
  updateShortcut: noop,
  pauseGlobalShortcut: noop,
  resumeGlobalShortcut: noop,
  detectDialog: async () => ({ isDialog: false }),
  jumpToDialogFolder: noop,
  storeLoad: async () => null,
  storeSave: async () => true,
  getWindowPosition: async () => [0, 0] as [number, number],
  moveWindow: noop,
  windowDragEnd: noop,
  exportData: async () => ({ success: false, reason: 'dev-mode' }),
  autoBackupData: async () => ({ success: false, reason: 'dev-mode' }),
  openUserDataFolder: async () => ({ success: false, reason: 'dev-mode' }),
  importData: async () => ({ success: false, reason: 'dev-mode' }),
  pickAndReadText: async () => ({ success: false, reason: 'dev-mode' }),
  pickFolder: async () => null,
  pickExe: async () => null,
  getFileIcon: async () => null,
  downloadFavicon: async () => null,
  getExtensionBridgeStatus: async () => ({ connected: false, tabsCount: 0, lastTabsUpdateAt: 0, lastExtensionConnectedAt: 0 }),
  openExtensionInstallHelper: async (_targetBrowser: 'chrome' | 'whale') => ({ success: false, reason: 'dev-mode' }),
  openExtensionStore: async () => ({ success: false, reason: 'dev-mode' }),
  registerExtensionExternal: async () => ({ success: false, reason: 'dev-mode' }),
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
  listDocCohort: async () => ({ ok: false, error: 'unexpected' as const, items: [] }),
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
  perfReport: noop,
  onWindowSizePctChanged: () => () => {},
  pinBadge: async () => ({ success: false, reason: 'dev-mode' }),
  syncBadges: noop,
  // Dev-mode stubs — return a no-op unsubscribe to satisfy the new signature.
  onBadgesLaunchItem: () => () => {},
  onBadgesLaunchRef:  () => () => {},
  notifyBadgesLaunchDone: noop,
  // Dev-mode stubs — return no-op unsubscribes (signature parity).
  onBadgesRevealSpace: () => () => {},
  onBadgesUpdated: () => () => {},
  // Dev-mode media stubs.
  mediaCommand: noop,
  mediaFocusSource: async () => null,
  saveClipboardImage: async () => ({ success: false, reason: 'dev-mode' }),
  copyImageToClipboard: noop,
  deleteImageFile: async () => ({ success: false, reason: 'dev-mode' }),
  pickColorFromScreen: async () => ({ success: false, reason: 'dev-mode' }),
  // Dev-mode memo stubs — exporting in browser dev makes no sense, so
  // we return a "success" path that won't be opened (caller should
  // gracefully degrade if filePath is empty).
  exportMemoTxt: async () => ({ success: false, reason: 'dev-mode' }),
  saveMemoAs: async () => ({ success: false, reason: 'dev-mode' }),
  openMemoExternal: async () => ({ success: false, reason: 'dev-mode' }),
  openMemoFolder: async () => ({ success: false, reason: 'dev-mode' }),
  getMemoDefaultFolder: async () => '',
  onAppDataReloaded: () => () => {},
  openItemDialog: noop,
  onItemDialogAction: () => () => {},
  onItemDialogClosed: () => () => {},
  openItemWizard: noop,
  onItemWizardAction: () => () => {},
  onItemWizardClosed: () => () => {},
  openSettingsDialog: noop,
  onSettingsDialogAction: () => () => {},
  onSettingsDialogClosed: () => () => {},
  openDocCohortDialog: noop,
  onDocCohortDialogAction: () => () => {},
  onDocCohortDialogClosed: () => () => {},
  openBatchDropDialog: noop,
  onBatchDropDialogAction: () => () => {},
  onBatchDropDialogClosed: () => () => {},
  openContainerSlotPicker: noop,
  onContainerSlotPickerAction: () => () => {},
  onContainerSlotPickerClosed: () => () => {},
};
