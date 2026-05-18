// Settings satellite entry. See plans/satellite-dialogs.md.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '../index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsDialogSatellite } from './SettingsDialogSatellite';

import('@fontsource-variable/material-symbols-rounded/full.css').catch(() => {
  console.warn('[material-symbols] dynamic import failed in settings-dialog satellite');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsDialogSatellite />
  </StrictMode>,
);
