import { memo, useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { LauncherItem, Space } from '../types';
import { Icon } from '@/components/ui/Icon';
import { useHorizontalSwipe } from '../hooks/useHorizontalSwipe';
import { complementary, analogous } from '../lib/colorTheory';
import { useAppActions } from '../contexts/AppContext';

/**
 * ColorSwatchWidget v2 — swipe-box redesign.
 *
 * Modelled on the music widget's "obvious controls" pattern. Was a
 * Pantone-style colour-block + label. Now: a single swipe surface
 * filling the upper area + a 2-button action row underneath, so
 * gestures and explicit actions are both first-class.
 *
 * Interaction grammar (mirrors MemoCard for muscle-memory parity):
 *   - Tap swipe box       → copy hex to clipboard
 *   - Swipe left ≥56 px   → copy complementary (hue + 180°)
 *   - Swipe right ≥56 px  → copy analogous (hue + 30°)
 *   - 💧 bottom-left      → screen colour picker (EyeDropper API)
 *   - ✏️ bottom-right     → open card edit dialog (rename / change hex)
 *
 * The card height stays at the global 82 px invariant (every card type
 * is exactly this tall — see MemoCard's notes for the rationale).
 *
 * Click + swipe disambiguation lives in useHorizontalSwipe so we never
 * fire both on a single gesture.
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
  /** Open the edit dialog for this swatch — wired through ItemCard. */
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

  // ── Marquee for long names (fallback to ellipsis when short) ──
  const labelOuterRef = useRef<HTMLDivElement | null>(null);
  const labelInnerRef = useRef<HTMLSpanElement | null>(null);
  const [marqueeShift, setMarqueeShift] = useState(0);
  const [hovered, setHovered] = useState(false);
  useLayoutEffect(() => {
    const outer = labelOuterRef.current;
    const inner = labelInnerRef.current;
    if (!outer || !inner) { setMarqueeShift(0); return; }
    const overflow = inner.scrollWidth - outer.clientWidth;
    setMarqueeShift(overflow > 4 ? overflow + 8 : 0);
  });

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

  // ── Eyedropper (screen colour picker) ─────────────────────────
  // Uses the experimental EyeDropper API — Chromium 95+. Electron 41
  // ships Chromium 134, so it's available. Falls back to a friendly
  // toast if the user's browser engine has it disabled (some
  // enterprise builds gate experimental APIs). The API itself
  // handles the screen capture + magnifier + colour readout, so
  // there's no main-process work needed.
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
      // User pressed Esc / closed the picker — silent, no error toast.
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
  const onSwatchTextColor = isLight ? 'rgba(0,0,0,0.78)' : '#fff';

  return (
    <>
      <style>{`
        @keyframes nost-cs-pop {
          0%   { transform: scale(0.7); opacity: 0; }
          60%  { transform: scale(1.04); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes nost-cs-marquee {
          0%   { transform: translateX(0); }
          15%  { transform: translateX(0); }
          85%  { transform: translateX(var(--cs-marquee-shift, 0px)); }
          100% { transform: translateX(var(--cs-marquee-shift, 0px)); }
        }
      `}</style>

      <div
        {...handleProps}
        data-card
        data-card-id={item.id}
        style={{
          ...(handleProps.style as CSSProperties),
          height: 82,
          background: 'var(--surface)',
          border: '1px solid var(--border-rgba)',
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
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
        {/* ── Swipe surface (the colour itself + label) ───────── */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            margin: '6px 6px 0 6px',
            borderRadius: 8,
            background: 'var(--surface-hover)',
            overflow: 'hidden',
          }}
        >
          {/* Action labels — revealed behind the moving swatch */}
          <SwipeActionLabel
            side="left"
            icon="invert_colors"
            label="보색"
            opacity={leftActionOpacity}
            color="#fff"
            tintBg={complementary(hex)}
          />
          <SwipeActionLabel
            side="right"
            icon="palette"
            label="유사색"
            opacity={rightActionOpacity}
            color="#fff"
            tintBg={analogous(hex)}
          />

          {/* The actual colour block — slides on swipe, copies on tap */}
          <div
            {...swipeHandlers}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 8,
              background: hex,
              boxShadow: isLight ? 'inset 0 0 0 1px rgba(0,0,0,0.08)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
              transform: `translateX(${visualDx}px)`,
              transition: dragX === 0 ? 'transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1)' : undefined,
              cursor: 'pointer',
              touchAction: 'pan-y',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '4px 8px',
              color: onSwatchTextColor,
            }}
          >
            {/* In-swatch label — name (bold) + hex (mono).
                Uses absolute-positioned marquee just like MemoCard
                so a long swatch name doesn't push other layout. */}
            {hasName ? (
              <>
                <div
                  ref={labelOuterRef}
                  style={{
                    position: 'relative',
                    fontSize: 11,
                    lineHeight: '13px',
                    fontWeight: 700,
                    letterSpacing: '-0.01em',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    color: onSwatchTextColor,
                  }}
                >
                  <span
                    ref={labelInnerRef}
                    style={{
                      display: 'inline-block',
                      whiteSpace: 'nowrap',
                      ...((hovered && marqueeShift > 0)
                        ? {
                            animation: 'nost-cs-marquee 6s ease-in-out infinite',
                            ['--cs-marquee-shift' as string]: `-${marqueeShift}px`,
                          }
                        : {
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                            overflow: 'hidden',
                          }),
                    }}
                  >
                    {name}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 9,
                    lineHeight: '11px',
                    fontWeight: 500,
                    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace',
                    letterSpacing: '0.02em',
                    opacity: 0.78,
                    color: onSwatchTextColor,
                  }}
                >
                  {hex}
                </div>
              </>
            ) : (
              <div
                style={{
                  fontSize: 11,
                  lineHeight: '13px',
                  fontWeight: 700,
                  fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace',
                  letterSpacing: '0.01em',
                  color: onSwatchTextColor,
                }}
              >
                {hex}
              </div>
            )}

            {/* Tap-feedback overlay. Different copy per action so the
                user knows which value just landed on the clipboard. */}
            {flash && (
              <div style={{
                position: 'absolute', inset: 0,
                background: flash === 'fail' ? 'rgba(220,38,38,0.78)' : 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff',
                fontSize: 11, fontWeight: 700, letterSpacing: '-0.01em',
                animation: 'nost-cs-pop 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
                borderRadius: 8,
              }}>
                {flash === 'hex'  ? '복사됨'
                : flash === 'comp' ? '보색 복사됨'
                : flash === 'ana'  ? '유사색 복사됨'
                : '복사 실패'}
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom action row (2 cells) ──────────────────────── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 0,
            margin: '4px 6px 6px 6px',
            borderRadius: 6,
            border: '1px solid var(--border-rgba)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <CsActionBtn
            onClick={handleEyedropper}
            title="화면에서 색 고르기 (피커)"
            divider="right"
          >
            <Icon name="colorize" size={11} />
            <span>피커</span>
          </CsActionBtn>
          <CsActionBtn
            onClick={handleEditOpen}
            title="이름·hex 편집"
            disabled={!onEdit}
          >
            <Icon name="edit" size={11} />
            <span>편집</span>
          </CsActionBtn>
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

/* ── Helpers ──────────────────────────────────────────────────── */

function SwipeActionLabel({
  side, icon, label, opacity, color, tintBg,
}: {
  side: 'left' | 'right';
  icon: string;
  label: string;
  opacity: number;
  color: string;
  /** The actual harmony colour we'll copy — used as the reveal background
   *  so the user can preview WHAT they'll get before committing. */
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
        color,
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

function CsActionBtn({
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
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '4px 6px',
        background: 'transparent',
        border: 'none',
        borderRight: divider === 'right' ? '1px solid var(--border-rgba)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-dim)' : 'var(--text-muted)',
        fontSize: 10,
        fontWeight: 600,
        fontFamily: 'inherit',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-color)'; } }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
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

/* ── Public utilities (kept stable across the rewrite) ──────────── */

/**
 * Normalise a user-input hex string to canonical `#RRGGBB`.
 * Accepts `#abc`, `#aabbcc`, `abc`, `aabbcc`. Returns null when
 * the input doesn't match — callers use this for clipboard suggest
 * + the `+` dropdown's hex creation path.
 */
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
