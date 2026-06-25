// Dedicated entry for the Save-As dialog companion popup.
//
// Lightweight: no Tailwind, no shadcn, no app shell — just enough font
// loading for Korean labels + Material Symbol icons, then the DialogPopup
// component. Mirrors the badges overlay's loader pattern.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource-variable/material-symbols-rounded/full.css';
// Design-system tokens (var(--surface)/--accent/…). The popup is a satellite
// that doesn't import index.css, so without this the design tokens wouldn't
// resolve. Theme + accent are finalized at runtime from the pushed state.
import './tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogPopup } from './DialogPopup';

// Default to dark (app's default theme) to avoid a light flash before the
// first state push arrives; the renderer flips this from `state.theme`.
document.documentElement.classList.add('dark');

const container = document.getElementById('popup-root')!;
createRoot(container).render(
  <StrictMode>
    <DialogPopup />
  </StrictMode>,
);
