// Preload for the floating-badges overlay window.
//
// The overlay is ONE transparent, always-on-top, virtual-desktop-sized window
// that renders every FloatingBadge at absolute screen coords. It runs in
// click-through mode by default; the renderer flips capture on/off as the
// pointer enters/leaves a badge rect.
//
// This preload exposes only the narrow surface the overlay needs — no store,
// no clipboard, no launch APIs. The overlay asks main for data and delegates
// actions (activate / unpin / reposition) back through IPC.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('badges', {
  // ── Data push from main ───────────────────────────────────────────
  /**
   * Subscribe to overlay-state pushes. Returns an unsubscribe fn so
   * useEffect cleanup can detach. Without this, React StrictMode's
   * mount → unmount → re-mount cycle accumulated a fresh listener
   * on every cycle (no removeListener) and every push fan-outed to
   * all of them — extra setState churn and a small window where the
   * partial state was visible.
   */
  onState: (cb) => {
    const handler = (_, state) => cb(state);
    ipcRenderer.on('badges-state', handler);
    return () => ipcRenderer.removeListener('badges-state', handler);
  },
  /**
   * Renderer announces "I'm mounted and listening — push me the
   * current state." Exists because main's one-shot push on
   * `ready-to-show` raced React's useEffect (the listener wasn't
   * registered yet when the push fired). Calling this from the
   * overlay's mount effect guarantees we always get the initial
   * state regardless of mount-order timing.
   */
  requestState: () => ipcRenderer.send('badges-request-state'),

  // ── Mouse-event pass-through toggling ─────────────────────────────
  /**
   * Tell main to flip setIgnoreMouseEvents. `capture=true` → window catches
   * clicks (pointer is over a badge). `capture=false` → window is pass-through
   * (pointer is over empty overlay canvas).
   */
  setCapture: (capture) => ipcRenderer.send('badges-set-capture', !!capture),

  // ── Actions ───────────────────────────────────────────────────────
  /** Launch a specific item inside a ref's items list (mini-window click). */
  launchItem:     (refType, refId, itemId) =>
                   ipcRenderer.send('badges-launch-item', { refType, refId, itemId }),
  /** Launch the whole node/deck as a group ("묶음 실행" / "순차 실행"). */
  launchRef:      (refType, refId) =>
                   ipcRenderer.send('badges-launch-ref', { refType, refId }),
  unpin:          (badgeId) => ipcRenderer.send('badges-unpin', badgeId),
  /** Persist new screen coords after a drag. */
  reposition:     (badgeId, x, y) => ipcRenderer.send('badges-reposition', badgeId, x, y),
  /** Open the main window's right-click menu for this badge. */
  contextMenu:    (badgeId) => ipcRenderer.send('badges-context-menu', badgeId),
  /** Ask main whether a screen-point is inside the main window bounds. Used
   *  for "drag badge back into main window" = unpin gesture. */
  isInsideMainWindow: (x, y) => ipcRenderer.invoke('badges-is-inside-main', x, y),
});
