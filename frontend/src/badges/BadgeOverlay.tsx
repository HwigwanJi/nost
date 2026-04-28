import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, type BadgeData } from './Badge';
import { MiniWindow } from './MiniWindow';

/**
 * Shape of the state payload pushed by main.js each time badges or their
 * referenced spaces/nodes/decks change. The overlay window is stateless —
 * it reflects whatever main sends.
 *
 * `overlayOrigin` is the top-left screen coord of the overlay BrowserWindow
 * (which spans the union of all displays). All badge screen coords get
 * translated into overlay-local coords by subtracting this origin.
 */
export interface OverlayState {
  badges: BadgeData[];
  overlayOrigin: { x: number; y: number };
  overlaySize:   { width: number; height: number };
}

interface BadgeApi {
  /** Returns an unsubscribe fn — call from useEffect cleanup so
   *  StrictMode's mount→unmount→remount doesn't pile up listeners. */
  onState:        (cb: (s: OverlayState) => void) => () => void;
  /** Ask main to (re-)push the current overlay state. Used at mount
   *  to defeat a race where main's one-shot ready-to-show push fired
   *  before this component's useEffect registered its listener — see
   *  preload-badges.js for the longer note. */
  requestState:   () => void;
  setCapture:     (capture: boolean) => void;
  unpin:          (id: string) => void;
  reposition:     (id: string, x: number, y: number) => void;
  contextMenu:    (id: string) => void;
  isInsideMainWindow: (x: number, y: number) => Promise<boolean>;
  /** Launch a specific item inside a ref's items list (mini-window click). */
  launchItem:     (refType: BadgeData['refType'], refId: string, itemId: string) => void;
  /** Launch the whole node/deck as a group ("묶음 실행" / "순차 실행"). */
  launchRef:      (refType: BadgeData['refType'], refId: string) => void;
}
const api = (window as unknown as { badges: BadgeApi }).badges;

export function BadgeOverlay() {
  // Hydration gate — until the first authoritative state push arrives,
  // we render nothing. Prevents the "transient render with default
  // 1920x1080 overlay size + zero origin" flash that caused badges to
  // briefly land at wrong screen coords before correcting.
  //
  // The defaults here (size 0/0, origin 0/0) are arbitrary and never
  // used — they exist only because useState requires an initial value
  // and hydratedRef.current === false gates rendering anyway.
  const [state, setState] = useState<OverlayState>({
    badges: [],
    overlayOrigin: { x: 0, y: 0 },
    overlaySize:   { width: 0, height: 0 },
  });
  const [hydrated, setHydrated] = useState(false);
  /** ID of the badge whose mini-window is currently expanded, or null. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Tracks the current capture flag so we only send IPC on transitions.
  const captureRef = useRef(false);

  useEffect(() => {
    // Pull the current state explicitly. Main's one-shot push on
    // `ready-to-show` was racing this effect — when the FIRST badge
    // was promoted, the listener wasn't registered in time and the
    // payload was dropped, so the overlay sat empty until a SECOND
    // promote fired pushBadgeState() again. Asking for state on
    // mount bypasses the race entirely.
    const off = api.onState((s) => {
      setState(prev => ({ ...prev, ...s }));
      setHydrated(true);
      // If the expanded badge was removed (unpinned / deleted space) close popover.
      setExpandedId(prev => {
        if (!prev) return prev;
        return s.badges.some(b => b.id === prev) ? prev : null;
      });
    });
    api.requestState();
    return off;
  }, []);

  // Click-through management.
  //
  // The overlay runs in ignore-mouse-events=true (forward=true) so background
  // windows receive clicks. Electron's forward mode still delivers mousemove
  // to THIS window, which we use to detect when the pointer enters a badge
  // rect — at that moment we flip ignore off (capture ON) so the badge can
  // receive clicks/drags. When the pointer leaves every badge we flip ignore
  // back on.
  //
  // The mini-window popover uses the same `data-badge` attribute, so the
  // capture stays ON while the cursor is over the popover too.
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const overBadge = (e.target as HTMLElement | null)?.closest?.('[data-badge]');
    // When a mini-window is open, keep capture on whenever the pointer is
    // anywhere on the overlay so outside-clicks can register and close it.
    const want = !!overBadge || expandedId !== null;
    if (want !== captureRef.current) {
      captureRef.current = want;
      api.setCapture(want);
    }
  }, [expandedId]);

  const handlePointerLeave = useCallback(() => {
    if (captureRef.current) {
      captureRef.current = false;
      api.setCapture(false);
    }
  }, []);

  // Badge click handler — toggles mini-window open/closed.
  const handleBadgeClick = useCallback((badgeId: string) => {
    setExpandedId(prev => prev === badgeId ? null : badgeId);
  }, []);

  const expandedBadge = expandedId
    ? state.badges.find(b => b.id === expandedId) ?? null
    : null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'auto',
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* Render badges only after the first authoritative state has
          arrived — avoids a transient frame with default origin/size
          where badges would land at the wrong screen coords and then
          jump when the real state replaced them. */}
      {hydrated && state.badges.map(b => (
        <Badge
          key={b.id}
          data={b}
          originX={state.overlayOrigin.x}
          originY={state.overlayOrigin.y}
          api={api}
          onClick={() => handleBadgeClick(b.id)}
        />
      ))}

      {expandedBadge && (
        <MiniWindow
          badge={expandedBadge}
          originX={state.overlayOrigin.x}
          originY={state.overlayOrigin.y}
          overlayWidth={state.overlaySize.width}
          overlayHeight={state.overlaySize.height}
          api={{
            launchItem: api.launchItem,
            launchRef:  api.launchRef,
            close:      () => setExpandedId(null),
          }}
        />
      )}
    </div>
  );
}
