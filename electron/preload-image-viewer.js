// Preload for the ImageViewer satellite window.
// Minimal — viewer 는 readonly view (path 받아서 표시 + close 만 발화).
require('./preload.js');
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('imageViewer', {
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('image-viewer-state', handler);
    return () => ipcRenderer.removeListener('image-viewer-state', handler);
  },
  requestState: () => ipcRenderer.send('image-viewer-request-state'),
  action: (payload) => ipcRenderer.send('image-viewer-action', payload),
});
