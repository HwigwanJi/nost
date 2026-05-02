import { memo, useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { LauncherItem, Space } from '../types';
import { Icon } from '@/components/ui/Icon';
import { useHorizontalSwipe } from '../hooks/useHorizontalSwipe';
import { complementary, analogous } from '../lib/colorTheory';
import { useAppActions } from '../contexts/AppContext';
import { WIDGET, WIDGET_TIP } from './widgetTokens';

/**
 * ColorSwatchWidget v3 — family-look pass.
 *
 * Same shared chrome (height / padding / radius / secondary-row
 * spec) as MemoCard + MediaWidget — see widgetTokens.ts. Two
 * design-system rules surfaced from the user feedback land here
 * for the first time:
 *
 *   1. Secondary buttons are icon-only; the label appears in the
 *      tooltip on hover. The previous "[💧 피커] [✏️ 편집]" with
 *      Korean text crowded the row at the standard card width and
 *      forced the colour block to share space with text labels.
 *      Now: two clean icon squares, labels on hover.
 *
 *   2. The hex code is hover-revealed. The colour block IS the
 *      colour — the precise hex value is *additional* information
 *      that doesn't need to live in the surface by default.
 *      Less chrome, larger colour expressiveness, label discovered
 *      via hover (mirrors how iA Writer / minimalist UIs handle
 *      "everything that's not the content itself").
 *
 * Interaction grammar (kept):
 *   - Tap                 → copy hex
 *   - Swipe left ≥ 56 px  → copy COMPLEMENTARY (hue + 180°)
 *   - Swipe right ≥ 56 px → copy ANALOGOUS    (hue + 30°)
 *   - 💧 (icon)            → screen colour picker (EyeDropper API)
 *   - ✏️ (icon)            → open edit dialog
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

function ColorSwatchWidgetImpl({ item, dragHandle, onContextMenu, onEdit }: Props) {
  const { showToast } = useAppActions();

  // ── Right-click drag (matches ItemCard / MediaWidget) ─────────
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

  // ── Hover state — drives the hex-on-hover overlay ─────────────
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

  const leftActionOpacity = progress < 0 ? Math.min(1, -progress) : 0;
  const rightActionOpacity = progress > 0 ? Math.min(1, progress) : 0;
  const visualDx = Math.abs(dragX) > SWIPE_THRESHOLD
    ? Math.sign(dragX) * (SWIPE_THRESHOLD + (Math.abs(dragX) - SWIPE_THRESHOLD) * 0.3)
    : dragX;

  // ── Eyedropper (screen colour picker, EyeDropper API) ─────────
  const handleEyedropper = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).EyeDropper as undefined | (new () => { open: () => Promise<{ sRGBHex: string }> });
    if (!Ctor) {
      showToast('이 환경에서는 색상 피커를 쓸 수 없어요');
      return;
    }
    try {
      const dropper = new Ctor();
      const result = await dropper.open();
      const picked = (result.sRGBHex || '').toUpperCase();
      if (!picked) return;
      const ok = await writeClipboard(picked);
      showToast(ok ? `${picked} 복사됨 (피커)` : '복사 실패');
    } catch {
      // Picker dismissed (Esc) — silent.
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

  const isLight = luminance(hex) > 0.7;
  const onSwatchTextColor = isLight ? 'rgba(0,0,0,0.85)' : '#fff';

  return (
    <>
      <style>{`
        @keyframes nost-cs-pop {
          0%   { transform: scale(0.7); opacity: 0; }
          60%  { transform: scale(1.04); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes nost-cs-overlay-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      <div
        {...handleProps}
        data-card
        data-card-id={item.id}
        style={{
          ...(handleProps.style as CSSProperties),
          height: WIDGET.cardHeight,
          padding: WIDGET.cardPadding,
          background: 'var(--surface)',
          border: '1px solid var(--border-rgba)',
          borderRadius: WIDGET.cardRadius,
          display: 'flex',
          flexDirection: 'column',
          gap: WIDGET.cardGap,
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
        title={name ? `${hex} · ${name}` : hex}
      >
        {/* ── Primary swipe surface — pure colour, hex on hover ── */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            borderRadius: WIDGET.primaryRadius,
            overflow: 'hidden',
          }}
        >
          {/* Reveal panels behind the colour during swipe — show
              the actual harmony hue so the user previews what
              they'd be copying. */}
          <SwipeActionPanel
            side="left"
            icon="invert_colors"
            label="보색"
            opacity={leftActionOpacity}
            tintBg={complementary(hex)}
          />
          <SwipeActionPanel
            side="right"
            icon="palette"
            label="유사색"
            opacity={rightActionOpacity}
            tintBg={analogous(hex)}
          />

          {/* Foreground colour block — the actual swatch + tap target */}
          <div
            {...swipeHandlers}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: WIDGET.primaryRadius,
              background: hex,
              boxShadow: isLight ? 'inset 0 0 0 1px rgba(0,0,0,0.08)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
              transform: `translateX(${visualDx}px)`,
              transition: dragX === 0 ? 'transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1)' : undefined,
              cursor: 'pointer',
              touchAction: 'pan-y',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'flex-start',
              padding: '6px 10px',
              color: onSwatchTextColor,
              overflow: 'hidden',
            }}
          >
            {/* Hex / name overlay — renders only when hovered.
                Replaces the previous always-visible label. The
                colour itself is the identity; the textual code is
                supplementary detail. */}
            {hovered && !flash && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  animation: 'nost-cs-overlay-in 140ms ease-out',
                  // Subtle scrim ONLY on the bottom strip where the
                  // text sits, so light colours stay readable
                  // without graying out the whole swatch.
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: isLight ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.28)',
                  backdropFilter: 'blur(2px)',
                  WebkitBackdropFilter: 'blur(2px)',
                }}
              >
                {hasName && (
                  <span style={{
                    fontSize: 11,
                    lineHeight: '13px',
                    fontWeight: 700,
                    letterSpacing: '-0.01em',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 120,
                  }}>
                    {name}
                  </span>
                )}
                <span style={{
                  fontSize: 9,
                  lineHeight: '11px',
                  fontWeight: 600,
                  fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace',
                  letterSpacing: '0.02em',
                  opacity: 0.92,
                }}>
                  {hex}
                </span>
              </div>
            )}

            {/* Tap-feedback overlay — fills the swatch with a contrast
                pill announcing what landed on the clipboard. */}
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

        {/* ── Secondary action row — icon-only, hover tooltips ──
            Family rule (see widgetTokens.ts): label moves to the
            tooltip; icon alone in the visible chrome. Centred so
            the row reads as a small "control cluster" sitting under
            the primary surface, mirroring MediaWidget's volume row. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: WIDGET.secondaryGap,
            height: WIDGET.secondaryHeight,
            flexShrink: 0,
          }}
        >
          <SecondaryBtn
            onClick={handleEyedropper}
            title={WIDGET_TIP('피커 — 화면에서 색 고르기')}
          >
            <Icon name="colorize" size={11} />
          </SecondaryBtn>
          <SecondaryBtn
            onClick={handleEditOpen}
            title={WIDGET_TIP('편집 — 이름·hex 수정')}
            disabled={!onEdit}
          >
            <Icon name="edit" size={11} />
          </SecondaryBtn>
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

/* ── Swipe-reveal panel — shows the harmony colour as a preview ── */
function SwipeActionPanel({
  side, icon, label, opacity, tintBg,
}: {
  side: 'left' | 'right';
  icon: string;
  label: string;
  opacity: number;
  tintBg: string;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0, bottom: 0,
        [side]: 0,
        width: '50%',
        background: `linear-gradient(${side === 'left' ? 'to right' : 'to left'}, ${tintBg} 60%, transparent)`,
        opacity,
        display: 'flex',
        alignItems: 'center',
        justifyContent: side === 'left' ? 'flex-start' : 'flex-end',
        gap: 4,
        padding: '0 12px',
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        textShadow: '0 1px 2px rgba(0,0,0,0.4)',
      }}
    >
      {side === 'right' && <Icon name={icon} size={12} />}
      <span>{label}</span>
      {side === 'left' && <Icon name={icon} size={12} />}
    </div>
  );
}

/* ── Secondary button — family-look (see widgetTokens.ts) ────── */
function SecondaryBtn({
  children, onClick, title, disabled,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        width: WIDGET.secondaryBtnSize,
        height: WIDGET.secondaryBtnSize,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        background: 'transparent',
        border: '1px solid var(--border-rgba)',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-dim)' : 'var(--text-muted)',
        fontFamily: 'inherit',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
      }}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.borderColor = 'var(--border-focus)';
        e.currentTarget.style.color = 'var(--text-color)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'var(--border-rgba)';
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

/* ── Public utility (kept stable) ────────────────────────────── */
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
