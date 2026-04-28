import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * One item inside a ref's mini-window popover. Carries only what the overlay
 * needs to render + launch — not the full LauncherItem.
 */
export interface BadgeItem {
  id: string;
  title: string;
  type: 'url' | 'folder' | 'app' | 'window' | 'browser' | 'text' | 'cmd';
  value: string;
  icon?: string;
  iconType?: 'material' | 'image';
  color?: string;
  pinned?: boolean;
}

/**
 * Resolved badge data — main.js joins FloatingBadge with its Space/Node/Deck
 * source so the renderer doesn't need to know the full store shape.
 */
export interface BadgeData {
  id: string;
  refType: 'space' | 'node' | 'deck';
  refId: string;
  x: number;                 // screen coord (absolute)
  y: number;
  label: string;             // display name (space.name / node.name / deck.name)
  color?: string;            // hex (#RRGGBB)
  icon?: string | null;      // material symbol name OR emoji; null → fallback
  iconIsEmoji?: boolean;
  count?: number;            // items count shown as a subtle numeric hint
  items?: BadgeItem[];       // resolved items shown inside the mini-window popover
}

interface BadgeApi {
  setCapture: (capture: boolean) => void;
  unpin:      (id: string) => void;
  reposition: (id: string, x: number, y: number) => void;
  contextMenu:(id: string) => void;
  isInsideMainWindow: (x: number, y: number) => Promise<boolean>;
}

interface Props {
  data: BadgeData;
  originX: number;   // overlay BrowserWindow's screen x (all displays union)
  originY: number;
  api: BadgeApi;
  /** Called on a bare left-click (no drag). Parent decides what "activate"
   *  means — currently it toggles the mini-window popover. */
  onClick: () => void;
}

// Circular bubble — icon-only, no dangling text label. The click expands a
// mini-window popover (rendered by BadgeOverlay) that shows the referenced
// space/node/deck's items; see BadgeOverlay.tsx for that behaviour.
const BADGE_SIZE = 46;
const DRAG_THRESHOLD = 4;
const DEFAULT_COLOR = '#6366f1';

function hexToRgba(hex: string, alpha: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m) return `rgba(99, 102, 241, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Type glyph shown on the bottom-right corner so users can tell space vs node
// vs deck at a glance when icon/name are indistinguishable.
const TYPE_GLYPH: Record<BadgeData['refType'], string> = {
  space: '●',
  node:  '◆',
  deck:  '■',
};

export function Badge({ data, originX, originY, api, onClick }: Props) {
  // Local position during drag — flips the element from server-authoritative
  // to local-authoritative while the user is moving it, then commits via
  // api.reposition on release.
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover]       = useState(false);
  const [pressed, setPressed]   = useState(false);
  const [dragging, setDragging] = useState(false);
  const [landing, setLanding]   = useState(true); // one-shot "boing" on mount

  // Drag bookkeeping.
  //
  // We capture pointer position via clientX/clientY (window-relative CSS
  // pixels) rather than screenX/screenY. Chromium on Windows returns screenX
  // in *physical* pixels when DPI scaling is active, so mixing a physical-
  // pixel delta with a DIP-based badge origin made the badge drift by the
  // monitor's scale factor after the first drag. clientX is guaranteed CSS
  // pixels in the overlay window's frame, and the overlay is sized in DIP
  // 1:1, so `clientDelta` is a correct DIP delta.
  const dragRef = useRef<{
    startClientX: number; startClientY: number;  // pointer at pointerdown (window CSS px)
    startBadgeX:  number; startBadgeY:  number;  // badge at pointerdown (screen DIP)
    started: boolean;
  } | null>(null);

  // Run the landing animation for 220 ms after mount, then remove the class.
  // The keyframe rises monotonically (0.78 → 1.0) without any overshoot —
  // a previous version peaked at 1.04 / 1.08, which made the post-landing
  // resting state look like the badge had *shrunk* after the user touched
  // it. Eliminating the >1 peak removes the illusion entirely.
  useEffect(() => {
    const t = setTimeout(() => setLanding(false), 220);
    return () => clearTimeout(t);
  }, []);

  // When main's authoritative push catches up with our optimistic localPos,
  // drop the optimistic state. Otherwise a stale `localPos` would keep
  // masking `data.x/y` forever, and the NEXT drag's math anchors against
  // data.x while the element is visually rendered at localPos — producing a
  // noticeable jump at drag start ("이상한 곳으로 튄다").
  useEffect(() => {
    if (localPos && localPos.x === data.x && localPos.y === data.y) {
      setLocalPos(null);
    }
  }, [data.x, data.y, localPos]);

  const color = data.color ?? DEFAULT_COLOR;

  // Effective screen → overlay-local translation.
  const screenX = localPos?.x ?? data.x;
  const screenY = localPos?.y ?? data.y;
  const left    = screenX - originX;
  const top     = screenY - originY;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // left only; right-click = context menu
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setPressed(true);
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      // Anchor against the CURRENTLY rendered position (localPos may still
      // hold an optimistic value from a previous drag that main hasn't echoed
      // back yet). Reading only `data.x` here was the source of the visible
      // "jump to stale position" on the second drag.
      startBadgeX:  localPos?.x ?? data.x,
      startBadgeY:  localPos?.y ?? data.y,
      started: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s) return;
    const dx = e.clientX - s.startClientX;
    const dy = e.clientY - s.startClientY;
    if (!s.started && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!s.started) {
      s.started = true;
      setDragging(true);
    }
    setLocalPos({ x: s.startBadgeX + dx, y: s.startBadgeY + dy });
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const s = dragRef.current;
    dragRef.current = null;
    setPressed(false);

    if (!s) return;

    if (!s.started) {
      // Bare click → let parent decide (toggles mini-window popover).
      setLocalPos(null);
      onClick();
      return;
    }

    // Drag release — if the cursor landed inside the main nost window,
    // interpret as "unpin" gesture. Otherwise persist the new position.
    setDragging(false);
    const finalX = (localPos?.x ?? data.x);
    const finalY = (localPos?.y ?? data.y);
    // The isInsideMainWindow check needs SCREEN coords — translate the final
    // badge screen coord from the drop pointer's client coord via the overlay
    // origin. Using e.screenX directly was unreliable on fractional-DPI
    // Windows setups (same physical-vs-DIP mismatch as the drag math).
    const dropScreenX = originX + e.clientX;
    const dropScreenY = originY + e.clientY;
    try {
      const inside = await api.isInsideMainWindow(dropScreenX, dropScreenY);
      if (inside) {
        api.unpin(data.id);
        return;
      }
    } catch { /* ignore — fall through to reposition */ }
    api.reposition(data.id, finalX, finalY);
    // Keep the optimistic local position until the next state push from main
    // catches up (see the useEffect near the top — it clears localPos when
    // data.x/y match, so subsequent drags anchor against the fresh coord).
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    setPressed(false);
    setDragging(false);
    setLocalPos(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    api.contextMenu(data.id);
  };

  // ── Styles ─────────────────────────────────────────────────
  const wrap: CSSProperties = {
    position: 'absolute',
    left,
    top,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    // Let React/DOM hit-testing decide — the outer overlay handles the
    // ignore-mouse toggle via closest('[data-badge]').
    pointerEvents: 'auto',
    cursor: dragging ? 'grabbing' : 'grab',
    // Resting / interaction transforms. Note: hover scale (1.04) is now
    // ≤ landing peak (also 1.0) so once the landing animation finishes
    // there is no perceived size jump. Drag scale stays slightly larger
    // (1.05) so the user gets visual confirmation while moving.
    transform:
      pressed   ? 'scale(0.92)' :
      dragging  ? 'scale(1.05)' :
      landing   ? 'scale(1)'    :
      hover     ? 'scale(1.04)' : 'scale(1)',
    transition: dragging
      ? 'none'
      // Spring easing removed (was overshooting on tiny scale deltas and
      // visually competing with the landing keyframe). Pure ease-out is
      // boring but reads as solid.
      : 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms ease',
    willChange: 'transform',
    animation: landing ? 'nost-badge-land 220ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
  };

  // ── Icon resolution ──────────────────────────────────────
  // Priority: user-set icon → color dot fallback → type glyph fallback.
  // No text labels anywhere on the bubble; the native `title` attribute
  // carries the name as a tooltip, and the mini-window popover shows the
  // full ref name when the bubble is clicked.
  const hasIcon = !!data.icon;
  const iconContent = hasIcon
    ? data.icon
    : (data.color ? null : TYPE_GLYPH[data.refType]);

  // Circular frosted-glass bubble tinted by the ref's color.
  const disc: CSSProperties = {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    background: `linear-gradient(145deg, ${hexToRgba(color, 0.92)}, ${hexToRgba(color, 0.68)})`,
    border: `1.5px solid ${hexToRgba(color, hover ? 0.95 : 0.7)}`,
    // Shadow tuned ~30% lighter than the original 0.32 / 0.42 — the badge
    // sits over arbitrary desktop content and the heavy shadow read as a
    // black halo in many app contexts. The hover variant keeps a subtle
    // colored ring so the bubble still feels lifted on focus.
    boxShadow: hover
      ? `0 8px 22px rgba(0,0,0,0.30) , 0 0 0 3px ${hexToRgba(color, 0.18)}`
      : '0 3px 12px rgba(0,0,0,0.22)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    color: '#fff',
    fontSize: data.iconIsEmoji ? 24 : 22,
    // Font-family for Material Symbols lives on the inner span (see ms-rounded
    // class in badges.html). Emojis inherit the Pretendard-backed body stack
    // so they render with the same kerning as the rest of the overlay.
    userSelect: 'none',
    overflow: 'hidden',
  };

  // Color-dot fallback: a lighter pill at the bubble centre when the ref has
  // no icon but has a color. Smaller than the bubble so the tinted gradient
  // backdrop still reads as "this is space X".
  const colorDot: CSSProperties = {
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    opacity: 0.9,
    boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.06)',
  };

  return (
    <>
      {/* Keyframes for one-shot landing animation. Kept co-located so the
          overlay has no external CSS dependency. */}
      <style>{`
        /* Pure scale + opacity rise — NO translateY. An earlier
           version included a 6 px translateY that disappeared at
           the keyframe end; users perceived this as the badge
           "jumping down" 6 px right after appearing, especially
           when their first click happened to coincide with the
           220 ms animation boundary. Scale + fade alone is enough
           visual interest without touching final position. */
        @keyframes nost-badge-land {
          0%   { transform: scale(0.84); opacity: 0; }
          100% { transform: scale(1);    opacity: 1; }
        }
      `}</style>
      <div
        data-badge={data.id}
        style={wrap}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={`${data.label} — 클릭: 미니 창 열기 · 드래그: 이동 · 창으로 드롭: 복귀 · 우클릭: 메뉴`}
      >
        <div style={disc}>
          {hasIcon ? (
            data.iconIsEmoji
              ? <span>{iconContent}</span>
              : <span className="ms-rounded" style={{ fontSize: 22 }}>{iconContent}</span>
          ) : data.color
              ? <span style={colorDot} />
              : <span>{iconContent}</span>}
        </div>
      </div>
    </>
  );
}
