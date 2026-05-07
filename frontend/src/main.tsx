import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import AppShell from './AppShell.tsx'
import { createLogger } from './lib/logger'

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
