import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

/**
 * Phase 1 MVP — Main floating FAB.
 *
 * Behaviour:
 *  - Left-click              → IPC `floating-toggle-main` (same effect as Alt+4)
 *  - Right-click             → IPC `floating-context-menu`
 *  - Drag (move past 4 px)   → IPC `floating-drag-start`, main polls cursor,
 *                              renderer heartbeats every 200 ms while pressed,
 *                              `floating-drag-end` fires on pointer release.
 *
 * Click-vs-drag is decided by a 4 px dead-zone: movement below threshold is
 * treated as a click (no polling ever starts), movement above threshold
 * transitions into drag mode. This keeps the orb rock-still under a bare
 * press and eliminates the "orb follows cursor after click" bug that the
 * naive eager-start approach produced.
 *
 * Colors flow in from main so the orb inherits the app's accent setting.
 */

interface OrbSettings {
  idleOpacity: number;
  size: 'small' | 'normal';
  accentColor: string;
}

interface OrbApi {
  onReady:       (cb: () => void) => void;
  onSettings:    (cb: (s: OrbSettings) => void) => void;
  toggleMain:    () => void;
  contextMenu:   () => void;
  dragStart:     (clientX: number, clientY: number) => void;
  dragHeartbeat: () => void;
  dragEnd:       () => void;
}

const orb = (window as unknown as { orb: OrbApi }).orb;

const DRAG_THRESHOLD_PX   = 4;    // movement required to enter drag mode
const HEARTBEAT_INTERVAL  = 200;  // ms — must be faster than main's watchdog

// ── Color helpers ───────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m) return `rgba(99, 102, 241, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ── Nost "n" mark (tintable) ────────────────────────────────────────────
function NostMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none">
      <path
        d="M 116 418 L 116 196 Q 116 88 256 88 Q 396 88 396 196 L 396 418 L 326 418 L 326 212 Q 326 158 256 158 Q 186 158 186 212 L 186 418 Z"
        fill={color}
      />
    </svg>
  );
}

export function FloatingOrb() {
  const [idleOpacity, setIdleOpacity] = useState(0.65);
  const [size, setSize]               = useState<'small' | 'normal'>('normal');
  const [accent, setAccent]           = useState('#6366f1');
  const [hover, setHover]             = useState(false);
  const [dragging, setDragging]       = useState(false);
  const [pressed, setPressed]         = useState(false);

  // Track whether the pointer exceeded the drag threshold since pointerdown.
  // `started` gates both the dragStart IPC and the heartbeat timer so a bare
  // press never enters drag mode.
  const dragState = useRef<{
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Receive settings pushed from main.
  useEffect(() => {
    orb.onSettings(({ idleOpacity: op, size: sz, accentColor: ac }) => {
      setIdleOpacity(op);
      setSize(sz);
      if (ac) setAccent(ac);
    });
  }, []);

  // Safety: on unmount / hot-reload, make sure any running drag is ended so
  // main's interval doesn't leak.
  useEffect(() => () => {
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    heartbeatTimer.current = null;
    if (dragState.current?.started) orb.dragEnd();
  }, []);

  // ── Derived visual state ──────────────────────────────────────
  const orbPx  = size === 'small' ? 40 : 48;
  const markPx = size === 'small' ? 18 : 22;
  const currentOpacity = dragging || hover ? 1 : idleOpacity;

  const tints = useMemo(() => ({
    borderIdle:  hexToRgba(accent, 0.28),
    borderHover: hexToRgba(accent, 0.55),
    haloHover:   hexToRgba(accent, 0.12),
    mark:        hexToRgba(accent, 0.95),
  }), [accent]);

  // ── Drag lifecycle helpers ────────────────────────────────────
  const beginDrag = (startX: number, startY: number) => {
    const st = dragState.current;
    if (!st || st.started) return;
    st.started = true;
    setDragging(true);
    // Tell main where on the orb the cursor grabbed — it pins to that offset.
    orb.dragStart(startX, startY);
    // Heartbeat so main knows we're still alive; if the renderer stops (crash,
    // unmount, lost pointer capture) main cleans up after 500 ms.
    heartbeatTimer.current = setInterval(() => orb.dragHeartbeat(), HEARTBEAT_INTERVAL);
  };

  const endDrag = (clicked: boolean) => {
    const st = dragState.current;
    dragState.current = null;
    setDragging(false);
    setPressed(false);
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }

    if (!st) return;
    if (st.started) orb.dragEnd();
    else if (clicked) orb.toggleMain();
  };

  // ── Pointer handlers ──────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setPressed(true);
    dragState.current = { startX: e.clientX, startY: e.clientY, started: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // NB: we do NOT notify main yet — only once the user actually drags.
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const st = dragState.current;
    if (!st || st.started) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    beginDrag(st.startX, st.startY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    endDrag(/* clicked */ true);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    endDrag(/* clicked */ false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    orb.contextMenu();
  };

  // ── Styles ────────────────────────────────────────────────────
  const wrapStyle: CSSProperties = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
  };

  const orbStyle: CSSProperties = {
    width: orbPx,
    height: orbPx,
    borderRadius: '50%',
    background: 'rgba(13, 13, 32, 0.88)',
    backdropFilter: 'blur(20px) saturate(160%)',
    border: `1px solid ${hover ? tints.borderHover : tints.borderIdle}`,
    // Shadows intentionally sized to stay within the 22 px window padding —
    // `0 offsetY blur` bleeds roughly blur*1.2 past the element, so max total
    // extent below = offsetY + blur*1.2. Hover = 3 + 12*1.2 ≈ 18 px; idle
    // = 2 + 8*1.2 ≈ 12 px. Both comfortably inside the transparent padding.
    boxShadow: hover
      ? `0 3px 12px rgba(0,0,0,0.40), 0 0 0 2px ${tints.haloHover}`
      : '0 2px 8px rgba(0,0,0,0.30)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: currentOpacity,
    transition: dragging
      ? 'none'
      : 'opacity 200ms ease, border-color 150ms ease, box-shadow 200ms ease, transform 120ms cubic-bezier(0.3, 0.9, 0.3, 1.2)',
    transform: pressed ? 'scale(0.92)' : dragging ? 'scale(1.05)' : 'scale(1)',
    cursor: dragging ? 'grabbing' : 'grab',
    willChange: 'transform, opacity',
  };

  return (
    <div style={wrapStyle}>
      <div
        style={orbStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="클릭: nost 토글 · 우클릭: 메뉴 · 드래그: 이동"
      >
        <NostMark size={markPx} color={tints.mark} />
      </div>
    </div>
  );
}
