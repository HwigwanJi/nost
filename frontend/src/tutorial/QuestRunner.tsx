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
const RECT_POLL_MS = 250;

export function QuestRunner({ quest, stepIdx, data, onAdvance, onSkip, onPause }: Props) {
  const step: QuestStep | undefined = quest.steps[stepIdx];

  // ── Spotlight rect (poll because target may mount/move) ─────
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!step) return;
    let cancelled = false;
    const compute = () => {
      if (cancelled) return;
      const sel = Array.isArray(step.spotlight) ? step.spotlight[0] : step.spotlight;
      // dataTourId selector first (preferred), then raw CSS selector
      const el =
        document.querySelector(`[data-tour-id="${sel}"]`) ||
        (sel.startsWith('[') || sel.startsWith('.') || sel.startsWith('#')
          ? document.querySelector(sel)
          : null);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    compute();
    const id = setInterval(compute, RECT_POLL_MS);
    window.addEventListener('resize', compute);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('resize', compute); };
  }, [step]);

  // ── Fallback hint timer ─────────────────────────────────────
  const [showFallback, setShowFallback] = useState(false);
  useEffect(() => {
    setShowFallback(false);
    if (!step?.fallbackHint) return;
    const t = setTimeout(() => setShowFallback(true), FALLBACK_HINT_MS);
    return () => clearTimeout(t);
  }, [stepIdx, step?.fallbackHint]);

  // ── Advance criteria dispatch ───────────────────────────────
  // Latest-onAdvance ref so the effect's listeners always invoke
  // the most recent handler without re-binding on every render.
  // Updated in an effect (not during render) per React rules.
  const advanceRef = useRef(onAdvance);
  useEffect(() => { advanceRef.current = onAdvance; }, [onAdvance]);

  useEffect(() => {
    if (!step) return;
    const a = step.advance;
    switch (a.kind) {
      case 'auto-advance': {
        const t = setTimeout(() => advanceRef.current(), a.ms);
        return () => clearTimeout(t);
      }
      case 'expects': {
        // Poll AppData; advance when check returns true.
        let stopped = false;
        const loop = () => {
          if (stopped) return;
          if (a.check(data)) { advanceRef.current(); return; }
          // Cheap: 600 ms poll. Live data updates re-trigger the
          // useEffect via the deps array.
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
        const sel = Array.isArray(step.spotlight) ? step.spotlight[0] : step.spotlight;
        const el =
          document.querySelector(`[data-tour-id="${sel}"]`) ||
          (sel.startsWith('[') || sel.startsWith('.') || sel.startsWith('#')
            ? document.querySelector(sel)
            : null);
        if (!el) return;
        const handler = () => advanceRef.current();
        el.addEventListener('click', handler);
        return () => el.removeEventListener('click', handler);
      }
      // 'next-button' is handled inline in the popover.
    }
    return undefined;
  }, [step, data, stepIdx]);

  // ── ESC = pause ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onPause(); }
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

  return (
    <>
      <style>{`
        @keyframes questRunnerIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes questHintFade { from { opacity: 0; transform: translateY(2px) } to { opacity: 1; transform: none } }
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
          <div style={{
            position: 'absolute',
            top: sr.top, left: sr.left, width: sr.width, height: sr.height,
            borderRadius: 10,
            boxShadow: '0 0 0 99999px rgba(0,0,0,0.55)',
            outline: '2px solid var(--accent)',
            outlineOffset: 0,
            transition: 'top 0.18s, left 0.18s, width 0.18s, height 0.18s',
          }} />
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
        {/* Header strip — gesture badge + step counter */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {step.gesture
            ? <GestureBadge kind={step.gesture} />
            : <span />}
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
