import { useEffect } from 'react';
import { electronAPI } from '../electronBridge';

/**
 * Build the favicon-fetch candidate list for a URL. Tries high-resolution
 * sources first (apple-touch-icon, Google s2 sz=256) and falls back to
 * generic /favicon.ico and DuckDuckGo's mirror. Order matters: the first
 * candidate that returns a real (non-placeholder) image wins in
 * download-favicon (main.js).
 *
 * Exported so the startup migration in App.tsx can reuse the same list.
 */
export function faviconCandidates(inputUrl: string): string[] {
  try {
    const u = new URL(inputUrl);
    const { origin, hostname } = u;
    return [
      `${origin}/apple-touch-icon.png`,
      `${origin}/apple-touch-icon-precomposed.png`,
      `https://www.google.com/s2/favicons?domain=${hostname}&sz=256`,
      `${origin}/favicon.ico`,
      `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
    ];
  } catch { return []; }
}

/**
 * Normalize bare hostnames ("example.com") to https URLs and pass through
 * anything that already has a scheme. Returns null for inputs that can't
 * be coerced into a URL.
 */
export function ensureHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(v)) return `https://${v}`;
  return null;
}

interface UseFaviconAutoFetchOpts {
  /** Source URL — already-normalized via ensureHttpUrl, or raw input. */
  url: string | null;
  /** Gate the fetch (e.g. only when type is 'url' and the user hasn't
   *  manually overridden the icon). */
  enabled: boolean;
  /** Called once with the resolved data URL, or null on full failure. */
  onResolved: (dataUrl: string | null) => void;
}

/**
 * Auto-fetch a favicon as a data URL whenever `url` changes (and the gate
 * is enabled). The result is delivered through `onResolved` so callers can
 * decide whether to mutate form state, fall back to a Material symbol,
 * etc.
 *
 * Memoize `onResolved` (useCallback) at the call site — this hook
 * intentionally does not include it in its dep list so a fresh callback
 * doesn't cancel an in-flight fetch on every render.
 */
export function useFaviconAutoFetch({ url, enabled, onResolved }: UseFaviconAutoFetchOpts) {
  useEffect(() => {
    if (!enabled) return;
    const normalized = ensureHttpUrl(url);
    if (!normalized) return;

    let cancelled = false;
    (async () => {
      const candidates = faviconCandidates(normalized);
      const dataUrl = await electronAPI.downloadFavicon(candidates);
      if (cancelled) return;
      onResolved(dataUrl);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled]);
}

/**
 * One-shot imperative variant for a "refresh icon" button or save-time
 * fallback. Same fetch path as useFaviconAutoFetch.
 */
export async function fetchFaviconDataUrl(url: string | null | undefined): Promise<string | null> {
  const normalized = ensureHttpUrl(url ?? null);
  if (!normalized) return null;
  return electronAPI.downloadFavicon(faviconCandidates(normalized));
}
