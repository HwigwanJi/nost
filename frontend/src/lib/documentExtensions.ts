// ── Document file extension registry ────────────────────────────
// Default list — users can add/remove in Settings

export const DEFAULT_DOCUMENT_EXTENSIONS: string[] = [
  // Microsoft Office
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // 한컴
  'hwp', 'hwpx', 'hwt',
  // PDF & text
  'pdf', 'txt', 'md', 'csv',
  // Open formats
  'odt', 'ods', 'odp',
];

/** Returns the extensions to use: saved list or defaults */
export function getDocumentExtensions(saved?: string[]): string[] {
  return saved && saved.length > 0 ? saved : DEFAULT_DOCUMENT_EXTENSIONS;
}

/** Check if a file path is a document based on extension */
export function isDocumentPath(filePath: string, extensions: string[]): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return ext.length > 0 && extensions.includes(ext);
}

/** Check if a path looks like a folder (no extension, or ends with \) */
export function isFolderPath(p: string): boolean {
  if (p.endsWith('\\') || p.endsWith('/')) return true;
  const last = p.split(/[\\/]/).pop() ?? '';
  return !last.includes('.');
}

/** Check if a path is an executable */
export function isExePath(p: string): boolean {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return ['exe', 'bat', 'cmd', 'lnk', 'msi'].includes(ext);
}

/** Detect type from a clipboard string */
export function detectClipboardType(
  text: string,
  docExtensions: string[],
): 'url' | 'app' | 'folder' | 'doc' | 'text' | null {
  const t = text.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return 'url';
  // Windows absolute path
  if (/^[a-zA-Z]:[\\\/]/.test(t) || t.startsWith('\\\\')) {
    if (isExePath(t)) return 'app';
    if (isDocumentPath(t, docExtensions)) return 'doc';
    if (isFolderPath(t)) return 'folder';
  }
  return 'text';
}

/** Suggest a display name from a value */
export function suggestName(type: string, value: string): string {
  if (type === 'url') {
    try {
      const url = new URL(value);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return value;
    }
  }
  if (type === 'app' || type === 'folder' || type === 'doc') {
    const parts = value.replace(/\\/g, '/').split('/');
    const last = parts[parts.length - 1] || parts[parts.length - 2] || value;
    // Remove extension for documents/apps
    return last.replace(/\.[^.]+$/, '') || last;
  }
  if (type === 'cmd') {
    return value.split(' ')[0];
  }
  return value.slice(0, 30);
}
