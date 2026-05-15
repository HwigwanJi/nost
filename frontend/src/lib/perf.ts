/**
 * Renderer-side perf counters — v1.3.39.
 *
 * Counts component renders, effect fires, and arbitrary labels. Flushed
 * every 10 s to main via `perf:renderer-report` IPC where the counts
 * get logged alongside main's IPC / store / timer buckets in main.log.
 *
 * Usage:
 *   - In a component body, call `bumpRender('ItemCard')` to count one
 *     render. (Increments before React commits — cheap enough to leave
 *     in production: ~80 ns per call.)
 *   - For arbitrary one-off counters (effect fires, callback hits),
 *     call `bumpCounter('label')`.
 *   - Once at app boot, call `startPerfFlush()` to kick off the 10s
 *     periodic ship-out. Safe to call multiple times (idempotent).
 */

import { electronAPI } from '../electronBridge';

const counts = new Map<string, number>();

export function bumpRender(name: string): void {
  counts.set(name, (counts.get(name) || 0) + 1);
}

/** Generic counter — same store as render counts, just semantic alias. */
export function bumpCounter(name: string): void {
  counts.set(name, (counts.get(name) || 0) + 1);
}

let started = false;
const FLUSH_MS = 10_000;

export function startPerfFlush(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    if (counts.size === 0) return;
    const payload: Record<string, number> = {};
    for (const [k, v] of counts) payload[k] = v;
    counts.clear();
    try { electronAPI.perfReport(payload); } catch { /* ipc bridge missing — dev */ }
  }, FLUSH_MS);
}
