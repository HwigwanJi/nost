import type { CSSProperties } from 'react';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Render the FILLED variant (FILL=1) instead of the default outlined
   * one. Use for solid play/pause/skip icons and other "primary action"
   * glyphs where the unfilled stroke version reads as too thin. Other
   * font-variation axes (wght, GRAD, opsz) optionally tuned at the
   * same time so callers can ask for a single semantic instead of
   * raw font-variation strings.
   */
  filled?: boolean;
  /** Stroke weight (Material Symbols wght axis). Default = 400 (normal). */
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
}

export function Icon({ name, size, color, className, style, filled, weight }: IconProps) {
  const combined: CSSProperties = {};
  if (size !== undefined) combined.fontSize = size;
  if (color !== undefined) combined.color = color;
  // Material Symbols variation axes — only emit when caller asks, so
  // the default-token CSS keeps applying everywhere else.
  if (filled || weight !== undefined) {
    const parts: string[] = [];
    if (filled) parts.push('"FILL" 1');
    if (weight !== undefined) parts.push(`"wght" ${weight}`);
    combined.fontVariationSettings = parts.join(', ');
  }
  const finalStyle = style ? { ...combined, ...style } : Object.keys(combined).length ? combined : undefined;

  return (
    <span
      className={`material-symbols-rounded${className ? ` ${className}` : ''}`}
      style={finalStyle}
    >
      {name}
    </span>
  );
}
