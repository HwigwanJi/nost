/**
 * widgetTokens — design system primitives for the "widget family"
 * (media / memo / color-swatch, and any future kinds).
 *
 * The user's mandate: three widgets sitting next to each other in the
 * grid should read as ONE family. The music widget is the visual
 * benchmark — bounded inner box for the primary action, calm
 * secondary row underneath, identical outer chrome (height, padding,
 * border-radius) across every kind. This module is the SSOT for
 * those numbers so a future widget kind doesn't drift.
 *
 * Two principles also apply at the affordance level (= add to the
 * design system):
 *
 *   1. ICON-ONLY SECONDARY BUTTONS. Labels live in the tooltip, not
 *      in the visible chrome. A 22 px button with both icon AND
 *      Korean text crowds at the standard card width and forces
 *      ellipsis; an icon alone is unambiguous and gains its label
 *      on hover. Applied to: ColorSwatch (피커 / 편집), MemoCard
 *      (📋 / 💾), MediaWidget (volume).
 *
 *   2. PRIMARY VALUES OPTIONAL ON HOVER. When the widget's *visual*
 *      identity is enough (a colour block IS the colour), the
 *      textual value (hex code) doesn't need to live in the
 *      surface — it can be hover-revealed. Same as iA Writer's
 *      stance on chrome: only show what the user can't infer.
 *
 *      Applied to: ColorSwatch hex code overlay-on-hover.
 *
 * Don't change these values without also looking at every widget
 * that consumes them.
 */

export const WIDGET = {
  /** Outer card height — every card type in nost is exactly this tall.
   *  Hard invariant; the user has flagged any deviation as a bug. */
  cardHeight: 82,

  /** Outer card padding — same as MediaWidget, makes the inner
   *  primary box and the secondary row the same width as the music
   *  transport pill. */
  cardPadding: '8px 12px',

  /** Vertical gap between primary content and secondary row. */
  cardGap: 6,

  /** Outer card radius — matches ItemCard's `rounded-xl`. */
  cardRadius: 12,

  /** Inner primary box (the "play button" / "swipe surface" /
   *  "color block") radius. Always 8 — distinct from the outer 12
   *  so the inner reads as its own bounded element. */
  primaryRadius: 8,

  /** Secondary action-row height. 22 px is enough for an 11 px icon
   *  + 4 px padding × 2; tighter feels cramped, looser breaks the
   *  family vs. the music widget's volume row. */
  secondaryHeight: 22,
  /** Gap between secondary buttons. */
  secondaryGap: 8,
  /** Secondary button square size — same as the music widget's
   *  mute button. */
  secondaryBtnSize: 22,

  /** Top-left status dot (when applicable — media accent dot,
   *  memo TTL dot). Small is pretty (user mandate); the colour
   *  carries the urgency, the dot just needs to be findable. */
  statusDotSize: 5,
  statusDotTop: 7,
  statusDotLeft: 9,
} as const;

/**
 * Apply to any "icon-only" affordance for hover-reveal of the label.
 * Keeps the visible chrome calm; tooltip teaches on demand.
 *
 * Usage:
 *   <button title={WIDGET_TIP('피커')} onClick={...}>
 *     <Icon name="colorize" size={11} />
 *   </button>
 *
 * The wrapper is a function rather than a string so future variants
 * (e.g. shortcut suffix "피커 (Ctrl+P)") can be appended uniformly.
 */
export function WIDGET_TIP(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}
