import { memo, useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { LauncherItem, Space } from '../types';
import { Icon } from '@/components/ui/Icon';
import { useHorizontalSwipe } from '../hooks/useHorizontalSwipe';
import { complementary, analogous } from '../lib/colorTheory';
import { useAppActions } from '../contexts/AppContext';
import { electronAPI } from '../electronBridge';
import { WIDGET, HOVER_HINT } from './widgetTokens';

/**
 * ColorSwatchWidget v4 — inside-card silhouette + color blend on swipe.
 *
 * Same family chrome as MemoCard / MediaWidget. Shape rule (see
 * widgetTokens.ts):
 *   - Inside card: 38 px tall, sits with horizontal margin so the
 *     bottom row visually extends past it → forms the T silhouette.
 *   - Bottom T-split: edge-to-edge, two wide cells (피커 / 편집)
 *     with a 1 px vertical divider in the middle.
 *
 * Interaction (modeled on the music-widget elastic pill):
 *   - Tap                 → copy hex
 *   - Swipe LEFT  ≥ 56 px → copy COMPLEMENTARY (hue + 180°)
 *   - Swipe RIGHT ≥ 56 px → copy ANALOGOUS    (hue + 30°)
 *   - During the drag, the inside card's BACKGROUND COLOR blends
 *     toward the harmony hue via `color-mix`. The user previews
 *     exactly the colour they'll commit before they release.
 *     Released: card's colour springs back to the assigned hex.
 *   - The slide is small (≤ 10 px, rubber-band) — no clipping
 *     past the wrapper edge. NO reveal panels behind the card.
 *
 * Title display (user mandate):
 *   - Default: name (e.g. "프라이머리"), centred, ellipsis if long.
 *     If no name, hex is shown instead.
 *   - On hover: name swaps to the hex code so the user can see the
 *     value without clicking. Same iA-Writer principle the design
 *     system already established: defer values to hover when the
 *     visual identity (the colour itself) is enough.
 */

interface Props {
  item: LauncherItem;
  space?: Space;
  dragHandle?: {
    setNodeRef: (el: HTMLElement | null) => void;
    style: CSSProperties;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attributes: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listeners: any;
    isDragging: boolean;
  };
  onContextMenu?: (e: React.MouseEvent) => void;
  onEdit?: () => void;
}

const SWIPE_THRESHOLD = 56;
const SLIDE_MAX = 10;

function ColorSwatchWidgetImpl({ item, dragHandle, onContextMenu, onEdit }: Props) {
  const { showToast } = useAppActions();

  // ── Right-click drag (matches MediaWidget / MemoCard) ─────────
  const suppressContextMenuRef = useRef(false);
  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    if (!dragHandle?.listeners?.onPointerDown) return;
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    let dragged = false;
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) dragged = true;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (dragged) {
        suppressContextMenuRef.current = true;
        setTimeout(() => { suppressContextMenuRef.current = false; }, 120);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    (dragHandle.listeners.onPointerDown as (e: ReactPointerEvent) => void)(e);
  }, [dragHandle]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (suppressContextMenuRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onContextMenu?.(e);
  }, [onContextMenu]);

  // ── Swatch data ───────────────────────────────────────────────
  const opts = item.widget?.kind === 'color-swatch' ? item.widget.options : null;
  const hex = (opts?.hex || '#888888').toUpperCase();
  const labelCandidate = opts?.name || item.title;
  const hasName = !!labelCandidate && labelCandidate.toUpperCase() !== hex;
  const name = hasName ? labelCandidate : '';

  const [hovered, setHovered] = useState(false);

  // ── Copy / harmony actions ────────────────────────────────────
  const [flash, setFlash] = useState<null | 'hex' | 'comp' | 'ana' | 'fail'>(null);
  const flashFor = useCallback((kind: NonNullable<typeof flash>) => {
    setFlash(kind);
    window.setTimeout(() => setFlash(null), 850);
  }, []);

  const writeClipboard = useCallback(async (text: string): Promise<boolean> => {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }, []);

  const copyHex = useCallback(async () => {
    const ok = await writeClipboard(hex);
    flashFor(ok ? 'hex' : 'fail');
    showToast(ok ? `${hex} 복사됨` : '복사 실패');
  }, [hex, writeClipboard, flashFor, showToast]);

  const copyComplementary = useCallback(async () => {
    const c = complementary(hex);
    const ok = await writeClipboard(c);
    flashFor(ok ? 'comp' : 'fail');
    showToast(ok ? `보색 ${c} 복사됨` : '복사 실패');
  }, [hex, writeClipboard, flashFor, showToast]);

  const copyAnalogous = useCallback(async () => {
    const a = analogous(hex);
    const ok = await writeClipboard(a);
    flashFor(ok ? 'ana' : 'fail');
    showToast(ok ? `유사색 ${a} 복사됨` : '복사 실패');
  }, [hex, writeClipboard, flashFor, showToast]);

  const { handlers: swipeHandlers, dragX, progress } = useHorizontalSwipe({
    threshold: SWIPE_THRESHOLD,
    onTap: copyHex,
    onSwipeLeft: copyComplementary,
    onSwipeRight: copyAnalogous,
  });

  // Slide is small + rubber-banded. Stays within insideMarginX so
  // there's never any clipping at the wrapper edge.
  const visualDx = (() => {
    const raw = dragX;
    if (Math.abs(raw) <= SLIDE_MAX) return raw;
    const overshoot = Math.abs(raw) - SLIDE_MAX;
    return Math.sign(raw) * (SLIDE_MAX + overshoot * 0.06);
  })();

  // Background blend — the user pulls and the inside card's colour
  // smoothly transitions to the harmony hue. Provides a true preview
  // of what they'll copy before they commit. CSS color-mix is
  // supported in Chromium 111+ (Electron 41 = Chromium 134, fine).
  const swipeStrength = Math.min(1, Math.abs(progress));
  const harmonyHex = progress < 0
    ? complementary(hex)
    : progress > 0
      ? analogous(hex)
      : hex;
  const renderedColor = swipeStrength > 0.05
    ? `color-mix(in srgb, ${hex} ${(1 - swipeStrength) * 100}%, ${harmonyHex})`
    : hex;

  // ── Eyedropper (delegated to main process — full desktop) ────
  const handleEyedropper = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const result = await electronAPI.pickColorFromScreen();
      if (result.success && result.hex) {
        const picked = result.hex.toUpperCase();
        const ok = await writeClipboard(picked);
        showToast(ok ? `${picked} 복사됨 (피커)` : '복사 실패');
        return;
      }
      if (result.reason === 'canceled') return;
      if (result.reason === 'busy') return;
      if (result.reason === 'dev-mode') {
        showToast('개발 모드에서는 색상 피커를 쓸 수 없어요');
        return;
      }
      showToast(`색상 피커 실패 (${result.reason || 'unknown'})`);
    } catch {
      showToast('색상 피커 실패');
    }
  }, [writeClipboard, showToast]);

  const handleEditOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.();
  }, [onEdit]);

  // ── Render ────────────────────────────────────────────────────
  const handleProps = dragHandle ? {
    ref: dragHandle.setNodeRef,
    style: { ...dragHandle.style, opacity: dragHandle.isDragging ? 0.4 : 1 },
    ...dragHandle.attributes,
  } : { style: {} };

  // Choose readable text colour against the (possibly transitioning)
  // background. We use the underlying hex's luminance — the harmony
  // hex would also be similar enough in most cases, and recomputing
  // every drag frame for the title contrast isn't worth the cycles.
  const isLight = luminance(hex) > 0.7;
  const onSwatchTextColor = isLight ? 'rgba(0,0,0,0.85)' : '#fff';

  // Title display content: hover swaps the visible label between
  // the user-given name (default) and the hex code (on hover).
  // When there's no name, we always show hex (no swap target).
  const titleContent = !hasName
    ? hex
    : (hovered ? hex : name);

  return (
    <>
      <style>{`
        @keyframes nost-cs-pop {
          0%   { transform: scale(0.7); opacity: 0; }
          60%  { transform: scale(1.04); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <div
        {...handleProps}
        data-card
        data-card-id={item.id}
        style={{
          ...(handleProps.style as CSSProperties),
          height: WIDGET.cardHeight,
          padding: 0,
          background: 'var(--surface)',
          border: '1px solid var(--border-rgba)',
          borderRadius: WIDGET.cardRadius,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
          transition: 'border-color 150ms ease',
        }}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-focus)';
          setHovered(true);
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-rgba)';
          setHovered(false);
        }}
        title={[
          hasName ? `${name} · ${hex}` : hex,
          HOVER_HINT({
            '짧게': 'Hex 복사',
            '왼쪽으로': '보색 복사',
            '오른쪽으로': '유사색 복사',
          }),
        ].join('\n')}
      >
        {/* ── Top wrapper — inside card with side margins ─────── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: `${WIDGET.insideMarginTop}px ${WIDGET.insideMarginX}px ${WIDGET.insideMarginBottom}px ${WIDGET.insideMarginX}px`,
            minHeight: 0,
          }}
        >
          {/* Inside card — colour itself; blends during swipe */}
          <div
            {...swipeHandlers}
            style={{
              width: '100%',
              height: WIDGET.insideHeight,
              borderRadius: WIDGET.primaryRadius,
              background: renderedColor,
              boxShadow: isLight
                ? 'inset 0 0 0 1px rgba(0,0,0,0.08)'
                : 'inset 0 1px 0 rgba(255,255,255,0.06)',
              transform: `translateX(${visualDx}px)`,
              transition: dragX === 0
                ? 'transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1), background 0.2s'
                : 'background 0.06s',
              cursor: 'pointer',
              touchAction: 'pan-y',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 12px',
              boxSizing: 'border-box',
              overflow: 'hidden',
              position: 'relative',
              color: onSwatchTextColor,
            }}
          >
            {/* Title — centre-aligned, ellipsis, hover-swap to hex.
                We render BOTH labels stacked and toggle visibility
                via opacity so the swap is a smooth fade rather than
                a layout shift (otherwise width changes would make
                the text wobble during the swap). */}
            <span
              style={{
                fontSize: hasName ? 12 : 11,
                fontWeight: 700,
                fontFamily: hasName && !hovered
                  ? 'inherit'
                  : 'ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace',
                letterSpacing: hasName && !hovered ? '-0.01em' : '0.02em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
                textAlign: 'center',
                textShadow: isLight ? 'none' : '0 1px 2px rgba(0,0,0,0.18)',
                transition: 'font-family 0.15s, letter-spacing 0.15s, font-size 0.15s',
              }}
            >
              {titleContent}
            </span>

            {/* Tap-feedback overlay — fills the swatch with a copy
                confirmation. Same vocabulary as MemoCard's flash. */}
            {flash && (
              <div style={{
                position: 'absolute', inset: 0,
                background: flash === 'fail' ? 'rgba(220,38,38,0.78)' : 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff',
                fontSize: 11, fontWeight: 700, letterSpacing: '-0.01em',
                animation: 'nost-cs-pop 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
                borderRadius: WIDGET.primaryRadius,
              }}>
                {flash === 'hex'  ? '복사됨'
                : flash === 'comp' ? '보색 복사됨'
                : flash === 'ana'  ? '유사색 복사됨'
                : '복사 실패'}
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom T-split — edge-to-edge, 2 cells ──────────── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            height: WIDGET.bottomRowHeight,
            borderTop: '1px solid var(--border-rgba)',
            background: 'var(--surface)',
            flexShrink: 0,
          }}
        >
          <BottomCell
            onClick={handleEyedropper}
            title="피커 · 화면에서 색 고르기"
            divider="right"
          >
            <Icon name="colorize" size={13} />
          </BottomCell>
          <BottomCell
            onClick={handleEditOpen}
            title="편집 · 이름과 hex 수정"
            disabled={!onEdit}
          >
            <Icon name="edit" size={13} />
          </BottomCell>
        </div>
      </div>
    </>
  );
}

export const ColorSwatchWidget = memo(ColorSwatchWidgetImpl, (prev, next) =>
  prev.item === next.item &&
  prev.space === next.space &&
  prev.onEdit === next.onEdit &&
  prev.dragHandle?.isDragging === next.dragHandle?.isDragging
);

/* ── Bottom T-split cell ──────────────────────────────────────── */
function BottomCell({
  children, onClick, title, disabled, divider,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
  divider?: 'right';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        background: 'transparent',
        border: 'none',
        borderRight: divider === 'right' ? '1px solid var(--border-rgba)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-dim)' : 'var(--text-muted)',
        fontFamily: 'inherit',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.color = 'var(--text-color)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
    >
      {children}
    </button>
  );
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8)  & 0xff) / 255;
  const b = ( n        & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Public utility — kept stable across the rewrite. */
export function normaliseHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) {
    return '#' + s.split('').map(c => c + c).join('').toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(s)) {
    return '#' + s.toUpperCase();
  }
  return null;
}
