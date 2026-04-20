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
  onState:        (cb: (s: OverlayState) => void) => void;
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
  const [state, setState] = useState<OverlayState>({
    badges: [],
    overlayOrigin: { x: 0, y: 0 },
    overlaySize:   { width: 1920, height: 1080 },
  });
  /** ID of the badge whose mini-window is currently expanded, or null. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Tracks the current capture flag so we only send IPC on transitions.
  const captureRef = useRef(false);

  useEffect(() => {
    api.onState((s) => {
      setState(prev => ({
        ...prev,
        ...s,
      }));
      // If the expanded badge was removed (unpinned / deleted space) close popover.
      setExpandedId(prev => {
        if (!prev) return prev;
        return s.badges.some(b => b.id === prev) ? prev : null;
      });
    });
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
      {state.badges.map(b => (
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
