/**
 * MonitorPicker — proportional visual layout for "어디 띄울까요?"
 *
 * Why a redesign:
 *   The previous picker hard-coded 4 directional slots (W/A/S/D)
 *   around a center button, and mapped each slot to a monitor index
 *   via user settings. Problems:
 *     - 1 monitor → empty wheel, looks broken
 *     - 2 monitors → 2 used, 2 empty; visually unbalanced
 *     - 4+ monitors → doesn't fit at all
 *     - WASD mapping is unintuitive for non-gamers
 *     - No spatial relationship to the user's actual setup
 *
 * New approach: scale the user's REAL monitor layout (positions +
 * sizes from `electronAPI.getMonitors()`) into a small preview
 * canvas. A laptop-and-external-monitor user sees one tall rect
 * next to one short rect, mirroring their physical desk. The
 * cognitive load is essentially zero — "click the screen I want."
 *
 * Robustness:
 *   - 1 monitor   → single rect, no preview chrome (just an "여기" label)
 *   - 2 monitors  → side-by-side or stacked, whichever matches
 *   - 3+ monitors → all rendered, scaled to fit
 *   - Negative coordinates (multi-monitor with primary in middle) →
 *     the bounding-box math handles it: we shift everything by
 *     -minX/-minY before applying the scale.
 *   - Vertically tall monitors (portrait) preserved by aspect ratio.
 *
 * Auto chip stays at the top — separate visual concern (it's not
 * "a monitor," it's "no preference"). The chip lights up when
 * `current === undefined`.
 *
 * Used in two places:
 *   1. The monitor-badge dropdown on a card (compact layout)
 *   2. The hold-popup's "down" sub-mode (wheel layout, larger)
 *
 * Both layouts share the same component — only the size and
 * surrounding chrome differ.
 */

import { Icon } from '@/components/ui/Icon';

interface MonitorInfo {
  index: number;             // 1-based per electron's order
  id?: number;
  isPrimary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

interface Props {
  monitors: MonitorInfo[];
  /** Currently selected monitor index, or undefined = 자동 (let the
   *  launch pipeline decide). */
  value: number | undefined;
  onPick: (monitorIndex: number | undefined) => void;
  /** "compact" → ~180×100 preview (fits dropdown). "wheel" → 220×120
   *  (fits hold-popup glassmorphic disc). */
  size?: 'compact' | 'wheel';
  /** Called when the user clicks the gear glyph beside the preview.
   *  Optional — when omitted, the gear isn't rendered. */
  onOpenSettings?: () => void;
}

const COMPACT = { w: 200, h: 110 };
const WHEEL   = { w: 240, h: 130 };

/** Returns the bounding box of all monitor rects in screen coords. */
function computeBoundingBox(monitors: MonitorInfo[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of monitors) {
    minX = Math.min(minX, m.bounds.x);
    minY = Math.min(minY, m.bounds.y);
    maxX = Math.max(maxX, m.bounds.x + m.bounds.width);
    maxY = Math.max(maxY, m.bounds.y + m.bounds.height);
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

export function MonitorPicker({ monitors, value, onPick, size = 'compact', onOpenSettings }: Props) {
  const dim = size === 'wheel' ? WHEEL : COMPACT;
  const padding = 8;
  const innerW = dim.w - padding * 2;
  const innerH = dim.h - padding * 2;

  // Empty / single-monitor case — no point in scaled previews. Render
  // a single big "여기에 띄워요" pill that just says "this is where
  // it'll land" with the auto chip; saves the user a click.
  const onlyOne = monitors.length <= 1;

  // Multi-monitor: scale to fit while preserving aspect ratio.
  let scale = 1, offsetX = 0, offsetY = 0;
  if (!onlyOne && monitors.length > 0) {
    const box = computeBoundingBox(monitors);
    if (box.width > 0 && box.height > 0) {
      // 0.92 leaves a hair of breathing room on each side
      scale = Math.min(innerW / box.width, innerH / box.height) * 0.92;
      // Centre the bounding box within the preview area
      const scaledW = box.width * scale;
      const scaledH = box.height * scale;
      offsetX = (innerW - scaledW) / 2 - box.minX * scale;
      offsetY = (innerH - scaledH) / 2 - box.minY * scale;
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: padding,
        background: 'var(--bg-rgba)',
        border: size === 'wheel' ? '1px solid var(--border-rgba)' : 'none',
        borderRadius: size === 'wheel' ? 14 : 8,
        boxShadow: size === 'wheel' ? '0 12px 36px rgba(0,0,0,0.32)' : undefined,
        minWidth: dim.w,
      }}
    >
      {/* Header + Auto chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={() => onPick(undefined)}
          title="자동 — 마지막에 띄운 모니터"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px',
            borderRadius: 12,
            border: `1px solid ${value === undefined ? 'var(--accent)' : 'var(--border-rgba)'}`,
            background: value === undefined ? 'var(--accent-dim)' : 'transparent',
            color: value === undefined ? 'var(--accent)' : 'var(--text-muted)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.12s, color 0.12s, border-color 0.12s',
          }}
        >
          <Icon name={value === undefined ? 'check_circle' : 'autorenew'} size={11} />
          자동
        </button>
        <div style={{ flex: 1 }} />
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            title="모니터 설정"
            style={{
              width: 22, height: 22,
              padding: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              borderRadius: 5,
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-color)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)'; }}
          >
            <Icon name="settings" size={11} />
          </button>
        )}
      </div>

      {/* Preview canvas */}
      <div
        style={{
          position: 'relative',
          width: innerW,
          height: innerH,
          background: 'var(--surface)',
          border: '1px solid var(--border-rgba)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {onlyOne ? (
          <SingleMonitorView monitor={monitors[0]} active={value !== undefined} onPick={onPick} />
        ) : (
          monitors.map(m => {
            const left   = m.bounds.x * scale + offsetX;
            const top    = m.bounds.y * scale + offsetY;
            const width  = m.bounds.width  * scale;
            const height = m.bounds.height * scale;
            const active = value === m.index;
            return (
              <button
                key={m.index}
                onClick={() => onPick(m.index)}
                title={`모니터 ${m.index}${m.isPrimary ? ' (주)' : ''} — ${m.bounds.width}×${m.bounds.height}`}
                style={{
                  position: 'absolute',
                  left, top, width, height,
                  // Subtract 2 for the 1px border on each side so
                  // adjacent monitors render with visible separation.
                  marginRight: -1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  background: active ? 'var(--accent)' : 'var(--bg-rgba)',
                  border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-focus)'}`,
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: active ? '#fff' : 'var(--text-color)',
                  transition: 'background 0.15s, border-color 0.15s, transform 0.1s',
                  boxShadow: active ? '0 2px 8px rgba(99,102,241,0.35)' : 'none',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--surface-hover)';
                  }
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--bg-rgba)';
                  }
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                <span style={{ fontSize: Math.min(14, Math.max(9, height * 0.18)), fontWeight: 800, lineHeight: 1 }}>
                  {m.index}
                </span>
                {m.isPrimary && height > 30 && (
                  <span style={{ fontSize: 8, opacity: 0.75, lineHeight: 1, fontWeight: 500 }}>
                    주
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Footer hint — keeps the picker self-explanatory at first sight */}
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.3 }}>
        {monitors.length === 0
          ? '모니터 정보를 불러올 수 없어요'
          : monitors.length === 1
            ? '모니터가 하나라 자동으로 띄워져요'
            : '띄울 모니터를 클릭'}
      </div>
    </div>
  );
}

/* ── Single-monitor view — when there's only one screen ───────── */
function SingleMonitorView({
  monitor, active, onPick,
}: {
  monitor: MonitorInfo | undefined;
  active: boolean;
  onPick: (i: number | undefined) => void;
}) {
  if (!monitor) {
    return (
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-dim)', fontSize: 11,
      }}>
        모니터를 찾을 수 없어요
      </div>
    );
  }
  return (
    <button
      onClick={() => onPick(monitor.index)}
      title={`모니터 ${monitor.index} — ${monitor.bounds.width}×${monitor.bounds.height}`}
      style={{
        position: 'absolute',
        inset: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        background: active ? 'var(--accent)' : 'var(--bg-rgba)',
        color: active ? '#fff' : 'var(--text-color)',
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-focus)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <Icon name="desktop_windows" size={20} />
      <span style={{ fontSize: 11, fontWeight: 600 }}>모니터 {monitor.index}</span>
    </button>
  );
}
