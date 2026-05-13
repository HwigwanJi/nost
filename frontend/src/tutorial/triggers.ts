/**
 * Trigger bus — minimal pub/sub for app events that nudges and
 * step `advance: { kind: 'event' }` listen on.
 *
 * No external dependency: a Set of callbacks keyed by event type.
 * Multiple subscribers per event are supported; callbacks fire in
 * registration order. Synchronous so a publisher knows whether
 * anyone cared (return value = listener count).
 *
 * Publishers (e.g. ItemDialog calling `triggers.fire('item-dialog-cancelled')`)
 * shouldn't import this module's types — they import { triggers }
 * and pass an AppEvent string directly. Loose coupling > exhaustive
 * typing for this surface.
 */

import type { AppEvent } from './types';

type Listener = (payload?: unknown) => void;

const listeners: Map<AppEvent, Set<Listener>> = new Map();

export const triggers = {
  /** Subscribe to an event. Returns an unsubscribe function. */
  on(event: AppEvent, cb: Listener): () => void {
    let set = listeners.get(event);
    if (!set) { set = new Set(); listeners.set(event, set); }
    set.add(cb);
    return () => { set!.delete(cb); };
  },

  /** Fire an event. Returns the number of listeners that ran —
   *  publishers can use 0 to no-op when nothing cares (e.g. avoid
   *  computing a heavy payload). */
  fire(event: AppEvent, payload?: unknown): number {
    const set = listeners.get(event);
    if (!set || set.size === 0) return 0;
    for (const cb of set) {
      try { cb(payload); } catch (e) { console.warn('[tutorial.triggers]', event, e); }
    }
    return set.size;
  },
};
