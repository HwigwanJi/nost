/**
 * MemoExpiringBanner — small 1-line banner shown above the grid when
 * one or more active memos will expire in the next 24 hours.
 *
 * Per spec ("결정 4"): single line, dismissable. Doesn't reappear once
 * the user closes it for the day. Click "지금 보기" focuses the first
 * expiring memo's space to scroll it into view.
 *
 * Design intent: gives "soon-to-fade" memos one chance to be saved
 * without becoming a bossy notification system. If the user ignores
 * it, the memos quietly fade away — that's the whole point.
 */

import { Icon } from '@/components/ui/Icon';

interface MemoExpiringBannerProps {
  count: number;
  onView: () => void;
  onDismiss: () => void;
}

export function MemoExpiringBanner({ count, onView, onDismiss }: MemoExpiringBannerProps) {
  if (count <= 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 12px',
        margin: '0 0 8px 0',
        borderRadius: 8,
        background: 'var(--surface)',
        border: '1px solid var(--border-rgba)',
        fontSize: 11.5,
        color: 'var(--text-color)',
      }}
    >
      <Icon name="schedule" size={13} color="#f5b800" />
      <span style={{ flex: 1 }}>
        오늘 사라질 메모 <strong style={{ color: '#f5b800' }}>{count}개</strong>가 있어요.
      </span>
      <button
        onClick={onView}
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: '3px 9px',
          borderRadius: 5,
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          border: '1px solid var(--accent)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        지금 보기
      </button>
      <button
        onClick={onDismiss}
        title="오늘은 그만 보기"
        style={{
          width: 18, height: 18,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 4,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <Icon name="close" size={11} />
      </button>
    </div>
  );
}
