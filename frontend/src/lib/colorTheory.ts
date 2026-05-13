/**
 * colorTheory — small palette of harmony helpers used by the colour-
 * swatch widget's swipe gestures.
 *
 * Goal: return another *useful* hex code derived from the input.
 * "Useful" here means a designer would recognise the result as a
 * meaningful relative — not a random hue jitter. We expose two
 * primary relations:
 *
 *   - complementary(hex): hue + 180°. The "opposite" colour. Highest-
 *     contrast partner; common pairing for accent + background.
 *   - analogous(hex): hue + 30°. Sits next to the input on the wheel.
 *     Common in monochromatic + harmonious palettes.
 *
 * Math:
 *   1. hex → RGB (parsing handles 3-char shorthand).
 *   2. RGB → HSL (so we can rotate hue cleanly).
 *   3. Rotate, clamp, back to RGB → hex.
 *
 * We keep saturation and lightness untouched so the resulting colour
 * stays in the same "value family" as the input (a pastel input
 * yields a pastel relative; a bold input yields a bold relative).
 *
 * Falsy / malformed input → returns the input unchanged so callers
 * never have to special-case errors.
 */

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }

export function parseHex(hex: string): RGB | null {
  const s = (hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) {
    const expanded = s.split('').map(c => c + c).join('');
    const n = parseInt(expanded, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  if (/^[0-9a-f]{6}$/i.test(s)) {
    const n = parseInt(s, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  return null;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
      case gn: h = ((bn - rn) / d + 2); break;
      case bn: h = ((rn - gn) / d + 4); break;
    }
    h *= 60;
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const hn = h / 360;
  return {
    r: hueToRgb(hn + 1 / 3) * 255,
    g: hueToRgb(hn) * 255,
    b: hueToRgb(hn - 1 / 3) * 255,
  };
}

/** Rotate hue by `deg` degrees, preserving saturation + lightness. */
export function rotateHue(hex: string, deg: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  const next = { ...hsl, h: (hsl.h + deg + 360) % 360 };
  return rgbToHex(hslToRgb(next));
}

/** Hue + 180°. Highest-contrast partner. */
export function complementary(hex: string): string {
  return rotateHue(hex, 180);
}

/** Hue + 30°. Adjacent on the wheel — harmonious neighbour. */
export function analogous(hex: string): string {
  return rotateHue(hex, 30);
}
