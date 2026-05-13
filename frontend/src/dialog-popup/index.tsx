// Dedicated entry for the Save-As dialog companion popup.
//
// Lightweight: no Tailwind, no shadcn, no app shell — just enough font
// loading for Korean labels + Material Symbol icons, then the DialogPopup
// component. Mirrors the badges overlay's loader pattern.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource-variable/material-symbols-rounded/full.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogPopup } from './DialogPopup';

const container = document.getElementById('popup-root')!;
createRoot(container).render(
  <StrictMode>
    <DialogPopup />
  </StrictMode>,
);
