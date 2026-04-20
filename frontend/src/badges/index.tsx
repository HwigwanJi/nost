import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BadgeOverlay } from './BadgeOverlay';

// Dedicated entry for the floating-badges overlay BrowserWindow.
// One React root renders ALL badges at absolute screen coords to avoid the
// RAM cost of spawning one BrowserWindow per badge.

const container = document.getElementById('badge-root')!;
createRoot(container).render(
  <StrictMode>
    <BadgeOverlay />
  </StrictMode>,
);
