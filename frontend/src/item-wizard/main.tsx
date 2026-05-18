// Satellite entry for the ItemWizard (quick-add / manual-add) window.
// See plans/satellite-dialogs.md.

import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '../index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ItemWizardSatellite } from './ItemWizardSatellite';

import('@fontsource-variable/material-symbols-rounded/full.css').catch(() => {
  console.warn('[material-symbols] dynamic import failed in item-wizard satellite');
});

const root = document.getElementById('root')!;
createRoot(root).render(
  <StrictMode>
    <ItemWizardSatellite />
  </StrictMode>,
);
