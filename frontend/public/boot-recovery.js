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
  var barEl    = document.getElementById('ql-loading-bar');
  var api = window.splashAPI;

  // Progress driver — each new status message bumps the bar forward.
  // Earlier CSS-only design animated 0 → 35 % once and froze; users
  // (rightly) read the stuck bar as "the app hung." We now derive
  // % from how many DISTINCT status texts we've seen, which lines up
  // with the actual cold-start phase count main pushes (~9 from
  // main + a few from the React side = ~12 total). Each message
  // earns a slice of the remaining 95 % bar so the bar always feels
  // like it's heading toward the finish line. Cap at 95 % so we
  // never claim "100 % done" before the overlay is actually torn
  // down — AppShell removes the overlay on renderer ready / store
  // load, which makes 95 → gone the perceived completion event.
  var STEP = 8;           // % gained per new status message
  var CEIL = 95;          // never claim full until overlay is removed
  var pct = 8;            // matches the CSS initial fill
  var seen = Object.create(null);
  function bumpProgress(text) {
    if (!barEl || seen[text]) return;
    seen[text] = true;
    pct = Math.min(CEIL, pct + STEP);
    barEl.style.width = pct + '%';
  }

  // Adobe-style boot status updater. Exposed globally so both the
  // main process (via splashAPI.onStatus IPC) and React-side code
  // (useAppData / AppShell) can push the same text without each
  // touching the DOM independently. No-op once the overlay is gone.
  window.__bootStatus = function (text) {
    if (!statusEl || !text) return;
    if (statusEl.textContent === text) return;
    bumpProgress(text);
    // Tiny fade-out → swap → fade-in for less jarring text changes.
    statusEl.style.opacity = '0';
    setTimeout(function () {
      if (statusEl) {
        statusEl.textContent = text;
        statusEl.style.opacity = '';
      }
    }, 120);
  };

  // Slow-creep driver — between status messages, advance the bar by
  // tiny amounts so a long "마지막 점검 중..." phase doesn't look
  // frozen. Stops on its own once we hit the cap or the overlay is
  // gone (querying barEl returns null after AppShell removes it).
  var creep = setInterval(function () {
    if (!barEl || !document.getElementById('ql-loading-bar')) {
      clearInterval(creep);
      return;
    }
    if (pct < CEIL) {
      // 0.4 % every 350 ms = ~1.15 %/s — gentle enough that it never
      // races ahead of a real status bump, but visible motion when
      // the user stares at the bar.
      pct = Math.min(CEIL, pct + 0.4);
      barEl.style.width = pct + '%';
    }
  }, 350);

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
