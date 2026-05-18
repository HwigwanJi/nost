// Preload for the SettingsDialog satellite window.
require('./preload.js');
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsDialog', {
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('settings-dialog-state', handler);
    return () => ipcRenderer.removeListener('settings-dialog-state', handler);
  },
  requestState: () => ipcRenderer.send('settings-dialog-request-state'),
  action: (payload) => ipcRenderer.send('settings-dialog-action', payload),
});
