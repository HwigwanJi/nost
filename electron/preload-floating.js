// Minimal preload for the floating orb window.
// Exposes a narrow `window.orb` surface — no access to store, clipboard, etc.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orb', {
  // ── One-shot messages ───────────────────────────────────────────
  toggleMain:  () => ipcRenderer.send('floating-toggle-main'),
  contextMenu: () => ipcRenderer.send('floating-context-menu'),
  // clientX/Y = cursor offset within the orb window at drag start —
  // main uses this offset to pin the cursor to that point throughout the drag.
  dragStart:     (cx, cy) => ipcRenderer.send('floating-drag-start', cx, cy),
  dragHeartbeat: () => ipcRenderer.send('floating-drag-heartbeat'),
  dragEnd:       () => ipcRenderer.send('floating-drag-end'),

  // ── Event subscriptions ─────────────────────────────────────────
  onReady:    (cb) => ipcRenderer.on('floating-ready',    () => cb()),
  onSettings: (cb) => ipcRenderer.on('floating-settings', (_, s) => cb(s)),
});
