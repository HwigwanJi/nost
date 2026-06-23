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

// Recovery API consumed by the inline boot script in
// `frontend/index.html`. Mirrors the API previously exposed only to
// the external splash window's preload (preload-splash.js); duplicated
// here so the in-window `#ql-loading` overlay can wire up restart /
// open-logs buttons without going through the main `electronAPI`
// (which carries a much larger surface area we don't want the boot
// shell taking a hard dependency on).
contextBridge.exposeInMainWorld('splashAPI', {
  onError:  (cb) => ipcRenderer.on('boot:show-error', () => cb()),
  // Receive status text updates from main (ext-warmup stages, etc.).
  // The corresponding writer in main.js fires `boot:status` with a
  // single string payload; boot-recovery.js routes it into the
  // overlay's status text via `window.__bootStatus`.
  onStatus: (cb) => ipcRenderer.on('boot:status', (_e, text) => cb(text)),
  restart:  () => ipcRenderer.send('splash:restart'),
  openLogs: () => ipcRenderer.send('splash:open-logs'),
});

contextBridge.exposeInMainWorld('electronAPI', {
  log: (level, msg, extra) => ipcRenderer.send('nost-log', level, msg, extra),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  openUrl: (url, closeAfter) => ipcRenderer.send('open-url', url, closeAfter),
  openPath: (folder, closeAfter) => ipcRenderer.send('open-path', folder, closeAfter),
  copyText: (text, closeAfter) => ipcRenderer.send('copy-text', text, closeAfter),
  hideApp: () => ipcRenderer.send('hide-app'),
  // Renderer-driven close-after: same effect as the closeAfter flag
  // on a launch IPC, but used when the renderer can't decide ahead of
  // time (e.g. positioning step finished). Funnels through
  // tryDismissWindow so suppression sources are honored — unlike
  // hideApp() which is an explicit user-intent override.
  requestCloseAfter: () => ipcRenderer.send('request-close-after'),
  setOpacity: (opacity) => ipcRenderer.send('set-opacity', opacity),
  setWindowSizePct: (pct, anchor) => ipcRenderer.send('set-window-size-pct', pct, anchor),
  getResourceStats: () => ipcRenderer.invoke('get-resource-stats'),
  setSuppressAutoHide: (suppress, source) => ipcRenderer.send('set-suppress-autohide', !!suppress, source ?? 'default'),
  setAutoHide: (autoHide) => ipcRenderer.send('set-auto-hide', !!autoHide),
  setWindowOpenAt: (mode) => ipcRenderer.send('set-window-open-at', mode === 'last' ? 'last' : 'cursor'),
  readTextFile: (filePath, maxBytes) => ipcRenderer.invoke('read-text-file', filePath, maxBytes),

  // ── Auth ────────────────────────────────────────────────────────
  authGetSession: () => ipcRenderer.invoke('auth:get-session'),
  authSetSession: (session) => ipcRenderer.invoke('auth:set-session', session),
  authOpenOAuthUrl: (url) => ipcRenderer.invoke('auth:open-oauth-url', url),
  authConsumePendingDeepLink: () => ipcRenderer.invoke('auth:consume-pending-deep-link'),
  onAuthDeepLink: (cb) => {
    const handler = (_e, url) => cb(url);
    ipcRenderer.on('auth:deep-link', handler);
    return () => ipcRenderer.removeListener('auth:deep-link', handler);
  },
  authKvGet: (key) => ipcRenderer.invoke('auth:kv-get', key),
  authKvSet: (key, value) => ipcRenderer.invoke('auth:kv-set', key, value),
  authKvList: () => ipcRenderer.invoke('auth:kv-list'),
  // v1.3.48 — Main renderer publishes its auth state so satellites
  // (which run in separate renderer processes with their own auth.ts
  // module-singleton) can mirror it. Send-only fire-and-forget.
  syncAuthState: (state) => ipcRenderer.send('sync-auth-state', state),
  // v1.3.48 — Sync preview/commit lifecycle. App publishes the modal's
  // current phase + diff; main forwards to the settings-dialog satellite.
  // Pass null to dismiss the modal.
  publishSyncPreview: (state) => ipcRenderer.send('sync-preview-state', state),
  // v1.3.49 — Device list + sync status. Main renderer (authenticated)
  // publishes; main forwards to settings satellite (which has no session).
  publishSyncDevices: (state) => ipcRenderer.send('sync-devices-state', state),
  deviceGetInfo: () => ipcRenderer.invoke('device:get-info'),
  getOpenWindows: () => ipcRenderer.invoke('get-open-windows'),
  focusWindow: (title, closeAfter) => ipcRenderer.invoke('focus-window', title, closeAfter),
  launchOrFocusApp: (exePath, closeAfter, monitor) => ipcRenderer.invoke('launch-or-focus-app', exePath, closeAfter, monitor),
  updateShortcut: (shortcut) => ipcRenderer.send('update-shortcut', shortcut),
  /** Temporarily unregister the launcher's global shortcut so the
   *  in-app capture UI can record keys (including the one currently
   *  bound) without the OS intercepting them. Pair with resume. */
  pauseGlobalShortcut:  () => ipcRenderer.send('pause-global-shortcut'),
  resumeGlobalShortcut: () => ipcRenderer.send('resume-global-shortcut'),
  detectDialog: () => ipcRenderer.invoke('detect-dialog'),
  jumpToDialogFolder: (folderPath) => ipcRenderer.send('jump-to-dialog-folder', folderPath),
  storeLoad: () => ipcRenderer.invoke('store-load'),
  // v1.3.50 — Boot resilience fallback: 정상 store 가 손상되었거나
  // migrateData 가 throw 했을 때 호출. 가장 최근 backup 부터 차례로 시도.
  storeLoadBackups: () => ipcRenderer.invoke('store-load-backups'),
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
  analyzeClipboard: (docExtensions) => ipcRenderer.invoke('analyze-clipboard', docExtensions),
  // Document cohort directory scan — pairs with frontend/src/lib/docCohort.ts
  // (ranking layer). Returns { ok, items: [{basename, path, mtime, size}] }.
  listDocCohort: (directory, mask) => ipcRenderer.invoke('list-doc-cohort', directory, mask),
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
  /** Main broadcasts this when the user drags the main window's edges so
   *  the status-bar size slider can re-read the derived `windowSizePct`. */
  /** Renderer perf — fire-and-forget aggregate counts every 10 s.
   *  See frontend/src/lib/perf.ts. */
  perfReport: (payload) => ipcRenderer.send('perf:renderer-report', payload),
  onWindowSizePctChanged: (cb) => {
    const handler = (_e, pct) => cb(pct);
    ipcRenderer.on('window-size-pct-changed', handler);
    return () => ipcRenderer.removeListener('window-size-pct-changed', handler);
  },

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
  /** Renderer notifies main that a badge-fired group launch has
   *  finished (or errored). Main forwards to every overlay so the
   *  spinning ring on the originating badge can clear immediately
   *  instead of waiting for the overlay's safety-timeout. */
  notifyBadgesLaunchDone: (payload) =>
    ipcRenderer.send('badges-launch-done', payload),
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

  // ── Memo (사라지는 메모) — txt export ───────────────────────────
  /** Export a memo body as a UTF-8 .txt file. Returns the absolute path
   *  on success. `slug` is the renderer-prepared filename slug; main
   *  re-sanitises it as defence-in-depth. `customFolder` overrides the
   *  default %APPDATA%/nost/memos/. `openAfter` shell-opens the file
   *  after writing. */
  exportMemoTxt: (args) => ipcRenderer.invoke('memo-export-txt', args),
  /** OS save-as dialog → user picks location + filename. Writes UTF-8
   *  with BOM so Win10 Notepad reads Korean correctly. Caller should
   *  NOT delete the memo on success — this is a snapshot, not a move. */
  saveMemoAs: (args) => ipcRenderer.invoke('memo-save-as', args),
  /** Write the body to a temp file (userData/memos) and shell-open
   *  in the user's default editor. The "메모장에서 열기" button. */
  openMemoExternal: (args) => ipcRenderer.invoke('memo-open-external', args),
  /** Open the memos folder (default or custom) in OS file explorer. */
  openMemoFolder: (customFolder) => ipcRenderer.invoke('memo-open-folder', customFolder),
  /** Resolve the default memo export folder (no custom override). Used
   *  to populate the settings UI placeholder. */
  getMemoDefaultFolder: () => ipcRenderer.invoke('memo-default-folder'),

  // ── Media widget — Windows media-key bridge ─────────────────────
  /** Fire a media key. action: 'play-pause' | 'next' | 'prev' | 'stop' |
   *  'vol-up' | 'vol-down' | 'mute'. */
  mediaCommand: (action) => ipcRenderer.send('media-command', action),
  /** Ask main to focus whichever browser tab is currently playing
   *  audio. Returns null if no audible tab is known (extension not
   *  installed / no audio playing). */
  mediaFocusSource: () => ipcRenderer.invoke('media-focus-source'),

  // ── Image card (v1.3.46+) ───────────────────────────────────────
  /** Read current clipboard image and save to userData/images/{uuid}.png.
   *  Returns { success, path, width, height, byteSize } or
   *  { success:false, reason }. Used by the clipboard gateway banner
   *  when the user clicks "이미지 카드로". */
  saveClipboardImage: () => ipcRenderer.invoke('save-clipboard-image'),
  /** Copy the image at the given path back to the OS clipboard. Used
   *  by card-click on an image card — clicking the card stamps the
   *  image into the clipboard so the user can Ctrl+V into another app. */
  copyImageToClipboard: (filePath, closeAfter) =>
    ipcRenderer.send('copy-image-to-clipboard', filePath, closeAfter),
  /** Delete an image file (called when the image card is deleted so
   *  userData/images/ doesn't accumulate orphans). Path-guarded — only
   *  paths inside userData/images/ are accepted. */
  deleteImageFile: (filePath) => ipcRenderer.invoke('delete-image-file', filePath),

  // ── Color picker (screen-capture eyedropper) ────────────────────
  /** Hide launcher → screenshot primary display → open fullscreen picker.
   *  Resolves with the hex the user clicked, or { success:false, reason }
   *  on cancel / busy / failure. The launcher is always restored. */
  pickColorFromScreen: () => ipcRenderer.invoke('eyedropper-pick'),

  /** Fires after a successful import-data — renderer reloads from
   *  store so the freshly-imported AppData is reflected everywhere
   *  (cards, settings, presets, etc.). */
  onAppDataReloaded: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('app-data-reloaded', handler);
    return () => ipcRenderer.removeListener('app-data-reloaded', handler);
  },

  // ── Satellite ItemDialog (card add/edit) ────────────────────────
  // The card-edit dialog runs in its own BrowserWindow so it can extend
  // past the main launcher's rectangle (pair-split / narrow-window
  // scenarios were getting it clipped). See plans/satellite-dialogs.md.
  /** Open the satellite item-edit dialog with the given initial state.
   *  Payload mirrors the props the inline ItemDialog used to take:
   *  spaces, presets, editItem, defaultSpaceId, allowedTypes,
   *  docExtensions, monitorCount, currentPresetId, startAdvanced,
   *  accentColor. */
  openItemDialog: (payload) => ipcRenderer.send('open-item-dialog', payload),
  /** Subscribe to action events from the satellite (save / request-
   *  advanced / pick-on-screen / toast). App.tsx wires these to the
   *  existing handlers it used to receive as props. */
  onItemDialogAction: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on('item-dialog-action', handler);
    return () => ipcRenderer.removeListener('item-dialog-action', handler);
  },
  /** Fires when the satellite window is destroyed (user closed it).
   *  App.tsx uses this to reset its dialog state. */
  onItemDialogClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('item-dialog-closed', handler);
    return () => ipcRenderer.removeListener('item-dialog-closed', handler);
  },

  // ── Satellite ItemWizard (quick-add / manual-add) ───────────────
  /** Open the satellite quick-add/manual-add wizard. Payload: mode
   *  ('quick' | 'manual'), spaces, defaultSpaceId, docExtensions,
   *  accentColor. */
  openItemWizard: (payload) => ipcRenderer.send('open-item-wizard', payload),
  /** Subscribe to wizard actions (save / save-as-memo). */
  onItemWizardAction: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on('item-wizard-action', handler);
    return () => ipcRenderer.removeListener('item-wizard-action', handler);
  },
  /** Fires when the satellite window is destroyed. */
  onItemWizardClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('item-wizard-closed', handler);
    return () => ipcRenderer.removeListener('item-wizard-closed', handler);
  },

  // ── Satellite SettingsDialog ────────────────────────────────────
  openSettingsDialog: (payload) => ipcRenderer.send('open-settings-dialog', payload),
  onSettingsDialogAction: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on('settings-dialog-action', handler);
    return () => ipcRenderer.removeListener('settings-dialog-action', handler);
  },
  onSettingsDialogClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('settings-dialog-closed', handler);
    return () => ipcRenderer.removeListener('settings-dialog-closed', handler);
  },

  // ── Satellite DocCohortDialog ───────────────────────────────────
  openDocCohortDialog: (payload) => ipcRenderer.send('open-doc-cohort-dialog', payload),
  onDocCohortDialogAction: (cb) => {
    const h = (_e, a) => cb(a);
    ipcRenderer.on('doc-cohort-dialog-action', h);
    return () => ipcRenderer.removeListener('doc-cohort-dialog-action', h);
  },
  onDocCohortDialogClosed: (cb) => {
    const h = () => cb();
    ipcRenderer.on('doc-cohort-dialog-closed', h);
    return () => ipcRenderer.removeListener('doc-cohort-dialog-closed', h);
  },

  // ── Satellite BatchDropDialog ───────────────────────────────────
  openBatchDropDialog: (payload) => ipcRenderer.send('open-batch-drop-dialog', payload),
  onBatchDropDialogAction: (cb) => {
    const h = (_e, a) => cb(a);
    ipcRenderer.on('batch-drop-dialog-action', h);
    return () => ipcRenderer.removeListener('batch-drop-dialog-action', h);
  },
  onBatchDropDialogClosed: (cb) => {
    const h = () => cb();
    ipcRenderer.on('batch-drop-dialog-closed', h);
    return () => ipcRenderer.removeListener('batch-drop-dialog-closed', h);
  },

  // ── Satellite ContainerSlotPicker ───────────────────────────────
  openContainerSlotPicker: (payload) => ipcRenderer.send('open-container-slot-picker', payload),
  onContainerSlotPickerAction: (cb) => {
    const h = (_e, a) => cb(a);
    ipcRenderer.on('container-slot-picker-action', h);
    return () => ipcRenderer.removeListener('container-slot-picker-action', h);
  },
  onContainerSlotPickerClosed: (cb) => {
    const h = () => cb();
    ipcRenderer.on('container-slot-picker-closed', h);
    return () => ipcRenderer.removeListener('container-slot-picker-closed', h);
  },

  // ── Satellite ImageViewer (v1.3.49) ─────────────────────────────
  // 자체 가벼운 이미지 뷰어 (PNG/JPG/SVG/GIF/WEBP 등). payload =
  // { path, label?, accentColor?, theme? }. close 액션 외엔 action
  // 라우팅 필요 없음 (viewer 가 readonly).
  openImageViewer: (payload) => ipcRenderer.send('open-image-viewer', payload),
  // v1.3.50 — 뷰어 크롭 결과 (canvas dataURL) 를 클립보드로.
  copyImageDataToClipboard: (dataUrl) => ipcRenderer.invoke('copy-image-data-to-clipboard', dataUrl),
  // v1.3.52 — 화면 캡처 → userData/images 저장 (capture-feature.md).
  // mode: 'full'(커서 모니터 전체) | 'window'(직전 활성 창).
  captureScreen: (mode) => ipcRenderer.invoke('capture-screen', mode),
});
