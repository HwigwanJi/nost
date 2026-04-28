/**
 * Landing-page glue.
 *
 * - Hits the GitHub releases API once on load and rewires the two
 *   download buttons to point straight at the latest installer
 *   asset, so the user gets a one-click .exe download instead of
 *   landing on the releases page first.
 * - Updates the version meta line under the hero ("v1.3.7").
 * - Detects non-Windows visitors (best-effort UA sniff) and softens
 *   the button label so they understand the OS scope without
 *   hiding the link entirely (some users want to forward to a
 *   colleague on Windows).
 *
 * Failure mode: if the API call fails (rate-limit, network), the
 * hardcoded `href` already points at the releases page — the user
 * still gets there with one extra click.
 */

(function () {
  const REPO = 'HwigwanJi/nost';
  const API  = `https://api.github.com/repos/${REPO}/releases/latest`;

  const $download   = document.getElementById('download-btn');
  const $download2  = document.getElementById('download-btn-2');
  const $label      = document.getElementById('download-label');
  const $version    = document.getElementById('meta-version');

  // --- OS hint -------------------------------------------------
  // navigator.userAgent is unreliable in 2026 (UA-CH freeze) but
  // platform detection is fine for "is this Windows?" — we only
  // need a yes/no, not the build number.
  const isWindows = /Win/i.test(navigator.platform || '') || /Windows/i.test(navigator.userAgent || '');
  if (!isWindows && $label) {
    $label.textContent = 'Windows용 다운로드 (현재 PC: Windows 아님)';
  }

  // --- Latest-version fetch -----------------------------------
  fetch(API, { headers: { 'Accept': 'application/vnd.github+json' } })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(release => {
      const tag = release.tag_name || '';                   // "v1.3.7"
      const assets = Array.isArray(release.assets) ? release.assets : [];

      // Prefer the NSIS installer over the portable build for the
      // primary CTA — most users want install + auto-update over a
      // floating .exe. Both names are stable: nost-Setup-{ver}.exe
      // and nost-{ver}.exe respectively.
      const installer = assets.find(a => /^nost-Setup-.*\.exe$/i.test(a.name))
                     || assets.find(a => /^nost-.*\.exe$/i.test(a.name));

      if (installer && installer.browser_download_url) {
        if ($download)  $download.href  = installer.browser_download_url;
        if ($download2) $download2.href = installer.browser_download_url;
      }
      if (tag && $version) {
        $version.textContent = `최신 버전 ${tag}`;
      }
    })
    .catch(err => {
      // Soft-fail: leave the buttons pointed at /releases/latest.
      if ($version) $version.textContent = '최신 버전';
      // eslint-disable-next-line no-console
      console.warn('release lookup failed:', err);
    });
})();
