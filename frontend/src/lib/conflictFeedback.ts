/**
 * Conflict feedback — visible/audible reaction when canPerform()
 * blocks an action. See `plans/conflict-avoidance-policy.md` §4.
 *
 * Two flavours:
 *   shakeElement(el)         — element-anchored micro-shake (80ms,
 *                              ±2px). Use when the trigger has a DOM
 *                              target (a card the user clicked).
 *   blockToast(message, ...) — toast surfaced via the app's existing
 *                              queue. Use when the trigger is global
 *                              (hotkey, slash command, tray click).
 *
 * Why a single util: the response to a block has to FEEL consistent
 * across every surface — same shake amplitude, same toast duration,
 * same wording cadence. A per-callsite ad-hoc setTimeout would drift.
 */

/** Inject the shake keyframe once, on module load. Cheap; idempotent. */
let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected || typeof document === 'undefined') return;
  keyframesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-nost-conflict', 'true');
  style.textContent = `
    @keyframes nost-conflict-shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-2px); }
      40% { transform: translateX(2px); }
      60% { transform: translateX(-2px); }
      80% { transform: translateX(1px); }
    }
  `;
  document.head.appendChild(style);
}

/** Briefly shake `el` to signal "blocked." Animation auto-clears so
 *  the element returns to its resting transform; we also clear any
 *  in-flight animation first so repeated rejection clicks all fire
 *  fresh instead of compounding mid-keyframe. */
export function shakeElement(el: HTMLElement | null | undefined): void {
  if (!el) return;
  ensureKeyframes();
  // Reset by removing the animation; the next paint re-applies.
  el.style.animation = 'none';
  // Force reflow so the browser registers the reset before we
  // re-apply. void reads currentTime — cheaper alternatives drift on
  // Chromium 121+.
  void el.offsetWidth;
  el.style.animation = 'nost-conflict-shake 220ms cubic-bezier(0.4, 0, 0.6, 1)';
  // Clear after animation so the inline style doesn't accumulate.
  const onEnd = () => {
    el.style.animation = '';
    el.removeEventListener('animationend', onEnd);
  };
  el.addEventListener('animationend', onEnd);
}

/** Recommended toast options for a block — short, low priority,
 *  no actions. The caller passes its own showToast (we don't import
 *  the toast queue here because this file lives below the React tree
 *  and the toast hook can't be called outside a component). */
export const BLOCK_TOAST_DEFAULTS = {
  duration: 1500,
  immediate: false,
} as const;
