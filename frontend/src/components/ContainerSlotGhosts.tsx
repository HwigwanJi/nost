import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * ContainerSlotGhosts — light dotted rectangles fanned around a
 * container card to show "this slot is empty, drop or click here".
 *
 * Companion to ContainerBloom (the drag-active overlay) — same
 * geometry, same visual vocabulary, but rendered passively on hover
 * so the user can see slots exist even before they pick up a card.
 *
 * Click on a ghost → caller decides what to do (currently routes to
 * the existing slot-editor modal). The ghost itself doesn't carry
 * any logic about replacing or adding; it's just a clickable hint.
 *
 * Why portal-based: the parent ItemCard lives inside a scrolling
 * grid; positioning ghosts via the card's absolute children would
 * get clipped by overflow on the grid or accordion. Portaling to
 * document.body anchors them in viewport coordinates instead, which
 * is what the dnd-kit drag pipeline already does.
 *
 * The component re-reads its anchor's rect on every animation frame
 * for the first 200 ms after mount so layout shifts (accordion open,
 * search filter, scroll) don't leave the ghosts stuck. After settle
 * we observe the card via ResizeObserver.
 */

export type Dir = 'up' | 'down' | 'left' | 'right';

interface Props {
  /** Element to anchor the ghosts around — typically the container card. */
  anchor: HTMLElement;
  /** Which directions are empty and should render a ghost. */
  emptyDirs: Dir[];
  /** Click handler — caller can route to the slot picker. */
  onClickGhost: (dir: Dir) => void;
  /** Optional accent color override. */
  accent?: string;
}

const ZONE_SIZE = 64;
const ZONE_GAP  = 14;

const DIR_ICON: Record<Dir, string> = {
  up:    'arrow_upward',
  right: 'arrow_forward',
  down:  'arrow_downward',
  left:  'arrow_back',
};

export function ContainerSlotGhosts({ anchor, emptyDirs, onClickGhost, accent }: Props) {
  const [rect, setRect] = useState<DOMRect>(() => anchor.getBoundingClientRect());
  const settledRef = useRef(false);

  // Brief catch-up loop while layout is still in motion (fade-in,
  // accordion expand, etc.). 200 ms is enough for the typical card
  // entry animation to land. After that, ResizeObserver does the rest.
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const tick = () => {
      setRect(anchor.getBoundingClientRect());
      if (performance.now() - start < 200) {
        raf = requestAnimationFrame(tick);
      } else {
        settledRef.current = true;
      }
    };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => setRect(anchor.getBoundingClientRect()));
    ro.observe(anchor);
    const onScroll = () => setRect(anchor.getBoundingClientRect());
    window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor]);

  const accentColor = accent ?? 'var(--accent)';

  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;

  const zonePos = (dir: Dir) => {
    let zx = cx, zy = cy;
    switch (dir) {
      case 'up':    zy = rect.top    - ZONE_GAP - ZONE_SIZE; break;
      case 'down':  zy = rect.bottom + ZONE_GAP;             break;
      case 'left':  zx = rect.left   - ZONE_GAP - ZONE_SIZE; break;
      case 'right': zx = rect.right  + ZONE_GAP;             break;
    }
    if (dir === 'up' || dir === 'down') zx = cx - ZONE_SIZE / 2;
    if (dir === 'left' || dir === 'right') zy = cy - ZONE_SIZE / 2;
    return { left: zx, top: zy };
  };

  return createPortal(
    <div
      // Important: this layer DOES accept pointer events (we want
      // clicks on ghosts), but the wrapper itself is sized to viewport
      // so a click on empty space falls through. Each ghost handles
      // its own pointer events.
      style={{
        position: 'fixed', inset: 0,
        pointerEvents: 'none',
        zIndex: 9050,  // below ContainerBloom (9100), above app surface
      }}
    >
      {emptyDirs.map(d => {
        const p = zonePos(d);
        const style: CSSProperties = {
          position: 'fixed',
          left: p.left,
          top: p.top,
          width: ZONE_SIZE,
          height: ZONE_SIZE,
          borderRadius: 12,
          border: `1px dashed ${accentColor}55`,
          background: `color-mix(in srgb, var(--surface) 80%, ${accentColor} 4%)`,
          backdropFilter: 'blur(4px)',
          color: `${accentColor}aa`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          opacity: 0.65,
          transition: 'opacity 120ms ease, border-color 120ms ease, background 120ms ease, transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          pointerEvents: 'auto',
          // Mount-in animation — match the bloom's spring feel but quieter.
          animation: 'nost-slot-ghost-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        };
        return (
          <button
            key={d}
            type="button"
            style={style}
            onClick={(e) => {
              e.stopPropagation();
              onClickGhost(d);
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.opacity = '1';
              el.style.borderColor = accentColor;
              el.style.transform = 'scale(1.06)';
              el.style.background = `color-mix(in srgb, var(--surface) 70%, ${accentColor} 12%)`;
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.opacity = '0.65';
              el.style.borderColor = `${accentColor}55`;
              el.style.transform = 'scale(1)';
              el.style.background = `color-mix(in srgb, var(--surface) 80%, ${accentColor} 4%)`;
            }}
            title={`${d === 'up' ? '위' : d === 'down' ? '아래' : d === 'left' ? '왼쪽' : '오른쪽'} 슬롯 추가`}
          >
            <Icon name={DIR_ICON[d]} size={18} />
            <Icon name="add" size={14} style={{ position: 'absolute', bottom: 4, right: 4, opacity: 0.7 }} />
          </button>
        );
      })}
      <style>{`
        @keyframes nost-slot-ghost-in {
          from { opacity: 0; transform: scale(0.7); }
          to   { opacity: 0.65; transform: scale(1); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
