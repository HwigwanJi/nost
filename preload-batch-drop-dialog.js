// Preload for the BatchDropDialog satellite.
require('./preload.js');
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('batchDropDialog', {
  onState: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('batch-drop-dialog-state', h); return () => ipcRenderer.removeListener('batch-drop-dialog-state', h); },
  requestState: () => ipcRenderer.send('batch-drop-dialog-request-state'),
  action: (p) => ipcRenderer.send('batch-drop-dialog-action', p),
});
