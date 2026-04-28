import { memo, useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { LauncherItem, Space } from '../types';

/**
 * ColorSwatchWidget — single-cell card showing one colour, in a
 * Pantone-style layout: solid colour block on top, white label area
 * on the bottom with the hex code (and optional name).
 *
 * Click → copy hex to clipboard with a brief "복사됨" overlay.
 *
 * Why one colour per card (not a multi-swatch palette in one card):
 * the user wants palette colours to live IN the grid alongside other
 * cards — pinned, draggable, deletable, movable between spaces — same
 * UX as URLs / apps. A multi-swatch widget would make those colours
 * second-class (you'd have to enter "edit palette" mode to manage).
 *
 * Adding new swatches: clipboard suggestion picks up hex strings
 * (#abc / #aabbcc / #AABBCC) and offers "팔레트 색 추가" — same
 * affordance pattern the launcher already uses for URLs / apps. The
 * `+` dropdown also has a "컬러" entry for explicit creation.
 *
 * Right-click drag (matches ItemCard / MediaWidget): wrapper carries
 * `data-card` so useWindowDrag skips it; >8 px movement starts a
 * sortable reorder, no movement opens the standard ContextMenu.
 */

interface Props {
  item: LauncherItem;
  /** Owning space — kept for prop parity with MediaWidget; the
   *  swatch doesn't currently fall back to space colour, but it's
   *  cheap to thread through. */
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
}

function ColorSwatchWidgetImpl({ item, dragHandle, onContextMenu }: Props) {
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

  // ── Read swatch options ────────────────────────────────────────
  // The widget kind discriminator is checked at the dispatch site
  // (ItemCard) so by the time we render, we trust it. We still defend
  // against malformed data with a fallback colour to avoid crashing
  // the whole grid if someone hand-edits the store.
  const opts = item.widget?.kind === 'color-swatch' ? item.widget.options : null;
  const hex = (opts?.hex || '#888888').toUpperCase();
  // The user can label a swatch via the edit dialog. Falls through
  // to the LauncherItem title (which we seed with the hex when the
  // widget is created), so when the title and hex match we treat it
  // as "unnamed" and surface only the hex below the colour block.
  const labelCandidate = opts?.name || item.title;
  const hasName = !!labelCandidate && labelCandidate.toUpperCase() !== hex;
  const name = hasName ? labelCandidate : '';

  // ── Copy-on-click ─────────────────────────────────────────────
  // Clipboard write can fail if the document isn't focused — we
  // surface a tiny "복사됨!" / "복사 실패" overlay either way so the
  // gesture always feels confirmed.
  const [copied, setCopied] = useState<null | 'ok' | 'fail'>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressContextMenuRef.current) return; // drag is settling
    try {
      await navigator.clipboard.writeText(hex);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(null), 1100);
  }, [hex]);

  // ── Render ────────────────────────────────────────────────────
  const handleProps = dragHandle ? {
    ref: dragHandle.setNodeRef,
    style: { ...dragHandle.style, opacity: dragHandle.isDragging ? 0.4 : 1 },
    ...dragHandle.attributes,
  } : { style: {} };

  // Pantone-style proportions: ~62% colour block, ~38% label area.
  // Border-radius and border-width match ItemCard's `rounded-xl`
  // (Tailwind = 12 px) and 1 px border so swatches sit in the same
  // visual family as every other card. The inner colour block and
  // label sections deliberately have NO inner radius — overflow:
  // hidden on the outer wrapper clips them to the rounded corners,
  // so we get one continuous rounded rectangle without the inner
  // children fighting for their own corner radii.
  const wrapStyle: CSSProperties = {
    ...(handleProps.style as CSSProperties),
    // FIXED height (not minHeight) so a labelled swatch with two
    // text lines doesn't make its grid row taller than its
    // unlabelled neighbours. Color block flexes to absorb whatever's
    // left after the label area renders.
    height: 82,
    background: 'var(--surface)',
    border: '1px solid var(--border-rgba)',
    borderRadius: 12,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    cursor: 'pointer',
    position: 'relative',
    transition: 'border-color 150ms ease, background 150ms ease',
  };

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
        // CRITICAL: data-card lets useWindowDrag skip this region —
        // without it, right-click on the swatch would slide the
        // entire nost window.
        data-card
        data-card-id={item.id}
        style={wrapStyle}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = 'var(--border-focus)';
          el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = 'var(--border-rgba)';
          el.style.boxShadow = 'none';
        }}
        title={name ? `${hex} · ${name}` : hex}
      >
        {/* Colour block — flex: 1 means it takes whatever's left
            after the label area. We drop minHeight here so a two-
            line label (name + hex) can shrink the colour block
            without pushing total height past the wrap's fixed 82 px.
            The block stays comfortably visible at ≥ 36 px even
            with the largest label. */}
        <div style={{
          flex: 1,
          background: hex,
          boxShadow: luminance(hex) > 0.85
            ? 'none'
            : 'inset 0 1px 0 rgba(255,255,255,0.06)',
          position: 'relative',
        }}>
          {/* Copy-confirmation overlay — fades in/out via the keyframe. */}
          {copied && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
              fontSize: 11, fontWeight: 700, letterSpacing: '-0.01em',
              animation: 'nost-cs-pop 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
            }}>
              {copied === 'ok' ? '복사됨' : '복사 실패'}
            </div>
          )}
        </div>

        {/* Pantone-style label footer.
            When the user has given the swatch a name, it leads
            (Pretendard, bold) and the hex sits below in mono as a
            quiet developer-grade reference. When there's no name,
            the hex itself takes the lead — the swatch isn't
            anonymous, it's just identified by its value. */}
        <div style={{
          padding: '4px 8px 5px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border-rgba)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          // Explicit pixel heights below — gap stays tight so a
          // labelled swatch's two lines fit in ~30 px instead of
          // letting line-height padding push it over.
          gap: 0,
          flexShrink: 0,
        }}>
          {hasName ? (
            <>
              <div style={{
                fontSize: 11,
                lineHeight: '13px',
                fontWeight: 700,
                color: 'var(--text-color)',
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {name}
              </div>
              <div style={{
                fontSize: 9,
                lineHeight: '11px',
                fontWeight: 500,
                color: 'var(--text-muted)',
                fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace',
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {hex}
              </div>
            </>
          ) : (
            <div style={{
              fontSize: 11,
              lineHeight: '13px',
              fontWeight: 700,
              color: 'var(--text-color)',
              fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace',
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {hex}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export const ColorSwatchWidget = memo(ColorSwatchWidgetImpl, (prev, next) =>
  prev.item === next.item &&
  prev.space === next.space &&
  prev.dragHandle?.isDragging === next.dragHandle?.isDragging
);

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Relative luminance — 0..1 — used to decide whether the inner
 * highlight gradient on the colour block is worth rendering. Light
 * colours (white-ish backgrounds, pastels) hide the highlight, so
 * we skip it to avoid wasted paint cost and a faint banding artifact.
 *
 * Plain math, not gamma-correct — we don't need WCAG accuracy here,
 * just a binary "light vs not light" decision.
 */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8)  & 0xff) / 255;
  const b = ( n        & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ── Public utilities ────────────────────────────────────────────────

/**
 * Normalise a user-input hex string to canonical `#RRGGBB` (uppercase),
 * or return null if not a valid hex. Accepts:
 *   - `#abc`     → `#AABBCC`
 *   - `#abcdef`  → `#ABCDEF`
 *   - `abc`/`abcdef` (no `#`) → same with `#` prefix
 * Anything else → null.
 *
 * Exposed so the clipboard suggestion / `+` dropdown can validate
 * input the same way the renderer does.
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
