/**
 * Native foreground-window detector — replaces the 600 ms PowerShell
 * spawn that detect-dialog.ps1 used. Uses koffi (already a dep for the
 * media-controller bindings) to call user32 directly.
 *
 * Latency: ~10-50 µs per call vs 50-200 ms for spawning powershell.exe
 * + loading the script + ConvertTo-Json. With a 600 ms poll cadence
 * that's ~80% CPU saved on the detection path alone, plus zero process
 * churn (the OS doesn't have to fork/exec every tick).
 *
 * API surface mirrors detect-dialog.ps1's JSON output so the caller in
 * main.js doesn't need to change shape:
 *   { title, className, isDialog, hwnd, rect: {x,y,width,height} | null }
 *
 * Failure mode: if koffi/user32 binding fails (32-bit Windows? OS
 * variant we haven't seen?) the module logs once and returns null
 * forever after. Caller should treat null as "no detection this tick"
 * and try again later (no-op for the popup state machine).
 */

const log = require('electron-log');

let supported = false;
let initialised = false;
let user32 = null;
let koffiRef = null;       // cached koffi module for alloc/decode/address
let RECT_TYPE = null;      // koffi struct type handle, used by alloc/decode
let GetForegroundWindow = null;
let GetWindowTextW = null;
let GetClassNameW = null;
let GetWindowRect = null;

function init() {
  if (initialised) return supported;
  initialised = true;

  // Allow opt-out via env so a buggy koffi build can be sidestepped
  // without needing a code change. Same pattern as media-controller.
  if (process.env.NOST_DISABLE_NATIVE_FG === '1') {
    log.warn('foreground-window: disabled by env');
    return false;
  }

  try {
    const koffi = require('koffi');
    koffiRef = koffi;
    user32 = koffi.load('user32.dll');

    // HWND is a pointer; koffi treats it as void* for opaque-handle use.
    GetForegroundWindow = user32.func('void* GetForegroundWindow()');

    // Pass a raw Buffer for the Inout char buffer — declared as void*
    // for maximum compatibility across koffi versions. We size buffers
    // ourselves and let the caller manage encoding.
    GetWindowTextW = user32.func('int GetWindowTextW(void *hwnd, void *buf, int max)');
    GetClassNameW  = user32.func('int GetClassNameW(void *hwnd, void *buf, int max)');

    // RECT is a 4×int32 struct. koffi.struct lets us read fields off
    // the JS object after the call without manually unpacking bytes.
    // NOTE: `_Out_` SAL qualifier requires a parameter name in koffi's
    // prototype parser — leaving `_Out_ RECT*` unnamed makes koffi throw
    // "Unexpected character '(' in type specifier" and abort all
    // bindings (so the entire foreground-window module fails init,
    // not just this one symbol). Always supply names alongside SAL.
    // Also: Windows BOOL is `int`, not C99 `bool` — using `bool` is
    // tolerated on most koffi builds but `int` matches the ABI exactly.
    RECT_TYPE = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    // No SAL annotations on the prototype — we manage the RECT buffer
    // ourselves via koffi.alloc/decode below. Avoids koffi version
    // differences in how `_Out_` shapes the return value.
    GetWindowRect = user32.func('int GetWindowRect(void *hwnd, void *rect)');

    supported = true;
    log.info('foreground-window: koffi user32 bindings ready.');
    return true;
  } catch (e) {
    log.warn('foreground-window: koffi init failed —', e?.message ?? e);
    supported = false;
    return false;
  }
}

/**
 * Read the current foreground window. Returns null if native bindings
 * are unavailable or the call fails (caller should fall back / skip).
 */
function detect() {
  if (!supported && !init()) return null;

  try {
    const hwnd = GetForegroundWindow();
    // koffi returns a pointer object for HWND results. A null/zero
    // HWND means there's no foreground window (rare — desktop focused
    // briefly during a window swap, etc.).
    if (!hwnd) return null;

    // 256 wide-char buffer is plenty for any window title we care
    // about (file dialogs are typically < 80 chars; we just want to
    // read the title for the heuristic match).
    const TITLE_LEN = 256;
    const titleBuf = Buffer.alloc(TITLE_LEN * 2);
    const titleN = GetWindowTextW(hwnd, titleBuf, TITLE_LEN);
    // GetWindowTextW returns char count (no terminator). UTF-16LE
    // decode of the first N chars × 2 bytes.
    const title = titleN > 0 ? titleBuf.toString('utf16le', 0, titleN * 2) : '';

    const CLASS_LEN = 256;
    const classBuf = Buffer.alloc(CLASS_LEN * 2);
    const classN = GetClassNameW(hwnd, classBuf, CLASS_LEN);
    const className = classN > 0 ? classBuf.toString('utf16le', 0, classN * 2) : '';

    const isDialog = (className === '#32770');

    let rect = null;
    if (isDialog) {
      // Allocate a RECT-sized buffer and let user32 fill it; then
      // decode the bytes back into a JS object via the registered
      // struct type. This pattern works on every koffi 2.x build
      // because it doesn't rely on koffi's auto-marshal of mutable
      // JS objects (which differs between versions).
      const buf = koffiRef.alloc(RECT_TYPE, 1);
      const ok = GetWindowRect(hwnd, buf);
      if (ok) {
        const r = koffiRef.decode(buf, RECT_TYPE);
        rect = {
          x: r.left,
          y: r.top,
          width:  r.right  - r.left,
          height: r.bottom - r.top,
        };
      }
    }

    // HWND → number for downstream comparison. Win32 HWNDs fit in a
    // 32-bit signed int on every Windows we support (yes the type is
    // pointer-sized, but the kernel doesn't actually use the high bits
    // for HWND values). Number is fine; BigInt would force callers to
    // do BigInt math for trivial equality checks.
    let hwndNum = 0;
    try {
      // koffi exposes the underlying address via koffi.address().
      const koffi = require('koffi');
      const addr = koffi.address(hwnd);
      // addr is a BigInt on 64-bit; coerce safely.
      hwndNum = typeof addr === 'bigint' ? Number(addr & 0xFFFFFFFFn) : Number(addr);
    } catch { /* keep 0 */ }

    return { title, className, isDialog, hwnd: hwndNum, rect };
  } catch (e) {
    // Don't spam the log — a single warn is enough; the caller treats
    // null as no-op and we'll keep trying next tick.
    log.warn('foreground-window: detect failed —', e?.message ?? e);
    return null;
  }
}

module.exports = { init, detect };
