/**
 * NotificationBell — top-bar bell icon + unread dot.
 *
 * Tone follows the launcher principle: calm by default, no flashing.
 * The dot is a *single* 6px circle that turns on when there's at
 * least one undismissed notification with `readAt` undefined. We
 * deliberately don't render an unread COUNT — counts make the user
 * feel obligated. A dot says "something's here, when you have a
 * moment" and that's enough.
 *
 * Click opens NotificationPanel as a popover anchored below the
 * bell. Reading the popover (mounting it) is what flips notifications
 * to read — there's no "mark as read" button. Dismiss is explicit.
 *
 * Why not radix Popover: we want the popover to close on backdrop
 * click but the underlying app should NOT lose focus (search bar
 * etc.). A simple controlled-state + portal-rendered backdrop fits
 * better than radix's focus-trap default.
 */

import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import type { AppNotification } from '../types';
import { NotificationPanel } from './NotificationPanel';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface NotificationBellProps {
  notifications: AppNotification[];
  open: boolean;
  onToggle: () => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onMarkAllRead: () => void;
  onAction: (n: AppNotification) => void;
}

export function NotificationBell({
  notifications, open, onToggle,
  onDismiss, onDismissAll, onMarkAllRead, onAction,
}: NotificationBellProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const active = notifications.filter(n => !n.dismissedAt);
  const hasUnread = active.some(n => !n.readAt);

  // Active only while the popover is open. ESC closes JUST the popover
  // (not the app, not a tool mode underneath). Stacked behind any
  // modal that opens on top of us — last-pushed wins.
  useEscapeKey(onToggle, open);

  // Mark all as read when the panel opens. Reading IS opening — same
  // pattern as Slack/GitHub. Dismissing remains a separate explicit
  // action (per-row ✕ or "모두 비우기").
  useEffect(() => {
    if (open && hasUnread) {
      // Defer one tick so the panel's open animation isn't fighting
      // the badge's disappear animation.
      const t = setTimeout(onMarkAllRead, 50);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Anchor coords for the panel. Computed at render time using the
  // bell's bounding box so it follows window/scroll changes.
  const rect = buttonRef.current?.getBoundingClientRect();

  return (
    <>
      <button
        ref={buttonRef}
        onClick={onToggle}
        title={`알림 ${active.length}건${hasUnread ? ' (안 읽음)' : ''}`}
        style={{
          position: 'relative',
          width: 28, height: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'var(--surface-hover)' : 'transparent',
          border: 'none',
          borderRadius: 7,
          cursor: 'pointer',
          color: 'var(--text-muted)',
          transition: 'background 0.12s, color 0.12s',
          fontFamily: 'inherit',
        }}
        onMouseEnter={e => {
          if (!open) e.currentTarget.style.background = 'var(--surface-hover)';
          e.currentTarget.style.color = 'var(--text-color)';
        }}
        onMouseLeave={e => {
          if (!open) e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-muted)';
        }}
      >
        <Icon name={hasUnread ? 'notifications' : 'notifications_none'} size={16} />
        {hasUnread && (
          <span
            // The unread dot. Single 6px accent circle, top-right.
            // Intentionally smaller than a badge — enough to notice
            // but not enough to nag.
            style={{
              position: 'absolute',
              top: 5,
              right: 6,
              width: 6, height: 6,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 0 1.5px var(--surface)',
              pointerEvents: 'none',
            }}
          />
        )}
      </button>

      {/* Popover via portal so it escapes any clipping ancestors */}
      {open && rect && createPortal(
        <>
          {/* Invisible backdrop — click closes panel without stealing
              focus from underlying inputs */}
          <div
            onMouseDown={onToggle}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9100,
            }}
          />
          <div
            // Position: aligned to bell's right edge, ~6px below.
            // Width 320 is the smallest comfortable size for two
            // lines of body text + action button.
            style={{
              position: 'fixed',
              top: rect.bottom + 6,
              right: Math.max(8, window.innerWidth - rect.right),
              zIndex: 9101,
              width: 320,
              maxHeight: 'min(440px, 70vh)',
              // var(--surface) is a 3–5% alpha tint meant for in-grid
              // panels; on a popover floating over the main view it
              // reads as "completely transparent" and the user can't
              // see the content. var(--bg-rgba) is the app's actual
              // surface (95–96% alpha) — same fix MemoEditor already
              // got for the same reason.
              background: 'var(--bg-rgba)',
              border: '1px solid var(--border-rgba)',
              borderRadius: 12,
              boxShadow: '0 16px 48px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.04)',
              animation: 'notifPanelIn 0.18s cubic-bezier(0.34, 1.4, 0.64, 1)',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <NotificationPanel
              notifications={active}
              onDismiss={onDismiss}
              onDismissAll={onDismissAll}
              onAction={onAction}
            />
          </div>

          {/* One-shot keyframe scoped to the popover */}
          <style>{`
            @keyframes notifPanelIn {
              from { opacity: 0; transform: translateY(-4px) scale(0.98); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>
        </>,
        document.body,
      )}
    </>
  );
}
