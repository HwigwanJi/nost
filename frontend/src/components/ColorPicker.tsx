import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { useState, useEffect } from 'react';

const PRESETS = [
  '#000000', '#ffffff', '#71717a', '#ef4444', 
  '#f59e0b', '#22c55e', '#0ea5e9', '#6366f1',
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  children: React.ReactNode;
}

// Minimal Color Math
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};

const rgbToHex = (r: number, g: number, b: number) => 
  "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);

const rgbToCmyk = (r: number, g: number, b: number) => {
  const k = 1 - Math.max(r / 255, g / 255, b / 255);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = Math.round((1 - r / 255 - k) / (1 - k) * 100);
  const m = Math.round((1 - g / 255 - k) / (1 - k) * 100);
  const y = Math.round((1 - b / 255 - k) / (1 - k) * 100);
  return { c, m, y, k: Math.round(k * 100) };
};

const cmykToRgb = (c: number, m: number, y: number, k: number) => {
  const r = 255 * (1 - c / 100) * (1 - k / 100);
  const g = 255 * (1 - m / 100) * (1 - k / 100);
  const b = 255 * (1 - y / 100) * (1 - k / 100);
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
};

export function ColorPicker({ value, onChange, children }: ColorPickerProps) {
  const [rgb, setRgb] = useState(() => hexToRgb(value || '#ffffff'));
  const [cmyk, setCmyk] = useState(() => rgbToCmyk(rgb.r, rgb.g, rgb.b));

  useEffect(() => {
    const nextRgb = hexToRgb(value || '#ffffff');
    setRgb(nextRgb);
    setCmyk(rgbToCmyk(nextRgb.r, nextRgb.g, nextRgb.b));
  }, [value]);

  const handleCmykChange = (key: keyof typeof cmyk, val: number) => {
    const nextCmyk = { ...cmyk, [key]: val };
    const nextRgb = cmykToRgb(nextCmyk.c, nextCmyk.m, nextCmyk.y, nextCmyk.k);
    setCmyk(nextCmyk);
    setRgb(nextRgb);
    onChange(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b));
  };

  return (
    <Popover>
      <PopoverTrigger render={<span className="contents" />}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-4 flex flex-col gap-5">
        <header className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Color Picker</span>
          <div className="w-10 h-4 rounded-sm border border-border-rgba shadow-inner" style={{ background: value || '#fff' }} />
        </header>

        {/* Presets */}
        <div className="flex gap-2">
          {PRESETS.map(p => (
            <button
              key={p}
              onClick={() => onChange(p)}
              className="w-5 h-5 rounded-md border border-border-rgba transition-transform active:scale-90"
              style={{ background: p }}
            />
          ))}
        </div>

        {/* CMYK Sliders */}
        <div className="grid gap-4">
          {(['c', 'm', 'y', 'k'] as const).map(key => (
            <div key={key} className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">{key}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{cmyk[key]}%</span>
              </div>
              <Slider
                value={[cmyk[key]]}
                max={100}
                step={1}
                onValueChange={(val) => {
                  const v = Array.isArray(val) ? val[0] : val;
                  handleCmykChange(key, v);
                }}
              />
            </div>
          ))}
        </div>

        {/* Hex Input */}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Hex</span>
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="flex-1 bg-surface border border-border-rgba rounded px-2 py-1 text-xs font-mono outline-none focus:border-border-focus"
          />
        </div>

        <button
          onClick={() => onChange('')}
          className="text-[10px] text-muted-foreground hover:text-foreground text-left transition-colors"
        >
          Reset to default
        </button>
      </PopoverContent>
    </Popover>
  );
}
