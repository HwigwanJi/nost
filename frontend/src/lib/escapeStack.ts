/**
 * Escape stack — SSOT for "what happens when ESC is pressed."
 *
 * Problem this solves:
 *   The launcher has many overlay surfaces (memo editor, dialogs,
 *   notification popover, mode toasts) and they need different ESC
 *   semantics depending on which is on top:
 *
 *     - Memo editor open  → ESC closes the editor (NOT the app)
 *     - Tour modal open   → ESC closes the modal (NOT the editor under)
 *     - No overlay open   → ESC exits tool mode / hides the app
 *
 *   Without a single arbiter, every component has to know about every
 *   other component's ESC priority. We've already had bugs from this:
 *   ESC inside the memo editor falling through to the global handler
 *   and triggering a node-mode save; ESC during a tile overlay being
 *   consumed by the wrong layer; etc.
 *
 * Solution:
 *   A LIFO stack of "ESC handlers." Components that take over the UI
 *   surface (modal/sheet/popover) push a handler on mount and pop on
 *   unmount. The global ESC listener in App.tsx calls `runTopEscape()`
 *   FIRST — if it returns true, the event was handled by the topmost
 *   overlay and the global priority list is skipped.
 *
 *   Stack semantics: last pushed = topmost = wins.
 *   Each handler is called at most once per ESC. Idempotent.
 *
 * Why a module singleton (not React context):
 *   - ESC is a global event; the listener also lives on `window`.
 *   - Components in different render trees (portals, badge overlay)
 *     need to register too — context boundaries would force a wrapping
 *     provider in every render tree.
 *   - The stack is a tiny array and is genuinely process-wide state.
 *
 * Usage:
 *
 *     useEffect(() => {
 *       if (!isOpen) return;
 *       return pushEscape(() => onClose());
 *     }, [isOpen, onClose]);
 *
 *   The returned function pops the handler, so React's effect-cleanup
 *   path handles teardown for free.
 */

type EscapeHandler = () => void;

const stack: EscapeHandler[] = [];

/**
 * Register a handler. Returns an unregister function (call on unmount).
 * Order: last-pushed = topmost = first-to-run.
 */
export function pushEscape(handler: EscapeHandler): () => void {
  stack.push(handler);
  return () => {
    // Remove THIS specific handler (not just pop) — overlays can
    // unmount out of order if React batches state changes weirdly,
    // and a naive pop would corrupt the stack.
    const idx = stack.lastIndexOf(handler);
    if (idx >= 0) stack.splice(idx, 1);
  };
}

/**
 * Fire the topmost handler if there is one. Returns true if a handler
 * ran (so callers know to skip their own ESC priority chain).
 */
export function runTopEscape(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  try { top(); } catch { /* don't poison the stack on a buggy handler */ }
  return true;
}

/**
 * Inspect (e.g. for telemetry / debug). Don't mutate from here.
 */
export function escapeStackDepth(): number {
  return stack.length;
}
