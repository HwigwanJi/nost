const SERVER_URL = 'http://127.0.0.1:14502';
const RECONNECT_ALARM = 'nost-reconnect';
// Exponential-backoff schedule for reconnect attempts, in minutes.
// Chrome enforces a 0.5 min minimum on `chrome.alarms.create`, so the
// first slot is exactly that. We grow up to ~5 min so a user who
// hasn't run nost for hours doesn't keep their service worker
// flickering on/off every 30 s — a real concern on laptops where
// every SW wake delays deep sleep.
const RECONNECT_BACKOFF_MIN = [0.5, 1, 2, 5];
let reconnectAttempt = 0;

// --- State shared with popup ---
let tabCount = 0;
let isConnected = false;
// Epoch ms of the last SUCCESSFUL SSE connect. The popup turns this
// into a "마지막 연결 N초 전" hint so the user can tell at a glance
// whether the disconnection is fresh (probably nost just updated)
// or stale (probably nost not running). 0 = never connected this
// service-worker lifetime.
let lastConnectedAt = 0;
// Last failure reason — populated when connectSSE catches a non-
// AbortError. The popup uses this to disambiguate "nost is off" from
// "nost is up but rejecting" (e.g. CORS, 503). One-liner; cleared on
// successful connect.
let lastErrorReason = '';

// Respond to popup status queries
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({ tabCount, isConnected, lastConnectedAt, lastErrorReason });
  } else if (message.type === 'FORCE_RECONNECT') {
    // Popup → "재연결" button. Treat as user-initiated reset:
    // reset the backoff so we attempt immediately, then kick off
    // a connect. Tab snapshot too, in case nost just started.
    reconnectAttempt = 0;
    try { chrome.alarms.clear(RECONNECT_ALARM); } catch { /* ignore */ }
    sendTabs();
    connectSSE();
    sendResponse({ ok: true });
  }
  return true; // keep channel open for async
});

// --- Send tabs ---
// Tab-URL filter. Schemes we deliberately drop:
//   chrome://, chrome-extension://, chrome-untrusted://  — browser internals
//   devtools://                                           — devtools panels
//   view-source:                                          — view-source overlay
//   data:, blob:, javascript:                             — synthetic / inert
//   about:                                                — Firefox-style internal (rare in Chromium but harmless)
// Anything else (http/https/file/ftp) goes through.
const SKIPPED_URL_SCHEMES = [
  'chrome://', 'chrome-extension://', 'chrome-untrusted://',
  'devtools://', 'view-source:',
  'data:', 'blob:', 'javascript:', 'about:',
];
function isSyntheticUrl(url) {
  if (!url) return true;
  for (const p of SKIPPED_URL_SCHEMES) {
    if (url.startsWith(p)) return true;
  }
  return false;
}

async function sendTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    const tabs = allTabs
      .filter(t => !isSyntheticUrl(t.url))
      .map(t => ({
        id: t.id,
        windowId: t.windowId,
        title: t.title || '',
        url: t.url,
        favIconUrl: t.favIconUrl || '',
        // `audible: true` = tab is currently making sound (YouTube
        // playing, Spotify Web playing, etc). nost's media widget
        // uses this as a "best-effort current media tab" signal,
        // since SMTC reads were dropped after the freeze regression.
        audible: !!t.audible,
        // `mutedInfo.muted: true` overrides audible — a tab can be
        // marked audible by Chrome but the user has muted it from
        // the tab strip. Forward both so main can decide.
        muted: !!t.mutedInfo?.muted,
      }));

    tabCount = tabs.length;

    // Localhost loopback rarely hangs, but a wedged nost process
    // (mid-update, debugger paused, etc.) used to leave the fetch
    // pending indefinitely. 3 s cap is generous for the LAN-zero
    // hop and short enough that the next tab event can retry.
    await fetch(`${SERVER_URL}/tabs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tabs),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    // Server might not be running — ignore silently
  }
}

// Debounced tab pusher. Tab events arrive in bursts (opening a folder
// of bookmarks → 30× onCreated within milliseconds; preset switch in
// some users' setups → onActivated × N) and the original code POSTed
// for every single one. Localhost is cheap but the rapid spam ate
// service-worker CPU budget and pushed redundant snapshots over the
// wire. 150 ms is shorter than perceptible UI latency (the media
// widget's "audible tab" indicator still feels live) but long enough
// to coalesce realistic bursts.
let _sendTabsTimer = null;
function scheduleSendTabs() {
  if (_sendTabsTimer) return;
  _sendTabsTimer = setTimeout(() => {
    _sendTabsTimer = null;
    sendTabs();
  }, 150);
}

// --- Tab event listeners ---
chrome.tabs.onCreated.addListener(scheduleSendTabs);
chrome.tabs.onRemoved.addListener(scheduleSendTabs);
chrome.tabs.onActivated.addListener(scheduleSendTabs);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // `complete` is the original trigger (page-load done → fresh title /
  // URL / favicon). We additionally fire on `audible` and `mutedInfo`
  // transitions so the media widget gets a near-real-time pulse when
  // the user starts/stops a YouTube tab without us having to poll.
  if (changeInfo.status === 'complete'
      || changeInfo.audible !== undefined
      || changeInfo.mutedInfo !== undefined) {
    scheduleSendTabs();
  }
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    scheduleSendTabs();
  }
});

// --- SSE connection via fetch + ReadableStream (MV3 compatible) ---
// EventSource is NOT available in service workers; we use fetch + ReadableStream.
let sseAbortController = null;

async function connectSSE() {
  // Cancel any existing connection
  if (sseAbortController) {
    sseAbortController.abort();
  }
  sseAbortController = new AbortController();
  const signal = sseAbortController.signal;

  try {
    const response = await fetch(`${SERVER_URL}/events`, {
      headers: { Accept: 'text/event-stream' },
      signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE connect failed: ${response.status}`);
    }

    isConnected = true;
    lastConnectedAt = Date.now();
    lastErrorReason = '';
    // Success — drop the reconnect alarm and reset the backoff so
    // the next failure starts fresh at 30 s instead of remembering
    // we were at the 5 min step.
    reconnectAttempt = 0;
    try { chrome.alarms.clear(RECONNECT_ALARM); } catch (e) { /* ignore */ }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const data = JSON.parse(jsonStr);
            if (data.action === 'focus' && typeof data.tabId === 'number') {
              await chrome.tabs.update(data.tabId, { active: true });
              if (typeof data.windowId === 'number') {
                await chrome.windows.update(data.windowId, { focused: true });
              }
            } else if (data.action === 'detach' && typeof data.tabId === 'number') {
              // Move tab into its own window so it can be tiled independently
              try {
                await chrome.windows.create({ tabId: data.tabId, type: 'normal', state: 'normal' });
              } catch (e) {
                // Tab may already be in its own window — ignore
              }
            } else if (data.action === 'openWindow' && typeof data.url === 'string') {
              try {
                await chrome.windows.create({ url: data.url, type: 'normal', state: 'normal' });
              } catch (e) { /* ignore */ }
            } else if (data.action === 'refreshTabs') {
              // nost is asking for a fresh tab snapshot — usually at
              // startup, when nost finished loading before this
              // extension's service worker woke up. Just trigger the
              // same push the tab events trigger.
              sendTabs();
            } else if (data.action === 'resize' && typeof data.windowId === 'number') {
              const upd = { state: 'normal', focused: true };
              if (typeof data.left === 'number') upd.left = data.left;
              if (typeof data.top === 'number') upd.top = data.top;
              if (typeof data.width === 'number') upd.width = data.width;
              if (typeof data.height === 'number') upd.height = data.height;
              try {
                await chrome.windows.update(data.windowId, upd);
                if (typeof data.tabId === 'number') {
                  await chrome.tabs.update(data.tabId, { active: true });
                }
              } catch (e) { /* window may have closed */ }
            }
          } catch (parseErr) {
            // Malformed JSON — ignore
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // Intentional disconnect — do not reconnect
      return;
    }
    // Network error or server closed — fall through to scheduled
    // reconnect. Record the short reason so the popup can show it
    // ("nost 실행 안 됨" vs "타임아웃" vs "거부됨"). Stripped to a
    // handful of common patterns; the full Error is in the SW
    // devtools console anyway.
    const raw = String(err?.message ?? err ?? '').slice(0, 80);
    if (/Failed to fetch/i.test(raw))           lastErrorReason = '서버 연결 안 됨';
    else if (/aborted|timeout/i.test(raw))      lastErrorReason = '타임아웃';
    else if (raw)                               lastErrorReason = raw;
    else                                        lastErrorReason = '알 수 없는 오류';
  } finally {
    isConnected = false;
  }

  // Reconnect strategy — two paths, both lightweight.
  //
  //   1. Fast in-process retry (2 s) while the service worker is
  //      still alive. Covers the typical nost auto-update gap.
  //   2. chrome.alarms backup with exponential backoff. Survives
  //      service-worker termination — historically the bug was that
  //      setTimeout vanished with the SW, leaving the extension
  //      permanently dead until a user action woke it.
  //
  // We deliberately do NOT run a periodic keepalive alarm. The
  // server-side SSE heartbeat (15 s comment lines) already keeps
  // the SW alive while connected; running an extra alarm when not
  // connected would only waste laptop battery (Chrome refuses
  // periods shorter than 30 s anyway). The exponential backoff
  // means that if the user has nost closed for hours, the alarm
  // settles to once-per-5-min instead of hammering forever.
  setTimeout(() => connectSSE(), 2000);
  scheduleReconnectAlarm();
}

// ── Service-worker resilience ─────────────────────────────────────────
//
// MV3 service workers are terminated after ~30 s of no activity, taking
// every pending setTimeout / setInterval with them. `chrome.alarms` is
// the one timer mechanism that wakes the SW even after termination.
//
// Steady-state cost:
//   - Connected: SSE heartbeat keeps SW alive; zero alarms.
//   - Disconnected: ONE pending alarm at any time; backoff 30 s → 5 min.
//
// `chrome.runtime.onStartup` and `chrome.runtime.onInstalled` cover
// the cold-Chrome-launch case (no event fires at startup unless we
// register a listener for those specific lifecycle events).
//
// Browser compatibility: identical Chromium APIs in both Chrome and
// Naver Whale, so this code is shipped as-is to both stores. The
// `chrome.*` namespace is the Chromium MV3 standard; Whale aliases
// it natively.

function scheduleReconnectAlarm() {
  // Pick the next backoff slot. Chrome enforces 0.5 min minimum on
  // delayInMinutes; values smaller than that get silently clamped.
  // We also cap at the longest slot so a chronically-down nost
  // doesn't endlessly grow the delay.
  const slot = Math.min(reconnectAttempt, RECONNECT_BACKOFF_MIN.length - 1);
  const delay = RECONNECT_BACKOFF_MIN[slot];
  reconnectAttempt++;
  try { chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: delay }); } catch (e) { /* ignore */ }
}

function ensureConnected() {
  if (isConnected) return;
  connectSSE();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) {
    ensureConnected();
  }
});

// Cold-launch + new-install hooks. The SW wouldn't otherwise wake on
// browser startup unless a tab event fires; without this hook we'd
// leak nost-update disconnects across browser restarts.
chrome.runtime.onStartup.addListener(() => {
  reconnectAttempt = 0; // user reopened browser — try eagerly
  ensureConnected();
});
chrome.runtime.onInstalled.addListener(() => {
  reconnectAttempt = 0;
  ensureConnected();
});

// --- Startup (module evaluation — runs every SW respawn) ---
sendTabs();
connectSSE();
