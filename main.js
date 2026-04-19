// ╔══════════════════════════════════════════════════════════════════╗
// ║  nost — Electron Main Process                                    ║
// ║  D:\01_개인\06. launcher\main.js                                 ║
// ╚══════════════════════════════════════════════════════════════════╝

'use strict';

// ── 1. Requires & Store ──────────────────────────────────────────────
const {
  app, BrowserWindow, globalShortcut, ipcMain, shell, clipboard,
  Tray, Menu, nativeImage, dialog, session,
} = require('electron');
const path            = require('node:path');
const { exec, spawn } = require('child_process');
const fs              = require('fs');
const http            = require('http');
const Store           = require('electron-store');
const { autoUpdater } = require('electron-updater');
const log             = require('electron-log/main');

// ── electron-log setup ──────────────────────────────────────────────
// File:    %APPDATA%\nost\logs\main.log (and renderer.log for renderer)
// Rotation: ~5 MB per file, keeps last 3
log.initialize();
log.transports.file.level   = 'debug';
log.transports.console.level = 'debug';
log.transports.file.maxSize  = 5 * 1024 * 1024;
log.transports.file.format   = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

const store = new Store({ name: 'nost-data' });

// ── 2. Module-level globals ──────────────────────────────────────────
let mainWindow;
let loadingWindow    = null;
let tray             = null;
let currentShortcut  = 'Alt+4';

// Debounce guard — prevents rapid Alt+4 keypresses from racing show/hide.
// Without this the transparent window's GPU backing store can be lost,
// leaving a blank frame with only the OS window outline visible.
let _toggleLocked = false;

// ── 3. PS Script Resolver ────────────────────────────────────────────

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

/** Resolve full path to a named PS script file. */
function ps(name) { return path.join(PS_DIR, name); }

// ── 4. Utility Helpers ───────────────────────────────────────────────

/**
 * Lazy-load the Electron screen module.
 * screen is not available until after app.ready, so we load it on demand.
 */
function getScreen() { return require('electron').screen; }

/**
 * Resolve the work area of a given monitor index (1-based).
 * Falls back to the primary display when the index is out of range.
 * Returns { wa, disp } in Electron DIP (logical pixel) coordinates.
 */
function getMonitorWorkArea(monitorIndex) {
  const screen   = getScreen();
  const displays = screen.getAllDisplays();
  const disp = (monitorIndex >= 1 && monitorIndex <= displays.length)
    ? displays[monitorIndex - 1]
    : screen.getPrimaryDisplay();
  return { wa: disp.workArea, disp };
}

/**
 * Safely send an IPC message to the renderer.
 * No-ops silently if mainWindow has been destroyed.
 */
function sendSafe(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/**
 * Run a PS script file and return a Promise resolving to { stdout, stderr }.
 * opts: { timeout, maxBuffer, encoding }
 */
function runPsAsync(scriptName, envVars = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps(scriptName)}"`,
      {
        shell:     false,
        maxBuffer: opts.maxBuffer ?? 1024 * 1024 * 2,
        timeout:   opts.timeout   ?? 30000,
        encoding:  opts.encoding,
        env:       { ...process.env, ...envVars },
      },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      }
    );
  });
}

/**
 * Read a file path from the Windows Explorer clipboard (file-drop) via PS.
 * Returns an empty string when nothing is available or on error.
 */
async function readClipboardFileDrop() {
  try {
    const script = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $f=[System.Windows.Forms.Clipboard]::GetFileDropList(); if($f.Count -gt 0){$f[0]}';
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    return await new Promise((resolve) => {
      exec(
        `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${b64}`,
        { timeout: 3000, encoding: 'buffer' },
        (err, stdout) => resolve(stdout ? Buffer.from(stdout).toString('utf8').trim() : '')
      );
    });
  } catch {
    return '';
  }
}

// ── 5. Constants & Daily Tips ────────────────────────────────────────

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
  // 슬래시 명령어
  '/75 를 입력하면 런처 창이 화면의 75%로 보기 좋게 조정돼요 (/50, /100도 가능)',
  '/tile 1-1 2-1 로 두 카드를 분할화면으로 바로 실행할 수 있어요',
  '//1 을 입력하면 첫 번째 노드 그룹이 바로 실행돼요',
  '/1-3 을 입력하면 1번 스페이스의 3번 카드가 바로 실행돼요',
  '/clipboard 으로 클립보드 내용을 카드로 바로 저장할 수 있어요',
  // 숨겨진 기능
  '컨테이너 카드에 앱을 배치하면 실행 시 자동으로 스냅 배치돼요',
  '설정 → 모니터에서 방향키를 지정하면 카드에서 빠르게 모니터 이동할 수 있어요',
  '검색창에 텍스트만 입력하면 모든 카드를 실시간 필터링해요',
  '사용 빈도순 정렬로 자주 쓰는 앱을 맨 앞에 둘 수 있어요',
  '스페이스를 접어두면 자주 쓰는 것만 보여 깔끔해져요',
];

function getRandomTip() {
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}

// ── 6. Chrome Extension Bridge ───────────────────────────────────────

global.chromeTabs            = [];
let sseConnection            = null;
let lastTabsUpdateAt         = 0;
let lastExtensionConnectedAt = 0;

const EXT_PORT = 14502;

const extServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();

  if (req.url === '/tabs' && req.method === 'POST') {
    // Extension pushes its full tab list here on every tab change
    let body = '';
    req.on('data', chunk => (body += chunk.toString()));
    req.on('end', () => {
      try { global.chromeTabs = JSON.parse(body); lastTabsUpdateAt = Date.now(); }
      catch { /* ignore malformed JSON */ }
      res.end('ok');
    });
  } else if (req.url === '/events') {
    // Extension opens a long-lived SSE channel to receive commands
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':   'keep-alive',
    });
    sseConnection = res;
    lastExtensionConnectedAt = Date.now();
    req.on('close', () => { if (sseConnection === res) sseConnection = null; });
  } else {
    res.writeHead(404); res.end();
  }
});

/**
 * Send a command to the connected browser extension over SSE.
 * Returns true if the connection was open; false otherwise.
 */
function sendSse(data) {
  if (!sseConnection) return false;
  sseConnection.write(`data: ${JSON.stringify(data)}\n\n`);
  return true;
}

/**
 * Find the first Chrome/Whale tab whose hostname matches urlStr.
 * Both sides strip the 'www.' prefix before comparing.
 * Returns the tab object or null.
 */
function findChromeTabByHost(urlStr) {
  if (!global.chromeTabs?.length) return null;
  try {
    const host = new URL(urlStr).hostname.replace('www.', '');
    return global.chromeTabs.find(t => {
      try { return new URL(t.url).hostname.replace('www.', '') === host; }
      catch { return false; }
    }) ?? null;
  } catch {
    return null;
  }
}

/** Start the extension bridge, recovering gracefully from port conflicts. */
function startExtServer() {
  extServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[ExtServer] Port ${EXT_PORT} busy — killing previous owner and retrying…`);
      exec(
        `powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort ${EXT_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        () => setTimeout(() => extServer.listen(EXT_PORT, '127.0.0.1'), 500)
      );
    } else {
      console.error('[ExtServer]', err.message);
    }
  });
  extServer.listen(EXT_PORT, '127.0.0.1');
}

function resolveExtensionDir() {
  const candidates = [
    path.join(app.getAppPath(),            'chrome-extension'),
    path.join(__dirname,                   'chrome-extension'),
    path.join(process.resourcesPath || '', 'chrome-extension'),
    path.join(process.cwd(),               'chrome-extension'),
  ];
  return candidates.find(c => fs.existsSync(path.join(c, 'manifest.json'))) ?? null;
}

function resolveBrowserExe(target) {
  const local = process.env.LOCALAPPDATA        || '';
  const pf    = process.env.ProgramFiles         || '';
  const pf86  = process.env['ProgramFiles(x86)'] || '';

  const map = {
    chrome: [
      path.join(local, 'Google',      'Chrome',      'Application', 'chrome.exe'),
      path.join(pf,    'Google',      'Chrome',      'Application', 'chrome.exe'),
      path.join(pf86,  'Google',      'Chrome',      'Application', 'chrome.exe'),
    ],
    whale: [
      path.join(local, 'Naver', 'Naver Whale', 'Application', 'whale.exe'),
      path.join(pf,    'Naver', 'Naver Whale', 'Application', 'whale.exe'),
      path.join(pf86,  'Naver', 'Naver Whale', 'Application', 'whale.exe'),
    ],
  };
  return (map[target] || []).find(p => p && fs.existsSync(p)) ?? null;
}

function launchBrowserExtensionsPage(target) {
  const exePath = resolveBrowserExe(target);
  if (!exePath) return { ok: false, reason: 'browser-not-found' };

  // Chrome accepts internal URLs via CLI; Whale does not — just open the browser
  const args = target === 'chrome' ? ['chrome://extensions/'] : [];
  try {
    const child = spawn(exePath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, exePath };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

// ── 7. Single Instance Lock ───────────────────────────────────────────
// If user opens the app again while it's already running (hidden),
// bring the existing window to front instead of spawning a second instance.

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ── 8. Splash Window ─────────────────────────────────────────────────

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 300, height: 210,
    show: true, frame: false, transparent: true,
    resizable: false, alwaysOnTop: true, skipTaskbar: true, center: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const html = encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:transparent}
body{background:rgba(255,255,255,0.72);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(255,255,255,0.9);box-shadow:0 8px 32px rgba(0,0,0,0.12),0 2px 8px rgba(0,0,0,0.08),inset 0 1px 0 #fff;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;user-select:none;-webkit-app-region:no-drag}
.logo{font-size:34px;font-weight:800;letter-spacing:-2px;background:linear-gradient(135deg,#6366f1 0%,#818cf8 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.sub{font-size:11px;color:rgba(80,80,120,0.55);margin-top:5px;letter-spacing:0.5px;font-weight:500}
.ring{margin-top:18px;width:22px;height:22px;border:2.5px solid rgba(99,102,241,0.18);border-top-color:#6366f1;border-radius:50%;animation:spin 0.75s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.tip{margin-top:20px;padding:8px 14px;background:rgba(99,102,241,0.07);border:1px solid rgba(99,102,241,0.15);border-radius:8px;font-size:10px;color:rgba(80,80,120,0.65);line-height:1.5;text-align:center;max-width:240px;animation:fadeIn 0.6s ease 0.3s both}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.tip-label{font-size:9px;color:rgba(99,102,241,0.6);font-weight:600;letter-spacing:0.5px;margin-bottom:3px}
</style></head>
<body>
  <div class="logo">nost</div>
  <div class="sub" id="ql-status">시작하는 중...</div>
  <div class="ring"></div>
  <div class="tip"><div class="tip-label">💡 팁</div>${getRandomTip()}</div>
</body></html>`);

  loadingWindow.loadURL(`data:text/html;charset=utf-8,${html}`);
}

// ── 9. Main Window ────────────────────────────────────────────────────

/**
 * Register (or re-register) the global toggle shortcut.
 * Includes a 150 ms debounce lock to prevent rapid-fire keypresses from
 * creating a show/hide race — which can leave a blank frame on screen.
 */
function registerShortcut(newShortcut) {
  if (currentShortcut) globalShortcut.unregister(currentShortcut);
  currentShortcut = newShortcut;

  const registered = globalShortcut.register(currentShortcut, () => {
    // Ignore presses within 150 ms of the previous toggle
    if (_toggleLocked) return;
    _toggleLocked = true;
    setTimeout(() => { _toggleLocked = false; }, 150);

    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
      // Force a GPU repaint after show — transparent windows can lose their
      // compositor backing store during rapid hide/show cycles.
      mainWindow.webContents.invalidate();
    }
  });

  if (!registered) console.warn(`[Shortcut] Failed to register "${newShortcut}"`);
}

/**
 * Check whether the center point of a bounds rect falls within any connected display.
 * Used to detect stale saved bounds (e.g. after a monitor is unplugged).
 */
function isBoundsOnScreen(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return getScreen().getAllDisplays().some(d =>
    cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width &&
    cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height
  );
}

/**
 * Compute centered bounds for a window that should occupy pct% of a display.
 * Matches the exact logic used by /75 (resize-active-window IPC) so the two
 * code paths always produce the same result.
 */
function centeredBounds(pct = 75) {
  const wa = getScreen().getPrimaryDisplay().workArea;
  const w  = Math.round(wa.width  * pct / 100);
  const h  = Math.round(wa.height * pct / 100);
  return {
    x: wa.x + Math.round((wa.width  - w) / 2),
    y: wa.y + Math.round((wa.height - h) / 2),
    width: w, height: h,
  };
}

function createWindow() {
  // Restore saved bounds when valid; otherwise center at 75% — same logic as /75
  const saved = store.get('windowBounds');
  const isValidSaved = saved
    && saved.width > 0 && saved.height > 0
    && saved.x != null && saved.y != null
    && isBoundsOnScreen(saved.x, saved.y, saved.width, saved.height);

  const { x: initX, y: initY, width: initW, height: initH } = isValidSaved
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : centeredBounds(75);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();

  mainWindow = new BrowserWindow({
    width: initW, height: initH,
    x: initX,    y: initY,
    minWidth: 400, minHeight: 400,
    show: false, frame: false, transparent: true,
    resizable: true, alwaysOnTop: true, skipTaskbar: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload:        path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      // Disable renderer throttling so timers and animations keep running
      // while the window is hidden, preventing stale state on next show.
      backgroundThrottling: false,
    },
  });

  const rdbg = (msg, extra) => {
    if (extra !== undefined) log.debug(`[main] ${msg}`, extra);
    else log.debug(`[main] ${msg}`);
  };

  rdbg(`BrowserWindow created. transparent=true frame=false size=${initW}x${initH}`);
  rdbg(`Load source: ${rendererUrl ? `URL ${rendererUrl}` : `File ${path.join(__dirname, 'frontend', 'dist', 'index.html')}`}`);

  const wc = mainWindow.webContents;
  wc.on('did-start-loading', () => rdbg('webContents: did-start-loading'));
  wc.on('did-stop-loading', () => rdbg('webContents: did-stop-loading'));
  wc.on('dom-ready', () => rdbg('webContents: dom-ready'));
  wc.on('did-finish-load', () => rdbg('webContents: did-finish-load'));
  wc.on('did-fail-load', (_e, code, desc, url) => rdbg(`webContents: did-fail-load code=${code} desc=${desc} url=${url}`));
  wc.on('render-process-gone', (_e, details) => rdbg('webContents: render-process-gone', details));
  wc.on('unresponsive', () => rdbg('webContents: unresponsive'));
  wc.on('responsive', () => rdbg('webContents: responsive'));
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    const msg = String(message);
    const loc = `(${sourceId}:${line})`;
    if (level >= 3)      log.error(`[renderer] ${msg} ${loc}`);
    else if (level >= 2) log.warn(`[renderer] ${msg} ${loc}`);
    else if (msg.includes('[nost]') || msg.includes('[RENDER-DEBUG]')) log.debug(`[renderer] ${msg} ${loc}`);
  });
  wc.on('preload-error', (_e, preloadPath, error) => {
    rdbg(`webContents: preload-error path=${preloadPath} err=${error && error.message}`);
  });
  mainWindow.on('ready-to-show', () => rdbg('window: ready-to-show'));
  mainWindow.on('show', () => rdbg('window: show'));
  mainWindow.on('hide', () => rdbg('window: hide'));

  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
  }

  // Show only after renderer signals it's fully loaded; 5 s safety fallback
  let windowShown = false;
  const showMainWindow = (reason) => {
    if (windowShown) { rdbg(`showMainWindow skipped (already shown) reason=${reason}`); return; }
    windowShown = true;
    rdbg(`showMainWindow firing. reason=${reason}`);
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close();
      loadingWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  };
  ipcMain.once('renderer-ready', () => { rdbg('IPC: renderer-ready received'); showMainWindow('renderer-ready'); });
  setTimeout(() => showMainWindow('5s-fallback'), 5000);

  // Accept renderer-side logs (explicit, typed level)
  ipcMain.on('nost-log', (_e, level, msg, extra) => {
    const fn = log[level] || log.info;
    if (extra !== undefined) fn(`[renderer] ${msg}`, extra);
    else fn(`[renderer] ${msg}`);
  });

  // Open the logs directory in file explorer (triggered from SettingsDialog)
  ipcMain.on('open-logs-folder', () => {
    const logFile = log.transports.file.getFile().path;
    shell.showItemInFolder(logFile);
  });

  // Relay loading-status messages from renderer to the splash window
  ipcMain.on('set-loading-status', (_, msg) => {
    if (!loadingWindow || loadingWindow.isDestroyed()) return;
    const safe = JSON.stringify(String(msg));
    loadingWindow.webContents
      .executeJavaScript(`var el=document.querySelector('#ql-status');if(el)el.textContent=${safe};`)
      .catch(() => {});
  });

  // Auto-hide on focus loss when the user has enabled it in settings
  mainWindow.on('blur', () => {
    const settings = store.get('appData')?.settings ?? {};
    if (settings.autoHide) mainWindow.hide();
  });

  // Debounced bounds save — avoids thrashing electron-store on every pixel drag
  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isMaximized()) {
        store.set('windowBounds', mainWindow.getBounds());
      }
    }, 500);
  };
  mainWindow.on('moved',   saveBounds);
  mainWindow.on('resized', saveBounds);

  // Register default shortcut; renderer may update it via 'update-shortcut' IPC
  registerShortcut(currentShortcut);

  registerIpcHandlers();
}

// ── 10. Tile Launch Helpers ───────────────────────────────────────────
//
// These PS snippets run as inline encoded commands (non-blocking / fire-and-forget)
// so tiling can begin immediately without waiting for a process to fully launch.
// Each runs in a separate PS process, so the class names (QL1/QL2/QL3) don't clash.

const _PS_FOCUS_APP = `
$t = $env:QL_PATH
$exeName = [System.IO.Path]::GetFileNameWithoutExtension($t)
$p = Get-Process | Where-Object { try { $_.MainModule.FileName -eq $t } catch { $false } } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { $p = Get-Process -Name $exeName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
if ($p) {
  $h = $p.MainWindowHandle
  Add-Type @"
using System; using System.Runtime.InteropServices;
public class QL1 { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
  [QL1]::ShowWindow($h,9); [QL1]::SetForegroundWindow($h)
} else { Start-Process $t }`.trim();

const _PS_FOCUS_FOLDER = `
$shell=$null; try{$shell=New-Object -ComObject Shell.Application}catch{}
$found=$false; $tp=$env:QL_PATH.TrimEnd('\\')
if($shell){foreach($w in $shell.Windows()){try{if($w.Document-ne$null-and$w.Document.Folder.Self.Path.TrimEnd('\\')-eq$tp){Add-Type @"
using System; using System.Runtime.InteropServices;
public class QL2 { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
$hw=[IntPtr][long]$w.HWND;[QL2]::ShowWindow($hw,9);[QL2]::SetForegroundWindow($hw);$found=$true;break}}catch{}}}
if(-not $found){Start-Process explorer.exe $env:QL_PATH}`.trim();

const _PS_FOCUS_WINDOW = `
$p = Get-Process | Where-Object { $_.MainWindowTitle -eq $env:QL_TITLE } | Select-Object -First 1
if (-not $p) {
  $s = $env:QL_TITLE
  $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$s*" } | Select-Object -First 1
}
if ($p) {
  Add-Type @"
using System; using System.Runtime.InteropServices;
public class QL3 { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
  [QL3]::ShowWindow($p.MainWindowHandle,9); [QL3]::SetForegroundWindow($p.MainWindowHandle)
}`.trim();

/**
 * Fire-and-forget: focus or launch an app/folder/window before tiling.
 * URL/browser types are handled separately by the caller.
 */
function fireLaunchItem(item) {
  let script;
  const env = { ...process.env };

  switch (item.type) {
    case 'app':    script = _PS_FOCUS_APP;    env.QL_PATH  = item.value; break;
    case 'folder': script = _PS_FOCUS_FOLDER; env.QL_PATH  = item.value; break;
    case 'window': script = _PS_FOCUS_WINDOW; env.QL_TITLE = item.value || item.title; break;
    default: return;
  }

  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  exec(`powershell.exe -NoProfile -EncodedCommand ${b64}`, { env });
}

// ── 11. Update Helper ─────────────────────────────────────────────────

/**
 * Trigger an update check and resolve to a result object.
 * Listeners are cleaned up regardless of outcome.
 * Returns immediately with { status: 'dev-mode' } in unpackaged builds.
 */
function checkForUpdateAsync() {
  if (!app.isPackaged) {
    return Promise.resolve({ status: 'dev-mode', version: app.getVersion() });
  }
  return new Promise((resolve) => {
    const cleanup = () => {
      autoUpdater.removeListener('update-not-available', onNone);
      autoUpdater.removeListener('update-available',     onAvail);
      autoUpdater.removeListener('error',                onErr);
    };
    const onNone  = ()     => { cleanup(); resolve({ status: 'up-to-date',       version: app.getVersion() }); };
    const onAvail = (info) => { cleanup(); resolve({ status: 'update-available', version: app.getVersion(), newVersion: info.version }); };
    const onErr   = (err)  => { cleanup(); resolve({ status: 'error', message: err.message, version: app.getVersion() }); };
    autoUpdater.once('update-not-available', onNone);
    autoUpdater.once('update-available',     onAvail);
    autoUpdater.once('error',                onErr);
    autoUpdater.checkForUpdates().catch(err => { cleanup(); resolve({ status: 'error', message: err.message }); });
  });
}

// ── 12. IPC Handlers ─────────────────────────────────────────────────
// Registered once inside createWindow() after mainWindow is created.
// Grouped by responsibility for easy navigation.

function registerIpcHandlers() {

  // ── 12a. App Lifecycle ────────────────────────────────────────────

  /** Hide the launcher window (e.g. after a card action). */
  ipcMain.on('hide-app', () => mainWindow.hide());

  /** Move the window to an absolute screen position (right-click drag). */
  ipcMain.on('window-move', (_, x, y) => mainWindow?.setPosition(x, y));

  ipcMain.handle('get-window-position', () => mainWindow?.getPosition() ?? [0, 0]);

  ipcMain.on('set-opacity', (_, opacity) => mainWindow?.setOpacity(opacity));

  /** Re-register the global shortcut with a new key combo from settings. */
  ipcMain.on('update-shortcut', (_, newShortcut) => registerShortcut(newShortcut));

  // ── 12b. Persistent Storage ──────────────────────────────────────

  ipcMain.handle('store-load', () => store.get('appData', null));

  ipcMain.handle('store-save', (_, data) => {
    store.set('appData', data);
    // Keep the Windows startup entry in sync with the autoLaunch toggle
    if (data?.settings) {
      app.setLoginItemSettings({ openAtLogin: !!data.settings.autoLaunch });
    }
    return true;
  });

  // ── 12c. File System & Dialogs ───────────────────────────────────

  ipcMain.handle('pick-folder', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '폴더 선택', properties: ['openDirectory'],
    });
    return (canceled || !filePaths[0]) ? null : filePaths[0];
  });

  ipcMain.handle('pick-exe', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '실행 파일 선택',
      filters: [{ name: '실행 파일', extensions: ['exe', 'bat', 'cmd', 'lnk'] }],
      properties: ['openFile'],
    });
    return (canceled || !filePaths[0]) ? null : filePaths[0];
  });

  ipcMain.handle('get-file-icon', async (_, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      const icon = await app.getFileIcon(filePath, { size: 'large' });
      return icon.toDataURL() || null;
    } catch { return null; }
  });

  ipcMain.handle('check-file-exists', (_, filePath) => {
    try { return fs.existsSync(filePath); } catch { return false; }
  });

  ipcMain.handle('export-data', async () => {
    const data = store.get('appData', null);
    if (!data) return { success: false, reason: 'no-data' };
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: '데이터 백업',
      defaultPath: `nost-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { success: false, reason: 'canceled' };
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true, filePath };
    } catch (e) { return { success: false, reason: String(e) }; }
  });

  ipcMain.handle('import-data', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '데이터 복원',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { success: false, reason: 'canceled' };
    try {
      const parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
      if (!parsed.spaces || !parsed.settings) return { success: false, reason: 'invalid-format' };
      store.set('appData', parsed);
      return { success: true, data: parsed };
    } catch (e) { return { success: false, reason: String(e) }; }
  });

  // ── 12d. Clipboard ───────────────────────────────────────────────

  ipcMain.handle('read-clipboard', async () => {
    // Fast path: plain text; slow path: Explorer file-drop via PS
    return clipboard.readText() || await readClipboardFileDrop();
  });

  ipcMain.handle('analyze-clipboard', async () => {
    let text = clipboard.readText().trim();
    if (!text) text = await readClipboardFileDrop();
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
      const name   = text.split(/[/\\]/).filter(Boolean).pop() || text;
      const hasExt = /\.[a-zA-Z0-9]{1,6}$/.test(name);
      if (/\.exe$/i.test(text)) return { type: 'app',    value: text, label: name.replace(/\.exe$/i, '') };
      if (!hasExt || /[/\\]$/.test(text)) return { type: 'folder', value: text.replace(/[/\\]+$/, ''), label: name };
    }

    return { type: 'none' };
  });

  // ── 12e. App Launching ───────────────────────────────────────────

  ipcMain.on('open-url', (_, url, closeAfter) => {
    // Prefer focusing an existing Chrome tab over opening a new browser window
    const tab = findChromeTabByHost(url);
    if (tab) sendSse({ action: 'focus', tabId: tab.id, windowId: tab.windowId });
    else     shell.openExternal(url);
    if (closeAfter) mainWindow.hide();
  });

  ipcMain.on('open-path', (_, folderPath, closeAfter) => {
    // PS script focuses an existing Explorer window at this path, or opens a new one
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('open-path.ps1')}"`, {
      env: { ...process.env, QL_PATH: folderPath },
    });
    if (closeAfter) mainWindow.hide();
  });

  ipcMain.on('run-cmd', (_, command, closeAfter) => {
    // Wrap in cmd /c so batch files, pipes, and built-in commands work
    exec(`cmd /c ${command}`, { windowsHide: false }, (err) => {
      if (err) console.error('[run-cmd]', err.message);
    });
    if (closeAfter) mainWindow.hide();
  });

  ipcMain.on('copy-text', (_, text, closeAfter) => {
    clipboard.writeText(text);
    // Brief delay so React can finish rendering the "복사됨" toast before hiding
    if (closeAfter) setTimeout(() => mainWindow.hide(), 700);
  });

  ipcMain.on('open-guide', () => {
    // Prefer the bundled copy in extraResources; fall back to project root in dev
    const candidates = [
      path.join(process.resourcesPath || '', 'guide.md'),
      path.join(__dirname, 'guide.md'),
    ];
    const guidePath = candidates.find(p => fs.existsSync(p));
    if (guidePath) shell.openPath(guidePath);
  });

  ipcMain.handle('launch-or-focus-app', async (_, exePath, closeAfter, _monitor) => {
    if (closeAfter) mainWindow.hide();
    try {
      const { stdout } = await runPsAsync('launch-or-focus-app.ps1', { QL_PATH: exePath }, { timeout: 10000 });
      const out = stdout.trim().toUpperCase();
      return { success: true, action: out.includes('FOCUSED') ? 'focused' : 'launched' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('focus-window', async (_, title, closeAfter) => {
    if (closeAfter) mainWindow.hide();
    try {
      const { stdout } = await runPsAsync('focus-window.ps1', { QL_TITLE: title }, { timeout: 5000 });
      return { success: stdout.trim().toUpperCase().includes('FOUND') };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 12f. Window Management ───────────────────────────────────────

  ipcMain.handle('get-open-windows', async () => {
    try {
      const { stdout } = await runPsAsync('get-open-windows.ps1', {}, {
        maxBuffer: 1024 * 1024 * 5, timeout: 15000,
      });
      const parsed  = JSON.parse(stdout.trim());
      const windows = Array.isArray(parsed.windows) ? parsed.windows : [];
      return { windows, browserTabs: global.chromeTabs };
    } catch {
      return { windows: [], browserTabs: global.chromeTabs };
    }
  });

  ipcMain.handle('check-windows-alive', async (_, titles) => {
    if (!titles?.length) return {};
    try {
      const { stdout } = await runPsAsync('check-windows-alive.ps1',
        { QL_TITLES: JSON.stringify(titles) }, { timeout: 8000 }
      );
      const arr = JSON.parse(stdout.trim());
      const map = {};
      for (const item of Array.isArray(arr) ? arr : [arr]) {
        if (item?.t != null) map[item.t] = !!item.v;
      }
      return map;
    } catch { return {}; }
  });

  ipcMain.handle('get-recent-items', async () => {
    try {
      // encoding: 'buffer' needed for correct UTF-8 handling of Korean paths
      const { stdout } = await runPsAsync('get-recent-items.ps1', {}, {
        timeout: 5000, encoding: 'buffer',
      });
      const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout);
      return JSON.parse(text.trim());
    } catch { return []; }
  });

  ipcMain.handle('snap-window', async (_, { item, zone }) => {
    try {
      await runPsAsync('snap-window.ps1',
        { QL_ITEM: JSON.stringify(item), QL_ZONE: zone }, { timeout: 10000 }
      );
      return { success: true };
    } catch { return { success: false }; }
  });

  ipcMain.handle('maximize-window', async (_, { item, monitor = 0 }) => {
    try {
      const { stdout } = await runPsAsync('maximize-window.ps1',
        { QL_ITEM: JSON.stringify(item), QL_MONITOR: String(monitor) }, { timeout: 10000 }
      );
      return { success: stdout.trim() === 'OK' };
    } catch { return { success: false }; }
  });

  ipcMain.handle('resize-active-window', async (event, { pct }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false };
    const wa = getScreen().getDisplayMatching(win.getBounds()).workArea;
    if (pct >= 100) {
      win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height }, true);
    } else {
      const w = Math.round(wa.width  * pct / 100);
      const h = Math.round(wa.height * pct / 100);
      win.setBounds({
        x: wa.x + Math.round((wa.width  - w) / 2),
        y: wa.y + Math.round((wa.height - h) / 2),
        width: w, height: h,
      }, true);
    }
    return { success: true };
  });

  // ── 12g. Tile System ─────────────────────────────────────────────

  /**
   * Quick pre-check: are the target items already visible on screen?
   * Used by the NodeGroup UI to decide whether to show a "launch first?" prompt.
   */
  ipcMain.handle('check-items-for-tile', async (_, items) => {
    const results = items.map((_, idx) => ({ idx, alive: false, note: '' }));

    // Fast path — check url/browser types against cached chromeTabs
    items.forEach((item, idx) => {
      if (item.type === 'url' || item.type === 'browser') {
        const found = !!findChromeTabByHost(item.value);
        results[idx].alive = found;
        results[idx].note  = found ? 'tab' : 'no-tab';
      }
    });

    // PS path — check app/folder/window types
    const needsPs = items
      .map((item, idx) => ({ ...item, idx }))
      .filter(i => ['window', 'app', 'folder'].includes(i.type));

    if (needsPs.length) {
      try {
        // Per-poll timeout: 4s. The renderer polls every 400ms for up to 15s,
        // so a 15s per-call timeout could consume the entire detection window
        // in a single poll if Shell.Application enumeration stalled. Fail-fast
        // at 4s and the next poll tries again — recovers from transient stalls.
        const { stdout } = await runPsAsync('check-items-for-tile.ps1',
          { QL_ITEMS: JSON.stringify(needsPs) }, { maxBuffer: 1024 * 1024, timeout: 4000 }
        );
        let parsed = JSON.parse(stdout.trim());
        if (!Array.isArray(parsed)) parsed = [parsed];
        parsed.forEach(r => { if (r?.idx != null) results[r.idx].alive = r.alive; });
      } catch { /* leave defaults */ }
    }

    return results;
  });

  /**
   * Launch all items fire-and-forget and return identifiers + recommended waitMs.
   * Called by NodeGroup before run-tile-ps.
   */
  ipcMain.handle('launch-items-for-tile', async (_, items) => {
    let hasDetach    = false;
    const enriched   = items.map(item => ({ ...item, tabTitle: '', tabId: 0 }));

    for (let i = 0; i < enriched.length; i++) {
      const item = enriched[i];
      if (['app', 'folder', 'window'].includes(item.type)) {
        fireLaunchItem(item);
      } else if (item.type === 'url' || item.type === 'browser') {
        const tab = findChromeTabByHost(item.value);
        if (tab && sseConnection) {
          // Existing tab → detach it into its own browser window
          sendSse({ action: 'detach', tabId: tab.id });
          enriched[i].tabTitle = tab.title || '';
          enriched[i].tabId    = tab.id;
          hasDetach = true;
        } else if (sseConnection) {
          // No matching tab → open directly in a new window via the extension
          sendSse({ action: 'openWindow', url: item.value });
          hasDetach = true;
        } else {
          // Extension not connected → OS default browser
          shell.openExternal(item.value);
        }
      }
    }

    const waitMs     = hasDetach ? 2200 : 1100;
    const identifiers = enriched.map(i => ({
      type: i.type, value: i.value, title: i.title || '',
      tabTitle: i.tabTitle || '', tabId: i.tabId || 0,
    }));
    return { waitMs, identifiers };
  });

  /**
   * Position already-launched windows into a tiled layout.
   * Browser windows are resized via SSE; native windows via run-tile-ps.ps1.
   * Both must complete before this resolves ("완료" signal in the UI).
   */
  ipcMain.handle('run-tile-ps', async (_, { identifiers, monitor = 0 }) => {
    // Electron DIP coords passed directly to PS (_Position.ps1 uses DPI-unaware context)
    const { wa }  = getMonitorWorkArea(monitor);
    const count   = identifiers.length;
    const colBase = Math.floor(wa.width / count); // base column width

    // ── Per-item tab lookup (by tabId → tabTitle → hostname) ──────
    const findTab = (item) => {
      const tabs = global.chromeTabs || [];
      if (item.tabId)    { const t = tabs.find(t => t.id    === item.tabId);    if (t) return t; }
      if (item.tabTitle) { const t = tabs.find(t => t.title === item.tabTitle); if (t) return t; }
      return findChromeTabByHost(item.value);
    };

    const browserIdxs = identifiers.reduce((acc, item, i) => {
      if (item.type === 'url' || item.type === 'browser') acc.push(i);
      return acc;
    }, []);

    // ── Browser promise: poll until each tab is alone in its window, then resize ──
    const browserPromise = (browserIdxs.length === 0 || !sseConnection)
      ? Promise.resolve()
      : new Promise(resolve => {
          const done     = new Set();
          const deadline = Date.now() + 15000;
          const poll = () => {
            const tabs = global.chromeTabs || [];
            for (const i of browserIdxs) {
              if (done.has(i)) continue;
              const tab = findTab(identifiers[i]);
              if (tab && tabs.filter(t => t.windowId === tab.windowId).length === 1) {
                const colW = i === count - 1 ? wa.width - colBase * (count - 1) : colBase;
                sendSse({
                  action: 'resize', windowId: tab.windowId, tabId: tab.id,
                  left: wa.x + i * colBase, top: wa.y, width: colW, height: wa.height,
                });
                done.add(i);
              }
            }
            if (done.size >= browserIdxs.length || Date.now() >= deadline) resolve();
            else setTimeout(poll, 500);
          };
          setTimeout(poll, 400);
        });

    // ── PS promise: tile native windows (PS polls up to 30 s internally) ──
    const flagged    = identifiers.map(item => ({
      ...item, isBrowser: item.type === 'url' || item.type === 'browser',
    }));
    const psPromise  = runPsAsync('run-tile-ps.ps1', {
      QL_SCREEN_X: String(wa.x),     QL_SCREEN_Y: String(wa.y),
      QL_SCREEN_W: String(wa.width), QL_SCREEN_H: String(wa.height),
      QL_MONITOR:  String(monitor),  QL_ITEMS:    JSON.stringify(flagged),
    }, { timeout: 45000 })
      .then(() => ({ success: true, error: '' }))
      .catch(err => ({ success: false, error: err.message }));

    const [, psResult] = await Promise.all([browserPromise, psPromise]);
    return psResult;
  });

  /**
   * Legacy /tile commandbar handler — launches items and tiles them in one call.
   * The modern NodeGroup flow uses launch-items-for-tile + run-tile-ps instead.
   */
  ipcMain.handle('tile-windows', async (_, items) => {
    let hasDetach = false;
    const enriched = items.map(item => ({ ...item, tabTitle: '', tabId: 0 }));

    for (let i = 0; i < enriched.length; i++) {
      const item = enriched[i];
      if (['app', 'folder', 'window'].includes(item.type)) {
        fireLaunchItem(item);
      } else if (item.type === 'url' || item.type === 'browser') {
        const tab = findChromeTabByHost(item.value);
        if (tab && sseConnection) {
          sendSse({ action: 'detach', tabId: tab.id });
          enriched[i].tabTitle = tab.title || '';
          enriched[i].tabId    = tab.id;
          hasDetach = true;
        } else {
          shell.openExternal(item.value);
        }
      }
    }

    const waitMs      = hasDetach ? 1600 : 900;
    const identifiers = enriched.map(i => ({
      type: i.type, value: i.value, title: i.title || '', tabTitle: i.tabTitle || '',
    }));

    return new Promise(resolve => {
      setTimeout(async () => {
        const { wa } = getMonitorWorkArea(0);
        try {
          await runPsAsync('tile-windows.ps1', {
            QL_SCREEN_X: String(wa.x),     QL_SCREEN_Y: String(wa.y),
            QL_SCREEN_W: String(wa.width), QL_SCREEN_H: String(wa.height),
            QL_ITEMS:    JSON.stringify(identifiers),
          }, { maxBuffer: 1024 * 1024 * 2, timeout: 30000 });
          resolve({ success: true, debug: '', error: '' });
        } catch (err) {
          resolve({ success: false, debug: '', error: err.message });
        }
      }, waitMs);
    });
  });

  // ── 12h. Monitor Utilities ───────────────────────────────────────

  ipcMain.handle('get-monitors', () => {
    const screen  = getScreen();
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, i) => ({
      index: i + 1, id: d.id, isPrimary: d.id === primary.id,
      bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor,
    }));
  });

  ipcMain.handle('identify-monitors', async () => {
    const screen   = getScreen();
    const displays = screen.getAllDisplays();
    const primary  = screen.getPrimaryDisplay();

    // Briefly show a numbered overlay on each display
    const wins = displays.map((display, i) => {
      const { x, y, width, height } = display.bounds;
      const win = new BrowserWindow({
        x: x + Math.floor(width / 2) - 100, y: y + Math.floor(height / 2) - 100,
        width: 200, height: 200,
        frame: false, transparent: true, alwaysOnTop: true,
        skipTaskbar: true, focusable: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      const label = display.id === primary.id ? '주 모니터' : '보조 모니터';
      const html  = `<!DOCTYPE html><html style="margin:0;background:transparent"><body style="margin:0;display:flex;align-items:center;justify-content:center;width:200px;height:200px"><div style="background:rgba(12,12,22,0.72);backdrop-filter:blur(32px) saturate(160%);-webkit-backdrop-filter:blur(32px) saturate(160%);border-radius:22px;width:172px;height:172px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;border:2px solid rgba(99,102,241,0.65);box-shadow:0 0 0 1px rgba(99,102,241,0.15),0 0 48px rgba(99,102,241,0.45),0 16px 48px rgba(0,0,0,0.65)"><div style="color:#fff;font-size:78px;font-weight:900;font-family:system-ui;line-height:1;text-shadow:0 0 24px rgba(99,102,241,0.7)">${i + 1}</div><div style="color:rgba(255,255,255,0.5);font-size:11px;font-family:system-ui;letter-spacing:0.04em">${label}</div></div></body></html>`;
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      return win;
    });

    await new Promise(r => setTimeout(r, 2600));
    wins.forEach(w => { try { if (!w.isDestroyed()) w.close(); } catch {} });
    return { count: displays.length };
  });

  // ── 12i. Download Dialog Detection (Kick Feature) ────────────────

  /** Detect whether the foreground window is a file-save/open dialog. */
  ipcMain.handle('detect-dialog', async () => {
    try {
      const { stdout } = await runPsAsync('detect-dialog.ps1', {}, { timeout: 5000 });
      return JSON.parse(stdout.trim());
    } catch { return { isDialog: false }; }
  });

  /** Navigate the active file dialog to a specific folder path. */
  ipcMain.on('jump-to-dialog-folder', (_, folderPath) => {
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('jump-to-dialog-folder.ps1')}"`, {
      env: { ...process.env, QL_PATH: folderPath },
    });
  });

  // ── 12j. Auto-Updater ────────────────────────────────────────────

  ipcMain.handle('check-for-updates', () => checkForUpdateAsync());

  ipcMain.on('install-update', () => autoUpdater.quitAndInstall(false, true));

  // ── 12k. Extension Bridge ────────────────────────────────────────

  ipcMain.handle('get-extension-bridge-status', () => ({
    connected:                !!sseConnection,
    tabsCount:                (global.chromeTabs || []).length,
    lastTabsUpdateAt,
    lastExtensionConnectedAt,
  }));

  ipcMain.handle('open-extension-install-helper', async (_, target = 'chrome') => {
    const extensionDir = resolveExtensionDir();
    if (!extensionDir) return { success: false, reason: 'extension-folder-not-found' };

    const result = launchBrowserExtensionsPage(target);
    clipboard.writeText(extensionDir); // copies path so user can paste in browser extension page

    return {
      success:        result.ok,
      extensionDir,
      copiedPath:     true,
      reason:         result.ok ? undefined : result.reason,
      browser:        target,
      browserExePath: result.exePath,
    };
  });
}

// ── 13. App Lifecycle ─────────────────────────────────────────────────

app.whenReady().then(() => {
  // Show splash immediately to provide visual feedback during cold start
  createLoadingWindow();
  startExtServer();

  // Apply Content Security Policy to all renderer page loads.
  // In dev mode (Vite dev server), allow inline scripts + ws:// connections so
  // React Refresh preamble and HMR work. Production stays strict.
  const isDev = !!process.env.ELECTRON_RENDERER_URL?.trim();
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:5173" : "script-src 'self'";
  const connectSrc = isDev
    ? "connect-src 'self' http://127.0.0.1:14502 http://127.0.0.1:5173 ws://127.0.0.1:5173"
    : "connect-src 'self' http://127.0.0.1:14502";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: https://www.google.com; " +
          scriptSrc + "; " +
          connectSrc,
        ],
      },
    });
  });

  createWindow();

  // Notify renderer whenever monitor configuration changes
  const screen = getScreen();
  const sendMonitorChange = () => {
    const primary  = screen.getPrimaryDisplay();
    const monitors = screen.getAllDisplays().map((d, i) => ({
      index: i + 1, id: d.id, isPrimary: d.id === primary.id,
      bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor,
    }));
    sendSafe('monitors-changed', monitors);
  };
  screen.on('display-added',           sendMonitorChange);
  screen.on('display-removed',         sendMonitorChange);
  screen.on('display-metrics-changed', sendMonitorChange);

  // ── Auto-updater (packaged builds only) ──────────────────────────
  if (app.isPackaged) {
    autoUpdater.logger           = null; // suppress verbose internal logging
    autoUpdater.autoDownload     = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available',  (info) => sendSafe('update-available',         { version: info.version }));
    autoUpdater.on('download-progress', (info) => sendSafe('update-download-progress', { percent: Math.round(info.percent) }));
    autoUpdater.on('update-downloaded', (info) => sendSafe('update-downloaded',         { version: info.version }));
    // Reset the progress bar in the UI if the download fails
    autoUpdater.on('error', () => sendSafe('update-download-progress', null));

    // Non-blocking update check 5 s after launch (cold-start safety margin)
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  }

  // ── System Tray ──────────────────────────────────────────────────
  const iconPath = path.join(__dirname, 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    // Fallback icon in case the asset is missing (dev or corrupted install)
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABZSURBVDhPY/z//z8DNgAMwDSjG0BWAzABqhlAlwDRQJQA1zIwAGqBGBOISaWAwQCohoEBsEEYw+gGgDWDARgGwwAwA1IMgBnA1AAjC9MAsgEoA0YGQM2AhQEADgA/0qDq3m0AAAAASUVORK5CYII=';
    icon = nativeImage.createFromDataURL('data:image/png;base64,' + b64);
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip('nost');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `버전 ${app.getVersion()}`, enabled: false },
    {
      label: '업데이트 확인',
      click: async () => {
        const result = await checkForUpdateAsync();
        if (result.status === 'up-to-date') {
          dialog.showMessageBox({ type: 'info', title: '업데이트',
            message: `최신 버전입니다. (v${app.getVersion()})` });
        } else if (result.status === 'update-available') {
          dialog.showMessageBox({ type: 'info', title: '업데이트 발견',
            message: `새 버전 v${result.newVersion}이 있습니다.\n백그라운드에서 다운로드 중입니다.` });
        } else if (result.status === 'dev-mode') {
          dialog.showMessageBox({ type: 'info', title: '업데이트',
            message: '개발 모드에서는 업데이트를 확인할 수 없습니다.' });
        } else {
          // Trim the raw error message to something readable
          let msg = result.message ?? '알 수 없는 오류';
          if (/404/.test(msg)) {
            msg = '업데이트 정보를 찾을 수 없습니다 (404).\n최신 릴리즈에 업데이트 파일이 없을 수 있습니다.';
          } else {
            const first = msg.split('\n')[0].trim();
            msg = first.length > 120 ? first.slice(0, 120) + '…' : first;
          }
          dialog.showMessageBox({ type: 'warning', title: '업데이트 오류',
            message: `업데이트 확인에 실패했습니다:\n\n${msg}` });
        }
      },
    },
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });

  // macOS: re-create window when dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();

  // Destroy the SSE socket immediately so the Chrome extension reconnects quickly
  if (sseConnection) { sseConnection.destroy(); sseConnection = null; }
  extServer.close();
});
