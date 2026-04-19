import { useState, useCallback, useMemo } from 'react';
import { electronAPI } from '../electronBridge';
import { getDocumentExtensions } from '../lib/documentExtensions';
import type { Space, LauncherItem } from '../types';
import { DISMISS_COOLDOWN_MS } from '../types';

export const GHOST_SPACE_ID = '__ghost_recommendations__';

export type GhostDisplayType = 'folder' | 'app' | 'url' | 'document';

// F7 reason chip: tells the user *why* we surfaced this suggestion so they
// can decide whether it's noise or signal at a glance.
export interface GhostReason {
  /** Material Symbol name for the chip icon */
  icon: string;
  /** Short Korean label shown next to the icon */
  label: string;
}

export interface GhostItem {
  title: string;
  value: string;
  type: LauncherItem['type'];
  displayType: GhostDisplayType;
  source: 'open' | 'recent';
  spaceId: string;
  reason: GhostReason;
}

interface UseGhostCardsOptions {
  spaces: Space[];
  /** Map of value → { at: last dismiss epoch ms, count: total dismissals }. See types.ts. */
  dismissals: Record<string, { at: number; count: number }>;
  documentExtensions?: string[];
  onDismiss: (value: string) => void;
}

function shareParentDir(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/\//g, '\\');
  const nb = b.toLowerCase().replace(/\//g, '\\');
  const partsA = na.split('\\').slice(0, -1);
  const partsB = nb.split('\\').slice(0, -1);
  if (partsA.length < 2 || partsB.length < 2) return false;
  return partsA.slice(0, 3).join('\\') === partsB.slice(0, 3).join('\\');
}

function sameDomain(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.replace('www.', '') === new URL(b).hostname.replace('www.', '');
  } catch { return false; }
}

function sameDirectory(a: string, b: string): boolean {
  const dirA = a.toLowerCase().replace(/\//g, '\\').replace(/\\[^\\]+$/, '');
  const dirB = b.toLowerCase().replace(/\//g, '\\').replace(/\\[^\\]+$/, '');
  return dirA === dirB;
}

/** Returns { spaceId, score }. score=0 means no match → goes to ghost space */
function matchToSpace(candidate: { type: string; value: string }, spaces: Space[]): { spaceId: string; score: number } {
  if (spaces.length === 0) return { spaceId: GHOST_SPACE_ID, score: 0 };
  let bestScore = 0;
  let bestSpace = GHOST_SPACE_ID;

  for (const space of spaces) {
    let score = 0;
    if (space.items.some(i => i.type === candidate.type)) score += 1;

    if (candidate.type === 'folder') {
      if (space.items.some(i => i.type === 'folder' && shareParentDir(i.value, candidate.value))) score += 3;
    }
    if (candidate.type === 'url') {
      if (space.items.some(i => (i.type === 'url' || i.type === 'browser') && sameDomain(i.value, candidate.value))) score += 2;
    }
    if (candidate.type === 'app') {
      if (space.items.some(i => i.type === 'app' && sameDirectory(i.value, candidate.value))) score += 2;
    }

    if (score > bestScore) { bestScore = score; bestSpace = space.id; }
  }

  // Only assign to real space if score >= 2 (meaningful match)
  if (bestScore < 2) return { spaceId: GHOST_SPACE_ID, score: 0 };
  return { spaceId: bestSpace, score: bestScore };
}

const MAX_PER_SPACE = 2;
const MAX_TOTAL = 8;
const MAX_GHOST_SPACE = 6;

export function useGhostCards({ spaces, dismissals, documentExtensions, onDismiss }: UseGhostCardsOptions) {
  const docExts = useMemo(() => {
    const exts = getDocumentExtensions(documentExtensions);
    return new Set(exts.map(e => e.toLowerCase().replace(/^\./, '')));
  }, [documentExtensions]);

  const getDisplayType = useCallback((type: LauncherItem['type'], value: string): GhostDisplayType => {
    if (type === 'folder') return 'folder';
    if (type === 'url' || type === 'browser') return 'url';
    // Check if it's a document by extension
    const ext = value.split('.').pop()?.toLowerCase() || '';
    if (docExts.has(ext)) return 'document';
    return 'app';
  }, [docExts]);
  const [ghosts, setGhosts] = useState<GhostItem[]>([]);
  const [active, setActive] = useState(false);
  const [scanning, setScanning] = useState(false);

  const existingValues = useMemo(() => {
    const set = new Set<string>();
    for (const s of spaces) for (const it of s.items) set.add(it.value.toLowerCase());
    return set;
  }, [spaces]);

  // F5: treat a dismissed value as "suppressed" only while the cooldown window
  // hasn't elapsed. Repeated dismissals don't extend the window — they only
  // bump the count for future heuristics (trust-the-user scoring, not impl yet).
  const dismissedSet = useMemo(() => {
    const now = Date.now();
    const out = new Set<string>();
    for (const [value, rec] of Object.entries(dismissals)) {
      if (now - rec.at < DISMISS_COOLDOWN_MS) out.add(value.toLowerCase());
    }
    return out;
  }, [dismissals]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const [openResult, recentResult] = await Promise.all([
        electronAPI.getOpenWindows(),
        electronAPI.getRecentItems(),
      ]);

      const candidates: { title: string; value: string; type: LauncherItem['type']; source: 'open' | 'recent' }[] = [];
      const seen = new Set<string>();
      const add = (item: typeof candidates[0]) => {
        const key = item.value.toLowerCase();
        if (seen.has(key) || existingValues.has(key) || dismissedSet.has(key)) return;
        seen.add(key);
        candidates.push(item);
      };

      for (const w of openResult.windows) {
        if (w.FolderPath) {
          add({ title: w.MainWindowTitle || w.FolderPath.split('\\').pop() || w.FolderPath, value: w.FolderPath, type: 'folder', source: 'open' });
        } else if (w.ExePath) {
          add({ title: w.MainWindowTitle || w.ProcessName || '', value: w.ExePath, type: 'app', source: 'open' });
        }
      }

      for (const tab of openResult.browserTabs) {
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
          add({ title: tab.title || tab.url, value: tab.url, type: 'url', source: 'open' });
        }
      }

      for (const r of recentResult) {
        add({ title: r.title, value: r.value, type: r.type, source: 'recent' });
      }

      // Sort: 'open' first, then 'recent'
      candidates.sort((a, b) => (a.source === 'open' ? 0 : 1) - (b.source === 'open' ? 0 : 1));

      // Match to spaces. score < 2 → ghost space
      const spaceCount: Record<string, number> = {};
      const matched: GhostItem[] = [];

      for (const c of candidates) {
        if (matched.length >= MAX_TOTAL) break;
        const { spaceId, score } = matchToSpace(c, spaces);

        if (spaceId === GHOST_SPACE_ID) {
          const ghostCount = spaceCount[GHOST_SPACE_ID] || 0;
          if (ghostCount >= MAX_GHOST_SPACE) continue;
          spaceCount[GHOST_SPACE_ID] = ghostCount + 1;
        } else {
          const count = spaceCount[spaceId] || 0;
          if (count >= MAX_PER_SPACE) continue;
          spaceCount[spaceId] = count + 1;
        }

        // F7: compose a short reason chip so the user understands why we picked this.
        // Priority: "현재 열림" (strongest signal) > contextual match > "최근 사용" (weakest).
        let reason: GhostReason;
        if (c.source === 'open') {
          reason = { icon: 'open_in_new', label: '지금 열려있음' };
        } else if (score >= 3) {
          // High-score match (same-parent-dir / same-domain)
          reason = { icon: 'adjust', label: '비슷한 항목이 있음' };
        } else if (score >= 2) {
          reason = { icon: 'category', label: '같은 종류가 있음' };
        } else {
          reason = { icon: 'history', label: '최근 사용' };
        }

        matched.push({ ...c, spaceId, displayType: getDisplayType(c.type, c.value), reason });
      }

      setGhosts(matched);
      setActive(true);
    } catch { /* silent */ }
    setScanning(false);
  }, [spaces, existingValues, dismissedSet]);

  const toggle = useCallback(() => {
    if (active) {
      setGhosts([]);
      setActive(false);
    } else {
      scan();
    }
  }, [active, scan]);

  const accept = useCallback((ghost: GhostItem) => {
    setGhosts(prev => prev.filter(g => g.value !== ghost.value));
  }, []);

  const dismiss = useCallback((value: string) => {
    setGhosts(prev => prev.filter(g => g.value !== value));
    onDismiss(value);
  }, [onDismiss]);

  const ghostsForSpace = useCallback((spaceId: string) =>
    ghosts.filter(g => g.spaceId === spaceId),
  [ghosts]);

  /** Items that didn't match any real space */
  const ghostSpaceItems = useMemo(() =>
    ghosts.filter(g => g.spaceId === GHOST_SPACE_ID),
  [ghosts]);

  const hasGhostSpace = ghostSpaceItems.length > 0;

  return { active, scanning, toggle, ghostsForSpace, ghostSpaceItems, hasGhostSpace, accept, dismiss };
}
