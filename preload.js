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
  importData: () => ipcRenderer.invoke('import-data'),
  runCmd: (command, closeAfter) => ipcRenderer.send('run-cmd', command, closeAfter),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickExe: () => ipcRenderer.invoke('pick-exe'),
  getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),
  getExtensionBridgeStatus: () => ipcRenderer.invoke('get-extension-bridge-status'),
  openExtensionInstallHelper: (targetBrowser) => ipcRenderer.invoke('open-extension-install-helper', targetBrowser),
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
   *  the item through its full launch pipeline. */
  onBadgesLaunchItem: (cb) =>
    ipcRenderer.on('badges-launch-item', (_, payload) => cb(payload)),
  /** Mini-window fired a node/deck group launch ("묶음 실행" / "순차 실행"). */
  onBadgesLaunchRef: (cb) =>
    ipcRenderer.on('badges-launch-ref', (_, payload) => cb(payload)),
  /** Badge context-menu "실행" on a space ref → scroll that space into view. */
  onBadgesRevealSpace: (cb) =>
    ipcRenderer.on('badges-reveal-space', (_, payload) => cb(payload)),
  /** Fires whenever the floatingBadges list changes — main renderer can
   *  update UI (e.g. hide the "float" button for already-pinned items). */
  onBadgesUpdated: (cb) =>
    ipcRenderer.on('badges-updated', (_, badges) => cb(badges)),
});
