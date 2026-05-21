// Preload for the ItemDialog satellite window.
//
// Strategy: the satellite hosts the EXISTING ItemDialog component code
// (from frontend/src/components/ItemDialog.tsx), which depends on the
// full `electronAPI` surface (pickFolder / getFileIcon / analyzeClipboard
// etc.). Rather than duplicate that surface, we require the main app's
// preload.js — its `contextBridge.exposeInMainWorld('electronAPI', ...)`
// runs in *this* satellite renderer too, giving the dialog identical
// IPC access. Then we add a small `itemDialog` namespace for the
// satellite-specific state/action protocol.
//
// Background listeners attached by preload.js (boot:status etc.) are
// harmless no-ops here because main only `webContents.send()`s those
// to the main window, not to satellites.

require('./preload.js');

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('itemDialog', {
  /** Subscribe to state pushes from main (initial mount + subsequent
   *  updates from the source-of-truth main renderer). Returns an
   *  unsubscribe fn for useEffect cleanup. */
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('item-dialog-state', handler);
    return () => ipcRenderer.removeListener('item-dialog-state', handler);
  },

  /** Race-fix — renderer mounted, ask main to push current state. */
  requestState: () => ipcRenderer.send('item-dialog-request-state'),

  /** Fire a satellite action (save / close / pick-on-screen / etc.)
   *  back to main. Main forwards to the main window's renderer where
   *  the existing App.tsx handlers run. */
  action: (payload) => ipcRenderer.send('item-dialog-action', payload),
});
