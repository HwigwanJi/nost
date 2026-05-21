// Preload for the ItemWizard satellite window.
// Same pattern as preload-item-dialog.js — reuse the main app's
// electronAPI surface (so the wizard can call analyzeClipboard /
// pickFolder / etc.) and add an `itemWizard` namespace for state/action.

require('./preload.js');

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('itemWizard', {
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('item-wizard-state', handler);
    return () => ipcRenderer.removeListener('item-wizard-state', handler);
  },
  requestState: () => ipcRenderer.send('item-wizard-request-state'),
  action: (payload) => ipcRenderer.send('item-wizard-action', payload),
});
