import { useState, useCallback, useEffect } from 'react';
import type { AppData, Space, LauncherItem, AppSettings, NodeGroup, Deck, ContainerSlots, Preset, PresetId } from '../types';
import { newTrialLicense } from './useEntitlement';
import { electronAPI } from '../electronBridge';
import { generateId } from '../lib/utils';
import { createLogger } from '../lib/logger';

const log = createLogger('useAppData');

const STORAGE_KEY = 'quicklauncherData';

/** Build a brand-new preset with a single default space. */
function buildDefaultPreset(id: PresetId, seeded: boolean): Preset {
  const firstSpace: Space = {
    id: generateId(),
    name: seeded ? '즐겨찾기' : '새 스페이스',
    items: seeded ? [
      { id: generateId(), type: 'url', title: '네이버', value: 'https://www.naver.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '다음', value: 'https://www.daum.net', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '유튜브', value: 'https://www.youtube.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '구글', value: 'https://www.google.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '지메일', value: 'https://mail.google.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '카카오', value: 'https://www.kakao.com', clickCount: 0, pinned: false },
    ] : [],
    color: undefined,
    sortMode: 'custom',
    pinnedIds: [],
  };
  return {
    id,
    label: `프리셋 ${id}`,
    spaces: [firstSpace],
    nodeGroups: [],
    decks: [],
    collapsedSpaceIds: [],
    floatingBadges: [],
  };
}

function defaultData(): AppData {
  const presets = [
    buildDefaultPreset('1', true),
    buildDefaultPreset('2', false),
    buildDefaultPreset('3', false),
  ];
  const active = presets[0];
  return {
    presets,
    activePresetId: '1',
    // Top-level mirrors of active preset (required by the AppData type; kept
    // in sync by the `setDataRaw` shim on every write).
    spaces: active.spaces,
    nodeGroups: active.nodeGroups,
    decks: active.decks,
    collapsedSpaceIds: active.collapsedSpaceIds,
    floatingBadges: active.floatingBadges,
    settings: { opacity: 0.95, closeAfterOpen: false, shortcut: 'Alt+4', theme: 'dark', autoLaunch: false },
    shortcut: 'Alt+4',
  };
}

// Ensure the pair-chain invariant: at most one pair per row (no [A→B→C] chain).
// Also fix dangling pairs where pairedWithNext=true but there's no next space.
// This runs on every load and on every mutation that could violate the invariant.
export function enforcePairInvariant(spaces: Space[]): Space[] {
  const out = spaces.map(s => ({ ...s }));
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    if (!cur.pairedWithNext) continue;
    // No next space to pair with → cannot be paired
    if (i === out.length - 1) {
      cur.pairedWithNext = false;
      cur.splitRatio = undefined;
      continue;
    }
    // Breaking a chain: if the next space also has pairedWithNext=true, clear
    // the next's flag so the pair is [i, i+1] only, and i+2 starts a new row.
    const nxt = out[i + 1];
    if (nxt.pairedWithNext) {
      nxt.pairedWithNext = false;
      nxt.splitRatio = undefined;
    }
  }
  return out;
}

/**
 * Normalise one space's shape (pairing / pins / item defaults). Extracted so
 * migrateData() can apply it inside every preset uniformly.
 */
function normaliseSpace(s: Space): Space {
  const { columnSpan: _cs, widthWeight: _ww, ...rest } = s;
  return {
    ...rest,
    sortMode: s.sortMode ?? 'custom',
    pinnedIds: s.pinnedIds ?? [],
    pairedWithNext: s.pairedWithNext ?? false,
    splitRatio: s.pairedWithNext ? (s.splitRatio ?? 0.5) : undefined,
    items: s.items.map(i => ({ ...i, clickCount: i.clickCount ?? 0, pinned: i.pinned ?? false })),
  };
}

function normalisePreset(p: Preset): Preset {
  return {
    ...p,
    label: p.label ?? `프리셋 ${p.id}`,
    spaces: enforcePairInvariant((p.spaces ?? []).map(normaliseSpace)),
    nodeGroups: p.nodeGroups ?? [],
    decks: p.decks ?? [],
    collapsedSpaceIds: p.collapsedSpaceIds ?? [],
    floatingBadges: p.floatingBadges ?? [],
  };
}

function migrateData(parsed: AppData): AppData {
  // ── Settings defaults (global — same as before) ─────────────
  parsed.settings = {
    ...parsed.settings,
    theme: parsed.settings.theme ?? 'dark',
    autoLaunch: parsed.settings.autoLaunch ?? false,
    autoHide: parsed.settings.autoHide ?? false,
    accentColor: parsed.settings.accentColor ?? '#6366f1',
    documentExtensions: parsed.settings.documentExtensions ?? [],
    floatingButton: parsed.settings.floatingButton ?? {
      enabled: false,
      idleOpacity: 0.65,
      size: 'normal',
      hideOnFullscreen: true,
    },
  };

  // ── Preset shape migration ──────────────────────────────────
  // Older save files stored spaces/nodeGroups/decks/etc. at the top level.
  // Move any legacy flat fields into presets[0] so the rest of the app can
  // uniformly treat "active preset" as the source of truth.
  if (!Array.isArray(parsed.presets) || parsed.presets.length === 0) {
    const legacySpaces = parsed.spaces ?? [];
    const legacyPreset: Preset = {
      id: '1',
      label: '프리셋 1',
      spaces: legacySpaces.length > 0 ? legacySpaces : buildDefaultPreset('1', true).spaces,
      nodeGroups: parsed.nodeGroups ?? [],
      decks: parsed.decks ?? [],
      collapsedSpaceIds: parsed.collapsedSpaceIds ?? [],
      floatingBadges: parsed.floatingBadges ?? [],
    };
    parsed.presets = [
      legacyPreset,
      buildDefaultPreset('2', false),
      buildDefaultPreset('3', false),
    ];
  }

  // Ensure exactly 3 presets in the '1','2','3' id order.
  const byId = new Map<PresetId, Preset>();
  for (const p of parsed.presets) byId.set(p.id, normalisePreset(p));
  parsed.presets = (['1', '2', '3'] as PresetId[]).map(id =>
    byId.get(id) ?? buildDefaultPreset(id, false)
  );

  if (parsed.activePresetId !== '1' && parsed.activePresetId !== '2' && parsed.activePresetId !== '3') {
    parsed.activePresetId = '1';
  }

  // Mirror active preset onto top-level flat fields — the AppData type treats
  // spaces[] as required; the shim in useAppData keeps them synced on writes.
  const activeForMirror = parsed.presets.find(p => p.id === parsed.activePresetId) ?? parsed.presets[0];
  parsed.spaces            = activeForMirror.spaces;
  parsed.nodeGroups        = activeForMirror.nodeGroups;
  parsed.decks             = activeForMirror.decks;
  parsed.collapsedSpaceIds = activeForMirror.collapsedSpaceIds;
  parsed.floatingBadges    = activeForMirror.floatingBadges;

  // ── Dismissals migration (global) ────────────────────────────
  if (!parsed.dismissals) {
    const dismissals: Record<string, { at: number; count: number }> = {};
    (parsed.dismissedSuggestions ?? []).forEach(v => { dismissals[v] = { at: 0, count: 1 }; });
    parsed.dismissals = dismissals;
  }

  parsed.completedTours = parsed.completedTours ?? [];

  return parsed;
}

function loadDataSync(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      log.debug(`loadDataSync: localStorage hit, size=${raw.length}`);
      return migrateData(JSON.parse(raw) as AppData);
    }
    log.debug('loadDataSync: no localStorage, using defaultData');
  } catch (e) { log.warn('loadDataSync: parse error', e); }
  return defaultData();
}

// ── Loading screen helpers (DOM direct — works before React paint) ──
function setLoadingProgress(pct: number) {
  const bar = document.getElementById('ql-loading-bar');
  if (bar) bar.style.width = `${pct}%`;
  log.debug(`setLoadingProgress(${pct}) bar=${!!bar}`);
}

function dismissLoadingScreen() {
  const el = document.getElementById('ql-loading');
  log.debug(`dismissLoadingScreen called, overlay=${!!el}`);
  if (!el) return;
  setLoadingProgress(100);
  // Signal Electron main that renderer is fully ready — window will be shown now
  log.debug('electronAPI.signalReady() →');
  electronAPI.signalReady();
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => { el.remove(); log.debug('loading overlay removed'); }, 280);
  }, 150);
}

export function useAppData() {
  log.debug('useAppData() function called');
  // `raw` is the true on-disk shape (presets[] + globals). All mutating
  // callers still see a backward-compat "flat" view via `data` (below) — the
  // `save` shim intercepts their writes and redirects per-preset keys into
  // presets[activePresetId].
  const [raw, setRawData] = useState<AppData>(() => loadDataSync());
  const [isFirstRun, setIsFirstRun] = useState(false);

  // On mount: load from electron-store (migrating from localStorage if needed)
  useEffect(() => {
    log.debug('useAppData mount effect running');
    setLoadingProgress(60);
    electronAPI.setLoadingStatus('데이터 불러오는 중...');
    electronAPI.storeLoad().then(stored => {
      const hasStore = !!(stored && typeof stored === 'object' && (
        'presets' in (stored as AppData) || 'spaces' in (stored as AppData)
      ));
      log.debug(`storeLoad resolved. hasStore=${hasStore}`);
      if (hasStore) {
        setRawData(migrateData(stored as AppData));
      } else {
        const localRaw = localStorage.getItem(STORAGE_KEY);
        if (!localRaw) setIsFirstRun(true);
        const localData = loadDataSync();
        electronAPI.storeSave(localData);
      }
      setLoadingProgress(90);
      electronAPI.setLoadingStatus('화면 그리는 중...');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        log.debug('double-rAF fired → dismissLoadingScreen');
        dismissLoadingScreen();
      }));
    }).catch(err => log.error('storeLoad rejected', err));
  }, []);

  // `raw` already has its top-level flat fields mirrored to the active preset
  // (migrateData + every shim call maintains this invariant), so `data` is
  // literally `raw` — no extra object allocation per render.
  const data: AppData = raw;

  /**
   * Commit a mutation. `next` is the flat-view shape callers produce via
   * `save({ ...data, ... })`. Per-preset fields land on the active preset;
   * global fields land on raw.
   *
   * We intentionally DO NOT read `next.presets` or `next.activePresetId` —
   * those are managed only by `setActivePreset` / `renamePreset`, which
   * mutate `raw` directly. Allowing `save` to overwrite them would let a
   * stale data-view spread clobber a newly-switched preset.
   */
  const save = useCallback((next: AppData) => {
    setRawData(prev => {
      const activeId = prev.activePresetId;
      const nextPresets = prev.presets.map(p => p.id === activeId ? {
        ...p,
        spaces:            next.spaces            ?? p.spaces,
        nodeGroups:        next.nodeGroups        ?? p.nodeGroups,
        decks:             next.decks             ?? p.decks,
        collapsedSpaceIds: next.collapsedSpaceIds ?? p.collapsedSpaceIds,
        floatingBadges:    next.floatingBadges    ?? p.floatingBadges,
      } : p);
      const active = nextPresets.find(p => p.id === activeId)!;
      const newRaw: AppData = {
        ...prev,
        settings:        next.settings        ?? prev.settings,
        shortcut:        next.shortcut        ?? prev.shortcut,
        dismissals:      next.dismissals      ?? prev.dismissals,
        completedTours:  next.completedTours  ?? prev.completedTours,
        presets: nextPresets,
        // Refresh flat-view mirrors from the authoritative preset.
        spaces:            active.spaces,
        nodeGroups:        active.nodeGroups,
        decks:             active.decks,
        collapsedSpaceIds: active.collapsedSpaceIds,
        floatingBadges:    active.floatingBadges,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newRaw));
      electronAPI.storeSave(newRaw);
      return newRaw;
    });
  }, []);

  // ── Preset management ───────────────────────────────────────
  const setActivePreset = useCallback((id: PresetId) => {
    setRawData(prev => {
      if (prev.activePresetId === id) return prev;
      const active = prev.presets.find(p => p.id === id) ?? prev.presets[0];
      const next: AppData = {
        ...prev,
        activePresetId: id,
        // Swap in the new preset's mirrors so `data.spaces` etc. flips atomically.
        spaces:            active.spaces,
        nodeGroups:        active.nodeGroups,
        decks:             active.decks,
        collapsedSpaceIds: active.collapsedSpaceIds,
        floatingBadges:    active.floatingBadges,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      // Persist first, THEN tell main to rebuild the badge overlay so it sees
      // the fresh floatingBadges belonging to the newly-active preset.
      electronAPI.storeSave(next).then(() => electronAPI.syncBadges());
      return next;
    });
  }, []);

  const renamePreset = useCallback((id: PresetId, label: string) => {
    setRawData(prev => {
      const trimmed = label.trim() || `프리셋 ${id}`;
      const next = {
        ...prev,
        presets: prev.presets.map(p => p.id === id ? { ...p, label: trimmed } : p),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const markTourCompleted = useCallback((tourId: string) => {
    setRawData(prev => {
      if ((prev.completedTours ?? []).includes(tourId)) return prev;
      const next = { ...prev, completedTours: [...(prev.completedTours ?? []), tourId] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  /**
   * Flat-view setter shim. A handful of legacy callers (setFloatingBadgesLocal,
   * setPairSplitRatio, bulk item operations, …) call `setDataRaw(prev => ...)`
   * and read `prev.spaces` / `prev.collapsedSpaceIds` / etc. at the top level.
   * After the preset refactor those fields live under `activePreset`, so this
   * shim rewrites the updater callback to operate on a flat-view snapshot and
   * folds any returned per-preset mutations back into the raw shape.
   *
   * Direct `setDataRaw(nextAppData)` calls fall through to `setRawData` as-is
   * — the only caller who does that (reloadFromStore) supplies an already-
   * migrated full AppData which is what we want persisted wholesale.
   */
  const setDataRaw = useCallback((updater: AppData | ((prev: AppData) => AppData)) => {
    if (typeof updater !== 'function') {
      setRawData(updater);
      return;
    }
    setRawData(prevRaw => {
      const flatNext = updater(prevRaw);
      if (flatNext === prevRaw) return prevRaw;
      const activeId = prevRaw.activePresetId;
      const nextPresets = prevRaw.presets.map(p => p.id === activeId ? {
        ...p,
        spaces:            flatNext.spaces            ?? p.spaces,
        nodeGroups:        flatNext.nodeGroups        ?? p.nodeGroups,
        decks:             flatNext.decks             ?? p.decks,
        collapsedSpaceIds: flatNext.collapsedSpaceIds ?? p.collapsedSpaceIds,
        floatingBadges:    flatNext.floatingBadges    ?? p.floatingBadges,
      } : p);
      const active = nextPresets.find(p => p.id === activeId)!;
      return {
        ...prevRaw,
        settings:        flatNext.settings        ?? prevRaw.settings,
        shortcut:        flatNext.shortcut        ?? prevRaw.shortcut,
        dismissals:      flatNext.dismissals      ?? prevRaw.dismissals,
        completedTours:  flatNext.completedTours  ?? prevRaw.completedTours,
        presets: nextPresets,
        spaces:            active.spaces,
        nodeGroups:        active.nodeGroups,
        decks:             active.decks,
        collapsedSpaceIds: active.collapsedSpaceIds,
        floatingBadges:    active.floatingBadges,
      };
    });
  }, []);

  // ── Spaces ──────────────────────────────────────────────
  const addSpace = useCallback((name?: string) => {
    const newSpace: Space = {
      id: generateId(),
      name: name?.trim() || `Space ${data.spaces.length + 1}`,
      items: [],
      sortMode: 'custom',
      pinnedIds: [],
    };
    save({ ...data, spaces: [...data.spaces, newSpace] });
  }, [data, save]);

  const renameSpace = useCallback((id: string, name: string) => {
    save({
      ...data,
      spaces: data.spaces.map(s => s.id === id ? { ...s, name } : s),
    });
  }, [data, save]);

  const deleteSpace = useCallback((id: string) => {
    save({ ...data, spaces: data.spaces.filter(s => s.id !== id) });
  }, [data, save]);

  // Reorder entry point. All drag operations funnel here — we always enforce the
  // pair invariant after reordering so the saved state can never have a [A→B→C]
  // chain or a dangling pairedWithNext at the tail.
  const reorderSpaces = useCallback((newSpaces: Space[]) => {
    save({ ...data, spaces: enforcePairInvariant(newSpaces) });
  }, [data, save]);

  const setSpaceColor = useCallback((id: string, color: string) => {
    save({
      ...data,
      spaces: data.spaces.map(s => s.id === id ? { ...s, color } : s),
    });
  }, [data, save]);

  const setSpaceIcon = useCallback((id: string, icon: string) => {
    save({
      ...data,
      spaces: data.spaces.map(s => s.id === id ? { ...s, icon } : s),
    });
  }, [data, save]);

  // Pair split-ratio setter. The handle sits between the two paired spaces and
  // dragging it adjusts how the row's width is divided. Only the LEFT space of a
  // pair stores the ratio (single source of truth); clamped to [0.25, 0.75] so
  // neither side collapses below a usable width.
  const setPairSplitRatio = useCallback((leftSpaceId: string, ratio: number) => {
    const clamped = Math.max(0.25, Math.min(0.75, ratio));
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s => s.id === leftSpaceId ? { ...s, splitRatio: clamped } : s),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const duplicateSpace = useCallback((spaceId: string) => {
    const src = data.spaces.find(s => s.id === spaceId);
    if (!src) return;
    const clone: Space = {
      ...src,
      id: generateId(),
      name: `${src.name} (복사)`,
      items: src.items.map(i => ({ ...i, id: generateId(), clickCount: 0 })),
      pinnedIds: [],
    };
    const idx = data.spaces.findIndex(s => s.id === spaceId);
    const newSpaces = [...data.spaces];
    newSpaces.splice(idx + 1, 0, clone);
    save({ ...data, spaces: newSpaces });
  }, [data, save]);

  const toggleSpaceCollapsed = useCallback((spaceId: string) => {
    const collapsed = data.collapsedSpaceIds ?? [];
    const next = collapsed.includes(spaceId)
      ? collapsed.filter(id => id !== spaceId)
      : [...collapsed, spaceId];
    save({ ...data, collapsedSpaceIds: next });
  }, [data, save]);

  // F1: frequency + recency score. `clickCount × exp(-ageDays / 30)` — items
  // used a lot rise to the top, but a burst a year ago decays versus recent
  // clicks. Items never clicked fall back to count 0 (always last).
  const usageScore = (item: LauncherItem, now: number): number => {
    const count = item.clickCount ?? 0;
    if (count === 0) return 0;
    const ageDays = item.lastClickedAt ? Math.max(0, (now - item.lastClickedAt) / (24 * 60 * 60 * 1000)) : 365;
    return count * Math.exp(-ageDays / 30);
  };

  const sortSpaceByUsage = useCallback((id: string) => {
    const now = Date.now();
    save({
      ...data,
      spaces: data.spaces.map(s => {
        if (s.id !== id) return s;
        const pinnedIds = s.pinnedIds ?? [];
        const pinned = s.items.filter(i => pinnedIds.includes(i.id));
        const rest = s.items.filter(i => !pinnedIds.includes(i.id));
        rest.sort((a, b) => usageScore(b, now) - usageScore(a, now));
        return { ...s, items: [...pinned, ...rest], sortMode: 'usage' };
      }),
    });
  }, [data, save]);

  const lockSpaceSort = useCallback((spaceId: string, pinnedIds: string[]) => {
    save({
      ...data,
      spaces: data.spaces.map(s => s.id === spaceId ? { ...s, pinnedIds } : s),
    });
  }, [data, save]);

  // ── Items ────────────────────────────────────────────────
  const addItem = useCallback((spaceId: string, item: Omit<LauncherItem, 'id'>, presetId?: string) => {
    const newItem: LauncherItem = { ...item, id: presetId ?? generateId(), clickCount: 0, pinned: false };
    save({
      ...data,
      spaces: data.spaces.map(s =>
        s.id === spaceId ? { ...s, items: [...s.items, newItem] } : s
      ),
    });
  }, [data, save]);

  const updateItem = useCallback((spaceId: string, item: LauncherItem) => {
    save({
      ...data,
      spaces: data.spaces.map(s =>
        s.id === spaceId ? { ...s, items: s.items.map(i => i.id === item.id ? item : i) } : s
      ),
    });
  }, [data, save]);

  const deleteItem = useCallback((spaceId: string, itemId: string) => {
    save({
      ...data,
      spaces: data.spaces.map(s =>
        s.id === spaceId ? { ...s, items: s.items.filter(i => i.id !== itemId) } : s
      ),
    });
  }, [data, save]);

  /**
   * Apply many partial item patches in a single store write. The favicon
   * migration uses this to fold N data-URL conversions into one save —
   * calling updateItem in a loop closes over stale `data` and makes later
   * calls overwrite earlier ones. Patches are keyed by (spaceId, itemId)
   * and only the listed fields are merged; everything else on the item
   * stays as-is.
   */
  const patchItems = useCallback((patches: Array<{
    spaceId: string;
    itemId: string;
    patch: Partial<LauncherItem>;
  }>) => {
    if (patches.length === 0) return;
    const bySpace = new Map<string, Map<string, Partial<LauncherItem>>>();
    for (const { spaceId, itemId, patch } of patches) {
      let m = bySpace.get(spaceId);
      if (!m) { m = new Map(); bySpace.set(spaceId, m); }
      m.set(itemId, { ...(m.get(itemId) ?? {}), ...patch });
    }
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s => {
          const updates = bySpace.get(s.id);
          if (!updates) return s;
          return {
            ...s,
            items: s.items.map(i => {
              const u = updates.get(i.id);
              return u ? { ...i, ...u } : i;
            }),
          };
        }),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, [setDataRaw]);

  // ── Batch add / delete (functional-update form — safe for loops) ──
  // Regular addItem/deleteItem close over `data`, so calling them in a synchronous
  // loop makes each call overwrite the previous one. These two operate on `prev`
  // inside setDataRaw, so every item in the batch is preserved / removed atomically.
  const addItems = useCallback((spaceId: string, items: Omit<LauncherItem, 'id'>[]): LauncherItem[] => {
    const newItems: LauncherItem[] = items.map(it => ({
      ...it,
      id: generateId(),
      clickCount: 0,
      pinned: false,
    }));
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s =>
          s.id === spaceId ? { ...s, items: [...s.items, ...newItems] } : s
        ),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
    return newItems;
  }, []);

  const deleteItems = useCallback((spaceId: string, itemIds: string[]) => {
    if (itemIds.length === 0) return;
    const idSet = new Set(itemIds);
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s =>
          s.id === spaceId ? { ...s, items: s.items.filter(i => !idSet.has(i.id)) } : s
        ),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  /**
   * Delete every unpinned, non-container item in a single space.
   *
   * Pin state in this app is tracked via `space.pinnedIds` (an id-set on the
   * space), NOT `item.pinned` (a legacy boolean used for initial seed data).
   * The pin-mode click handler in App.tsx toggles pinnedIds and never
   * touches `i.pinned`, so a filter on `i.pinned` would see every user-pinned
   * card as unpinned. We intersect against `pinnedIds` to match UI reality.
   *
   * Containers are also preserved — they hold layout metadata (slots) and
   * removing them orphans their child windows.
   */
  const deleteUnpinnedInSpace = useCallback((spaceId: string): number => {
    let removed = 0;
    setDataRaw(prev => {
      const target = prev.spaces.find(s => s.id === spaceId);
      if (!target) return prev;
      const pinSet = new Set(target.pinnedIds ?? []);
      const keep = target.items.filter(i => pinSet.has(i.id) || i.isContainer);
      removed = target.items.length - keep.length;
      if (removed === 0) return prev;
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s => s.id === spaceId ? { ...s, items: keep } : s),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
    return removed;
  }, []);

  /**
   * Delete unpinned items across every space. Preserves the space structure —
   * only items are touched, empty spaces remain.
   */
  const deleteUnpinnedInAllSpaces = useCallback((): number => {
    let removed = 0;
    setDataRaw(prev => {
      let total = 0;
      const nextSpaces = prev.spaces.map(s => {
        const pinSet = new Set(s.pinnedIds ?? []);
        const keep = s.items.filter(i => pinSet.has(i.id) || i.isContainer);
        total += s.items.length - keep.length;
        return { ...s, items: keep };
      });
      removed = total;
      if (removed === 0) return prev;
      const next: AppData = { ...prev, spaces: nextSpaces };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
    return removed;
  }, []);

  // ── Undo helpers (functional-update form — no stale closure risk) ──
  // Always reads latest state via `prev`, so the closure captured at delete-time
  // still restores correctly even after subsequent state changes.
  const restoreItem = useCallback((spaceId: string, item: LauncherItem) => {
    setDataRaw(prev => {
      const space = prev.spaces.find(s => s.id === spaceId);
      // Skip if the space is gone or the item already exists (double-undo guard)
      if (!space || space.items.some(i => i.id === item.id)) return prev;
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s =>
          s.id === spaceId ? { ...s, items: [...s.items, item] } : s
        ),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const restoreSpace = useCallback((space: Space) => {
    setDataRaw(prev => {
      // Skip if the space was somehow re-added already
      if (prev.spaces.some(s => s.id === space.id)) return prev;
      const next: AppData = { ...prev, spaces: [...prev.spaces, space] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const incrementClickCount = useCallback((spaceId: string, itemId: string) => {
    const now = Date.now();
    save({
      ...data,
      spaces: data.spaces.map(s =>
        s.id === spaceId
          ? { ...s, items: s.items.map(i => i.id === itemId ? { ...i, clickCount: (i.clickCount ?? 0) + 1, lastClickedAt: now } : i) }
          : s
      ),
    });
  }, [data, save]);

  const reorderItems = useCallback((spaceId: string, items: LauncherItem[]) => {
    save({
      ...data,
      spaces: data.spaces.map(s => s.id === spaceId ? { ...s, items } : s),
    });
  }, [data, save]);

  const moveItemToSpace = useCallback((itemId: string, fromSpaceId: string, toSpaceId: string) => {
    const fromSpace = data.spaces.find(s => s.id === fromSpaceId);
    const item = fromSpace?.items.find(i => i.id === itemId);
    if (!item || fromSpaceId === toSpaceId) return;
    save({
      ...data,
      spaces: data.spaces.map(s => {
        if (s.id === fromSpaceId) return { ...s, items: s.items.filter(i => i.id !== itemId) };
        if (s.id === toSpaceId) return { ...s, items: [...s.items, item] };
        return s;
      }),
    });
  }, [data, save]);

  const updateItemAndMove = useCallback((fromSpaceId: string, toSpaceId: string, item: LauncherItem) => {
    // Update item data AND move it to the new space atomically
    const updatedItem = { ...item };
    save({
      ...data,
      spaces: data.spaces.map(s => {
        if (s.id === fromSpaceId) return { ...s, items: s.items.filter(i => i.id !== item.id) };
        if (s.id === toSpaceId) return { ...s, items: [...s.items, updatedItem] };
        return s;
      }),
    });
  }, [data, save]);

  // ── Node Groups ──────────────────────────────────────────
  const getNodeGroupForItem = useCallback((itemId: string): NodeGroup | undefined => {
    return (data.nodeGroups ?? []).find(g => g.itemIds.includes(itemId));
  }, [data.nodeGroups]);

  const addNodeGroup = useCallback((name: string, itemIds: string[]) => {
    const group: NodeGroup = { id: generateId(), name, itemIds };
    save({ ...data, nodeGroups: [...(data.nodeGroups ?? []), group] });
  }, [data, save]);

  const updateNodeGroup = useCallback((id: string, updates: Partial<Pick<NodeGroup, 'name' | 'itemIds' | 'monitor'>>) => {
    save({
      ...data,
      nodeGroups: (data.nodeGroups ?? []).map(g => g.id === id ? { ...g, ...updates } : g),
    });
  }, [data, save]);

  const deleteNodeGroup = useCallback((id: string) => {
    save({ ...data, nodeGroups: (data.nodeGroups ?? []).filter(g => g.id !== id) });
  }, [data, save]);

  const reorderNodeGroups = useCallback((groups: NodeGroup[]) => {
    save({ ...data, nodeGroups: groups });
  }, [data, save]);

  // ── Decks ────────────────────────────────────────────────
  const addDeck = useCallback((name: string, itemIds: string[]) => {
    const deck: Deck = { id: generateId(), name, itemIds };
    save({ ...data, decks: [...(data.decks ?? []), deck] });
  }, [data, save]);

  const updateDeck = useCallback((id: string, updates: Partial<Pick<Deck, 'name' | 'itemIds' | 'monitor'>>) => {
    save({ ...data, decks: (data.decks ?? []).map(d => d.id === id ? { ...d, ...updates } : d) });
  }, [data, save]);

  const deleteDeck = useCallback((id: string) => {
    save({ ...data, decks: (data.decks ?? []).filter(d => d.id !== id) });
  }, [data, save]);

  // ── Container Slots (atomic: add new items + hide removals + update slots in ONE save) ──
  // Each individual store fn (addItem/updateItem) spreads stale `data`, so calling
  // multiple of them sequentially causes each to overwrite the previous.
  // This function applies all three operations to a local spaces chain, then saves once.
  const saveContainerSlots = useCallback((
    containerSpaceId: string,
    containerItemId: string,
    slots: ContainerSlots,
    removals: Array<{ spaceId: string; itemId: string }>,
    newItems: Array<{ id: string; item: Omit<LauncherItem, 'id'> }>,
  ) => {
    let nextSpaces = data.spaces;

    // 1. Add new items to the container's space
    for (const { id, item } of newItems) {
      const newLI: LauncherItem = { ...item, id, clickCount: 0, pinned: false };
      nextSpaces = nextSpaces.map(s =>
        s.id === containerSpaceId ? { ...s, items: [...s.items, newLI] } : s
      );
    }

    // 2. Mark all slot-assigned items as hiddenInSpace across all spaces.
    //    Collect every itemId currently in the final slots.
    const slotItemIds = new Set(Object.values(slots).filter(Boolean) as string[]);
    // Also include explicitly removed items (they keep their hiddenInSpace even if re-assigned elsewhere)
    for (const { spaceId, itemId } of removals) {
      slotItemIds.add(itemId);
      // Apply to the specific space for removals (fast path)
      nextSpaces = nextSpaces.map(s =>
        s.id === spaceId
          ? { ...s, items: s.items.map(i => i.id === itemId ? { ...i, hiddenInSpace: true } : i) }
          : s
      );
    }
    // Sweep all spaces for any slot item not already handled above
    for (const itemId of slotItemIds) {
      if (!removals.some(r => r.itemId === itemId)) {
        nextSpaces = nextSpaces.map(s => ({
          ...s,
          items: s.items.map(i => i.id === itemId ? { ...i, hiddenInSpace: true } : i),
        }));
      }
    }

    // 3. Update the container item's slots
    nextSpaces = nextSpaces.map(s =>
      s.id === containerSpaceId
        ? { ...s, items: s.items.map(i => i.id === containerItemId ? { ...i, slots } : i) }
        : s
    );

    save({ ...data, spaces: nextSpaces });
  }, [data, save]);

  /**
   * Atomic "drag-into-slot" assignment used by the Bloom UX.
   *
   *  - Source item: marked `hiddenInSpace: true` so it disappears from
   *    its source space's grid (it now lives "inside" the container).
   *  - Container's slots[dir] = sourceItemId. Other directions kept,
   *    *unless* the same source was already in another direction —
   *    that slot is cleared (a single item never lives in two slots).
   *  - Whatever was previously in `dir` (if anything, and if it's not
   *    still in another slot of this container) is *restored*: we flip
   *    its `hiddenInSpace` back to `false` so the user gets that item
   *    back in their space grid instead of orphaning it. This is
   *    intentionally different from the modal's "save slots" flow,
   *    which keeps replaced items hidden — drag interactions are
   *    incremental, so the principle of least surprise wins.
   *
   * Single `save()` call — atomic — because doing this as three chained
   * store mutations races against stale closures (same lesson as
   * saveContainerSlots).
   */
  const assignSlotFromItem = useCallback((opts: {
    containerSpaceId: string;
    containerId: string;
    dir: 'up' | 'down' | 'left' | 'right';
    sourceItemId: string;
  }) => {
    const { containerSpaceId, containerId, dir, sourceItemId } = opts;
    let nextSpaces = data.spaces;

    const container = nextSpaces.find(s => s.id === containerSpaceId)
                                ?.items.find(i => i.id === containerId);
    if (!container?.isContainer) return;
    const oldSlots = container.slots ?? {};
    const oldSlotItemId = oldSlots[dir];
    if (oldSlotItemId === sourceItemId) return; // no-op

    // Compose new slots: copy others, drop source from any other slot,
    // then write source into `dir`.
    const newSlots: ContainerSlots = {};
    for (const k of ['up', 'down', 'left', 'right'] as const) {
      const cur = oldSlots[k];
      if (cur && cur !== sourceItemId && k !== dir) newSlots[k] = cur;
    }
    newSlots[dir] = sourceItemId;

    // Items that need their hiddenInSpace flipped to false (restored
    // to their original space). Only the previous occupant of `dir`
    // qualifies, and only if it's not still referenced by some other
    // slot in this container (which can happen if the source item
    // came from another slot of the same container).
    const toRestore = new Set<string>();
    if (oldSlotItemId && oldSlotItemId !== sourceItemId &&
        !Object.values(newSlots).includes(oldSlotItemId)) {
      toRestore.add(oldSlotItemId);
    }

    // Apply hidden-flag changes everywhere they need to apply.
    nextSpaces = nextSpaces.map(s => ({
      ...s,
      items: s.items.map(i =>
        i.id === sourceItemId ? { ...i, hiddenInSpace: true }
        : toRestore.has(i.id) ? { ...i, hiddenInSpace: false }
        : i,
      ),
    }));

    // Update the container's slots field.
    nextSpaces = nextSpaces.map(s =>
      s.id === containerSpaceId
        ? { ...s, items: s.items.map(i => i.id === containerId ? { ...i, slots: newSlots } : i) }
        : s,
    );

    save({ ...data, spaces: nextSpaces });
  }, [data, save]);

  // ── Dismissed suggestions (F5: cooldown structure) ────────
  // Each dismiss records its timestamp and increments the count; useGhostCards
  // checks if the cooldown window has elapsed before re-showing the suggestion.
  const dismissSuggestion = useCallback((value: string) => {
    const now = Date.now();
    const prev = data.dismissals?.[value];
    const dismissals = {
      ...(data.dismissals ?? {}),
      [value]: { at: now, count: (prev?.count ?? 0) + 1 },
    };
    save({ ...data, dismissals });
  }, [data, save]);

  /**
   * Pull the persisted data from electron-store and replace local state.
   * Used when the main process mutates settings out-of-band (e.g. tray menu
   * or floating-orb right-click toggling the floating button on/off).
   */
  const reloadFromStore = useCallback(async () => {
    const loaded = await electronAPI.storeLoad();
    if (!loaded) return;
    const next = migrateData(loaded as AppData);
    setRawData(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  // ── Floating badges (Phase 2) ────────────────────────────
  // Main is the source of truth for the floatingBadges array — mutations from
  // the overlay (click/unpin/drag) flow back through the `badges-updated` IPC,
  // and this setter reconciles local state without triggering a redundant
  // storeSave (main has already persisted to electron-store).
  const setFloatingBadgesLocal = useCallback((next: import('../types').FloatingBadge[]) => {
    setDataRaw(prev => {
      if (JSON.stringify(prev.floatingBadges) === JSON.stringify(next)) return prev;
      const patched = { ...prev, floatingBadges: next };
      // Mirror into localStorage so next session's sync-load reflects latest.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(patched));
      return patched;
    });
  }, []);

  // ── Licensing (Phase 5) ───────────────────────────────────
  /**
   * Replace the license snapshot. Called by useLicenseSync when the server
   * returns a fresh verify response, by the checkout flow on successful
   * payment, and by startTrial() below.
   */
  const setLicense = useCallback((license: import('../types').License | undefined) => {
    setRawData(prev => {
      const next: AppData = {
        ...prev,
        settings: { ...prev.settings, license },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  /** Client-award the 14-day trial. Idempotent — if a trial is already active
   *  or previously consumed, this is a no-op. The server re-signs the trial
   *  window on first login so stolen clocks can't extend it. */
  const startTrialIfEligible = useCallback(() => {
    setRawData(prev => {
      const existing = prev.settings.license;
      // Trial is a one-shot gift — any prior license (even expired) forfeits it.
      if (existing) return prev;
      const next: AppData = {
        ...prev,
        settings: { ...prev.settings, license: newTrialLicense() },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  // ── Settings ─────────────────────────────────────────────
  const updateSettings = useCallback((settings: AppSettings) => {
    electronAPI.setOpacity(settings.opacity);
    electronAPI.updateShortcut(settings.shortcut);
    save({ ...data, settings });
  }, [data, save]);

  return {
    data,
    isFirstRun,
    addSpace,
    renameSpace,
    deleteSpace,
    reorderSpaces,
    setSpaceColor,
    setSpaceIcon,
    setPairSplitRatio,
    duplicateSpace,
    toggleSpaceCollapsed,
    sortSpaceByUsage,
    lockSpaceSort,
    addItem,
    addItems,
    updateItem,
    patchItems,
    deleteItem,
    deleteItems,
    deleteUnpinnedInSpace,
    deleteUnpinnedInAllSpaces,
    restoreItem,
    restoreSpace,
    incrementClickCount,
    reorderItems,
    moveItemToSpace,
    updateItemAndMove,
    updateSettings,
    reloadFromStore,
    getNodeGroupForItem,
    addNodeGroup,
    updateNodeGroup,
    deleteNodeGroup,
    reorderNodeGroups,
    addDeck,
    updateDeck,
    deleteDeck,
    saveContainerSlots,
    assignSlotFromItem,
    setFloatingBadgesLocal,
    dismissSuggestion,
    // ── Preset + tour (Phase 4) ────────────────────────────────
    presets: raw.presets,
    activePresetId: raw.activePresetId,
    setActivePreset,
    renamePreset,
    completedTours: raw.completedTours ?? [],
    markTourCompleted,
    // ── Licensing (Phase 5) ────────────────────────────────────
    setLicense,
    startTrialIfEligible,
  };
}
