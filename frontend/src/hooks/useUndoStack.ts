/**
 * useUndoStack — app-level undo/redo external store.
 *
 * Pattern: command stack. Each user action that should be undoable
 * pushes an UndoEntry (with `undo` and `redo` callbacks) onto the
 * stack via `pushUndo({ description, undo, redo })`. Ctrl+Z (or the
 * UI button) pops the latest entry, runs its `undo`, and pushes it
 * onto the redo stack. Ctrl+Shift+Z is symmetric.
 *
 * Why an external store (vs React context):
 *   - Many call sites are in stores / hooks, not components — can't
 *     useContext from there. External store has a plain function API.
 *   - Mirrors the tutorialState / authState patterns already in the
 *     codebase. No new mental model.
 *
 * Capacity: MAX_DEPTH actions; oldest evicted FIFO. Pushing a new
 * action clears the redo stack (standard editor semantics —
 * branching from a redo point invalidates the redoable future).
 *
 * Memory: each entry holds two closures + a string. With 10 entries
 * and typical closures (~few KB each via captured state) this is
 * well under 100 KB total. Not a concern.
 *
 * Caller responsibility — the closures should be pure-ish:
 *   - `undo` reverts the action (e.g. re-create the deleted card)
 *   - `redo` re-applies it (e.g. delete the card again)
 *   - Both should reach into the canonical store, NOT capture stale
 *     props. Use ref patterns if the action depends on state that
 *     might change between push and execution.
 */

import { useSyncExternalStore } from 'react';

export interface UndoEntry {
  /** Short user-facing label, shown in the post-undo toast. e.g.
   *  "카드 추가", "스페이스 이름 변경". */
  description: string;
  /** Reverts the action. Called by Ctrl+Z. */
  undo: () => void;
  /** Re-applies the action. Called by Ctrl+Shift+Z. */
  redo: () => void;
}

interface UndoState {
  past: UndoEntry[];
  future: UndoEntry[];
}

const MAX_DEPTH = 10;

let snapshot: UndoState = { past: [], future: [] };
const listeners = new Set<() => void>();

function setState(updater: (prev: UndoState) => UndoState) {
  const next = updater(snapshot);
  if (next === snapshot) return;
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): UndoState { return snapshot; }

/** Hook for components that want to render undo/redo affordances
 *  (e.g. the disabled-state of an undo menu item). Most callers
 *  only need the action functions below. */
export function useUndoStack() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Push a new undoable action onto the stack. Clears the redo
 *  stack — the new action invalidates any redo branch. */
export function pushUndo(entry: UndoEntry): void {
  setState(prev => {
    const past = [...prev.past, entry];
    if (past.length > MAX_DEPTH) past.splice(0, past.length - MAX_DEPTH);
    return { past, future: [] };
  });
}

/** Pop the latest action and run its undo. Returns the entry so the
 *  caller can show a "되돌렸어요: <desc>" toast. */
export function performUndo(): UndoEntry | null {
  const cur = snapshot;
  if (cur.past.length === 0) return null;
  const entry = cur.past[cur.past.length - 1];
  setState(prev => ({
    past: prev.past.slice(0, -1),
    future: [...prev.future, entry],
  }));
  try { entry.undo(); } catch (e) { console.warn('[undo] handler threw', e); }
  return entry;
}

/** Pop the latest redo entry and re-run its action. */
export function performRedo(): UndoEntry | null {
  const cur = snapshot;
  if (cur.future.length === 0) return null;
  const entry = cur.future[cur.future.length - 1];
  setState(prev => ({
    past: [...prev.past, entry],
    future: prev.future.slice(0, -1),
  }));
  try { entry.redo(); } catch (e) { console.warn('[redo] handler threw', e); }
  return entry;
}

/** Wipe everything. Called on user logout / large data swap (e.g.
 *  importing a different export) where the existing closures would
 *  reference deleted entities. */
export function clearUndoStack(): void {
  setState(() => ({ past: [], future: [] }));
}
