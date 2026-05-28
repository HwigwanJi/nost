// ImageViewer satellite entry. See plans/satellite-dialogs.md.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '../index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageViewerSatellite } from './ImageViewerSatellite';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ImageViewerSatellite />
  </StrictMode>,
);
