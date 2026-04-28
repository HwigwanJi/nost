import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import { electronAPI } from '../electronBridge';
import { useMediaState } from './useMediaState';
import type { LauncherItem } from '../types';

/**
 * MediaWidget — 2-slot card (gridColumn: span 2) showing the OS
 * media-control state.
 *
 * Renders for items with `type === 'widget'` and `widget.kind ===
 * 'media-control'`. The component is intentionally NOT a wrapper
 * around ItemCard — widgets don't launch, don't pin, don't edit-via-
 * dialog, don't paywall on click; they have their own minimal
 * surface. ItemCard delegates entirely when it sees a widget.
 *
 * Why React.memo: SMTC fires timeline events frequently (sub-second
 * during playback). Without memo, sibling cards in the same space
 * re-render on every position tick because the parent grid re-renders.
 * The widget itself still re-renders — it has to — but its neighbours
 * stay still.
 *
 * Position extrapolation:
 *   The native bridge pushes a fresh `lastUpdated` + `position`
 *   whenever SMTC fires a timeline event, but those events come a few
 *   times per minute, not per second. To make the progress bar move
 *   smoothly between events, we extrapolate locally: while playing,
 *   `position = serverPosition + (now - serverLastUpdated)`. This is
 *   an estimate (real playback rate isn't 1.0 if the user changed
 *   playback speed in YouTube) but it's good enough for a widget UI
 *   and zero IPC traffic.
 */

interface Props {
  item: LauncherItem;
  // We keep the same dnd handle/listeners interface as ItemCard so the
  // widget participates in card reordering. The parent (ItemCard)
  // forwards these from useSortable.
  // We accept dnd-kit's actual types via `unknown`-friendly any so the
  // call site can spread useSortable() output directly without coercion.
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

function MediaWidgetImpl({ item, dragHandle, onContextMenu }: Props) {
  const state = useMediaState();
  const session = state.session;

  // ── Local position tick ───────────────────────────────────
  // Increment a counter every 500ms while playing, used only as a
  // re-render trigger for the progress bar. We DON'T store the
  // extrapolated position in state — derived from session +
  // performance.now diff every render so there's no drift between
  // server pushes and our local clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!session?.isPlaying) return;
    const id = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, [session?.isPlaying]);

  // ── Optimistic play state ─────────────────────────────────
  // Pressing play/pause causes the SMTC update to lag by 50–300ms
  // on YouTube. Without optimistic flip the button looks unresponsive.
  // We override `isPlaying` for ~600ms after a click, then defer to
  // the server state again.
  const [optimisticPlaying, setOptimisticPlaying] = useState<boolean | null>(null);
  const optimisticUntilRef = useRef(0);
  useEffect(() => {
    if (!session) return;
    // Server caught up — clear the override.
    if (optimisticPlaying !== null && session.isPlaying === optimisticPlaying) {
      setOptimisticPlaying(null);
    }
  }, [session?.isPlaying, optimisticPlaying]);
  useEffect(() => {
    // Safety: if the server NEVER catches up (e.g. command was eaten
    // by a focused app that doesn't accept media keys), drop the
    // override after the timeout window.
    if (optimisticPlaying === null) return;
    const remaining = Math.max(0, optimisticUntilRef.current - Date.now());
    const t = setTimeout(() => setOptimisticPlaying(null), remaining + 50);
    return () => clearTimeout(t);
  }, [optimisticPlaying]);

  const isPlayingDisplay = optimisticPlaying ?? session?.isPlaying ?? false;

  // ── Derived progress ──────────────────────────────────────
  let progressMs = 0;
  let durationMs = 0;
  if (session) {
    durationMs = session.duration;
    if (session.isPlaying) {
      progressMs = session.position + (Date.now() - session.lastUpdated);
    } else {
      progressMs = session.position;
    }
    progressMs = Math.max(0, Math.min(durationMs || progressMs, progressMs));
  }
  const progressPct = durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0;

  // ── Handlers ──────────────────────────────────────────────
  const fireCommand = (action: 'play-pause' | 'next' | 'prev') => {
    electronAPI.mediaCommand(action);
    if (action === 'play-pause' && session) {
      setOptimisticPlaying(!session.isPlaying);
      optimisticUntilRef.current = Date.now() + 600;
    }
  };

  // ── Render branches ───────────────────────────────────────
  const accent = item.color || '#a855f7';
  const baseColor = 'var(--text-color)';

  // dnd handle — when undefined (shouldn't be in practice; ItemCard
  // always provides it), fall back to a static container.
  const handleProps = dragHandle ? {
    ref: dragHandle.setNodeRef,
    style: { ...dragHandle.style, opacity: dragHandle.isDragging ? 0.4 : 1 },
    ...dragHandle.attributes,
    ...dragHandle.listeners,
  } : { style: {} };

  const wrapStyle: CSSProperties = {
    ...(handleProps.style as CSSProperties),
    gridColumn: 'span 2',     // 2 slots wide in the auto-fill grid
    minHeight: 84,
    background: 'var(--surface)',
    border: '1px solid var(--border-rgba)',
    borderRadius: 12,
    padding: 8,
    display: 'flex',
    gap: 10,
    alignItems: 'stretch',
    cursor: 'grab',
    overflow: 'hidden',
    position: 'relative',
  };

  // ── Idle / unsupported state ─────────────────────────────
  if (!state.supported) {
    return (
      <div {...handleProps} style={wrapStyle} onContextMenu={onContextMenu}>
        <FallbackPanel
          icon="error_outline"
          title="지원되지 않음"
          body="Windows 10 1809 이상 필요"
          accent={accent}
        />
      </div>
    );
  }

  if (!session) {
    return (
      <div {...handleProps} style={wrapStyle} onContextMenu={onContextMenu}>
        <FallbackPanel
          icon="music_off"
          title={item.title || '미디어'}
          body="재생 중인 미디어 없음"
          accent={accent}
        />
      </div>
    );
  }

  // ── Active session ──────────────────────────────────────
  return (
    <div {...handleProps} style={wrapStyle} onContextMenu={onContextMenu}>
      {/* Cover / fallback icon */}
      <div style={{
        width: 64, height: 64,
        borderRadius: 8,
        flexShrink: 0,
        background: session.thumb
          ? `url(${session.thumb}) center/cover no-repeat`
          : `linear-gradient(135deg, ${accent}aa, ${accent}55)`,
        position: 'relative',
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
      }}>
        {!session.thumb && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="music_note" size={28} color="#fff" />
          </div>
        )}
      </div>

      {/* Right column: title + artist + controls */}
      <div style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 11.5, fontWeight: 700, color: baseColor,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            letterSpacing: '-0.01em',
          }}>
            {session.title || '제목 없음'}
          </div>
          <div style={{
            fontSize: 10, color: 'var(--text-muted)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            marginTop: 1,
          }}>
            {session.artist || session.sourceAppId || '—'}
          </div>
        </div>

        {/* Controls + progress */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
            <ControlBtn icon="skip_previous" onClick={() => fireCommand('prev')} title="이전 트랙" />
            <ControlBtn
              icon={isPlayingDisplay ? 'pause' : 'play_arrow'}
              onClick={() => fireCommand('play-pause')}
              title={isPlayingDisplay ? '일시 정지' : '재생'}
              accent={accent}
              size="lg"
            />
            <ControlBtn icon="skip_next" onClick={() => fireCommand('next')} title="다음 트랙" />
          </div>
          {/* Progress bar — shows even when duration is 0 (just stays empty
              and that's OK; the bar is a visual aid not a control yet) */}
          <div style={{
            marginTop: 4,
            height: 2,
            background: 'var(--border-rgba)',
            borderRadius: 1,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progressPct}%`,
              height: '100%',
              background: accent,
              transition: session.isPlaying ? 'width 500ms linear' : 'width 0ms',
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Memoised to avoid re-rendering when sibling cards re-render. The
// dragHandle prop changes object identity each render of ItemCard, so
// shallow-equality memo is intentionally bypassed via custom compare.
export const MediaWidget = memo(MediaWidgetImpl, (prev, next) =>
  prev.item === next.item &&
  prev.dragHandle?.isDragging === next.dragHandle?.isDragging
);

// ── Sub-components ──────────────────────────────────────────────────

function ControlBtn({ icon, onClick, title, accent, size = 'md' }: {
  icon: string;
  onClick: () => void;
  title: string;
  accent?: string;
  size?: 'md' | 'lg';
}) {
  const dim = size === 'lg' ? 28 : 22;
  const iconSize = size === 'lg' ? 18 : 14;
  return (
    <button
      onClick={(e) => {
        // The grid container is itself the dnd-kit listener target;
        // stop propagation so a click on the button doesn't start a drag.
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={title}
      style={{
        width: dim, height: dim,
        borderRadius: dim / 2,
        background: accent ? `${accent}22` : 'transparent',
        border: 'none',
        color: accent ?? 'var(--text-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        transition: 'background 120ms ease, transform 120ms ease',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = accent
          ? `${accent}44` : 'var(--bg-rgba)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = accent
          ? `${accent}22` : 'transparent';
      }}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

function FallbackPanel({ icon, title, body, accent }: {
  icon: string; title: string; body: string; accent: string;
}) {
  return (
    <>
      <div style={{
        width: 64, height: 64,
        borderRadius: 8,
        flexShrink: 0,
        background: `linear-gradient(135deg, ${accent}33, ${accent}11)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: accent,
      }}>
        <Icon name={icon} size={26} />
      </div>
      <div style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
      }}>
        <div style={{
          fontSize: 11.5, fontWeight: 700, color: 'var(--text-color)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{body}</div>
      </div>
    </>
  );
}
