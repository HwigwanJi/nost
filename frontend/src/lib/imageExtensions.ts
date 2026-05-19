/**
 * Image extension SSOT for the `'image'` card type (v1.3.46+).
 *
 * Used by:
 *   - `App.tsx::inferItemFromPath` — drop a file → classify as image
 *   - `main.js::analyze-clipboard` — text-based path classification
 *     paired with binary clipboard detection
 *   - `ItemCard` thumbnail render — pick image MIME from extension
 *
 * Kept separate from `documentExtensions.ts` because images don't
 * participate in the doc-cohort grouping system (those are doc-only)
 * and have a fundamentally different storage model (binary on disk,
 * not version-tracked text).
 */

export const DEFAULT_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
] as const;

const _SET: ReadonlySet<string> = new Set(DEFAULT_IMAGE_EXTENSIONS);

/** True when the extension (without dot, case-insensitive) is a known
 *  image format. Empty string / null / undefined returns false. */
export function isImageExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  return _SET.has(ext.toLowerCase().replace(/^\./, ''));
}

/** Extract extension from a path/URL and test. */
export function isImagePath(p: string | null | undefined): boolean {
  if (!p) return false;
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(p);
  return !!m && isImageExt(m[1]);
}

/** Map an extension (or a path) to a likely MIME type. Returns
 *  'application/octet-stream' when unknown — caller can decide what
 *  to do. SVG returns 'image/svg+xml' (not 'image/svg'). */
export function mimeFromExt(extOrPath: string): string {
  const m = /\.?([a-z0-9]+)$/i.exec(extOrPath);
  const ext = (m?.[1] ?? extOrPath).toLowerCase();
  switch (ext) {
    case 'png':  return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif':  return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp':  return 'image/bmp';
    case 'svg':  return 'image/svg+xml';
    case 'ico':  return 'image/x-icon';
    case 'avif': return 'image/avif';
    default:     return 'application/octet-stream';
  }
}
