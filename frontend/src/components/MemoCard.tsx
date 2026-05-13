/**
 * MemoCard — `type === 'memo'` LauncherItem inner body.
 *
 * v5 — "inside card" silhouette pass.
 *
 * The user's mandate: every widget shares one ratio. Inside card has
 * a unified height (WIDGET.insideHeight = 38, the average between the
 * music widget's compact pill and the older memo/color full-block
 * sizes). Below the inside card sits a wide T-split footer — two
 * region-style cells with a vertical divider in the middle, replacing
 * the previous "row of compact icon buttons" which read as cheap.
 *
 * Layout (82 px outer, hard invariant):
 *
 *   ┌──────────────────────────┐
 *   │ ●                        │   ← top-left status dot (5 px abs)
 *   │  ┌────────────────────┐  │
 *   │  │   inside card 38   │  │   ← swipe surface, smaller width
 *   │  └────────────────────┘  │     than the row → forms the T
 *   ├────────────┬─────────────┤
 *   │     📋      │      💾      │   ← T-split footer (2 cells)
 *   └────────────┴─────────────┘
 *
 * Swipe model (matches the music widget's elastic pill):
 *   - Tap                 → open editor
 *   - Swipe LEFT  ≥ 56 px → copy as MARKDOWN
 *   - Swipe RIGHT ≥ 56 px → copy as PLAIN TEXT
 *   - Slide is *small* (≤ 10 px) with rubber-band resistance — same
 *     vocabulary as MediaWidget's play-pause pill. NO reveal panels
 *     behind the inside card — those caused the visual clipping
 *     the user flagged. The motion alone, plus a subtle background
 *     intensification, is the feedback.
 */

import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { LauncherItem, Space } from '../types';
import { useSortable } from '@dnd-kit/sortable';
import {
  memoTitleFromBody,
  memoDaysLeft,
  memoHoursLeft,
} from '../lib/memoUtils';
import { useHorizontalSwipe } from '../hooks/useHorizontalSwipe';
import { WIDGET, HOVER_HINT } from '../widgets/widgetTokens';

interface MemoCardDragHandle {
  setNodeRef: ReturnType<typeof useSortable>['setNodeRef'];
  attributes: ReturnType<typeof useSortable>['attributes'];
  listeners: ReturnType<typeof useSortable>['listeners'];
  style: React.CSSProperties;
  isDragging: boolean;
}

interface MemoCardProps {
  item: LauncherItem;
  space: Space;
  dragHandle: MemoCardDragHandle;
  pinned: boolean;
  onOpenEditor: () => void;
  onCopyPlain: () => void;
  onCopyMarkdown: () => void;
  onExtend: () => void;
  onExportTxt: () => void;
  isJustAdded: boolean;
}

const SWIPE_THRESHOLD = 56;
/** Cap on the visual translateX. Keeps the slide elastic-feeling
 *  without ever clipping past the inside card's L/R margin. */
const SLIDE_MAX = 10;

function ttlStatusColor(daysLeft: number | null, pinned: boolean): string {
  if (pinned) return 'var(--accent)';
  if (daysLeft === null) return 'var(--text-muted)';
  if (daysLeft === 0) return '#ef4444';
  if (daysLeft <= 3) return '#f59e0b';
  return '#22c55e';
}

export function MemoCard({
  item, space, dragHandle, pinned,
  onOpenEditor, onCopyPlain, onCopyMarkdown, onExtend, onExportTxt, isJustAdded,
}: MemoCardProps) {
  const [hovered, setHovered] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);
  const [exportFlash, setExportFlash] = useState(false);

  const memo = item.memo;
  const body = memo?.body ?? '';
  const isEmpty = !body.trim();
  const title = memoTitleFromBody(body);

  const now = Date.now();
  const daysLeft = memoDaysLeft(item, now);
  const hoursLeft = memoHoursLeft(item, now);
  const status = ttlStatusColor(daysLeft, pinned);

  // Status-dot tooltip — single line `상태 · 동작` format. Pinned
  // items don't get a click action so the · is dropped there.
  const dotTooltip = pinned
    ? '보호 중 · 자동 만료 안 됨'
    : daysLeft === null ? ''
    : daysLeft === 0
      ? (hoursLeft && hoursLeft > 0 ? `${hoursLeft}시간 남음 · 클릭으로 살리기` : '곧 만료 · 클릭으로 살리기')
      : `${daysLeft}일 남음 · 클릭으로 살리기`;

  // ── Swipe gesture ────────────────────────────────────────────
  const flashAction = useCallback((kind: 'plain' | 'md') => {
    setCopyFlash(true);
    setTimeout(() => setCopyFlash(false), 700);
    if (kind === 'md') onCopyMarkdown();
    else onCopyPlain();
  }, [onCopyMarkdown, onCopyPlain]);

  const { handlers: swipeHandlers, dragX, progress } = useHorizontalSwipe({
    threshold: SWIPE_THRESHOLD,
    onTap: onOpenEditor,
    onSwipeLeft: () => flashAction('md'),
    onSwipeRight: () => flashAction('plain'),
  });

  // Heavy resistance — slide never exceeds ±SLIDE_MAX px so the
  // inside card stays inside the wrapper margins. Avoids the
  // "clipping past the parent edge" the user flagged.
  const visualDx = (() => {
    const raw = dragX;
    if (Math.abs(raw) <= SLIDE_MAX) return raw;
    const overshoot = Math.abs(raw) - SLIDE_MAX;
    // Asymptotic resistance: every additional dx adds vanishing motion.
    return Math.sign(raw) * (SLIDE_MAX + overshoot * 0.06);
  })();

  // Background intensity grows with swipe progress (capped at 100%).
  // Keeps the visual tied to the gesture without pulling in a reveal
  // panel.
  const swipeStrength = Math.min(1, Math.abs(progress));
  const tintPct = 18 + swipeStrength * 14;

  // ── Marquee for long titles ──────────────────────────────────
  const titleOuterRef = useRef<HTMLDivElement | null>(null);
  const titleInnerRef = useRef<HTMLSpanElement | null>(null);
  const [marqueeShift, setMarqueeShift] = useState(0);
  useLayoutEffect(() => {
    const outer = titleOuterRef.current;
    const inner = titleInnerRef.current;
    if (!outer || !inner) return;
    const overflow = inner.scrollWidth - outer.clientWidth;
    setMarqueeShift(overflow > 4 ? overflow + 8 : 0);
  }, [title]);

  // ── Bottom-row + status-dot handlers ─────────────────────────
  const handleExtend = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onExtend();
  }, [onExtend]);

  const handleCopyButton = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCopyPlain();
    setCopyFlash(true);
    setTimeout(() => setCopyFlash(false), 700);
  }, [onCopyPlain]);

  const handleExport = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onExportTxt();
    setExportFlash(true);
    setTimeout(() => setExportFlash(false), 700);
  }, [onExportTxt]);

  const { setNodeRef, attributes, listeners, style, isDragging } = dragHandle;

  // ── Right-click drag delegation (matches MediaWidget) ───────
  const suppressContextMenuRef = useRef(false);
  const handleRightClickDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    if (!listeners?.onPointerDown) return;
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
    (listeners.onPointerDown as (e: React.PointerEvent) => void)(e);
  }, [listeners]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (suppressContextMenuRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const boxAccent = space.color || 'var(--accent)';

  return (
    <>
      <style>{`
        @keyframes memoMarquee {
          0%   { transform: translateX(0); }
          15%  { transform: translateX(0); }
          85%  { transform: translateX(var(--memo-marquee-shift, 0px)); }
          100% { transform: translateX(var(--memo-marquee-shift, 0px)); }
        }
      `}</style>

      <div
        ref={setNodeRef}
        data-card
        data-card-id={item.id}
        data-card-type="memo"
        data-tour-id="memo-card"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        {...attributes}
        onPointerDown={handleRightClickDrag}
        onContextMenu={handleContextMenu}
        style={{
          ...style,
          background: 'var(--surface)',
          borderColor: hovered ? 'var(--border-focus)' : 'var(--border-rgba)',
          borderStyle: 'solid',
          borderWidth: 1,
          borderRadius: WIDGET.cardRadius,
          height: WIDGET.cardHeight,
          padding: 0,
          position: 'relative',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          opacity: isDragging ? 0.4 : 1,
          boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
          ...(isJustAdded && !isDragging
            ? { animation: 'cardEnter 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both' }
            : {}),
        }}
      >
        {/* Status dot — top-left, abs */}
        <button
          onClick={pinned ? undefined : handleExtend}
          disabled={pinned}
          data-memo-control
          title={dotTooltip}
          aria-label={dotTooltip}
          style={{
            position: 'absolute',
            top: WIDGET.statusDotTop,
            left: WIDGET.statusDotLeft,
            width: WIDGET.statusDotSize,
            height: WIDGET.statusDotSize,
            borderRadius: '50%',
            background: status,
            border: 'none',
            padding: 0,
            cursor: pinned ? 'default' : 'pointer',
            boxShadow: `0 0 4px ${status === 'var(--accent)' ? 'var(--accent)' : status}88`,
            zIndex: 3,
            transition: 'transform 0.12s, box-shadow 0.2s',
          }}
          onMouseEnter={e => { if (!pinned) e.currentTarget.style.transform = 'scale(1.5)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        />

        {/* ── Top wrapper — holds the inside card with side margins
            so the bottom T-split visually extends BEYOND the inside
            card, forming the T silhouette. */}
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
          {/* Inside card — fixed height, swipeable */}
          <div
            {...swipeHandlers}
            title={isEmpty
              ? '클릭 : 메모 작성 시작'
              : HOVER_HINT({
                  '클릭': '편집기 열기',
                  '왼쪽으로 스와이프': '마크다운으로 복사',
                  '오른쪽으로 스와이프': '텍스트로 복사',
                })}
            style={{
              width: '100%',
              height: WIDGET.insideHeight,
              borderRadius: WIDGET.primaryRadius,
              background: `color-mix(in srgb, ${boxAccent} ${tintPct}%, var(--surface))`,
              border: `1px solid ${hovered ? boxAccent : 'transparent'}`,
              transform: `translateX(${visualDx}px)`,
              transition: dragX === 0
                ? 'transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1), background 0.15s, border-color 0.15s'
                : 'background 0.08s',
              cursor: 'pointer',
              touchAction: 'pan-y',
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
              boxSizing: 'border-box',
              overflow: 'hidden',
            }}
          >
            <div
              ref={titleOuterRef}
              style={{
                flex: 1,
                minWidth: 0,
                position: 'relative',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                fontSize: 12,
                fontWeight: 600,
                lineHeight: '15px',
                color: isEmpty ? 'var(--text-dim)' : 'var(--text-color)',
              }}
            >
              <span
                ref={titleInnerRef}
                style={{
                  display: 'inline-block',
                  whiteSpace: 'nowrap',
                  ...((hovered && marqueeShift > 0)
                    ? {
                        // Constant slow scroll: linear timing + duration
                        // scaled by overflow length (≈ 22 px/sec during
                        // the 70 % of the cycle that's actually moving;
                        // 0–15 % and 85–100 % are dwell). Shorter titles
                        // get a 6 s floor so they don't strobe. Earlier
                        // version was a fixed 6 s ease-in-out which felt
                        // jerky and too quick for long memos.
                        animation: `memoMarquee ${Math.max(6, marqueeShift / 15.4).toFixed(1)}s linear infinite`,
                        ['--memo-marquee-shift' as string]: `-${marqueeShift}px`,
                      }
                    : {
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        maxWidth: '100%',
                      }),
                }}
              >
                {isEmpty ? '(빈 메모)' : title}
              </span>
            </div>
          </div>
        </div>

        {/* ── Bottom T-split footer — edge-to-edge, 2 wide cells
            with a 1 px center divider. The T-shape is formed by
            this row's top border (the horizontal stroke) plus the
            divider between cells (the vertical stroke). */}
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
            data-memo-control
            onClick={handleCopyButton}
            title={HOVER_HINT({
              '클릭': '텍스트로 복사',
              '왼쪽으로 스와이프': '마크다운으로 복사',
            })}
            color={copyFlash ? 'var(--accent)' : undefined}
            divider="right"
          >
            <Icon name={copyFlash ? 'check' : 'content_copy'} size={13} />
          </BottomCell>
          <BottomCell
            data-memo-control
            onClick={handleExport}
            title="다른 이름으로 저장"
            color={exportFlash ? 'var(--accent)' : undefined}
          >
            <Icon name={exportFlash ? 'check' : 'save_alt'} size={13} />
          </BottomCell>
        </div>

        {space.color && (
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
            style={{ background: space.color, opacity: 0.55 }}
          />
        )}
      </div>
    </>
  );
}

/* ── Bottom T-split cell — wide region, icon centered ───────── */
interface BottomCellProps {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
  color?: string;
  divider?: 'right';
  'data-memo-control'?: boolean;
}

function BottomCell({
  children, onClick, title, disabled, color, divider, ...rest
}: BottomCellProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      data-memo-control
      {...rest}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        background: 'transparent',
        border: 'none',
        borderRight: divider === 'right' ? '1px solid var(--border-rgba)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-dim)' : (color ?? 'var(--text-muted)'),
        fontFamily: 'inherit',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}
