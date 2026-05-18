// ╔══════════════════════════════════════════════════════════════════╗
// ║  nost — Electron Main Process                                    ║
// ║  D:\01_개인\06. launcher\main.js                                 ║
// ╚══════════════════════════════════════════════════════════════════╝

'use strict';

// ── 0. Sentry init (must be FIRST so we capture early errors) ────────
// DSN comes from env (SENTRY_DSN) — no DSN = noop (safe in dev or
// when the user opted out). Errors auto-captured from main + renderer
// processes with breadcrumbs. Lightweight — adds ~80 KB to main bundle.
const Sentry = require('@sentry/electron/main');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: require('./package.json').version,
    environment: process.env.NODE_ENV || 'production',
    // Don't sample performance traces by default — opt-in via env
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_RATE || '0'),
    // Strip safeStorage encrypted blobs and other potentially sensitive
    // payloads before they leave the device.
    beforeSend(event) {
      // Drop stored auth tokens that may sneak into breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.filter(b => {
          const msg = String(b.message ?? '').toLowerCase();
          return !msg.includes('authsessionenc') && !msg.includes('access_token');
        });
      }
      return event;
    },
  });
}

// ── 1. Requires & Store ──────────────────────────────────────────────
const {
  app, BrowserWindow, globalShortcut, ipcMain, shell, clipboard,
  Tray, Menu, nativeImage, dialog, session, net, desktopCapturer,
  safeStorage,
} = require('electron');
const path            = require('node:path');
const { exec, spawn } = require('child_process');
const fs              = require('fs');
const http            = require('http');
const Store           = require('electron-store');
const { autoUpdater } = require('electron-updater');
const log             = require('electron-log/main');
const foregroundWindow = require('./foreground-window');

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

// ── Perf tracker (v1.3.39) ──────────────────────────────────────────
// Lightweight call counters flushed every 10s as a single log line per
// category. Active in every build — overhead is ~80ns per increment so
// even at 1000 IPC calls/s the cost is well under 0.01% CPU.
//
// Categories:
//   [perf] ipc      — IPC channel call counts (wraps ipcMain.handle/on)
//   [perf] store    — electron-store.set call counts + byte volume
//   [perf] timers   — known interval-driven ticks (dialog-poll, etc)
//   [perf] render   — renderer-side React render counts (pushed via IPC)
//
// To analyse: tail %APPDATA%/nost/logs/main.log and grep '[perf]'.
const PERF_FLUSH_MS = 10000;
const perfIpc = new Map();         // channel → { count, totalMs }
const perfStoreSet = new Map();    // key → count
const perfStoreBytes = { total: 0 };
const perfTimers = new Map();      // label → count
const perfRender = new Map();      // component → count (filled via IPC)

function perfBumpIpc(channel, durationMs) {
  const cur = perfIpc.get(channel) || { count: 0, totalMs: 0 };
  cur.count++;
  cur.totalMs += durationMs;
  perfIpc.set(channel, cur);
}
function perfBumpStore(key, payloadBytes) {
  perfStoreSet.set(key, (perfStoreSet.get(key) || 0) + 1);
  perfStoreBytes.total += payloadBytes;
}
function perfBumpTimer(label) {
  perfTimers.set(label, (perfTimers.get(label) || 0) + 1);
}

// Wrap ipcMain.handle / ipcMain.on at registration time. Done once
// here so every handler registered downstream is auto-instrumented.
const _origHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  _origHandle(channel, async (...args) => {
    const t0 = Date.now();
    try { return await handler(...args); }
    finally { perfBumpIpc(channel, Date.now() - t0); }
  });
};
const _origOn = ipcMain.on.bind(ipcMain);
ipcMain.on = (channel, listener) => {
  _origOn(channel, (...args) => {
    const t0 = Date.now();
    try { listener(...args); }
    finally { perfBumpIpc(channel, Date.now() - t0); }
  });
};

// Wrap store.set so [perf] store-set surfaces the hottest key. Note:
// electron-store doesn't expose a generic mutation hook, so we proxy.
const _origStoreSet = store.set.bind(store);
store.set = (key, value) => {
  let bytes = 0;
  try { bytes = JSON.stringify(value ?? '').length; } catch { /* circular — skip */ }
  perfBumpStore(typeof key === 'string' ? key : '(object)', bytes);
  return _origStoreSet(key, value);
};

// Renderer-side counts pour in via this IPC.
ipcMain.on('perf:renderer-report', (_e, payload) => {
  if (!payload || typeof payload !== 'object') return;
  for (const [name, count] of Object.entries(payload)) {
    perfRender.set(name, (perfRender.get(name) || 0) + Number(count || 0));
  }
});

// 10s flush. Each non-empty bucket emits one summary line.
setInterval(() => {
  if (perfIpc.size > 0) {
    const sorted = [...perfIpc.entries()].sort((a, b) => b[1].count - a[1].count);
    const top = sorted.slice(0, 12)
      .map(([ch, s]) => `${ch}×${s.count}(${Math.round(s.totalMs / Math.max(1, s.count))}ms)`)
      .join(' ');
    log.info(`[perf] ipc(10s): ${top}`);
    perfIpc.clear();
  }
  if (perfStoreSet.size > 0) {
    const total = [...perfStoreSet.values()].reduce((a, b) => a + b, 0);
    const sorted = [...perfStoreSet.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 3).map(([k, v]) => `${k}×${v}`).join(' ');
    log.info(`[perf] store-set(10s): total=${total} kb=${(perfStoreBytes.total / 1024).toFixed(1)} ${top}`);
    perfStoreSet.clear();
    perfStoreBytes.total = 0;
  }
  if (perfTimers.size > 0) {
    const top = [...perfTimers.entries()].map(([k, v]) => `${k}×${v}`).join(' ');
    log.info(`[perf] timers(10s): ${top}`);
    perfTimers.clear();
  }
  if (perfRender.size > 0) {
    const sorted = [...perfRender.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 12).map(([n, c]) => `${n}×${c}`).join(' ');
    log.info(`[perf] render(10s): ${top}`);
    perfRender.clear();
  }
}, PERF_FLUSH_MS);

// ── 2. Module-level globals ──────────────────────────────────────────
let mainWindow;
// Hot cache of the user's preferred launcher size as a % of the
// active display's work area (25..100). Read once from electron-store
// at app ready, mutated by every code path that resizes the launcher
// (slash `/N`, status-bar slider, settings preset, IPC), applied at
// cold-start window creation AND on every show (so a settings change
// while hidden takes effect on the next pop-in).
let cachedWindowSizePct = 100;
// Renderer-controlled suppression of automatic dismissals. Multiple
// independent sources can request suppression (clean mode, active
// tutorial, …); ref-counted via a Set so source A's release doesn't
// cancel source B's still-active need.
const suppressAutoHideSources = new Set();

// Hot cache of autoHide setting. Renderer pushes via setAutoHide IPC
// on every settings save → blur handler reads from cache, no disk
// roundtrip per event. Initialised from disk in createMainWindow.
let cachedAutoHide = false;
// Hot cache of "where should the launcher reappear?" setting. Same
// pattern as cachedAutoHide — initialised from disk on createWindow,
// pushed by renderer via 'set-window-open-at' IPC whenever the user
// changes the dropdown in Settings. Two valid values:
//   'cursor' (default) → moveToCursorMonitor + centre on that screen
//   'last'             → setBounds back to lastUserPosition (if known)
let cachedWindowOpenAt = 'cursor';
// Last user-visible bounds (x/y/width/height) — captured on hide so
// the 'last' open-at mode can restore them. width/height already live
// in `windowBounds` storage; we keep position in-memory only by default
// (cold start still centres) and persist on hide so a graceful quit
// retains position for the next launch.
let lastUserPosition = null;

/**
 * Single dismissal policy. EVERY automatic hide path funnels here.
 *
 * Reasons:
 *   'blur'         — focus lost, autoHide setting respected
 *   'close-after'  — card launched with closeAfterOpen, ditto
 *
 * Explicit user-initiated hides (Esc / X button / global toggle
 * shortcut / screen picker) bypass this and call mainWindow.hide()
 * directly — the user clearly meant to dismiss, no policy negotiation.
 *
 * Returns true if hide was performed.
 */
function tryDismissWindow(reason, opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (suppressAutoHideSources.size > 0) {
    log.debug(`[dismiss] reason=${reason} skipped — suppress sources: [${Array.from(suppressAutoHideSources).join(',')}]`);
    return false;
  }
  if (reason === 'blur' && !cachedAutoHide) return false;
  if (reason === 'close-after' && !opts.closeAfter) return false;

  const delay = opts.delayMs ?? 0;
  const fire = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    log.debug(`[dismiss] reason=${reason} → hide`);
    mainWindow.hide();
  };
  if (delay > 0) setTimeout(fire, delay);
  else fire();
  return true;
}

function maybeCloseAfter(closeAfter, delayMs = 0) {
  if (!closeAfter) return;
  tryDismissWindow('close-after', { closeAfter: true, delayMs });
}

/**
 * Reassert top-most z-order after an external app launch. On Windows,
 * SetForegroundWindow from a freshly-launched process can shove a
 * topmost window below until the user re-focuses it. We delay so the
 * external window has time to actually appear before we re-claim the
 * top, and bail if user closed nost in the interim (closeAfter true).
 */
function reassertTopAfterLaunch(closeAfter) {
  if (closeAfter) return; // user opted to dismiss after launch — leave alone
  if (!mainWindow || mainWindow.isDestroyed()) return;
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    try {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.moveTop();
    } catch (e) { log.debug('[reassert-top]', e?.message); }
  }, 250);
}

/**
 * Brief grace window after a user-initiated launch where we ignore
 * blur events. Rationale: when the user clicks a card with autoHide
 * ON and closeAfter OFF, the just-launched external window briefly
 * grabs foreground focus, fires blur on mainWindow, and the launcher
 * dismisses itself before the user even sees the result. The user's
 * mental model is "I clicked, but I didn't ask to close" — so we
 * suppress the next blur for a short window. closeAfter is still
 * honored separately via maybeCloseAfter, so opt-in dismissal still
 * works. See `plans/focus-state-audit.md` Issue 4.
 */
function armLaunchGrace(closeAfter, ms = 600) {
  if (closeAfter) return; // closeAfter path actively wants to hide — don't fight it
  suppressAutoHideSources.add('launch-grace');
  setTimeout(() => suppressAutoHideSources.delete('launch-grace'), ms);
}
let floatingWindow   = null;   // Phase 1 floating orb (always-on-top FAB)
// One BrowserWindow per display — keyed by display.id. The previous
// single-overlay-spans-all-displays design was broken on cross-DPI
// multi-monitor setups: Electron renders the window at the home
// display's DPR, then the OS maps those pixels 1:1 onto the other
// display, producing the wrong physical size and hence visible
// clipping/scaling on secondaries. Per-display overlays sidestep the
// problem entirely — each window's DPR matches its own display, so
// CSS pixels align with physical pixels exactly on every screen.
const badgeOverlays  = new Map();
let dialogPopupWin   = null;   // Save-As dialog companion popup
let dialogPollTimer  = null;   // setInterval handle for dialog detection
let dialogTrackedHwnd = 0;     // last seen dialog HWND so we can detect "still the same dialog" vs "different one"
let dialogDismissedHwnd = 0;   // user clicked ✕ for THIS dialog — don't show until they open a different one
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

// ── PS-unaware work-area cache ──────────────────────────────────────
//
// Why this exists: every `run-tile-ps.ps1` invocation pays ~250-400 ms
// just to `Add-Type -AssemblyName System.Windows.Forms` and enumerate
// `[System.Windows.Forms.Screen]::AllScreens` so it can compute work
// areas in DPI-unaware coordinates (which differ from Electron's DIP
// coords on cross-DPI multi-monitor setups — see monitorEnvFor's
// comment block). Those numbers don't change between tile calls UNLESS
// the user's display configuration changes — plugging/unplugging a
// monitor, swapping primary, changing scale factor, rotating, etc.
//
// So we cache them keyed by monitorIndex, capture them from the first
// real PS run via the existing onLine stream, and serve them as env
// vars on every subsequent run. Both the script header (diagnostic
// block) and `Get-NativeWorkArea` then take a fast path that doesn't
// touch System.Windows.Forms at all.
//
// Robustness: Electron's `screen` module emits the three events below
// whenever Windows reports any layout change. We clear the entire
// cache on any of them — the next tile call pays the enumeration cost
// once to repopulate, then we're cheap again. This means a freshly-
// plugged monitor is correctly tiled to without manual restart.
const psWorkAreaCache = new Map();   // monitorIndex (number) → { X, Y, W, H }
let psCacheLogged = false;           // suppress repeat "cache cleared" lines

function clearPsWorkAreaCache(reason) {
  if (psWorkAreaCache.size === 0) return;
  psWorkAreaCache.clear();
  if (!psCacheLogged) {
    log.debug(`[tile-cache] cleared (${reason}) — next tile will repopulate from PS`);
    psCacheLogged = true;
    setTimeout(() => { psCacheLogged = false; }, 500);  // re-arm after burst settles
  }
}

// Wire screen events as soon as Electron's app is ready. Wrapped in a
// function so we can call it from app.whenReady (where `screen` is
// guaranteed initialized) without polluting module load order.
function bindMonitorChangeInvalidator() {
  try {
    const sc = getScreen();
    sc.on('display-added',           (_e, d) => clearPsWorkAreaCache(`display-added id=${d?.id}`));
    sc.on('display-removed',         (_e, d) => clearPsWorkAreaCache(`display-removed id=${d?.id}`));
    sc.on('display-metrics-changed', (_e, d, changed) => clearPsWorkAreaCache(`display-metrics-changed id=${d?.id} changed=${(changed||[]).join(',')}`));
  } catch (e) {
    log.warn('[tile-cache] could not bind screen events:', e?.message);
  }
}

/**
 * ONE place that prepares the env block for EVERY PS window placement call.
 *
 * ── Coordinate system reality (2026-04 update) ──────────────────────
 * The earlier comment claimed Electron DIP and DPI-unaware PS shared a
 * coord system. They DON'T, in cross-DPI multi-monitor setups:
 *
 *   Setup: primary 1920×1080 @ 125%, secondary 1920×1080 @ 100%, side-by-side
 *
 *   Electron DIP space (contiguous):
 *     mon#1 = (0..1536, 0..864)          ← 1920/1.25 = 1536
 *     mon#2 = (1536..3456, 0..1080)
 *
 *   DPI-unaware PS space (gap on secondary because Windows lays out the
 *   virtual canvas using PHYSICAL distances from primary's right edge):
 *     mon#1 = (0..1536, 0..864)
 *     gap   = (1536..1920) ← no monitor here
 *     mon#2 = (1920..3840, 0..1080)
 *
 *   So Electron's mon#2 DIP X=1536 lands in the GAP for PS, not on mon#2.
 *
 * Old fix (passing QL_SCREEN_X = electron DIP) accidentally worked when
 * primary scale = 100% (no gap) or only the primary was targeted. It
 * silently broke every cross-DPI secondary tile.
 *
 * New rule: PS queries its OWN enumeration for work-area coords (those
 * are already in the unaware coord space). We just tell PS WHICH monitor
 * via QL_MONITOR (index) + QL_MONITOR_PRIMARY (flag) for sanity check.
 * QL_SCREEN_* still emitted for diagnostic / legacy fallback.
 */
function monitorEnvFor(monitorIndex) {
  const screen   = getScreen();
  const displays = screen.getAllDisplays();
  const primary  = screen.getPrimaryDisplay();

  const disp = (monitorIndex >= 1 && monitorIndex <= displays.length)
    ? displays[monitorIndex - 1]
    : primary;
  const wa = disp.workArea;

  // QL_SCREEN_* are now DIP-space DIAGNOSTIC values. PS no longer treats
  // them as authoritative for placement — see _Position.ps1 Get-NativeWorkArea.
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
    // Diagnostic only — DIP coords. PS doesn't use these for placement.
    QL_SCREEN_X: String(physX),
    QL_SCREEN_Y: String(physY),
    QL_SCREEN_W: String(physW),
    QL_SCREEN_H: String(physH),
    // The actual selectors. PS picks the screen by index, then sanity-checks
    // that PS's enumeration agrees with Electron about whether it's primary.
    // If they disagree (rare — happens with rearranged displays), PS falls
    // back to searching by primary flag.
    QL_MONITOR:           String(monitorIndex ?? 0),
    QL_MONITOR_PRIMARY:   disp.id === primary.id ? 'True' : 'False',
    QL_MONITOR_DIP_X:     String(wa.x),
    QL_MONITOR_DIP_Y:     String(wa.y),
    QL_MONITOR_DIP_W:     String(wa.width),
    QL_MONITOR_DIP_H:     String(wa.height),
    QL_MONITOR_SCALE:     String(disp.scaleFactor),
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
    // Extension opens a long-lived SSE channel to receive commands.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':   'keep-alive',
      // Disable Node's default response timeout — SSE is meant to be
      // long-lived. Without this, some proxies / antivirus shims will
      // tear the stream down after the default ~2 min idle window.
      'X-Accel-Buffering': 'no',
    });
    // Make sure the socket itself doesn't get garbage-collected by a
    // keep-alive idle timeout on the Node http server. Same intent
    // as the header above; belt + suspenders.
    res.socket?.setKeepAlive?.(true, 15000);
    res.socket?.setTimeout?.(0);
    sseConnection = res;
    lastExtensionConnectedAt = Date.now();

    // Periodic heartbeat. SSE comment lines (start with `:`) are
    // ignored by every spec-compliant parser, so the extension's
    // ReadableStream reader sees a `read()` resolution every 15 s
    // but no `data:` event fires. That's enough to keep Chrome's
    // MV3 service worker classified as "active" — without it the
    // SW idles out after ~30 s of no traffic and Chrome terminates
    // it, taking any pending setTimeout reconnect with it. After
    // nost auto-update the user would then see the extension
    // permanently disconnected until they triggered some unrelated
    // tab event that woke the SW.
    const heartbeat = setInterval(() => {
      // Write only while the response is still writable. If the
      // socket closed between intervals we'd otherwise crash with
      // "write after end".
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      try { res.write(`: heartbeat ${Date.now()}\n\n`); }
      catch { clearInterval(heartbeat); }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      if (sseConnection === res) sseConnection = null;
    });
  } else if (req.url && req.url.startsWith('/auth/callback') && req.method === 'GET') {
    // OAuth loopback callback. Supabase 의 `redirectTo` 가 이쪽으로
    // 향하도록 변경됐기 때문에 `nost://` protocol handler 가 새
    // electron 인스턴스를 spawn 하는 문제가 사라진다. 동시에 외부
    // 브라우저에 깔끔한 "완료" HTML 을 직접 응답할 수 있어 사용자가
    // "supabase.co 로 이동 중..." 빈 페이지를 보지 않는다.
    try {
      const u = new URL(req.url, `http://127.0.0.1:${EXT_PORT}`);
      // Reuse handleDeepLink so the renderer-side auth state machine
      // gets the same shape it always has (code/access_token query
      // params + nost://auth-callback origin).
      const fakeUrl = `nost://auth-callback?${u.searchParams.toString()}`;
      handleDeepLink(fakeUrl);
      const ok = !!u.searchParams.get('code') || !!u.searchParams.get('access_token');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ok ? AUTH_DONE_HTML_OK : AUTH_DONE_HTML_ERR);
    } catch (err) {
      log.warn('[auth-loopback] callback handler failed:', err && err.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(AUTH_DONE_HTML_ERR);
    }
  } else {
    res.writeHead(404); res.end();
  }
});

// HTML responses for the OAuth loopback. Pure inline strings so they
// don't add a renderer round-trip or asset path concern. Inline CSS
// keeps it portable across browsers (and pretty even when offline).
const AUTH_DONE_HTML_OK = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>nost — 로그인 완료</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(160deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%);
    color: #e0e7ff;
  }
  .card {
    width: 360px; padding: 32px 28px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    backdrop-filter: blur(12px);
    text-align: center;
  }
  .check {
    width: 48px; height: 48px; margin: 0 auto 14px;
    border-radius: 50%; background: #10b981;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 28px; line-height: 1;
  }
  h1 { margin: 0 0 6px; font-size: 17px; font-weight: 700; }
  p  { margin: 0 0 4px; font-size: 12px; color: #c7d2fe; line-height: 1.6; }
  .hint { margin-top: 14px; font-size: 11px; color: #a5b4fc; opacity: 0.8; }
</style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>로그인 완료</h1>
    <p>nost 로 돌아가셔도 됩니다.</p>
    <p class="hint">이 탭은 잠시 후 자동으로 닫혀요.</p>
  </div>
  <script>setTimeout(function(){ window.close(); }, 1600);</script>
</body>
</html>`;

const AUTH_DONE_HTML_ERR = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>nost — 로그인 처리 중 문제</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    background: #1a1a1a; color: #fca5a5;
  }
  .card {
    width: 360px; padding: 32px 28px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(248,113,113,0.3);
    border-radius: 14px; text-align: center;
  }
  h1 { margin: 0 0 6px; font-size: 17px; font-weight: 700; color: #f87171; }
  p  { margin: 0; font-size: 12px; color: #fca5a5; line-height: 1.6; }
</style>
</head>
<body>
  <div class="card">
    <h1>로그인 처리 중 문제가 생겼어요</h1>
    <p>nost 로 돌아가 다시 시도해주세요.</p>
  </div>
</body>
</html>`;

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
  // Second-instance — let the primary handle the deep-link via the
  // 'second-instance' event Electron just fired for it. `app.quit()`
  // alone is async (it goes through before-quit / will-quit) and lets
  // the rest of this module keep running — including createWindow()
  // in app.whenReady(), which spawns a duplicate renderer + asar
  // re-load. That duplicate then "wins" because the primary thinks
  // it handed off, leaving the user with a dead renderer (the OAuth
  // round-trip's PKCE verifier lives in the primary's memory which
  // is now being torn down).
  //
  // `process.exit(0)` is the only synchronous way to guarantee the
  // module init halts here. We've already called app.quit() so any
  // briefly-created Electron internals get the cleanup signal too.
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    // Custom-scheme deep-link arrives here on Windows because the
    // already-running primary instance receives the OS launch via
    // single-instance lock. Look for the nost:// URL in argv.
    const deepLink = argv.find(a => typeof a === 'string' && a.startsWith('nost://'));
    if (deepLink) handleDeepLink(deepLink);
    if (mainWindow) {
      moveToCursorMonitor();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Custom URL Scheme: nost:// ──────────────────────────────────────
// Used for OAuth callbacks (Supabase auth → external browser →
// system hands the redirect back to us via this scheme). On Windows
// the OS launches a fresh exe with the URL in argv; the single-
// instance lock above forwards it to the running primary instance.
// On macOS the 'open-url' event delivers it directly.
if (process.defaultApp) {
  // Dev mode: the executable is electron.exe and the script is argv[1].
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('nost', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('nost');
}

app.on('open-url', (event, url) => {
  // macOS path
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(url) {
  // Parse fragment / query for OAuth tokens. Supabase returns tokens
  // either in the URL fragment (#access_token=…) or query, depending
  // on the flow. Forward whatever we get to the renderer; the auth
  // state machine there extracts what it needs and calls
  // supabase.auth.setSession.
  log.info('[deep-link]', url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('auth:deep-link', url);
  } else {
    // Stash for the renderer-ready event to consume
    pendingDeepLink = url;
  }
}
let pendingDeepLink = null;

// ── 8. Splash Window ─────────────────────────────────────────────────
// (removed) The external splash BrowserWindow used to be created here
// while mainWindow loaded its frontend. We unified onto a single
// loading surface: the in-window `#ql-loading` overlay defined in
// `frontend/index.html`. mainWindow is now shown on `ready-to-show`
// (same ~240 ms cold-start gate) so the user sees that overlay
// directly, with no two-stage transition. Recovery UI (restart /
// open-logs) lives inside the same overlay — see force-show-error
// IPC below and the `#ql-loading` markup in index.html.
// Stub: previously created an external glass splash BrowserWindow.
// We now rely solely on the in-window `#ql-loading` overlay (see
// frontend/index.html); mainWindow is shown on `ready-to-show` so
// the user sees that overlay directly. Function kept (no-op) so any
// stragglers calling it don't ReferenceError.
function createLoadingWindow() { /* no-op — unified onto #ql-loading */ }

// Dead code below preserved temporarily so commit history shows
// what the splash markup looked like; safe to delete in a follow-up.
function _unused_legacySplashMarkup() {  // eslint-disable-line no-unused-vars
  const loadingWindow = new BrowserWindow({
    // Match the rough proportions of the in-window #ql-loading overlay
    // (frontend/index.html). The user found phase 2's design more on-
    // brand, so phase 1 (this external splash) was redesigned to share
    // the same visual language: dark surface, square SVG logo, thin
    // 2-px progress bar — no light glassmorphism, no gradient text,
    // no spinner ring, no tips. Error-state retains its own buttons.
    width: 240, height: 180,
    show: true, frame: false, transparent: true,
    resizable: false, alwaysOnTop: true, skipTaskbar: true, center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-splash.js'),
    },
  });

  const html = encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:transparent;overflow:hidden;user-select:none}
body{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;
  height:100vh;
  background:rgba(5,5,8,0.97);
  border:1px solid rgba(255,255,255,0.07);
  border-radius:14px;
  font-family:'Pretendard Variable',Pretendard,'Segoe UI',system-ui,sans-serif;
  -webkit-app-region:drag;
}
.logo{
  width:40px;height:40px;border-radius:12px;
  background:rgba(99,102,241,0.12);
  border:1px solid rgba(99,102,241,0.2);
  display:flex;align-items:center;justify-content:center;
  -webkit-app-region:no-drag;
}
.bar-wrap{
  width:120px;height:2px;border-radius:99px;
  background:rgba(255,255,255,0.06);overflow:hidden;
}
.bar{
  height:100%;width:0%;border-radius:99px;
  background:rgba(99,102,241,0.7);
  animation:bar-init 1.2s cubic-bezier(0.4,0,0.2,1) forwards;
}
@keyframes bar-init{from{width:0%}to{width:35%}}
.text{font-size:12px;color:rgba(255,255,255,0.3);letter-spacing:0.02em}
.err-msg{font-size:11px;color:rgba(248,113,113,0.92);text-align:center;line-height:1.5;padding:0 14px}
.err-actions{display:flex;gap:8px;-webkit-app-region:no-drag}
.btn{
  font-family:inherit;font-size:11px;padding:6px 12px;border-radius:6px;
  border:1px solid rgba(255,255,255,0.08);
  background:rgba(255,255,255,0.04);
  color:rgba(255,255,255,0.7);cursor:pointer;font-weight:500;
}
.btn:hover{background:rgba(99,102,241,0.16);border-color:rgba(99,102,241,0.35)}
.btn.primary{
  background:rgba(99,102,241,0.7);color:#fff;border-color:transparent;
}
.btn.primary:hover{background:rgba(99,102,241,0.85)}
.hidden{display:none}
</style></head>
<body>
  <div id="loading-state" style="display:flex;flex-direction:column;align-items:center;gap:20px">
    <div class="logo">
      <svg width="22" height="22" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M 116 418 L 116 196 Q 116 88 256 88 Q 396 88 396 196 L 396 418 L 326 418 L 326 212 Q 326 158 256 158 Q 186 158 186 212 L 186 418 Z" fill="rgba(99, 102, 241, 0.9)"/>
      </svg>
    </div>
    <div class="bar-wrap"><div class="bar"></div></div>
    <div class="text">불러오는 중...</div>
  </div>
  <div id="error-state" class="hidden" style="flex-direction:column;align-items:center;gap:14px">
    <div class="logo">
      <svg width="22" height="22" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M 116 418 L 116 196 Q 116 88 256 88 Q 396 88 396 196 L 396 418 L 326 418 L 326 212 Q 326 158 256 158 Q 186 158 186 212 L 186 418 Z" fill="rgba(248, 113, 113, 0.9)"/>
      </svg>
    </div>
    <div class="err-msg">앱이 시작되지 못했어요.<br>네트워크 또는 데이터 폴더 문제일 수 있어요.</div>
    <div class="err-actions">
      <button class="btn" id="btn-logs">로그 보기</button>
      <button class="btn primary" id="btn-restart">재시작</button>
    </div>
  </div>
  <script>
    // Toggle to error state when main signals it. preload exposes
    // splashAPI; if missing (older bundle) we silently no-op.
    if (window.splashAPI && window.splashAPI.onError) {
      window.splashAPI.onError(() => {
        document.getElementById('loading-state').classList.add('hidden');
        const err = document.getElementById('error-state');
        err.classList.remove('hidden');
        err.style.display = 'flex';
      });
      document.getElementById('btn-restart').addEventListener('click', () => window.splashAPI.restart());
      document.getElementById('btn-logs').addEventListener('click', () => window.splashAPI.openLogs());
    }
  </script>
</body></html>`);

  loadingWindow.loadURL(`data:text/html;charset=utf-8,${html}`);
}

// ── 9. Main Window ────────────────────────────────────────────────────
//   (closing brace for the _unused_legacySplashMarkup wrapper above)

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
/**
 * Move mainWindow to the display the cursor is on, centered in its
 * work area. Spotlight/Raycast-style "follows me" behavior. Cheap —
 * one screen lookup + one setBounds. Skip if window already on the
 * right display to avoid pointless setBounds churn.
 *
 * Why centered: the user's natural gaze is roughly center of screen
 * when they hit the shortcut. Anchoring elsewhere (last position) on
 * a monitor they aren't using means hunting.
 */
function moveToCursorMonitor() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const sc = getScreen();
    const cursor = sc.getCursorScreenPoint();
    const target = sc.getDisplayNearestPoint(cursor);
    const cur = sc.getDisplayMatching(mainWindow.getBounds());
    if (cur && cur.id === target.id) return; // already on the right monitor
    const wa = target.workArea;
    const b = mainWindow.getBounds();
    const x = wa.x + Math.round((wa.width - b.width) / 2);
    const y = wa.y + Math.round((wa.height - b.height) / 2);
    mainWindow.setBounds({ x, y, width: b.width, height: b.height });
  } catch (e) {
    log.debug('[moveToCursorMonitor]', e?.message);
  }
}

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

  // Show-path timing for the lag investigation (decision 7 — user
  // reported lag is most felt on app show). t0 = entry, t1 = post-
  // moveToCursorMonitor, t2 = post-show, t3 = post-recover. Logged
  // at debug level, easy to grep in main.log.
  const tStart = Date.now();

  try {
    if (mainWindow.isVisible()) {
      // Capture position right before hide so the 'last' open-at mode
      // has a coordinate to restore. Even if the user has 'cursor'
      // mode selected we still record it — flipping the mode later
      // shouldn't require a hide/show cycle to seed the value.
      try {
        const b = mainWindow.getBounds();
        lastUserPosition = { x: b.x, y: b.y, width: b.width, height: b.height };
      } catch (_) { /* getBounds shouldn't throw, but be safe */ }
      mainWindow.hide();
    } else {
      if (cachedWindowOpenAt === 'last' && lastUserPosition) {
        // Restore the prior position. We still re-apply the saved
        // size after, because the user may have resized via /N
        // slider while hidden and we want the new size honored.
        // Clamp x/y so a stored position from a monitor that's
        // since been unplugged falls back to a visible spot.
        try {
          const sc = getScreen();
          const disp = sc.getDisplayMatching({
            x: lastUserPosition.x, y: lastUserPosition.y,
            width: lastUserPosition.width, height: lastUserPosition.height,
          });
          const wa = disp.workArea;
          let x = lastUserPosition.x;
          let y = lastUserPosition.y;
          if (x + lastUserPosition.width  > wa.x + wa.width)  x = wa.x + wa.width  - lastUserPosition.width;
          if (y + lastUserPosition.height > wa.y + wa.height) y = wa.y + wa.height - lastUserPosition.height;
          if (x < wa.x) x = wa.x;
          if (y < wa.y) y = wa.y;
          mainWindow.setBounds({ x, y, width: lastUserPosition.width, height: lastUserPosition.height });
        } catch (e) {
          log.debug('[restore-last-position]', e?.message);
          moveToCursorMonitor();   // fall back to the cursor strategy
        }
      } else {
        moveToCursorMonitor();
      }
      // Re-apply the saved size every time we pop in. moveToCursorMonitor
      // may have parked the window on a different display (different
      // work area), and the user may have changed `windowSizePct`
      // while we were hidden — both paths land here. applyWindowSizePct
      // recomputes against the *current* monitor's work area.
      applyWindowSizePct(mainWindow, cachedWindowSizePct);
      const tMove = Date.now();
      mainWindow.show();
      mainWindow.focus();
      const tShow = Date.now();
      recoverTransparentBacking(mainWindow);
      const tRec = Date.now();
      log.debug(`[show-path] move=${tMove - tStart}ms show=${tShow - tMove}ms recover=${tRec - tShow}ms total=${tRec - tStart}ms`);
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

/**
 * SSOT for launcher resizing. Used by:
 *   - cold-start (createWindow reads cachedWindowSizePct)
 *   - showMainWindow (re-applies before show so an in-hidden settings
 *     change takes effect on the next pop-in)
 *   - `set-window-size-pct` IPC (status bar slider, preset dropdown,
 *     settings dialog)
 *   - `resize-active-window` IPC (`/N` slash command)
 *
 * Picks the work area of whichever display the window currently sits
 * on (matches `/N`'s historical behaviour) and centers within it.
 * `pct >= 100` collapses to "fill work area" so the slash `/100`
 * still produces an exactly-fit window with no rounding wobble.
 */
function applyWindowSizePct(win, pct, anchor = 'center') {
  if (!win || win.isDestroyed()) return;
  const clamped = Math.max(25, Math.min(100, Math.round(Number(pct) || 100)));
  let wa;
  try {
    wa = getScreen().getDisplayMatching(win.getBounds()).workArea;
  } catch {
    wa = getScreen().getPrimaryDisplay().workArea;
  }
  if (clamped >= 100) {
    win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height }, true);
    return;
  }
  const w = Math.round(wa.width  * clamped / 100);
  const h = Math.round(wa.height * clamped / 100);

  // Anchor 'bottom': keep the window's bottom-Y where it is. Used by
  // the status-bar slider so the slider thumb (which sits at the
  // window's bottom edge) doesn't drift away from the user's cursor
  // mid-drag — the previous always-center behaviour caused the slider
  // to "두두두둑" because every IPC tick moved the thumb's screen
  // position, breaking the drag-tracking loop.
  // Anchor 'center' (default): unchanged — used by /N slash, preset
  // dropdown, settings dialog presets, cold start.
  let x, y;
  if (anchor === 'bottom') {
    const prev = win.getBounds();
    x = wa.x + Math.round((wa.width - w) / 2);
    y = prev.y + prev.height - h;
    // Clamp into workArea so a tall slider drag near the screen top
    // doesn't push the window off the top of the monitor.
    if (y < wa.y) y = wa.y;
    if (y + h > wa.y + wa.height) y = wa.y + wa.height - h;
  } else {
    x = wa.x + Math.round((wa.width  - w) / 2);
    y = wa.y + Math.round((wa.height - h) / 2);
  }
  win.setBounds({ x, y, width: w, height: h }, true);
}

/**
 * Write the size percentage into electron-store's appData.settings.
 * Done from main (rather than asking the renderer to round-trip the
 * full settings object) so origin-of-the-mutation doesn't matter:
 * `/N` typed in the renderer command bar, the status-bar slider, the
 * settings dialog preset, and the IPC handler all converge on the
 * same persistence path. The renderer's reactive store will pick up
 * the new value on its next load (and immediately for the
 * `set-window-size-pct` flow because the renderer drove the change).
 */
function persistWindowSizePct(pct) {
  try {
    const data = store.get('appData') || {};
    data.settings = { ...(data.settings || {}), windowSizePct: pct };
    store.set('appData', data);
  } catch (e) {
    log.warn('[window-size] persist failed', e?.message);
  }
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

// Accept either a numeric pixel size (current schema) or a legacy enum
// ('small' / 'normal') from older settings blobs. Clamp to a sane range so a
// corrupt store can't render a 1×1 or 2000×2000 orb.
function floatingWindowSizeFor(sizePreset) {
  let orbPx;
  if (typeof sizePreset === 'number' && Number.isFinite(sizePreset)) {
    orbPx = Math.max(24, Math.min(96, Math.round(sizePreset)));
  } else if (sizePreset === 'small') {
    orbPx = 40;
  } else {
    orbPx = 48;
  }
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

// ── Save-As dialog companion popup ───────────────────────────────────
//
// A small frameless BrowserWindow that pops up above whichever Windows
// file dialog (#32770) is in the foreground. Its UI is two-level:
//   L1: chips per space (with folder-card count badges)
//   L2: chips per folder card inside the picked space
// Click a folder → reuse the existing jump-to-dialog-folder pipeline
// (clipboard paste, Unicode-safe).
//
// Lifecycle is event-driven from main: a 600 ms detect-dialog poll spawns
// the window when a dialog appears, repositions it as the dialog moves,
// and destroys it when the dialog closes. The renderer never controls
// its own visibility — it only handles "user clicked ✕" via dialog-popup-
// dismiss IPC.

// The popup BrowserWindow is ALWAYS this tall. The visible chip strip
// only occupies the top DIALOG_POPUP_STRIP_HEIGHT pixels — the rest is
// transparent + click-through so the dropdown menu has room to open
// without dynamic resize. Dynamic setBounds-based expansion was flaky
// (some DPI configs and screen-edge clamps left the window at the
// original 50 px even after a setBounds call), and a fixed-size window
// with click-through is the same pattern badges use successfully.
const DIALOG_POPUP_HEIGHT       = 220;  // total BrowserWindow height
const DIALOG_POPUP_STRIP_HEIGHT = 50;   // visible chip-strip portion
const DIALOG_POPUP_OFFSET       = 6;    // gap between strip bottom and dialog top
const DIALOG_POLL_MS            = 600;  // detection poll cadence

let dialogLastRect = null;

function buildDialogPopupState() {
  // We send ALL presets so the popup can offer in-popup preset switching
  // ("프리셋 1·2·3") without mutating the global active preset. Each preset
  // is reduced to just the spaces+folder-cards the popup needs to render.
  //
  // Note: the legacy "시스템" pseudo-space (Downloads/Desktop/Documents)
  // was removed. It confused users — the popup is meant to surface their
  // OWN spaces, and Windows itself already pins those folders in the
  // dialog's left nav. `systemFolders: []` is preserved in the payload
  // shape for backwards compat with any cached renderer build that still
  // reads it.
  const data = store.get('appData') || {};
  const presets = Array.isArray(data.presets) ? data.presets : [];

  const slimSpace = (s) => ({
    id: s.id,
    name: s.name || '이름 없음',
    icon: s.icon,
    color: s.color,
    folders: (s.items || [])
      .filter(i => i.type === 'folder' && i.value)
      .map(i => ({ id: i.id, title: i.title || i.value, path: i.value })),
  });

  return {
    systemFolders: [],
    activePresetId: data.activePresetId,
    presets: presets.map(p => ({
      id: p.id,
      label: p.label || `프리셋 ${p.id}`,
      spaces: (p.spaces || []).map(slimSpace),
    })),
  };
}

function pushDialogPopupState(extra = {}) {
  if (!dialogPopupWin || dialogPopupWin.isDestroyed()) return;
  const base = buildDialogPopupState();
  dialogPopupWin.webContents.send('dialog-popup-state', { ...base, ...extra });
}

function destroyDialogPopupWindow() {
  if (dialogPopupWin && !dialogPopupWin.isDestroyed()) {
    dialogPopupWin.destroy();
  }
  dialogPopupWin = null;
}

// Popup width is now fixed (was dialog.width + 240 when the popup
// anchored to the dialog). Since v1.3.43+ the popup floats at a
// monitor-relative position decoupled from the dialog, so dialog width
// no longer informs popup width. 880 px fits the chip strip + preset
// dropdown comfortably without dominating the screen.
const DIALOG_POPUP_WIDTH = 880;

// Per-monitor saved position storage. Key = workArea signature so the
// position survives across sessions and is tied to a specific physical
// monitor arrangement. Value = { x, y } in DIP (setBounds coords).
function getMonitorKey(workArea) {
  return `${workArea.x},${workArea.y},${workArea.width}x${workArea.height}`;
}

function defaultPopupPosition(workArea) {
  // Horizontally centred, vertically at the 5/6-down mark — i.e. 1/6
  // of the work-area height up from the bottom. The strip's vertical
  // centre sits at that line so the user perceives "near the bottom
  // of the monitor" without overlapping the taskbar (workArea already
  // excludes it).
  const x = Math.round(workArea.x + (workArea.width - DIALOG_POPUP_WIDTH) / 2);
  const y = Math.round(workArea.y + Math.floor(workArea.height * 5 / 6) - DIALOG_POPUP_STRIP_HEIGHT / 2);
  return { x, y };
}

function clampPopupBounds(pos, workArea) {
  // Keep the popup window fully inside the monitor's work area so the
  // user can't lose it by dragging past an edge — or via a workArea
  // shrink (taskbar moved, resolution changed) since last save.
  const x = Math.max(workArea.x, Math.min(pos.x, workArea.x + workArea.width  - DIALOG_POPUP_WIDTH));
  const y = Math.max(workArea.y, Math.min(pos.y, workArea.y + workArea.height - DIALOG_POPUP_HEIGHT));
  return { x, y };
}

// Memoize the last monitor we positioned for, so the dialog poll's
// every-600ms tick doesn't re-apply setBounds unnecessarily. The popup
// is no longer dialog-anchored (monitor-anchored since v1.3.43), so as
// long as the dialog stays on the same monitor the popup position is
// stable. Re-applying setBounds on every tick was both wasteful AND
// fought the user's drag (next tick after dragstart would snap the
// popup back to the saved position).
let dialogPopupLastMonitorKey = null;

function positionDialogPopup(rect, opts = {}) {
  if (!dialogPopupWin || dialogPopupWin.isDestroyed() || !rect) return;
  dialogLastRect = rect;

  // DPI SSOT: Electron decides "which monitor" via getDisplayMatching
  // against the dialog rect; the matched display's workArea (DIP) is
  // the source of truth for placement math because setBounds expects
  // DIP. Note we are NOT positioning via PS here — this is a native
  // Electron BrowserWindow, so the SSOT for its coords is Electron's
  // own screen API (consistent DIP coords for setBounds).
  const screen = getScreen();
  const display = screen.getDisplayMatching({
    x: rect.x, y: rect.y, width: rect.width, height: rect.height,
  });
  const wa = display.workArea;
  const monitorKey = getMonitorKey(wa);

  // Skip the setBounds entirely if we've already positioned for this
  // monitor. force=true bypasses for create / reset paths where we
  // really do want to re-apply. This eliminates the per-tick fight
  // with native drag-to-move.
  if (!opts.force && monitorKey === dialogPopupLastMonitorKey) return;

  const saved = (store.get('dialogPopupPositions') || {})[monitorKey];
  const pos = clampPopupBounds(saved || defaultPopupPosition(wa), wa);

  try {
    dialogPopupWin.setBounds({
      x: pos.x, y: pos.y,
      width: DIALOG_POPUP_WIDTH, height: DIALOG_POPUP_HEIGHT,
    });
    dialogPopupLastMonitorKey = monitorKey;
  } catch (_) { /* monitor went away mid-set; ignore */ }
}

function createDialogPopupWindow(rect, dialogTitle) {
  if (dialogPopupWin && !dialogPopupWin.isDestroyed()) return dialogPopupWin;

  // Memory-only session — the popup is short-lived per dialog and we don't
  // want it polluting the default cache.
  const dpSession = session.fromPartition('dialog-popup-memory');
  try {
    dpSession.clearCache();
    dpSession.clearStorageData({ storages: ['cachestorage', 'cookies', 'localstorage'] }).catch(() => {});
  } catch (_) {}

  dialogPopupWin = new BrowserWindow({
    width: DIALOG_POPUP_WIDTH,
    height: DIALOG_POPUP_HEIGHT,
    x: 0, y: 0,
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false,
    hasShadow: false, show: false, useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-dialog-popup.js'),
      contextIsolation: true,
      session: dpSession,
    },
  });
  dialogPopupWin.setAlwaysOnTop(true, 'screen-saver');
  dialogPopupWin.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  // Click-through by default. The renderer flips this off (capture on)
  // when the pointer moves over the chip strip or open dropdown menu,
  // and back on when the pointer leaves — same pattern badges overlay
  // uses. Without this the bottom 170 px (transparent area where the
  // menu opens) would still capture clicks meant for the dialog.
  dialogPopupWin.setIgnoreMouseEvents(true, { forward: true });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  if (rendererUrl) {
    dialogPopupWin.loadURL(`${rendererUrl}/dialog-popup.html`);
  } else {
    dialogPopupWin.loadFile(path.join(__dirname, 'frontend', 'dist', 'dialog-popup.html'));
  }

  dialogPopupWin.once('ready-to-show', () => {
    if (rect) positionDialogPopup(rect, { force: true });
    pushDialogPopupState({ dialogTitle });
    dialogPopupWin.show();
  });

  // Native drag-to-move via -webkit-app-region in the renderer.
  // BrowserWindow fires 'moved' (with debouncing built in) after each
  // mouse-up of a native drag — that's where we persist. No per-frame
  // IPC churn, no fight with the poll tick (the poll tick skips
  // re-positioning while monitor is unchanged; see positionDialogPopup).
  dialogPopupWin.on('moved', () => {
    if (!dialogPopupWin || dialogPopupWin.isDestroyed()) return;
    const b = dialogPopupWin.getBounds();
    const display = getScreen().getDisplayMatching(b);
    const wa = display.workArea;
    const clamped = clampPopupBounds({ x: b.x, y: b.y }, wa);
    if (clamped.x !== b.x || clamped.y !== b.y) {
      try {
        dialogPopupWin.setBounds({
          x: clamped.x, y: clamped.y,
          width: DIALOG_POPUP_WIDTH, height: DIALOG_POPUP_HEIGHT,
        });
      } catch (_) {}
    }
    const positions = store.get('dialogPopupPositions') || {};
    positions[getMonitorKey(wa)] = clamped;
    store.set('dialogPopupPositions', positions);
    // The drag may have crossed monitor boundaries — remember the new
    // monitor so the poll tick doesn't immediately try to re-position.
    dialogPopupLastMonitorKey = getMonitorKey(wa);
  });

  dialogPopupWin.on('closed', () => {
    dialogPopupWin = null;
    dialogPopupLastMonitorKey = null;
  });
  return dialogPopupWin;
}

// ── Generic satellite-dialog infrastructure (v1.3.44+) ───────────
//
// Many of nost's dialogs (ItemDialog, ItemWizard, SettingsDialog, …)
// were rendered inline as Radix DialogContents in the main renderer.
// On narrow / pair-split main windows they got clipped by the
// BrowserWindow rectangle (Chromium can't draw outside its own
// window). Hosting each in its own satellite BrowserWindow fixes the
// clipping AND keeps the dialog discoverable on multi-monitor setups.
//
// One Map keyed by name (e.g. 'item-dialog', 'item-wizard'). Each
// satellite is single-instance — re-triggering with a new payload
// updates state instead of spawning a duplicate. IPC channels are
// derived from the name: ${name}-state (push), ${name}-request-state
// (race-fix), ${name}-action (renderer → main → mainWindow), and
// ${name}-closed (window destroyed → mainWindow cleanup).
//
// See plans/satellite-dialogs.md.

const satellites = new Map();  // name → { win, state }

function destroySatellite(name) {
  const sat = satellites.get(name);
  if (sat?.win && !sat.win.isDestroyed()) sat.win.destroy();
  satellites.delete(name);
}

function pushSatelliteState(name) {
  const sat = satellites.get(name);
  if (!sat?.win || sat.win.isDestroyed() || !sat.state) return;
  sat.win.webContents.send(`${name}-state`, sat.state);
}

function createSatelliteWindow(name, { width, height, preloadFile, htmlFile, initialState }) {
  const existing = satellites.get(name);
  if (existing?.win && !existing.win.isDestroyed()) {
    // Re-use: just refresh state and refocus.
    existing.state = initialState;
    pushSatelliteState(name);
    existing.win.show();
    existing.win.focus();
    return existing.win;
  }

  // Anchor: centered on the monitor that hosts the main nost window
  // (NOT on mainWindow.getBounds, which can be pair-split into the
  // corner — we want the dialog in the middle of the user's screen).
  // DPI SSOT via screen.getDisplayMatching → workArea (DIP).
  const screen = getScreen();
  let waX = 0, waY = 0, waW = 1920, waH = 1080;
  try {
    const mb = mainWindow?.getBounds?.();
    const display = mb
      ? screen.getDisplayMatching(mb)
      : screen.getPrimaryDisplay();
    waX = display.workArea.x;
    waY = display.workArea.y;
    waW = display.workArea.width;
    waH = display.workArea.height;
  } catch (_) { /* keep defaults */ }

  const x = Math.round(waX + (waW - width)  / 2);
  const y = Math.round(waY + (waH - height) / 2);

  const sess = session.fromPartition(`${name}-memory`);

  const win = new BrowserWindow({
    width, height, x, y,
    frame: false,
    // Transparent so the area AROUND the dialog content card shows
    // whatever is underneath (desktop / other apps) instead of an
    // opaque rectangle. The dialog card itself paints its own
    // background via the DialogContent's bg-popover class.
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    // show:true (was false pre-v1.3.44). Earlier we relied on
    // ready-to-show to flip to show — but if the renderer threw during
    // module load (sandbox-induced require failure), ready-to-show
    // never fired and the window stayed permanently hidden. show:true
    // gives a brief blank/transparent flash before paint, but the
    // window is always visible at least.
    show: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, preloadFile),
      contextIsolation: true,
      // sandbox:false is required because each satellite's preload uses
      // `require('./preload.js')` to reuse the main app's electronAPI
      // surface (avoids duplicating 240 lines × 6 satellites). In
      // sandboxed preloads, relative-path require throws Module not
      // found — the satellite preload would silently fail to load,
      // window.itemDialog/etc would be undefined, and the renderer
      // would mount-then-error on the first api.onState call. This was
      // the root cause of the "black screen" / "TypeError: Cannot read
      // properties of undefined (reading 'onState')" report. Security
      // posture matches the main window which also runs sandbox-off.
      sandbox: false,
      session: sess,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');

  // Diagnostic: surface renderer load failures into main.log. Pre
  // v1.3.44 these were silent — satellites just didn't appear and
  // the user had no signal as to why.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error(`[satellite:${name}] did-fail-load code=${code} desc=${desc} url=${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`[satellite:${name}] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  if (rendererUrl) {
    win.loadURL(`${rendererUrl}/${htmlFile}`);
    // Dev-mode: pop devtools so renderer errors are visible. Otherwise
    // a satellite that fails to mount shows as a black box with no
    // signal as to why.
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, 'frontend', 'dist', htmlFile));
  }

  // Forward renderer console messages into main.log so even closed-
  // devtools builds leave a paper trail.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2 /* warning or error */) {
      log.warn(`[satellite:${name}] console L${level}: ${message} @ ${sourceId}:${line}`);
    }
  });

  satellites.set(name, { win, state: initialState });

  // Push initial state when the renderer reports it mounted (request-
  // state IPC). Pre-mount pushes were getting dropped because the
  // listener wasn't attached yet — the renderer's own requestState
  // call after onState subscription handles this race naturally.
  win.webContents.on('did-finish-load', () => {
    pushSatelliteState(name);
    win.focus();
  });

  win.on('closed', () => {
    satellites.delete(name);
    try { mainWindow?.webContents?.send(`${name}-closed`); } catch (_) {}
  });

  return win;
}

/**
 * Register the standard 4-channel IPC for a satellite: open, request-
 * state (race-fix), action (forward → mainWindow), implicit close
 * (handled by the renderer sending action { kind: 'close' }, or the
 * window being killed externally). Returns the registered satellite
 * name for symmetry.
 *
 * `closingActions` lists action kinds that should tear down the
 * satellite after forwarding to mainWindow (typically save / pick-
 * on-screen / save-as-memo — terminal actions that end the dialog).
 */
function registerSatelliteIpc(name, { width, height, preloadFile, htmlFile, closingActions = ['save'] }) {
  ipcMain.on(`open-${name}`, (_e, payload) => {
    createSatelliteWindow(name, { width, height, preloadFile, htmlFile, initialState: payload || {} });
  });
  ipcMain.on(`${name}-request-state`, () => pushSatelliteState(name));
  ipcMain.on(`${name}-action`, (_e, action) => {
    if (!action || typeof action !== 'object') return;
    if (action.kind === 'close') {
      destroySatellite(name);
      return;
    }
    try { mainWindow?.webContents?.send(`${name}-action`, action); } catch (_) {}
    if (closingActions.includes(action.kind)) {
      destroySatellite(name);
    }
  });
}

/**
 * Tick the dialog poll. Fired every DIALOG_POLL_MS. Decides whether to
 * spawn / reposition / destroy the popup based on what's currently in the
 * foreground.
 */
async function tickDialogPoll() {
  perfBumpTimer('dialog-poll');
  // Native koffi-bound user32 call (~10-50 µs) replaces the PowerShell
  // spawn (~50-200 ms). Falls back to the PS script ONLY if the native
  // path failed to initialise (e.g. koffi load error on a weird OS).
  let detected = foregroundWindow.detect();
  if (!detected) {
    try {
      const { stdout } = await runPsAsync('detect-dialog.ps1', {}, { timeout: 4000 });
      detected = JSON.parse(stdout.trim());
    } catch {
      return; // PS fallback also hiccupped — skip tick.
    }
  }

  // Precision gate — show the popup ONLY on actual file dialogs.
  // `isFileDialog` is set by foreground-window.js after walking the
  // window's children and confirming the accept+cancel button pair
  // (저장/열기/Save/Open + 취소/Cancel), or via the title verb-net
  // safety net (다른 이름으로 저장 / 다운로드 / Save As / …).
  //
  // v1.3.44: we no longer gate on `isDialog` (className === '#32770').
  // HWP and other apps use custom dialog window classes, and the
  // foreground-window detector now sets isFileDialog correctly for
  // those too. The legacy `isDialog === undefined` fallback covered
  // the PS path that didn't fill isFileDialog — that path now also
  // fills it, so the OR-fallback is no longer needed.
  const looksLikeFileDialog = detected && detected.isFileDialog === true;

  if (!looksLikeFileDialog) {
    // Not a file dialog. Tear down if we had one up.
    if (dialogPopupWin && !dialogPopupWin.isDestroyed()) {
      destroyDialogPopupWindow();
    }
    dialogTrackedHwnd = 0;
    // Reset dismiss flag once the user moves on — they get a fresh popup
    // for the next dialog.
    if (dialogDismissedHwnd) dialogDismissedHwnd = 0;
    return;
  }

  const t = (detected.title || '');

  // User dismissed THIS dialog's popup — don't reattach.
  if (detected.hwnd && detected.hwnd === dialogDismissedHwnd) return;

  if (!dialogPopupWin || dialogPopupWin.isDestroyed()) {
    createDialogPopupWindow(detected.rect, t);
    dialogTrackedHwnd = detected.hwnd || 0;
  } else if (detected.hwnd !== dialogTrackedHwnd) {
    // Different dialog became foreground — reuse the popup, just refresh.
    dialogTrackedHwnd = detected.hwnd || 0;
    pushDialogPopupState({ dialogTitle: t });
    if (detected.rect) positionDialogPopup(detected.rect);
  } else {
    // Same dialog — keep position synced (dialog might have been moved).
    if (detected.rect) positionDialogPopup(detected.rect);
  }
}

function startDialogPoll() {
  if (dialogPollTimer) return;
  dialogPollTimer = setInterval(tickDialogPoll, DIALOG_POLL_MS);
}

// ── Floating badges overlay (Phase 2 → Phase 3 multi-display) ───────
//
// PER-DISPLAY transparent always-on-top BrowserWindows hosting pinned
// badges (space / node / deck). The Phase 2 design used a SINGLE window
// spanning the union of all displays — RAM-cheap but broken on
// cross-DPI multi-monitor setups: Electron renders the window at the
// home display's DPR, then the OS maps those pixels 1:1 onto the other
// display, producing wrong physical sizes and visible clipping on
// secondaries. Per-display windows trade a few MB of RAM for correct
// rendering on every display regardless of DPI.
//
// Click-through: each window runs with setIgnoreMouseEvents(true,
// {forward: true}) so mouse events pass through empty regions.
// Renderer flips capture off while the pointer hovers a badge rect
// (via badges-set-capture IPC) and flips it back on when the pointer
// leaves. Capture toggles are routed by sender so each overlay tracks
// its own pointer independently.

// Dangling-badge warnings used to spam main.log because buildBadgePayload
// runs on every store sync (badges-sync IPC fires per item edit / sort /
// drop). Dedupe via this Set — log once per (badgeId, refId) tuple per
// session. Reset on badge restoration so a future re-orphan re-logs.
const _loggedDanglingBadges = new Set();
function _warnDanglingOnce(kind, badgeId, refId) {
  const key = `${kind}|${badgeId}|${refId}`;
  if (_loggedDanglingBadges.has(key)) return;
  _loggedDanglingBadges.add(key);
  if (kind === 'space') {
    log.warn(`[badges] dangling space ref — badgeId=${badgeId} refId=${refId} (badge hidden, store entry kept)`);
  } else {
    log.warn(`[badges] dangling ${kind} ref — badgeId=${badgeId} refId=${refId}`);
  }
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
      if (!s) {
        // Silently filtering a badge here is the difference between
        // "user pinned 4 badges, sees 3" and "user pinned 4 badges,
        // sees 3 with no idea why one's gone." Log so future badge-
        // disappear reports can be triaged from main.log instead of
        // guesswork. The badge entry stays in store (lazy hide), so
        // restoring the referenced space (e.g. via undo) automatically
        // brings it back on the next sync.
        _warnDanglingOnce('space', b.id, b.refId);
        continue;
      }
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
      if (!n) {
        _warnDanglingOnce('node', b.id, b.refId);
        continue;
      }
      const items = (n.itemIds ?? [])
        .map(id => allItems.get(id))
        .filter(Boolean)
        .map(i => slimItem(i, spaces.find(s => (s.items ?? []).some(x => x.id === i.id))));
      out.push({
        id: b.id, refType: 'node', refId: b.refId,
        x: b.x, y: b.y,
        label: n.name,
        color: '#a78bfa',
        // User-picked Material Symbol (NodePanel header picker) wins;
        // fall back to the historic 'hub' default when absent so badges
        // for nodes created before the picker shipped still render.
        icon: n.icon || 'hub',
        iconIsEmoji: false,
        count: items.length,
        items,
      });
    } else if (b.refType === 'deck') {
      const d = decks.find(x => x.id === b.refId);
      if (!d) {
        _warnDanglingOnce('deck', b.id, b.refId);
        continue;
      }
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

// ── Per-display badge overlay machinery ────────────────────────────
//
// One BrowserWindow per display. Each window is sized and positioned
// to its host display's bounds, so the rendering DPR matches that
// display 1:1 — eliminating the cross-DPI "canvas wrongly set" bug
// where badges on a secondary monitor were being rendered at the
// primary's DPR and then mapped without scaling onto the secondary's
// physical pixels (they appeared too big or got clipped).

/** Find the display whose bounds contain the given screen coord, or null. */
function findDisplayForPoint(x, y) {
  const displays = getScreen().getAllDisplays();
  for (const d of displays) {
    const b = d.bounds;
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return d;
  }
  return null;
}

/** Reanchor a badge's stored position if it's stranded (no longer on any
 *  visible display — e.g. the user unplugged the monitor it was pinned to).
 *  Falls back to the bottom-right of the primary display's work area. */
function sanitizeBadgePosition(badge) {
  if (findDisplayForPoint(badge.x, badge.y)) return badge;
  const wa = getScreen().getPrimaryDisplay().workArea;
  return { ...badge, x: wa.x + wa.width - 120, y: wa.y + wa.height - 120 };
}

/** Push state to ONE overlay, filtering badges to those on its display. */
function pushBadgeStateForDisplay(display, win) {
  if (!win || win.isDestroyed()) return;
  const data = store.get('appData') || {};
  const allBadges = buildBadgePayload(data);

  // Membership rule:
  //   - badge whose stored screen-coord lies inside this display → show here
  //   - badge whose coord is off every display ("stranded") → show on primary
  //     so the user can still see + drag it back to where they want.
  const primaryId = getScreen().getPrimaryDisplay().id;
  const myBadges = allBadges.filter(b => {
    const home = findDisplayForPoint(b.x, b.y);
    if (home) return home.id === display.id;
    return display.id === primaryId;
  });

  // Settings.badgeSize is the user-controlled pixel size of every badge
  // bubble. Falling back to 46 matches the historical hardcoded constant
  // in Badge.tsx so freshly migrated stores render unchanged. Pushing it
  // alongside the badge list (rather than via a separate IPC channel)
  // keeps the overlay's hydration path single-shot — one `badges-state`
  // message and the renderer has everything it needs to draw.
  const badgeSize = (data?.settings?.badgeSize ?? 46);

  win.webContents.send('badges-state', {
    badges:        myBadges,
    overlayOrigin: { x: display.bounds.x, y: display.bounds.y },
    overlaySize:   { width: display.bounds.width, height: display.bounds.height },
    badgeSize,
  });
}

/** Push state to every overlay. Called whenever the badges store mutates. */
function pushBadgeStateAll() {
  if (badgeOverlays.size === 0) return;
  const displays = getScreen().getAllDisplays();
  for (const [displayId, win] of badgeOverlays) {
    const display = displays.find(d => d.id === displayId);
    if (!display) continue;
    pushBadgeStateForDisplay(display, win);
  }
}

/** Re-export under the legacy name so the surrounding mutateBadges /
 *  display-event hooks don't need to know about the multi-overlay split. */
function pushBadgeState() { pushBadgeStateAll(); }

function destroyAllBadgeOverlays() {
  for (const win of badgeOverlays.values()) {
    if (win && !win.isDestroyed()) win.destroy();
  }
  badgeOverlays.clear();
}

function createBadgeOverlayForDisplay(display) {
  if (badgeOverlays.has(display.id)) return badgeOverlays.get(display.id);

  // Per-display session partition — same isolation rationale as the
  // single-overlay design (avoid cache contention with mainWindow), but
  // we also key by display.id so the few KB of overlay state doesn't
  // collide across displays.
  const badgeSession = session.fromPartition(`badge-overlay-${display.id}`);
  try {
    badgeSession.clearCache();
    badgeSession.clearStorageData({
      storages: ['cachestorage', 'cookies', 'localstorage', 'shadercache', 'serviceworkers'],
    }).catch(() => {});
  } catch (_) {}

  const win = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y,
    width: display.bounds.width, height: display.bounds.height,
    frame: false, transparent: true, resizable: false,
    // Some Windows configurations briefly composite a solid window
    // background before the transparent layer engages. backgroundColor
    // 00 alpha forces the compositor to skip that solid pass.
    backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: true,
    hasShadow: false,
    focusable: false,   // never steal focus — badges are gestural only
    minimizable: false, maximizable: false, fullscreenable: false,
    show: false,
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
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  if (rendererUrl) {
    win.loadURL(`${rendererUrl}/badges.html`);
  } else {
    win.loadFile(path.join(__dirname, 'frontend', 'dist', 'badges.html'));
  }

  // Reveal pattern: push state in `ready-to-show`, then show after a tiny
  // delay so React's first render commits with hydrated badge data — no
  // flash of empty overlay. The previous "wait for renderer's
  // requestState" handshake was a per-window event we can't easily route
  // when there are N overlays (ipcMain.once would race the first sender),
  // so a 250 ms timeout-based reveal is simpler and visually equivalent.
  win.once('ready-to-show', () => {
    pushBadgeStateForDisplay(display, win);
    setTimeout(() => {
      if (!win.isDestroyed()) win.showInactive();
    }, 250);
  });

  win.on('closed', () => { badgeOverlays.delete(display.id); });
  badgeOverlays.set(display.id, win);
  return win;
}

/** Ensure overlays reflect current state: one per display when any badge
 *  exists, none when there are no badges. Also reanchors stranded badges
 *  whose stored coords no longer fall on any visible display. */
function syncBadgeOverlay() {
  const data = store.get('appData') || {};
  const has  = Array.isArray(data.floatingBadges) && data.floatingBadges.length > 0;

  if (!has) {
    destroyAllBadgeOverlays();
    return;
  }

  // Rescue stranded badges before we do anything else, so the first
  // state push has clean coords.
  ensureBadgePositionsSane();

  const displays = getScreen().getAllDisplays();
  const wantedIds = new Set(displays.map(d => d.id));

  // Remove overlays for displays that no longer exist (monitor unplugged).
  for (const [id, win] of [...badgeOverlays]) {
    if (!wantedIds.has(id)) {
      if (!win.isDestroyed()) win.destroy();
      badgeOverlays.delete(id);
    }
  }

  // Create / reposition overlays for every current display.
  for (const display of displays) {
    const existing = badgeOverlays.get(display.id);
    if (!existing || existing.isDestroyed()) {
      createBadgeOverlayForDisplay(display);
    } else {
      const cur = existing.getBounds();
      const b = display.bounds;
      if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) {
        existing.setBounds(b);
      }
      pushBadgeStateForDisplay(display, existing);
    }
  }
}

/**
 * Refresh per-display overlay windows that DWM may have de-prioritised.
 *
 * User-reported pattern (2026-05): "all badges disappear over time, and
 * also after preset switch, but creating a new badge brings them back."
 * That symptom matches Windows DWM treating idle transparent always-on-
 * top windows as inactive and dropping them out of the active z-order
 * — once we send a fresh paint event (state push) or call show() again
 * on each window, DWM re-registers them.
 *
 * Three triggers call this:
 *   - powerMonitor 'resume' / 'unlock-screen' (return from sleep)
 *   - mainWindow 'show' / 'focus' (user came back to nost)
 *   - 60 s periodic tick (catches the slow-creep "(d) just disappears
 *     over time" case the user reported)
 *
 * Cheap: walks the existing overlay map. If the underlying window is
 * gone or hidden, defers to the full syncBadgeOverlay path (which
 * recreates as needed). Otherwise just re-asserts always-on-top + a
 * fresh state push, which is enough to wake DWM.
 */
function reviveBadgeOverlays(reason) {
  if (badgeOverlays.size === 0) return;
  const data = store.get('appData') || {};
  if (!Array.isArray(data.floatingBadges) || data.floatingBadges.length === 0) return;

  let revived = 0, recreated = 0;
  const displays = getScreen().getAllDisplays();
  const displayById = new Map(displays.map(d => [d.id, d]));

  for (const [id, win] of [...badgeOverlays]) {
    if (!win || win.isDestroyed()) {
      badgeOverlays.delete(id);
      const d = displayById.get(id);
      if (d) { createBadgeOverlayForDisplay(d); recreated++; }
      continue;
    }
    try {
      // Re-assert top-most level (DWM may have demoted it after long
      // idle). showInactive is a no-op when already visible but emits
      // the WM events DWM uses to refresh its z-order tracking.
      win.setAlwaysOnTop(true, 'screen-saver');
      if (!win.isVisible()) {
        win.showInactive();
        revived++;
      }
      const d = displayById.get(id);
      if (d) pushBadgeStateForDisplay(d, win);
    } catch (e) {
      log.warn(`[badges] revive failed for display=${id}:`, e?.message);
    }
  }
  if (revived || recreated) {
    log.debug(`[badges] reviveBadgeOverlays(${reason}) revived=${revived} recreated=${recreated}`);
  }
}

/** Walk the badges list, reanchor any whose coord is on no visible display.
 *  Persists if anything changed so the next reload keeps the corrected
 *  positions instead of stranding them again. */
function ensureBadgePositionsSane() {
  const data = store.get('appData') || {};
  const list = Array.isArray(data.floatingBadges) ? data.floatingBadges : [];
  if (list.length === 0) return;

  let changed = false;
  const next = list.map(b => {
    const fixed = sanitizeBadgePosition(b);
    if (fixed !== b) changed = true;
    return fixed;
  });
  if (!changed) return;

  data.floatingBadges = next;
  // Also update the active preset's mirror — same dual-write pattern as
  // mutateBadges (top-level data + presets[active].floatingBadges).
  const activeId = data.activePresetId;
  const presets = Array.isArray(data.presets) ? data.presets : [];
  const activeIdx = presets.findIndex(p => p && p.id === activeId);
  if (activeIdx >= 0) {
    data.presets = presets.map((p, i) => i === activeIdx ? { ...p, floatingBadges: next } : p);
  }
  store.set('appData', data);
  sendSafe('badges-updated', next);
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
  // SSOT for cold-start window placement: ALWAYS recenter on the
  // primary display's work area at app launch. Earlier we restored
  // the last-session windowBounds verbatim, which felt fine within
  // a session but meant a user who had ever dragged the window
  // off-center stayed off-center for every subsequent launch — the
  // user reported "consistently skewed down" because of this.
  //
  // We still honour the SAVED SIZE (so resize-during-session
  // persists), but the position is computed fresh each launch
  // from `centeredBounds`-style math against the primary work
  // area. The /75 IPC and this code path now share the same
  // center calculation; one place owns "where does it land".
  const saved = store.get('windowBounds');
  const default75 = centeredBounds(75);
  const savedSizeOk = saved && saved.width > 0 && saved.height > 0;
  const initW = savedSizeOk ? saved.width  : default75.width;
  const initH = savedSizeOk ? saved.height : default75.height;
  const wa = getScreen().getPrimaryDisplay().workArea;
  const initX = wa.x + Math.round((wa.width  - initW) / 2);
  const initY = wa.y + Math.round((wa.height - initH) / 2);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();

  mainWindow = new BrowserWindow({
    width: initW, height: initH,
    x: initX,    y: initY,
    minWidth: 400, minHeight: 400,
    show: false, frame: false, transparent: true,
    // v1.3.44: hasShadow:false. With transparent:true the DWM compositor
    // had been drawing a drop shadow against the window's rectangular
    // alpha mask — visible as a clipped rectangle around the app, and a
    // continuous compositing cost. The app already draws its own
    // shadows on cards / panels via CSS, so this is purely subtractive.
    hasShadow: false,
    resizable: true, alwaysOnTop: true, skipTaskbar: false,
    // Higher z-order level than default 'floating'. Default level
    // can be pushed below another topmost window when an external
    // app launch triggers SetForegroundWindow. 'screen-saver' sits
    // above other topmost apps so launching Chrome/IDE/etc doesn't
    // demote nost. Floating overlays already use this same level.
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
  wc.on('render-process-gone', (_e, details) => {
    rdbg('webContents: render-process-gone', details);
    // Renderer is dead — any suppress-autohide registrations it owned
    // (clean-mode, tutorial, busy:* from useBusyMark) will never get
    // a cleanup IPC. Without this clear, the Set would leak forever
    // and autoHide would silently stay disabled across the next
    // renderer life. See `plans/focus-state-audit.md` Issue 3.
    if (suppressAutoHideSources.size > 0) {
      log.warn(`[suppress-autohide] clearing ${suppressAutoHideSources.size} stale source(s) after render-process-gone: [${Array.from(suppressAutoHideSources).join(',')}]`);
      suppressAutoHideSources.clear();
    }
  });
  wc.on('destroyed', () => {
    if (suppressAutoHideSources.size > 0) {
      log.warn(`[suppress-autohide] clearing ${suppressAutoHideSources.size} stale source(s) after webContents destroyed`);
      suppressAutoHideSources.clear();
    }
  });
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

  // Lock window to screen-saver z-order so external app launches
  // (which trigger SetForegroundWindow on Windows) can't demote us.
  // Constructor's alwaysOnTop:true defaults to 'floating' level —
  // not enough.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
  }

  // Unified loading flow: mainWindow is shown as soon as Electron tells
  // us the frame is composited (`ready-to-show`, ~250 ms cold-start),
  // and the in-window `#ql-loading` overlay (defined in
  // frontend/index.html) carries the visual until the renderer finishes
  // hydrating + storeLoad resolves. The previous "wait for
  // renderer-ready IPC" gate is gone — it was the source of stuck-on-
  // loading reports, because if useAppData mounted but storeLoad never
  // resolved, no IPC fired and the app stalled behind the splash.
  //
  // Two safety nets remain:
  //   - 5 s fallback: shows mainWindow even if `ready-to-show` never
  //     fires (very rare on Windows; defensive only).
  //   - 8 s force-error: if the renderer is still showing `#ql-loading`
  //     8 s in, push an IPC asking it to swap to the error panel
  //     (restart + open-logs buttons). DevTools is opened concurrently
  //     so the underlying exception is visible.
  let windowShown = false;
  const showMainWindow = (reason) => {
    if (windowShown) { rdbg(`showMainWindow skipped (already shown) reason=${reason}`); return; }
    windowShown = true;
    rdbg(`showMainWindow firing. reason=${reason}`);
    mainWindow.show();
    mainWindow.focus();
  };

  mainWindow.once('ready-to-show', () => showMainWindow('ready-to-show'));

  // Recovery actions — invoked from the in-window `#ql-loading` error
  // panel. Channel names retained from the old external splash so the
  // preload script (preload-splash.js, no longer used by a splash
  // window but still semantically the same surface) and any frontend
  // listeners don't need renaming.
  ipcMain.on('splash:restart', () => {
    log.info('[splash] user clicked restart');
    app.relaunch();
    app.exit(0);
  });
  ipcMain.on('splash:open-logs', () => {
    try { shell.showItemInFolder(log.transports.file.getFile().path); } catch (e) { log.warn('[splash] open-logs failed', e?.message); }
  });

  // Defensive: ensure the user never stares at a hidden window. If
  // ready-to-show somehow never fires, force a show at 5 s.
  setTimeout(() => showMainWindow('5s-fallback'), 5000);

  // Force-error path. After 8 s, if the renderer hasn't called
  // signalReady() (which fires `renderer-ready` from
  // dismissLoadingScreen), assume mount stalled and tell it to
  // surface the recovery UI inside `#ql-loading`.
  let rendererReady = false;
  ipcMain.once('renderer-ready', () => { rendererReady = true; rdbg('IPC: renderer-ready received'); });
  setTimeout(() => {
    if (rendererReady) return;
    log.warn('[boot-stuck] renderer-ready not received in 8s — opening devtools + asking renderer to show error state');
    try { mainWindow.webContents.openDevTools({ mode: 'detach' }); } catch (e) { log.warn('[boot-stuck] devtools open failed', e?.message); }
    try { mainWindow.webContents.send('boot:show-error'); } catch (e) { log.warn('[boot-stuck] in-window error signal failed', e?.message); }
    showMainWindow('boot-stuck');
  }, 8000);

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

  // Relay loading-status messages from renderer (no-op now). The
  // external splash that consumed these is gone; the in-window
  // `#ql-loading` overlay updates its own text directly via DOM, so
  // this IPC is purely vestigial. Kept as a swallow to avoid
  // breaking the renderer's `electronAPI.setLoadingStatus()` call.
  ipcMain.on('set-loading-status', () => { /* no-op */ });

  // Initialise the autoHide cache from disk so the very first blur
  // (before the renderer has had a chance to push) reads a sane value.
  cachedAutoHide = !!store.get('appData')?.settings?.autoHide;
  // Same for the window-open-at strategy. 'cursor' is the historic
  // default so any pre-1.3.31 store reads as cursor mode.
  const savedOpenAt = store.get('appData')?.settings?.windowOpenAt;
  cachedWindowOpenAt = (savedOpenAt === 'last' ? 'last' : 'cursor');

  // Same for the saved launcher size %. Apply BEFORE the window's
  // first show so the user never sees a 100% → snap-to-saved flash.
  const savedPct = Number(store.get('appData')?.settings?.windowSizePct);
  if (Number.isFinite(savedPct) && savedPct >= 25 && savedPct <= 100) {
    cachedWindowSizePct = Math.round(savedPct);
    applyWindowSizePct(mainWindow, cachedWindowSizePct);
  }

  // Force webContents zoom back to 1.0 on every load. The previous
  // build briefly used `webContents.setZoomFactor()` for "창 크기"
  // before we switched to physical setBounds (which is the correct
  // semantic — see settings.windowSizePct). Chromium persists zoom
  // factor per-origin in its own storage, so users who ran the bad
  // build still have e.g. 2.0× content zoom stuck on file:// — text
  // appears huge in SignInScreen / settings until explicitly reset.
  // setZoomLevel(0) === setZoomFactor(1.0); we use both setters for
  // belt-and-suspenders since some Electron versions only honour one.
  mainWindow.webContents.on('did-finish-load', () => {
    try {
      mainWindow.webContents.setZoomLevel(0);
      mainWindow.webContents.setZoomFactor(1.0);
    } catch (e) { log.warn('[zoom-reset] failed', e?.message); }
  });

  // Auto-hide on focus loss. Funnel through the single dismissal
  // policy — same place blur, closeAfter, and any future automatic
  // dismissal share. Suppression sources + autoHide setting checked
  // inside tryDismissWindow.
  mainWindow.on('blur', () => tryDismissWindow('blur'));

  // Debounced bounds save — avoids thrashing electron-store on every pixel drag.
  // Position is intentionally NOT persisted (SSOT: cold start always centers
  // on the primary work area). We keep just width/height so the user's
  // resize-during-session preference survives across launches.
  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isMaximized()) {
        const b = mainWindow.getBounds();
        store.set('windowBounds', { width: b.width, height: b.height });
      }
    }, 500);
  };
  mainWindow.on('moved',   saveBounds);
  mainWindow.on('resized', saveBounds);

  // User-driven resize → keep `windowSizePct` SSOT in sync with the new
  // bounds so the status-bar slider reflects what the user just did.
  // Without this the slider keeps showing the last *programmatic* value
  // (e.g. 100%) even after the user dragged the window to a smaller size.
  //
  // Heuristic: take whichever dimension shrank more — that's the
  // "fit-within" pct. Re-applying that pct later will set both
  // dimensions to that ratio of the work area (applyWindowSizePct uses
  // the same pct for width and height), which is the closest single
  // value to round-trip the user's drag.
  let pctTimer = null;
  mainWindow.on('resized', () => {
    clearTimeout(pctTimer);
    pctTimer = setTimeout(() => {
      try {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
        const b = mainWindow.getBounds();
        const wa = getScreen().getDisplayMatching(b).workArea;
        const pctW = (b.width  / wa.width)  * 100;
        const pctH = (b.height / wa.height) * 100;
        const pct = Math.max(25, Math.min(100, Math.round(Math.min(pctW, pctH))));
        const current = Number(store.get('appData')?.settings?.windowSizePct);
        if (Number.isFinite(current) && Math.abs(current - pct) < 1) return; // no real change
        cachedWindowSizePct = pct;
        persistWindowSizePct(pct);
        sendSafe('window-size-pct-changed', pct);
      } catch (e) {
        log.debug('[resize→pct]', e?.message);
      }
    }, 200);
  });

  // Register default shortcut; renderer may update it via 'update-shortcut' IPC
  registerShortcut(currentShortcut);

  registerIpcHandlers();
}

// ── 10. Tile Launch Helpers ───────────────────────────────────────────
//
// fireLaunchItem (below) is the single fire-and-forget entry point for
// the tile-launch path (node groups + deck sequence start). It routes
// through the SAME dedicated PS scripts as the single-card click path
// — see the comment above fireLaunchItem for the full rationale. The
// minimal inline _PS_FOCUS_* templates that used to live here were
// removed because they were silently divergent from the dedicated
// scripts (missing versioned-browser rebase, AUMID Get-AppxPackage
// fallback, .lnk Arguments/WorkingDirectory carry-through) and that
// divergence caused the "card works but node doesn't" bug for Store /
// PWA apps after browser auto-updates.

/**
 * Fire-and-forget: focus or launch an app/folder/window before tiling.
 * URL/browser types are handled separately by the caller.
 *
 * SSOT — uses the SAME PowerShell scripts as the single-card launch
 * path (`launch-or-focus-app.ps1`, `open-path.ps1`, `focus-window.ps1`).
 * Earlier versions inlined a minimal `_PS_FOCUS_APP` script here for
 * speed, but the inline version was missing the robust fallbacks the
 * dedicated `.ps1` carries:
 *
 *   - Chromium versioned-path rebase (Chrome / Edge / Whale auto-update
 *     deletes the old `\Application\<version>\` dir; .lnk targets go
 *     stale). The dedicated script falls back to the highest-numbered
 *     sibling under the same Application root.
 *   - WindowsApps / MSIX Store apps launched via Get-AppxPackage
 *     + shell:AppsFolder\<AUMID> when the saved exe path is gone.
 *   - Classic .lnk Arguments + WorkingDirectory carry-through
 *     (Adobe / Creative Cloud / JetBrains launchers fail silently
 *     without the cwd).
 *
 * Symptom of the old divergence: users reported "GPT/Claude cards
 * work from the main grid but the same cards inside a node group
 * don't launch after a Whale/Chrome auto-update." Routing through
 * the same script removes that divergence — node-launched apps now
 * benefit from the same fallback ladder as a direct card click.
 *
 * runPsAsync returns a Promise; we deliberately do NOT await — the
 * caller (launchItemsForTile) needs to return quickly so the tile
 * polling phase can start while the app is still spinning up.
 * Failures are surfaced via the log channel below for diagnosis.
 */
function fireLaunchItem(item) {
  let scriptName;
  const env = {};

  switch (item.type) {
    case 'app':    scriptName = 'launch-or-focus-app.ps1'; env.QL_PATH  = item.value; break;
    case 'folder': scriptName = 'open-path.ps1';           env.QL_PATH  = item.value; break;
    case 'window': scriptName = 'focus-window.ps1';        env.QL_TITLE = item.value || item.title; break;
    default: return;
  }

  // Fire-and-forget. The 10s timeout matches the single-card path's
  // launch-or-focus-app IPC handler — long enough for Defender scan
  // on a freshly-installed Store app, short enough to avoid wedging
  // tile polling if the script genuinely hangs.
  runPsAsync(scriptName, env, { timeout: 10000 })
    .then(({ stdout }) => {
      const out = String(stdout ?? '').trim();
      if (out.toUpperCase().startsWith('ERROR')) {
        log.warn(`[fire-launch] ${item.type} ${item.value} → ${out}`);
      } else if (out) {
        log.debug(`[fire-launch] ${item.type} ${item.value} → ${out}`);
      }
    })
    .catch(err => {
      log.warn(`[fire-launch] ${item.type} ${item.value} PS threw: ${err?.message}`);
    });
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

  // Renderer-side close-after request — runs through the SSOT funnel
  // so suppression (clean mode, tutorial, busy modals) is honored.
  // Distinct from `hide-app`, which is the explicit user-intent path
  // (Esc / X button / global toggle) that intentionally bypasses
  // policy. See `plans/focus-state-audit.md` Issue 2.
  ipcMain.on('request-close-after', () => {
    tryDismissWindow('close-after', { closeAfter: true });
  });

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

  // Resource snapshot for the status bar's CPU / RAM monitor. Aggregates
  // every Electron process (main, renderer, GPU, utility) via
  // `app.getAppMetrics()`. Returning a single rollup keeps the status
  // bar simple — users don't care which sub-process owns which slice,
  // only "is the launcher heavy right now".
  //
  //   - cpuPct: % of TOTAL system CPU (0..100). Electron's
  //     `percentCPUUsage` is per-core (100 == one full core), so a
  //     naive sum can hit 800+ on an 8-core CPU during a render
  //     burst, which reads to users as "the launcher is eating my
  //     PC". We normalize against `os.cpus().length` so the number
  //     is comparable to Task Manager's overall CPU column.
  //   - memMB:  resident RAM in megabytes. Sum across procs.
  //     workingSet is the closest analogue to what Task Manager
  //     shows on Windows.
  //   - procs:  process count, useful for spotting GPU/utility leaks.
  //   - perProc: optional list of {type, cpuPct, memMB} for the
  //     status-bar tooltip. Lets curious users see who's using what
  //     without forcing the always-visible label to look noisy.
  const os = require('os');
  ipcMain.handle('get-resource-stats', () => {
    try {
      const metrics = app.getAppMetrics();
      const cores = Math.max(1, os.cpus()?.length || 1);
      let cpuRawSum = 0;     // sum of per-core percentages (0..cores*100)
      let memKB = 0;
      const perProc = metrics.map(m => {
        const c = m.cpu?.percentCPUUsage ?? 0;
        const k = m.memory?.workingSetSize ?? 0;
        cpuRawSum += c;
        memKB     += k;
        return {
          type:   m.type || 'unknown',
          cpuPct: Math.round((c / cores) * 10) / 10,
          memMB:  Math.round(k / 1024),
        };
      });
      const cpuPctNormalized = Math.min(100, cpuRawSum / cores);
      return {
        cpuPct: Math.round(cpuPctNormalized * 10) / 10,    // % of total system CPU
        memMB:  Math.round(memKB / 1024),                  // KB → MB
        procs:  metrics.length,
        cores,
        perProc,
      };
    } catch (e) {
      log.warn('[resource-stats] failed', e?.message);
      return { cpuPct: 0, memMB: 0, procs: 0, cores: 1, perProc: [] };
    }
  });

  ipcMain.on('set-opacity', (_, opacity) => mainWindow?.setOpacity(opacity));

  // Launcher size as % of the active monitor's work area. SSOT for
  // every resize code path (/N slash, slider, preset, settings). The
  // handler clamps to the valid range, persists into electron-store,
  // updates the in-memory cache, and applies setBounds. Persistence
  // is done from main rather than relying on the renderer's
  // updateSettings round-trip so /N (which originates in the
  // renderer's command bar but lands here via resize-active-window
  // too) and settings stay perfectly in sync.
  ipcMain.on('set-window-size-pct', (_, pct, anchor) => {
    const clamped = Math.max(25, Math.min(100, Math.round(Number(pct) || 100)));
    cachedWindowSizePct = clamped;
    persistWindowSizePct(clamped);
    if (mainWindow && !mainWindow.isDestroyed()) {
      applyWindowSizePct(mainWindow, clamped, anchor === 'bottom' ? 'bottom' : 'center');
    }
  });
  ipcMain.on('set-suppress-autohide', (_, suppress, source = 'default') => {
    if (suppress) suppressAutoHideSources.add(source);
    else suppressAutoHideSources.delete(source);
  });
  ipcMain.on('set-auto-hide', (_, autoHide) => {
    cachedAutoHide = !!autoHide;
  });
  ipcMain.on('set-window-open-at', (_, mode) => {
    cachedWindowOpenAt = (mode === 'last' ? 'last' : 'cursor');
  });

  // ── Auth: safeStorage-backed token persistence ─────────────────
  // Tokens (Supabase access/refresh) live in OS-encrypted storage
  // (DPAPI on Windows, Keychain on macOS) via Electron's safeStorage.
  // We store as a single JSON blob keyed under appData.authSession so
  // the renderer reads/writes the whole session atomically.
  ipcMain.handle('auth:get-session', () => {
    try {
      const enc = store.get('authSessionEnc');
      if (!enc || !safeStorage.isEncryptionAvailable()) return null;
      const raw = safeStorage.decryptString(Buffer.from(enc, 'base64'));
      return JSON.parse(raw);
    } catch (err) {
      log.warn('[auth] get-session failed:', err.message);
      return null;
    }
  });
  ipcMain.handle('auth:set-session', (_, session) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        log.error('[auth] safeStorage unavailable — refusing to persist session in plain text');
        return false;
      }
      if (!session) {
        store.delete('authSessionEnc');
        return true;
      }
      const enc = safeStorage.encryptString(JSON.stringify(session));
      store.set('authSessionEnc', enc.toString('base64'));
      return true;
    } catch (err) {
      log.warn('[auth] set-session failed:', err.message);
      return false;
    }
  });
  ipcMain.handle('auth:open-oauth-url', (_, url) => {
    // Open the Supabase-issued OAuth URL in the user's default browser.
    // The browser does the provider dance and the OS hands the
    // nost://auth-callback#tokens redirect back to us via the deep
    // link handler at the top of this file.
    return shell.openExternal(url);
  });
  // Renderer asks for the deep link captured before mainWindow was ready
  ipcMain.handle('auth:consume-pending-deep-link', () => {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    return url;
  });

  // ── Auth: generic encrypted KV for supabase-js short-lived keys ──
  // PKCE flow stores a `*-code-verifier` alongside the session token.
  // The verifier lives in renderer memory by default, which loses it
  // any time a fresh Electron instance handles the OAuth callback —
  // exactly what happens in dev-mode when Windows spawns a new
  // electron.exe to honour the `nost://` protocol click instead of
  // routing it through the single-instance lock. Persisting every
  // supabase-js storage key under safeStorage means the verifier
  // survives that hand-off, so `exchangeCodeForSession` finds what it
  // needs regardless of which instance receives the callback.
  ipcMain.handle('auth:kv-get', (_, key) => {
    try {
      const map = store.get('authKv');
      const enc = map && map[key];
      if (!enc || !safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch (err) {
      log.warn('[auth] kv-get failed:', key, err.message);
      return null;
    }
  });
  ipcMain.handle('auth:kv-set', (_, key, value) => {
    try {
      const map = store.get('authKv') || {};
      if (value == null) {
        delete map[key];
        store.set('authKv', map);
        return true;
      }
      if (!safeStorage.isEncryptionAvailable()) return false;
      const enc = safeStorage.encryptString(String(value));
      map[key] = enc.toString('base64');
      store.set('authKv', map);
      return true;
    } catch (err) {
      log.warn('[auth] kv-set failed:', key, err.message);
      return false;
    }
  });
  /** Stable per-install device identity for sync. The deviceId is a
   *  UUID generated and cached on first call; hostname/platform are
   *  read live (cheap, ~µs). Phase 2 sync uses these to identify which
   *  PC produced each snapshot edit and to enforce Free device quotas.
   *  No PII beyond hostname (which the user can rename in OS). */
  ipcMain.handle('device:get-info', () => {
    const os = require('os');
    let deviceId = store.get('deviceId');
    if (!deviceId || typeof deviceId !== 'string') {
      deviceId = require('crypto').randomUUID();
      store.set('deviceId', deviceId);
    }
    return {
      deviceId,
      hostname: os.hostname(),
      platform: process.platform,  // 'win32' / 'darwin' / 'linux'
    };
  });

  ipcMain.handle('auth:kv-list', () => {
    // Bulk hydrate: renderer pulls every persisted supabase key into
    // its sync memCache on boot so getItem() sees the verifier the
    // moment exchangeCodeForSession asks for it.
    try {
      const map = store.get('authKv');
      if (!map || !safeStorage.isEncryptionAvailable()) return {};
      const out = {};
      for (const k of Object.keys(map)) {
        try { out[k] = safeStorage.decryptString(Buffer.from(map[k], 'base64')); }
        catch { /* skip corrupt entry */ }
      }
      return out;
    } catch (err) {
      log.warn('[auth] kv-list failed:', err.message);
      return {};
    }
  });

  // Read a small text file from disk for the memo drag-drop flow.
  // Cap at 1 MB — anything bigger probably isn't a note and shouldn't
  // live inside a memo card. Detect BOM-marked UTF-16/8 first; for
  // bare bytes try UTF-8 strict, fall back to EUC-KR (cp949) which
  // covers the common Korean Windows .txt case.
  ipcMain.handle('read-text-file', async (_, filePath, maxBytes = 1024 * 1024) => {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > maxBytes) return { ok: false, reason: 'too-large', size: stat.size };
      const buf = await fs.promises.readFile(filePath);
      let enc = 'utf-8';
      if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) enc = 'utf-16le';
      else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) enc = 'utf-16be';
      else if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) enc = 'utf-8';
      else {
        try { new TextDecoder('utf-8', { fatal: true }).decode(buf); enc = 'utf-8'; }
        catch { enc = 'euc-kr'; }
      }
      const text = new TextDecoder(enc, { fatal: false }).decode(buf);
      return { ok: true, text, encoding: enc };
    } catch (err) {
      return { ok: false, reason: 'read-error', error: String(err?.message ?? err) };
    }
  });

  /** Re-register the global shortcut with a new key combo from settings. */
  ipcMain.on('update-shortcut', (_, newShortcut) => registerShortcut(newShortcut));

  // ── 12b. Persistent Storage ──────────────────────────────────────

  ipcMain.handle('store-load', () => store.get('appData', null));

  ipcMain.handle('store-save', (_, data) => {
    // Diff badgeSize BEFORE we overwrite the store so we can detect a
    // change and live-push it to the overlays. Without this, settings
    // dialog edits to the badge size slider would only take visual
    // effect after the next badge mutation (pin/unpin/move) or app
    // restart — both of which feel broken from the user's perspective.
    const prevBadgeSize = (store.get('appData') || {})?.settings?.badgeSize ?? 46;
    store.set('appData', data);
    // Keep the Windows startup entry in sync with the autoLaunch toggle
    if (data?.settings) {
      app.setLoginItemSettings({ openAtLogin: !!data.settings.autoLaunch });
    }
    const nextBadgeSize = data?.settings?.badgeSize ?? 46;
    if (nextBadgeSize !== prevBadgeSize) {
      // Re-push to every existing overlay so the new size lands
      // immediately. pushBadgeStateAll is a no-op when no overlays
      // exist (e.g. user has zero badges pinned).
      pushBadgeStateAll();
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

  // ── 12c-bis. Memo (사라지는 메모) — txt export ───────────────────
  //
  // Renderer hands us {body, slug, customFolder?}; we write a UTF-8
  // text file to either the user's chosen folder or the default
  // %APPDATA%/nost/memos/. Shell-opens the file so it lands in the OS
  // default editor (notepad / VSCode / whatever the user picked for
  // .txt). Returns the absolute path so the renderer can also turn
  // the memo card into a file card pointing at it.
  //
  // Filename: ${slug}_${YYYYMMDD}.txt — collisions get a numeric suffix.
  // Why we don't trust the renderer's filename: NTFS forbidden chars
  // and length limits are easier to enforce here in one place.
  ipcMain.handle('memo-export-txt', async (_e, args) => {
    try {
      const { body, slug, customFolder, openAfter } = (args && typeof args === 'object') ? args : {};
      if (typeof body !== 'string') return { success: false, reason: 'invalid-body' };
      const baseSlug = (typeof slug === 'string' && slug.trim()) ? slug.trim() : '메모';

      // Pick the destination folder. Renderer can override via
      // customFolder (validated for existence), default = userData/memos.
      let folder = path.join(app.getPath('userData'), 'memos');
      if (typeof customFolder === 'string' && customFolder.trim()) {
        try {
          const stat = fs.statSync(customFolder);
          if (stat.isDirectory()) folder = customFolder;
        } catch { /* fall back to default */ }
      }
      try { fs.mkdirSync(folder, { recursive: true }); }
      catch (e) { return { success: false, reason: `mkdir: ${String(e)}` }; }

      // Date suffix in local time.
      const d = new Date();
      const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;

      // Sanitize slug for NTFS — defence-in-depth (renderer slugifies too).
      const safeSlug = baseSlug.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 40) || '메모';

      // Find a non-colliding filename.
      let filename = `${safeSlug}_${ymd}.txt`;
      let candidate = path.join(folder, filename);
      let n = 2;
      while (fs.existsSync(candidate) && n < 100) {
        filename = `${safeSlug}_${ymd}_${n}.txt`;
        candidate = path.join(folder, filename);
        n++;
      }

      // Write with UTF-8 BOM so legacy Notepad on Win10 still detects
      // Korean correctly. Newer Notepad (Win11) is fine without it,
      // but BOM is harmless either way.
      const BOM = '﻿';
      fs.writeFileSync(candidate, BOM + body, 'utf-8');

      if (openAfter) {
        // Don't await; we want the response back immediately.
        shell.openPath(candidate).catch(() => {});
      }
      return { success: true, filePath: candidate };
    } catch (e) {
      return { success: false, reason: String(e) };
    }
  });

  // Open the memos folder (or the user's custom folder) in Explorer.
  // Used by the settings page "변경" / "폴더 열기" affordance.
  ipcMain.handle('memo-open-folder', async (_e, customFolder) => {
    try {
      let folder = path.join(app.getPath('userData'), 'memos');
      if (typeof customFolder === 'string' && customFolder.trim()) {
        try {
          const stat = fs.statSync(customFolder);
          if (stat.isDirectory()) folder = customFolder;
        } catch { /* fall back */ }
      }
      try { fs.mkdirSync(folder, { recursive: true }); } catch { /* no-op */ }
      shell.openPath(folder);
      return { success: true, filePath: folder };
    } catch (e) { return { success: false, reason: String(e) }; }
  });

  // Resolve the default memo folder (used when settings.memo.exportFolder is unset).
  // Renderer shows this in the settings UI as a placeholder/preview.
  ipcMain.handle('memo-default-folder', () => {
    return path.join(app.getPath('userData'), 'memos');
  });

  /**
   * Save-as dialog flow — pop the OS file picker, write the body to
   * the chosen path, return the path. This replaces the previous
   * "write to fixed folder + open external + delete card" behaviour
   * for both the card 💾 button and the editor 내보내기 button.
   * "다른 이름으로 저장" is a SNAPSHOT — caller does NOT delete the
   * memo, we do NOT shell-open the file. User explicitly flagged
   * the previous flow as wrong.
   */
  ipcMain.handle('memo-save-as', async (_e, args) => {
    try {
      const { body, slug, format } = (args && typeof args === 'object') ? args : {};
      if (typeof body !== 'string') return { success: false, reason: 'invalid-body' };
      const baseSlug = (typeof slug === 'string' && slug.trim()) ? slug.trim() : '메모';
      const safeSlug = baseSlug.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || '메모';
      const isMarkdown = format === 'md';
      const ext = isMarkdown ? 'md' : 'txt';
      // Filter order matters: the FIRST filter is the default selection
      // in the dialog. Reorder by `format` so the user's chosen
      // tool drives both the default extension and the filter list.
      const filters = isMarkdown
        ? [
            { name: '마크다운',     extensions: ['md', 'markdown'] },
            { name: '텍스트 파일', extensions: ['txt'] },
            { name: '모든 파일',    extensions: ['*'] },
          ]
        : [
            { name: '텍스트 파일', extensions: ['txt'] },
            { name: '마크다운',     extensions: ['md', 'markdown'] },
            { name: '모든 파일',    extensions: ['*'] },
          ];
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: '메모 저장',
        defaultPath: `${safeSlug}.${ext}`,
        filters,
      });
      if (canceled || !filePath) return { success: false, reason: 'canceled' };
      // BOM keeps Win10 Notepad happy on Korean .txt; harmless for .md.
      const BOM = '﻿';
      fs.writeFileSync(filePath, BOM + body, 'utf-8');
      return { success: true, filePath };
    } catch (e) {
      return { success: false, reason: String(e) };
    }
  });

  /**
   * Open the body in the user's default text editor — writes a
   * temp file (userData/memos with collision-safe suffix) and
   * shell-opens. Separate button from save-as; the user wanted
   * "메모장에서 열기" as a distinct affordance. Doesn't delete the
   * memo either — external open is a view, not a move.
   */
  ipcMain.handle('memo-open-external', async (_e, args) => {
    try {
      const { body, slug } = (args && typeof args === 'object') ? args : {};
      if (typeof body !== 'string') return { success: false, reason: 'invalid-body' };
      const baseSlug = (typeof slug === 'string' && slug.trim()) ? slug.trim() : '메모';
      const safeSlug = baseSlug.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 40) || '메모';
      const folder = path.join(app.getPath('userData'), 'memos');
      try { fs.mkdirSync(folder, { recursive: true }); }
      catch (e) { return { success: false, reason: `mkdir: ${String(e)}` }; }
      const d = new Date();
      const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      let filename = `${safeSlug}_${ymd}.txt`;
      let candidate = path.join(folder, filename);
      let n = 2;
      while (fs.existsSync(candidate) && n < 100) {
        filename = `${safeSlug}_${ymd}_${n}.txt`;
        candidate = path.join(folder, filename);
        n++;
      }
      const BOM = '﻿';
      fs.writeFileSync(candidate, BOM + body, 'utf-8');
      shell.openPath(candidate).catch(() => {});
      return { success: true, filePath: candidate };
    } catch (e) {
      return { success: false, reason: String(e) };
    }
  });

  // ── 12d. Clipboard ───────────────────────────────────────────────

  ipcMain.handle('read-clipboard', async () => {
    // Fast path: plain text; slow path: Explorer file-drop via PS
    return clipboard.readText() || await readClipboardFileDrop();
  });

  // ── Document cohort scan (v1.3.34+) ────────────────────────────
  //
  // Lists files in `directory` whose basename matches a renderer-provided
  // glob `mask` (e.g. "기획서_v{token}.docx"). The `{token}` placeholder
  // is converted to a permissive `.*?` here so the renderer's regex-based
  // comparator can do precise ranking on the returned set.
  //
  // SECURITY: directory MUST be a valid absolute Windows path. We refuse
  // to scan UNC roots and bare drive letters to keep accidental wide-net
  // scans bounded; the renderer always passes the dirname of an existing
  // file, so this never bites in practice.
  ipcMain.handle('list-doc-cohort', async (_event, directory, mask) => {
    try {
      if (typeof directory !== 'string' || typeof mask !== 'string') {
        return { ok: false, error: 'invalid-args', items: [] };
      }
      // Path safety. Allow `C:\subdir\...` and `\\server\share\subdir\...`,
      // refuse `C:\`, `\\server\`, or anything with traversal markers.
      const norm = directory.replace(/[\\/]+$/, '');
      if (!/^[A-Za-z]:\\.+/.test(norm) && !/^\\\\.+\\.+/.test(norm)) {
        return { ok: false, error: 'unsafe-path', items: [] };
      }
      if (norm.includes('..')) {
        return { ok: false, error: 'traversal', items: [] };
      }

      // Build matching regex from the mask. Two placeholders expand to
      // `.*?` (non-greedy):
      //   {token}  — the version token slot (date/numeric/etc.)
      //   {*}      — the per-revision suffix slot. Introduced in v1.3.36
      //              so a cohort root with a `_F` / `_콘진` suffix still
      //              matches siblings that have a different / no suffix.
      // Everything else in the mask is escaped so a literal `.` in the
      // basename doesn't gobble across separators.
      const escaped = mask
        .replace(/[-\\/\\^$*+?.()|[\]{}]/g, '\\$&')
        .replace(/\\\{token\\\}/g, '.*?')
        .replace(/\\\{\\\*\\\}/g, '.*?');
      const re = new RegExp(`^${escaped}$`, 'i');

      let entries;
      try {
        entries = fs.readdirSync(norm, { withFileTypes: true });
      } catch (e) {
        return { ok: false, error: 'readdir-failed', message: String(e && e.message), items: [] };
      }

      const items = [];
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        if (!re.test(ent.name)) continue;
        const full = path.join(norm, ent.name);
        try {
          const st = fs.statSync(full);
          items.push({
            basename: ent.name,
            path:     full,
            mtime:    st.mtimeMs,
            size:     st.size,
          });
        } catch { /* skip files we can't stat */ }
      }
      // Cap the result at 200 — we never expect users to have more
      // versions than that, and an unbounded directory (e.g. user picked
      // their downloads root by mistake) shouldn't choke the renderer.
      return { ok: true, items: items.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: 'unexpected', message: String(e && e.message), items: [] };
    }
  });

  // SSOT clipboard classification.
  // v1.3.34 — 'doc' is now a real return type. Renderer's
  // `documentExtensions` setting drives detection: any path whose
  // extension matches gets `'doc'` instead of being lumped into 'app'.
  // The arg is optional for back-compat; absent → conservative default
  // list (same shape as lib/documentExtensions.ts::DEFAULT_DOCUMENT_EXTENSIONS).
  // Clipboard hash cache — idle clients poll this every ~1.5s. When the
  // clipboard hasn't changed, the cached result is byte-identical to what
  // the classifier would compute again, so skipping the work is free.
  // The renderer's poll cadence stays the same; this just makes 99% of
  // polls a hash-compare + early return.
  let lastClipboardHash = '';
  let lastClipboardResult = null;
  let lastClipboardDocExts = '';
  ipcMain.handle('analyze-clipboard', async (_event, docExtensions) => {
    let text = clipboard.readText().trim();
    if (!text) text = await readClipboardFileDrop();
    if (!text) return { type: 'none' };
    // Cache key combines the clipboard text AND the docExts list — if the
    // user changed their document-extensions setting between polls, we
    // must reclassify. Hash is cheap (string concat + native string ===).
    const docExtsKey = Array.isArray(docExtensions) ? docExtensions.join(',') : '';
    if (text === lastClipboardHash && docExtsKey === lastClipboardDocExts && lastClipboardResult) {
      return lastClipboardResult;
    }
    const result = await (async () => {
    const DEFAULT_DOC_EXTS = [
      'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'hwp', 'hwpx', 'hwt',
      'pdf', 'txt', 'md', 'csv',
      'odt', 'ods', 'odp',
    ];
    const docExts = Array.isArray(docExtensions) && docExtensions.length > 0
      ? docExtensions.map(e => String(e).toLowerCase().replace(/^\./, ''))
      : DEFAULT_DOC_EXTS;
    // The HTML payload (when present) is what gives the renderer
    // a chance to faithfully reconstruct markdown structure for
    // pasted GPT/Notion content. We pass it through unchanged
    // alongside the plain twin; the renderer decides whether to
    // use it. Empty string when the clipboard has no HTML format.
    let html = '';
    try { html = clipboard.readHTML() || ''; } catch { /* some formats throw */ }

    // URL
    if (/^https?:\/\//i.test(text)) {
      try {
        const u = new URL(text);
        return { type: 'url', value: text, label: u.hostname.replace(/^www\./, '') };
      } catch { /* fall through */ }
    }

    // Windows absolute path. Resolution order:
    //   1. Filesystem stat — most reliable when the path actually
    //      exists. Distinguishes folder vs file deterministically.
    //   2. Heuristic fallback — when the path doesn't exist (yet)
    //      OR fs throws (permission, network share offline). Includes
    //      a dotfile-name carve-out: `D:\.claude` style paths used
    //      to fail because `\.claude` matched the file-extension
    //      regex (`.claude` looks like 6-char extension).
    // Classify an existing file by its extension. Mirrors
    // inferItemFromPath in App.tsx; keep the two logically in sync.
    const classifyFile = (filePath, basename) => {
      const m = basename.match(/\.([a-zA-Z0-9]+)$/);
      const ext = m ? m[1].toLowerCase() : '';
      if (ext === 'exe') return { type: 'app', value: filePath, label: basename.replace(/\.exe$/i, '') };
      if (ext && docExts.includes(ext)) return { type: 'doc', value: filePath, label: basename.replace(/\.[a-zA-Z0-9]+$/, '') };
      // Other / unknown — fall back to app so the launcher still works
      // (shell-execute routes via Windows default associations).
      return { type: 'app', value: filePath, label: basename.replace(/\.[a-zA-Z0-9]+$/, '') };
    };

    if (/^[A-Za-z]:\\/.test(text) || text.startsWith('\\\\')) {
      const name = text.split(/[/\\]/).filter(Boolean).pop() || text;

      // (1) Filesystem stat — sync is fine; this handler is async
      //     and clipboard analysis runs at most every 1.5 s.
      try {
        const stat = fs.statSync(text);
        if (stat.isDirectory()) {
          return { type: 'folder', value: text.replace(/[/\\]+$/, ''), label: name };
        }
        if (stat.isFile()) {
          return classifyFile(text, name);
        }
      } catch { /* path doesn't exist or no permission — fall through */ }

      // (2) Heuristic. dotfile-style names (`.claude`, `.config`,
      //     `.git`) are conventionally folders, NOT files with a
      //     ".claude" extension. Detect by leading dot + no further
      //     dot in the basename.
      const isDotName = name.startsWith('.') && !name.slice(1).includes('.');
      const extMatch = !isDotName && name.match(/\.([a-zA-Z0-9]{1,6})$/);
      if (extMatch) {
        // Heuristic match: file with recognisable extension → same
        // classifier as the on-disk branch.
        return classifyFile(text, name);
      }
      if (!extMatch || /[/\\]$/.test(text)) {
        return { type: 'folder', value: text.replace(/[/\\]+$/, ''), label: name };
      }
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

    // Plain text fallback — accepts both single-line snippets AND
    // multiline blobs. The renderer offers two destinations
    // (clipboard text card OR memo) so multiline content is not
    // only welcome but expected (memo is the natural home for
    // pasted prose / GPT output).
    //
    //   - min length: 2 chars (drops accidental 1-char selects)
    //   - max length: 50_000 chars (defends against the
    //     occasional binary-blob accident; legitimate memos are
    //     well under this)
    //   - newlines allowed (was previously rejected — that's
    //     exactly the case the user reported as broken)
    //
    // Label = first non-empty line, capped at 40 chars + ellipsis.
    // This reads better than "first 40 chars including the heading
    // hash and bullets" since the actual title of a pasted memo is
    // almost always its first content line.
    {
      if (text.length >= 2 && text.length <= 50_000) {
        const firstLine = text.split(/\r?\n/).find(l => l.trim().length > 0) ?? text;
        const trimmed = firstLine.trim();
        const label = trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed;
        return { type: 'text', value: text, label, html };
      }
    }

    return { type: 'none' };
    })();
    // Cache for the next poll (idle clients hit this every ~1.5 s).
    lastClipboardHash = text;
    lastClipboardDocExts = docExtsKey;
    lastClipboardResult = result;
    return result;
  });

  // ── 12e. App Launching ───────────────────────────────────────────

  ipcMain.on('open-url', (_, url, closeAfter) => {
    // Prefer focusing an existing Chrome tab over opening a new browser window
    const tab = findChromeTabByHost(url);
    if (tab) sendSse({ action: 'focus', tabId: tab.id, windowId: tab.windowId });
    else     shell.openExternal(url);
    maybeCloseAfter(closeAfter);
    armLaunchGrace(closeAfter);
    reassertTopAfterLaunch(closeAfter);
  });

  ipcMain.on('open-path', (_, folderPath, closeAfter) => {
    // PS script focuses an existing Explorer window at this path, or opens a new one
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps('open-path.ps1')}"`, {
      env: { ...process.env, QL_PATH: folderPath },
    });
    maybeCloseAfter(closeAfter);
    armLaunchGrace(closeAfter);
    reassertTopAfterLaunch(closeAfter);
  });

  ipcMain.on('run-cmd', (_, command, closeAfter) => {
    // Wrap in cmd /c so batch files, pipes, and built-in commands work
    exec(`cmd /c ${command}`, { windowsHide: false }, (err) => {
      if (err) console.error('[run-cmd]', err.message);
    });
    maybeCloseAfter(closeAfter);
    armLaunchGrace(closeAfter);
    reassertTopAfterLaunch(closeAfter);
  });

  ipcMain.on('copy-text', (_, text, closeAfter) => {
    clipboard.writeText(text);
    // Brief delay so React can finish rendering the "복사됨" toast before hiding
    maybeCloseAfter(closeAfter, 700);
    // copy doesn't launch external app — no top reassert needed
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
    maybeCloseAfter(closeAfter);
    armLaunchGrace(closeAfter);
    reassertTopAfterLaunch(closeAfter);
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
    maybeCloseAfter(closeAfter);
    armLaunchGrace(closeAfter);
    reassertTopAfterLaunch(closeAfter);
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
    // Funnel through the SSOT resize helper so `/N` matches the slider
    // and preset paths byte-for-byte. Persist the new pct into
    // settings so subsequent invocations (cold start, show after
    // hide, hidden→show settings change) reuse it — the user's
    // "code policy unification" requirement.
    const clamped = Math.max(25, Math.min(100, Math.round(Number(pct) || 100)));
    applyWindowSizePct(win, clamped);
    cachedWindowSizePct = clamped;
    persistWindowSizePct(clamped);
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

    // Fast path env: when we have a cached PS-unaware work area for this
    // monitor, hand it to PS so the script can skip Add-Type
    // System.Windows.Forms (~250-400 ms first-time) and the monitor
    // enumeration loop. Cache invalidates on every Electron display
    // event, so a stale value can only persist within a single tile
    // invocation — not across configuration changes.
    const cachedWA = psWorkAreaCache.get(monitor);
    const cacheEnv = cachedWA ? {
      QL_PS_WA_X: String(cachedWA.X),
      QL_PS_WA_Y: String(cachedWA.Y),
      QL_PS_WA_W: String(cachedWA.W),
      QL_PS_WA_H: String(cachedWA.H),
      QL_SKIP_MONITOR_DIAG: '1',
    } : {};
    if (cachedWA) {
      log.debug(`[tile-cache] using cached PS-WA for monitor=${monitor}: (${cachedWA.X},${cachedWA.Y},${cachedWA.W}x${cachedWA.H})`);
    } else {
      log.debug(`[tile-cache] miss for monitor=${monitor} — PS will enumerate, capturing for next call`);
    }

    const psPromise  = runPsAsync('run-tile-ps.ps1', {
      ...monitorEnvFor(monitor),
      ...cacheEnv,
      QL_ITEMS: JSON.stringify(flagged),
    }, {
      timeout: 60000,  // PS's internal deadline is 45s + settle passes; breathing room
      // Stream each PS stdout line into the main log as it's emitted
      // (instead of waiting for PS to exit). When the tile pipeline is slow
      // — e.g. waiting for Office splash window — this lets us distinguish
      // "still searching" from "hung" in real time instead of staring at a
      // silent log for 45 s and assuming tiling failed.
      // While we're at it, sniff for the "[diag] picked PS-enum mon#K"
      // line so we can populate `psWorkAreaCache` from the first run's
      // enumeration result. The regex is the only piece of this that's
      // tightly coupled to PS output format — _Position.ps1's
      // Get-NativeWorkArea owns that line, so changes to its format
      // need to update both sides.
      onLine: (line) => {
        log.debug(`[tile/ps] ${line}`);
        if (cachedWA) return;  // already cached this run
        const m = /\[diag\] picked PS-enum mon#(\d+).*work=\((-?\d+),(-?\d+),(\d+)x(\d+)\)/.exec(line);
        if (m && Number(m[1]) === Number(monitor)) {
          const wa = { X: Number(m[2]), Y: Number(m[3]), W: Number(m[4]), H: Number(m[5]) };
          psWorkAreaCache.set(monitor, wa);
          log.debug(`[tile-cache] captured PS-WA for monitor=${monitor}: (${wa.X},${wa.Y},${wa.W}x${wa.H})`);
        }
      },
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

    // Per-monitor overlay window sized as a fraction of each monitor's
    // OWN work area — not a hardcoded 200×200. Earlier versions used
    // a fixed size that:
    //   - looked tiny on a 4K screen (the "1" was barely readable)
    //   - drifted off-centre on portrait or oddly-sized monitors
    //   - landed under the taskbar on the primary (display.bounds
    //     includes the taskbar; workArea excludes it)
    // We now scale to the shorter edge of workArea and re-centre on
    // workArea (not bounds), which fixes the clamping/positioning
    // complaints. Sizing math respects display.scaleFactor implicitly
    // because workArea is in DIP — Electron's BrowserWindow setBounds
    // takes the same coord space.
    const accentHex = (() => {
      try {
        const a = store.get('appData')?.settings?.accentColor;
        return typeof a === 'string' && /^#[0-9a-f]{6}$/i.test(a) ? a : '#6366f1';
      } catch { return '#6366f1'; }
    })();
    // RGB triple for use in rgba() — keeps the glow tinted by the
    // user's chosen accent without baking a constant.
    const accentRgb = (() => {
      const n = parseInt(accentHex.slice(1), 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    })();
    const theme = store.get('appData')?.settings?.theme;
    const isLight = theme === 'light';
    const surface = isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(12, 12, 22, 0.78)';
    const textColor = isLight ? '#0f172a' : '#f8fafc';
    const subText = isLight ? 'rgba(15, 23, 42, 0.6)' : 'rgba(248, 250, 252, 0.55)';

    const wins = displays.map((display, i) => {
      const wa = display.workArea;
      const minEdge = Math.min(wa.width, wa.height);
      // Card is 30% of the shorter work-area edge, clamped to a
      // readable range so it doesn't disappear on a tiny secondary
      // monitor and doesn't dominate an ultrawide.
      const cardSize = Math.max(160, Math.min(320, Math.round(minEdge * 0.3)));
      const winSize  = cardSize + 40; // outer window has glow room beyond the card
      const winX = wa.x + Math.round((wa.width  - winSize) / 2);
      const winY = wa.y + Math.round((wa.height - winSize) / 2);

      const win = new BrowserWindow({
        x: winX, y: winY,
        width: winSize, height: winSize,
        frame: false, transparent: true, alwaysOnTop: true,
        skipTaskbar: true, focusable: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}

      // Sub-label: index + (주) when primary + dimensions for context.
      // Earlier the label was just "주 모니터" / "보조 모니터" which
      // (a) didn't show the number on non-primary displays and (b)
      // labelled every secondary identically when there were 3+.
      const sub = `${display.bounds.width}×${display.bounds.height}` +
                  `${display.id === primary.id ? ' · 주' : ''}`;

      // Sizes scale with the card so a 320 card has a larger digit
      // than a 160 card. Card numerals dominate (50% of card edge).
      const numSize  = Math.round(cardSize * 0.5);
      const subSize  = Math.max(11, Math.round(cardSize * 0.07));
      const radius   = Math.round(cardSize * 0.13);

      const html = `<!DOCTYPE html><html style="margin:0;background:transparent;-webkit-font-smoothing:antialiased"><body style="margin:0;display:flex;align-items:center;justify-content:center;width:${winSize}px;height:${winSize}px;overflow:hidden">
        <div style="
          background:${surface};
          backdrop-filter:blur(32px) saturate(160%);
          -webkit-backdrop-filter:blur(32px) saturate(160%);
          border-radius:${radius}px;
          width:${cardSize}px;height:${cardSize}px;
          display:flex;align-items:center;justify-content:center;flex-direction:column;
          gap:${Math.round(cardSize * 0.04)}px;
          border:2px solid rgba(${accentRgb}, 0.55);
          box-shadow:
            0 0 0 1px rgba(${accentRgb}, 0.12),
            0 0 ${Math.round(cardSize * 0.3)}px rgba(${accentRgb}, 0.42),
            0 ${Math.round(cardSize * 0.06)}px ${Math.round(cardSize * 0.18)}px rgba(0,0,0,0.55);
          animation:nostMonIn 220ms cubic-bezier(0.22, 1, 0.36, 1);
        ">
          <div style="
            color:${textColor};
            font-size:${numSize}px;
            font-weight:900;
            font-family:system-ui,-apple-system,'Pretendard Variable',sans-serif;
            line-height:1;
            letter-spacing:-0.04em;
            text-shadow:0 0 ${Math.round(cardSize * 0.14)}px rgba(${accentRgb}, 0.6);
          ">${i + 1}</div>
          <div style="
            color:${subText};
            font-size:${subSize}px;
            font-family:system-ui,-apple-system,'Pretendard Variable',sans-serif;
            letter-spacing:0.04em;
            font-weight:500;
          ">${sub}</div>
        </div>
        <style>@keyframes nostMonIn{from{opacity:0;transform:scale(0.86)}to{opacity:1;transform:scale(1)}}</style>
      </body></html>`;
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

  /** Navigate the active file dialog to a specific folder path.
   *
   *  -STA is required: the PS script uses [System.Windows.Forms.Clipboard]
   *  to ferry the Unicode-safe path through the clipboard (replacing the
   *  old SendKeys-typing approach that mangled Korean characters). The
   *  managed Clipboard API needs STA threading; without -STA you get a
   *  "Current thread must be set to single thread apartment (STA) mode"
   *  exception and nothing pastes. */
  ipcMain.on('jump-to-dialog-folder', (_, folderPath) => {
    // Hand the dialog HWND through too — the PS script SetForegroundWindows
    // it before the keystroke sequence, so a user who clicked the popup (or
    // another app) since opening the dialog still gets the paste delivered
    // to the right place instead of whatever happens to be foreground.
    exec(`powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "${ps('jump-to-dialog-folder.ps1')}"`, {
      env: {
        ...process.env,
        QL_PATH: folderPath,
        QL_DIALOG_HWND: String(dialogTrackedHwnd || 0),
      },
    });
  });

  // ── Dialog companion popup IPC ───────────────────────────────────
  ipcMain.on('dialog-popup-request-state', () => pushDialogPopupState());
  ipcMain.on('dialog-popup-dismiss', () => {
    // Mark THIS dialog as dismissed so the poll doesn't reattach.
    dialogDismissedHwnd = dialogTrackedHwnd;
    destroyDialogPopupWindow();
  });
  /** Renderer signals "pointer is over the chip strip / open menu — let
   *  clicks reach me" or "pointer is in transparent area — make me
   *  click-through so the dialog gets the click". Same protocol the
   *  badges overlay uses for its forward-mouse-events click-through. */
  ipcMain.on('dialog-popup-set-capture', (_, capture) => {
    if (!dialogPopupWin || dialogPopupWin.isDestroyed()) return;
    if (capture) {
      dialogPopupWin.setIgnoreMouseEvents(false);
    } else {
      dialogPopupWin.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  // ── Satellite dialogs (v1.3.44+) ─────────────────────────────────
  // Each satellite shares the generic 4-channel IPC pattern (open /
  // request-state / action / closed). Closing actions list the action
  // kinds that should auto-destroy the satellite after forwarding to
  // mainWindow — terminal "I'm done" events like save / save-as-memo.
  // See plans/satellite-dialogs.md.
  registerSatelliteIpc('item-dialog', {
    width: 720, height: 640,
    preloadFile: 'preload-item-dialog.js',
    htmlFile: 'item-dialog.html',
    closingActions: ['save', 'request-advanced', 'pick-on-screen'],
  });
  registerSatelliteIpc('item-wizard', {
    width: 560, height: 580,
    preloadFile: 'preload-item-wizard.js',
    htmlFile: 'item-wizard.html',
    closingActions: ['save', 'save-as-memo'],
  });
  // SettingsDialog: wider since it's 4 groups × 2-3 sub-tabs.
  // save (live preview during slider drags) and start-tutorial /
  // open-memo-trash / extend-all-memos / empty-memo-trash do NOT close
  // the satellite — settings stays open across these. The user closes
  // explicitly via the dialog's own X / 적용 / 취소 buttons.
  registerSatelliteIpc('settings-dialog', {
    width: 880, height: 680,
    preloadFile: 'preload-settings-dialog.js',
    htmlFile: 'settings-dialog.html',
    closingActions: [],
  });
  registerSatelliteIpc('doc-cohort-dialog', {
    width: 640, height: 600,
    preloadFile: 'preload-doc-cohort-dialog.js',
    htmlFile: 'doc-cohort-dialog.html',
    closingActions: ['commit'],
  });
  registerSatelliteIpc('batch-drop-dialog', {
    width: 720, height: 640,
    preloadFile: 'preload-batch-drop-dialog.js',
    htmlFile: 'batch-drop-dialog.html',
    closingActions: ['confirm'],
  });
  registerSatelliteIpc('container-slot-picker', {
    width: 720, height: 640,
    preloadFile: 'preload-container-slot-picker.js',
    htmlFile: 'container-slot-picker.html',
    closingActions: ['save'],
  });

  // Reset to default position. Drag-to-move itself now goes through
  // Electron's native -webkit-app-region drag (BrowserWindow 'moved'
  // event persists the result) — no per-frame IPC like v1.3.43 had.
  ipcMain.on('dialog-popup-reset-position', () => {
    if (!dialogPopupWin || dialogPopupWin.isDestroyed() || !dialogLastRect) return;
    const display = getScreen().getDisplayMatching({
      x: dialogLastRect.x, y: dialogLastRect.y,
      width: dialogLastRect.width, height: dialogLastRect.height,
    });
    const wa  = display.workArea;
    const key = getMonitorKey(wa);
    const positions = store.get('dialogPopupPositions') || {};
    if (positions[key]) {
      delete positions[key];
      store.set('dialogPopupPositions', positions);
    }
    // Force re-position since the monitor key is unchanged but the
    // intent is to overwrite the current bounds with defaults.
    positionDialogPopup(dialogLastRect, { force: true });
  });

  // Start the dialog detection poll. Runs for the app lifetime — cheap
  // (one PS invocation every 600ms with a tiny payload). When no dialog
  // is in foreground the tick is essentially a no-op.
  startDialogPoll();

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
      perfBumpTimer('orb-drag');
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

  // ── Screen-capture color picker ─────────────────────────────────
  // Replaces the in-renderer EyeDropper API which can only sample
  // pixels inside the launcher's own window. The flow:
  //   1) hide the launcher so it's not in the screenshot
  //   2) capture the primary display via desktopCapturer
  //   3) open a fullscreen frameless window that renders the shot
  //   4) user moves cursor (magnifier follows), clicks to commit,
  //      Esc / OS-close to cancel
  //   5) always restore the launcher and resolve the renderer's invoke
  //
  // TODO(multi-display): v1 captures only the primary display. To
  // support multi-monitor we'd need either one picker window per
  // display each fed its own screenshot, or a single virtual-desktop-
  // sized window that stitches all sources — both require coordinate
  // translation (Electron screen DIPs ↔ thumbnail pixels) per display.
  let pickerInFlight = false;
  ipcMain.handle('eyedropper-pick', async () => {
    if (pickerInFlight) return { success: false, reason: 'busy' };
    pickerInFlight = true;

    const wasVisible = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
    const restoreLauncher = () => {
      try {
        if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
        }
      } catch (e) { log.warn('[picker] restore main failed', e); }
    };

    try {
      // 1. Hide the launcher so it doesn't appear in the screenshot.
      if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.hide(); } catch {}
      }
      // Wait one frame for the OS compositor to actually drop the window.
      await new Promise(r => setTimeout(r, 180));

      // 2. Capture the monitor under the cursor — not the primary.
      //    Earlier versions always captured the primary which surfaced
      //    "왜 다른 모니터 화면이 떠?" when the user opened the picker
      //    from the launcher running on a secondary display. Cursor-
      //    nearest matches user intent for global-shortcut and click-
      //    triggered invocations alike.
      const screen   = getScreen();
      const cursorPt = screen.getCursorScreenPoint();
      const target   = screen.getDisplayNearestPoint(cursorPt);
      const allDisplays = screen.getAllDisplays();
      const targetIndex = allDisplays.findIndex(d => d.id === target.id);
      const bounds   = target.bounds; // DIP
      const sf       = target.scaleFactor || 1;
      const physW    = Math.round(bounds.width  * sf);
      const physH    = Math.round(bounds.height * sf);
      log.info(`[picker] target display id=${target.id} index=${targetIndex + 1} bounds=(${bounds.x},${bounds.y},${bounds.width}x${bounds.height}) scale=${sf} physical=${physW}x${physH}`);

      let sources;
      try {
        sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: physW, height: physH },
        });
      } catch (e) {
        log.warn('[picker] desktopCapturer failed', e);
        restoreLauncher();
        pickerInFlight = false;
        return { success: false, reason: 'capture-failed' };
      }
      log.info(`[picker] desktopCapturer returned ${sources.length} source(s): ${sources.map(s => `id=${s.id} name="${s.name}" display_id=${s.display_id}`).join(' | ')}`);

      // Match the source by display_id; fall back to source-index = monitor-index.
      let src = null;
      const wantId = String(target.id);
      for (const s of sources) {
        if (s.display_id && String(s.display_id) === wantId) { src = s; break; }
      }
      // Fallback: Electron occasionally returns display_id="" on Windows.
      // The sources are ordered to match getAllDisplays() in that case,
      // so try the same index as our target display.
      if (!src && targetIndex >= 0 && sources[targetIndex]) src = sources[targetIndex];
      if (!src) src = sources[0];
      if (!src) {
        restoreLauncher();
        pickerInFlight = false;
        return { success: false, reason: 'no-source' };
      }
      const thumbSize = src.thumbnail.getSize();
      const isEmpty   = src.thumbnail.isEmpty();
      log.info(`[picker] selected source id=${src.id} name="${src.name}" thumbSize=${thumbSize.width}x${thumbSize.height} isEmpty=${isEmpty}`);
      if (isEmpty || thumbSize.width === 0 || thumbSize.height === 0) {
        log.warn('[picker] thumbnail is empty — capture returned blank (HDR / DRM / GPU acceleration off?)');
        restoreLauncher();
        pickerInFlight = false;
        return { success: false, reason: 'capture-blank' };
      }

      const dataUrl = src.thumbnail.toDataURL();

      // 3. Open the picker window over the TARGET display (cursor monitor).
      const win = new BrowserWindow({
        x: bounds.x, y: bounds.y,
        width:  bounds.width, height: bounds.height,
        frame: false,
        transparent: false,
        backgroundColor: '#000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        fullscreenable: false,
        hasShadow: false,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload-picker.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });

      // Lift above OS chrome / taskbar.
      try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}

      // 4. Wire result / cancel / close.
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        try { if (!win.isDestroyed()) win.close(); } catch {}
        restoreLauncher();
        pickerInFlight = false;
        resolveOuter(value);
      };

      let resolveOuter;
      const promise = new Promise(r => { resolveOuter = r; });

      const onResult = (e, hex) => {
        if (e.sender !== win.webContents) return;
        finish({ success: true, hex: String(hex || '').toUpperCase() });
      };
      const onCancel = (e) => {
        if (e.sender !== win.webContents) return;
        finish({ success: false, reason: 'canceled' });
      };
      ipcMain.on('picker-result', onResult);
      ipcMain.on('picker-cancel', onCancel);

      win.on('closed', () => {
        ipcMain.removeListener('picker-result', onResult);
        ipcMain.removeListener('picker-cancel', onCancel);
        finish({ success: false, reason: 'canceled' });
      });

      win.webContents.on('did-finish-load', () => {
        try {
          // Forward the monitor identity to the renderer so the picker
          // can show "모니터 N" in its hint chrome. That makes it
          // immediately obvious which screen the user is sampling
          // from — same diagnostic the user complained was missing.
          win.webContents.send('picker-init', {
            dataUrl,
            monitorIndex: targetIndex + 1,
            isPrimary: target.id === screen.getPrimaryDisplay().id,
            monitorCount: allDisplays.length,
          });
          win.show();
          win.focus();
        } catch (e) { log.warn('[picker] init send failed', e); }
      });

      try {
        await win.loadFile(path.join(__dirname, 'picker.html'));
      } catch (e) {
        log.warn('[picker] loadFile failed', e);
        finish({ success: false, reason: 'load-failed' });
      }

      return promise;
    } catch (e) {
      log.warn('[picker] unexpected', e);
      restoreLauncher();
      pickerInFlight = false;
      return { success: false, reason: 'error' };
    }
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

  /** Main renderer says the badge-fired group launch finished — relay
   *  to every overlay so the spinner ring on the originating badge
   *  can clear immediately (rather than waiting for the safety
   *  timeout). The overlay matches by refType+refId, not badge.id,
   *  since the badge may live in multiple presets/overlays. */
  ipcMain.on('badges-launch-done', (_e, payload) => {
    if (!payload || !payload.refType || !payload.refId) return;
    for (const win of badgeOverlays.values()) {
      if (win && !win.isDestroyed()) {
        try { win.webContents.send('badges-launch-done', payload); } catch {}
      }
    }
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
  /** Renderer's mount effect calls this; respond with state for THAT
   *  overlay's display only. (Each overlay sees only its share of the
   *  badges — see pushBadgeStateForDisplay.) */
  ipcMain.on('badges-request-state', (e) => {
    const displays = getScreen().getAllDisplays();
    for (const [displayId, win] of badgeOverlays) {
      if (win.webContents === e.sender) {
        const display = displays.find(d => d.id === displayId);
        if (display) pushBadgeStateForDisplay(display, win);
        return;
      }
    }
  });

  /** Overlay flips its click-through mode as the pointer enters/leaves
   *  badges. Routed by sender so each overlay's capture toggle is
   *  independent — we don't enable clicks across all displays just
   *  because the user is hovering a badge on one of them. */
  ipcMain.on('badges-set-capture', (e, capture) => {
    for (const win of badgeOverlays.values()) {
      if (win.webContents === e.sender) {
        if (capture) win.setIgnoreMouseEvents(false);
        else win.setIgnoreMouseEvents(true, { forward: true });
        return;
      }
    }
  });

  /** Overlay asks whether a screen point is inside the main nost window —
   *  used for the "drag-back-to-unpin" gesture. */
  ipcMain.handle('badges-is-inside-main', (_e, x, y) => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
    const b = mainWindow.getBounds();
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  });

  /** Overlay right-click → show a native context menu anchored at cursor.
   *  Pop the menu on the sending overlay (i.e. the display the badge is
   *  on) — `menu.popup({ window })` requires a real BrowserWindow ref. */
  ipcMain.on('badges-context-menu', (e, badgeId) => {
    let senderWin = null;
    for (const win of badgeOverlays.values()) {
      if (win.webContents === e.sender) { senderWin = win; break; }
    }
    if (!senderWin) return;
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
    menu.popup({ window: senderWin });
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

  // Chrome Web Store 직링크. 2026-04 승인된 nost-bridge 페이지로 보내서
  // 사용자는 "Chrome에 추가" 한 번이면 끝 — 개발자 모드 / 폴더 로드
  // 안내가 더이상 기본 경로가 아니다. Whale도 Chrome Web Store 호환이라
  // 같은 URL에서 설치 가능.
  const NOST_BRIDGE_EXTENSION_ID = 'fjehpjoninofepdoiakibjaokakihilo';

  ipcMain.handle('open-extension-store', async () => {
    const STORE_URL = `https://chromewebstore.google.com/detail/nost-bridge/${NOST_BRIDGE_EXTENSION_ID}`;
    try {
      await shell.openExternal(STORE_URL);
      return { success: true, url: STORE_URL };
    } catch (err) {
      return { success: false, reason: 'open-failed', error: String(err && err.message || err) };
    }
  });

  // Chrome ExternalExtensions 메커니즘. HKCU\Software\Google\Chrome\Extensions
  // 아래 확장 ID 키를 만들고 update_url을 박아두면, Chrome이 다음 실행
  // 시점에 "이 확장이 추가되었습니다" 알림을 띄우고 사용자가 한 번만
  // "활성화"를 눌러주면 끝. 스토어 페이지에서 "Chrome에 추가" → 권한
  // 다이얼로그 → 확인의 2-클릭 흐름이 1-클릭으로 줄어든다.
  //
  // 실패해도 치명적이지 않다 — 호출 측은 이걸 silent best-effort로
  // 쏘고 항상 스토어 URL을 폴백으로 같이 연다.
  ipcMain.handle('register-extension-external', async () => {
    if (process.platform !== 'win32') {
      return { success: false, reason: 'not-windows' };
    }

    const KEY = `HKCU\\Software\\Google\\Chrome\\Extensions\\${NOST_BRIDGE_EXTENSION_ID}`;
    const UPDATE_URL = 'https://clients2.google.com/service/update2/crx';
    const { execFile } = require('child_process');

    return await new Promise(resolve => {
      execFile(
        'reg.exe',
        ['add', KEY, '/v', 'update_url', '/t', 'REG_SZ', '/d', UPDATE_URL, '/f'],
        { windowsHide: true },
        (err) => {
          if (err) {
            resolve({ success: false, reason: 'reg-failed', error: String(err.message || err) });
          } else {
            resolve({ success: true });
          }
        }
      );
    });
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

  // Initialise the native foreground-window detector so the dialog poll
  // can use the koffi-bound user32 path instead of PS-spawning every
  // 600 ms. Failure here is non-fatal — the poll falls back to the PS
  // script automatically.
  foregroundWindow.init();

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
  // Listen for monitor add/remove/metrics changes so the PS work-area
  // cache invalidates whenever the display layout changes. Without
  // this, a tile after unplugging a monitor would land on a phantom.
  bindMonitorChangeInvalidator();

  // Apply Content Security Policy to all renderer page loads.
  // In dev mode (Vite dev server), allow inline scripts + ws:// connections so
  // React Refresh preamble and HMR work. Production stays strict.
  const isDev = !!process.env.ELECTRON_RENDERER_URL?.trim();
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:5173" : "script-src 'self'";
  // Supabase token exchange (PKCE), session refresh, and Phase 2 Realtime
  // (wss://) all hit the project's *.supabase.co host. OAuth avatars come
  // from Google's lh3.googleusercontent.com and GitHub's avatars.github-
  // usercontent.com — add to img-src so AccountTab's profile picture
  // doesn't fall back to the placeholder. supabase.co is also added to
  // img-src for self-hosted avatars (Phase 2+).
  const connectSrc = isDev
    ? "connect-src 'self' http://127.0.0.1:14502 http://127.0.0.1:5173 ws://127.0.0.1:5173 https://*.supabase.co wss://*.supabase.co"
    : "connect-src 'self' http://127.0.0.1:14502 https://*.supabase.co wss://*.supabase.co";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: https://www.google.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://*.supabase.co; " +
          scriptSrc + "; " +
          connectSrc,
        ],
      },
    });
  });

  createWindow();

  // ── Badge revival triggers ────────────────────────────────────────
  //
  // Watch for the events that empirically correlate with badge
  // overlays "disappearing": power state changes, main window getting
  // focus back, and slow-creep idle. Each fires reviveBadgeOverlays()
  // which re-asserts always-on-top + sends a fresh paint event,
  // enough to nudge DWM to re-register the windows in its z-order.
  try {
    const { powerMonitor } = require('electron');
    powerMonitor.on('resume',         () => reviveBadgeOverlays('power-resume'));
    powerMonitor.on('unlock-screen',  () => reviveBadgeOverlays('screen-unlock'));
    // 'on-ac' / 'on-battery' are noisy and don't correlate with the
    // bug — skipped intentionally.
  } catch (e) {
    log.warn('[badges] powerMonitor hook failed:', e?.message);
  }
  // mainWindow events: when user comes back to the launcher (or even
  // just opens it via shortcut), refresh overlays. show + focus both
  // because focus alone can miss the case where the launcher is
  // already focused but badges have rotted in the meantime.
  if (mainWindow) {
    mainWindow.on('show',  () => reviveBadgeOverlays('main-show'));
    mainWindow.on('focus', () => reviveBadgeOverlays('main-focus'));
  }
  // Periodic safety net for the "(d) just disappears over time" case.
  // 60 s is long enough not to cost anything, short enough that the
  // user notices recovery within a minute.
  setInterval(() => reviveBadgeOverlays('periodic'), 60_000);

  // Floating orb + pinned-badge BrowserWindow spawn is DEFERRED to
  // after the renderer signals boot complete (`renderer-ready`).
  // Reason: each BrowserWindow allocation hits Chromium's GPU disk
  // cache + GL context init, and cold-start collisions between the
  // main window, the orb, and N pinned badges all racing each
  // other was the cause of the desktop-wide mouse stutter the user
  // reported. The IPC handler below stages them with 150 ms gaps so
  // the GPU compositor can settle between allocations.
  let deferredWindowsSpawned = false;
  const spawnDeferredWindows = () => {
    if (deferredWindowsSpawned) return;
    deferredWindowsSpawned = true;
    log.debug('[boot] spawning deferred windows (orb + badges) with stagger');
    // Orb first — solo, lightweight.
    setTimeout(() => { try { syncFloatingWindow(); } catch (e) { log.warn('[boot] syncFloatingWindow failed', e?.message); } }, 0);
    // Badges next — may be many, but they batch internally; one extra
    // tick of breathing room is plenty.
    setTimeout(() => { try { syncBadgeOverlay(); } catch (e) { log.warn('[boot] syncBadgeOverlay failed', e?.message); } }, 150);
  };
  ipcMain.once('renderer-ready', spawnDeferredWindows);
  // Safety net: if renderer-ready never lands (boot-stuck path), still
  // spawn deferred windows after 6 s so the user doesn't lose their
  // pinned badges/orb forever.
  setTimeout(spawnDeferredWindows, 6000);

  // ── Extension warmup: nudge the Chrome extension at startup ──
  // The MV3 service worker may be asleep when nost finishes loading,
  // which leaves chromeTabs empty for the first few seconds — every
  // URL card opens a new browser window instead of focusing an
  // existing tab. We retry every 1.5 s up to 8 attempts (~12 s) and
  // bail as soon as we see a fresh tabs push from the extension.
  // The retry has two effects:
  //   (1) If SSE is already connected, sendSse('refreshTabs') asks
  //       the extension to call sendTabs() again, picking up tabs
  //       opened between extension wake and nost ready.
  //   (2) If SSE is not yet connected, the call no-ops. We just keep
  //       polling — once the extension's SW reconnects it'll send
  //       its initial sendTabs() and our `lastTabsUpdateAt` updates.
  // Helper: push a status string into the renderer's #ql-loading
  // overlay. No-op once the overlay is gone (the renderer's
  // __bootStatus guards that). Wrapped for safety; if mainWindow's
  // webContents is mid-teardown we just swallow.
  const sendBootStatus = (text) => {
    try { mainWindow?.webContents?.send('boot:status', text); }
    catch { /* webContents gone — boot finished or destroyed */ }
  };

  // Granular cold-start breadcrumbs. Each timer is short enough that
  // even on a fast machine (overlay dismissed in ~1 s) the user sees
  // at least the first 2-3 messages cycle. On a slow first-launch
  // (Defender scan + GPU cache create) the sequence stretches and
  // every phase becomes visible — Adobe's loading dialog plays the
  // same trick. Order roughly mirrors the real cold-start work
  // happening in main + renderer.
  setTimeout(() => sendBootStatus('Electron 런타임 준비 중...'),       150);
  setTimeout(() => sendBootStatus('네이티브 바인딩 로드 중...'),       500);
  setTimeout(() => sendBootStatus('데이터 폴더 확인 중...'),           900);
  setTimeout(() => sendBootStatus('브라우저 확장 연결 확인 중...'),   1400);
  setTimeout(() => sendBootStatus('글꼴 캐시 워밍업 중...'),          1900);
  setTimeout(() => sendBootStatus('UI 그리는 중...'),                  2500);
  setTimeout(() => sendBootStatus('단축키 등록 중...'),                3100);
  setTimeout(() => sendBootStatus('마지막 점검 중...'),                3700);
  setTimeout(() => sendBootStatus('곧 시작합니다...'),                 4300);

  // ext-warmup is DEFERRED until after the renderer signals it's
  // mounted. Reasons:
  //   - The setInterval ticks themselves are cheap, but they overlap
  //     with the heaviest cold-start window (GPU cache build +
  //     Defender scan + font parse). Pushing them past renderer-ready
  //     keeps the first 1-2 s of system resources entirely on the
  //     critical path.
  //   - The "extension not detected" toast that fires on warmup
  //     failure is what the user perceives as "lag end" — but warmup
  //     polling running early means that toast can't fire until 12 s
  //     in. Starting later lets the toast appear sooner relative to
  //     the user's interaction time.
  ipcMain.once('renderer-ready', () => {
    let extWarmupAttempts = 0;
    const extWarmupTimer = setInterval(() => {
      perfBumpTimer('ext-warmup');
      extWarmupAttempts += 1;
      const haveTabs = lastTabsUpdateAt > 0 && global.chromeTabs?.length > 0;
      if (haveTabs || extWarmupAttempts >= 8) {
        clearInterval(extWarmupTimer);
        log.debug(`[ext-warmup] done after ${extWarmupAttempts} attempt(s) · tabs=${global.chromeTabs?.length ?? 0}`);
        return;
      }
      if (sseConnection) {
        const sent = sendSse({ action: 'refreshTabs' });
        log.debug(`[ext-warmup] attempt ${extWarmupAttempts}: refreshTabs sent=${sent}`);
      } else {
        log.debug(`[ext-warmup] attempt ${extWarmupAttempts}: no SSE conn yet`);
      }
    }, 1500);
  });

  // (deferred — see spawnDeferredWindows above. Pinned badges restore
  // after renderer signals boot complete to avoid cold-start GPU
  // contention.)

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
  // ── Display event handlers ─────────────────────────────────
  // `display-metrics-changed` is noisy on Windows: it fires not only on
  // monitor add/remove or DPI/resolution change, but every time a window
  // crosses a DPI boundary or even momentarily during taskbar
  // auto-hide/show. Without de-bouncing, dragging Chrome tabs between
  // windows on a cross-DPI multi-monitor setup triggered a full
  // syncBadgeOverlay() (and its setBounds + pushBadgeState) several times
  // per second — visually, the floating badges appeared to "fly".
  //
  // Two-layer guard:
  //   1. trailing-edge debounce so a burst collapses to one sync.
  //   2. skip the sync entirely when the virtual desktop bounds didn't
  //      actually change (most spurious metrics-changed events).
  let _displaySyncTimer = null;
  let _lastDisplaysSig = '';
  const computeDisplaysSig = () => {
    // Per-display signature: id + bounds + scale. The previous union-only
    // check missed cases where two displays swapped positions or one
    // changed DPI without moving — both relevant to per-display overlays
    // because each window needs to track its own display's bounds.
    const ds = getScreen().getAllDisplays();
    return ds.map(d => `${d.id}|${d.bounds.x},${d.bounds.y},${d.bounds.width},${d.bounds.height}|${d.scaleFactor}`).join(';');
  };
  const scheduleDisplaySync = () => {
    if (_displaySyncTimer) clearTimeout(_displaySyncTimer);
    _displaySyncTimer = setTimeout(() => {
      _displaySyncTimer = null;
      const sig = computeDisplaysSig();
      if (sig === _lastDisplaysSig) return;
      _lastDisplaysSig = sig;
      syncBadgeOverlay();
    }, 250);
  };
  screen.on('display-added',           () => { _lastDisplaysSig = ''; scheduleDisplaySync(); });
  screen.on('display-removed',         () => { _lastDisplaysSig = ''; scheduleDisplaySync(); });
  screen.on('display-metrics-changed', scheduleDisplaySync);

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
