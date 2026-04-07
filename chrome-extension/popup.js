// popup.js — queries the background service worker for current status

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const tabCountEl = document.getElementById('tab-count');

function applyStatus(isConnected, tabCount) {
  if (isConnected) {
    statusDot.className = 'dot connected';
    statusText.className = 'status-text connected';
    statusText.textContent = '연결됨';
  } else {
    statusDot.className = 'dot disconnected';
    statusText.className = 'status-text disconnected';
    statusText.textContent = '연결 안됨';
  }

  tabCountEl.textContent = `${tabCount}개 탭`;
}

// Request status from the background service worker
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (chrome.runtime.lastError) {
    // Service worker may have been suspended — show defaults
    applyStatus(false, 0);
    return;
  }

  if (response) {
    applyStatus(response.isConnected, response.tabCount);
  } else {
    applyStatus(false, 0);
  }
});
