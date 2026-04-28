// ╔══════════════════════════════════════════════════════════════════╗
// ║  nost — Electron Main Process                                    ║
// ║  D:\01_개인\06. launcher\main.js                                 ║
// ╚══════════════════════════════════════════════════════════════════╝

'use strict';

// ── 1. Requires & Store ──────────────────────────────────────────────
const {
  app, BrowserWindow, globalShortcut, ipcMain, shell, clipboard,
  Tray, Menu, nativeImage, dialog, session, net,
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
let floatingWindow   = null;   // Phase 1 floating orb (always-on-top FAB)
let badgeOverlay     = null;   // Phase 2 single overlay window hosting every floating badge
let tray             = null;
let currentShortcut  = 'Alt+4';

// Drag session state for the floating orb.
//
// Design: the renderer sends `floating-drag-start` only AFTER the pointer has
// moved past a 4 px dead-zone (so bare clicks never enter drag mode). Main
// then polls getCursorScreenPoint() at 60 Hz and sets window position so the
// cursor stays pinned to its initial offset inside the orb. This is
// DPI-scaling-safe and immune to renderer screenX jitter.
//
// Robustness — three watchdogs guard against stuck intervals:
//   1. `drag-end`          — fires on every pointer release (incl. cancel)
//   2. heartbeat timeout   — if the renderer stops sending heartbeats for
//                            500 ms (e.g. crash, lost pointer capture) we
//                            end the drag automatically
//   3. absolute ceiling    — a drag is force-ended after 60 s no matter what
let floatingDragOffset    = null;  // { ox, oy } — cursor offset inside window
let floatingDragInterval  = null;  // 60Hz position-update timer
let floatingDragWatchdog  = null;  // heartbeat-expiry timer
let floatingDragCeiling   = null;  // absolute 60s ceiling timer

function endFloatingDrag(persist = true) {
  if (floatingDragInterval)  { clearInterval(floatingDragInterval);   floatingDragInterval  = null; }
  if (floatingDragWatchdog)  { clearTimeout(floatingDragWatchdog);    floatingDragWatchdog  = null; }
  if (floatingDragCeiling)   { clearTimeout(floatingDragCeiling);     floatingDragCeiling   = null; }
  floatingDragOffset = null;
  if (persist && floatingWindow && !floatingWindow.isDestroyed()) {
    const [x, y] = floatingWindow.getPosition();
    saveFloatingPosition(x, y);
  }
}

// ── Update download state ─────────────────────────────────────────────
// Shared by auto-updater event handlers and tray menu builder so the
// tray always reflects the true download status.
let updateState      = 'idle';   // 'idle' | 'downloading' | 'downloaded'
let updatePct        = 0;        // 0-100
let updateNewVersion = '';       // e.g. "1.0.15"

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
 * ONE place that prepares the QL_SCREEN_* env block for EVERY PS window
 * placement call. Electron's monitor enumeration is the single source of
 * truth; PS's own System.Windows.Forms.Screen order can differ and has
 * caused "monitor 1 vs 2" flip-flopping across the card / node / deck /
 * snap paths.
 *
 * ── Coordinate system conversion ──────────────────────────────────
 * Electron reports in its own DIP space where:
 *   - Each display has its native DIP size (bounds.width/height at its scale)
 *   - Positions accumulate in a unified space based on PRIMARY's scale
 *
 * PS (per-monitor aware, default on Windows 10+) uses PHYSICAL pixels for
 * MoveWindow. Passing Electron DIPs directly puts windows on the wrong
 * physical monitor whenever primary ≠ secondary DPI. Example:
 *   Electron: secondary starts at DIP x=1536 (primary is 1536 DIP wide)
 *   PS phys : secondary starts at px 1920  (primary is 1920 physical wide)
 *   1536 ≠ 1920 → window lands on primary's right edge, not secondary.
 *
 * Translation rule (verified against this user's setup):
 *   phys_x = dip_x * primary_scale    (positions use primary scale)
 *   phys_y = dip_y * primary_scale
 *   phys_w = dip_w * display_scale    (sizes use each display's own scale)
 *   phys_h = dip_h * display_scale
 */
function monitorEnvFor(monitorIndex) {
  const screen   = getScreen();
  const displays = screen.getAllDisplays();
  const primary  = screen.getPrimaryDisplay();

  const disp = (monitorIndex >= 1 && monitorIndex <= displays.length)
    ? displays[monitorIndex - 1]
    : primary;
  const wa = disp.workArea;

  // IMPORTANT — pass raw Electron DIP values, NOT physical pixels.
  //
  // PS runs DPI-unaware, which means Windows already virtualizes its
  // coordinate system to primary's DIP space. When we call MoveWindow with
  // value X, Windows multiplies by primary.scaleFactor to get physical.
  // If we ALSO multiply in this function, we double-scale:
  //   Electron DIP 1536 → (we ×1.25) → PS 1920 → (Windows ×1.25) → physical 2400
  // and the window lands ~500 px past the monitor's right edge.
  //
  // Electron's DIP numbers happen to match exactly what the DPI-unaware PS
  // process sees — both coordinate systems are "primary-scale-virtualized
  // DIP". Hand the values off unchanged and Windows does the right thing
  // for every monitor regardless of its DPI.
  const physX = wa.x;
  const physY = wa.y;
  const physW = wa.width;
  const physH = wa.height;

  // ── Per-edge border safety ────────────────────────────────────────
  //
  // The tile layout normally pads each side by -8 / +8 px so the window
  // chrome hides the work-area edge (nice-maximized look). But when the
  // *target* monitor sits next to a *different-DPI* monitor, that 8 px
  // overshoot lands the window 8 px inside the neighbour — and Windows
  // sees a cross-DPI straddle, fires WM_DPICHANGED on the app, which then
  // self-resizes by the neighbour's scale factor. Claude at 1048 → 1310
  // (= 1048×1.25) is the textbook case.
  //
  // Fix: on edges that touch a DPI-mismatched neighbour, set border = 0.
  // The visible seam on that edge is a small cosmetic cost; the window
  // size and bottom-cut problem disappears.
  const b = disp.bounds;
  const touchesMismatched = (side) => displays.some(other => {
    if (other.id === disp.id) return false;
    if (other.scaleFactor === disp.scaleFactor) return false;
    const o = other.bounds;
    // Horizontal seam — vertical overlap + touching x edge
    const vOverlap = !(b.y + b.height <= o.y || o.y + o.height <= b.y);
    const hOverlap = !(b.x + b.width  <= o.x || o.x + o.width  <= b.x);
    if (side === 'left'  ) return vOverlap && (o.x + o.width  === b.x);
    if (side === 'right' ) return vOverlap && (b.x + b.width  === o.x);
    if (side === 'top'   ) return hOverlap && (o.y + o.height === b.y);
    if (side === 'bottom') return hOverlap && (b.y + b.height === o.y);
    return false;
  });

  return {
    QL_SCREEN_X: String(physX),
    QL_SCREEN_Y: String(physY),
    QL_SCREEN_W: String(physW),
    QL_SCREEN_H: String(physH),
    QL_MONITOR:  String(monitorIndex ?? 0),
    // 0 = unsafe to overshoot (different-DPI neighbour). 8 = safe.
    QL_BORDER_LEFT:   touchesMismatched('left')   ? '0' : '8',
    QL_BORDER_RIGHT:  touchesMismatched('right')  ? '0' : '8',
    QL_BORDER_TOP:    touchesMismatched('top')    ? '0' : '8',
    QL_BORDER_BOTTOM: touchesMismatched('bottom') ? '0' : '8',
  };
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
    // Force PowerShell to emit UTF-8 so non-ASCII error messages (Korean
    // system errors, file paths with CJK chars) survive the exec round-trip
    // unmangled. Without this, PS defaults to the OS code page (CP949 on
    // Korean Windows) which we then mis-decode as UTF-8 → "占쏙옙" soup.
    const scriptPath = ps(scriptName).replace(/'/g, "''");
    const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `
              + `"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; `
              + `$OutputEncoding=[System.Text.Encoding]::UTF8; `
              + `& '${scriptPath}'"`;
    const child = exec(
      cmd,
      {
        shell:     false,
        maxBuffer: opts.maxBuffer ?? 1024 * 1024 * 2,
        timeout:   opts.timeout   ?? 30000,
        // Explicit 'utf8' — passing `undefined` here makes Node return
        // Buffer objects, which breaks callers that chain .trim()/.toUpperCase().
        encoding:  opts.encoding ?? 'utf8',
        env:       { ...process.env, ...envVars },
      },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({
          stdout: typeof stdout === 'string' ? stdout : stdout?.toString('utf8') ?? '',
          stderr: typeof stderr === 'string' ? stderr : stderr?.toString('utf8') ?? '',
        });
      }
    );

    // Optional streaming callback — caller passes opts.onLine to receive
    // each line of PS stdout as it's written, instead of waiting for the
    // process to fully exit. Critical for long-running scripts like
    // run-tile-ps where 45 s poll loops otherwise look like "hung".
    if (typeof opts.onLine === 'function' && child.stdout) {
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (line.length > 0) {
            try { opts.onLine(line); } catch (_) {}
          }
        }
      });
      child.stdout.on('end', () => {
        if (buf.trim()) {
          try { opts.onLine(buf.trim()); } catch (_) {}
        }
      });
    }
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
/**
 * Show/hide the main launcher window with the same debounced, GPU-safe
 * logic used by the global shortcut. Exposed so other triggers (tray,
 * floating FAB) can invoke it without duplicating the safeguards.
 */
/**
 * Transparent-window GPU recovery.
 *
 * On Windows, a frameless + transparent BrowserWindow shares a compositor
 * backing store with DWM. Rapid hide/show (global shortcut hammered, tray
 * double-clicked, or auto-hide triggering during a focus race) can leave
 * the window with a stale/empty backing — the user sees just the faint
 * drop-shadow outline and no content.
 *
 * `webContents.invalidate()` alone asks Chromium to repaint, but the
 * compositor itself still thinks the window is "up to date" and suppresses
 * the frame. The robust fix is a 1-pixel bounds nudge: Windows treats it as
 * a resize, rebuilds the surface, and the next paint lands visibly. We snap
 * back to the original bounds in the same tick so the user never sees the
 * jiggle.
 */
function recoverTransparentBacking(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    win.setBounds({ x: b.x, y: b.y, width: b.width + 1, height: b.height });
    win.setBounds(b);
    win.webContents.invalidate();
  } catch (_) { /* window may have been destroyed mid-flight */ }
}

function toggleMainWindow() {
  if (app.isQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (_toggleLocked) return;
  _toggleLocked = true;
  setTimeout(() => { _toggleLocked = false; }, 150);

  try {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
      recoverTransparentBacking(mainWindow);
    }
  } catch (e) {
    console.warn('[toggleMainWindow]', e.message);
    return;
  }

  // Main may be raised to the top; re-assert the orb's screen-saver level so
  // it stays above the launcher and the user can click it to toggle again.
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    try {
      floatingWindow.setAlwaysOnTop(true, 'screen-saver');
      floatingWindow.moveTop();
    } catch (_) { /* orb may have been destroyed */ }
  }
}

function registerShortcut(newShortcut) {
  if (currentShortcut) globalShortcut.unregister(currentShortcut);
  currentShortcut = newShortcut;

  const registered = globalShortcut.register(currentShortcut, toggleMainWindow);

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

// ── Floating orb window (Phase 1 MVP) ────────────────────────────────
//
// A separate always-on-top, frameless, transparent BrowserWindow that hosts
// a single 48px orb. Clicking the orb toggles mainWindow (same effect as
// pressing the global shortcut). Users can drag the window to reposition it;
// the final position is persisted to electron-store so it survives restarts.
//
// The window is 8px larger than the orb on each axis to give the drop shadow
// room — this avoids visible clipping that would otherwise need a non-trivial
// overlay mask. Size scales with the `size` setting ("small" | "normal").

// How big the BrowserWindow is vs. how big the visible orb is.
// Window = orb + 2 * glowPadding (per side).
//
// The orb's drop-shadow extends ~28px blur + 10px offset; we need the window
// to be large enough that the shadow renders without being clipped at the
// transparent window edge. 22px on each side gives comfortable headroom on
// hover (when the halo is at its widest) without wasting screen real estate.
const FLOATING_ORB_GLOW_PAD = 22;

function floatingWindowSizeFor(sizePreset) {
  const orbPx = sizePreset === 'small' ? 40 : 48;
  const winPx = orbPx + FLOATING_ORB_GLOW_PAD * 2;
  return { orbPx, winPx };
}

/** Default orb position: bottom-right of the primary display, with a comfy inset. */
function defaultFloatingPosition(winPx) {
  const primary = getScreen().getPrimaryDisplay();
  const wa = primary.workArea;
  return {
    x: wa.x + wa.width  - winPx - 24,
    y: wa.y + wa.height - winPx - 24,
  };
}

/** Read current floating settings from the persisted data blob. */
function getFloatingSettings() {
  const data = store.get('appData') || {};
  const fb = data?.settings?.floatingButton;
  return {
    enabled:         !!fb?.enabled,
    idleOpacity:     typeof fb?.idleOpacity === 'number' ? fb.idleOpacity : 0.65,
    size:            fb?.size === 'small' ? 'small' : 'normal',
    hideOnFullscreen: fb?.hideOnFullscreen !== false,
    position:        fb?.position ?? null,
    // Inherit the main app's accent so the orb's border + logo mark stay on-brand.
    // Falls back to the default indigo if the user hasn't customized.
    accentColor:     data?.settings?.accentColor ?? '#6366f1',
  };
}

/** Persist an updated position back into the settings blob. */
function saveFloatingPosition(x, y) {
  const data = store.get('appData') || {};
  data.settings = data.settings || {};
  data.settings.floatingButton = {
    ...(data.settings.floatingButton ?? {}),
    position: { x, y },
  };
  store.set('appData', data);
}

function createFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) return floatingWindow;

  const settings = getFloatingSettings();
  const { winPx } = floatingWindowSizeFor(settings.size);
  const pos = settings.position ?? defaultFloatingPosition(winPx);

  // Dedicated in-memory session for the orb.
  //
  // Sharing the default session with mainWindow caused Chromium to serialize
  // cache moves across both renderers, producing "Unable to move the cache
  // (0x5)" + "Gpu Cache Creation failed" errors on startup whenever the
  // floating window spawned alongside the main window. The orb is a single
  // static SVG with no data to cache, so an isolated memory-only session
  // (no cache, no HTTP cache, no GPU disk cache) is the right fit — zero
  // contention, zero disk I/O, and the main app's cache stays untouched.
  const orbSession = session.fromPartition('floating-orb-memory');
  try {
    orbSession.clearCache();  // idempotent no-op if already clean
    orbSession.clearStorageData({
      storages: ['cachestorage', 'cookies', 'localstorage', 'shadercache', 'serviceworkers'],
    }).catch(() => {});
  } catch (_) {}

  floatingWindow = new BrowserWindow({
    width: winPx, height: winPx,
    x: Math.round(pos.x), y: Math.round(pos.y),
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true,
    hasShadow: false,           // orb draws its own shadow
    minimizable: false, maximizable: false, fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-floating.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      backgroundThrottling: false,
      session: orbSession,        // isolated from mainWindow's cache
    },
  });

  // Pin above ALL other windows, including fullscreen-capable ones, so the
  // orb behaves consistently across desktops.
  floatingWindow.setAlwaysOnTop(true, 'screen-saver');
  floatingWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  if (rendererUrl) {
    floatingWindow.loadURL(`${rendererUrl}/floating.html`);
  } else {
    floatingWindow.loadFile(path.join(__dirname, 'frontend', 'dist', 'floating.html'));
  }

  floatingWindow.once('ready-to-show', () => {
    floatingWindow.webContents.send('floating-settings', {
      idleOpacity: settings.idleOpacity,
      size:        settings.size,
      accentColor: settings.accentColor,
    });
    floatingWindow.show();
  });

  floatingWindow.on('closed', () => { floatingWindow = null; });

  return floatingWindow;
}

/** Ensure the floating window matches the current enabled flag. */
function syncFloatingWindow() {
  const { enabled } = getFloatingSettings();
  if (enabled) {
    if (!floatingWindow || floatingWindow.isDestroyed()) createFloatingWindow();
  } else if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.destroy();
    floatingWindow = null;
  }
}

/** Push refreshed visual settings (size, opacity) into the live orb. */
function refreshFloatingVisuals() {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  const settings = getFloatingSettings();
  const { winPx } = floatingWindowSizeFor(settings.size);
  const [curW, curH] = floatingWindow.getSize();
  if (curW !== winPx || curH !== winPx) {
    const [x, y] = floatingWindow.getPosition();
    floatingWindow.setBounds({ x, y, width: winPx, height: winPx });
  }
  floatingWindow.webContents.send('floating-settings', {
    idleOpacity: settings.idleOpacity,
    size:        settings.size,
    accentColor: settings.accentColor,
  });
}

// ── Floating badges overlay (Phase 2) ────────────────────────────────
//
// A SINGLE transparent always-on-top BrowserWindow that spans the union of
// all displays and hosts every pinned badge (space / node / deck). The
// RAM-cheap alternative to spawning one BrowserWindow per badge.
//
// Click-through: the window runs with `setIgnoreMouseEvents(true, {forward: true})`
// so mouse events pass through empty regions. Renderer flips capture off while
// the pointer hovers a badge rect (via `badges-set-capture` IPC) and flips it
// back on when the pointer leaves.

/** Bounding box of the virtual desktop (union of all display bounds). */
function getVirtualDesktopBounds() {
  const displays = getScreen().getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const b = d.bounds;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width  > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  if (!isFinite(minX)) return { x: 0, y: 0, width: 1920, height: 1080 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Resolve every FloatingBadge in the store to the display-ready BadgeData
 * the overlay renderer expects. Filters out dangling entries whose referenced
 * space/node/deck has been deleted.
 */
function buildBadgePayload(data) {
  const spaces = data?.spaces ?? [];
  const nodes  = data?.nodeGroups ?? [];
  const decks  = data?.decks ?? [];
  const badges = data?.floatingBadges ?? [];

  // Flatten all spaces' items so node/deck can resolve by itemId cheaply.
  const allItems = new Map();
  for (const s of spaces) {
    for (const i of (s.items ?? [])) allItems.set(i.id, i);
  }

  // Strip a LauncherItem down to just what the mini-window needs to render
  // and fire a launch. Keeps the IPC payload small even for big spaces.
  function slimItem(i, space) {
    return {
      id: i.id,
      title: i.title,
      type: i.type,
      value: i.value,
      icon: i.icon,
      iconType: i.iconType,
      color: i.color,
      // pinnedIds is the authoritative pin source (see ghost/clean work)
      pinned: !!space?.pinnedIds?.includes(i.id),
    };
  }

  const out = [];
  for (const b of badges) {
    if (b.refType === 'space') {
      const s = spaces.find(x => x.id === b.refId);
      if (!s) continue;
      // Hide container-absorbed cards (hiddenInSpace) and sort pinned first
      // so the mini-window matches what the user sees in the main grid.
      const visible = (s.items ?? []).filter(i => !i.hiddenInSpace);
      const pinnedIds = new Set(s.pinnedIds ?? []);
      const sorted = [
        ...visible.filter(i => pinnedIds.has(i.id)),
        ...visible.filter(i => !pinnedIds.has(i.id)),
      ];
      out.push({
        id: b.id, refType: 'space', refId: b.refId,
        x: b.x, y: b.y,
        label: s.name,
        color: s.color,
        icon: s.icon ?? null,
        iconIsEmoji: isEmojiLike(s.icon),
        count: visible.length,
        items: sorted.map(i => slimItem(i, s)),
      });
    } else if (b.refType === 'node') {
      const n = nodes.find(x => x.id === b.refId);
      if (!n) continue;
      const items = (n.itemIds ?? [])
        .map(id => allItems.get(id))
        .filter(Boolean)
        .map(i => slimItem(i, spaces.find(s => (s.items ?? []).some(x => x.id === i.id))));
      out.push({
        id: b.id, refType: 'node', refId: b.refId,
        x: b.x, y: b.y,
        label: n.name,
        color: '#a78bfa',
        icon: 'hub',
        iconIsEmoji: false,
        count: items.length,
        items,
      });
    } else if (b.refType === 'deck') {
      const d = decks.find(x => x.id === b.refId);
      if (!d) continue;
      const items = (d.itemIds ?? [])
        .map(id => allItems.get(id))
        .filter(Boolean)
        .map(i => slimItem(i, spaces.find(s => (s.items ?? []).some(x => x.id === i.id))));
      out.push({
        id: b.id, refType: 'deck', refId: b.refId,
        x: b.x, y: b.y,
        label: d.name,
        color: '#f97316',
        icon: 'layers',
        iconIsEmoji: false,
        count: items.length,
        items,
      });
    }
  }
  return out;
}

/** Rough emoji detector — if it's a single visible char and not an ASCII letter, treat as emoji. */
function isEmojiLike(s) {
  if (!s || typeof s !== 'string') return false;
  // Material Symbol names are lowercase ASCII with underscores.
  if (/^[a-z0-9_]+$/.test(s)) return false;
  // Anything else is likely an emoji / symbol.
  return true;
}

function pushBadgeState() {
  if (!badgeOverlay || badgeOverlay.isDestroyed()) return;
  const data = store.get('appData') || {};
  const bounds = getVirtualDesktopBounds();
  const badges = buildBadgePayload(data);
  badgeOverlay.webContents.send('badges-state', {
    badges,
    overlayOrigin: { x: bounds.x, y: bounds.y },
    overlaySize:   { width: bounds.width, height: bounds.height },
  });
}

/** Destroy the overlay if it exists (called when no badges remain). */
function destroyBadgeOverlay() {
  if (badgeOverlay && !badgeOverlay.isDestroyed()) {
    badgeOverlay.destroy();
  }
  badgeOverlay = null;
}

function createBadgeOverlay() {
  if (badgeOverlay && !badgeOverlay.isDestroyed()) return badgeOverlay;
  const bounds = getVirtualDesktopBounds();

  // Dedicated session so Chromium doesn't contend over cache with the main
  // window (same lesson as floating orb).
  const badgeSession = session.fromPartition('badge-overlay-memory');
  try {
    badgeSession.clearCache();
    badgeSession.clearStorageData({
      storages: ['cachestorage', 'cookies', 'localstorage', 'shadercache', 'serviceworkers'],
    }).catch(() => {});
  } catch (_) {}

  badgeOverlay = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    frame: false, transparent: true, resizable: false,
    // Some Windows configurations briefly composite a solid window
    // background before the transparent layer engages, especially on
    // first creation. Setting backgroundColor to a fully-transparent
    // value (00 alpha) forces the compositor to skip that solid pass,
    // avoiding the "huge translucent rectangle flashes for a frame"
    // perception users hit as "BIG initially, then snaps to small".
    backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: true,
    hasShadow: false,
    focusable: false,   // never steal focus — badges are gestural only
    minimizable: false, maximizable: false, fullscreenable: false,
    show: false,
    // Force layout / paint even while hidden so the renderer's
    // useEffect runs and we can request state BEFORE we make the
    // window visible. Otherwise some Electron builds defer all
    // renderer work until the window is shown — and we end up
    // showing it for one frame of "loading" before content appears.
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-badges.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      backgroundThrottling: false,
      session: badgeSession,
    },
  });

  // Click-through by default; renderer flips off while hovering a badge.
  badgeOverlay.setIgnoreMouseEvents(true, { forward: true });

  // Stay above fullscreen apps on every workspace so badges act like a global HUD.
  badgeOverlay.setAlwaysOnTop(true, 'screen-saver');
  badgeOverlay.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  if (rendererUrl) {
    badgeOverlay.loadURL(`${rendererUrl}/badges.html`);
  } else {
    badgeOverlay.loadFile(path.join(__dirname, 'frontend', 'dist', 'badges.html'));
  }

  // Show timing — `ready-to-show` fires once content is painted at
  // least off-screen. We push state BUT defer the `showInactive()`
  // until the renderer requests state (which happens inside its
  // mount effect). That way the visible frame already contains the
  // hydrated badge layout — no flash of empty overlay or default
  // placement.
  let firstShown = false;
  const revealOnce = () => {
    if (firstShown) return;
    if (!badgeOverlay || badgeOverlay.isDestroyed()) return;
    firstShown = true;
    badgeOverlay.showInactive();
  };
  badgeOverlay.once('ready-to-show', () => {
    pushBadgeState();
    // Fallback: if the renderer's request never arrives within
    // 800 ms (older Electron builds, slow disk on cold start),
    // reveal anyway so the user isn't left wondering.
    setTimeout(revealOnce, 800);
  });
  // The renderer's mount effect calls badges.requestState(); main's
  // `badges-request-state` handler calls pushBadgeState() AND we
  // also reveal here. By the time the user sees the window, the
  // first state has already been applied to the React tree.
  ipcMain.once('badges-request-state', revealOnce);

  badgeOverlay.on('closed', () => { badgeOverlay = null; });

  return badgeOverlay;
}

/** Ensure the overlay reflects current state: alive iff any badges exist. */
function syncBadgeOverlay() {
  const data = store.get('appData') || {};
  const has  = Array.isArray(data.floatingBadges) && data.floatingBadges.length > 0;
  if (has) {
    if (!badgeOverlay || badgeOverlay.isDestroyed()) {
      createBadgeOverlay();
    } else {
      // Overlay dimensions may be stale if display config changed.
      const b = getVirtualDesktopBounds();
      const cur = badgeOverlay.getBounds();
      if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) {
        badgeOverlay.setBounds(b);
      }
      pushBadgeState();
    }
  } else {
    destroyBadgeOverlay();
  }
}

/** Mutate the appData blob with a callback, persist, and refresh the overlay.
 *
 *  Preset-aware: the authoritative owner of floatingBadges is the ACTIVE
 *  preset under data.presets[]. The top-level data.floatingBadges is a
 *  renderer-side flat-view mirror. We write BOTH so the next load's mirror-
 *  refresh doesn't discard our mutation. */
function mutateBadges(fn) {
  const data = store.get('appData') || {};
  const activeId = data.activePresetId;
  const presets = Array.isArray(data.presets) ? data.presets : [];
  const activeIdx = presets.findIndex(p => p && p.id === activeId);
  // Source of truth: active preset's list; fall back to top-level for pre-
  // migration stores.
  const src = activeIdx >= 0
    ? (presets[activeIdx].floatingBadges ?? [])
    : (Array.isArray(data.floatingBadges) ? data.floatingBadges : []);
  const list = [...src];
  const next = fn(list) ?? list;

  if (activeIdx >= 0) {
    data.presets = presets.map((p, i) => i === activeIdx ? { ...p, floatingBadges: next } : p);
  }
  data.floatingBadges = next;  // keep the flat mirror in sync

  store.set('appData', data);
  syncBadgeOverlay();
  sendSafe('badges-updated', next);
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
if ($t -match '\\.lnk$') {
  try {
    $wsh = New-Object -ComObject WScript.Shell; $lnk = $wsh.CreateShortcut($t)
    if ($lnk.TargetPath -match 'explorer\\.exe$' -and $lnk.Arguments -match 'shell:AppsFolder\\\\(.+)') {
      Start-Process explorer.exe "shell:AppsFolder\\$($Matches[1])"; exit
    } elseif ($lnk.TargetPath) { $t = $lnk.TargetPath }
  } catch {}
}
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

// ── 11b. Tray Menu Builder ────────────────────────────────────────────
//
// The tray menu is rebuilt dynamically whenever the update download state
// changes so that the user always sees accurate status at a glance.

/**
 * Flip the floating-button on/off and propagate the change end-to-end:
 * store → orb window lifecycle → tray menu → main window renderer state.
 * Shared between tray menu and orb right-click menu so both paths stay in sync.
 */
function setFloatingEnabled(enabled) {
  const data = store.get('appData') || {};
  data.settings = data.settings || {};
  data.settings.floatingButton = {
    ...(data.settings.floatingButton ?? {}),
    enabled,
  };
  store.set('appData', data);
  syncFloatingWindow();
  rebuildTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Tell the React layer to pull fresh settings so the Settings UI toggle
    // reflects the new state the next time the user opens the dialog.
    mainWindow.webContents.send('floating-settings-changed');
  }
}

/** Build the menu template for the current updateState. */
function buildTrayTemplate() {
  const versionLabel = `버전 ${app.getVersion()}`;
  const fbEnabled = !!getFloatingSettings().enabled;
  const floatingToggleItem = {
    label: fbEnabled ? '플로팅 버튼 숨기기' : '플로팅 버튼 표시',
    click: () => setFloatingEnabled(!fbEnabled),
  };

  // ── Update fully downloaded — offer install ───────────────────────
  if (updateState === 'downloaded') {
    return [
      { label: versionLabel, enabled: false },
      {
        label: `🆕 v${updateNewVersion} 준비됨 — 재시작하여 설치`,
        click: () => {
          dialog.showMessageBox({
            type: 'info',
            title: 'nost 업데이트',
            message: `v${updateNewVersion} 업데이트가 준비됐습니다.`,
            detail: '지금 재시작하면 업데이트가 자동으로 설치됩니다.',
            buttons: ['재시작하여 설치', '나중에'],
            defaultId: 0,
          }).then(({ response }) => {
            if (response === 0) autoUpdater.quitAndInstall(false, true);
          });
        },
      },
      floatingToggleItem,
      { type: 'separator' },
      { label: '종료', click: () => { app.isQuitting = true; app.quit(); } },
    ];
  }

  // ── Downloading in progress — show % and block redundant checks ───
  if (updateState === 'downloading') {
    return [
      { label: versionLabel, enabled: false },
      { label: `⬇︎ v${updateNewVersion} 다운로드 중... ${updatePct}%`, enabled: false },
      floatingToggleItem,
      { type: 'separator' },
      { label: '종료', click: () => { app.isQuitting = true; app.quit(); } },
    ];
  }

  // ── Idle — standard check ─────────────────────────────────────────
  return [
    { label: versionLabel, enabled: false },
    {
      label: '업데이트 확인',
      click: async () => {
        // Re-read state in case it changed since menu was opened
        if (updateState === 'downloaded') {
          const { response } = await dialog.showMessageBox({
            type: 'info', title: 'nost 업데이트',
            message: `v${updateNewVersion} 업데이트가 준비됐습니다.`,
            detail: '지금 재시작하면 업데이트가 자동으로 설치됩니다.',
            buttons: ['재시작하여 설치', '나중에'], defaultId: 0,
          });
          if (response === 0) autoUpdater.quitAndInstall(false, true);
          return;
        }
        if (updateState === 'downloading') {
          dialog.showMessageBox({
            type: 'info', title: '업데이트 다운로드 중',
            message: `v${updateNewVersion} 다운로드 중입니다 (${updatePct}%).`,
            detail: 'nost 앱 창을 열면 진행 상황을 확인할 수 있습니다.',
          });
          return;
        }

        const result = await checkForUpdateAsync();
        if (result.status === 'up-to-date') {
          dialog.showMessageBox({ type: 'info', title: '업데이트',
            message: `최신 버전입니다. (v${app.getVersion()})` });
        } else if (result.status === 'update-available') {
          dialog.showMessageBox({ type: 'info', title: '업데이트 발견',
            message: `새 버전 v${result.newVersion}이 있습니다.`,
            detail: '백그라운드에서 자동으로 다운로드됩니다.\n완료되면 트레이 알림으로 알려드립니다.' });
        } else if (result.status === 'dev-mode') {
          dialog.showMessageBox({ type: 'info', title: '업데이트',
            message: '개발 모드에서는 업데이트를 확인할 수 없습니다.' });
        } else {
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
    floatingToggleItem,
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuitting = true; app.quit(); } },
  ];
}

/** Rebuild the tray context menu and tooltip to reflect current updateState. */
function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed?.()) return;
  try {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayTemplate()));
    if (updateState === 'downloading') {
      tray.setToolTip(`nost — 업데이트 다운로드 중 ${updatePct}%`);
    } else if (updateState === 'downloaded') {
      tray.setToolTip(`nost — v${updateNewVersion} 업데이트 준비됨`);
    } else {
      tray.setToolTip('nost');
    }
  } catch (_) { /* tray destroyed mid-rebuild (e.g. during app quit) */ }
}

// ── 12. IPC Handlers ─────────────────────────────────────────────────
// Registered once inside createWindow() after mainWindow is created.
// Grouped by responsibility for easy navigation.

function registerIpcHandlers() {

  // ── 12a. App Lifecycle ────────────────────────────────────────────

  /** Hide the launcher window (e.g. after a card action). */
  ipcMain.on('hide-app', () => mainWindow.hide());

  /**
   * Move the window to an absolute screen position (right-click drag).
   *
   * Size-drift fix: rather than read `getBounds().width/height` on every move,
   * we latch the width/height at first drag frame and reuse it until the drag
   * ends. Reading getBounds() mid-drag can return DWM-rounded values that, when
   * fed back into setBounds, produce a one-pixel creep per frame — over many
   * frames the window noticeably grows. `window-drag-end` resets the cache so
   * subsequent resizes by the user are picked up.
   */
  let dragSizeCache = null;  // { width, height } | null
  ipcMain.on('window-move', (_, x, y) => {
    if (!mainWindow) return;
    if (!dragSizeCache) {
      const b = mainWindow.getBounds();
      dragSizeCache = { width: b.width, height: b.height };
    }
    mainWindow.setBounds({
      x: Math.round(x), y: Math.round(y),
      width: dragSizeCache.width, height: dragSizeCache.height,
    });
  });
  ipcMain.on('window-drag-end', () => { dragSizeCache = null; });

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

      // For .lnk files, Electron's app.getFileIcon() returns the generic
      // "shortcut arrow overlay" icon — useless. Resolve the shortcut's
      // IconLocation or TargetPath via a PS helper so we feed the real
      // source to getFileIcon and get the target app's actual icon.
      let iconSource = filePath;
      if (filePath.toLowerCase().endsWith('.lnk')) {
        try {
          const { stdout } = await runPsAsync('resolve-lnk-icon.ps1',
            { QL_PATH: filePath }, { timeout: 3000 });
          const resolved = String(stdout ?? '').trim();
          if (resolved && fs.existsSync(resolved)) {
            iconSource = resolved;
          }
        } catch { /* fall through to raw .lnk */ }
      }

      const icon = await app.getFileIcon(iconSource, { size: 'large' });
      return icon.toDataURL() || null;
    } catch { return null; }
  });

  /**
   * Fetch a website's favicon, normalize it, and return a data URL.
   *
   * Why main process and not the renderer:
   *   The renderer's CSP locks img-src to 'self', data:, and Google's favicon
   *   service. That made the existing tryLoadImage() loop in the renderer
   *   silently fail on every other candidate (apple-touch-icon / origin
   *   /favicon.ico / DuckDuckGo) — only the Google s2 hit ever loaded, and
   *   when Google returned a 1x1 placeholder for unknown domains the loop
   *   accepted it as "success" and saved a blank icon. Doing the fetch from
   *   main bypasses CSP entirely, lets us try every candidate, and lets us
   *   reject the 1x1 placeholder by inspecting the decoded image size.
   *
   * Returns: data URL string on first acceptable candidate, null if none.
   * The data URL is what gets persisted on the LauncherItem, so once a
   * favicon has been resolved it works offline forever (no re-fetch).
   */
  ipcMain.handle('download-favicon', async (_e, candidates) => {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    for (const url of candidates) {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;

      try {
        // 6s per-candidate timeout. Net.fetch follows redirects by default.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        let res;
        try {
          res = await net.fetch(url, { signal: controller.signal, redirect: 'follow' });
        } finally { clearTimeout(timer); }

        if (!res.ok) continue;
        const ab = await res.arrayBuffer();
        const buf = Buffer.from(ab);

        // Sanity bounds: smaller than 100B is almost certainly an HTML 404
        // page or empty body; larger than 1MB is a misconfigured server
        // sending a high-res asset we don't want to embed in a JSON store.
        if (buf.length < 100 || buf.length > 1_000_000) continue;

        // Decode and check actual image dimensions. Google's s2 service
        // returns a 16x16 grey placeholder when it doesn't know the domain
        // — that's the bug the renderer-side loop kept accepting. Anything
        // <= 4px is definitely placeholder; reject it and try the next
        // candidate. Note: nativeImage cannot decode SVG, so SVG favicons
        // come back empty here — we skip those for now (they're rare for
        // /favicon.ico anyway).
        const img = nativeImage.createFromBuffer(buf);
        if (img.isEmpty()) continue;
        const { width, height } = img.getSize();
        if (width <= 4 || height <= 4) continue;

        // Downsample anything over 128px to keep the persisted data URL
        // small. 64-128px is the sweet spot for our 36px card icons on
        // both DPI=1 and DPI=1.5 displays.
        const finalImg = (width > 128 || height > 128)
          ? img.resize({ width: 128, quality: 'best' })
          : img;
        return finalImg.toDataURL();
      } catch (e) {
        // AbortError on timeout, network errors, DNS failures — all just
        // mean "try the next candidate". Logged at debug to avoid spam.
        log.debug('[favicon] candidate failed', url, e?.message || e);
      }
    }
    return null;
  });

  ipcMain.handle('check-file-exists', (_, filePath) => {
    try { return fs.existsSync(filePath); } catch { return false; }
  });

  /**
   * Export the full AppData to a .nost file. JSON-encoded with a small
   * envelope (`format: 'nost'`, `formatVersion`) so future readers can
   * detect and migrate older shapes if we change the schema.
   *
   * The `.nost` extension is just for branding — internally it's UTF-8 JSON.
   * Legacy `.json` files written by pre-v1.3 builds are still accepted on
   * import.
   */
  ipcMain.handle('export-data', async () => {
    const data = store.get('appData', null);
    if (!data) return { success: false, reason: 'no-data' };
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'nost 백업',
      defaultPath: `nost-${new Date().toISOString().slice(0, 10)}.nost`,
      filters: [
        { name: 'nost backup', extensions: ['nost'] },
        { name: 'JSON',         extensions: ['json'] },
      ],
    });
    if (canceled || !filePath) return { success: false, reason: 'canceled' };
    try {
      const payload = {
        format: 'nost',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        data,
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return { success: true, filePath };
    } catch (e) { return { success: false, reason: String(e) }; }
  });

  /**
   * Import a backup. Accepts both the new envelope format and legacy raw
   * AppData (pre-v1.3 .json files). Returns the parsed AppData; the
   * renderer is responsible for deciding whether to REPLACE or MERGE.
   */
  ipcMain.handle('import-data', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: 'nost 백업 복원',
      filters: [
        { name: 'nost backup', extensions: ['nost', 'json'] },
      ],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { success: false, reason: 'canceled' };
    try {
      const raw = fs.readFileSync(filePaths[0], 'utf-8');
      const parsed = JSON.parse(raw);
      // Envelope format (v1.3+)
      if (parsed && parsed.format === 'nost' && parsed.data) {
        return { success: true, data: parsed.data, formatVersion: parsed.formatVersion ?? 1 };
      }
      // Legacy raw AppData — accept if it has either presets[] (post-1.2)
      // or spaces[] (pre-1.2 flat shape; renderer's migrateData handles it).
      if (parsed && (parsed.presets || parsed.spaces) && parsed.settings) {
        return { success: true, data: parsed, formatVersion: 0 };
      }
      return { success: false, reason: 'invalid-format' };
    } catch (e) { return { success: false, reason: String(e) }; }
  });

  /**
   * Silent auto-backup. Used by the tutorial sandbox before it swaps the
   * live AppData with seed content — the user reported losing their real
   * cards once when an experimental flow wiped state, so we now write a
   * timestamped .nost file to userData/tutorial-backups/ BEFORE the swap.
   * No dialog, no user friction. Returns { success, filePath } so the
   * renderer can show a toast pointing the user at the file if they want
   * to restore manually.
   *
   * Reason is a short tag ("tutorial", future "schema-migration") embedded
   * into the filename so users can tell backups apart at a glance.
   */
  ipcMain.handle('auto-backup-data', async (_e, reason = 'auto') => {
    const data = store.get('appData', null);
    if (!data) return { success: false, reason: 'no-data' };
    try {
      const dir = path.join(app.getPath('userData'), 'tutorial-backups');
      fs.mkdirSync(dir, { recursive: true });
      const stamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeTag  = String(reason).replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'auto';
      const filePath = path.join(dir, `nost-${safeTag}-${stamp}.nost`);
      const payload = {
        format: 'nost',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        backupReason: safeTag,
        data,
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return { success: true, filePath };
    } catch (e) { return { success: false, reason: String(e) }; }
  });

  /**
   * Open the user-data folder (or a subfolder) in the OS file explorer.
   * Used by the tutorial-backup toast so users can grab the .nost file
   * directly without spelunking through %APPDATA%.
   */
  ipcMain.handle('open-userdata-folder', async (_e, sub) => {
    try {
      const target = sub
        ? path.join(app.getPath('userData'), String(sub))
        : app.getPath('userData');
      shell.openPath(target);
      return { success: true };
    } catch (e) { return { success: false, reason: String(e) }; }
  });

  /**
   * Pick + read a file as raw text. Used by the import wizard to ingest
   * Chrome bookmarks HTML and Markdown without giving the renderer
   * filesystem access. Returns { text, fileName } on success.
   */
  ipcMain.handle('pick-and-read-text', async (_e, kind) => {
    const filters = kind === 'bookmarks-html'
      ? [{ name: '브라우저 북마크 HTML', extensions: ['html', 'htm'] }]
      : kind === 'markdown'
      ? [{ name: '마크다운', extensions: ['md', 'markdown', 'txt'] }]
      : [{ name: 'All', extensions: ['*'] }];
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '가져올 파일 선택',
      filters,
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { success: false, reason: 'canceled' };
    try {
      const text = fs.readFileSync(filePaths[0], 'utf-8');
      return { success: true, text, fileName: path.basename(filePaths[0]) };
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

    // Hex colour code — match `#abc`, `#abcdef`, `#AABBCC`, also bare
    // `abcdef` if surrounded by nothing else (people often copy from
    // dev tools without the `#`). Normalise to canonical `#RRGGBB`
    // uppercase so the renderer doesn't have to repeat the work.
    {
      const hexMatch = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(text);
      if (hexMatch) {
        const raw = hexMatch[1];
        const full = raw.length === 3
          ? raw.split('').map(c => c + c).join('')
          : raw;
        const norm = '#' + full.toUpperCase();
        return { type: 'hex', value: norm, label: norm };
      }
    }

    // Plain text fallback — anything that doesn't match the typed
    // formats above. We cap the suggested length at 200 chars (the
    // launcher card title is 1-2 lines tops; longer copy is almost
    // certainly a paragraph the user didn't intend to launcher-ify)
    // and also reject very-short single-token clips that are likely
    // accidental selections (less than 2 chars). No newlines either —
    // multi-line copies are usually code/email bodies.
    {
      if (text.length >= 2 && text.length <= 200 && !text.includes('\n')) {
        // Suggest as text-copy card. The label shows a preview; the
        // card type 'text' makes click-to-launch copy the full value
        // back to the clipboard, which is the existing nost text
        // card behaviour.
        const label = text.length > 32 ? text.slice(0, 32) + '…' : text;
        return { type: 'text', value: text, label };
      }
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
      // Defensive: even if runPsAsync's encoding guard fails for any reason,
      // never crash the handler — coerce to string here too.
      const out = String(stdout ?? '').trim();
      const upper = out.toUpperCase();

      // PS script outputs "ERROR: ..." when every launch attempt failed.
      // Surface that back to the renderer so the toast says something
      // useful instead of the misleading "launched" placeholder.
      if (upper.startsWith('ERROR')) {
        const msg = out.replace(/^ERROR:\s*/i, '');
        log.warn(`[launch-or-focus-app] ${exePath} → ${msg}`);
        return { success: false, error: msg };
      }

      log.debug(`[launch-or-focus-app] ${exePath} → ${out}`);
      return { success: true, action: upper.includes('FOCUSED') ? 'focused' : 'launched' };
    } catch (err) {
      log.warn(`[launch-or-focus-app] PS threw: ${err.message}`);
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
      // Snap honours the item's saved monitor preference when set
      const monitorIdx = (item && typeof item.monitor === 'number') ? item.monitor : 0;
      await runPsAsync('snap-window.ps1', {
        QL_ITEM: JSON.stringify(item),
        QL_ZONE: zone,
        ...monitorEnvFor(monitorIdx),
      }, { timeout: 10000 });
      return { success: true };
    } catch { return { success: false }; }
  });

  ipcMain.handle('maximize-window', async (_, { item, monitor = 0 }) => {
    try {
      const { stdout } = await runPsAsync('maximize-window.ps1', {
        QL_ITEM: JSON.stringify(item),
        ...monitorEnvFor(monitor),
      }, { timeout: 10000 });
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

    // Diagnostic: log Electron's view of ALL monitors + the physical pixel
    // values monitorEnvFor is going to hand to PS. Matching these against
    // the PS-side `[diag] mon#N bounds=...` lines makes DPI bugs obvious.
    try {
      const screen = getScreen();
      const displays = screen.getAllDisplays();
      log.debug(`[tile] electron-displays count=${displays.length} requestedMonitor=${monitor}`);
      displays.forEach((d, i) => {
        log.debug(`[tile] electron-mon#${i + 1} id=${d.id} primary=${d.id === screen.getPrimaryDisplay().id} bounds=(${d.bounds.x},${d.bounds.y},${d.bounds.width}x${d.bounds.height}) work=(${d.workArea.x},${d.workArea.y},${d.workArea.width}x${d.workArea.height}) scale=${d.scaleFactor}`);
      });
      const env = monitorEnvFor(monitor);
      log.debug(`[tile] electron-wa-dip=(${wa.x},${wa.y},${wa.width}x${wa.height}) → physical QL_SCREEN=(${env.QL_SCREEN_X},${env.QL_SCREEN_Y},${env.QL_SCREEN_W}x${env.QL_SCREEN_H})`);
    } catch (e) { log.warn(`[tile] diagnostic logging failed: ${e.message}`); }

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
      ...monitorEnvFor(monitor),
      QL_ITEMS: JSON.stringify(flagged),
    }, {
      timeout: 60000,  // PS's internal deadline is 45s + settle passes; breathing room
      // Stream each PS stdout line into the main log as it's emitted
      // (instead of waiting for PS to exit). When the tile pipeline is slow
      // — e.g. waiting for Office splash window — this lets us distinguish
      // "still searching" from "hung" in real time instead of staring at a
      // silent log for 45 s and assuming tiling failed.
      onLine: (line) => log.debug(`[tile/ps] ${line}`),
    })
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
        try {
          await runPsAsync('tile-windows.ps1', {
            ...monitorEnvFor(0),
            QL_ITEMS: JSON.stringify(identifiers),
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

  // ── 12j-b. Floating orb (Phase 1 MVP) ────────────────────────────
  //
  // Messages originate from the isolated floating BrowserWindow and never
  // touch mainWindow's renderer, so they live in their own sub-section.

  /** Orb left-click → toggle the main launcher (same as the global shortcut). */
  ipcMain.on('floating-toggle-main', () => toggleMainWindow());

  /** Orb right-click → native context menu rooted at the orb. */
  ipcMain.on('floating-context-menu', () => {
    if (!floatingWindow || floatingWindow.isDestroyed()) return;
    const menu = Menu.buildFromTemplate([
      { label: 'nost 토글',   click: () => toggleMainWindow() },
      { label: '설정 열기',   click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('floating-open-settings');
      } },
      { type: 'separator' },
      { label: '플로팅 버튼 숨기기', click: () => setFloatingEnabled(false) },
    ]);
    menu.popup({ window: floatingWindow });
  });

  /**
   * Renderer reports the pointer has moved past the dead-zone — start the
   * cursor-pinning loop. Any previous session is torn down first so repeated
   * drags can't leak intervals.
   *
   * Stability notes:
   *  - 30 Hz polling (33 ms) instead of 60 Hz. Fast enough that users can't
   *    perceive lag, slow enough that setBounds can't chain into a feedback
   *    loop with Windows' cursor tracking.
   *  - Stationary dead-zone: if cursor moved < 1 DIP from the last sampled
   *    point we skip setBounds entirely. This eliminates sub-pixel drift
   *    where OS-reported cursor jitters by fractional pixels even when the
   *    user's hand is perfectly still.
   *  - Last sampled point persists across the session so drift can't sneak
   *    in via rounding between ticks.
   */
  ipcMain.on('floating-drag-start', (_, clientX, clientY) => {
    if (!floatingWindow || floatingWindow.isDestroyed()) return;

    // Tear down any lingering session (shouldn't happen — belt & suspenders).
    endFloatingDrag(/* persist */ false);

    floatingDragOffset = { ox: Math.round(clientX), oy: Math.round(clientY) };

    // Initial cursor & window snapshot so we can detect sub-pixel jitter.
    const initialPt   = getScreen().getCursorScreenPoint();
    let lastPt        = initialPt;
    let tickCount     = 0;
    log.debug(`[orb] drag-start offset=(${floatingDragOffset.ox},${floatingDragOffset.oy}) cursor=(${initialPt.x},${initialPt.y})`);

    floatingDragInterval = setInterval(() => {
      if (!floatingWindow || floatingWindow.isDestroyed() || !floatingDragOffset) return;

      const pt = getScreen().getCursorScreenPoint();

      // Dead-zone: ignore movement under 1 DIP. This is the fix for the
      // "drag, then hold still, orb slides" bug caused by driver-level jitter.
      // The dead-zone alone (not the polling rate) is what stops the slide,
      // so we run at 60 Hz for responsiveness during fast shakes.
      const dx = Math.abs(pt.x - lastPt.x);
      const dy = Math.abs(pt.y - lastPt.y);
      if (dx < 1 && dy < 1) return;
      lastPt = pt;
      tickCount++;

      const [w, h] = floatingWindow.getSize();
      floatingWindow.setBounds({
        x: Math.round(pt.x - floatingDragOffset.ox),
        y: Math.round(pt.y - floatingDragOffset.oy),
        width: w, height: h,
      });

      // Throttle log output: first 2 ticks + every 60th thereafter.
      if (tickCount <= 2 || tickCount % 60 === 0) {
        log.debug(`[orb] tick#${tickCount} cursor=(${pt.x},${pt.y}) → win=(${pt.x - floatingDragOffset.ox},${pt.y - floatingDragOffset.oy})`);
      }
    }, 16);  // ≈60 Hz

    floatingDragWatchdog = setTimeout(() => {
      log.debug('[orb] watchdog: heartbeat lost — ending drag');
      endFloatingDrag(true);
    }, 500);
    floatingDragCeiling = setTimeout(() => {
      log.debug('[orb] ceiling: 60s limit — ending drag');
      endFloatingDrag(true);
    }, 60_000);
  });

  /** Renderer heartbeat — refresh the watchdog so the drag stays alive. */
  ipcMain.on('floating-drag-heartbeat', () => {
    if (floatingDragWatchdog) clearTimeout(floatingDragWatchdog);
    if (!floatingDragInterval) return;  // no active drag — ignore stale heartbeat
    floatingDragWatchdog = setTimeout(() => {
      log.debug('[orb] watchdog: heartbeat lost — ending drag');
      endFloatingDrag(true);
    }, 500);
  });

  /** Normal drag end — renderer got pointerup/pointercancel. */
  ipcMain.on('floating-drag-end', () => {
    log.debug('[orb] drag-end (normal)');
    endFloatingDrag(true);
  });

  /** Renderer writes to quicklauncherData.settings.floatingButton → tell us to sync. */
  ipcMain.on('floating-settings-updated', () => {
    syncFloatingWindow();
    refreshFloatingVisuals();
  });

  // ── 12j-bis. Floating badges overlay (Phase 2) ────────────────────

  /** Main renderer commits store.floatingBadges → refresh the overlay. */
  ipcMain.on('badges-sync', () => syncBadgeOverlay());

  /**
   * Pin a space/node/deck as a floating badge. Called from the main renderer
   * after the user clicks the "float" action or throws a card out of the
   * main window.
   *
   * `screenX/screenY` is the desired landing position in screen coords. If
   * the caller doesn't know (e.g. the action came from a keyboard shortcut),
   * pass null/undefined and we place near the bottom-right of the primary.
   */
  ipcMain.handle('badges-pin', (_e, { refType, refId, screenX, screenY }) => {
    if (!refType || !refId) return { success: false, reason: 'missing-ref' };
    const bounds = getScreen().getPrimaryDisplay().workArea;
    const defaultX = bounds.x + bounds.width  - 120;
    const defaultY = bounds.y + bounds.height - 120;
    const id = `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    mutateBadges(list => {
      // Prevent duplicate pins of the same ref.
      if (list.some(b => b.refType === refType && b.refId === refId)) return list;
      list.push({
        id, refType, refId,
        x: Number.isFinite(screenX) ? screenX : defaultX,
        y: Number.isFinite(screenY) ? screenY : defaultY,
      });
      return list;
    });
    return { success: true, id };
  });

  /** Mini-window → launch a single item. Forwards to the main renderer so
   *  the full launch pipeline (polling, positioning, slow-notice toast) runs
   *  exactly as if the user clicked the card in the main grid. */
  ipcMain.on('badges-launch-item', (_e, payload) => {
    if (!payload || !payload.refType || !payload.refId || !payload.itemId) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Don't show/focus main — the mini-window is meant to be a focused mini
    // launcher that doesn't disturb the user's current layout.
    sendSafe('badges-launch-item', payload);
  });

  /** Mini-window → launch a whole node/deck group. */
  ipcMain.on('badges-launch-ref', (_e, payload) => {
    if (!payload || !payload.refType || !payload.refId) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    sendSafe('badges-launch-ref', payload);
  });

  /** Overlay sends this when the user drops a badge back inside the main
   *  window OR right-clicks → unpin. */
  ipcMain.on('badges-unpin', (_e, badgeId) => {
    mutateBadges(list => list.filter(b => b.id !== badgeId));
  });

  /** Overlay sends this when a drag ends outside the main window. */
  ipcMain.on('badges-reposition', (_e, badgeId, x, y) => {
    mutateBadges(list => list.map(b =>
      b.id === badgeId ? { ...b, x: Math.round(x), y: Math.round(y) } : b
    ));
  });

  /**
   * Overlay's React tree finished mounting — re-push state so it
   * gets seen even if our `ready-to-show` push fired before the
   * React `useEffect` registered its listener. (Bug we hit: first
   * promote-to-badge didn't render because of that race; second
   * promote re-pushed and both became visible at once.)
   *
   * Cheap to handle multiple times if the renderer over-asks.
   */
  ipcMain.on('badges-request-state', () => {
    pushBadgeState();
  });

  /** Overlay flips its click-through mode as the pointer enters/leaves badges. */
  ipcMain.on('badges-set-capture', (_e, capture) => {
    if (!badgeOverlay || badgeOverlay.isDestroyed()) return;
    if (capture) {
      badgeOverlay.setIgnoreMouseEvents(false);
    } else {
      badgeOverlay.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  /** Overlay asks whether a screen point is inside the main nost window —
   *  used for the "drag-back-to-unpin" gesture. */
  ipcMain.handle('badges-is-inside-main', (_e, x, y) => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
    const b = mainWindow.getBounds();
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  });

  /** Overlay right-click → show a native context menu anchored at cursor. */
  ipcMain.on('badges-context-menu', (_e, badgeId) => {
    if (!badgeOverlay || badgeOverlay.isDestroyed()) return;
    const menu = Menu.buildFromTemplate([
      {
        label: '실행',
        click: () => {
          const data = store.get('appData') || {};
          const b = (data.floatingBadges || []).find(x => x.id === badgeId);
          if (!b) return;
          // For space: open main window and scroll to it. For node/deck:
          // fire the group launch directly.
          if (b.refType === 'space') {
            if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
            mainWindow?.focus();
            sendSafe('badges-reveal-space', { refId: b.refId });
          } else {
            sendSafe('badges-launch-ref', { refType: b.refType, refId: b.refId });
          }
        },
      },
      { type: 'separator' },
      {
        label: '플로팅 해제',
        click: () => mutateBadges(list => list.filter(b => b.id !== badgeId)),
      },
      {
        label: '모든 플로팅 해제',
        click: () => mutateBadges(() => []),
      },
    ]);
    menu.popup({ window: badgeOverlay });
  });

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

  // ── 12k. Media widget — write side ──────────────────────────────────
  //
  // The widget is a control surface: media keys go out (play/pause,
  // next, prev, vol +/-, mute) and that's it. The read side
  // (NowPlaying via SMTC) was dropped after a freeze regression —
  // see media-controller.js for the longer note. We keep the module
  // loaded so init() binds koffi to user32.dll once, then commands
  // route through `media.command(action)` synchronously.
  const media = require('./media-controller');
  media.init();

  ipcMain.on('media-command', (_e, action) => {
    if (typeof action !== 'string') return;
    media.command(action);
  });

  /**
   * "Click the media widget" → focus whatever browser tab is
   * currently making sound. We use the nost-bridge extension's
   * tab list (already pushed to global.chromeTabs on every tab
   * event in the browser). Tabs marked `audible: true` and not
   * `muted: true` are candidates; first match wins.
   *
   * Returns the focused tab descriptor when we were able to dispatch
   * a focus action, or null otherwise (no audible tab found, or
   * the extension isn't connected so SSE has nowhere to land).
   *
   * Limitation: only covers Chromium-based browsers with the
   * extension installed. Native media apps (Spotify desktop, etc.)
   * aren't visible to us — that path needs SMTC / WASAPI which we
   * deliberately punted on after the freeze regression.
   */
  ipcMain.handle('media-focus-source', () => {
    const tabs = global.chromeTabs || [];
    const audible = tabs.find(t => t.audible && !t.muted);
    if (!audible) return null;
    if (!sseConnection) return null; // extension not connected
    sendSse({ action: 'focus', tabId: audible.id, windowId: audible.windowId });
    return { tabId: audible.id, title: audible.title, url: audible.url };
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

  // Spawn the floating orb if the user has it enabled. Delayed a tick so
  // the main window initializes first — avoids a perceived double-flash.
  setTimeout(() => syncFloatingWindow(), 200);

  // Restore floating badges if any were pinned in a previous session.
  setTimeout(() => syncBadgeOverlay(), 300);

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
  // Badge overlay spans the virtual desktop — resize it when displays change.
  screen.on('display-added',           () => syncBadgeOverlay());
  screen.on('display-removed',         () => syncBadgeOverlay());
  screen.on('display-metrics-changed', () => syncBadgeOverlay());

  // ── Auto-updater (packaged builds only) ──────────────────────────
  if (app.isPackaged) {
    autoUpdater.logger               = null;  // suppress verbose internal logging
    autoUpdater.autoDownload         = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      updateNewVersion = info.version;
      updateState      = 'downloading';
      sendSafe('update-available', { version: info.version });
      rebuildTrayMenu();
    });

    autoUpdater.on('download-progress', (info) => {
      updateState = 'downloading';
      updatePct   = Math.round(info.percent);
      sendSafe('update-download-progress', { percent: updatePct });
      rebuildTrayMenu();
    });

    autoUpdater.on('update-downloaded', (info) => {
      updateNewVersion = info.version;
      updateState      = 'downloaded';
      updatePct        = 100;
      sendSafe('update-downloaded', { version: info.version });
      rebuildTrayMenu();

      // Balloon notification so the user sees the result even if the app is hidden
      try {
        tray?.displayBalloon({
          title:   'nost 업데이트 준비됨',
          content: `v${info.version}이 다운로드됐습니다.\n트레이 아이콘 우클릭 → 재시작하여 설치`,
          iconType: 'info',
        });
      } catch (_) { /* balloon not supported on all Windows versions */ }
    });

    // Reset UI state if the download fails
    autoUpdater.on('error', () => {
      updateState = 'idle';
      sendSafe('update-download-progress', null);
      rebuildTrayMenu();
    });

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
  rebuildTrayMenu();
  // Route through toggleMainWindow so a stale click during app quit doesn't
  // crash with "Object has been destroyed" — the helper guards destroyed
  // windows, handles GPU backing recovery, and keeps the orb layered above.
  tray.on('click', () => toggleMainWindow());

  // macOS: re-create window when dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Flag set BEFORE the quit cascade so late events (tray click, shortcut,
  // IPC) can bail early instead of racing against destroyed windows.
  app.isQuitting = true;
  // Destroy the tray first — its native message loop can fire a 'click'
  // after mainWindow is gone, which is the source of the
  // "Object has been destroyed at Tray.<anonymous>" uncaught exception.
  if (tray && !tray.isDestroyed?.()) {
    try { tray.removeAllListeners(); tray.destroy(); } catch (_) {}
    tray = null;
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();

  // Destroy the SSE socket immediately so the Chrome extension reconnects quickly
  if (sseConnection) { sseConnection.destroy(); sseConnection = null; }
  extServer.close();

  // Stop any in-flight orb drag and close the orb window so it doesn't
  // linger as a zombie tray item.
  endFloatingDrag(/* persist */ false);
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.destroy();

  // Drop SMTC subscriptions — without this the native binding can hold
  // its event source alive past process exit, occasionally producing
  // an "object accessed after destroy" log on shutdown.
  try { require('./media-controller').destroy(); } catch (_) {}
});
