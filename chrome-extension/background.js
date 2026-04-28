const SERVER_URL = 'http://127.0.0.1:14502';

// --- State shared with popup ---
let tabCount = 0;
let isConnected = false;

// Respond to popup status queries
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({ tabCount, isConnected });
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
    // Network error or server closed — reconnect after 3s
  } finally {
    isConnected = false;
  }

  // Reconnect after a short delay
  setTimeout(() => connectSSE(), 3000);
}

// --- Startup ---
sendTabs();
connectSSE();
