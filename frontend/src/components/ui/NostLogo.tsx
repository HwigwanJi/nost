import type { CSSProperties } from 'react';

interface NostLogoProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
}

/**
 * Official nost "n" letterform — extracted from icon.svg (viewBox 0 0 512 512).
 * Used wherever an inline logo mark is needed (sidebar, header, loading screen).
 * The background rect is NOT included so the parent can supply its own container
 * shape and colour.
 */
export function NostLogo({ size = 16, color = 'currentColor', style }: NostLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <path
        d="M 116 418 L 116 196 Q 116 88 256 88 Q 396 88 396 196 L 396 418 L 326 418 L 326 212 Q 326 158 256 158 Q 186 158 186 212 L 186 418 Z"
        fill={color}
      />
    </svg>
  );
}
