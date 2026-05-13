import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import AppShell from './AppShell.tsx'
import { createLogger } from './lib/logger'

// Material Symbols (5MB woff2) is loaded asynchronously to avoid
// blocking CSSOM construction during first cold start. Kicked off
// at module top so the request goes out as early as possible (the
// browser's CSS preload scanner won't see it because it's not in
// index.css anymore — this dynamic import is the substitute).
//
// Trade-off: until the font finishes loading, icons render as their
// ligature names (e.g. "home", "settings"). @fontsource ships with
// `font-display: swap` so the fallback → icon transition happens
// inside CSS without our intervention; in practice the user sees
// ligature text only on truly cold first-launch + slow disks (~few
// hundred ms).
//
// AppShell's boot gate waits on `document.fonts.ready`, which DOES
// include the dynamically-imported font once its @font-face rules
// register — so the overlay still dismisses only after icons are
// visible-ready, not before.
import('@fontsource-variable/material-symbols-rounded/full.css').catch(() => {
  // CSS load failure is non-fatal — the rest of the app still works,
  // icons just stay as ligature text. Log via console rather than the
  // shared logger because logger.ts depends on electronAPI which
  // hasn't been wired yet at module-init time.
  console.warn('[material-symbols] dynamic import failed; icons may render as text');
});

// Renderer-side Sentry. DSN baked at build time via Vite env. Without
// it (no .env or build-from-source), init is skipped — Sentry's API
// is safe to no-op against. Errors that pass here also get captured
// by the main-process Sentry through the @sentry/electron bridge so
// crashes have full context across processes.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    release: __APP_VERSION__,
    environment: import.meta.env.MODE,
    tracesSampleRate: parseFloat(import.meta.env.VITE_SENTRY_TRACES_RATE || '0'),
    integrations: [],
  });
}

const log = createLogger('renderer:bootstrap');

log.info('main.tsx script start');
const rootEl = document.getElementById('root');
log.info(`#root element found: ${!!rootEl}`);

window.addEventListener('error', (e) => log.error(`window error: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
window.addEventListener('unhandledrejection', (e) => log.error('unhandledrejection', e.reason));

createRoot(rootEl!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
)
log.info('createRoot().render() called');
