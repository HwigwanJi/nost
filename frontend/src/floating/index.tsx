import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FloatingOrb } from './FloatingOrb';

// Dedicated entry for the always-on-top floating orb BrowserWindow.
// Kept intentionally minimal — no Tailwind preflight, no shared providers —
// so the window stays light and renders instantly on app launch.

const container = document.getElementById('floating-root')!;
createRoot(container).render(
  <StrictMode>
    <FloatingOrb />
  </StrictMode>,
);
