/**
 * MemoCard — inner body of a `type === 'memo'` LauncherItem.
 *
 * Renders inside ItemCard's wrapper (drag, context menu, pin) — same
 * pattern as MediaWidget / ColorSwatchWidget. ItemCard hands us the
 * drag handle bindings; we own the body markup and click semantics.
 *
 * Click model:
 *   - Click body → onOpenEditor (the inplace sheet — NOT launch)
 *   - Hover top-right copy icon → onCopy (clipboard, with toast feedback)
 *   - Hover bottom-right "톡" dot → onExtend (TTL reset)
 *
 * Visual:
 *   - Body preview (3 lines, line-clamp), title is the first non-empty line
 *   - TTL gauge at bottom: 7 pips for ≤7 day TTL, thin progress bar for 14d+
 *   - Pinned: gauge replaced with a small "보관 중" pill
 *   - Soon-to-expire (≤24h): subtle yellow pulse on the gauge
 *
 * Why a separate file:
 *   - Memo body has different layout (top-aligned text block vs. centred icon)
 *   - Click intent is different (open editor vs. launch)
 *   - Keeps ItemCard.tsx from growing past 1500 lines for one feature
 */

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { LauncherItem, Space } from '../types';
import { useSortable } from '@dnd-kit/sortable';
import {
  memoTitleFromBody,
  memoBodyPreview,
  memoDaysLeft,
  memoHoursLeft,
  memoGaugeFraction,
  memoIsExpiringSoon,
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
  isJustAdded: boolean;
}

const GAUGE_PIPS = 7;

export function MemoCard({
  item, space, dragHandle, pinned,
  onOpenEditor, onCopy, onExtend, isJustAdded,
}: MemoCardProps) {
  const [hovered, setHovered] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);

  const memo = item.memo;
  const body = memo?.body ?? '';
  const title = memoTitleFromBody(body);
  const preview = memoBodyPreview(body, 3);
  const isEmpty = !body.trim();

  const now = Date.now();
  const daysLeft = memoDaysLeft(item, now);
  const hoursLeft = memoHoursLeft(item, now);
  const fraction = memoGaugeFraction(item, now);
  const expiringSoon = memoIsExpiringSoon(item, now);

  // Total-life heuristic: number of pips reflects the original TTL
  // bucket. <=7d → individual pips; 14d+ → continuous bar (clearer at
  // long horizons since 30 separate pips would be illegible).
  const totalDays = memo ? Math.max(1, Math.round((memo.expiresAt - memo.lastTouchedAt) / (24 * 60 * 60 * 1000))) : 7;
  const useBarMode = totalDays > 7;

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't open editor if user clicked on a control (copy / dot).
    const target = e.target as HTMLElement;
    if (target.closest('[data-memo-control]')) return;
    onOpenEditor();
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCopy();
    setCopyFlash(true);
    setTimeout(() => setCopyFlash(false), 800);
  };

  const handleExtend = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExtend();
  };

  const { setNodeRef, attributes, listeners, style, isDragging } = dragHandle;

  // Subdued color for trashed (shouldn't normally render — caller filters
  // them out — but defensive in case).
  const isTrashed = !!memo?.trashedAt;

  return (
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
        padding: '10px 10px 14px 10px',
        position: 'relative',
        cursor: 'pointer',
        userSelect: 'none',
        minHeight: 82,
        display: 'flex', flexDirection: 'column', gap: 4,
        transition: 'all 0.15s ease-out',
        opacity: isDragging ? 0.4 : (isTrashed ? 0.5 : 1),
        ...(isJustAdded && !isDragging
          ? { animation: 'cardEnter 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both' }
          : {}),
      }}
      className="group"
    >
      {/* Pin badge — same position/style as ItemCard so cards feel uniform */}
      {pinned && (
        <Icon
          name="bookmark"
          size={11}
          color="var(--accent)"
          style={{ position: 'absolute', top: 3, right: 5, opacity: 0.55, transition: 'opacity 0.15s' }}
          className="group-hover:!opacity-90"
        />
      )}

      {/* Hover-only copy icon (top-right, slightly inboard from pin) */}
      <button
        data-memo-control
        onClick={handleCopy}
        title="본문 복사"
        style={{
          position: 'absolute',
          top: 4,
          right: pinned ? 22 : 5,
          width: 18, height: 18, borderRadius: 4,
          background: copyFlash ? 'var(--accent)' : 'transparent',
          border: 'none',
          color: copyFlash ? '#fff' : 'var(--text-muted)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: hovered || copyFlash ? 0.85 : 0,
          transition: 'opacity 0.12s, background 0.18s, color 0.18s',
          padding: 0,
          zIndex: 2,
        }}
      >
        <Icon name={copyFlash ? 'check' : 'content_copy'} size={11} />
      </button>

      {/* Title (first non-empty line) */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.25,
          color: isEmpty ? 'var(--text-dim)' : 'var(--text-color)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          paddingRight: 28,  // leave room for copy icon
        }}
      >
        {isEmpty ? '(빈 메모)' : title}
      </div>

      {/* Body preview (≤3 more lines) */}
      {preview && (
        <div
          style={{
            fontSize: 10.5,
            lineHeight: 1.35,
            color: 'var(--text-muted)',
            overflow: 'hidden',
            // 3-line clamp via webkit (works in Chrome/Electron)
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            whiteSpace: 'pre-line',
            flex: 1,
          }}
        >
          {preview}
        </div>
      )}

      {/* Filler so cards without preview still claim the same min-height */}
      {!preview && <div style={{ flex: 1 }} />}

      {/* TTL gauge / pinned pill — bottom row */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 9,
          color: 'var(--text-dim)',
          marginTop: 2,
        }}
      >
        {pinned ? (
          <>
            <Icon name="bookmark" size={9} color="var(--accent)" />
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>보관 중</span>
          </>
        ) : isTrashed ? (
          <>
            <Icon name="delete" size={9} />
            <span>휴지통</span>
          </>
        ) : useBarMode ? (
          <>
            <div
              style={{
                flex: 1, height: 3,
                borderRadius: 2,
                background: 'var(--border-rgba)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${Math.max(2, fraction * 100)}%`,
                  height: '100%',
                  background: expiringSoon ? '#f5b800' : 'var(--text-muted)',
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <span style={{ flexShrink: 0, color: expiringSoon ? '#f5b800' : 'var(--text-dim)' }}>
              {daysLeft === 0 ? '곧 만료' : daysLeft === null ? '' : `${daysLeft}일`}
            </span>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              {Array.from({ length: GAUGE_PIPS }).map((_, i) => {
                const litPipCount = Math.max(0, Math.min(GAUGE_PIPS, Math.ceil(fraction * GAUGE_PIPS)));
                const lit = i < litPipCount;
                return (
                  <span
                    key={i}
                    style={{
                      width: 4, height: 4, borderRadius: '50%',
                      background: lit
                        ? (expiringSoon && i === litPipCount - 1 ? '#f5b800' : 'var(--text-muted)')
                        : 'var(--border-rgba)',
                      transition: 'background 0.3s',
                    }}
                  />
                );
              })}
            </div>
            <span
              style={{
                color: expiringSoon ? '#f5b800' : 'var(--text-dim)',
                fontWeight: expiringSoon ? 600 : 400,
              }}
            >
              {daysLeft === 0
                ? (hoursLeft && hoursLeft > 0 ? `${hoursLeft}시간` : '곧 만료')
                : `${daysLeft}일`}
            </span>
          </>
        )}

        {/* "톡" — TTL reset dot. Hidden when pinned (no TTL) or trashed. */}
        {!pinned && !isTrashed && (
          <button
            data-memo-control
            onClick={handleExtend}
            title="살리기 — 수명을 다시 가득 채웁니다"
            style={{
              marginLeft: 'auto',
              width: 14, height: 14, borderRadius: '50%',
              background: 'transparent',
              border: '1px solid var(--border-rgba)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
              opacity: hovered ? 1 : 0.5,
              transition: 'opacity 0.12s, background 0.12s, border-color 0.12s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--accent-dim)';
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border-rgba)';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            <Icon name="add" size={9} />
          </button>
        )}
      </div>

      {/* Bottom stripe — space color (parity with ItemCard) */}
      {space.color && (
        <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ background: space.color, opacity: 0.55 }} />
      )}
    </div>
  );
}
