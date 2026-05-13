/**
 * NotificationPanel — list rendered inside the bell's popover.
 *
 * Renders one row per active notification. Each row has:
 *   - kind icon + accent (calm; only the icon carries color, not the
 *     whole row, so a stack of 5 doesn't look chromatic)
 *   - title (one line, ellipsised at 1 line)
 *   - body (≤2 lines, line-clamp)
 *   - optional [action button] — fires `onAction(n)`
 *   - ✕ to dismiss (right-aligned, hover-only on individual rows)
 *
 * Footer: "모두 비우기" — only when there's ≥ 2 items.
 *
 * Empty state: a quiet line. Earned: this panel's whole job is to
 * usually be empty.
 */

import { Icon } from '@/components/ui/Icon';
import type { AppNotification } from '../types';

interface NotificationPanelProps {
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onAction: (n: AppNotification) => void;
}

// Kind colors map to existing design tokens — no new semantic vars introduced.
//   update     → text-color  (strong contrast, theme-aware)
//   billing    → destructive (the one saturated token we have)
//   discovery  → --accent    (user-customised brand colour)
//   system     → destructive (shares colour with billing; the icon disambiguates)
//   tip        → text-muted  (the calmest of all kinds)
const KIND_META: Record<AppNotification['kind'], { icon: string; tokenCSS: string; label: string }> = {
  update:    { icon: 'system_update',     tokenCSS: 'var(--text-color)',        label: '업데이트' },
  billing:   { icon: 'workspace_premium', tokenCSS: 'var(--color-destructive)', label: '프로' },
  discovery: { icon: 'lightbulb',         tokenCSS: 'var(--accent)',            label: '발견' },
  system:    { icon: 'error_outline',     tokenCSS: 'var(--color-destructive)', label: '시스템' },
  tip:       { icon: 'tips_and_updates',  tokenCSS: 'var(--text-muted)',        label: '팁' },
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / (60 * 1000));
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function NotificationPanel({ notifications, onDismiss, onDismissAll, onAction }: NotificationPanelProps) {
  if (notifications.length === 0) {
    return (
      <>
        <Header count={0} />
        <div
          style={{
            padding: '36px 16px',
            textAlign: 'center',
            color: 'var(--text-dim)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <Icon name="check_circle" size={20} color="var(--text-dim)" style={{ opacity: 0.5, display: 'block', margin: '0 auto 8px' }} />
          알림이 없어요.<br />
          <span style={{ fontSize: 11, opacity: 0.7 }}>평화롭네요.</span>
        </div>
      </>
    );
  }

  return (
    <>
      <Header count={notifications.length} onDismissAll={notifications.length >= 2 ? onDismissAll : undefined} />
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          // Subtle scrollbar — keep the panel feeling light.
          scrollbarWidth: 'thin',
        }}
      >
        {notifications.map((n, i) => (
          <Row
            key={n.id}
            n={n}
            isLast={i === notifications.length - 1}
            onDismiss={() => onDismiss(n.id)}
            onAction={() => onAction(n)}
          />
        ))}
      </div>
    </>
  );
}

function Header({ count, onDismissAll }: { count: number; onDismissAll?: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-rgba)',
        flexShrink: 0,
      }}
    >
      <Icon name="notifications" size={13} color="var(--text-muted)" />
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-color)' }}>
        알림 {count > 0 && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· {count}</span>}
      </span>
      {onDismissAll && (
        <button
          onClick={onDismissAll}
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: 4,
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-color)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          모두 비우기
        </button>
      )}
    </div>
  );
}

function Row({
  n, isLast, onDismiss, onAction,
}: {
  n: AppNotification;
  isLast: boolean;
  onDismiss: () => void;
  onAction: () => void;
}) {
  const meta = KIND_META[n.kind];
  const isUnread = !n.readAt;

  return (
    <div
      className="group"
      style={{
        position: 'relative',
        display: 'flex',
        gap: 10,
        padding: '12px 12px 12px 14px',
        borderBottom: isLast ? 'none' : '1px solid var(--border-rgba)',
        // Unread cards get a subtle accent bar on the left edge —
        // calmer than a tinted background which would shout.
        background: 'transparent',
      }}
    >
      {/* Unread strip */}
      {isUnread && (
        <span
          style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0,
            width: 2,
            background: 'var(--accent)',
            opacity: 0.7,
          }}
        />
      )}

      {/* Kind icon */}
      <div
        style={{
          flexShrink: 0,
          width: 22, height: 22,
          borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${meta.tokenCSS} 12%, transparent)`,
        }}
      >
        <Icon name={meta.icon} size={12} color={meta.tokenCSS} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-color)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.35,
          }}
        >
          {n.title}
        </div>
        {n.body && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginTop: 2,
              lineHeight: 1.4,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {n.body}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          {n.action && (
            <button
              onClick={onAction}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--accent)',
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent)',
                borderRadius: 5,
                padding: '3px 9px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {n.action.label}
            </button>
          )}
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {relativeTime(n.createdAt)}
          </span>
        </div>
      </div>

      {/* Dismiss button — visible on row hover. (Keeping it always-
          visible felt cluttered with 3+ rows.) */}
      <button
        onClick={onDismiss}
        title="이 알림 지우기"
        className="opacity-0 group-hover:opacity-80"
        style={{
          flexShrink: 0,
          width: 18, height: 18,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          alignSelf: 'flex-start',
          transition: 'opacity 0.15s, background 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <Icon name="close" size={11} />
      </button>
    </div>
  );
}
