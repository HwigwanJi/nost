/**
 * MemoCard — `type === 'memo'` LauncherItem inner body.
 *
 * v4 — family-look pass. The user singled out the music widget as
 * the visual benchmark: bounded primary box up top, calm secondary
 * row underneath, top-left status dot when applicable. Memo + colour
 * + media now share the same outer chrome (see widgetTokens.ts) so
 * three widgets in a row read as ONE family.
 *
 * Layout (82 px tall — STANDARD CARD HEIGHT, hard invariant):
 *
 *   ┌──────────────────────────────────────┐
 *   │ ●                                     │  ← 5 px status dot (clickable
 *   │  ┌────────────────────────────────┐  │     refresh; hover shows TTL)
 *   │  │  회의 노트 9시 백엔드 싱크       │  │  ← swipe box, NO icon
 *   │  └────────────────────────────────┘  │
 *   │       [📋]    [💾]                    │  ← icon-only secondary row
 *   └──────────────────────────────────────┘
 *
 * Compared to v3:
 *   - DROPPED the 3 px top TTL bar — the dot now carries the same
 *     signal at a fraction of the visual weight, matching how the
 *     music widget signals "this is a tinted thing" with a single
 *     6 px accent dot.
 *   - DROPPED the per-card sticky-note icon container — user said
 *     the icon container was unnecessary chrome. Title alone reads
 *     "this is a memo" once the user knows the family.
 *   - DROPPED the dedicated TTL refresh button cell — clicking the
 *     status dot itself fires the refresh. Saves a button slot AND
 *     puts the action visually on the indicator it modifies.
 *   - SHRUNK the dot from 7 px to 5 px (user has asked twice).
 *   - Bottom row is now 2 buttons (copy + save-as), icon-only with
 *     hover tooltips — same pattern as ColorSwatch's picker/edit
 *     and the music widget's mute icon.
 *
 * Interaction grammar (matches v3, since the user kept it):
 *   - Tap swipe box      → open editor
 *   - Swipe left ≥ 56 px → copy as MARKDOWN (raw body)
 *   - Swipe right ≥ 56 px → copy as PLAIN TEXT (markers stripped)
 *   - Click status dot   → TTL reset + toast
 *   - 📋 button           → copy as plain text (same as swipe-right)
 *   - 💾 button           → 다른 이름으로 저장 (OS save-as dialog,
 *                          memo card stays — snapshot, not move)
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
import { WIDGET, WIDGET_TIP } from '../widgets/widgetTokens';

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

/** Status colour — drives the dot. SSOT for all TTL-state visuals. */
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

  // Status-dot tooltip — exposes the precise time on hover.
  // Following the design system rule: defer values to hover when
  // the visual signal (here: dot colour) already conveys urgency.
  const dotTooltip = pinned
    ? '보호 중 (자동 만료 안 됨)'
    : daysLeft === null ? ''
    : daysLeft === 0
      ? (hoursLeft && hoursLeft > 0 ? `${hoursLeft}시간 남음 — 클릭으로 살리기` : '곧 만료 — 클릭으로 살리기')
      : `${daysLeft}일 남음 — 클릭으로 살리기`;

  // ── Swipe gesture wiring ─────────────────────────────────────
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

  const leftActionOpacity = progress < 0 ? Math.min(1, -progress) : 0;
  const rightActionOpacity = progress > 0 ? Math.min(1, progress) : 0;
  const visualDx = Math.abs(dragX) > SWIPE_THRESHOLD
    ? Math.sign(dragX) * (SWIPE_THRESHOLD + (Math.abs(dragX) - SWIPE_THRESHOLD) * 0.3)
    : dragX;

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

  // Box accent — prefer space colour, fall back to accent var.
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
          borderRadius: WIDGET.cardRadius,
          height: WIDGET.cardHeight,
          padding: WIDGET.cardPadding,
          position: 'relative',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: WIDGET.cardGap,
          overflow: 'hidden',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          opacity: isDragging ? 0.4 : 1,
          boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
          ...(isJustAdded && !isDragging
            ? { animation: 'cardEnter 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both' }
            : {}),
        }}
      >
        {/* ── Status dot — top-left abs (matches MediaWidget's accent
            dot position). Clickable refresh; tooltip carries the
            precise time-remaining. Pinned memos show the dot in
            accent (no decay) and the click is a no-op. */}
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
            // Slight glow so the dot reads as deliberate, not a
            // stray pixel — same trick MediaWidget uses on its
            // accent dot.
            boxShadow: `0 0 4px ${status === 'var(--accent)' ? 'var(--accent)' : status}88`,
            zIndex: 2,
            transition: 'transform 0.12s, box-shadow 0.2s',
          }}
          onMouseEnter={e => { if (!pinned) e.currentTarget.style.transform = 'scale(1.5)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        />

        {/* ── Primary swipe surface (the family-look "play button" zone)
            Fills the available vertical space minus the secondary row.
            Tap = open editor; swipe left/right = markdown / plain copy. */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            borderRadius: WIDGET.primaryRadius,
            background: 'var(--surface-hover)',
            border: `1px solid ${hovered ? boxAccent : 'transparent'}`,
            transition: 'border-color 0.15s',
            cursor: 'grab',
            // Padding-left makes room for the status dot so the
            // title doesn't run under it.
            paddingLeft: 4,
          }}
        >
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

          {/* Foreground swipe surface */}
          <div
            {...swipeHandlers}
            title={isEmpty ? '빈 메모 — 클릭해서 시작' : `${title}\n\n← 마크다운 복사  ·  텍스트 복사 →`}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
              borderRadius: WIDGET.primaryRadius,
              background: `color-mix(in srgb, ${boxAccent} 18%, var(--surface))`,
              transform: `translateX(${visualDx}px)`,
              transition: dragX === 0 ? 'transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1), background 0.15s' : 'background 0.15s',
              cursor: 'pointer',
              touchAction: 'pan-y',
              ...(copyFlash ? { animation: 'memoFlashPulse 0.6s ease-out' } : {}),
            }}
          >
            {/* Title with marquee — no leading icon container, per
                user mandate. The widget's family identity comes from
                its outer chrome + status dot, not a per-card glyph. */}
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

        {/* ── Secondary action row — icon-only, hover tooltip ───
            Family rule: every secondary affordance gets the icon-
            only treatment. Labels live in `title` for hover reveal.
            Centred via a flex container; max width keeps the row
            from getting wider than the primary box. */}
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
            data-memo-control
            onClick={handleCopyButton}
            title={WIDGET_TIP('본문 복사', '← 스와이프 = 마크다운')}
            color={copyFlash ? 'var(--accent)' : undefined}
            flashing={copyFlash}
          >
            <Icon name={copyFlash ? 'check' : 'content_copy'} size={11} />
          </SecondaryBtn>
          <SecondaryBtn
            data-memo-control
            onClick={handleExport}
            title={WIDGET_TIP('다른 이름으로 저장')}
            color={exportFlash ? 'var(--accent)' : undefined}
            flashing={exportFlash}
          >
            <Icon name={exportFlash ? 'check' : 'save_alt'} size={11} />
          </SecondaryBtn>
        </div>

        {/* Bottom space-color stripe — parity with regular cards. */}
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

/* ── Secondary button — icon-only, family-look ──────────────── */
interface SecondaryBtnProps {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
  color?: string;
  flashing?: boolean;
  'data-memo-control'?: boolean;
}

function SecondaryBtn({
  children, onClick, title, disabled, color, flashing, ...rest
}: SecondaryBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      data-memo-control
      aria-label={title}
      {...rest}
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
        color: disabled ? 'var(--text-dim)' : (color ?? 'var(--text-muted)'),
        fontFamily: 'inherit',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
        animation: flashing ? 'memoBtnPop 0.28s ease' : undefined,
      }}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.borderColor = 'var(--border-focus)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'var(--border-rgba)';
      }}
    >
      {children}
    </button>
  );
}
