/**
 * media-controller.js — Windows-side media playback bridge.
 *
 * Two responsibilities, both consumed by media-widget cards in the
 * renderer:
 *   1. READ: subscribe to SMTC (System Media Transport Controls) so we
 *      know what's playing, by whom, and where the playhead is. The
 *      whole desktop publishes to SMTC: YouTube tabs in Chrome/Edge,
 *      Spotify desktop, foobar2000, the Windows movies app, anything.
 *   2. WRITE: send media keys (play-pause / next / prev / stop) at the
 *      OS level. SMTC routes them to whichever app currently owns the
 *      "current session" — same target the read side observes — so the
 *      visual play state and the action stay in sync.
 *
 * Why not embed this in main.js: the SMTC binding loads a .node and
 * the koffi FFI needs OS-specific guards. Keeping the failure modes
 * here — and letting main.js treat the whole module as best-effort —
 * means a non-Windows / unsupported-Windows machine still launches.
 *
 * Failure modes handled:
 *   - Not Windows                          → init() bails, exports stay no-op.
 *   - Windows < 10 1809 (no SMTC)         → SMTCMonitor ctor throws; we
 *                                            log and stay degraded.
 *   - SMTC native binding fails to load   → same. caller gets null states.
 *   - koffi can't load user32             → media keys silently no-op
 *                                            (very unlikely; user32 is
 *                                            in EVERY Windows).
 *
 * The renderer is told about init failure via getMediaState() returning
 * `{ supported: false }` so the widget can render a "not supported"
 * message instead of an empty card.
 */

const log = require('electron-log').scope('media');

// ── Native bindings, loaded lazily so non-Windows can require this file ──
let SMTCMonitor   = null;   // class
let monitor       = null;   // running instance
let userKey       = null;   // koffi-bound keybd_event
let supported     = false;  // false until init() succeeds
let initialised   = false;

// ── Listener fan-out ──────────────────────────────────────────────────
// The main process pushes media state to the renderer via mainWindow's
// webContents — see main.js wiring. We keep listener registration in a
// callback so this module stays unaware of the renderer surface.
const stateListeners = new Set();
function notifyState() {
  const s = currentSnapshot();
  for (const cb of stateListeners) {
    try { cb(s); } catch (e) { log.error('media state listener threw:', e); }
  }
}

// ── Thumbnail cache ───────────────────────────────────────────────────
// SMTC ships the album art as a raw PNG/JPEG buffer on every metadata
// push. Re-encoding to base64 every state-change is wasteful (a track
// rarely changes; status flips happen often). Cache by composite key
// so a fresh status flip reuses the existing data URL.
const thumbCache = new Map();   // key -> dataUrl
const THUMB_CACHE_MAX = 8;
function thumbKey(media) {
  return `${media.title || ''}::${media.artist || ''}::${media.albumTitle || ''}`;
}
function getOrEncodeThumb(media) {
  if (!media.thumbnail) return null;
  const key = thumbKey(media);
  const hit = thumbCache.get(key);
  if (hit) return hit;
  // Detect format by magic bytes — SMTC may give either PNG or JPEG.
  const head = media.thumbnail.slice(0, 4);
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const mime  = isPng ? 'image/png' : 'image/jpeg';
  const url   = `data:${mime};base64,${media.thumbnail.toString('base64')}`;
  // LRU-ish: drop oldest if at cap.
  if (thumbCache.size >= THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    thumbCache.delete(oldest);
  }
  thumbCache.set(key, url);
  return url;
}

// ── Snapshot construction ─────────────────────────────────────────────
// Single source of truth for the renderer-shaped state object.
// The renderer extrapolates `position` between updates using `lastUpdated`
// + playback rate (1.0 currently — SMTC doesn't expose rate cleanly).
function currentSnapshot() {
  if (!supported || !SMTCMonitor) return { supported: false };
  let cur;
  try { cur = SMTCMonitor.getCurrentMediaSession(); }
  catch (e) {
    log.warn('getCurrentMediaSession threw:', e.message);
    return { supported: true, session: null };
  }
  if (!cur) return { supported: true, session: null };

  // PlaybackStatus: 4 = PLAYING, 5 = PAUSED, others = stopped/closed/etc.
  const isPlaying = cur.playback?.playbackStatus === 4;
  return {
    supported: true,
    session: {
      sourceAppId: cur.sourceAppId,
      title:       cur.media?.title       || '',
      artist:      cur.media?.artist      || '',
      album:       cur.media?.albumTitle  || '',
      isPlaying,
      // Timeline values from SMTC are in milliseconds.
      position:    cur.timeline?.position || 0,
      duration:    cur.timeline?.duration || 0,
      // When the renderer received this snapshot — for client-side
      // position extrapolation while playing.
      lastUpdated: Date.now(),
      thumb:       getOrEncodeThumb(cur.media || {}),
    },
  };
}

// ── Lifecycle ────────────────────────────────────────────────────────
function init() {
  if (initialised) return supported;
  initialised = true;

  if (process.platform !== 'win32') {
    log.info('not Windows — media controller disabled.');
    return false;
  }

  // SMTC binding
  try {
    const smtc = require('@coooookies/windows-smtc-monitor');
    SMTCMonitor = smtc.SMTCMonitor;
    monitor = new SMTCMonitor();
    // Every event causes a fresh snapshot push. We don't try to
    // partial-update because the renderer is cheap and `currentSnapshot`
    // is essentially constant-time.
    monitor.on('current-session-changed',    notifyState);
    monitor.on('session-media-changed',      notifyState);
    monitor.on('session-playback-changed',   notifyState);
    monitor.on('session-timeline-changed',   notifyState);
    monitor.on('session-added',              notifyState);
    monitor.on('session-removed',            notifyState);
    log.info('SMTC monitor initialised.');
    supported = true;
  } catch (e) {
    log.warn('SMTC unavailable — read side disabled:', e.message);
    // We still try to set up the write side below — sending media keys
    // works fine on systems where SMTC reads fail (rare, but possible).
  }

  // koffi user32 binding for keybd_event
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    // void keybd_event(BYTE bVk, BYTE bScan, DWORD dwFlags, ULONG_PTR dwExtraInfo);
    userKey = user32.func('void keybd_event(uint8_t, uint8_t, uint32_t, void*)');
    log.info('koffi user32 keybd_event bound.');
    // We consider the controller "supported" as long as EITHER read
    // or write works — the widget UI degrades each independently.
    supported = supported || true;
  } catch (e) {
    log.warn('koffi/user32 unavailable — write side disabled:', e.message);
  }

  return supported;
}

function destroy() {
  if (monitor) {
    try { monitor.destroy(); } catch { /* ignore — already gone */ }
    monitor = null;
  }
  stateListeners.clear();
  thumbCache.clear();
  supported = false;
  initialised = false;
}

// ── Public API ───────────────────────────────────────────────────────
function getState() {
  if (!initialised) init();
  return currentSnapshot();
}

function onState(cb) {
  if (!initialised) init();
  stateListeners.add(cb);
  // Push current state immediately so the renderer doesn't have to
  // sit through a "loading" frame waiting for the first event.
  try { cb(currentSnapshot()); } catch (e) { log.error('initial state push threw:', e); }
  return () => stateListeners.delete(cb);
}

// Win32 virtual-key codes for the multimedia keys.
// All Windows builds since XP route these through the SMTC current
// session, so we don't need to target a specific app.
const VK = {
  PLAY_PAUSE: 0xB3,
  STOP:       0xB2,
  NEXT:       0xB0,
  PREV:       0xB1,
};
// keybd_event flags
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
    action === 'stop'       ? VK.STOP : null;
  if (vk == null) {
    log.warn('unknown media action:', action);
    return false;
  }
  // Press + release. Releasing matters — some apps debounce on key-up.
  // The 4th arg (dwExtraInfo) is ULONG_PTR; passing null is fine.
  try {
    userKey(vk, 0, 0, null);
    userKey(vk, 0, KEYEVENTF_KEYUP, null);
    return true;
  } catch (e) {
    log.error('keybd_event call failed:', e);
    return false;
  }
}

module.exports = { init, destroy, getState, onState, command };
