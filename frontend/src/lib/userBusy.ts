/**
 * userBusy — a tiny global registry for "the user is mid-action, don't pop
 * anything in their face right now."
 *
 * Why this exists
 * ───────────────
 * The app has many auto-firing UX surfaces (welcome wizard on first run,
 * tour overlay on slash command, first-card celebration, future paywall
 * warnings…). Each one was independently deciding when to appear, so they
 * could trample mid-drag, mid-edit, or mid-modal flows. Symptom users
 * reported: "I'm doing something and stuff just pops up at me."
 *
 * Design
 * ──────
 * - Module-level `Set<string>` of currently-busy keys. Empty set ⇒ idle.
 * - Owners of each "occupying" interaction (every modal, every drag) call
 *   `setBusy(key, true)` on enter and `setBusy(key, false)` on exit. Keys
 *   are namespaced strings ("modal:welcome", "drag", …) so multiple owners
 *   don't collide.
 * - Auto-popups don't fire directly. They go through `whenIdle(fn)`, which
 *   runs `fn` immediately when the user is idle, otherwise subscribes and
 *   waits. They can also `subscribeBusy(...)` to abort an in-flight surface
 *   when the user starts something new.
 *
 * What this is NOT
 * ────────────────
 * - Not a focus tracker. We don't try to detect text-input focus globally
 *   — that's noisy and false-positive-prone (every list of items has
 *   focusable buttons). If a particular surface needs to suppress on
 *   typing, it can mark its own busy key.
 * - Not a queue. `whenIdle` runs as soon as idle returns; if two callers
 *   wait, both fire on the same idle tick. That's fine: a wizard and a
 *   tour both wanting to open simultaneously is an app-design bug to
 *   resolve in the caller, not here.
 */

const busy = new Set<string>();
const listeners = new Set<(busy: boolean) => void>();

function notify() {
  const isBusy = busy.size > 0;
  // Snapshot — listeners may unsubscribe inside their handler.
  for (const fn of Array.from(listeners)) {
    try { fn(isBusy); } catch { /* never let one bad listener break others */ }
  }
}

export function setBusy(key: string, on: boolean): void {
  const had = busy.has(key);
  if (on && !had) { busy.add(key); notify(); }
  else if (!on && had) { busy.delete(key); notify(); }
}

export function isUserBusy(): boolean {
  return busy.size > 0;
}

/** For debugging — returns a snapshot of active busy keys. */
export function busyKeys(): string[] {
  return Array.from(busy);
}

/**
 * Subscribe to busy-state transitions. Callback receives the new state
 * (true = something just got marked busy / still busy, false = back to idle).
 * Returns an unsubscribe function.
 */
export function subscribeBusy(fn: (busy: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Run `fn` once when the user is idle. If already idle, runs synchronously.
 * If the optional `timeoutMs` elapses before idle is reached, gives up
 * silently (the surface that wanted to open just doesn't open — better than
 * popping mid-action 30 seconds later).
 *
 * Returns a cancel function (e.g. for React effect cleanup).
 */
export function whenIdle(
  fn: () => void,
  opts: { timeoutMs?: number } = {},
): () => void {
  if (!isUserBusy()) {
    fn();
    return () => {};
  }
  let cancelled = false;
  const cleanup = () => {
    cancelled = true;
    listeners.delete(tick);
    if (timer) clearTimeout(timer);
  };
  const tick = (nowBusy: boolean) => {
    if (cancelled) return;
    if (!nowBusy) { cleanup(); fn(); }
  };
  listeners.add(tick);
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(() => { cleanup(); }, opts.timeoutMs);
  }
  return cleanup;
}

// ── React conveniences ───────────────────────────────────────────────
//
// We avoid importing React types here so this file stays usable from
// non-component code (e.g. event handlers, store helpers). Components
// import these via the hook helper below.

import { useEffect } from 'react';

/**
 * Mark the calling component as occupying the user's attention while
 * `active` is true. The cleanup always clears the mark, so unmounts and
 * crashes can't strand the registry in a stuck-busy state.
 *
 * Usage:
 *   useBusyMark('modal:welcome', open);
 */
export function useBusyMark(key: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    setBusy(key, true);
    return () => setBusy(key, false);
  }, [key, active]);
}
