const { app, BrowserWindow, globalShortcut, ipcMain, shell, clipboard, Tray, Menu, nativeImage, dialog, session } = require('electron');
const path = require('node:path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const http = require('http');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const store = new Store({ name: 'nost-data' });

let mainWindow;
let loadingWindow = null;
let tray = null;
let currentShortcut = 'Alt+4';

// ── Splash / Loading window ─────────────────────────────────
function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 300,
    height: 180,
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
  margin-top: 22px;
  width: 22px; height: 22px;
  border: 2.5px solid rgba(99,102,241,0.18);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style></head>
<body>
  <div class="logo">nost</div>
  <div class="sub">시작하는 중...</div>
  <div class="ring"></div>
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

// Chrome Extension Bridge
global.chromeTabs = [];
let sseConnection = null;
let lastTabsUpdateAt = 0;
let lastExtensionConnectedAt = 0;

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
extServer.listen(14502, '127.0.0.1');

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
  // Restore last window bounds, fallback to defaults
  const savedBounds = store.get('windowBounds', { width: 650, height: 650, x: undefined, y: undefined });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();

  mainWindow = new BrowserWindow({
    width: savedBounds.width || 650,
    height: savedBounds.height || 650,
    x: savedBounds.x,
    y: savedBounds.y,
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
    const psCode = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$shell = New-Object -ComObject Shell.Application
$target = $env:QL_PATH.TrimEnd('\')
$found = $false
foreach ($w in $shell.Windows()) {
    try {
        if ($w.Document -ne $null -and $w.Document.Folder.Self.Path.TrimEnd('\') -eq $target) {
            $hwnd = [IntPtr][long]$w.HWND
            [Win32]::ShowWindow($hwnd, 9)
            [Win32]::SetForegroundWindow($hwnd)
            $found = $true
            break
        }
    } catch {}
}
if (-not $found) { Start-Process explorer.exe $env:QL_PATH }`;
    const b64 = Buffer.from(psCode, 'utf16le').toString('base64');
    exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, {
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

  // Check which window titles are currently alive (lightweight poll for inactive-card detection)
  ipcMain.handle('check-windows-alive', async (event, titles) => {
    if (!titles || !titles.length) return {};
    return new Promise((resolve) => {
      const psCode = `
function Strip-AppSuffix { param([string]$s) if ($s -match '^(.*?)\s+-\s+[^-]{1,30}$') { return $Matches[1].Trim() } return $s.Trim() }
$titles = $env:QL_TITLES | ConvertFrom-Json
$result = @()
foreach ($t in $titles) {
    $tBase = Strip-AppSuffix $t
    $p = Get-Process | Where-Object {
        $_.MainWindowHandle -ne 0 -and (
            $_.MainWindowTitle -eq $t -or
            (Strip-AppSuffix $_.MainWindowTitle) -eq $t -or
            $_.MainWindowTitle -eq $tBase -or
            (Strip-AppSuffix $_.MainWindowTitle) -eq $tBase
        )
    } | Select-Object -First 1
    $result += [PSCustomObject]@{ t=$t; v=($null -ne $p) }
}
ConvertTo-Json -InputObject @($result) -Compress -Depth 2`.trim();
      const b64 = Buffer.from(psCode, 'utf16le').toString('base64');
      exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, {
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
      const psCommand = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class User32 {
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

# Phase 1: Explorer windows via Shell.Application (gets real folder paths)
$shell = New-Object -ComObject Shell.Application
$explorers = @()
foreach ($w in $shell.Windows()) {
    try {
        $p = $w.Document.Folder.Self.Path
        $n = $w.LocationName
        $h = $w.HWND
        if ($p -and $p -notlike 'http*' -and $p -notlike '::{*') {
            $explorers += @{ ProcessName='explorer'; MainWindowTitle=$n; FolderPath=$p; HWND=$h }
        }
    } catch {}
}

# Phase 2: Non-explorer visible windows (with ExePath)
$procs = @(Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and
    [User32]::IsWindowVisible($_.MainWindowHandle) -and
    $_.MainWindowTitle -and
    $_.ProcessName -ne 'explorer' -and
    $_.ProcessName -ne 'electron' -and
    $_.ProcessName -ne 'nost'
} | ForEach-Object {
    $ep = ''
    try { $ep = $_.MainModule.FileName } catch {}
    @{ ProcessName=$_.ProcessName; MainWindowTitle=$_.MainWindowTitle; ExePath=$ep }
})

$all = @()
if ($explorers.Count -gt 0) { $all += $explorers }
if ($procs.Count -gt 0) { $all += $procs }

ConvertTo-Json -InputObject @{ windows=$all } -Compress -Depth 3`;

      const b64 = Buffer.from(psCommand, 'utf16le').toString('base64');
      exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, { shell: false, maxBuffer: 1024 * 1024 * 5 }, (error, stdout) => {
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
    const psCode = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$target = $env:QL_PATH
$proc = Get-Process | Where-Object {
    try { $_.MainModule.FileName -eq $target } catch { $false }
} | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1

if ($proc) {
    $hWnd = $proc.MainWindowHandle
    [Win32]::ShowWindow($hWnd, 9)
    [Win32]::SetForegroundWindow($hWnd)
    Write-Output "FOCUSED"
} else {
    Start-Process $target
    Write-Output "LAUNCHED"
}`;
    if (closeAfter) mainWindow.hide();
    const b64 = Buffer.from(psCode, 'utf16le').toString('base64');
    const result = await new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, {
        env: { ...process.env, QL_PATH: exePath },
      }, (err, stdout) => {
        if (err) { resolve({ action: 'error', error: err.message }); return; }
        const out = stdout.trim().toUpperCase();
        resolve({ action: out.includes('FOCUSED') ? 'focused' : 'launched' });
      });
    });

    // Monitor positioning is handled by the caller (ItemCard maximizeWindow).
    // Do NOT do a background SetWindowPos here — it races with and undoes maximizeWindow.
    return result;
  });

  ipcMain.handle('focus-window', async (event, title, closeAfter) => {
    const psCode = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
function Strip-AppSuffix { param([string]$s) if ($s -match '^(.*?)\s+-\s+[^-]{1,30}$') { return $Matches[1].Trim() } return $s.Trim() }
$tgt = $env:QL_TITLE; $tgtBase = Strip-AppSuffix $tgt
$process = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and (
        $_.MainWindowTitle -eq $tgt -or
        (Strip-AppSuffix $_.MainWindowTitle) -eq $tgt -or
        $_.MainWindowTitle -eq $tgtBase -or
        (Strip-AppSuffix $_.MainWindowTitle) -eq $tgtBase
    )
} | Select-Object -First 1
if ($process) {
  $hWnd = $process.MainWindowHandle
  [Win32]::ShowWindow($hWnd, 9)
  [Win32]::SetForegroundWindow($hWnd)
  Write-Output "FOUND"
} else {
  Write-Output "NOT_FOUND"
}`;
    if (closeAfter) mainWindow.hide();
    const b64 = Buffer.from(psCode, 'utf16le').toString('base64');
    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, { env: { ...process.env, QL_TITLE: title } }, (err, stdout) => {
        if (err) { resolve({ found: false, error: err.message }); return; }
        resolve({ found: stdout.trim().toUpperCase().includes('FOUND') });
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
        const psCode = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class TileWin32 {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int X, int Y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
# NO SetProcessDPIAware: keep process DPI-unaware so Win32 coords match Electron workArea (96-DPI logical)
# Work area from Electron workArea (96-DPI per-monitor logical)
$screen = [PSCustomObject]@{ X=${_twa.x}; Y=${_twa.y}; Width=${_twa.width}; Height=${_twa.height} }

$items = '${JSON.stringify(identifiers).replace(/[^\x00-\x7F]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).replace(/'/g, "''")}' | ConvertFrom-Json
$count = $items.Count
if ($count -lt 2) { exit }

# Exact column width (last column gets remainder)
$colWidthBase = [math]::Floor($screen.Width / $count)
# Use long integer set for reliable HWND dedup (IntPtr comparison is unreliable in PS)
$usedHwndInts = [System.Collections.Generic.List[long]]::new()

# Windows 10/11 invisible shadow border compensation
# Each window has an 8px transparent resize area on each side.
# We extend the HWND rect by this amount so visible edges meet perfectly.
$border = 8

for ($i = 0; $i -lt $count; $i++) {
    $item = $items[$i]
    $hwnd = $null

    if ($item.type -eq 'app') {
        # Primary: match by full exe path
        $proc = Get-Process | Where-Object {
            try { $_.MainModule.FileName -eq $item.value } catch { $false }
        } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if (-not $proc) {
            # Fallback: match by process name (basename without .exe) for 64-bit or access-denied cases
            $exeName = [System.IO.Path]::GetFileNameWithoutExtension($item.value)
            $proc = Get-Process -Name $exeName -ErrorAction SilentlyContinue |
                Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        }
        if ($proc) { $hwnd = $proc.MainWindowHandle }
    }
    elseif ($item.type -eq 'window') {
        # item.value = actual window title stored at scan time; item.title = user display label
        # Try exact match on value first
        $proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $item.value -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        # Then try exact match on title (user label, in case it was edited to match)
        if (-not $proc -and $item.title -ne $item.value) {
            $proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $item.title -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        }
        # Fuzzy fallback: any window whose title contains the stored value
        if (-not $proc) {
            $searchVal = $item.value
            $proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$searchVal*" } | Select-Object -First 1
        }
        if ($proc) { $hwnd = $proc.MainWindowHandle }
    }
    elseif ($item.type -eq 'folder') {
        $targetPath = $item.value.TrimEnd('\')
        $comShell = New-Object -ComObject Shell.Application
        foreach ($w in $comShell.Windows()) {
            try {
                if ($w.Document -ne $null -and $w.Document.Folder.Self.Path.TrimEnd('\') -eq $targetPath) {
                    $hwnd = [IntPtr][long]$w.HWND; break
                }
            } catch {}
        }
        if (-not $hwnd) {
            $folderLeaf = Split-Path $targetPath -Leaf
            $proc = Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq $folderLeaf } | Select-Object -First 1
            if ($proc) { $hwnd = $proc.MainWindowHandle }
        }
    }
    elseif ($item.type -eq 'url' -or $item.type -eq 'browser') {
        # After tab detach, find the newly created browser window by matching tab title or item title
        $searchTitle = if ($item.tabTitle -ne '') { $item.tabTitle } else { $item.title }
        $browsers = @('chrome','msedge','firefox','opera','brave','vivaldi')
        $proc = Get-Process -Name $browsers -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } |
            Where-Object { $_.MainWindowTitle -like "*$searchTitle*" } |
            Select-Object -First 1
        if (-not $proc) {
            # Fallback: pick any browser window that is not the main multi-tab window
            $proc = Get-Process -Name $browsers -ErrorAction SilentlyContinue |
                Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } |
                Sort-Object -Property StartTime -Descending |
                Select-Object -First 1
        }
        if ($proc) { $hwnd = $proc.MainWindowHandle }
    }

    if ($hwnd -ne $null) {
        $hwndInt = [long]$hwnd
        Write-Output "[$i] FOUND type=$($item.type) value='$($item.value)' hwnd=$hwndInt proc=$($proc.ProcessName)"
        if ($hwndInt -gt 0 -and -not $usedHwndInts.Contains($hwndInt)) {
            $usedHwndInts.Add($hwndInt)
            # Column x position with border compensation
            $colW = if ($i -eq $count - 1) { $screen.Width - ($colWidthBase * ($count - 1)) } else { $colWidthBase }
            $x = $screen.X + ($i * $colWidthBase) - $border
            $y = $screen.Y - $border
            $w = $colW + ($border * 2)
            $h = $screen.Height + ($border * 2)
            Write-Output "[$i] MOVE x=$x y=$y w=$w h=$h"

            [TileWin32]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE: clears WS_MAXIMIZE flag
            Start-Sleep -Milliseconds 150
            [TileWin32]::MoveWindow($hwnd, $x, $y, $w, $h, $true) | Out-Null
            [TileWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, $w, $h, 0x0064) | Out-Null
            [TileWin32]::SetForegroundWindow($hwnd) | Out-Null
        } else {
            Write-Output "[$i] SKIPPED (dup hwnd=$hwndInt)"
        }
    } else {
        Write-Output "[$i] NOT_FOUND type=$($item.type) value='$($item.value)' title='$($item.title)'"
    }
}
Write-Output "SCREEN: origin=$($screen.X),$($screen.Y) size=$($screen.Width)x$($screen.Height) colBase=$colWidthBase"`;
        const tmpTilePs = path.join(os.tmpdir(), `ql_tilewin_${Date.now()}.ps1`);
        fs.writeFileSync(tmpTilePs, '\ufeff' + psCode, 'utf8');
        exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpTilePs}"`, {
          shell: false,
          maxBuffer: 1024 * 1024 * 2,
        }, (err, stdout, stderr) => {
          fs.unlink(tmpTilePs, () => {});
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

    const psCode = `
$items = $env:QL_ITEMS | ConvertFrom-Json
$out = @()
foreach ($item in $items) {
  $alive = $false
  if ($item.type -eq 'window') {
    $p = Get-Process | Where-Object { ($_.MainWindowTitle -eq $item.value -or $_.MainWindowTitle -eq $item.title) -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $p) {
      $searchVal = $item.value
      $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$searchVal*" } | Select-Object -First 1
    }
    $alive = $p -ne $null
  } elseif ($item.type -eq 'app') {
    $exeName = [System.IO.Path]::GetFileNameWithoutExtension($item.value)
    $p = Get-Process -Name $exeName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $p) {
      $p = Get-Process | Where-Object { try { $_.MainModule.FileName -eq $item.value } catch { $false } } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    }
    $alive = $p -ne $null
  } elseif ($item.type -eq 'folder') {
    $comShell = New-Object -ComObject Shell.Application
    foreach ($w in $comShell.Windows()) {
      try { if ($w.Document.Folder.Self.Path -eq $item.value) { $alive = $true; break } } catch {}
    }
  }
  $out += [PSCustomObject]@{ idx = $item.idx; alive = $alive }
}
$out | ConvertTo-Json -Compress`;

    return new Promise((resolve) => {
      const b64 = Buffer.from(psCode.trim(), 'utf16le').toString('base64');
      exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, {
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
    // ── Resolve target monitor work area via Electron (reliable ordering) ──
    // Electron workArea = 96-DPI per-monitor logical px.
    // DPI-unaware Win32 (no SetProcessDPIAware) uses the same coordinate space.
    // Do NOT multiply by scaleFactor — use workArea values directly.
    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    let targetWA;
    {
      const disp = (monitor >= 1 && monitor <= displays.length)
        ? displays[monitor - 1]
        : screen.getPrimaryDisplay();
      const wa = disp.workArea;
      targetWA = {
        x:      Math.round(wa.x),
        y:      Math.round(wa.y),
        width:  Math.round(wa.width),
        height: Math.round(wa.height),
      };
    }
    const count = identifiers.length;
    const colWidthBase = Math.floor(targetWA.width / count);
    const wa = targetWA; // alias for browser resize logic below

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
              const colW = i === count - 1 ? wa.width - colWidthBase * (count - 1) : colWidthBase;
              sseConnection.write(`data: ${JSON.stringify({
                action: 'resize', windowId: tab.windowId, tabId: tab.id,
                left: wa.x + i * colWidthBase, top: wa.y, width: colW, height: wa.height,
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
        const itemsJson = JSON.stringify(flagged)
          .replace(/[^\x00-\x7F]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
          .replace(/'/g, "''");
        const monitorIndex = typeof monitor === 'number' ? monitor : 0;
        // Pass Electron-resolved work area directly to PS (avoids AllScreens ordering issues)
        const psScreenX = targetWA.x;
        const psScreenY = targetWA.y;
        const psScreenW = targetWA.width;
        const psScreenH = targetWA.height;
        const psCode = `try {
    if (-not ([System.Management.Automation.PSTypeName]'TileWin32b').Type) {
        Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class TileWin32b {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int X, int Y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public static void SnapLeft(IntPtr hWnd) {
        ShowWindow(hWnd, 9); SetForegroundWindow(hWnd); Thread.Sleep(350);
        keybd_event(0x5B,0,0,UIntPtr.Zero); keybd_event(0x25,0,0,UIntPtr.Zero);
        keybd_event(0x25,0,2,UIntPtr.Zero); keybd_event(0x5B,0,2,UIntPtr.Zero);
        Thread.Sleep(500);
    }
    public static void SnapRight(IntPtr hWnd) {
        ShowWindow(hWnd, 9); SetForegroundWindow(hWnd); Thread.Sleep(350);
        keybd_event(0x5B,0,0,UIntPtr.Zero); keybd_event(0x27,0,0,UIntPtr.Zero);
        keybd_event(0x27,0,2,UIntPtr.Zero); keybd_event(0x5B,0,2,UIntPtr.Zero);
        Thread.Sleep(500);
    }
}
"@
    }
} catch { exit 1 }
# NO SetProcessDPIAware: keep DPI-unaware so Win32 coords = Electron workArea (96-DPI logical)
# Work area passed directly from Electron (correct monitor, correct coordinate space)
$screenWidth = ${psScreenW}; $screenHeight = ${psScreenH}; $screenX = ${psScreenX}; $screenY = ${psScreenY}
$targetMonitorIdx = ${monitorIndex}
# For Auto mode: Update-AutoMonitor will override these after first window found
try { Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop } catch {}
$items = '${itemsJson}' | ConvertFrom-Json
$count = @($items).Count
if ($count -lt 1) { exit }
$border = 8
$autoMonitorSet = $false
function Get-ColLayout($idx) {
    $colBase = [math]::Floor($screenWidth / $count)
    $colW = if ($idx -eq $count - 1) { $screenWidth - ($colBase * ($count - 1)) } else { $colBase }
    $x = $screenX + ($idx * $colBase) - $border
    $y = $screenY - $border
    $w = $colW + ($border * 2)
    $h = $screenHeight + ($border * 2)
    return @{ x=$x; y=$y; w=$w; h=$h }
}
function Tile-Hwnd($hwnd, $idx) {
    $hwndInt = [long]$hwnd
    if ($hwndInt -le 0) { return }
    $c = Get-ColLayout $idx
    # SW_RESTORE(9): removes WS_MAXIMIZE flag so MoveWindow can resize freely
    [TileWin32b]::ShowWindow($hwnd, 9) | Out-Null
    Start-Sleep -Milliseconds 200
    [TileWin32b]::MoveWindow($hwnd, $c.x, $c.y, $c.w, $c.h, $true) | Out-Null
    Start-Sleep -Milliseconds 50
    # 0x0064 = SWP_NOZORDER|SWP_NOACTIVATE|SWP_FRAMECHANGED — forces style recalc
    [TileWin32b]::SetWindowPos($hwnd, [IntPtr]::Zero, $c.x, $c.y, $c.w, $c.h, 0x0064) | Out-Null
    [TileWin32b]::SetForegroundWindow($hwnd) | Out-Null
}
function Update-AutoMonitor($hwnd) {
    if ($script:autoMonitorSet) { return }
    $rect = New-Object TileWin32b+RECT
    [TileWin32b]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    $cx = [int](($rect.Left + $rect.Right) / 2)
    $cy = [int](($rect.Top + $rect.Bottom) / 2)
    foreach ($scr in [System.Windows.Forms.Screen]::AllScreens) {
        $b = $scr.WorkingArea
        if ($cx -ge $b.X -and $cx -lt ($b.X + $b.Width) -and $cy -ge $b.Y -and $cy -lt ($b.Y + $b.Height)) {
            $script:screenX = $b.X; $script:screenY = $b.Y
            $script:screenWidth = $b.Width; $script:screenHeight = $b.Height
            break
        }
    }
    $script:autoMonitorSet = $true
}
function Find-Hwnd($item) {
    if ($item.type -eq 'app') {
        $proc = Get-Process | Where-Object { try { $_.MainModule.FileName -eq $item.value } catch { $false } } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if (-not $proc) {
            $exeName = [System.IO.Path]::GetFileNameWithoutExtension($item.value)
            $proc = Get-Process -Name $exeName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        }
        if ($proc) { return $proc.MainWindowHandle }
    } elseif ($item.type -eq 'window') {
        $proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $item.value -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if (-not $proc -and $item.title -ne $item.value) {
            $proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $item.title -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        }
        if (-not $proc) {
            $sv = $item.value
            $proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$sv*" } | Select-Object -First 1
        }
        if ($proc) { return $proc.MainWindowHandle }
    } elseif ($item.type -eq 'folder') {
        $tp = $item.value.TrimEnd('\')
        $cs = New-Object -ComObject Shell.Application
        foreach ($w in $cs.Windows()) {
            try { if ($w.Document -ne $null -and $w.Document.Folder.Self.Path.TrimEnd('\') -eq $tp) { return [IntPtr][long]$w.HWND } } catch {}
        }
        $leaf = Split-Path $tp -Leaf
        $proc = Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$leaf*" } | Select-Object -First 1
        if ($proc) { return $proc.MainWindowHandle }
    } elseif ($item.type -eq 'url' -or $item.type -eq 'browser') {
        $st = if ($item.tabTitle -ne '') { $item.tabTitle } else { $item.title }
        $br = @('chrome','msedge','firefox','opera','brave','vivaldi')
        $proc = Get-Process -Name $br -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$st*" } | Select-Object -First 1
        if ($proc) { return $proc.MainWindowHandle }
    }
    return $null
}
$hwnds = @{}
$tiledSet = [System.Collections.Generic.HashSet[long]]::new()
# Pre-mark browser items — handled by Chrome Extension SSE, not PS
for ($j = 0; $j -lt $count; $j++) {
    if (@($items)[$j].isBrowser -eq $true) { $hwnds[$j] = [IntPtr]0; $tiledSet.Add(0) | Out-Null }
}
# ── Phase 1: Discover windows + tile each one immediately (up to 30s) ─
$deadline = (Get-Date).AddSeconds(30)
do {
    for ($i = 0; $i -lt $count; $i++) {
        if (-not $hwnds.ContainsKey($i)) {
            $curItem = @($items)[$i]
            $h = Find-Hwnd $curItem
            if ($null -ne $h) {
                try { $hwnds[$i] = [IntPtr]([long](@($h)[-1])) } catch {}
            }
        }
        if ($hwnds.ContainsKey($i)) {
            $hwndInt = [long]$hwnds[$i]
            if ($hwndInt -gt 0 -and -not $tiledSet.Contains($hwndInt)) {
                # Auto-monitor: detect from first real window found
                if ($targetMonitorIdx -eq 0) { Update-AutoMonitor $hwnds[$i] }
                # Brief wait for app to finish its own initialization/maximize animation
                Start-Sleep -Milliseconds 400
                Tile-Hwnd $hwnds[$i] $i
                $tiledSet.Add($hwndInt) | Out-Null
            }
        }
    }
    $allFound = $true
    for ($i = 0; $i -lt $count; $i++) { if (-not $hwnds.ContainsKey($i)) { $allFound = $false; break } }
    if ($allFound) { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
# ── Phase 2: Multi-pass settle — re-tile all found windows to lock positions ─
# Pass 1 at 1.2s, Pass 2 at 2.0s, Pass 3 at 3.0s
$settlePasses = @(1200, 800, 1000)
foreach ($delayMs in $settlePasses) {
    Start-Sleep -Milliseconds $delayMs
    for ($i = 0; $i -lt $count; $i++) {
        if ($hwnds.ContainsKey($i) -and [long]$hwnds[$i] -gt 0) {
            Tile-Hwnd $hwnds[$i] $i
            Start-Sleep -Milliseconds 80
        }
    }
}
` ;
        const tmpPs = path.join(os.tmpdir(), `ql_tile_${Date.now()}.ps1`);
        fs.writeFileSync(tmpPs, '\ufeff' + psCode, 'utf8');
        exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`, {
          shell: false,
          maxBuffer: 1024 * 1024 * 2,
        }, (err, stdout, stderr) => {
          fs.unlink(tmpPs, () => {});
          if (stderr) console.error('run-tile-ps stderr:', stderr);
          resolve({ success: !err, error: err?.message || '' });
        });
      }
    });

    // Both browser resize AND PS must finish before we say "완료"
    const [, psResult] = await Promise.all([browserPromise, psPromise]);
    return psResult;
  });

  // ── Maximize a specific window by title/path (DPI-aware, fills work area) ──
  ipcMain.handle('maximize-window', async (event, { item, monitor = 0 }) => {
    // Compute target rectangle from Electron display info.
    // Electron workArea is in 96-DPI logical px. For DPI-unaware Win32, this matches.
    // But we also pass scaleFactor so the PS script can use SetProcessDPIAware()
    // and compute the real physical-pixel rect (robust across mixed-DPI setups).
    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    const disp = (monitor >= 1 && monitor <= displays.length)
      ? displays[monitor - 1]
      : screen.getPrimaryDisplay();
    const wa = disp.workArea;
    const sf = disp.scaleFactor || 1;

    // Physical-pixel coordinates (for DPI-aware mode)
    const border = 8; // invisible shadow border on Win10/11
    const psX  = Math.round(wa.x * sf) - border;
    const psY  = Math.round(wa.y * sf) - border;
    const psW  = Math.round(wa.width  * sf) + border * 2;
    const psH  = Math.round(wa.height * sf) + border * 2;

    const itemJson = JSON.stringify(item)
      .replace(/[^\x00-\x7F]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
      .replace(/'/g, "''");

    const psCode = `try {
    if (-not ([System.Management.Automation.PSTypeName]'MaxWin32').Type) {
        Add-Type @"
using System; using System.Runtime.InteropServices;
public class MaxWin32 {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int X, int Y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
    }
} catch { Write-Output "FAIL"; exit 1 }
# Become DPI-aware so MoveWindow/SetWindowPos use real physical pixels
[MaxWin32]::SetProcessDPIAware() | Out-Null
$item = '${itemJson}' | ConvertFrom-Json
$hwnd = $null
if ($item.type -eq 'app') {
    $proc = Get-Process | Where-Object { try { $_.MainModule.FileName -eq $item.value } catch { $false } } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $proc) { $proc = Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($item.value)) -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
    if ($proc) { $hwnd = $proc.MainWindowHandle }
}
elseif ($item.type -eq 'window') {
    $proc = Get-Process | Where-Object { ($_.MainWindowTitle -eq $item.value -or $_.MainWindowTitle -eq $item.title) -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($proc) { $hwnd = $proc.MainWindowHandle }
}
elseif ($item.type -eq 'folder') {
    $tp = $item.value.TrimEnd('\\')
    $cs = New-Object -ComObject Shell.Application
    foreach ($w in $cs.Windows()) { try { if ($w.Document -ne $null -and $w.Document.Folder.Self.Path.TrimEnd('\\') -eq $tp) { $hwnd = [IntPtr][long]$w.HWND; break } } catch {} }
    if (-not $hwnd) { $proc = Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$(Split-Path $tp -Leaf)*" } | Select-Object -First 1; if ($proc) { $hwnd = $proc.MainWindowHandle } }
}
elseif ($item.type -eq 'url' -or $item.type -eq 'browser') {
    $st = if ($item.tabTitle -ne '') { $item.tabTitle } else { $item.title }
    $proc = Get-Process -Name @('chrome','msedge','firefox','opera','brave','vivaldi') -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$st*" } | Select-Object -First 1
    if ($proc) { $hwnd = $proc.MainWindowHandle }
}
if ($hwnd -and [long]$hwnd -gt 0) {
    # Restore from minimized/maximized state first
    [MaxWin32]::ShowWindow($hwnd, 9) | Out-Null
    Start-Sleep -Milliseconds 150
    # Move + resize to fill target monitor work area (physical pixels, DPI-aware)
    [MaxWin32]::MoveWindow($hwnd, ${psX}, ${psY}, ${psW}, ${psH}, $true) | Out-Null
    Start-Sleep -Milliseconds 50
    # Reinforce with SetWindowPos (SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOZORDER)
    [MaxWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, ${psX}, ${psY}, ${psW}, ${psH}, 0x0064) | Out-Null
    [MaxWin32]::SetForegroundWindow($hwnd) | Out-Null
    Write-Output "OK"
} else {
    Write-Output "NOTFOUND"
}`;
    const tmpPs = path.join(os.tmpdir(), `ql_max_${Date.now()}.ps1`);
    fs.writeFileSync(tmpPs, '\ufeff' + psCode, 'utf8');
    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`, { shell: false }, (err, stdout) => {
        fs.unlink(tmpPs, () => {});
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
    // Use workArea values directly — no scaleFactor multiplication.
    const { screen: _snapScr } = require('electron');
    const _snapDisp = _snapScr.getPrimaryDisplay();
    const _snapWa = _snapDisp.workArea;
    const snapX = Math.round(_snapWa.x);
    const snapY = Math.round(_snapWa.y);
    const snapW = Math.round(_snapWa.width);
    const snapH = Math.round(_snapWa.height);

    const psCode = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SnapWin32 {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int X, int Y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
# NO SetProcessDPIAware: keep DPI-unaware so Win32 coords = Electron workArea (96-DPI logical)
$screen = [PSCustomObject]@{ X=${snapX}; Y=${snapY}; Width=${snapW}; Height=${snapH} }
$item = $env:QL_ITEM | ConvertFrom-Json
$zone = $env:QL_ZONE
$hwnd = $null

if ($item.type -eq 'app') {
    $proc = Get-Process | Where-Object { try { $_.MainModule.FileName -eq $item.value } catch { $false } } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $proc) {
        $exeName = [System.IO.Path]::GetFileNameWithoutExtension($item.value)
        $proc = Get-Process -Name $exeName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    }
    if ($proc) { $hwnd = $proc.MainWindowHandle }
} elseif ($item.type -eq 'window') {
    $proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $item.value -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $proc) {
        $searchVal = $item.value
        $proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$searchVal*" } | Select-Object -First 1
    }
    if ($proc) { $hwnd = $proc.MainWindowHandle }
} elseif ($item.type -eq 'folder') {
    $targetPath = $item.value.TrimEnd('\')
    $comShell = New-Object -ComObject Shell.Application
    foreach ($w in $comShell.Windows()) {
        try {
            if ($w.Document -ne $null -and $w.Document.Folder.Self.Path.TrimEnd('\') -eq $targetPath) {
                $hwnd = [IntPtr][long]$w.HWND; break
            }
        } catch {}
    }
    if (-not $hwnd) {
        $folderLeaf = Split-Path $targetPath -Leaf
        $proc = Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq $folderLeaf } | Select-Object -First 1
        if ($proc) { $hwnd = $proc.MainWindowHandle }
    }
} elseif ($item.type -eq 'url' -or $item.type -eq 'browser') {
    $browsers = @('chrome','msedge','firefox','opera','brave','vivaldi')
    $proc = Get-Process -Name $browsers -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } | Sort-Object StartTime -Descending | Select-Object -First 1
    if ($proc) { $hwnd = $proc.MainWindowHandle }
}

if ($hwnd -and [long]$hwnd -gt 0) {
    $border = 8
    $x = 0; $y = 0; $w = 0; $h = 0
    if ($zone -eq 'left') {
        $x = $screen.X - $border
        $y = $screen.Y - $border
        $w = [math]::Floor($screen.Width / 2) + $border * 2
        $h = $screen.Height + $border * 2
    } elseif ($zone -eq 'right') {
        $x = $screen.X + [math]::Floor($screen.Width / 2) - $border
        $y = $screen.Y - $border
        $w = $screen.Width - [math]::Floor($screen.Width / 2) + $border * 2
        $h = $screen.Height + $border * 2
    } elseif ($zone -eq 'top') {
        $x = $screen.X - $border
        $y = $screen.Y - $border
        $w = $screen.Width + $border * 2
        $h = [math]::Floor($screen.Height / 2) + $border * 2
    }
    [SnapWin32]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE: clears WS_MAXIMIZE
    Start-Sleep -Milliseconds 150
    [SnapWin32]::MoveWindow($hwnd, $x, $y, $w, $h, $true) | Out-Null
    [SnapWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, $w, $h, 0x0064) | Out-Null
    [SnapWin32]::SetForegroundWindow($hwnd) | Out-Null
}`;
    const tmpPs = path.join(os.tmpdir(), `ql_snap_${Date.now()}.ps1`);
    fs.writeFileSync(tmpPs, '\ufeff' + psCode, 'utf8');
    return new Promise((resolve) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`, { shell: false }, (err) => {
        fs.unlink(tmpPs, () => {});
        resolve({ success: !err });
      });
    });
  });

  // Kick Feature: Check foreground window for File Dialog
  ipcMain.handle('detect-dialog', async () => {
    return new Promise((resolve) => {
      const psCode = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
"@
$hWnd = [Win32]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 256
$class = New-Object System.Text.StringBuilder 256
[Win32]::GetWindowText($hWnd, $title, 256) | Out-Null
[Win32]::GetClassName($hWnd, $class, 256) | Out-Null
$res = @{ title = $title.ToString(); className = $class.ToString(); isDialog = ($class.ToString() -eq "#32770") }
$res | ConvertTo-Json -Compress`;
      const b64 = Buffer.from(psCode, 'utf16le').toString('base64');
      exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, (err, stdout) => {
        try { resolve(JSON.parse(stdout.trim())); } catch(e) { resolve({ isDialog: false }); }
      });
    });
  });

  // Kick Feature: Jump to folder in active dialog
  ipcMain.on('jump-to-dialog-folder', (event, folderPath) => {
    const psCode = `
$obj = New-Object -ComObject WScript.Shell
# Small delay to ensure Quick Launcher is not stealing focus anymore
Start-Sleep -m 100
$obj.SendKeys("^l") # Ctrl+L for address bar
Start-Sleep -m 100
$obj.SendKeys($env:QL_PATH)
Start-Sleep -m 100
$obj.SendKeys("{ENTER}")
`;
    const b64 = Buffer.from(psCode, 'utf16le').toString('base64');
    exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, { env: { ...process.env, QL_PATH: folderPath } });
  });
}

app.whenReady().then(() => {
  // Show splash immediately so there's visual feedback during cold-start
  createLoadingWindow();

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

  // ── Auto-updater setup ─────────────────────────────────────
  if (app.isPackaged) {
    autoUpdater.logger = null; // suppress verbose logging
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

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
    { label: '업데이트 확인', click: () => {
        if (!app.isPackaged) {
          dialog.showMessageBox({ type: 'info', title: '업데이트', message: '개발 모드에서는 업데이트를 확인할 수 없습니다.' });
          return;
        }
        autoUpdater.checkForUpdates().catch(() => {});
        dialog.showMessageBox({ type: 'info', title: '업데이트 확인', message: '업데이트를 확인 중입니다...' });
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
});
