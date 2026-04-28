import { createPortal } from 'react-dom';
import { useEffect, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { LauncherItem } from '../types';

/**
 * ContainerBloom — the 4-direction slot drop overlay that appears when
 * the user drags a card over an existing container.
 *
 * Spawned by App.tsx based on dnd-kit's `over` state and a 250 ms
 * dwell timer. The bloom renders in a portal at document.body so it
 * floats above everything (other cards, accordion borders, etc.) and
 * isn't clipped by any ancestor `overflow: hidden`.
 *
 * What it shows:
 *   - 4 slot rectangles fanned out N/E/S/W of the container's rect,
 *     each 64×64 with 70 px gap.
 *   - Filled slots show a tiny preview of the item already there;
 *     empty slots show a directional arrow.
 *   - The "hot" slot (closest to current pointer position) scales up
 *     and gains an accent glow; the others dim.
 *   - Faint connecting lines between container center and each zone
 *     to read as "these belong together".
 *
 * Animation:
 *   - Open: 320 ms staggered fan-out (top→right→bottom→left, 50 ms
 *     between). Each zone scales 0.7 → 1 with the spring curve we use
 *     elsewhere in nost (cubic-bezier(0.34, 1.56, 0.64, 1)).
 *   - Hot/cold transitions: 100 ms ease.
 *   - Close: caller swaps the component out; we don't animate retract
 *     here because the parent decides timing (commit vs cancel).
 *
 * The component is purely presentational. It doesn't know which item
 * is being dragged or what the slots' final state should be — those
 * are concerns of the parent's drop handler.
 */

export type Dir = 'up' | 'down' | 'left' | 'right';

interface Props {
  /** Container card's screen-space bounding rect. */
  containerRect: DOMRect;
  /** Items currently filling each slot (resolved by parent). */
  filledSlots: { up?: LauncherItem; down?: LauncherItem; left?: LauncherItem; right?: LauncherItem };
  /** Direction the user is currently hovering over, if any. */
  hotDir: Dir | null;
  /** Container's accent color — falls back to the global accent var. */
  accent?: string;
}

const ZONE_SIZE = 64;
const ZONE_GAP  = 14;       // gap between container edge and zone
const STAGGER_MS = 50;      // delay between each direction's entry

const DIRECTIONS: Dir[] = ['up', 'right', 'down', 'left'];
const DIR_INDEX: Record<Dir, number> = { up: 0, right: 1, down: 2, left: 3 };

const DIR_ICON: Record<Dir, string> = {
  up:    'arrow_upward',
  right: 'arrow_forward',
  down:  'arrow_downward',
  left:  'arrow_back',
};

export function ContainerBloom({ containerRect, filledSlots, hotDir, accent }: Props) {
  // The component mounts on bloom open and unmounts on close, so we
  // simply use a "mounted-ms-ago" tick to drive the stagger animation
  // — no need to listen to opened/closed transitions.
  const [mountedAt] = useState(() => performance.now());
  const [, setNow] = useState(0);
  // Drive a brief animation frame loop for the first 350 ms so each
  // zone can compute its own elapsed-ms and apply the right transform.
  useEffect(() => {
    let raf: number;
    let done = false;
    const tick = () => {
      const elapsed = performance.now() - mountedAt;
      setNow(elapsed);
      if (elapsed > 360 || done) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { done = true; cancelAnimationFrame(raf); };
  }, [mountedAt]);

  const accentColor = accent ?? 'var(--accent)';
  const elapsed = performance.now() - mountedAt;

  const cx = containerRect.left + containerRect.width  / 2;
  const cy = containerRect.top  + containerRect.height / 2;

  // Each zone's anchor is OUTSIDE the container by ZONE_GAP.
  // We compute (left, top) of the zone's box (top-left corner) so
  // CSS positioning is straightforward.
  const zonePos = (dir: Dir) => {
    const halfW = containerRect.width  / 2;
    const halfH = containerRect.height / 2;
    let zx = cx, zy = cy;
    switch (dir) {
      case 'up':    zy = containerRect.top    - ZONE_GAP - ZONE_SIZE; break;
      case 'down':  zy = containerRect.bottom + ZONE_GAP;             break;
      case 'left':  zx = containerRect.left   - ZONE_GAP - ZONE_SIZE; break;
      case 'right': zx = containerRect.right  + ZONE_GAP;             break;
    }
    if (dir === 'up' || dir === 'down') zx = cx - ZONE_SIZE / 2;
    if (dir === 'left' || dir === 'right') zy = cy - ZONE_SIZE / 2;
    // halfW/halfH are referenced to silence the "declared but not used"
    // warning — keep them readable for future "compact mode" tweaks.
    void halfW; void halfH;
    return { left: zx, top: zy };
  };

  // Stagger: each direction starts its open animation at index*STAGGER_MS.
  const animProgress = (dir: Dir) => {
    const offset = DIR_INDEX[dir] * STAGGER_MS;
    const local = elapsed - offset;
    if (local <= 0) return 0;
    const dur = 240;  // duration of the fan-out per zone
    return Math.min(1, local / dur);
  };

  return createPortal(
    <div
      // Above all app content but below any system modal we might add later.
      // pointerEvents: none so the bloom doesn't eat the dnd-kit drag —
      // the bloom is a visual aid; the drop hit-test is done by the
      // parent via pointer position vs zone rects (see App.tsx).
      style={{
        position: 'fixed', inset: 0,
        pointerEvents: 'none',
        zIndex: 9100,
      }}
    >
      {/* Connection lines (SVG layer, also pointer-events none) */}
      <svg
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none',
          width: '100vw', height: '100vh',
        }}
      >
        {DIRECTIONS.map(d => {
          const p = zonePos(d);
          const zcx = p.left + ZONE_SIZE / 2;
          const zcy = p.top  + ZONE_SIZE / 2;
          const t = animProgress(d);
          const isHot = hotDir === d;
          return (
            <line
              key={d}
              x1={cx} y1={cy} x2={zcx} y2={zcy}
              stroke={accentColor}
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={t * (isHot ? 0.55 : (hotDir ? 0.12 : 0.28))}
            />
          );
        })}
      </svg>

      {DIRECTIONS.map(d => {
        const t = animProgress(d);
        const p = zonePos(d);
        const filled = filledSlots[d];
        const isHot  = hotDir === d;
        const isCold = hotDir != null && !isHot;

        // Easing — the spring curve only sensibly applies to scale; we
        // hand-blend it as 1 - (1-t)^3 with a slight overshoot at the end.
        const eased = 1 - Math.pow(1 - t, 3);
        const scale = isHot
          ? 1.08
          : isCold
            ? 0.94 * eased + 0.7 * (1 - eased)
            : 0.7 + (1.0 - 0.7) * eased;
        const opacity = isCold
          ? Math.max(0.4 * eased, 0)
          : 0.85 * eased;

        const style: CSSProperties = {
          position: 'fixed',
          left: p.left,
          top: p.top,
          width: ZONE_SIZE,
          height: ZONE_SIZE,
          borderRadius: 12,
          // Spring-easing on scale + linear on opacity for a snappy reveal.
          transform: `scale(${scale})`,
          opacity,
          background: `color-mix(in srgb, var(--surface) 70%, ${accentColor} ${isHot ? '20%' : '8%'})`,
          border: `${isHot ? 1.5 : 1}px dashed ${isHot ? accentColor : 'var(--accent-dim, var(--accent))'}`,
          backdropFilter: 'blur(8px) saturate(140%)',
          boxShadow: isHot
            ? `0 0 24px -4px ${accentColor}, 0 4px 14px rgba(0,0,0,0.18)`
            : '0 2px 6px rgba(0,0,0,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isHot ? accentColor : 'var(--text-muted)',
          transition: 'transform 100ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 100ms ease, box-shadow 100ms ease, background 100ms ease, border-color 100ms ease, color 100ms ease',
          willChange: 'transform, opacity',
        };

        return (
          <div key={d} style={style}>
            {filled ? (
              <SlotMiniIcon item={filled} />
            ) : (
              <Icon
                name={DIR_ICON[d]}
                size={isHot ? 22 : 18}
                style={{ transition: 'all 100ms ease' }}
              />
            )}
            {/* "REPLACE" hint when slot is filled and hot */}
            {filled && isHot && (
              <span style={{
                position: 'absolute', bottom: -16,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                color: accentColor,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                교체
              </span>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Tiny preview of an item already living in a slot. We render a square
 * in the item's color with the first character of its title — full
 * fidelity isn't useful here (16 px square), but the color match
 * helps the user recall what they'd be replacing.
 */
function SlotMiniIcon({ item }: { item: LauncherItem }) {
  const initial = (item.title?.[0] ?? '?').toUpperCase();
  const color   = item.color ?? '#6366f1';
  if (item.iconType === 'image' && item.icon) {
    return (
      <img
        src={item.icon}
        alt=""
        style={{
          width: 32, height: 32, borderRadius: 7, objectFit: 'cover',
          border: `1px solid ${color}55`,
        }}
      />
    );
  }
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 7,
      background: `linear-gradient(135deg, ${color}cc, ${color}88)`,
      color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 700,
      letterSpacing: '-0.02em',
    }}>
      {initial}
    </div>
  );
}

/**
 * Helper for App.tsx: given the container's rect and a pointer
 * position, return which (if any) slot zone the pointer is inside.
 *
 * Defined here so the geometry (ZONE_SIZE, ZONE_GAP) stays in one
 * file — App.tsx only knows the container's rect and the pointer's
 * position, not how big our zones are.
 */
export function hitTestBloomZone(
  containerRect: DOMRect,
  pointer: { x: number; y: number },
): Dir | null {
  const cx = containerRect.left + containerRect.width  / 2;
  const cy = containerRect.top  + containerRect.height / 2;
  const zoneCenter = (dir: Dir) => {
    switch (dir) {
      case 'up':    return { x: cx, y: containerRect.top    - ZONE_GAP - ZONE_SIZE / 2 };
      case 'down':  return { x: cx, y: containerRect.bottom + ZONE_GAP + ZONE_SIZE / 2 };
      case 'left':  return { x: containerRect.left  - ZONE_GAP - ZONE_SIZE / 2, y: cy };
      case 'right': return { x: containerRect.right + ZONE_GAP + ZONE_SIZE / 2, y: cy };
    }
  };
  for (const d of DIRECTIONS) {
    const c = zoneCenter(d);
    if (
      Math.abs(pointer.x - c.x) <= ZONE_SIZE / 2 &&
      Math.abs(pointer.y - c.y) <= ZONE_SIZE / 2
    ) return d;
  }
  return null;
}
