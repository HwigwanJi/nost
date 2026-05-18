import { useEffect } from 'react';

/**
 * Apply the user's theme (light/dark) + accent color to the satellite
 * window's :root, mirroring App.tsx's effects at App.tsx:1863+ and
 * App.tsx:1869+. The satellite HTMLs ship with `class="dark"` as a
 * sensible default, but actual mode must follow the main app — without
 * this hook, switching the launcher to light mode left every satellite
 * stuck in dark.
 *
 * Also injects a one-time stylesheet that hides the inline dialog
 * primitive's backdrop overlay in satellite windows. In the inline
 * (main-window) layout the overlay dims the rest of the app behind the
 * dialog; in a satellite, the satellite window IS the dialog, so an
 * overlay just paints a translucent veil across the whole transparent
 * window — visible as an unwanted off-white rectangle on light desktops.
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

  // One-time overlay-hide rule. Stable id so multiple hook callers in
  // the same document don't duplicate the <style>.
  useEffect(() => {
    if (document.getElementById('__nost_satellite_style')) return;
    const s = document.createElement('style');
    s.id = '__nost_satellite_style';
    s.textContent = `
      /* Hide the dialog primitive's full-viewport backdrop in satellites
         — the satellite window itself replaces the inline backdrop. */
      [data-slot="dialog-overlay"] { display: none !important; }
    `;
    document.head.appendChild(s);
  }, []);
}
