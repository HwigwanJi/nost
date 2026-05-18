import { useEffect } from 'react';

/**
 * Apply the user's theme (light/dark) + accent color to the satellite
 * window's :root, mirroring App.tsx's effects at App.tsx:1863+ and
 * App.tsx:1869+. The satellite HTMLs ship with `class="dark"` as a
 * sensible default, but actual mode must follow the main app — without
 * this hook, switching the launcher to light mode left every satellite
 * stuck in dark.
 *
 * Theme passing arrives via the state push protocol; satellites that
 * forget to include it stay on the default dark theme.
 */
export function useSatelliteTheme(state: { theme?: 'light' | 'dark'; accentColor?: string } | null | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (state?.theme === 'dark') root.classList.add('dark');
    else if (state?.theme === 'light') root.classList.remove('dark');
    // If theme is undefined (older state push or transitional), leave
    // the HTML's default 'dark' class as-is — better than flashing.
  }, [state?.theme]);

  useEffect(() => {
    const accent = state?.accentColor || '#6366f1';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-dim', accent + '33');
  }, [state?.accentColor]);
}
