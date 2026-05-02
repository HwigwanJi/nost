// Preload for the screen-capture color picker window.
//
// The picker is a fullscreen, frameless, alwaysOnTop BrowserWindow that
// renders a screenshot of the desktop captured at the moment the user
// clicked the eyedropper icon. The user mouses around the captured
// image, a magnifier follows the cursor, and clicking commits the
// pixel under the crosshair.
//
// This preload exposes only what picker.html needs — no store, no
// clipboard, no launch APIs.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  /** Subscribe to the one-shot init push from main with the screenshot
   *  data URL + display geometry. Called from picker.html on load. */
  onInit: (cb) => {
    const handler = (_, payload) => cb(payload);
    ipcRenderer.on('picker-init', handler);
    return () => ipcRenderer.removeListener('picker-init', handler);
  },
  /** User clicked a pixel — send the hex back and let main close us. */
  result: (hex) => ipcRenderer.send('picker-result', hex),
  /** Esc / Alt+F4 / blur — abort. */
  cancel: () => ipcRenderer.send('picker-cancel'),
});
