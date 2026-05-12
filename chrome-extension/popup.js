// popup.js — queries the background service worker for current
// status. The popup is short-lived (closed the moment the user
// clicks elsewhere), so we don't worry about long-running cleanup —
// the JS environment is torn down with the popup DOM.

const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const tabCountEl  = document.getElementById('tab-count');
const metaLine    = document.getElementById('meta-line');
const guide       = document.getElementById('guide');
const btnReconnect = document.getElementById('btn-reconnect');

/** Format an epoch ms as "N초 전 / N분 전 / N시간 전 / 어제 / N일 전".
 *  Sub-minute resolution gives the user useful "did it disconnect
 *  just now or hours ago?" signal, which is the whole point of
 *  exposing lastConnectedAt at all. */
function formatRelative(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)   return `${sec}초 전`;
  const min  = Math.floor(sec / 60);
  if (min < 60)   return `${min}분 전`;
  const hr   = Math.floor(min / 60);
  if (hr < 24)    return `${hr}시간 전`;
  const day  = Math.floor(hr / 24);
  if (day === 1)  return '어제';
  return `${day}일 전`;
}

function applyStatus(payload) {
  const { isConnected, tabCount, lastConnectedAt, lastErrorReason } = payload || {};

  if (isConnected) {
    statusDot.className = 'dot connected';
    statusText.className = 'status-text connected';
    statusText.textContent = '연결됨';
  } else {
    statusDot.className = 'dot disconnected';
    statusText.className = 'status-text disconnected';
    statusText.textContent = '연결 안됨';
  }

  tabCountEl.textContent = `${tabCount ?? 0}개 탭`;

  // Meta line — three states. Error wins over recency since the
  // user opened the popup specifically to debug a problem.
  metaLine.classList.remove('error');
  if (!isConnected && lastErrorReason) {
    metaLine.classList.add('error');
    metaLine.textContent = `오류: ${lastErrorReason}`;
  } else if (isConnected) {
    metaLine.textContent = lastConnectedAt
      ? `연결됨 · ${formatRelative(lastConnectedAt)}부터`
      : '연결됨';
  } else if (lastConnectedAt) {
    metaLine.textContent = `마지막 연결: ${formatRelative(lastConnectedAt)}`;
  } else {
    metaLine.textContent = '이 세션에서 아직 연결된 적 없음';
  }

  // Guide block visible only while disconnected.
  guide.hidden = !!isConnected;
}

/** Pull the latest status from the background worker. Resilient to
 *  the service worker being asleep — `lastError` fires when the
 *  channel can't deliver; we render defaults so the popup never
 *  shows stale UI from the previous tick. */
function refresh() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      applyStatus({ isConnected: false, tabCount: 0, lastConnectedAt: 0, lastErrorReason: '' });
      return;
    }
    applyStatus(response);
  });
}

// Initial render + lightweight polling while the popup is open. Chrome
// closes the popup the moment the user clicks elsewhere, so the
// interval dies with the document — no manual teardown needed. Poll
// at 1 s for snappy feedback when the user clicks 재연결 and waits
// to see "연결됨".
refresh();
const pollHandle = setInterval(refresh, 1000);
window.addEventListener('pagehide', () => clearInterval(pollHandle));

// 재연결 button. Disables itself for 1 s so impatient double-clicks
// don't stack reconnect attempts (they'd just cancel each other via
// the AbortController in connectSSE anyway, but the visual feedback
// is cleaner this way).
btnReconnect.addEventListener('click', () => {
  btnReconnect.disabled = true;
  btnReconnect.textContent = '연결 시도 중...';
  chrome.runtime.sendMessage({ type: 'FORCE_RECONNECT' }, () => {
    // Whether the SW responded or not, refresh after a beat so the
    // user sees the new state.
    setTimeout(() => {
      btnReconnect.disabled = false;
      btnReconnect.textContent = '재연결';
      refresh();
    }, 1000);
  });
});
