// Boot-stage recovery wiring for the in-window #ql-loading overlay.
//
// Runs BEFORE React mounts (loaded from index.html with `defer`) so
// the recovery buttons work even if React itself fails to hydrate.
// Production CSP is `script-src 'self'`, so this MUST live in an
// external file rather than inline.
//
// Pairs with main.js's `boot:show-error` IPC: when main detects no
// `renderer-ready` after 8 s, it sends `boot:show-error` (preload.js
// re-exposes it as `splashAPI.onError`) and we toggle `.ql-error` on
// the overlay to swap default → error UI.
(function () {
  var overlay = document.getElementById('ql-loading');
  var statusEl = document.getElementById('ql-loading-status');
  var api = window.splashAPI;

  // Adobe-style boot status updater. Exposed globally so both the
  // main process (via splashAPI.onStatus IPC) and React-side code
  // (useAppData / AppShell) can push the same text without each
  // touching the DOM independently. No-op once the overlay is gone.
  window.__bootStatus = function (text) {
    if (!statusEl || !text) return;
    if (statusEl.textContent === text) return;
    // Tiny fade-out → swap → fade-in for less jarring text changes.
    statusEl.style.opacity = '0';
    setTimeout(function () {
      if (statusEl) {
        statusEl.textContent = text;
        statusEl.style.opacity = '';
      }
    }, 120);
  };

  if (!overlay || !api) return; // dev / unloaded preload — silent no-op

  if (api.onError) {
    api.onError(function () {
      if (overlay) overlay.classList.add('ql-error');
    });
  }
  if (api.onStatus) {
    api.onStatus(function (text) { window.__bootStatus(text); });
  }

  var btnRestart = document.getElementById('ql-btn-restart');
  var btnLogs    = document.getElementById('ql-btn-logs');
  if (btnRestart) btnRestart.addEventListener('click', function () { api.restart(); });
  if (btnLogs)    btnLogs.addEventListener('click',    function () { api.openLogs(); });
})();
