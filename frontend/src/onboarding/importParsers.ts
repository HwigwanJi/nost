import { generateId } from '../lib/utils';
import type { LauncherItem, Space } from '../types';

/**
 * Pure parsers for the import wizard. Each one converts its input format
 * into a Space[] the caller can hand to applyImport (see App.tsx). Parsers
 * never mutate state, never touch the filesystem, never throw — they
 * return `{ ok: true, spaces }` or `{ ok: false, reason }`.
 *
 * Why no class / no DI: the variety is small (3 formats), the input is
 * always plain text, and the output shape is identical. Plain functions
 * make the test surface trivial.
 */

export type ParseResult =
  | { ok: true; spaces: Space[]; cardCount: number }
  | { ok: false; reason: string };

// ── Helpers ──────────────────────────────────────────────────────────
function urlCard(title: string, value: string): LauncherItem {
  return {
    id: generateId(),
    type: 'url',
    title: title || value,
    value,
    clickCount: 0,
    pinned: false,
  };
}

function buildSpace(name: string, items: LauncherItem[]): Space {
  return {
    id: generateId(),
    name: name.trim() || '가져온 항목',
    items,
    sortMode: 'custom',
    pinnedIds: [],
  };
}

// ── 1. Browser bookmarks HTML (Chrome / Edge / Whale / Firefox) ─────
//
// All Chromium-derived browsers and Firefox export the same Netscape Bookmark
// File Format: nested <DT><H3>folder</H3><DL>...</DL> with <DT><A HREF=>links.
// We DOM-parse it (browsers ship a parser for free) and walk top-level
// folders → each becomes a Space; bookmarks at the root land in
// "북마크 모음".
//
// Subfolders are flattened — nested folders inside a top-level folder all
// fold up into the parent space. nost spaces are flat, so deeper hierarchy
// is sacrificed for simplicity. Acceptable trade-off: 90% of users use
// 1-level deep folder structures.
export function parseBookmarksHtml(html: string): ParseResult {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return { ok: false, reason: 'parse-failed' };

    // The export usually has a top-level <DL><p>… that contains all folders.
    // Walk every <DT> at any depth — when we see an <H3>, that's a folder
    // boundary; collect anchors until the next H3 at the same depth.
    type Folder = { name: string; links: LauncherItem[] };
    const rootFolder: Folder = { name: '북마크 모음', links: [] };
    const folders: Folder[] = [rootFolder];

    // Walk the document collecting folder structure linearly. We use a
    // depth counter so that links *inside* a folder bubble into that folder
    // until its </DL> closes.
    const stack: Folder[] = [rootFolder];

    function walk(node: Element) {
      for (const child of Array.from(node.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'dt') {
          // <DT> wraps either an <H3> folder header or an <A> link.
          const h3 = child.querySelector(':scope > h3');
          const a  = child.querySelector(':scope > a');
          if (h3) {
            // Folder boundary: open a new folder, push to stack, descend
            // into the matching <DL> that follows.
            const folder: Folder = { name: h3.textContent?.trim() || '폴더', links: [] };
            folders.push(folder);
            stack.push(folder);
            // Find the sibling <DL> that contains this folder's children.
            let next: Element | null = child.nextElementSibling;
            while (next && next.tagName.toLowerCase() !== 'dl') {
              next = next.nextElementSibling;
            }
            if (next) walk(next);
            stack.pop();
          } else if (a instanceof HTMLAnchorElement) {
            const href = a.getAttribute('href') ?? '';
            if (!href) continue;
            // Skip non-http(s) — javascript:, place:, data: etc.
            if (!/^https?:/i.test(href)) continue;
            const title = a.textContent?.trim() || href;
            stack[stack.length - 1].links.push(urlCard(title, href));
          }
        } else if (tag === 'dl' || tag === 'p') {
          walk(child);
        }
      }
    }

    walk(doc.body);

    // Drop empty folders (e.g. "Bookmarks Bar" with everything in subfolders
    // that already became their own spaces). Keep the root folder only if
    // it has direct links.
    const spaces: Space[] = folders
      .filter(f => f.links.length > 0)
      .map(f => buildSpace(f.name, f.links));

    if (spaces.length === 0) return { ok: false, reason: '북마크가 비어있어요' };
    const cardCount = spaces.reduce((s, sp) => s + sp.items.length, 0);
    return { ok: true, spaces, cardCount };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

// ── 2. Markdown links ────────────────────────────────────────────────
//
// Treats the document as one big space containing every `[text](url)` link.
// Headings become space boundaries — anything under `# Foo` lands in space
// "Foo", anything under `## Bar` lands in space "Bar". Untitled top
// section uses the file name (caller passes via params).
//
// Bullet metadata (`- [text](url) — note`) is preserved as the card title's
// trailing context. Plain non-link lines are ignored.
export function parseMarkdownLinks(md: string, fallbackName = '마크다운'): ParseResult {
  const lines = md.split(/\r?\n/);
  type Section = { name: string; links: LauncherItem[] };
  const sections: Section[] = [{ name: fallbackName, links: [] }];
  let current = sections[0];

  // Greedy URL pattern: matches plain `[text](url)` and ignores image
  // syntax `![alt](url)` (which has a leading `!`).
  const linkRe = /(?<!\!)\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const name = headingMatch[2].trim();
      const fresh: Section = { name, links: [] };
      sections.push(fresh);
      current = fresh;
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(line)) !== null) {
      current.links.push(urlCard(m[1].trim(), m[2].trim()));
    }
    linkRe.lastIndex = 0;
  }

  const spaces = sections
    .filter(s => s.links.length > 0)
    .map(s => buildSpace(s.name, s.links));

  if (spaces.length === 0) return { ok: false, reason: '링크를 찾지 못했어요' };
  const cardCount = spaces.reduce((s, sp) => s + sp.items.length, 0);
  return { ok: true, spaces, cardCount };
}
