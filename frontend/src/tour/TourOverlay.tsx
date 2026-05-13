import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Tour, TourStep } from './tours';
import { TOURS, findTour } from './tours';
import { whenIdle, subscribeBusy, setBusy } from '../lib/userBusy';
import type { AppData } from '../types';

/**
 * TourOverlay — a single reusable spotlight + popover runtime for every
 * tutorial in the app.
 *
 * Design goals (user: "적은 리소스 먹으면서 여러 개를 한 시스템으로"):
 *   - ONE component mounts only while a tour is running (otherwise early-
 *     returns null, React skips the entire subtree).
 *   - Tour data is plain JS objects (see tours.ts) — no per-tour component.
 *   - Spotlight is a single full-screen absolutely-positioned div with a
 *     box-shadow trick to darken everywhere EXCEPT the target rect. No SVG
 *     masks, no per-frame canvas, no repaints beyond target-rect changes.
 *   - Pointer-events pass through the spotlight rectangle so the user can
 *     actually click the highlighted element. The dark area blocks clicks.
 *
 * Control flow:
 *   - Parent calls `startTour(tourId)` to begin a tour. It can also listen
 *     for the 'nost:start-tour' CustomEvent dispatched by the slash command.
 *   - ESC aborts; target click or 다음 button advances; last step closes.
 *   - On tour end, fires `onComplete(tourId)` so the parent can mark it in
 *     AppData.completedTours (skipping auto-starts next time).
 */

interface Props {
  onComplete: (tourId: string) => void;
  /**
   * Fires whenever a tour leaves the screen — completion, ESC, or
   * busy-abort. The `completed` flag distinguishes the cases. App.tsx
   * uses this to tear down the tutorial sandbox even when the user ESC'd
   * partway through (otherwise sandboxed seed data would be left on
   * screen with no obvious way back).
   */
  onEnd?: (tourId: string, completed: boolean) => void;
  /**
   * Live AppData snapshot. Optional so the overlay still works in places
   * where a data context isn't trivial to thread (e.g. legacy callers);
   * `expects`-mode steps simply won't auto-advance without it.
   *
   * The overlay does NOT subscribe to changes here directly — React's
   * normal re-render cycle is the trigger, plus a 600ms safety timer for
   * data fields whose updates may not flow through React (floating badge
   * positions are persisted via IPC and only re-arrive on the next push).
   */
  data?: AppData;
}

const SPOTLIGHT_PAD = 6;
const POPOVER_GAP = 10;
const POPOVER_WIDTH = 300;

export function TourOverlay({ onComplete, onEnd, data }: Props) {
  const [tour, setTour] = useState<Tour | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  // ── Start / stop listener ─────────────────────────────────
  // The slash command /tutorial [id] dispatches nost:start-tour; we listen
  // globally so any caller (CommandBar, settings dialog, welcome modal) can
  // trigger a tour via the same primitive.
  useEffect(() => {
    // Defer-on-busy: if the user is dragging, has a modal open, or is mid
    // edit, we wait until they're idle before opening the spotlight. The
    // 30s timeout means a tour request that never gets a quiet moment
    // simply lapses — better than ambushing the user 5 minutes later.
    let pendingCancel: (() => void) | null = null;
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const id: string | null = detail.tourId ?? null;
      const target: Tour | null = id ? (findTour(id) ?? null) : (TOURS[0] ?? null);
      if (!target) return;
      // Cancel any earlier pending start that hasn't fired yet.
      pendingCancel?.();
      pendingCancel = whenIdle(() => {
        setTour(target);
        setStepIdx(0);
      }, { timeoutMs: 30_000 });
    };
    // Note: we listen to `nost:start-tour-now`, NOT `nost:start-tour`.
    // App.tsx owns the public `nost:start-tour` event and dispatches
    // `now` only after the tutorial sandbox is set up (interactive tours)
    // or immediately (text-only tours). This indirection is what guarantees
    // expects-mode steps don't fire prematurely against stale data.
    window.addEventListener('nost:start-tour-now', onStart);
    return () => {
      window.removeEventListener('nost:start-tour-now', onStart);
      pendingCancel?.();
    };
  }, []);

  const step: TourStep | null = tour ? (tour.steps[stepIdx] ?? null) : null;

  // ── Find target + observe rect changes ────────────────────
  // We use ResizeObserver (one-element) instead of polling per frame —
  // covers window resize, accordion expand, and layout shifts for free.
  const targetEl = useMemo<HTMLElement | null>(() => {
    if (!step) return null;
    if (step.dataTourId) {
      return document.querySelector<HTMLElement>(`[data-tour-id="${step.dataTourId}"]`);
    }
    if (step.selector) {
      return document.querySelector<HTMLElement>(step.selector);
    }
    return null;
  }, [step]);

  useEffect(() => {
    if (!targetEl) { setTargetRect(null); return; }
    const update = () => setTargetRect(targetEl.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(targetEl);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [targetEl]);

  // ── Advance strategies ────────────────────────────────────
  const endTour = useCallback((completed: boolean) => {
    const id = tour?.id;
    step?.onLeave?.();
    setTour(null);
    setStepIdx(0);
    if (completed && id) onComplete(id);
    if (id) onEnd?.(id, completed);
  }, [tour, step, onComplete, onEnd]);

  // While a tour is running, treat any *new* busy transition (drag start,
  // modal opening, etc.) as a request to abort: the user just started
  // doing something more important than reading our spotlight, so get
  // out of the way. We DO mark our own key 'tour' so other auto-popups
  // (welcome re-open, future paywall hints) don't stack on top of us —
  // and we subscribe AFTER calling setBusy so our own marking doesn't
  // re-enter the listener.
  useEffect(() => {
    if (!tour) return;
    setBusy('tour', true);
    const off = subscribeBusy(busy => {
      // busy=false transitions are external surfaces *closing* — never a
      // reason to abort. Only act on something opening / a drag starting.
      if (busy) endTour(false);
    });
    return () => {
      off();
      setBusy('tour', false);
    };
  }, [tour, endTour]);

  const advance = useCallback(() => {
    if (!tour) return;
    step?.onLeave?.();
    const next = stepIdx + 1;
    if (next >= tour.steps.length) {
      endTour(true);
    } else {
      setStepIdx(next);
    }
  }, [tour, stepIdx, step, endTour]);

  // advanceOn: 'target-click' — listen for a click anywhere on the target.
  useEffect(() => {
    if (!step || step.advanceOn !== 'target-click' || !targetEl) return;
    const onClick = () => advance();
    targetEl.addEventListener('click', onClick);
    return () => targetEl.removeEventListener('click', onClick);
  }, [step, targetEl, advance]);

  // advanceOn: 'condition' — poll every 400ms
  useEffect(() => {
    if (!step || step.advanceOn !== 'condition' || !step.condition) return;
    const tick = setInterval(() => {
      if (step.condition?.()) advance();
    }, 400);
    return () => clearInterval(tick);
  }, [step, advance]);

  // advanceOn: 'expects' — predicate over the live AppData. We check on
  // every render (data prop change) AND on a 600ms timer as a safety net
  // for state that doesn't flow through React (e.g. floating badge drag
  // positions arriving via IPC after a delay).
  useEffect(() => {
    if (!step || step.advanceOn !== 'expects' || !step.expects || !data) return;
    if (step.expects(data)) { advance(); return; }
    const tick = setInterval(() => {
      if (step.expects && data && step.expects(data)) advance();
    }, 600);
    return () => clearInterval(tick);
  }, [step, advance, data]);

  // autoAdvanceMs — brief success beats
  useEffect(() => {
    if (!step?.autoAdvanceMs) return;
    const t = setTimeout(() => advance(), step.autoAdvanceMs);
    return () => clearTimeout(t);
  }, [step, advance]);

  // ESC aborts
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); endTour(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tour, endTour]);

  if (!tour || !step) return null;

  // ── Spotlight geometry ────────────────────────────────────
  // When the target isn't found (e.g. hidden behind a collapsed accordion),
  // we still render the popover centered and let the user advance manually.
  const rect = targetRect;
  const spotlight: CSSProperties | null = rect ? {
    position: 'fixed',
    top: rect.top - SPOTLIGHT_PAD,
    left: rect.left - SPOTLIGHT_PAD,
    width: rect.width + SPOTLIGHT_PAD * 2,
    height: rect.height + SPOTLIGHT_PAD * 2,
    borderRadius: 10,
    // Huge box-shadow darkens the rest of the viewport. Bigger than any
    // realistic display so the fade extends everywhere we might scroll.
    boxShadow: '0 0 0 99999px rgba(0, 0, 0, 0.55)',
    border: '2px solid rgba(255, 255, 255, 0.85)',
    pointerEvents: 'none',
    transition: 'top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease',
    zIndex: 9998,
  } : null;

  // ── Popover placement ─────────────────────────────────────
  const placement = step.placement ?? 'auto';
  const popoverStyle: CSSProperties = (() => {
    const base: CSSProperties = {
      position: 'fixed',
      width: POPOVER_WIDTH,
      background: 'rgba(20, 20, 36, 0.96)',
      color: '#f3f4f6',
      borderRadius: 12,
      padding: '14px 16px 12px',
      boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.08)',
      backdropFilter: 'blur(18px) saturate(160%)',
      zIndex: 9999,
      pointerEvents: 'auto',
      animation: 'nost-tour-in 200ms cubic-bezier(0.22, 1, 0.36, 1)',
    };
    if (!rect) {
      base.top = '50%';
      base.left = '50%';
      base.transform = 'translate(-50%, -50%)';
      return base;
    }
    // Pick a side with enough room.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const spaceRight = vw - rect.right;
    const spaceLeft  = rect.left;
    let actual: 'top' | 'bottom' | 'left' | 'right' = 'bottom';
    if (placement !== 'auto') {
      actual = placement;
    } else {
      if (spaceBelow > 140) actual = 'bottom';
      else if (spaceAbove > 140) actual = 'top';
      else if (spaceRight > POPOVER_WIDTH + 20) actual = 'right';
      else actual = 'left';
    }
    // Override if the chosen side doesn't actually have room.
    if (actual === 'bottom' && spaceBelow < 140 && spaceAbove > spaceBelow) actual = 'top';
    if (actual === 'right'  && spaceRight  < POPOVER_WIDTH + 20 && spaceLeft > spaceRight) actual = 'left';

    if (actual === 'bottom') {
      base.top = rect.bottom + POPOVER_GAP;
      base.left = Math.max(8, Math.min(vw - POPOVER_WIDTH - 8, rect.left + rect.width / 2 - POPOVER_WIDTH / 2));
    } else if (actual === 'top') {
      base.bottom = vh - rect.top + POPOVER_GAP;
      base.left = Math.max(8, Math.min(vw - POPOVER_WIDTH - 8, rect.left + rect.width / 2 - POPOVER_WIDTH / 2));
    } else if (actual === 'right') {
      base.left = rect.right + POPOVER_GAP;
      base.top  = Math.max(8, Math.min(vh - 180, rect.top + rect.height / 2 - 70));
    } else {
      base.right = vw - rect.left + POPOVER_GAP;
      base.top   = Math.max(8, Math.min(vh - 180, rect.top + rect.height / 2 - 70));
    }
    return base;
  })();

  const isLast = stepIdx === tour.steps.length - 1;

  return (
    <>
      <style>{`
        @keyframes nost-tour-in {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
      {/* Dimmed backdrop with spotlight cutout — uses pointer-events: auto
          OUTSIDE the spotlight to block clicks so the user can't accidentally
          escape the tour context. Inside the spotlight, pointer-events: none
          on the spotlight div lets clicks reach the target element. */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9997,
          pointerEvents: rect ? 'none' : 'auto', // if we have a target the spotlight box handles the mask
          background: rect ? 'transparent' : 'rgba(0, 0, 0, 0.55)',
        }}
        onClick={e => { if (!rect) e.stopPropagation(); }}
      />
      {spotlight && <div style={spotlight} />}

      <div style={popoverStyle} role="dialog" aria-modal="true">
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 6, gap: 10,
        }}>
          <span style={{ fontSize: 10, letterSpacing: 0.4, color: 'rgba(255,255,255,0.55)', fontWeight: 600, textTransform: 'uppercase' }}>
            {tour.title} · {stepIdx + 1} / {tour.steps.length}
          </span>
          <button
            onClick={() => endTour(false)}
            title="종료 (Esc)"
            style={{
              background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)',
              cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2,
            }}
          >×</button>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.01em' }}>
          {step.title}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, color: 'rgba(255,255,255,0.8)', marginBottom: 12 }}>
          {step.body}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {tour.steps.map((_, i) => (
              <span
                key={i}
                style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: i === stepIdx ? 'var(--accent, #6366f1)' : 'rgba(255,255,255,0.18)',
                  transition: 'background 150ms ease',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {stepIdx > 0 && (
              <button
                onClick={() => { step?.onLeave?.(); setStepIdx(stepIdx - 1); }}
                style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 600,
                  background: 'transparent', color: 'rgba(255,255,255,0.7)',
                  border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >이전</button>
            )}
            {step.advanceOn !== 'target-click' && step.advanceOn !== 'condition' && step.advanceOn !== 'expects' && (
              <button
                onClick={advance}
                style={{
                  padding: '5px 14px', fontSize: 11, fontWeight: 700,
                  background: 'var(--accent, #6366f1)', color: '#fff',
                  border: 'none', borderRadius: 6,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >{isLast ? '완료' : '다음'}</button>
            )}
            {/* expects mode: tour waits for the user to actually do the
                action. Show the hint inline + a small "건너뛰기" so a user
                who already knows can still bypass without aborting. */}
            {step.advanceOn === 'expects' && (
              <>
                {step.hint && (
                  <span style={{
                    fontSize: 10, color: 'rgba(255,255,255,0.55)', alignSelf: 'center',
                    fontStyle: 'italic',
                  }}>{step.hint}</span>
                )}
                <button
                  onClick={advance}
                  style={{
                    padding: '5px 12px', fontSize: 11, fontWeight: 600,
                    background: 'transparent', color: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                  title="이 단계 건너뛰기"
                >건너뛰기</button>
              </>
            )}
            {step.advanceOn === 'target-click' && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', alignSelf: 'center' }}>
                ↑ 클릭해서 진행
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
