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
  const dragRef = useRef<{
    startScreenX: number; startScreenY: number;  // pointer at pointerdown (screen)
    startBadgeX:  number; startBadgeY:  number;  // badge at pointerdown (screen)
    started: boolean;
  } | null>(null);

  // Run the landing animation for 420 ms after mount, then remove the class.
  useEffect(() => {
    const t = setTimeout(() => setLanding(false), 420);
    return () => clearTimeout(t);
  }, []);

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
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startBadgeX:  data.x,
      startBadgeY:  data.y,
      started: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s) return;
    const dx = e.screenX - s.startScreenX;
    const dy = e.screenY - s.startScreenY;
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
    try {
      const inside = await api.isInsideMainWindow(e.screenX, e.screenY);
      if (inside) {
        api.unpin(data.id);
        return;
      }
    } catch { /* ignore — fall through to reposition */ }
    api.reposition(data.id, finalX, finalY);
    // Keep the optimistic local position until the next state push from main
    // overwrites `data.x/y`. Avoids a one-frame snap-back.
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
    transform:
      pressed   ? 'scale(0.92)' :
      dragging  ? 'scale(1.05)' :
      landing   ? 'scale(1)'    :
      hover     ? 'scale(1.06)' : 'scale(1)',
    transition: dragging
      ? 'none'
      : 'transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 180ms ease',
    willChange: 'transform',
    animation: landing ? 'nost-badge-land 420ms cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
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
    boxShadow: hover
      ? `0 8px 22px rgba(0,0,0,0.42), 0 0 0 3px ${hexToRgba(color, 0.22)}`
      : '0 3px 12px rgba(0,0,0,0.32)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    color: '#fff',
    fontSize: data.iconIsEmoji ? 24 : 22,
    fontFamily: data.iconIsEmoji
      ? 'inherit'
      : '"Material Symbols Rounded", "Material Symbols Outlined"',
    fontWeight: data.iconIsEmoji ? 400 : 500,
    fontVariationSettings: data.iconIsEmoji ? undefined : '"FILL" 1, "wght" 500',
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
        @keyframes nost-badge-land {
          0%   { transform: scale(0.2) translateY(-18px); opacity: 0; }
          55%  { transform: scale(1.18) translateY(2px);  opacity: 1; }
          80%  { transform: scale(0.96) translateY(0);    opacity: 1; }
          100% { transform: scale(1)    translateY(0);    opacity: 1; }
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
          {hasIcon
            ? iconContent
            : data.color
              ? <span style={colorDot} />
              : iconContent}
        </div>
      </div>
    </>
  );
}
