import type { CSSProperties } from 'react';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size, color, className, style }: IconProps) {
  const combined: CSSProperties = {};
  if (size !== undefined) combined.fontSize = size;
  if (color !== undefined) combined.color = color;
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
