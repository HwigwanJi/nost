/**
 * scanEngine — single source of truth for "what's currently open."
 *
 * Three consumers historically duplicated this work:
 *   1. ScanDialog (manual "스마트 스캔" picker)
 *   2. RecommendPanel (lightbulb sidebar tool)
 *   3. useGhostCards (in-grid ghost recommendations)
 *
 * Each was calling `getOpenWindows()` + `getRecentItems()` on its own
 * timer with subtly different filtering, which meant
 *   (a) three round-trips per user click instead of one,
 *   (b) divergent categorisation rules — Cursor showed up as "app" in
 *       one place and "program" in another, and
 *   (c) any improvement to the categoriser had to be made three times.
 *
 * This module owns the IPC call + the categorisation. Consumers
 * receive an already-classified `ScanResult`. Layering on top of
 * this:
 *   - useGhostCards adds RELEVANCE SCORING per-space (which ghost
 *     gets attached to which space) — that stays in the hook because
 *     it depends on `spaces` state and dismissals state.
 *   - The two UI surfaces (ScanDialog, RecommendPanel) just render
 *     whatever bucket the engine returns.
 *
 * Categorisation rules (used by all consumers):
 *   - apps      = WindowEntry where ProcessName != 'explorer'
 *   - folders   = WindowEntry where ProcessName == 'explorer'
 *                 (FolderPath usually present)
 *   - documents = browser tabs (semantically "open documents on the
 *                 web" — Notion pages, Google Docs, ChatGPT chats,
 *                 GitHub issues, etc.). Includes a filter against
 *                 internal browser URLs (chrome:// / edge:// / about:)
 *                 since those aren't documents the user was actually
 *                 working on.
 *   - recentItems = OS recent file/folder list — used for cold-start
 *                   suggestions when nothing matches what's "open."
 */

import type { WindowEntry, ChromeTab } from '../types';
import { electronAPI } from '../electronBridge';

export interface RecentEntry {
  title: string;
  value: string;
  type: 'folder' | 'app';
  lastAccessed: string;
}

export interface ScanResult {
  /** Running programs (.exe windows, e.g. Cursor / Notion / Word). */
  apps: WindowEntry[];
  /** Open File Explorer windows — we keep `MainWindowTitle` and
   *  `FolderPath` so both display and click-to-add can use them. */
  folders: WindowEntry[];
  /** Open browser tabs — surfaces as "현재 열려있는 문서" in the UI. */
  documents: ChromeTab[];
  /** OS recent items — fallback suggestions when nothing's open. */
  recentItems: RecentEntry[];
}

const INTERNAL_URL_PREFIXES = ['chrome://', 'edge://', 'about:', 'brave://'];

/**
 * Fetch + categorise the user's currently-open environment. One IPC
 * round-trip on the renderer side; main does the heavy PowerShell
 * lift so the renderer stays responsive.
 *
 * Failure mode: if either underlying IPC fails, we return an empty
 * shape rather than throwing — the UI is happier showing "nothing
 * open" than an error toast for a casual scan.
 */
export async function scanCurrentEnvironment(): Promise<ScanResult> {
  try {
    const [openResult, recentResult] = await Promise.all([
      electronAPI.getOpenWindows(),
      electronAPI.getRecentItems(),
    ]);
    const allWindows = openResult.windows ?? [];
    const folders = allWindows.filter(w => w.ProcessName.toLowerCase() === 'explorer');
    const apps = allWindows.filter(w => w.ProcessName.toLowerCase() !== 'explorer');
    const tabs = (openResult.browserTabs ?? []).filter(t =>
      t.url && !INTERNAL_URL_PREFIXES.some(p => t.url.startsWith(p))
    );
    return {
      apps,
      folders,
      documents: tabs,
      recentItems: recentResult ?? [],
    };
  } catch {
    return { apps: [], folders: [], documents: [], recentItems: [] };
  }
}

/**
 * Convenience: flatten the categorised scan into the legacy
 * "candidate" shape useGhostCards expects (so the existing scoring
 * code doesn't need to know about the new categorisation). Each
 * candidate carries a `source` ('open' | 'recent') and a coarse
 * `type` matching LauncherItem['type'].
 *
 * Order is meaningful — 'open' candidates come first so the ghost
 * matcher prefers them over 'recent' on tie scores.
 */
export interface ScanCandidate {
  title: string;
  value: string;
  type: 'folder' | 'app' | 'url';
  source: 'open' | 'recent';
}

export function flattenScanForGhostMatching(scan: ScanResult): ScanCandidate[] {
  const out: ScanCandidate[] = [];

  // Folders first (Explorer windows)
  for (const w of scan.folders) {
    if (!w.FolderPath) continue;
    out.push({
      title: w.MainWindowTitle || w.FolderPath.split('\\').pop() || w.FolderPath,
      value: w.FolderPath,
      type: 'folder',
      source: 'open',
    });
  }

  // Apps (.exe windows that have a known ExePath)
  for (const w of scan.apps) {
    if (!w.ExePath) continue;
    out.push({
      title: w.MainWindowTitle || w.ProcessName || '',
      value: w.ExePath,
      type: 'app',
      source: 'open',
    });
  }

  // Documents (browser tabs)
  for (const t of scan.documents) {
    out.push({
      title: t.title || t.url,
      value: t.url,
      type: 'url',
      source: 'open',
    });
  }

  // OS recent items — already typed.
  for (const r of scan.recentItems) {
    out.push({ title: r.title, value: r.value, type: r.type, source: 'recent' });
  }

  return out;
}
