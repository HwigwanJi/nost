// Pretendard + Material Symbols fonts.
//
// The overlay BrowserWindow loads a dedicated `badges.html` — it does NOT
// import `index.css` or Tailwind (to keep the bundle tiny). That means
// without these two explicit imports, every Material Symbol icon rendered
// inside the overlay would fall back to its *ligature literal* (e.g. the
// string "folder_open") which looked like raw "weird text" on the badge
// face. Same story for Korean labels falling back to the OS default sans.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource-variable/material-symbols-rounded/full.css';

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
