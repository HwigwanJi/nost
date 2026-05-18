import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '../index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DocCohortDialogSatellite } from './DocCohortDialogSatellite';

import('@fontsource-variable/material-symbols-rounded/full.css').catch(() => {
  console.warn('[material-symbols] dynamic import failed in doc-cohort-dialog satellite');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode><DocCohortDialogSatellite /></StrictMode>,
);
