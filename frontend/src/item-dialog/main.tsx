// Satellite entry for the ItemDialog (card add/edit) BrowserWindow.
//
// Why a satellite: when the user pair-splits nost narrow, an inline
// Radix Dialog gets clipped to the BrowserWindow rectangle. Hosting the
// dialog in its own window lets it span the whole monitor regardless of
// where the main launcher is positioned. See plans/satellite-dialogs.md.
//
// Lifecycle: main.js creates this window via createItemDialogWindow()
// with an initial state payload. We mount ItemDialogSatellite which
// pulls state via `itemDialog.onState` (same pattern as the dialog-popup
// companion) and forwards user actions back via `itemDialog.action`.

import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '../index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ItemDialogSatellite } from './ItemDialogSatellite';

// Material Symbols on-demand (mirrors main.tsx's deferred load).
import('@fontsource-variable/material-symbols-rounded/full.css').catch(() => {
  console.warn('[material-symbols] dynamic import failed in item-dialog satellite');
});

const root = document.getElementById('root')!;
createRoot(root).render(
  <StrictMode>
    <ItemDialogSatellite />
  </StrictMode>,
);
