const { app, BrowserWindow, globalShortcut, ipcMain, shell, clipboard, Tray, Menu, nativeImage, dialog, session } = require('electron');
const path = require('node:path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const http = require('http');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const store = new Store({ name: 'nost-data' });

function resolvePsScriptsDir() {
  const candidates = [
    path.join(process.resourcesPath || '', 'ps-scripts'),
    path.join(__dirname, 'ps-scripts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(__dirname, 'ps-scripts'); // dev fallback
}
const PS_DIR = resolvePsScriptsDir();
function ps(name) { return path.join(PS_DIR, name); }

/**
 * Resolve target monitor work area from Electron displays.
 * Returns Electron DIP coordinates (96 DPI logical pixels) — these map 1:1 to
 * DPI-unaware Win32 coordinates and can be passed directly to PS scripts that
 * use SetThreadDpiAwarenessContext(UNAWARE) via _Position.ps1.
 */
function getMonitorWorkArea(monitorIndex) {
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  const disp = (monitorIndex >= 1 && monitorIndex <= displays.length)
    ? displays[monitorIndex - 1]
    : screen.getPrimaryDisplay();
  return { wa: disp.workArea, disp };
}

let mainWindow;
let loadingWindow = null;
let tray = null;
let currentShortcut = 'Alt+4';

// ── Daily tips ──────────────────────────────────────────────
const TIPS = [
  // 기본 사용법
  '클립보드에 URL·경로를 복사한 채로 창을 열면 바로 추가할 수 있어요',
  '카드를 꾹 누르면 모니터 이동, 스냅, 삭제 메뉴가 열려요',
  '노드 모드로 여러 앱을 분할화면으로 한번에 실행할 수 있어요',
  '덱 모드로 자주 쓰는 앱 묶음을 한번에 열 수 있어요',
  '스페이스에 색상과 아이콘을 설정해 구분하기 쉽게 만들어보세요',
  '카드를 드래그해서 다른 스페이스로 이동시킬 수 있어요',
  '핀 고정된 카드는 항상 맨 앞 자리를 유지해요',
  '우클릭 드래그로 런처 창 자체를 이동할 수 있어요',
  // 꿀팁: 슬래시 명령어
  '/75 를 입력하면 런처 창이 화면의 75%로 보기 좋게 조정돼요 (/50, /100도 가능)',
  '/tile 1-1 2-1 로 두 카드를 분할화면으로 바로 실행할 수 있어요',
  '//1 을 입력하면 첫 번째 노드 그룹이 바로 실행돼요',
  '/1-3 을 입력하면 1번 스페이스의 3번 카드가 바로 실행돼요',
  '/clipboard 으로 클립보드 내용을 카드로 바로 저장할 수 있어요',
  // 꿀팁: 숨겨진 기능
  '컨테이너 카드에 앱을 배치하면 실행 시 자동으로 스냅 배치돼요',
  '설정 → 모니터에서 방향키를 지정하면 카드에서 빠르게 모니터 이동할 수 있어요',
  '검색창에 텍스트만 입력하면 모든 카드를 실시간 필터링해요',
  '사용 빈도순 정렬로 자주 쓰는 앱을 맨 앞에 둘 수 있어요',
  '스페이스를 접어두면 자주 쓰는 것만 보여 깔끔해져요',
];
function getRandomTip() {
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}

// ── Splash / Loading window ─────────────────────────────────
function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 300,
    height: 210,
    show: true,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const html = encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:100%; height:100%; background:transparent; }
body {
  background: rgba(255,255,255,0.72);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255,255,255,0.9);
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,1);
  border-radius: 8px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100vh;
  font-family: 'Segoe UI', system-ui, sans-serif;
  overflow: hidden;
  user-select: none;
  -webkit-app-region: no-drag;
}
.logo {
  font-size: 34px; font-weight: 800;
  letter-spacing: -2px;
  background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.sub  { font-size: 11px; color: rgba(80,80,120,0.55); margin-top: 5px; letter-spacing: 0.5px; font-weight: 500; }
.ring {
  margin-top: 18px;
  width: 22px; height: 22px;
  border: 2.5px solid rgba(99,102,241,0.18);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.tip {
  margin-top: 20px;
  padding: 8px 14px;
  background: rgba(99,102,241,0.07);
  border: 1px solid rgba(99,102,241,0.15);
  border-radius: 8px;
  font-size: 10px;
  color: rgba(80,80,120,0.65);
  line-height: 1.5;
  text-align: center;
  max-width: 240px;
  animation: fadeIn 0.6s ease 0.3s both;
}
@keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
.tip-label { font-size: 9px; color: rgba(99,102,241,0.6); font-weight: 600; letter-spacing: 0.5px; margin-bottom: 3px; }
</style></head>
<body>
  <div class="logo">nost</div>
  <div class="sub" id="ql-status">시작하는 중...</div>
  <div class="ring"></div>
  <div class="tip"><div class="tip-label">💡 팁</div>${getRandomTip()}</div>
</body></html>`);

  loadingWindow.loadURL(`data:text/html;charset=utf-8,${html}`);
}

// ── Single Instance Lock ────────────────────────────────────
// If user launches app again while it's already running (hidden),
// bring the existing window to front instead of opening a second instance.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Chrome Extension Bridge ─────────────────────────────────
global.chromeTabs = [];
let sseConnection = null;
let lastTabsUpdateAt = 0;
let lastExtensionConnectedAt = 0;

const EXT_PORT = 14502;

const extServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();

  if (req.url === '/tabs' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        global.chromeTabs = JSON.parse(body);
        lastTabsUpdateAt = Date.now();
      } catch(e){}
      res.end('ok');
    });
  } else if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    sseConnection = res;
    lastExtensionConnectedAt = Date.now();
    req.on('close', () => { if(sseConnection === res) sseConnection = null; });
  } else {
    res.writeHead(404); res.end();
  }
});

/** Start the extension bridge server with port-conflict recovery. */
function startExtServer() {
  extServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[ExtServer] Port ${EXT_PORT} in use — killing previous owner and retrying...`);
      exec(`powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort ${EXT_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`, () => {
        setTimeout(() => extServer.listen(EXT_PORT, '127.0.0.1'), 500);
      });
    } else {
      console.error('[ExtServer] Error:', err.message);
    }
  });
  extServer.listen(EXT_PORT, '127.0.0.1');
}

function focusChromeTab(tabId, windowId) {
  if (sseConnection) {
    sseConnection.write(`data: ${JSON.stringify({ action: 'focus', tabId, windowId })}\n\n`);
    return true;
  }
  return false;
}

function resolveExtensionDir() {
  const candidates = [
    path.join(app.getAppPath(), 'chrome-extension'),
    path.join(__dirname, 'chrome-extension'),
    path.join(process.resourcesPath || '', 'chrome-extension'),
    path.join(process.cwd(), 'chrome-extension'),
  ];

  for (const candidate of candidates) {
    const manifestPath = path.join(candidate, 'manifest.json');
    if (fs.existsSync(manifestPath)) return candidate;
  }
  return null;
}

function resolveBrowserExe(target) {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || '';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || '';

  const map = {
    chrome: [
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    whale: [
      path.join(localAppData, 'Naver', 'Naver Whale', 'Application', 'whale.exe'),
      path.join(programFiles, 'Naver', 'Naver Whale', 'Application', 'whale.exe'),
      path.join(programFilesX86, 'Naver', 'Naver Whale', 'Application', 'whale.exe'),
    ],
  };

  const candidates = map[target] || [];
  for (const exePath of candidates) {
    if (exePath && fs.existsSync(exePath)) return exePath;
  }
  return null;
}

function launchBrowserExtensionsPage(target) {
  const exePath = resolveBrowserExe(target);
  if (!exePath) return { ok: false, reason: 'browser-not-found' };

  // Chrome accepts internal URLs via CLI; Whale does not — just open the browser
  const args = target === 'chrome' ? ['chrome://extensions/'] : [];
  try {
    const child = spawn(exePath, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { ok: true, exePath };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
}

function registerShortcut(newShortcut) {
  if (currentShortcut) globalShortcut.unregister(currentShortcut);
  currentShortcut = newShortcut;
  const ret = globalShortcut.register(currentShortcut, () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  if (!ret) console.log('Shortcut registration failed');
}

function createWindow() {
  // First launch: 75% centered. After that: restore last bounds.
  const savedBounds = store.get('windowBounds');
  let initWidth, initHeight, initX, initY;
  if (savedBounds) {
    initWidth = savedBounds.width || 650;
    initHeight = savedBounds.height || 650;
    initX = savedBounds.x;
    initY = savedBounds.y;
  } else {
    const { screen } = require('electron');
    const wa = screen.getPrimaryDisplay().workArea;
    initWidth = Math.round(wa.width * 0.75);
    initHeight = Math.round(wa.height * 0.75);
    initX = wa.x + Math.round((wa.width - initWidth) / 2);
    initY = wa.y + Math.round((wa.height - initHeight) / 2);
  }
  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();

  mainWindow = new BrowserWindow({
    width: initWidth,
    height: initHeight,
    x: initX,
    y: initY,
    minWidth: 400,
    minHeight: 400,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    icon: path.join(__dirname, 'icon.png'),
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
  }
  // Show window only after renderer signals it's fully ready (React mounted + data loaded)
  // Fallback: show after 5s in case signal never arrives
  let windowShown = false;
  const showMainWindow = () => {
    if (windowShown) return;
    windowShown = true;
    // Close splash first (smooth swap)
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close();
      loadingWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  };
  ipcMain.once('renderer-ready', showMainWindow);
  setTimeout(showMainWindow, 5000);

  // Loading status relay: renderer → loading window
  ipcMain.on('set-loading-status', (_, msg) => {
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      const safe = JSON.stringify(String(msg));
      loadingWindow.webContents.executeJavaScript(
        `var el=document.querySelector('.sub'); if(el) el.textContent=${safe};`
      ).catch(() => {});
    }
  });

  // Auto-hide on focus loss
  mainWindow.on('blur', () => {
    const settings = store.get('appData')?.settings ?? {};
    if (settings.autoHide) mainWindow.hide();
  });

  // Save window bounds on move/resize (debounced)
  let boundsTimer = null;
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isMaximized()) return;
      store.set('windowBounds', mainWindow.getBounds());
    }, 500);
  };
  mainWindow.on('moved', saveBounds);
  mainWindow.on('resized', saveBounds);

  registerShortcut(currentShortcut); // Defaults to Alt+4, renderer will update if different

  ipcMain.on('update-shortcut', (event, newShortcut) => {
    registerShortcut(newShortcut);
  });

  // Persistent storage via electron-store
  ipcMain.handle('store-load', async () => {
    return store.get('appData', null);
  });

  ipcMain.handle('store-save', async (event, data) => {
    store.set('appData', data);
    // Sync auto-launch setting with Windows startup
    if (data && data.settings) {
      app.setLoginItemSettings({ openAtLogin: !!data.settings.autoLaunch });
    }
    return true;
  });

  // File/Folder picker dialogs
  ipcMain.handle('pick-folder', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '폴더 선택',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths[0]) return null;
    return filePaths[0];
  });

  ipcMain.handle('pick-exe', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '실행 파일 선택',
      filters: [{ name: '실행 파일', extensions: ['exe', 'bat', 'cmd', 'lnk'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    return filePaths[0];
  });

  ipcMain.handle('get-file-icon', async (event, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      const icon = await app.getFileIcon(filePath, { size: 'large' });
      const dataUrl = icon.toDataURL();
      return dataUrl || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('get-extension-bridge-status', async () => {
    return {
      connected: !!sseConnection,
      tabsCount: (global.chromeTabs || []).length,
      lastTabsUpdateAt,
      lastExtensionConnectedAt,
    };
  });

  ipcMain.handle('open-extension-install-helper', async (event, target = 'chrome') => {
    const extensionDir = resolveExtensionDir();
    if (!extensionDir) {
      const checked = [
        path.join(app.getAppPath(), 'chrome-extension'),
        path.join(__dirname, 'chrome-extension'),
        path.join(process.cwd(), 'chrome-extension'),
      ];
      return {
        success: false,
        reason: 'extension-folder-not-found',
        debug: checked.join(' | '),
      };
    }

    const browserResult = launchBrowserExtensionsPage(target);

    clipboard.writeText(extensionDir);

    return {
      success: browserResult.ok,
      extensionDir,
      copiedPath: true,
      reason: browserResult.ok ? undefined : browserResult.reason,
      browser: target,
      browserExePath: browserResult.exePath,
    };
  });

  // Data export: save JSON file via save dialog
  ipcMain.handle('export-data', async () => {
    const data = store.get('appData', null);
    if (!data) return { success: false, reason: 'no-data' };
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: '데이터 백업',
      defaultPath: `nost-backup-${new Date().toISOString().slice(0,10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { success: false, reason: 'canceled' };
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true, filePath };
    } catch (e) {
      return { success: false, reason: String(e) };
    }
  });

  // Data import: open JSON file via open dialog
  ipcMain.handle('import-data', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '데이터 복원',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { success: false, reason: 'canceled' };
    try {
      const raw = fs.readFileSync(filePaths[0], 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.spaces || !parsed.settings) return { success: false, reason: 'invalid-format' };
      store.set('appData', parsed);
      return { success: true, data: parsed };
    } catch (e) {
      return { success: false, reason: String(e) };
    }
  });

  ipcMain.on('open-url', (event, url, closeAfter) => {

    // Check if URL is opened in Chrome
    let found = false;
    if (global.chromeTabs.length > 0) {
      try {
        const targetUrl = new URL(url);
        const exactMatch = global.chromeTabs.find(t => {
          try { return new URL(t.url).hostname.replace('www.', '') === targetUrl.hostname.replace('www.', ''); } catch(e) { return false; }
        });
        if (exactMatch) {
           focusChromeTab(exactMatch.id, exactMatch.windowId);
           found = true;
        }
      } catch(e) {}
    }
    
    if (!found) {
      shell.openExternal(url);
    }
    if (closeAfter) mainWindow.hide();
  });

  // Open guide file from extraResources
  ipcMain.on('open-guide', () => {
    const guidePath = path.join(process.resourcesPath, 'guide.md');
    if (fs.existsSync(guidePath)) {
      shell.openPath(guidePath);
    } else {
      // Dev mode fallback
      const devPath = path.join(__dirname, 'guide.md');
      if (fs.existsSync(devPath)) shell.openPath(devPath);
    }
  });

  // Smart folder open: focus existing Explorer window if path is already open, else open new
  ipcMain.on('open-path', (event, folderPath, closeAfter) => {
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('open-path.ps1')}"`, {
      env: { ...process.env, QL_PATH: folderPath },
    });
    if (closeAfter) mainWindow.hide();
  });

  // Run command/script
  ipcMain.on('run-cmd', (event, command, closeAfter) => {
    // Wrap in cmd /c so batch files, pipes, etc work
    exec(`cmd /c ${command}`, { windowsHide: false }, (err) => {
      if (err) console.error('run-cmd error:', err.message);
    });
    if (closeAfter) mainWindow.hide();
  });

  ipcMain.on('copy-text', (event, text, closeAfter) => {
    clipboard.writeText(text);
    // Delay hide so React has time to render the "복사됨" toast before window disappears
    if (closeAfter) setTimeout(() => mainWindow.hide(), 700);
  });

  ipcMain.on('hide-app', () => {
    mainWindow.hide();
  });

  // Window drag via right-click
  ipcMain.on('window-start-drag', () => {
    // Store initial position for reference
  });

  ipcMain.on('window-move', (event, x, y) => {
    if (mainWindow) mainWindow.setPosition(x, y);
  });

  ipcMain.handle('get-window-position', () => {
    if (mainWindow) return mainWindow.getPosition();
    return [0, 0];
  });

  ipcMain.on('set-opacity', (event, opacity) => {
    if(mainWindow) mainWindow.setOpacity(opacity);
  });

  // ── Auto-updater IPC ──────────────────────────────────────
  ipcMain.handle('check-for-updates', async () => {
    if (!app.isPackaged) return { status: 'dev-mode', version: app.getVersion() };
    return new Promise((resolve) => {
      function cleanup() {
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('update-available', onAvailable);
        autoUpdater.removeListener('error', onErr);
      }
      const onNotAvailable = () => { cleanup(); resolve({ status: 'up-to-date', version: app.getVersion() }); };
      const onAvailable = (info) => { cleanup(); resolve({ status: 'update-available', version: app.getVersion(), newVersion: info.version }); };
      const onErr = (err) => { cleanup(); resolve({ status: 'error', message: err.message, version: app.getVersion() }); };
      autoUpdater.once('update-not-available', onNotAvailable);
      autoUpdater.once('update-available', onAvailable);
      autoUpdater.once('error', onErr);
      autoUpdater.checkForUpdates().catch(err => { cleanup(); resolve({ status: 'error', message: err.message, version: app.getVersion() }); });
    });
  });

  ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('read-clipboard', async () => {
    const text = clipboard.readText();
    if (text) return text;

    // Check for files copied in Explorer via PowerShell (most reliable on Windows)
    try {
      const ps = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $f=[System.Windows.Forms.Clipboard]::GetFileDropList(); if($f.Count -gt 0){$f[0]}`;
      const b64 = Buffer.from(ps, 'utf16le').toString('base64');
      const filePath = await new Promise((resolve) => {
        exec(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${b64}`, { timeout: 3000, encoding: 'buffer' }, (err, stdout) => {
          resolve(stdout ? Buffer.from(stdout).toString('utf8').trim() : '');
        });
      });
      if (filePath) return filePath;
    } catch (e) {
      // PowerShell failed — fall through
    }
    return '';
  });

  // Analyze clipboard for quick-add suggestion
  ipcMain.handle('analyze-clipboard', async () => {
    let text = clipboard.readText().trim();
    // If no text, try file path from Explorer clipboard
    if (!text) {
      try {
        const ps = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $f=[System.Windows.Forms.Clipboard]::GetFileDropList(); if($f.Count -gt 0){$f[0]}`;
        const b64 = Buffer.from(ps, 'utf16le').toString('base64');
        const filePath = await new Promise((resolve) => {
          exec(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${b64}`, { timeout: 2000, encoding: 'buffer' }, (err, stdout) => {
            resolve(stdout ? Buffer.from(stdout).toString('utf8').trim() : '');
          });
        });
        if (filePath) text = filePath;
      } catch { /* ignore */ }
    }
    if (!text) return { type: 'none' };

    // URL
    if (/^https?:\/\//i.test(text)) {
      try {
        const u = new URL(text);
        return { type: 'url', value: text, label: u.hostname.replace(/^www\./, '') };
      } catch { /* fall through */ }
    }

    // Windows absolute path
    if (/^[A-Za-z]:\\/.test(text) || text.startsWith('\\\\')) {
      const name = text.split(/[/\\]/).filter(Boolean).pop() || text;
      if (/\.exe$/i.test(text)) {
        return { type: 'app', value: text, label: name.replace(/\.exe$/i, '') };
      }
      const hasExt = /\.[a-zA-Z0-9]{1,6}$/.test(name);
      if (!hasExt || text.endsWith('\\') || text.endsWith('/')) {
        return { type: 'folder', value: text.replace(/[/\\]+$/, ''), label: name };
      }
    }

    return { type: 'none' };
  });

  // Check which window titles are currently alive (lightweight poll for inactive-card detection)
  ipcMain.handle('check-windows-alive', async (event, titles) => {
    if (!titles || !titles.length) return {};
    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('check-windows-alive.ps1')}"`, {
        env: { ...process.env, QL_TITLES: JSON.stringify(titles) },
        shell: false,
      }, (err, stdout) => {
        if (err) { resolve({}); return; }
        try {
          const arr = JSON.parse(stdout.trim());
          const map = {};
          for (const item of Array.isArray(arr) ? arr : [arr]) {
            if (item && item.t != null) map[item.t] = !!item.v;
          }
          resolve(map);
        } catch { resolve({}); }
      });
    });
  });

  // Simple filesystem existence check (used for exePath validation in inactive-card toast)
  ipcMain.handle('check-file-exists', (event, filePath) => {
    try { return fs.existsSync(filePath); } catch { return false; }
  });

  ipcMain.handle('get-open-windows', async () => {
    return new Promise((resolve) => {
      // Two-phase scan:
      // 1) Shell.Application COM → enumerate ALL Explorer windows with real folder paths
      // 2) Get-Process → all other visible windows
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('get-open-windows.ps1')}"`, {
        shell: false, maxBuffer: 1024 * 1024 * 5,
      }, (error, stdout) => {
        if (error) { resolve({ windows: [], browserTabs: global.chromeTabs }); return; }
        try {
          const parsed = JSON.parse(stdout.trim());
          let windows = parsed.windows ?? [];
          if (!Array.isArray(windows)) windows = [windows];
          resolve({ windows, browserTabs: global.chromeTabs });
        } catch(e) { resolve({ windows: [], browserTabs: global.chromeTabs }); }
      });
    });
  });

  // ── Monitor utilities ────────────────────────────────────────
  // ── Get recent items from Windows Recent folder ────────
  ipcMain.handle('get-recent-items', async () => {
    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('get-recent-items.ps1')}"`, {
        timeout: 5000,
        encoding: 'buffer',
      }, (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout);
          resolve(JSON.parse(text.trim()));
        } catch { resolve([]); }
      });
    });
  });

  ipcMain.handle('get-monitors', () => {
    const { screen } = require('electron');
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, i) => ({
      index: i + 1,
      id: d.id,
      isPrimary: d.id === primary.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
    }));
  });

  ipcMain.handle('identify-monitors', async () => {
    const { screen, BrowserWindow: BW } = require('electron');
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const wins = displays.map((display, i) => {
      const { x, y, width, height } = display.bounds;
      const ww = 200, wh = 200;
      const win = new BW({
        x: x + Math.floor(width / 2) - Math.floor(ww / 2),
        y: y + Math.floor(height / 2) - Math.floor(wh / 2),
        width: ww, height: wh,
        frame: false, transparent: true,
        alwaysOnTop: true, skipTaskbar: true, focusable: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      const label = display.id === primary.id ? '주 모니터' : '보조 모니터';
      const html = `<!DOCTYPE html><html style="margin:0;background:transparent"><body style="margin:0;display:flex;align-items:center;justify-content:center;width:200px;height:200px"><div style="background:rgba(12,12,22,0.72);backdrop-filter:blur(32px) saturate(160%);-webkit-backdrop-filter:blur(32px) saturate(160%);border-radius:22px;width:172px;height:172px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;border:2px solid rgba(99,102,241,0.65);box-shadow:0 0 0 1px rgba(99,102,241,0.15),0 0 48px rgba(99,102,241,0.45),0 16px 48px rgba(0,0,0,0.65)"><div style="color:#fff;font-size:78px;font-weight:900;font-family:system-ui;line-height:1;text-shadow:0 0 24px rgba(99,102,241,0.7)">${i + 1}</div><div style="color:rgba(255,255,255,0.5);font-size:11px;font-family:system-ui;letter-spacing:0.04em">${label}</div></div></body></html>`;
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      return win;
    });
    await new Promise(r => setTimeout(r, 2600));
    wins.forEach(w => { try { if (!w.isDestroyed()) w.close(); } catch {} });
    return { count: displays.length };
  });

  // Smart app launch: focus if running, launch if not
  ipcMain.handle('launch-or-focus-app', async (event, exePath, closeAfter, monitor) => {
    if (closeAfter) mainWindow.hide();
    const result = await new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('launch-or-focus-app.ps1')}"`, {
        env: { ...process.env, QL_PATH: exePath },
        timeout: 10000,
      }, (err, stdout) => {
        if (err) { resolve({ success: false, error: err.message }); return; }
        const out = stdout.trim().toUpperCase();
        resolve({ success: true, action: out.includes('FOCUSED') ? 'focused' : 'launched' });
      });
    });

    // Monitor positioning is handled by the caller (ItemCard maximizeWindow).
    // Do NOT do a background SetWindowPos here — it races with and undoes maximizeWindow.
    return result;
  });

  ipcMain.handle('focus-window', async (event, title, closeAfter) => {
    if (closeAfter) mainWindow.hide();
    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('focus-window.ps1')}"`, {
        env: { ...process.env, QL_TITLE: title },
        timeout: 5000,
      }, (err, stdout) => {
        if (err) { resolve({ success: false, error: err.message }); return; }
        resolve({ success: stdout.trim().toUpperCase().includes('FOUND') });
      });
    });
  });

  // ── Tile windows (Node mode split-screen) ──────────────
  ipcMain.handle('tile-windows', async (event, items) => {
    // items: array of { type, value, title }
    let hasDetach = false;

    // Step 1: Launch each item. For url/browser types, check for existing
    //         Chrome tab and detach it into its own window instead of opening new.
    const enrichedItems = items.map(item => ({ ...item, tabTitle: '', tabId: 0 }));

    for (let i = 0; i < enrichedItems.length; i++) {
      const item = enrichedItems[i];
      switch (item.type) {
        case 'app':
        case 'window':
        case 'folder': {
          // These are handled by PS tiling — just focus/launch them
          const psLaunch = item.type === 'app' ? `
$t = $env:QL_PATH
$p = Get-Process | Where-Object { try { $_.MainModule.FileName -eq $t } catch { $false } } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) { $h = $p.MainWindowHandle; Add-Type @"
using System; using System.Runtime.InteropServices;
public class QL1 { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@; [QL1]::ShowWindow($h,9); [QL1]::SetForegroundWindow($h) } else { Start-Process $t }`
          : item.type === 'folder' ? `
$shell=New-Object -ComObject Shell.Application; $found=$false; $tp=$env:QL_PATH.TrimEnd('\')
foreach($w in $shell.Windows()){try{if($w.Document -ne $null -and $w.Document.Folder.Self.Path.TrimEnd('\') -eq $tp){Add-Type @"
using System;using System.Runtime.InteropServices;
public class QL2{[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);}
"@;$hw=[IntPtr][long]$w.HWND;[QL2]::ShowWindow($hw,9);[QL2]::SetForegroundWindow($hw);$found=$true;break}}catch{}}
if(-not $found){Start-Process explorer.exe $env:QL_PATH}`
          : `
$p = Get-Process | Where-Object { $_.MainWindowTitle -eq $env:QL_TITLE } | Select-Object -First 1
if($p){Add-Type @"
using System;using System.Runtime.InteropServices;
public class QL3{[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);}
"@;[QL3]::ShowWindow($p.MainWindowHandle,9);[QL3]::SetForegroundWindow($p.MainWindowHandle)}`;
          const b64l = Buffer.from(psLaunch.trim(), 'utf16le').toString('base64');
          const envL = { ...process.env };
          if (item.type === 'window') envL.QL_TITLE = item.value || item.title;
          else envL.QL_PATH = item.value;
          exec(`powershell.exe -NoProfile -EncodedCommand ${b64l}`, { env: envL });
          break;
        }
        case 'url':
        case 'browser': {
          // Try to find matching Chrome tab and detach it
          let detached = false;
          if (global.chromeTabs && global.chromeTabs.length > 0) {
            try {
              const targetHost = new URL(item.value).hostname.replace('www.', '');
              const matchTab = global.chromeTabs.find(t => {
                try { return new URL(t.url).hostname.replace('www.', '') === targetHost; } catch { return false; }
              });
              if (matchTab && sseConnection) {
                sseConnection.write(`data: ${JSON.stringify({ action: 'detach', tabId: matchTab.id })}\n\n`);
                enrichedItems[i].tabTitle = matchTab.title || '';
                enrichedItems[i].tabId = matchTab.id;
                detached = true;
                hasDetach = true;
              }
            } catch { /* invalid URL */ }
          }
          if (!detached) {
            shell.openExternal(item.value);
          }
          break;
        }
      }
    }

    // Step 2: Wait for windows to appear (longer if detach was needed)
    const waitMs = hasDetach ? 1600 : 900;

    return new Promise((resolve) => {
      setTimeout(() => {
        const identifiers = enrichedItems.map(i => ({
          type: i.type,
          value: i.value,
          title: i.title || '',
          tabTitle: i.tabTitle || '',
        }));

        // PowerShell tiling script
        // Compensates for Windows 10/11 invisible 8px window border → gap-free tiling
        // KEY: Electron workArea = 96-DPI per-monitor logical px = DPI-unaware Win32 space.
        // Do NOT multiply by scaleFactor — that would convert to physical px, breaking multi-monitor.
        const { screen: _tileScr } = require('electron');
        const _tilePri = _tileScr.getPrimaryDisplay();
        const _twa = {
          x:      Math.round(_tilePri.workArea.x),
          y:      Math.round(_tilePri.workArea.y),
          width:  Math.round(_tilePri.workArea.width),
          height: Math.round(_tilePri.workArea.height),
        };
        exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('tile-windows.ps1')}"`, {
          shell: false,
          maxBuffer: 1024 * 1024 * 2,
          env: {
            ...process.env,
            QL_SCREEN_X: String(_twa.x),
            QL_SCREEN_Y: String(_twa.y),
            QL_SCREEN_W: String(_twa.width),
            QL_SCREEN_H: String(_twa.height),
            QL_ITEMS: JSON.stringify(identifiers),
          },
        }, (err, stdout, stderr) => {
          if (stderr) console.error('tile-windows stderr:', stderr);
          if (err) console.error('tile-windows error:', err.message);
          if (stdout) console.log('tile-windows debug:\n' + stdout);
          resolve({ success: !err, debug: stdout || '', error: err?.message || '' });
        });
      }, waitMs);
    });
  });

  // ── Check which items are already visible (for tile pre-check) ───
  ipcMain.handle('check-items-for-tile', async (event, items) => {
    // items: array of { type, value, title }
    // Returns: array of { idx, alive } — one per input item
    const results = items.map((item, idx) => ({ idx, alive: false, note: '' }));

    // Check url/browser via chromeTabs (JS side, fast)
    items.forEach((item, idx) => {
      if (item.type === 'url' || item.type === 'browser') {
        if (global.chromeTabs && global.chromeTabs.length > 0) {
          try {
            const targetHost = new URL(item.value).hostname.replace('www.', '');
            const found = global.chromeTabs.some(t => {
              try { return new URL(t.url).hostname.replace('www.', '') === targetHost; } catch { return false; }
            });
            results[idx].alive = found;
            results[idx].note = found ? 'tab' : 'no-tab';
          } catch { results[idx].alive = false; }
        }
      }
    });

    // Check window/app/folder types via PS
    const needsCheck = items.map((item, idx) => ({ ...item, idx }))
      .filter(i => i.type === 'window' || i.type === 'app' || i.type === 'folder');

    if (needsCheck.length === 0) return results;

    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('check-items-for-tile.ps1')}"`, {
        env: { ...process.env, QL_ITEMS: JSON.stringify(needsCheck) },
        maxBuffer: 1024 * 1024,
      }, (err, stdout) => {
        if (!err && stdout.trim()) {
          try {
            let parsed = JSON.parse(stdout.trim());
            if (!Array.isArray(parsed)) parsed = [parsed];
            parsed.forEach(r => { results[r.idx].alive = r.alive; });
          } catch { /* leave defaults */ }
        }
        resolve(results);
      });
    });
  });

  // ── Launch items for tile (fire-and-forget, returns identifiers + waitMs) ──
  ipcMain.handle('launch-items-for-tile', async (event, items) => {
    let hasDetach = false;
    const enrichedItems = items.map(item => ({ ...item, tabTitle: '', tabId: 0 }));

    for (let i = 0; i < enrichedItems.length; i++) {
      const item = enrichedItems[i];
      switch (item.type) {
        case 'app':
        case 'window':
        case 'folder': {
          const psLaunch = item.type === 'app' ? `
$t = $env:QL_PATH
$exeName = [System.IO.Path]::GetFileNameWithoutExtension($t)
$p = Get-Process | Where-Object { try { $_.MainModule.FileName -eq $t } catch { $false } } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { $p = Get-Process -Name $exeName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
if ($p) { $h = $p.MainWindowHandle; Add-Type @"
using System; using System.Runtime.InteropServices;
public class QL1 { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@; [QL1]::ShowWindow($h,9); [QL1]::SetForegroundWindow($h) } else { Start-Process $t }`
            : item.type === 'folder' ? `
$shell=New-Object -ComObject Shell.Application; $found=$false; $tp=$env:QL_PATH.TrimEnd('\')
foreach($w in $shell.Windows()){try{if($w.Document -ne $null -and $w.Document.Folder.Self.Path.TrimEnd('\') -eq $tp){Add-Type @"
using System;using System.Runtime.InteropServices;
public class QL2{[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);}
"@;$hw=[IntPtr][long]$w.HWND;[QL2]::ShowWindow($hw,9);[QL2]::SetForegroundWindow($hw);$found=$true;break}}catch{}}
if(-not $found){Start-Process explorer.exe $env:QL_PATH}`
            : `
$p = Get-Process | Where-Object { $_.MainWindowTitle -eq $env:QL_TITLE } | Select-Object -First 1
if(-not $p){
  $searchTitle = $env:QL_TITLE
  $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$searchTitle*" } | Select-Object -First 1
}
if($p){Add-Type @"
using System;using System.Runtime.InteropServices;
public class QL3{[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);}
"@;[QL3]::ShowWindow($p.MainWindowHandle,9);[QL3]::SetForegroundWindow($p.MainWindowHandle)}`;
          const b64l = Buffer.from(psLaunch.trim(), 'utf16le').toString('base64');
          const envL = { ...process.env };
          if (item.type === 'window') envL.QL_TITLE = item.value || item.title;
          else envL.QL_PATH = item.value;
          exec(`powershell.exe -NoProfile -EncodedCommand ${b64l}`, { env: envL });
          break;
        }
        case 'url':
        case 'browser': {
          let handled = false;
          // Check if tab already exists → detach into own window
          if (global.chromeTabs && global.chromeTabs.length > 0) {
            try {
              const targetHost = new URL(item.value).hostname.replace('www.', '');
              const matchTab = global.chromeTabs.find(t => {
                try { return new URL(t.url).hostname.replace('www.', '') === targetHost; } catch { return false; }
              });
              if (matchTab && sseConnection) {
                sseConnection.write(`data: ${JSON.stringify({ action: 'detach', tabId: matchTab.id })}\n\n`);
                enrichedItems[i].tabTitle = matchTab.title || '';
                enrichedItems[i].tabId = matchTab.id;
                handled = true;
                hasDetach = true;
              }
            } catch { /* invalid URL */ }
          }
          // Tab doesn't exist yet → open directly in its own window via Extension
          if (!handled && sseConnection) {
            sseConnection.write(`data: ${JSON.stringify({ action: 'openWindow', url: item.value })}\n\n`);
            handled = true;
            hasDetach = true;
          }
          // No Extension connected → fallback
          if (!handled) shell.openExternal(item.value);
          break;
        }
      }
    }

    const waitMs = hasDetach ? 2200 : 1100;
    const identifiers = enrichedItems.map(i => ({
      type: i.type, value: i.value, title: i.title || '', tabTitle: i.tabTitle || '', tabId: i.tabId || 0,
    }));
    return { waitMs, identifiers };
  });

  // ── Run tile PS only (no launching) ────────────────────────
  ipcMain.handle('run-tile-ps', async (event, { identifiers, waitMs = 800, monitor = 0 }) => {
    // Electron DIP coords → PS scripts via _Position.ps1 (DPI-unaware context). No scaling.
    const { wa } = getMonitorWorkArea(monitor);
    const targetWA = { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
    const count = identifiers.length;
    // Browser resize also uses Electron DIP (logical px) — same as targetWA
    const colWidthBaseLogical = Math.floor(targetWA.width / count);

    // ── Find Chrome tab matching an identifier ─────────────
    const findTab = (item) => {
      const tabs = global.chromeTabs || [];
      let tab = item.tabId ? tabs.find(t => t.id === item.tabId) : null;
      if (!tab && item.tabTitle) tab = tabs.find(t => t.title === item.tabTitle);
      if (!tab) {
        try {
          const host = new URL(item.value).hostname.replace('www.', '');
          tab = tabs.find(t => { try { return new URL(t.url).hostname.replace('www.', '') === host; } catch { return false; } });
        } catch {}
      }
      return tab || null;
    };

    const browserIndices = identifiers.reduce((acc, item, i) => {
      if (item.type === 'url' || item.type === 'browser') acc.push(i);
      return acc;
    }, []);

    // ── Browser promise: poll until each tab is alone in its window ──
    // Only then send resize — ensures we don't resize while still loading
    const browserPromise = (browserIndices.length === 0 || !sseConnection) ? Promise.resolve() :
      new Promise(resolve => {
        const done = new Set();
        const deadline = Date.now() + 15000;
        const poll = () => {
          const tabs = global.chromeTabs || [];
          for (const i of browserIndices) {
            if (done.has(i)) continue;
            const tab = findTab(identifiers[i]);
            if (tab && tabs.filter(t => t.windowId === tab.windowId).length === 1) {
              const colW = i === count - 1 ? targetWA.width - colWidthBaseLogical * (count - 1) : colWidthBaseLogical;
              sseConnection.write(`data: ${JSON.stringify({
                action: 'resize', windowId: tab.windowId, tabId: tab.id,
                left: targetWA.x + i * colWidthBaseLogical, top: targetWA.y, width: colW, height: targetWA.height,
              })}\n\n`);
              done.add(i);
            }
          }
          if (done.size >= browserIndices.length || Date.now() >= deadline) resolve();
          else setTimeout(poll, 500);
        };
        setTimeout(poll, 400);
      });

    // ── PS promise: runs immediately, PS itself polls up to 10s ──
    const psPromise = new Promise((resolve) => {
      {
        // Mark browser items so PS pre-skips them (no 10s timeout)
        const flagged = identifiers.map(item => ({
          ...item,
          isBrowser: item.type === 'url' || item.type === 'browser',
        }));
        const monitorIndex = typeof monitor === 'number' ? monitor : 0;
        // Pass Electron-resolved work area directly to PS (avoids AllScreens ordering issues)
        const psScreenX = targetWA.x;
        const psScreenY = targetWA.y;
        const psScreenW = targetWA.width;
        const psScreenH = targetWA.height;
        exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('run-tile-ps.ps1')}"`, {
          shell: false,
          maxBuffer: 1024 * 1024 * 2,
          timeout: 45000,
          env: {
            ...process.env,
            QL_SCREEN_X: String(psScreenX),
            QL_SCREEN_Y: String(psScreenY),
            QL_SCREEN_W: String(psScreenW),
            QL_SCREEN_H: String(psScreenH),
            QL_MONITOR: String(monitorIndex),
            QL_ITEMS: JSON.stringify(flagged),
          },
        }, (err, stdout, stderr) => {
          if (stderr) console.error('run-tile-ps stderr:', stderr);
          resolve({ success: !err, error: err?.message || '' });
        });
      }
    });

    // Both browser resize AND PS must finish before we say "완료"
    const [, psResult] = await Promise.all([browserPromise, psPromise]);
    return psResult;
  });

  // ── Maximize a specific window to fill target monitor work area ──
  ipcMain.handle('maximize-window', async (event, { item, monitor = 0 }) => {
    // PS script queries Windows directly for work area via Get-NativeWorkArea.
    // Only pass monitor index + item — no coordinate translation needed.
    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('maximize-window.ps1')}"`, {
        shell: false,
        timeout: 10000,
        env: {
          ...process.env,
          QL_ITEM: JSON.stringify(item),
          QL_MONITOR: String(monitor),
        },
      }, (err, stdout, stderr) => {
        if (stderr) console.error(stderr);
        const out = (stdout || '').trim();
        resolve({ success: !err && out === 'OK' });
      });
    });
  });

  // ── Resize the launcher app window itself to pct% of its current monitor ──
  ipcMain.handle('resize-active-window', async (event, { pct }) => {
    const { screen, BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false };
    // Get the display the window is currently on (logical pixels)
    const display = screen.getDisplayMatching(win.getBounds());
    const wa = display.workArea; // logical pixels — BrowserWindow uses logical px
    if (pct >= 100) {
      win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height }, true);
    } else {
      const winW = Math.round(wa.width  * pct / 100);
      const winH = Math.round(wa.height * pct / 100);
      const x    = wa.x + Math.round((wa.width  - winW) / 2);
      const y    = wa.y + Math.round((wa.height - winH) / 2);
      win.setBounds({ x, y, width: winW, height: winH }, true);
    }
    return { success: true };
  });

  // ── Snap window to zone (left/right/top half) ─────────────
  ipcMain.handle('snap-window', async (event, { item, zone }) => {
    // Electron workArea = 96-DPI per-monitor logical px = DPI-unaware Win32 space.
    // PS script queries Windows directly for work area via Get-NativeWorkArea.
    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('snap-window.ps1')}"`, {
        shell: false,
        timeout: 10000,
        env: {
          ...process.env,
          QL_ITEM: JSON.stringify(item),
          QL_ZONE: zone,
        },
      }, (err) => {
        resolve({ success: !err });
      });
    });
  });

  // Kick Feature: Check foreground window for File Dialog
  ipcMain.handle('detect-dialog', async () => {
    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('detect-dialog.ps1')}"`, (err, stdout) => {
        try { resolve(JSON.parse(stdout.trim())); } catch(e) { resolve({ isDialog: false }); }
      });
    });
  });

  // Kick Feature: Jump to folder in active dialog
  ipcMain.on('jump-to-dialog-folder', (event, folderPath) => {
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('jump-to-dialog-folder.ps1')}"`, {
      env: { ...process.env, QL_PATH: folderPath },
    });
  });
}

app.whenReady().then(() => {
  // Show splash immediately so there's visual feedback during cold-start
  createLoadingWindow();

  // Start the Chrome extension bridge server (after app is ready)
  startExtServer();

  // CSP Headers
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: https://www.google.com; " +
          "script-src 'self'; " +
          "connect-src 'self' http://127.0.0.1:14502"
        ],
      },
    });
  });

  createWindow();

  // ── Monitor hot-plug detection ─────────────────────────────
  // Notify renderer whenever monitors are added or removed so it can
  // refresh monitorCount and validate stored monitor preferences.
  {
    const { screen: _monScr } = require('electron');
    const sendMonitorChange = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const primary = _monScr.getPrimaryDisplay();
      const monitors = _monScr.getAllDisplays().map((d, i) => ({
        index: i + 1, id: d.id, isPrimary: d.id === primary.id,
        bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor,
      }));
      mainWindow.webContents.send('monitors-changed', monitors);
    };
    _monScr.on('display-added',   sendMonitorChange);
    _monScr.on('display-removed', sendMonitorChange);
    _monScr.on('display-metrics-changed', sendMonitorChange);
  }

  // ── Auto-updater setup ─────────────────────────────────────
  if (app.isPackaged) {
    autoUpdater.logger = null; // suppress verbose logging
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Public repo — no token needed for release access

    autoUpdater.on('update-available', (info) => {
      if (mainWindow) mainWindow.webContents.send('update-available', { version: info.version });
    });

    autoUpdater.on('update-downloaded', (info) => {
      if (mainWindow) mainWindow.webContents.send('update-downloaded', { version: info.version });
    });

    autoUpdater.on('error', (err) => {
      console.log('[AutoUpdater] error:', err.message);
    });

    // Check for updates 5 seconds after launch (non-blocking)
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  }

  // Create Tray Icon
  const iconPath = path.join(__dirname, 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if(icon.isEmpty()) {
      // Fallback
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABZSURBVDhPY/z//z8DNgAMwDSjG0BWAzABqhlAlwDRQJQA1zIwAGqBGBOISaWAwQCohoEBsEEYw+gGgDWDARgGwwAwA1IMgBnA1AAjC9MAsgEoA0YGQM2AhQEADgA/0qDq3m0AAAAASUVORK5CYII=';
      icon = nativeImage.createFromDataURL('data:image/png;base64,' + b64);
  } else {
      icon = icon.resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  const appVersion = app.getVersion();
  const contextMenu = Menu.buildFromTemplate([
    { label: `버전 ${appVersion}`, enabled: false },
    { label: '업데이트 확인', click: async () => {
        if (!app.isPackaged) {
          dialog.showMessageBox({ type: 'info', title: '업데이트', message: '개발 모드에서는 업데이트를 확인할 수 없습니다.' });
          return;
        }
        const result = await new Promise((resolve) => {
          function cleanup() {
            autoUpdater.removeListener('update-not-available', onNotAvailable);
            autoUpdater.removeListener('update-available', onAvailable);
            autoUpdater.removeListener('error', onErr);
          }
          const onNotAvailable = () => { cleanup(); resolve({ status: 'up-to-date' }); };
          const onAvailable = (info) => { cleanup(); resolve({ status: 'available', version: info.version }); };
          const onErr = (err) => { cleanup(); resolve({ status: 'error', message: err.message }); };
          autoUpdater.once('update-not-available', onNotAvailable);
          autoUpdater.once('update-available', onAvailable);
          autoUpdater.once('error', onErr);
          autoUpdater.checkForUpdates().catch(err => { cleanup(); resolve({ status: 'error', message: err.message }); });
        });
        if (result.status === 'up-to-date') {
          dialog.showMessageBox({ type: 'info', title: '업데이트', message: `최신 버전입니다. (v${app.getVersion()})` });
        } else if (result.status === 'available') {
          dialog.showMessageBox({ type: 'info', title: '업데이트 발견', message: `새 버전 v${result.version}이 있습니다.\n백그라운드에서 다운로드 중입니다.` });
        } else {
          // Extract a short human-readable error (avoid dumping full HTTP response)
          let errMsg = result.message ?? '알 수 없는 오류';
          // Grab just the status code + first meaningful line
          const m404 = errMsg.match(/404/);
          const mStatus = errMsg.match(/"method:\s*\w+[^"]*"/);
          if (m404) {
            errMsg = '업데이트 정보를 찾을 수 없습니다 (404).\n최신 릴리즈에 업데이트 파일이 없을 수 있습니다.';
          } else {
            const firstLine = errMsg.split('\n')[0].trim();
            errMsg = firstLine.length > 120 ? firstLine.substring(0, 120) + '...' : firstLine;
          }
          dialog.showMessageBox({ type: 'warning', title: '업데이트 오류', message: `업데이트 확인에 실패했습니다:\n\n${errMsg}` });
        }
    }},
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('nost');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();

  // Close SSE connection so the TCP socket releases immediately
  if (sseConnection) {
    sseConnection.destroy();
    sseConnection = null;
  }
  // Stop accepting new connections and close the port
  extServer.close();
});
