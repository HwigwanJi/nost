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

  /** "Inside card" — the bounded interactive zone (swipe surface /
   *  colour block / play-pause pill). Compromise between the music
   *  widget's compact pill (~30) and the memo/color block (~50);
   *  the user mandate was "average and unify, don't half-do it." */
  insideHeight: 38,

  /** Inside card horizontal margin from the outer card edge. Same
   *  on the L and R; lets the bottom T-split row sit edge-to-edge
   *  while the inside card hangs above it as a smaller bounded
   *  shape. The differential width is what makes the T silhouette. */
  insideMarginX: 12,
  /** Inside card top offset from the outer card edge. Now matches
   *  insideMarginBottom so the inside card sits visually centered
   *  in the available room above the T-split footer (52 px of slack:
   *  7 + 38 + 7 = 52). The user pointed out earlier that the inside
   *  card was hugging the T-shape — equal margins above & below the
   *  inside card balance the silhouette. */
  insideMarginTop: 7,
  /** Inside card bottom offset (gap between inside card and the
   *  T-split footer). New in v6 of the family-look pass — was 0
   *  before, which made the inside card visually fall into the
   *  T-shape rather than float above it. */
  insideMarginBottom: 7,

  /** Bottom T-split row — a SINGLE wide region split into 2 (or 3)
   *  cells via vertical 1px dividers. Replaces the previous "row of
   *  small icon buttons" pattern which felt cheap. Each cell is a
   *  generous tap target filling its grid column. The 1px top
   *  border + center divider together form the T silhouette
   *  underneath the inside card. */
  bottomRowHeight: 30,

  /** Legacy aliases — preserved so MediaWidget and any pre-rewrite
   *  callers don't break while we migrate. New code uses insideHeight
   *  / bottomRowHeight. Will be removed in a future cleanup. */
  secondaryHeight: 22,
  secondaryGap: 8,
  secondaryBtnSize: 22,

  /** Top-left status dot (when applicable — media accent dot,
   *  memo TTL dot). Small is pretty (user mandate); the colour
   *  carries the urgency, the dot just needs to be findable. */
  statusDotSize: 5,
  statusDotTop: 7,
  statusDotLeft: 9,
} as const;

/**
 * Single-action tooltip — for a button or icon with one purpose.
 * Shortcut appears in parens after the label so the user picks up
 * the keybinding on second hover.
 *
 *   WIDGET_TIP('복사', 'Ctrl+Shift+C')  → "복사 (Ctrl+Shift+C)"
 *   WIDGET_TIP('피커')                  → "피커"
 */
export function WIDGET_TIP(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}

/**
 * Multi-action tooltip — for surfaces that respond to several
 * gestures (tap, hold-popup, swipe, …). Renders as a multi-line
 * tooltip with one `라벨 : 동작` row per entry.
 *
 *   HOVER_HINT({
 *     '짧게': '앱 실행',
 *     '길게': '↑수정 ↓모니터 ←새창 →복사',
 *   })
 *
 * Renders to:
 *   짧게 : 앱 실행
 *   길게 : ↑수정 ↓모니터 ←새창 →복사
 *
 * Falsy values are filtered out so callers can conditionally
 * include rows without runtime checks. The colon is space-padded
 * (`라벨 : 값`) — design-system rule per user's directive that
 * tooltips read as a clean two-column ledger, not a sentence.
 *
 * Why multi-line in the `title` attribute: Chromium renders `\n`
 * as line breaks in native tooltips. Same trick the OS file
 * picker uses for path + size on hover.
 */
export function HOVER_HINT(actions: Record<string, string | null | undefined | false>): string {
  return Object.entries(actions)
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([label, value]) => `${label} : ${value}`)
    .join('\n');
}
