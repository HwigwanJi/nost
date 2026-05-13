import { useEffect, useState, type CSSProperties } from 'react';

/**
 * First-card celebration — a one-shot confetti burst the moment a brand-new
 * user adds their very first card. Shows once per device (key in
 * localStorage) so subsequent adds don't trigger; the goal is a small
 * dopamine hit during onboarding, not noise on every action.
 *
 * Implementation choices:
 *   - Pure CSS keyframe particles, NO external library (no canvas-confetti
 *     dependency). Twelve <span>s burst out from the cursor anchor over
 *     ~900ms then unmount. Zero load when not active.
 *   - Trigger via a CustomEvent (`nost:first-card-celebrate`) so the App
 *     code stays decoupled — we listen here, and any add-card site that
 *     wants to fire it dispatches the event.
 *   - Anchor coords come from the event detail (clientX/clientY) so the
 *     burst originates at the just-added card, wherever that may be on
 *     screen. Falls back to viewport center.
 */

const STORAGE_KEY = 'nost-first-card-celebrated';

interface BurstState {
  id: number;
  x: number;
  y: number;
}

export function FirstCardCelebration() {
  const [bursts, setBursts] = useState<BurstState[]>([]);

  useEffect(() => {
    const onFire = (e: Event) => {
      // Already celebrated on this device → ignore.
      if (localStorage.getItem(STORAGE_KEY)) return;
      const detail = (e as CustomEvent).detail ?? {};
      const x = typeof detail.x === 'number' ? detail.x : window.innerWidth / 2;
      const y = typeof detail.y === 'number' ? detail.y : window.innerHeight / 2;
      const id = Date.now();
      setBursts(prev => [...prev, { id, x, y }]);
      localStorage.setItem(STORAGE_KEY, '1');
      // Auto-cleanup after the longest particle lifetime + a margin.
      setTimeout(() => setBursts(prev => prev.filter(b => b.id !== id)), 1100);
    };
    window.addEventListener('nost:first-card-celebrate', onFire);
    return () => window.removeEventListener('nost:first-card-celebrate', onFire);
  }, []);

  if (bursts.length === 0) return null;

  return (
    <>
      <style>{KEYFRAMES}</style>
      {bursts.map(b => <Burst key={b.id} x={b.x} y={b.y} />)}
    </>
  );
}

const PARTICLE_COUNT = 14;
const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#0ea5e9', '#a855f7'];

function Burst({ x, y }: { x: number; y: number }) {
  const root: CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    width: 0, height: 0,
    pointerEvents: 'none',
    zIndex: 9500,
  };
  return (
    <div style={root}>
      {/* Center pulse ring */}
      <span style={{
        position: 'absolute',
        left: -22, top: -22,
        width: 44, height: 44,
        borderRadius: '50%',
        border: '2px solid #6366f1',
        animation: 'nost-celebrate-ring 600ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
      }} />
      {/* "+1" label */}
      <span style={{
        position: 'absolute',
        left: -10, top: -20,
        fontSize: 14, fontWeight: 800,
        color: '#22c55e',
        animation: 'nost-celebrate-label 900ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
        pointerEvents: 'none',
        textShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>+1</span>
      {/* Confetti particles */}
      {Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + (Math.random() * 0.4 - 0.2);
        const distance = 60 + Math.random() * 50;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        const color = COLORS[i % COLORS.length];
        const size = 5 + Math.random() * 4;
        const delay = Math.random() * 60;
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: -size / 2,
              top: -size / 2,
              width: size,
              height: size,
              background: color,
              borderRadius: i % 3 === 0 ? '50%' : 2,
              // CSS custom properties consumed by the keyframe.
              ['--nost-dx' as any]: `${dx}px`,
              ['--nost-dy' as any]: `${dy}px`,
              animation: `nost-celebrate-particle 880ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms forwards`,
              opacity: 0,
            }}
          />
        );
      })}
    </div>
  );
}

const KEYFRAMES = `
  @keyframes nost-celebrate-ring {
    0%   { transform: scale(0.2); opacity: 0.8; }
    100% { transform: scale(2.4); opacity: 0; }
  }
  @keyframes nost-celebrate-label {
    0%   { opacity: 0; transform: translateY(0)   scale(0.8); }
    25%  { opacity: 1; transform: translateY(-12px) scale(1.1); }
    100% { opacity: 0; transform: translateY(-46px) scale(1); }
  }
  @keyframes nost-celebrate-particle {
    0%   { opacity: 0;  transform: translate(0, 0) scale(0.4) rotate(0deg); }
    18%  { opacity: 1;  transform: translate(calc(var(--nost-dx) * 0.45), calc(var(--nost-dy) * 0.45 - 8px)) scale(1) rotate(140deg); }
    100% { opacity: 0;  transform: translate(var(--nost-dx), calc(var(--nost-dy) + 20px)) scale(0.6) rotate(420deg); }
  }
`;

/**
 * Helper for callers — fire the celebration with optional anchor coords.
 * Use the event interface in addItem flows so we don't import this module
 * from random places.
 */
export function fireFirstCardCelebration(opts?: { x?: number; y?: number }) {
  window.dispatchEvent(new CustomEvent('nost:first-card-celebrate', { detail: opts ?? {} }));
}
