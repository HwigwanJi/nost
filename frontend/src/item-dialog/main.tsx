// Satellite entry for the ItemDialog (card add/edit) BrowserWindow.
// See plans/satellite-dialogs.md.

// Visible marker BEFORE any import runs — proves the script reached the
// renderer even when subsequent imports throw. Removed once mount succeeds.
(() => {
  const m = document.createElement('div');
  m.id = '__nost_satellite_boot';
  m.textContent = '[satellite] boot…';
  m.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;color:#fff;font:12px monospace;background:rgba(0,0,0,0.6);padding:4px 8px;border-radius:4px;pointer-events:none;';
  document.body?.appendChild(m);
})();

// Surface any unhandled error visibly so a black-screen satellite at least
// tells the user WHAT broke instead of staring at an empty window.
function showVisibleError(label: string, err: unknown) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
  let el = document.getElementById('__nost_satellite_err');
  if (!el) {
    el = document.createElement('pre');
    el.id = '__nost_satellite_err';
    el.style.cssText = 'position:fixed;inset:0;margin:0;padding:16px;background:#7f1d1d;color:#fff;font:11px/1.4 monospace;overflow:auto;white-space:pre-wrap;z-index:99998;';
    document.body?.appendChild(el);
  }
  el.textContent += `\n--- ${label} ---\n${msg}\n`;
  console.error('[satellite]', label, err);
}
window.addEventListener('error', (e) => showVisibleError('window.error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showVisibleError('unhandledrejection', e.reason));

(async () => {
  try {
    await import('pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css');
    await import('../index.css');
    import('@fontsource-variable/material-symbols-rounded/full.css').catch(() => {});

    const { StrictMode } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { ItemDialogSatellite } = await import('./ItemDialogSatellite');

    const root = document.getElementById('root')!;
    createRoot(root).render(
      <StrictMode>
        <ItemDialogSatellite />
      </StrictMode>,
    );
    document.getElementById('__nost_satellite_boot')?.remove();
  } catch (err) {
    showVisibleError('boot', err);
  }
})();
