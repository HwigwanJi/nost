import { useState, useCallback, useEffect } from 'react';
import type { AppData, Space, LauncherItem, AppSettings, NodeGroup, Deck, ContainerSlots } from '../types';
import { electronAPI } from '../electronBridge';

const STORAGE_KEY = 'quicklauncherData';

function generateId() {
  return Math.random().toString(36).slice(2);
}

function defaultData(): AppData {
  const defaultSpace: Space = {
    id: generateId(),
    name: '즐겨찾기',
    items: [
      { id: generateId(), type: 'url', title: '네이버', value: 'https://www.naver.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '다음', value: 'https://www.daum.net', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '유튜브', value: 'https://www.youtube.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '구글', value: 'https://www.google.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '지메일', value: 'https://mail.google.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '카카오', value: 'https://www.kakao.com', clickCount: 0, pinned: false },
    ],
    color: undefined,
    sortMode: 'custom',
    pinnedIds: [],
  };
  return {
    spaces: [defaultSpace],
    settings: { opacity: 0.95, closeAfterOpen: false, shortcut: 'Alt+4', theme: 'dark', autoLaunch: false },
    shortcut: 'Alt+4',
    collapsedSpaceIds: [],
  };
}

function migrateData(parsed: AppData): AppData {
  parsed.settings = { ...parsed.settings, theme: parsed.settings.theme ?? 'dark', autoLaunch: parsed.settings.autoLaunch ?? false, autoHide: parsed.settings.autoHide ?? false, accentColor: parsed.settings.accentColor ?? '#6366f1', documentExtensions: parsed.settings.documentExtensions ?? [] };
  parsed.collapsedSpaceIds = parsed.collapsedSpaceIds ?? [];
  parsed.nodeGroups = parsed.nodeGroups ?? [];
  parsed.spaces = parsed.spaces.map(s => ({
    ...s,
    sortMode: s.sortMode ?? 'custom',
    pinnedIds: s.pinnedIds ?? [],
    items: s.items.map(i => ({ ...i, clickCount: i.clickCount ?? 0, pinned: i.pinned ?? false })),
  }));
  return parsed;
}

function loadDataSync(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateData(JSON.parse(raw) as AppData);
  } catch { /* ignore */ }
  return defaultData();
}

// ── Loading screen helpers (DOM direct — works before React paint) ──
function setLoadingProgress(pct: number) {
  const bar = document.getElementById('ql-loading-bar');
  if (bar) bar.style.width = `${pct}%`;
}

function dismissLoadingScreen() {
  const el = document.getElementById('ql-loading');
  if (!el) return;
  setLoadingProgress(100);
  // Signal Electron main that renderer is fully ready — window will be shown now
  electronAPI.signalReady();
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 280);
  }, 150);
}

export function useAppData() {
  const [data, setDataRaw] = useState<AppData>(() => loadDataSync());
  const [isFirstRun, setIsFirstRun] = useState(false);

  // On mount: load from electron-store (migrating from localStorage if needed)
  useEffect(() => {
    setLoadingProgress(60); // React mounted
    electronAPI.setLoadingStatus('데이터 불러오는 중...');
    electronAPI.storeLoad().then(stored => {
      if (stored && typeof stored === 'object' && 'spaces' in (stored as AppData)) {
        setDataRaw(migrateData(stored as AppData));
      } else {
        const localRaw = localStorage.getItem(STORAGE_KEY);
        if (!localRaw) setIsFirstRun(true);
        const localData = loadDataSync();
        electronAPI.storeSave(localData);
      }
      setLoadingProgress(90); // data ready
      electronAPI.setLoadingStatus('화면 그리는 중...');
      requestAnimationFrame(() => requestAnimationFrame(dismissLoadingScreen)); // after first paint
    });
  }, []);

  const save = useCallback((next: AppData) => {
    setDataRaw(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    electronAPI.storeSave(next);
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

  const reorderSpaces = useCallback((newSpaces: Space[]) => {
    save({ ...data, spaces: newSpaces });
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

  const sortSpaceByUsage = useCallback((id: string) => {
    save({
      ...data,
      spaces: data.spaces.map(s => {
        if (s.id !== id) return s;
        const pinnedIds = s.pinnedIds ?? [];
        const pinned = s.items.filter(i => pinnedIds.includes(i.id));
        const rest = s.items.filter(i => !pinnedIds.includes(i.id));
        rest.sort((a, b) => (b.clickCount ?? 0) - (a.clickCount ?? 0));
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

  const incrementClickCount = useCallback((spaceId: string, itemId: string) => {
    save({
      ...data,
      spaces: data.spaces.map(s =>
        s.id === spaceId
          ? { ...s, items: s.items.map(i => i.id === itemId ? { ...i, clickCount: (i.clickCount ?? 0) + 1 } : i) }
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
    duplicateSpace,
    toggleSpaceCollapsed,
    sortSpaceByUsage,
    lockSpaceSort,
    addItem,
    updateItem,
    deleteItem,
    incrementClickCount,
    reorderItems,
    moveItemToSpace,
    updateItemAndMove,
    updateSettings,
    getNodeGroupForItem,
    addNodeGroup,
    updateNodeGroup,
    deleteNodeGroup,
    reorderNodeGroups,
    addDeck,
    updateDeck,
    deleteDeck,
    saveContainerSlots,
  };
}
