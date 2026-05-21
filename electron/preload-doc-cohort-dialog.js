// Preload for the DocCohortDialog satellite.
require('./preload.js');
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('docCohortDialog', {
  onState: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('doc-cohort-dialog-state', h); return () => ipcRenderer.removeListener('doc-cohort-dialog-state', h); },
  requestState: () => ipcRenderer.send('doc-cohort-dialog-request-state'),
  action: (p) => ipcRenderer.send('doc-cohort-dialog-action', p),
});
