/**
 * MemoCard — inner body of a `type === 'memo'` LauncherItem.
 *
 * v2 redesign — modelled on the MediaWidget's "bounded box, clear
 * action zones" pattern that the user singled out as the visual
 * benchmark in the launcher. The previous v1 layout (icon + 3-line
 * body + thin gauge + dot button) felt undefined: nothing told the
 * user where to look first or what was clickable.
 *
 * Layout (82 px tall — STANDARD CARD HEIGHT, do not change. Every
 * card type in nost shares this exact height so the grid stays a
 * uniform rhythm regardless of mix. Earlier I extended this to 96 px
 * for breathing room; reverted on user mandate. The trade-off cost is
 * the body preview line — we drop it. The title alone (with marquee
 * on overflow) is sufficient identity, and the editor is one click
 * away for the full text.):
 *
 *   ┌──────────────────────────────────────┐
 *   │ ━━━━━━━━━━━━━━━━━━━━━ (TTL bar 3px)  │  green / yellow / red
 *   │  📝  회의 노트 — 9시 백엔드 싱크          │  title (marquee on hover)
 *   │  [↻ 5일]    [📋]    [📌]               │  3-button action row
 *   └──────────────────────────────────────┘
 *
 * Click model:
 *   - Click body area  → open editor (unchanged)
 *   - Click ↻ button   → TTL reset (살리기) + toast
 *   - Click 📋 button   → copy body to clipboard + toast
 *   - Click 📌 button   → toggle pin
 *
 * Hover marquee: when the title overflows the available width, hover
 * starts a translateX animation that scrolls it from end to start
 * and loops. We measure overflow at mount + on title change rather
 * than running JS during the animation — pure CSS transition once
 * the offsets are computed.
 *
 * Status colour ladder (drives both top bar AND ↻ button accent):
 *   - Pinned        → accent (no TTL)
 *   - >  3 days     → green-500
 *   - 1–3 days      → amber-500
 *   - <  1 day      → red-500
 *   - Trashed       → muted grey (filtered out of grid; defensive)
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
  onCopy: () => void;
  onExtend: () => void;
  /** Export the memo body as a .txt file (= "다른 이름으로 저장").
   *  Replaces the previous pin button — pinning a memo conceptually
   *  conflicts with the auto-fade product story; the natural "I want
   *  to keep this forever" path is to export it to a real file the
   *  OS owns. */
  onExportTxt: () => void;
  isJustAdded: boolean;
}

// Hard invariant — every card type in nost is exactly this tall. Don't
// change without rewriting the rest of the grid system; the user has
// flagged this as sacred regardless of how cramped a card type feels.
const CARD_HEIGHT = 82;

/** Status colour from days remaining. Single source of truth — used by
 *  both the top TTL bar and the ↻ refresh button label. */
function ttlStatusColor(daysLeft: number | null, pinned: boolean): string {
  if (pinned) return 'var(--accent)';
  if (daysLeft === null) return 'var(--text-muted)';
  if (daysLeft === 0) return '#ef4444';     // red — expiring within 24h
  if (daysLeft <= 3) return '#f59e0b';      // amber
  return '#22c55e';                          // green — comfortable
}

export function MemoCard({
  item, space, dragHandle, pinned,
  onOpenEditor, onCopy, onExtend, onExportTxt, isJustAdded,
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

  // Tooltip-only TTL hint — the bottom button is now just a colored
  // circle with no label, so the only place to communicate "5일 남음"
  // is the hover title. Stays out of the way visually but recoverable
  // for users who want the precise number.
  const ttlTooltip = pinned
    ? '영구 보관 (TTL 없음)'
    : daysLeft === null ? ''
    : daysLeft === 0
      ? (hoursLeft && hoursLeft > 0 ? `${hoursLeft}시간 남음 — 클릭으로 수명 리셋` : '곧 만료 — 클릭으로 살리기')
      : `${daysLeft}일 남음 — 클릭으로 살리기`;

  // ── Marquee setup ────────────────────────────────────────────
  // We measure whether the title overflows its container; only then
  // does the hover animation engage. Static (non-overflowing) titles
  // stay calm — animating short text feels gimmicky.
  const titleOuterRef = useRef<HTMLDivElement | null>(null);
  const titleInnerRef = useRef<HTMLSpanElement | null>(null);
  const [marqueeShift, setMarqueeShift] = useState<number>(0);

  useLayoutEffect(() => {
    const outer = titleOuterRef.current;
    const inner = titleInnerRef.current;
    if (!outer || !inner) return;
    const overflow = inner.scrollWidth - outer.clientWidth;
    setMarqueeShift(overflow > 4 ? overflow + 8 : 0);
  }, [title]);

  // ── Click router ─────────────────────────────────────────────
  // Pointer-down inside an action button must NOT propagate to the
  // outer card click handler — otherwise tapping ↻ would also open
  // the editor. We mark control elements with data-memo-control and
  // bail out early on the body click if the target is one.
  const handleCardClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-memo-control]')) return;
    onOpenEditor();
  }, [onOpenEditor]);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCopy();
    setCopyFlash(true);
    setTimeout(() => setCopyFlash(false), 700);
  }, [onCopy]);

  const handleExtend = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onExtend();
  }, [onExtend]);

  const handleExport = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onExportTxt();
    setExportFlash(true);
    setTimeout(() => setExportFlash(false), 700);
  }, [onExportTxt]);

  const { setNodeRef, attributes, listeners, style, isDragging } = dragHandle;

  return (
    <>
      {/* Local keyframes for marquee + button micro-feedback. Scoped
          to memo cards so we don't pollute the global keyframe namespace. */}
      <style>{`
        @keyframes memoMarquee {
          0%   { transform: translateX(0); }
          15%  { transform: translateX(0); }
          85%  { transform: translateX(var(--memo-marquee-shift, -0px)); }
          100% { transform: translateX(var(--memo-marquee-shift, -0px)); }
        }
        @keyframes memoBtnPop {
          0%   { transform: scale(1); }
          40%  { transform: scale(0.9); }
          100% { transform: scale(1); }
        }
      `}</style>

      <div
        ref={setNodeRef}
        data-card
        data-card-id={item.id}
        onClick={handleCardClick}
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
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
          opacity: isDragging ? 0.4 : 1,
          boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
          ...(isJustAdded && !isDragging
            ? { animation: 'cardEnter 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both' }
            : {}),
        }}
        title={isEmpty ? '빈 메모 — 클릭해서 시작' : title}
      >
        {/* ── Top TTL bar — 3px, full-width status colour ───────
            Pinned: solid accent (no decay).
            Active: filled to `fraction`, rest is muted track. */}
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

        {/* ── Body (icon + title only) ─────────────────────────
            At the 82 px standard height, after subtracting the 3 px
            TTL bar and ~24 px action row, the body has ~55 px to
            work with. We give the title the full vertical centre and
            drop the body-preview line — too cramped, and the editor
            is one click away. The icon hint plus the title are
            sufficient identity; the marquee handles long titles. */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 10px',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {/* Icon (left, fixed). Pinned cards swap to a bookmark
              glyph so the badge is meaningful at a glance, not just
              the generic memo sticky icon. */}
          <div
            style={{
              flexShrink: 0,
              width: 22, height: 22,
              borderRadius: 6,
              background: 'var(--surface-hover)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon
              name={pinned ? 'bookmark' : 'sticky_note_2'}
              size={12}
              color={pinned ? 'var(--accent)' : 'var(--text-muted)'}
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
                // The marquee animation kicks in only when the
                // title overflows AND the card is hovered. Otherwise
                // the static text shows ellipsis via the parent's
                // overflow + textOverflow combo.
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
                  background: 'linear-gradient(to right, transparent, var(--surface))',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>

        {/* ── Action row (3 buttons) ───────────────────────────
            Layout: ● colored TTL circle (no label, just status hue) /
            📋 copy / 💾 save-as. Click is bubble-stopped via
            data-memo-control so the outer card click (open editor)
            doesn't fire when the user hits an action. */}
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
          {/* TTL refresh — pure colored circle, no label/icon. The
              colour itself encodes the urgency (green / amber / red),
              and the tooltip carries the precise count. Disabled for
              pinned memos but they shouldn't exist in v2 (pin button
              removed) — kept as defensive guard for migrated data. */}
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
                width: 12, height: 12,
                borderRadius: '50%',
                background: status,
                boxShadow: `0 0 0 2px color-mix(in srgb, ${status} 22%, transparent)`,
                transition: 'background 0.3s, box-shadow 0.3s',
              }}
            />
          </ActionBtn>

          {/* 복사 — body to clipboard */}
          <ActionBtn
            data-memo-control
            onClick={handleCopy}
            title="본문을 클립보드에 복사"
            color={copyFlash ? 'var(--accent)' : undefined}
            divider="right"
            flashing={copyFlash}
          >
            <Icon name={copyFlash ? 'check' : 'content_copy'} size={11} />
          </ActionBtn>

          {/* 다른 이름으로 저장 — exports the memo body to a real
              .txt file via main process. Replaces the v1 pin button
              (영구 보관 was conceptually fighting the auto-fade
              story; saving to a real file is the natural "I want this
              forever" exit ramp). */}
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

        {/* Bottom space-color stripe stays as parity with regular cards
            — placed AFTER the action row so it sits on the very edge,
            not bisected by the row's top border. */}
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
        // Carve a tiny per-button hover affordance — without it the
        // 3 cells feel like a static strip instead of pressable
        // buttons.
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
