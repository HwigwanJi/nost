/**
 * MemoCard — `type === 'memo'` LauncherItem inner body.
 *
 * v3 redesign — addresses the user's repeated note that the memo
 * card lacked the "clear interactive zone" the music widget has
 * (think: the play / pause button area). The whole middle of the
 * card is now a single space-coloured swipe box: tap to open the
 * editor, swipe left to copy as markdown, swipe right to copy as
 * plain text. The title scrolls inside (marquee on hover) and the
 * box itself slides during the swipe so the user can feel the
 * gesture build before committing.
 *
 * Layout (82 px tall — STANDARD CARD HEIGHT, do not change):
 *
 *   ┌──────────────────────────────────────┐
 *   │ ━━━━━━━━━━━━━━━━━━━━━ (TTL bar 3px)   │
 *   │  ┌────────────────────────────────┐  │
 *   │  │ 📝  회의 노트 9시 백엔드 싱크    │  │  ← swipe box (space color)
 *   │  └────────────────────────────────┘  │
 *   │  ●     [📋]    [💾]                  │
 *   └──────────────────────────────────────┘
 *
 * Interaction grammar (matches MediaWidget-style "obvious controls"):
 *   - Tap swipe box      → open editor
 *   - Swipe left ≥56px   → copy as markdown (raw body)
 *   - Swipe right ≥56px  → copy as plain text (markers stripped)
 *   - ●  bottom-left     → 살리기 (TTL reset). Colour-coded by status.
 *   - 📋 bottom-mid       → copy as plain text (same as swipe-right)
 *   - 💾 bottom-right    → 다른 이름으로 저장 (.txt export)
 *
 * Status colour ladder (drives both top bar AND ●  refresh dot):
 *   pinned → accent · >3d → green · 1–3d → amber · <1d → red
 */

import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { LauncherItem, Space } from '../types';
import { useSortable } from '@dnd-kit/sortable';
import {
  memoTitleFromBody,
  memoDaysLeft,
  memoHoursLeft,
  memoGaugeFraction,
} from '../lib/memoUtils';
import { useHorizontalSwipe } from '../hooks/useHorizontalSwipe';

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
  /** Copy as plain text (markdown markers stripped). Wired to the
   *  swipe-right gesture AND the 📋 bottom button. */
  onCopyPlain: () => void;
  /** Copy as raw markdown (preserve -, **, [ ] markers). Wired to
   *  the swipe-left gesture only — most users want plain, this is
   *  the power-user path. */
  onCopyMarkdown: () => void;
  onExtend: () => void;
  onExportTxt: () => void;
  isJustAdded: boolean;
}

// Hard invariant — every card type in nost is exactly this tall.
// User mandate. Don't change without rewriting the rest of the grid.
const CARD_HEIGHT = 82;
const SWIPE_THRESHOLD = 56;

/** Status colour from days remaining. SSOT — used by both the top
 *  TTL bar and the ●  refresh button. */
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
  const fraction = memoGaugeFraction(item, now);
  const status = ttlStatusColor(daysLeft, pinned);

  const ttlTooltip = pinned
    ? '영구 보관 (TTL 없음)'
    : daysLeft === null ? ''
    : daysLeft === 0
      ? (hoursLeft && hoursLeft > 0 ? `${hoursLeft}시간 남음 — 클릭으로 수명 리셋` : '곧 만료 — 클릭으로 살리기')
      : `${daysLeft}일 남음 — 클릭으로 살리기`;

  // ── Swipe box (the main interactive zone) ───────────────────
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

  // Visual feedback during drag — colour and label intensity grow
  // with progress so the user can feel the threshold approaching
  // before committing.
  const leftActionOpacity = progress < 0 ? Math.min(1, -progress) : 0;
  const rightActionOpacity = progress > 0 ? Math.min(1, progress) : 0;
  // Add resistance past the threshold so overshooting doesn't fly
  // the box off-screen on a strong gesture.
  const visualDx = Math.abs(dragX) > SWIPE_THRESHOLD
    ? Math.sign(dragX) * (SWIPE_THRESHOLD + (Math.abs(dragX) - SWIPE_THRESHOLD) * 0.3)
    : dragX;

  // ── Marquee setup ─────────────────────────────────────────────
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

  // ── Bottom-row button handlers ────────────────────────────────
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

  // Box colour: prefer space.color (the "blue" the user pointed at),
  // fall back to accent. We tint the surface heavily on the swipe
  // box (matches the music widget's saturated inner area) so it
  // reads as "the actionable zone" at a glance.
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
        @keyframes memoFlashPulse {
          0%   { box-shadow: 0 0 0 0 var(--accent); }
          100% { box-shadow: 0 0 0 6px transparent; }
        }
      `}</style>

      <div
        ref={setNodeRef}
        data-card
        data-card-id={item.id}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        {...attributes}
        {...listeners}
        style={{
          ...style,
          background: 'var(--surface)',
          borderColor: hovered ? 'var(--border-focus)' : 'var(--border-rgba)',
          borderStyle: 'solid',
          borderWidth: 1,
          borderRadius: 12,
          height: CARD_HEIGHT,
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
        {/* ── TTL bar (top, 3 px, status-coloured) ─────────────── */}
        <div
          aria-hidden="true"
          style={{
            position: 'relative',
            height: 3,
            background: 'var(--border-rgba)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: pinned ? '100%' : `${Math.max(2, fraction * 100)}%`,
              background: status,
              transition: 'width 0.3s, background 0.3s',
              opacity: pinned ? 0.85 : 1,
            }}
          />
        </div>

        {/* ── Swipe box (the main act) ───────────────────────────
            Reveals action labels behind it during drag. The box
            itself slides — same visual grammar as iOS swipe-to-action.
            Tap (no drag) commits to onOpenEditor via useHorizontalSwipe. */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            margin: '4px 6px 4px 6px',
            overflow: 'hidden',
            borderRadius: 8,
            background: 'var(--surface-hover)',
            // Shows a faint outline so the swipe box reads as a
            // distinct affordance even when not hovered. Stronger
            // when armed (hover) — same play-button vocabulary.
            border: `1px solid ${hovered ? boxAccent : 'transparent'}`,
            transition: 'border-color 0.15s',
            cursor: 'grab',
          }}
        >
          {/* Action labels — REVEALED BEHIND the swipe box as it
              moves. Left side shows "마크다운 복사" (swipe right
              direction reveals it from the left edge), right side
              shows "텍스트 복사". Opacity = swipe progress. */}
          <SwipeActionLabel
            side="left"
            icon="text_snippet"
            label="마크다운"
            opacity={leftActionOpacity}
            color="#8b5cf6"
          />
          <SwipeActionLabel
            side="right"
            icon="content_copy"
            label="텍스트"
            opacity={rightActionOpacity}
            color={boxAccent}
          />

          {/* Foreground swipe surface. translateX drives the visual.
              Background is the space colour (or accent fallback) at
              a soft tint. */}
          <div
            {...swipeHandlers}
            title={isEmpty ? '빈 메모 — 클릭해서 시작' : `${title}\n\n← 마크다운으로 복사  ·  텍스트로 복사 →`}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 10px',
              borderRadius: 8,
              background: `color-mix(in srgb, ${boxAccent} 18%, var(--surface))`,
              transform: `translateX(${visualDx}px)`,
              transition: dragX === 0 ? 'transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1), background 0.15s' : 'background 0.15s',
              cursor: 'pointer',
              touchAction: 'pan-y',  // let vertical scrolling escape
              ...(copyFlash
                ? { animation: 'memoFlashPulse 0.6s ease-out' }
                : {}),
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 22, height: 22,
                borderRadius: 6,
                background: `color-mix(in srgb, ${boxAccent} 32%, transparent)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon
                name={pinned ? 'bookmark' : 'sticky_note_2'}
                size={12}
                color={pinned ? 'var(--accent)' : boxAccent}
              />
            </div>

            {/* Title with marquee */}
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
                        animation: 'memoMarquee 6s ease-in-out infinite',
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
              {!hovered && marqueeShift > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 0, right: 0, bottom: 0,
                    width: 18,
                    background: `linear-gradient(to right, transparent, color-mix(in srgb, ${boxAccent} 18%, var(--surface)))`,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom action row (3 cells) ─────────────────────── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 0,
            borderTop: '1px solid var(--border-rgba)',
            background: 'var(--surface)',
            flexShrink: 0,
          }}
        >
          <ActionBtn
            data-memo-control
            onClick={handleExtend}
            title={ttlTooltip || '살리기 — 수명을 다시 채웁니다'}
            disabled={pinned}
            divider="right"
          >
            <span
              aria-hidden="true"
              style={{
                // Small is pretty — user mandate. The colour itself
                // carries the urgency signal; the dot just needs to
                // be findable, not loud.
                width: 7, height: 7,
                borderRadius: '50%',
                background: status,
                boxShadow: `0 0 0 1.5px color-mix(in srgb, ${status} 18%, transparent)`,
                transition: 'background 0.3s, box-shadow 0.3s',
              }}
            />
          </ActionBtn>
          <ActionBtn
            data-memo-control
            onClick={handleCopyButton}
            title="본문을 텍스트로 클립보드에 복사 (← 스와이프 = 마크다운)"
            color={copyFlash ? 'var(--accent)' : undefined}
            divider="right"
            flashing={copyFlash}
          >
            <Icon name={copyFlash ? 'check' : 'content_copy'} size={11} />
          </ActionBtn>
          <ActionBtn
            data-memo-control
            onClick={handleExport}
            title="다른 이름으로 저장 — txt 파일로 내보내기"
            color={exportFlash ? 'var(--accent)' : undefined}
            flashing={exportFlash}
          >
            <Icon name={exportFlash ? 'check' : 'save_alt'} size={11} />
          </ActionBtn>
        </div>

        {/* Bottom space-color stripe (parity with regular cards). */}
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

/* ── Swipe action label (revealed behind the swipe box) ───────── */
function SwipeActionLabel({
  side, icon, label, opacity, color,
}: {
  side: 'left' | 'right';
  icon: string;
  label: string;
  opacity: number;
  color: string;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0, bottom: 0,
        [side]: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 12px',
        opacity,
        color,
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        // Subtle scale-up as the user passes the threshold so they
        // see "this is now armed." 0..1 maps to scale 0.85..1.05.
        transform: `scale(${0.85 + opacity * 0.2})`,
        transition: 'transform 0.05s',
      }}
    >
      {side === 'right' && <Icon name={icon} size={11} />}
      <span>{label}</span>
      {side === 'left' && <Icon name={icon} size={11} />}
    </div>
  );
}

/* ── Action button — internal, shared by all 3 bottom slots ───── */
interface ActionBtnProps {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
  color?: string;
  divider?: 'right';
  flashing?: boolean;
  'data-memo-control'?: boolean;
}

function ActionBtn({
  children, onClick, title, disabled, color, divider, flashing, ...rest
}: ActionBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      data-memo-control
      {...rest}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '6px 4px',
        background: 'transparent',
        border: 'none',
        borderRight: divider === 'right' ? '1px solid var(--border-rgba)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-dim)' : (color ?? 'var(--text-muted)'),
        fontSize: 10,
        fontWeight: 600,
        fontFamily: 'inherit',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, color 0.12s',
        animation: flashing ? 'memoBtnPop 0.28s ease' : undefined,
        minWidth: 0,
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}
