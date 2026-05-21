// Preload for the ContainerSlotPicker satellite.
require('./preload.js');
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('containerSlotPicker', {
  onState: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('container-slot-picker-state', h); return () => ipcRenderer.removeListener('container-slot-picker-state', h); },
  requestState: () => ipcRenderer.send('container-slot-picker-request-state'),
  action: (p) => ipcRenderer.send('container-slot-picker-action', p),
});
