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

// Respond to popup status queries
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({ tabCount, isConnected });
  } else if (message.type === 'FORCE_RECONNECT') {
    // Popup → "재연결" button. Treat as user-initiated reset.
    connectSSE();
    sendResponse({ ok: true });
  }
  return true; // keep channel open for async
});

// --- Send tabs ---
async function sendTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    const tabs = allTabs
      .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
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

    await fetch(`${SERVER_URL}/tabs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tabs)
    });
  } catch (e) {
    // Server might not be running — ignore silently
  }
}

// --- Tab event listeners ---
chrome.tabs.onCreated.addListener(() => sendTabs());
chrome.tabs.onRemoved.addListener(() => sendTabs());
chrome.tabs.onActivated.addListener(() => sendTabs());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // `complete` is the original trigger (page-load done → fresh title /
  // URL / favicon). We additionally fire on `audible` and `mutedInfo`
  // transitions so the media widget gets a near-real-time pulse when
  // the user starts/stops a YouTube tab without us having to poll.
  if (changeInfo.status === 'complete'
      || changeInfo.audible !== undefined
      || changeInfo.mutedInfo !== undefined) {
    sendTabs();
  }
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    sendTabs();
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
    // Network error or server closed — fall through to scheduled reconnect.
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
