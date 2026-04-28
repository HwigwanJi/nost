// Preload for the Save-As dialog companion popup.
//
// The popup is a small frameless BrowserWindow that main.js positions just
// above whichever Windows file dialog is in the foreground. It shows the
// user's spaces (Level 1) and on click drills into that space's folder cards
// (Level 2) so a folder path can be pasted into the dialog with one click.
//
// IPC surface kept narrow on purpose — the popup doesn't need the full app
// store, just the Space-by-Space folder list main pushes via `dialog-state`.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dialogPopup', {
  /**
   * Subscribe to data pushes from main. Called whenever the active preset's
   * spaces / folder cards change so the popup reflects current state without
   * a full page reload. Returns an unsubscribe fn for useEffect cleanup —
   * StrictMode's mount→unmount→remount otherwise piles up listeners.
   */
  onState: (cb) => {
    const handler = (_, state) => cb(state);
    ipcRenderer.on('dialog-popup-state', handler);
    return () => ipcRenderer.removeListener('dialog-popup-state', handler);
  },
  /** Renderer announces it's mounted; main responds with one immediate push.
   *  Same race-fix pattern used by the badges overlay. */
  requestState: () => ipcRenderer.send('dialog-popup-request-state'),

  /** Click → paste a folder path into the active dialog. Reuses the
   *  clipboard-based jump-to-dialog-folder pipeline. */
  jumpTo: (folderPath) => ipcRenderer.send('jump-to-dialog-folder', folderPath),

  /** User pressed ✕ — hide popup until the next dialog appears. */
  dismiss: () => ipcRenderer.send('dialog-popup-dismiss'),

  /** Tell main to grow the popup window upward (so the preset dropdown
   *  has room to open without being clipped at the window edge) or
   *  collapse it back to the default thin strip. */
  setExpanded: (expanded) => ipcRenderer.send('dialog-popup-set-expanded', !!expanded),
});
