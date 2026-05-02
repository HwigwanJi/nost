/**
 * useHorizontalSwipe — pointer-driven horizontal drag gesture with
 * tap-vs-swipe disambiguation.
 *
 * Modeled on the music-widget interaction grammar: a clearly-bounded
 * box that the user can tap (= primary action) OR fling left/right
 * (= secondary actions). This hook centralises the math so memo
 * cards, colour swatches, and any future "swipeable widget" share
 * the same feel.
 *
 * Behaviour:
 *   - Tap (no movement past 5px) → fires `onTap`.
 *   - Drag past `threshold` and release → fires `onSwipeLeft` or
 *     `onSwipeRight` based on direction. We DON'T trigger on
 *     mid-drag — the user has to commit by lifting, so they can
 *     bail out by dragging back to centre. Same as iOS's
 *     swipe-to-action pattern.
 *   - Vertical-dominant motion (|dy| > |dx| × 1.5) is ignored so a
 *     quick scroll on a touchpad doesn't accidentally fire.
 *
 * Returned `progress` is a normalised [-1.5, 1.5]-ish range —
 * consumers use it to fade in left/right action labels and tint the
 * swipe surface as commitment grows.
 *
 * Why pointer events (not touch + mouse separately): single code
 * path covers mouse + pen + touch + hybrid devices, and `pointerId`
 * captures into the same handlers via setPointerCapture so the user
 * can drag past the box edge without losing the gesture.
 */

import { useState, useRef, useCallback } from 'react';

interface Options {
  /** Pixel distance to register a swipe. Below = tap. Default 56. */
  threshold?: number;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Fired when the user lifts without crossing the threshold AND
   *  didn't move past 5px (a real tap, not a half-hearted swipe). */
  onTap?: () => void;
  /** Suppress the gesture entirely — useful when the parent is in
   *  a state where swipes shouldn't apply (e.g. while drag-reorder
   *  is running on the same surface). */
  disabled?: boolean;
}

const TAP_TOLERANCE_PX = 5;

export function useHorizontalSwipe({
  threshold = 56,
  onSwipeLeft,
  onSwipeRight,
  onTap,
  disabled,
}: Options) {
  const [dragX, setDragX] = useState(0);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  // Tracks whether the pointer moved enough to count as a drag (vs a
  // "hold still" tap). Even a sub-threshold drag suppresses onTap so
  // users don't accidentally trigger the primary action when they
  // were trying to swipe but stopped early.
  const movedRef = useRef(false);

  const reset = useCallback(() => {
    startRef.current = null;
    movedRef.current = false;
    setDragX(0);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (disabled) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return; // left mouse only
    startRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    movedRef.current = false;
    setDragX(0);
    // Capture so the gesture continues even if the pointer leaves the
    // element (drag-past-the-edge usability).
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no-op */ }
  }, [disabled]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!startRef.current || startRef.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    // Vertical-dominant → bail (probably a scroll attempt).
    if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 8) return;
    if (Math.abs(dx) > TAP_TOLERANCE_PX) movedRef.current = true;
    setDragX(dx);
  }, []);

  const finish = useCallback((e: React.PointerEvent<HTMLElement>, settled: boolean) => {
    if (!startRef.current || startRef.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - startRef.current.x;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* no-op */ }
    reset();
    if (!settled) return;       // pointercancel etc. — swallow
    if (Math.abs(dx) >= threshold) {
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
      return;
    }
    if (!movedRef.current) onTap?.();
  }, [reset, threshold, onSwipeLeft, onSwipeRight, onTap]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    finish(e, true);
  }, [finish]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLElement>) => {
    finish(e, false);
  }, [finish]);

  return {
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    },
    /** Live drag offset in pixels; 0 when idle. */
    dragX,
    /** Drag progress as a fraction of `threshold`. -1 = full left,
     *  +1 = full right. Out-of-range when overshooting. */
    progress: dragX / threshold,
    /** True while a pointer-down is active. Useful for visual
     *  "armed" state on the swipe surface. */
    swiping: startRef.current !== null,
  };
}
