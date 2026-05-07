// Splash window preload — minimal API surface, just enough for the
// error-state recovery UI (restart + open logs) and to receive the
// "show error" signal from main.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashAPI', {
  onError: (cb) => {
    ipcRenderer.on('splash:show-error', () => cb());
  },
  restart: () => ipcRenderer.send('splash:restart'),
  openLogs: () => ipcRenderer.send('splash:open-logs'),
});
