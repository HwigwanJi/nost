const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Resolve homedir ONCE at preload load time. Calling require('os') lazily
// inside an exposed contextBridge function fails intermittently with
// "module not found: os" when Electron's preload runs under sandbox or when
// the Node module cache has been torn down — which crashed the renderer
// mid-session (see main.log 2026-04-20 16:45:38). Falling back to env vars
// keeps getUserHome() working even if os resolution ever fails.
let __cachedHome = '';
try { __cachedHome = require('os').homedir() || ''; } catch {}
if (!__cachedHome) {
  __cachedHome = process.env.USERPROFILE
    || (process.env.HOMEDRIVE && process.env.HOMEPATH ? process.env.HOMEDRIVE + process.env.HOMEPATH : '')
    || process.env.HOME
    || '';
}

contextBridge.exposeInMainWorld('electronAPI', {
  log: (level, msg, extra) => ipcRenderer.send('nost-log', level, msg, extra),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  openUrl: (url, closeAfter) => ipcRenderer.send('open-url', url, closeAfter),
  openPath: (folder, closeAfter) => ipcRenderer.send('open-path', folder, closeAfter),
  copyText: (text, closeAfter) => ipcRenderer.send('copy-text', text, closeAfter),
  hideApp: () => ipcRenderer.send('hide-app'),
  setOpacity: (opacity) => ipcRenderer.send('set-opacity', opacity),
  getOpenWindows: () => ipcRenderer.invoke('get-open-windows'),
  focusWindow: (title, closeAfter) => ipcRenderer.invoke('focus-window', title, closeAfter),
  launchOrFocusApp: (exePath, closeAfter, monitor) => ipcRenderer.invoke('launch-or-focus-app', exePath, closeAfter, monitor),
  updateShortcut: (shortcut) => ipcRenderer.send('update-shortcut', shortcut),
  detectDialog: () => ipcRenderer.invoke('detect-dialog'),
  jumpToDialogFolder: (folderPath) => ipcRenderer.send('jump-to-dialog-folder', folderPath),
  storeLoad: () => ipcRenderer.invoke('store-load'),
  storeSave: (data) => ipcRenderer.invoke('store-save', data),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  moveWindow: (x, y) => ipcRenderer.send('window-move', x, y),
  windowDragEnd: () => ipcRenderer.send('window-drag-end'),
  exportData: () => ipcRenderer.invoke('export-data'),
  /** Silent backup to userData/tutorial-backups/. No dialog, returns the path. */
  autoBackupData: (reason) => ipcRenderer.invoke('auto-backup-data', reason),
  /** Open the user-data folder (or a sub-path) in OS file explorer. */
  openUserDataFolder: (sub) => ipcRenderer.invoke('open-userdata-folder', sub),
  importData: () => ipcRenderer.invoke('import-data'),
  /** Pick a text file and return its contents. `kind` filters the file
   *  picker: 'bookmarks-html' / 'markdown' / 'any'. */
  pickAndReadText: (kind) => ipcRenderer.invoke('pick-and-read-text', kind),
  runCmd: (command, closeAfter) => ipcRenderer.send('run-cmd', command, closeAfter),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickExe: () => ipcRenderer.invoke('pick-exe'),
  getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),
  /**
   * Resolve a website's favicon by trying candidate URLs from the main
   * process (bypasses renderer CSP) and returns a self-contained data URL.
   * Saving the data URL on the item means the icon survives offline and
   * service outages — no re-fetch on every render.
   */
  downloadFavicon: (candidates) => ipcRenderer.invoke('download-favicon', candidates),
  getExtensionBridgeStatus: () => ipcRenderer.invoke('get-extension-bridge-status'),
  openExtensionInstallHelper: (targetBrowser) => ipcRenderer.invoke('open-extension-install-helper', targetBrowser),
  openExtensionStore: () => ipcRenderer.invoke('open-extension-store'),
  registerExtensionExternal: () => ipcRenderer.invoke('register-extension-external'),
  tileWindows: (items) => ipcRenderer.invoke('tile-windows', items),
  maximizeWindow: (item) => ipcRenderer.invoke('maximize-window', item),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  analyzeClipboard: () => ipcRenderer.invoke('analyze-clipboard'),
  checkWindowsAlive: (titles) => ipcRenderer.invoke('check-windows-alive', titles),
  checkFileExists: (filePath) => ipcRenderer.invoke('check-file-exists', filePath),
  checkItemsForTile: (items) => ipcRenderer.invoke('check-items-for-tile', items),
  launchItemsForTile: (items) => ipcRenderer.invoke('launch-items-for-tile', items),
  runTilePs: (args) => ipcRenderer.invoke('run-tile-ps', args),
  snapWindow: (item, zone) => ipcRenderer.invoke('snap-window', { item, zone }),
  resizeActiveWindow: (pct) => ipcRenderer.invoke('resize-active-window', { pct }),
  getRecentItems: () => ipcRenderer.invoke('get-recent-items'),
  getMonitors: () => ipcRenderer.invoke('get-monitors'),
  identifyMonitors: () => ipcRenderer.invoke('identify-monitors'),
  getUserHome: () => __cachedHome,  // resolved once at preload load (see top of file)
  /**
   * Electron 32+ removed the `File.path` property; drag-and-drop file objects
   * now only expose `name`. This helper wraps the replacement API so callers
   * can resolve the real filesystem path of a dropped File.
   */
  getFilePath: (file) => {
    try { return webUtils.getPathForFile(file) || null; } catch { return null; }
  },
  openGuide: () => ipcRenderer.send('open-guide'),
  signalReady: () => ipcRenderer.send('renderer-ready'),
  setLoadingStatus: (msg) => ipcRenderer.send('set-loading-status', msg),
  onMonitorsChanged: (cb) => ipcRenderer.on('monitors-changed', (_, monitors) => cb(monitors)),

  // ── Floating orb (Phase 1) ─────────────────────────────────────
  /** Notify main that floatingButton settings in the store have changed. */
  notifyFloatingSettingsChanged: () => ipcRenderer.send('floating-settings-updated'),
  /** Main broadcasts this when the orb's own right-click menu toggles the setting. */
  onFloatingSettingsChanged: (cb) => ipcRenderer.on('floating-settings-changed', () => cb()),
  /** Orb right-click > 설정 열기 — jump into the Settings dialog. */
  onFloatingOpenSettings: (cb) => ipcRenderer.on('floating-open-settings', () => cb()),

  // ── Floating badges (Phase 2) ─────────────────────────────────
  /** Pin a space / node / deck as a floating badge at the given screen coord
   *  (or a default position if the coord is omitted). */
  pinBadge: (refType, refId, screenX, screenY) =>
    ipcRenderer.invoke('badges-pin', { refType, refId, screenX, screenY }),
  /** Notify main that floatingBadges in the store has been mutated externally
   *  (e.g. after an import) so the overlay rebuilds. */
  syncBadges: () => ipcRenderer.send('badges-sync'),
  /** Mini-window fired a single-item launch. Main renderer should route
   *  the item through its full launch pipeline.
   *  Returns an unsubscribe fn so the renderer can detach on effect
   *  cleanup — without it, every effect re-run piles a new listener
   *  and one badge click ends up firing N launches. */
  onBadgesLaunchItem: (cb) => {
    const handler = (_, payload) => cb(payload);
    ipcRenderer.on('badges-launch-item', handler);
    return () => ipcRenderer.removeListener('badges-launch-item', handler);
  },
  /** Mini-window fired a node/deck group launch ("묶음 실행" / "순차 실행"). */
  onBadgesLaunchRef: (cb) => {
    const handler = (_, payload) => cb(payload);
    ipcRenderer.on('badges-launch-ref', handler);
    return () => ipcRenderer.removeListener('badges-launch-ref', handler);
  },
  /** Badge context-menu "실행" on a space ref → scroll that space into view.
   *  Returns an unsubscribe fn — same lesson as onBadgesLaunchItem: without
   *  it, every effect re-run piles a listener and the warning at ~10 fires
   *  ("MaxListenersExceededWarning"), shortly followed by main-process
   *  thrashing as each IPC fan-outs N times. */
  onBadgesRevealSpace: (cb) => {
    const handler = (_, payload) => cb(payload);
    ipcRenderer.on('badges-reveal-space', handler);
    return () => ipcRenderer.removeListener('badges-reveal-space', handler);
  },
  /** Fires whenever the floatingBadges list changes — main renderer can
   *  update UI (e.g. hide the "float" button for already-pinned items). */
  onBadgesUpdated: (cb) => {
    const handler = (_, badges) => cb(badges);
    ipcRenderer.on('badges-updated', handler);
    return () => ipcRenderer.removeListener('badges-updated', handler);
  },

  // ── Media widget — Windows media-key bridge ─────────────────────
  /** Fire a media key. action: 'play-pause' | 'next' | 'prev' | 'stop' |
   *  'vol-up' | 'vol-down' | 'mute'. */
  mediaCommand: (action) => ipcRenderer.send('media-command', action),
  /** Ask main to focus whichever browser tab is currently playing
   *  audio. Returns null if no audible tab is known (extension not
   *  installed / no audio playing). */
  mediaFocusSource: () => ipcRenderer.invoke('media-focus-source'),
});
