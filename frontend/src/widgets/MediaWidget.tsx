import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Slider } from '@/components/ui/slider';
import { electronAPI } from '../electronBridge';
import { useAppActions } from '../contexts/AppContext';
import type { LauncherItem, Space } from '../types';

/**
 * MediaWidget — always-on media control panel.
 *
 * Design history:
 *   v1: Full SMTC NowPlaying read — froze on YouTube startup. Dropped.
 *   v2-v3: Coloured pill / dense single row — broke height & overflowed.
 *   v4-v5: 2-row centred buttons, filled icons — better, but volume row
 *          was 3 tiny ± / mute buttons, awkward to scrub.
 *   v6 (this): Replaced volume button cluster with a horizontal slider +
 *          state-adaptive mute icon. Drag the slider to scrub volume,
 *          tap the icon to toggle mute. Same standard card height.
 *
 * Layout (≈ 82 px tall, span-2 wide):
 *   ┌──────────────────────────────────────────┐
 *   │ •      ◀     [▶|⏸]     ▶                  │  ← transport row
 *   │   🔉  [━━━●━━━━━━━━━━]                    │  ← volume slider row
 *   └──────────────────────────────────────────┘
 *
 * Volume model (local-only — we don't read system volume yet):
 *   - vol: 0–100 estimate of system master volume. Initial 50.
 *   - muted: tracks our toggle state.
 *   - User action → we send N media keys (each = ~2% step on Windows
 *     default mixer) and locally update vol/muted.
 *   - State-adaptive icon: volume_off (muted) / volume_mute (≤ 5) /
 *     volume_down (≤ 50) / volume_up (> 50).
 *
 * Drift caveat: if the user changes volume via the taskbar speaker
 * or a hardware key, our slider stays at its old estimate. Acceptable
 * trade-off until we add real WASAPI read (separate work, requires
 * COM-binding via koffi or a dedicated npm package).
 *
 * Right-click drag bug fix:
 *   The wrapper carries `data-card` so useWindowDrag (the hook that
 *   moves the OS window on right-click empty-area drag) skips it.
 *   Without this, right-clicking the widget would slide the whole
 *   nost window instead of starting a card-reorder drag.
 *
 * Colour cascade (no hardcoded hex):
 *   item.color → space.color → resolved var(--accent)
 *   color-mix() needs literal values, so we resolve --accent at mount.
 */

interface Props {
  item: LauncherItem;
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

type MediaAction = 'play-pause' | 'next' | 'prev' | 'vol-up' | 'vol-down' | 'mute';

// Each Windows VK_VOLUME_UP / DOWN press changes the master volume by
// roughly 2 percentage points (default mixer step). When the user
// drags the slider by N points, we send N/2 keypresses.
const VOL_STEP = 2;
// Slight stagger between rapid keypresses so Windows can process each
// one — sending 25+ in a single tick has been observed to drop some.
const KEY_STAGGER_MS = 18;

function MediaWidgetImpl({ item, space, dragHandle, onContextMenu }: Props) {
  const { showToast } = useAppActions();
  // ── Right-click drag (matches ItemCard) ────────────────────────
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

  const fire = useCallback((action: MediaAction) => {
    electronAPI.mediaCommand(action);
  }, []);

  /**
   * Click on the wrapper (not on a control button — those stop
   * propagation) → ask main to bring the audible browser tab to
   * front. The Chrome / Whale extension reports `audible: true`
   * for tabs currently playing sound; main forwards a focus
   * action over the existing SSE channel.
   *
   * Caveats:
   *   - Only works when the nost-bridge extension is installed.
   *   - Native media apps (Spotify desktop, foobar2000, …) aren't
   *     visible to us — those would need SMTC / WASAPI, both of
   *     which were intentionally punted after the YouTube freeze.
   * In either case we silently no-op (no toast spam).
   */
  const handleWrapperClick = useCallback(async (e: React.MouseEvent) => {
    // Only react to bare clicks on the surface itself. Control
    // buttons all `e.stopPropagation()` in their own handlers, so
    // by the time we see the event here, it's a "click on the card
    // chrome" gesture.
    if (e.defaultPrevented) return;
    try {
      await electronAPI.mediaFocusSource();
      // We don't toast on null — that would fire on every blank
      // click and become noise. Success is silently the focus jump.
    } catch { /* ignore — best-effort */ }
  }, []);

  // ── Volume state (local estimate) ─────────────────────────────
  const [vol, setVol] = useState(50);
  const [muted, setMuted] = useState(false);

  /** Send N keypresses to bridge a delta, then update local estimate. */
  const fireVolDelta = useCallback((delta: number) => {
    if (delta === 0) return;
    const action: MediaAction = delta > 0 ? 'vol-up' : 'vol-down';
    const count = Math.max(1, Math.round(Math.abs(delta) / VOL_STEP));
    for (let i = 0; i < count; i++) {
      setTimeout(() => electronAPI.mediaCommand(action), i * KEY_STAGGER_MS);
    }
    setVol(v => Math.max(0, Math.min(100, Math.round(v + delta))));
  }, []);

  const handleMute = useCallback(() => {
    electronAPI.mediaCommand('mute');
    setMuted(m => {
      const next = !m;
      showToast(next ? '음소거' : '음소거 해제', { duration: 900 });
      return next;
    });
  }, [showToast]);

  /**
   * Slider drag handler. Slider always presents the "intended" volume,
   * so dragging while muted implicitly unmutes — that matches user
   * intent ("I want this loud" implies "not muted").
   */
  const handleSliderChange = useCallback((values: number | readonly number[]) => {
    const newVol = Array.isArray(values) ? values[0] : (values as number);
    if (muted) {
      electronAPI.mediaCommand('mute');
      setMuted(false);
    }
    fireVolDelta(newVol - vol);
  }, [vol, muted, fireVolDelta]);

  // ── Mute icon adapts to state ─────────────────────────────────
  const muteIcon =
    muted          ? 'volume_off' :
    vol <= 5       ? 'volume_mute' :   // very low — almost silent
    vol <= 50      ? 'volume_down' :
                     'volume_up';

  // ── Colour cascade ────────────────────────────────────────────
  const [resolvedAccent, setResolvedAccent] = useState('#6366f1');
  useEffect(() => {
    if (item.color || space?.color) return;
    const cs = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim();
    if (cs) setResolvedAccent(cs);
  }, [item.color, space?.color]);
  const accent = item.color || space?.color || resolvedAccent;

  // ── Render ────────────────────────────────────────────────────
  const handleProps = dragHandle ? {
    ref: dragHandle.setNodeRef,
    style: { ...dragHandle.style, opacity: dragHandle.isDragging ? 0.4 : 1 },
    ...dragHandle.attributes,
  } : { style: {} };

  const wrapStyle: CSSProperties = {
    ...(handleProps.style as CSSProperties),
    // Single grid cell — keeps the widget visually parallel with
    // every other card in the space. Earlier versions tried span-2
    // for breathing room but the result drifted away from the grid
    // rhythm; the controls fit a 1-cell width fine because each
    // glyph is filled and reads well at small size.
    minHeight: 82,                      // matches standard card height
    background: 'var(--surface)',
    border: '1px solid var(--border-rgba)',
    borderRadius: 12,                   // matches ItemCard's rounded-xl
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 6,
    cursor: 'grab',
    overflow: 'hidden',
    position: 'relative',
    transition: 'border-color 120ms ease, background 120ms ease',
  };

  return (
    <>
      <style>{`
        .nost-mw-btn {
          transition:
            transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1),
            background 120ms ease,
            color 120ms ease,
            border-color 120ms ease,
            box-shadow 120ms ease;
        }
        /* Press-feedback for ghost / repeat buttons. Excluded from
           the pill via :not(.nost-mw-pill) — the pill needs its own
           inline transform (rubber-band translateX) and !important
           on a class-level rule would defeat it, pinning the pill
           in place during drag. */
        .nost-mw-btn:not(.nost-mw-pill):active {
          transform: scale(0.86) !important;
          transition-duration: 60ms;
        }
        /* Slider sizing inside the widget — keeps the track thin and
           the thumb proportionate to our 22px row. */
        .nost-mw-slider [data-slot="slider-track"]  { height: 3px; background: var(--border-rgba); }
        .nost-mw-slider [data-slot="slider-thumb"]  { width: 12px; height: 12px; }
      `}</style>
      <div
        {...handleProps}
        // CRITICAL: data-card lets the global useWindowDrag hook know
        // this region "belongs to a card" — without it, right-click
        // on the widget would start a window-move instead of a
        // card-reorder drag.
        data-card
        data-card-id={item.id}
        style={wrapStyle}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onClick={handleWrapperClick}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-focus)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-rgba)'; }}
      >
        {/* Top-left accent dot — silent affordance that this is a
            tinted thing, leaving the controls plenty of room. */}
        <span style={{
          position: 'absolute',
          top: 8, left: 10,
          width: 6, height: 6, borderRadius: '50%',
          background: accent,
          boxShadow: `0 0 5px ${accent}55`,
        }} />

        {/* Transport row — primary actions, larger filled glyphs. */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}>
          {/* The pill alone now carries all three transport actions
              via gesture: tap = play/pause, swipe-left release = prev,
              swipe-right release = next. Removing the dedicated
              skip buttons regained the horizontal room we needed for
              the volume slider without losing functionality. */}
          <PlayPauseGesturePill
            accent={accent}
            onPlayPause={() => { fire('play-pause'); showToast('재생 / 일시정지', { duration: 1100 }); }}
            onPrev={() => { fire('prev'); showToast('이전 트랙', { duration: 1100 }); }}
            onNext={() => { fire('next'); showToast('다음 트랙', { duration: 1100 }); }}
          />
        </div>

        {/* Volume row — state-adaptive icon button + slider. The icon
            occupies a fixed footprint so the slider sizes against the
            remaining flex space; this stays clean even when the
            grid column is narrower than typical. */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <button
            className="nost-mw-btn"
            onClick={(e) => { e.stopPropagation(); handleMute(); }}
            onPointerDown={(e) => e.stopPropagation()}
            title={muted ? '음소거 해제' : '음소거'}
            style={{
              width: 22, height: 22,
              borderRadius: 7,
              background: 'transparent',
              border: 'none',
              color: muted ? accent : 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'var(--bg-rgba)';
              if (!muted) el.style.color = 'var(--text-color)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'transparent';
              if (!muted) el.style.color = 'var(--text-muted)';
            }}
          >
            <Icon name={muteIcon} size={16} filled weight={500} />
          </button>
          {/* Slider stops pointer events from bubbling so a drag on
              the track doesn't accidentally start the card-drag. */}
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Slider
              className="nost-mw-slider"
              min={0}
              max={100}
              value={[muted ? 0 : vol]}
              onValueChange={handleSliderChange}
              aria-label="볼륨"
            />
          </div>
        </div>
      </div>
    </>
  );
}

export const MediaWidget = memo(MediaWidgetImpl, (prev, next) =>
  prev.item === next.item &&
  prev.space === next.space &&
  prev.dragHandle?.isDragging === next.dragHandle?.isDragging
);

// ── Sub-components ──────────────────────────────────────────────────

/**
 * The pill is now THREE actions in one gesture-driven primary
 * button:
 *   - tap (no movement)        → play/pause
 *   - press + drag left + release  → prev track
 *   - press + drag right + release → next track
 *
 * Threshold is 18 px — comfortable enough that small mouse jitter
 * doesn't trigger a track skip, tight enough that the user can
 * commit the gesture inside the pill without overshooting onto
 * neighbouring controls.
 *
 * During an active drag, we surface a faded ◀ / ▶ glyph on the
 * appropriate side so the user gets visual confirmation that nost
 * understood the direction. The play/pause glyphs fade out
 * symmetrically — a subtle "you're now in skip mode" affordance.
 */
function PlayPauseGesturePill({ accent, onPlayPause, onPrev, onNext }: {
  accent: string;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Gesture state machine + rubber-band visual:
  //
  //   - On pointer-down we capture the pointer ON the pill itself so
  //     pointermove / pointerup keep firing even if the user drags
  //     outside the button. Without setPointerCapture, releasing
  //     off-pill leaves the pill in its mid-drag state forever (the
  //     up never reached us, hint stays "next", no toast fires).
  //     This was the regression you saw.
  //   - On pointer-move we recompute the live `hint` AND a `dx`
  //     state used for visual translation. The pill physically
  //     follows the pointer (with resistance + max-pull clamping)
  //     so the gesture feels rubber-band-y. On release the dx
  //     resets and a CSS spring transition snaps it back.
  //   - On pointer-up, action decision uses the LIVE dx:
  //       (a) never crossed threshold       → tap → play/pause
  //       (b) released past threshold       → fire that direction
  //       (c) crossed once, came back home  → no-op (cancel)
  const dragRef = useRef<{ startX: number; everCommitted: boolean } | null>(null);
  const [hint, setHint] = useState<'prev' | 'next' | null>(null);
  // Live translation during drag — clamped, with resistance, so the
  // pill follows the pointer in a "rubber-band" feel without ever
  // breaking out of its row.
  const [dragDx, setDragDx] = useState(0);
  // While true, transform updates without transition (immediate
  // tracking). On release we flip to false so the snap-back animates.
  const trackingRef = useRef(false);

  const SWIPE_THRESHOLD = 18;
  // Visual movement is intentionally smaller than the swipe threshold
  // so the pill always stays inside the card's content box (1-cell
  // wrap is narrow — anything more than ~8 px hits the overflow:
  // hidden border and gets clipped). The user reads the gesture from
  // the hint glyphs, not the pill's literal travel distance.
  const MAX_PULL = 8;
  const RESISTANCE = 0.3;

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    // Right click belongs to the card-level drag — let it bubble
    // (handled by ItemCard's wrapper). Only left-click starts a
    // pill gesture.
    if (e.button !== 0) return;
    e.stopPropagation();
    // CRITICAL: pointer-capture redirects all subsequent move/up
    // events to this element regardless of where the cursor goes.
    // Without it, dragging off the pill (very easy when MAX_PULL is
    // tight) means pointerup never reaches us and the pill stays
    // visually mid-drag.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    dragRef.current = { startX: e.clientX, everCommitted: false };
    trackingRef.current = true;
    setHint(null);
    setDragDx(0);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = dragRef.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    // Visual pull — sign-preserving, clamped to MAX_PULL after the
    // resistance multiplier. So a 100 px finger drag translates the
    // pill by 45 px, capped at 18 px. Still feels alive but never
    // crashes into a neighbour.
    const pulled = Math.max(-MAX_PULL, Math.min(MAX_PULL, dx * RESISTANCE));
    setDragDx(pulled);
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      s.everCommitted = true;
      const next: 'prev' | 'next' = dx < 0 ? 'prev' : 'next';
      if (hint !== next) setHint(next);
    } else {
      if (hint !== null) setHint(null);
    }
  }, [hint]);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = dragRef.current;
    dragRef.current = null;
    trackingRef.current = false;
    setHint(null);
    setDragDx(0);                 // triggers spring-back via CSS transition
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!s) return;
    const dx = e.clientX - s.startX;
    const past = Math.abs(dx) >= SWIPE_THRESHOLD;
    if (past) {
      if (dx < 0) onPrev();
      else        onNext();
    } else if (!s.everCommitted) {
      onPlayPause();
    }
    // Else: committed at some point, then came back to centre →
    // intentional cancel. No action, no toast.
  }, [onPlayPause, onPrev, onNext]);

  const onPointerCancel = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    dragRef.current = null;
    trackingRef.current = false;
    setHint(null);
    setDragDx(0);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  return (
    <button
      className="nost-mw-btn nost-mw-pill"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.stopPropagation()}
      title="탭: 재생/일시정지 · 좌로 드래그: 이전 · 우로 드래그: 다음"
      style={{
        width: 60, height: 28,
        borderRadius: 10,
        background: `color-mix(in srgb, var(--surface) 50%, ${accent} 16%)`,
        border: `1px solid color-mix(in srgb, ${accent} 40%, transparent)`,
        color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 1,
        cursor: 'pointer',
        flexShrink: 0,
        boxShadow: `0 1px 2px color-mix(in srgb, ${accent} 12%, transparent)`,
        position: 'relative',
        userSelect: 'none',
        touchAction: 'none',
        // Rubber-band: the pill physically follows the pointer
        // (with resistance, max-pull clamped) while dragging. On
        // release we set dragDx=0 and the spring transition snaps
        // it back with a small overshoot — the "쫀득" feel.
        //
        // CSS specificity: the :active rule that shrinks ghost
        // buttons is scoped to :not(.nost-mw-pill) above, so this
        // inline transform isn't fighting an !important pseudo-class
        // rule — the translation actually shows up.
        transform: `translateX(${dragDx}px)`,
        transition: trackingRef.current
          ? 'transform 0ms, background 120ms ease, box-shadow 120ms ease'
          : 'transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1), background 120ms ease, box-shadow 120ms ease',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = `color-mix(in srgb, var(--surface) 30%, ${accent} 30%)`;
        el.style.boxShadow = `0 2px 6px color-mix(in srgb, ${accent} 22%, transparent)`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = `color-mix(in srgb, var(--surface) 50%, ${accent} 16%)`;
        el.style.boxShadow = `0 1px 2px color-mix(in srgb, ${accent} 12%, transparent)`;
      }}
    >
      {/* Skip-direction hint — shows briefly when the user crosses
          the swipe threshold during a pill drag. The play/pause
          glyphs dim simultaneously so the visual mode is clear. */}
      <span style={{
        position: 'absolute', left: 6,
        opacity: hint === 'prev' ? 1 : 0,
        transition: 'opacity 100ms ease',
        display: 'inline-flex', alignItems: 'center',
        color: accent,
      }}>
        <Icon name="skip_previous" size={14} filled weight={700} />
      </span>
      <span style={{
        position: 'absolute', right: 6,
        opacity: hint === 'next' ? 1 : 0,
        transition: 'opacity 100ms ease',
        display: 'inline-flex', alignItems: 'center',
        color: accent,
      }}>
        <Icon name="skip_next" size={14} filled weight={700} />
      </span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 1,
        opacity: hint ? 0.25 : 1,
        transition: 'opacity 100ms ease',
      }}>
        <span style={{
          width: 16, height: 16,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1,
        }}>
          <Icon name="play_arrow" size={14} filled weight={600} />
        </span>
        <span style={{
          width: 14, height: 16,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1,
        }}>
          <Icon name="pause" size={13} filled weight={600} />
        </span>
      </span>
    </button>
  );
}

