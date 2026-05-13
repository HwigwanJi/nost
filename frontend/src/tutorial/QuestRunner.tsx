/**
 * QuestRunner — the per-step overlay.
 *
 * Inherits the focus-and-dim mechanic from the v1 TourOverlay:
 *   - Full-screen `position: fixed` translucent dim
 *   - Spotlight = a transparent rect at the target's getBoundingClientRect,
 *     created via a giant `box-shadow` so the target stays clickable
 *   - Popover anchored next to the spotlight with the step body
 *
 * What's new vs v1:
 *   - Gesture badge (좌클릭 / 우클릭 / 드래그 / …)
 *   - Step counter + thin progress bar
 *   - `expects` and `event` advance criteria (v1 had only the
 *     first; the new event bus from triggers.ts powers the second)
 *   - Fallback hint after 15 s of no progress
 *   - ESC pauses (state.active stays — resume next session)
 *
 * The runner mounts ONLY when state.active is non-null. Caller
 * (TutorialProvider) handles that gate; we trust we're rendered
 * because there's a quest to run.
 */

import { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { AppData } from '../types';
import type { Quest, QuestStep, GestureKind, AppEvent } from './types';
import { triggers } from './triggers';

interface Props {
  quest: Quest;
  stepIdx: number;
  data: AppData;
  /** Advance to the next step. Caller decides what "next" means
   *  (next stepIdx OR completion when last step). */
  onAdvance: () => void;
  /** Skip = abandon quest. */
  onSkip: () => void;
  /** ESC pause. State.active is preserved by the caller. */
  onPause: () => void;
}

const FALLBACK_HINT_MS = 15_000;
// Rect re-check cadence — used as a slow safety net only. Primary
// signal is ResizeObserver / IntersectionObserver / scroll listener.
// 1 s is plenty for occasional layout shifts (tab switch, accordion
// open) that the observers don't catch.
const RECT_SLOW_POLL_MS = 1000;

/** Resolve a spotlight selector list to the first matching DOM
 *  element. Selectors are `data-tour-id` values OR raw CSS
 *  selectors (must start with `[`, `.`, `#`). Returns null when
 *  none match — caller falls back to the no-rect "full dim"
 *  presentation. */
function resolveSpotlight(spotlight: string | string[]): HTMLElement | null {
  const list = Array.isArray(spotlight) ? spotlight : [spotlight];
  for (const sel of list) {
    if (!sel) continue;
    const el =
      document.querySelector<HTMLElement>(`[data-tour-id="${sel}"]`) ||
      ((sel.startsWith('[') || sel.startsWith('.') || sel.startsWith('#'))
        ? document.querySelector<HTMLElement>(sel)
        : null);
    if (el) return el;
  }
  return null;
}

export function QuestRunner({ quest, stepIdx, data, onAdvance, onSkip, onPause }: Props) {
  const step: QuestStep | undefined = quest.steps[stepIdx];

  // ── Spotlight rect tracking ────────────────────────────────
  // Prior versions polled getBoundingClientRect() at 250 ms which
  // ran ~4× / sec for the entire quest duration — wasteful. v2:
  // ResizeObserver on the target + a window scroll/resize listener,
  // plus a 1 s safety poll for layout shifts neither observer sees
  // (tab/accordion expand changes target identity, not size). Net:
  // CPU drops noticeably during long quests.
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!step) return;
    let cancelled = false;
    let target: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;

    const recompute = () => {
      if (cancelled) return;
      const next = resolveSpotlight(step.spotlight);
      if (next !== target) {
        // Target identity changed — rebind the ResizeObserver.
        if (ro && target) ro.unobserve(target);
        target = next;
        if (target && ro) ro.observe(target);
      }
      setRect(target ? target.getBoundingClientRect() : null);
    };

    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => recompute());
    }
    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    const slowPoll = setInterval(recompute, RECT_SLOW_POLL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
      clearInterval(slowPoll);
      if (ro && target) { ro.unobserve(target); ro.disconnect(); }
    };
  }, [step]);

  // ── Fallback hint timer ─────────────────────────────────────
  const [showFallback, setShowFallback] = useState(false);
  useEffect(() => {
    setShowFallback(false);
    if (!step?.fallbackHint) return;
    const t = setTimeout(() => setShowFallback(true), FALLBACK_HINT_MS);
    return () => clearTimeout(t);
  }, [stepIdx, step?.fallbackHint]);

  // Latest-onAdvance ref so the effect's listeners always invoke
  // the most recent handler without re-binding on every render.
  const advanceRef = useRef(onAdvance);
  useEffect(() => { advanceRef.current = onAdvance; }, [onAdvance]);

  // Latest-data ref — the `expects` poll reads via this so the
  // SUBSCRIPTION effect doesn't take `data` as a dep (which would
  // re-subscribe + unsubscribe on every store mutation, briefly
  // dropping listeners and risking missed `event`-kind triggers
  // fired during the gap).
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  // ── Advance criteria dispatch (data-INDEPENDENT) ───────────
  // Subscribes to triggers / click handlers / timers ONCE per step.
  // The `expects` poll uses dataRef so it reads the latest store
  // state without forcing the effect to re-run when data changes.
  useEffect(() => {
    if (!step) return;
    const a = step.advance;
    switch (a.kind) {
      case 'auto-advance': {
        const t = setTimeout(() => advanceRef.current(), a.ms);
        return () => clearTimeout(t);
      }
      case 'expects': {
        let stopped = false;
        const loop = () => {
          if (stopped) return;
          if (a.check(dataRef.current)) { advanceRef.current(); return; }
          setTimeout(loop, 600);
        };
        loop();
        return () => { stopped = true; };
      }
      case 'event': {
        const off = triggers.on(a.type as AppEvent, () => advanceRef.current());
        return off;
      }
      case 'click-target': {
        const el = resolveSpotlight(step.spotlight);
        if (!el) return;
        const handler = () => advanceRef.current();
        el.addEventListener('click', handler);
        return () => el.removeEventListener('click', handler);
      }
      // 'next-button' handled in popover.
    }
    return undefined;
  }, [step, stepIdx]);

  // ── ESC = pause ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Stop propagation so the global ESC handler in App.tsx
        // doesn't *also* fire on the same keystroke (it used to
        // escalate to hideApp() when nothing else was on top).
        // preventDefault alone is not enough — capture-phase
        // listeners still bubble through to window.
        e.preventDefault();
        e.stopPropagation();
        onPause();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onPause]);

  const popoverPos = usePopoverPosition(rect);

  if (!step) return null;

  // Spotlight rect (slightly inflated so the target glows)
  const PAD = 8;
  const sr = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  // Observation steps (intro/wrap/observe — no gesture set) just ask
  // the user to look at the target. Keep the static dim+outline.
  // Action steps (gesture set) get an AE-style trim-path stroke
  // animation overlaid on top to call the user to act — drawn on a
  // SEPARATE SVG layer so the dim itself stays static (animating the
  // dim div's outline made the giant boxShadow flash with it).
  const isObservation = !step.gesture;

  return (
    <>
      <style>{`
        @keyframes questRunnerIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes questHintFade { from { opacity: 0; transform: translateY(2px) } to { opacity: 1; transform: none } }
        @keyframes questStrokeDraw {
          0%   { stroke-dashoffset: 100; }   /* dash queued before path start — invisible */
          40%  { stroke-dashoffset: 0;   }   /* drawn in: leading edge reached path end */
          55%  { stroke-dashoffset: 0;   }   /* brief hold so the eye catches it */
          95%  { stroke-dashoffset: -100; }  /* slid off past path end — same direction wipe */
          100% { stroke-dashoffset: -100; }  /* hold blank to give the loop breath */
        }
      `}</style>

      {/* Dim overlay — uses inset shadow trick to "cut" the spotlight
          rect open while keeping clicks on the target alive. */}
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 1400,
          pointerEvents: 'none',  // click-through
          animation: 'questRunnerIn 0.22s ease',
        }}
      >
        {sr ? (
          <>
            <div style={{
              position: 'absolute',
              top: sr.top, left: sr.left, width: sr.width, height: sr.height,
              borderRadius: 10,
              boxShadow: '0 0 0 99999px rgba(0,0,0,0.55)',
              outline: isObservation ? '2px solid var(--accent)' : 'none',
              outlineOffset: 0,
              transition: 'top 0.18s, left 0.18s, width 0.18s, height 0.18s',
            }} />
            {!isObservation && (
              <svg
                aria-hidden
                style={{
                  position: 'absolute',
                  top: sr.top, left: sr.left, width: sr.width, height: sr.height,
                  overflow: 'visible',
                  pointerEvents: 'none',
                }}
              >
                <rect
                  x={1} y={1}
                  width={sr.width - 2} height={sr.height - 2}
                  rx={10} ry={10}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  pathLength={100}
                  strokeDasharray="100 100"
                  style={{
                    animation: 'questStrokeDraw 2s cubic-bezier(0.65, 0, 0.35, 1) infinite',
                  }}
                />
              </svg>
            )}
          </>
        ) : (
          // Target not found (yet) — full dim. Step body still
          // floats so user can read what to do.
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
        )}
      </div>

      {/* Popover — pointer-events on, sits above dim. Anchored to
          spotlight; falls back to bottom-center when no rect. */}
      <div
        role="dialog"
        aria-label={step.title}
        style={{
          position: 'fixed', zIndex: 1401,
          ...popoverPos,
          width: 360, maxWidth: '92vw',
          padding: 16,
          borderRadius: 12,
          background: 'var(--bg-rgba)',
          border: '1px solid var(--border-rgba)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.34)',
          backdropFilter: 'blur(20px)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        {/* Header strip — gesture badge + (Pattern A) shortcut chip + step counter */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {step.gesture && <GestureBadge kind={step.gesture} />}
            {step.shortcut && !step.shortcutAsHint && <ShortcutChips combo={step.shortcut} />}
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
            {stepIdx + 1} / {quest.steps.length}
          </span>
        </div>

        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-color)' }}>
            {step.title}
          </h3>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            {step.body}
          </p>
          {step.shortcut && step.shortcutAsHint && (
            <p style={{
              margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5,
            }}>
              💡 빠른 길:
              <ShortcutChips combo={step.shortcut} />
            </p>
          )}
        </div>

        {showFallback && step.fallbackHint && (
          <p style={{
            margin: 0, padding: '6px 10px', borderRadius: 6,
            background: 'var(--accent-dim)', border: '1px solid var(--accent)',
            fontSize: 11, color: 'var(--accent)', lineHeight: 1.5,
            animation: 'questHintFade 0.3s ease',
          }}>
            💡 {step.fallbackHint}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <button
            type="button"
            onClick={onSkip}
            style={ghostBtn}
          >
            건너뛰기
          </button>
          {step.advance.kind === 'next-button' ? (
            <button
              type="button"
              onClick={onAdvance}
              style={primaryBtn}
            >
              다음
            </button>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {advanceLabel(step.advance.kind)}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div style={{
          marginTop: 4, height: 3, borderRadius: 2,
          background: 'color-mix(in srgb, var(--border-rgba) 60%, transparent)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${((stepIdx + 1) / quest.steps.length) * 100}%`,
            background: 'var(--accent)',
            transition: 'width 0.3s cubic-bezier(0.4, 0.1, 0.3, 1)',
          }} />
        </div>
      </div>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function usePopoverPosition(rect: DOMRect | null): { top: number; left: number } {
  // Pick a side with the most room; fall back to bottom-right when
  // no rect (full dim mode). Recompute on rect change.
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 100, left: 100 });
  const measure = useCallback(() => {
    if (!rect) {
      setPos({ top: window.innerHeight - 280, left: window.innerWidth - 392 });
      return;
    }
    const POPOVER_W = 360, POPOVER_H = 200, GAP = 12;
    // Prefer right of target
    if (rect.right + GAP + POPOVER_W <= window.innerWidth) {
      setPos({ top: clamp(rect.top, 16, window.innerHeight - POPOVER_H - 16), left: rect.right + GAP });
      return;
    }
    if (rect.left - GAP - POPOVER_W >= 0) {
      setPos({ top: clamp(rect.top, 16, window.innerHeight - POPOVER_H - 16), left: rect.left - GAP - POPOVER_W });
      return;
    }
    if (rect.bottom + GAP + POPOVER_H <= window.innerHeight) {
      setPos({ top: rect.bottom + GAP, left: clamp(rect.left, 16, window.innerWidth - POPOVER_W - 16) });
      return;
    }
    setPos({ top: clamp(rect.top - POPOVER_H - GAP, 16, window.innerHeight - POPOVER_H - 16), left: clamp(rect.left, 16, window.innerWidth - POPOVER_W - 16) });
  }, [rect]);

  useEffect(() => { measure(); }, [measure]);

  return pos;
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

/** macOS users see ⌘ where Windows users see Ctrl, ⌥ where they
 *  see Alt. Underlying quest data stays platform-neutral as
 *  ['Ctrl', 'Enter']; the chip renderer normalises at display
 *  time. We sniff via navigator.platform — Electron renderer
 *  has it populated and it's stable enough for this UX hint. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
function displayKey(k: string): string {
  if (!IS_MAC) return k;
  switch (k) {
    case 'Ctrl':  return '⌘';
    case 'Alt':   return '⌥';
    case 'Shift': return '⇧';
    case 'Meta':  return '⌘';
    default:      return k;
  }
}

function ShortcutChips({ combo }: { combo: string[] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {combo.map((k, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {i > 0 && <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>+</span>}
          <kbd style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 22, height: 20, padding: '0 6px',
            borderRadius: 4,
            border: '1px solid var(--border-rgba)',
            borderBottomWidth: 2,
            background: 'var(--surface)',
            color: 'var(--text-color)',
            font: '600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace',
            lineHeight: 1,
          }}>
            {displayKey(k)}
          </kbd>
        </span>
      ))}
    </span>
  );
}

function GestureBadge({ kind }: { kind: GestureKind }) {
  const meta: Record<GestureKind, { icon: string; label: string }> = {
    'left-click':  { icon: 'mouse',           label: '좌클릭' },
    'right-click': { icon: 'mouse',           label: '우클릭' },
    'long-press':  { icon: 'touch_app',       label: '길게 누르기' },
    'drag':        { icon: 'drag_indicator',  label: '드래그' },
    'keyboard':    { icon: 'keyboard',        label: '키보드' },
    'swipe':       { icon: 'swipe',           label: '좌우 swipe' },
  };
  const m = meta[kind];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99,
      background: 'var(--accent-dim)', border: '1px solid var(--accent)',
      color: 'var(--accent)', fontSize: 10, fontWeight: 700,
    }}>
      <Icon name={m.icon} size={11} color="var(--accent)" />
      {m.label}
    </span>
  );
}

function advanceLabel(kind: 'click-target' | 'expects' | 'event' | 'auto-advance'): string {
  switch (kind) {
    case 'click-target': return '대상을 클릭하면 진행';
    case 'expects':      return '직접 해보면 자동 진행';
    case 'event':        return '동작이 감지되면 진행';
    case 'auto-advance': return '잠시 후 자동 진행';
  }
}

const ghostBtn: React.CSSProperties = {
  height: 28, padding: '0 10px', borderRadius: 6,
  background: 'transparent', border: '1px solid var(--border-rgba)',
  color: 'var(--text-dim)', fontSize: 11, fontFamily: 'inherit',
  cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  height: 28, padding: '0 14px', borderRadius: 6,
  background: 'var(--accent)', border: '1px solid var(--accent)',
  color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
  cursor: 'pointer',
};
