/**
 * media-controller.js — Windows media-key bridge.
 *
 * **History note**: an earlier version of this module also subscribed to
 * SMTC (System Media Transport Controls) via the
 * `@coooookies/windows-smtc-monitor` native binding to surface NowPlaying
 * info (title / artist / artwork / progress) in the media widget. That
 * binding's native `initialize()` call hangs synchronously when YouTube
 * is actively publishing media at app startup — long enough for Windows
 * to report nost as "Not Responding". We tried bypassing the wrapper's
 * `_preloadSessions()` step (the obvious culprit), but the freeze just
 * shifted into `initialize()` itself. There's no way to call into the
 * native code without triggering the hang, and isolating it via worker
 * threads would require re-loading native modules in a worker context
 * — significant work for a feature that, honestly, is "nice to have"
 * rather than core. So we dropped the read side.
 *
 * What this still does:
 *   - send media keys (play-pause / next / prev / stop) via koffi-bound
 *     user32.keybd_event, the same way Windows' own multimedia keyboards
 *     do. Routing is OS-managed: whichever app currently owns SMTC's
 *     "current session" receives the key. That's normally the most
 *     recently-active media app, which matches user expectation.
 *
 * What this no longer does:
 *   - read NowPlaying. The widget renders a static "media control"
 *     panel instead of track info. A future iteration can fill the
 *     read side via the nost-bridge browser extension (which already
 *     has a content script in active tabs and can scrape YouTube /
 *     Spotify Web / similar).
 *
 * The renderer's "click the widget → focus the playing tab" gesture
 * is handled in main.js via the nost-bridge extension's `audible: true`
 * tab list — see the `media-focus-source` IPC. That covers Chromium-
 * based browsers; native media apps would still need SMTC / WASAPI.
 */

const log = require('electron-log').scope('media');

let userKey       = null;   // koffi-bound keybd_event
let supported     = false;
let initialised   = false;

// ── Lifecycle ────────────────────────────────────────────────────────
function init() {
  if (initialised) return supported;
  initialised = true;

  if (process.platform !== 'win32') {
    log.info('not Windows — media controller disabled.');
    return false;
  }

  // Diagnostic kill-switch — set NOST_DISABLE_MEDIA=1 before launch
  // to skip everything (including the koffi keybd_event binding).
  if (process.env.NOST_DISABLE_MEDIA === '1') {
    log.warn('media controller disabled by NOST_DISABLE_MEDIA env');
    return false;
  }

  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    // void keybd_event(BYTE bVk, BYTE bScan, DWORD dwFlags, ULONG_PTR dwExtraInfo);
    userKey = user32.func('void keybd_event(uint8_t, uint8_t, uint32_t, void*)');
    supported = true;
    log.info('media controller ready (koffi user32 keybd_event bound).');
  } catch (e) {
    log.warn('koffi/user32 unavailable — media keys disabled:', e.message);
  }

  return supported;
}

function destroy() {
  supported = false;
  initialised = false;
}

// Win32 virtual-key codes for the multimedia + volume keys.
// All of these route through the same Windows shell pipeline as
// physical keyboard media keys, so behaviour matches what a hardware
// keyboard would do (volume changes the system mixer; play/pause hits
// the SMTC current session; mute toggles the master output).
const VK = {
  PLAY_PAUSE: 0xB3,
  STOP:       0xB2,
  NEXT:       0xB0,
  PREV:       0xB1,
  VOL_UP:     0xAF,
  VOL_DOWN:   0xAE,
  VOL_MUTE:   0xAD,
};
const KEYEVENTF_KEYUP = 0x0002;

function command(action) {
  if (!initialised) init();
  if (!userKey) {
    log.warn('media command requested but user32 not bound:', action);
    return false;
  }
  const vk =
    action === 'play-pause' ? VK.PLAY_PAUSE :
    action === 'next'       ? VK.NEXT :
    action === 'prev'       ? VK.PREV :
    action === 'stop'       ? VK.STOP :
    action === 'vol-up'     ? VK.VOL_UP :
    action === 'vol-down'   ? VK.VOL_DOWN :
    action === 'mute'       ? VK.VOL_MUTE : null;
  if (vk == null) {
    log.warn('unknown media action:', action);
    return false;
  }
  try {
    userKey(vk, 0, 0, null);
    userKey(vk, 0, KEYEVENTF_KEYUP, null);
    return true;
  } catch (e) {
    log.error('keybd_event call failed:', e);
    return false;
  }
}

module.exports = { init, destroy, command };
