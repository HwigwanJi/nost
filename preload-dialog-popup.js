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

  /** Renderer toggles mouse capture as the pointer enters/leaves the
   *  interactive areas (chip strip, open dropdown menu). When `false`,
   *  the popup is click-through and the dialog underneath receives
   *  clicks; when `true`, the popup captures clicks normally. The
   *  popup window is sized larger than the visible chip strip to give
   *  the dropdown room to open without dynamic resize, so we need
   *  click-through on the transparent extra area. */
  setCapture: (capture) => ipcRenderer.send('dialog-popup-set-capture', !!capture),
});
