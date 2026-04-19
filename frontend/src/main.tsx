import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { createLogger } from './lib/logger'

const log = createLogger('renderer:bootstrap');

log.info('main.tsx script start');
const rootEl = document.getElementById('root');
log.info(`#root element found: ${!!rootEl}`);

window.addEventListener('error', (e) => log.error(`window error: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
window.addEventListener('unhandledrejection', (e) => log.error('unhandledrejection', e.reason));

createRoot(rootEl!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
log.info('createRoot().render() called');
