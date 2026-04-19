import { useState, useCallback, useMemo } from 'react';
import type { AppData, AppMode, LauncherItem } from '../types';
import { electronAPI } from '../electronBridge';
import type { ShowToast } from '../contexts/AppContext';

interface UseNodeDeckModeOptions {
  data: AppData;
  store: {
    addNodeGroup: (name: string, itemIds: string[]) => void;
    addDeck: (name: string, itemIds: string[]) => void;
  };
  showToast: ShowToast;
  dismissToast: () => void;
  showTileOverlay: (groupId: string) => void;
}

export function useNodeDeckMode({
  data,
  store,
  showToast,
  dismissToast,
  showTileOverlay,
}: UseNodeDeckModeOptions) {
  const [activeMode, setActiveMode] = useState<AppMode>('normal');
  const [nodeEditMode, setNodeEditMode] = useState(false);
  const [nodeBuilding, setNodeBuilding] = useState<string[]>([]);
  const [deckBuilding, setDeckBuilding] = useState(false);
  const [deckItems, setDeckItems] = useState<string[]>([]);

  const nodeGroups = useMemo(() => data.nodeGroups ?? [], [data.nodeGroups]);
  const decks = useMemo(() => data.decks ?? [], [data.decks]);
  const allItems = useMemo(() => data.spaces.flatMap(s => s.items), [data.spaces]);
  const deckAnchorItemIds = useMemo(
    () => new Set(decks.map(d => d.itemIds[0]).filter(Boolean)),
    [decks],
  );

  // ── Mode change ───────────────────────────────────────────
  const handleModeChange = useCallback((mode: AppMode) => {
    if (mode !== 'node') { setNodeEditMode(false); setNodeBuilding([]); }
    if (mode !== 'deck') { setDeckBuilding(false); setDeckItems([]); }
    dismissToast();
    setActiveMode(mode);
    if (mode === 'pin') showToast('📌 고정 모드 — 카드 클릭하면 핀 토글', { persistent: true });
    if (mode === 'node') {
      setNodeEditMode(true);
      setNodeBuilding([]);
      showToast('🔗 노드 편집 — 카드를 순서대로 클릭 (최대 3개)', { persistent: true });
    }
    if (mode === 'deck') {
      setDeckBuilding(true);
      setDeckItems([]);
      showToast('🗂 덱 편집 — 카드를 클릭해서 덱에 추가', { persistent: true });
    }
  }, [showToast, dismissToast]);

  // ── Node handlers ─────────────────────────────────────────
  const handleStartNodeEdit = useCallback(() => {
    setDeckBuilding(false);
    setDeckItems([]);
    setNodeEditMode(true);
    setNodeBuilding([]);
    setActiveMode('node');
    dismissToast();
    showToast('🔗 노드 편집 — 카드를 순서대로 클릭 (최대 3개)', { persistent: true });
  }, [showToast, dismissToast]);

  const handleCancelNodeEdit = useCallback(() => {
    setNodeEditMode(false);
    setNodeBuilding([]);
    setActiveMode('normal');
    dismissToast();
  }, [dismissToast]);

  const handleSaveNodeGroup = useCallback((name: string | undefined) => {
    if (nodeBuilding.length < 2) return;
    const existingGroups = data.nodeGroups ?? [];
    const autoName = name?.trim() || `노드 ${existingGroups.length + 1}`;
    store.addNodeGroup(autoName, nodeBuilding);
    setNodeEditMode(false);
    setNodeBuilding([]);
    setActiveMode('normal');
    dismissToast();
    showToast(`"${autoName}" 저장됨`);
  }, [nodeBuilding, data.nodeGroups, store, showToast, dismissToast]);

  const handleNodeBuildingClick = useCallback((itemId: string) => {
    setNodeBuilding(prev => {
      if (prev.includes(itemId)) return prev.filter(id => id !== itemId);
      if (prev.length >= 3) return prev;
      return [...prev, itemId];
    });
  }, []);

  const handleNodeGroupLaunch = useCallback(async (groupId: string) => {
    if (nodeEditMode) return;
    const group = nodeGroups.find(g => g.id === groupId);
    if (!group) return;
    const items = group.itemIds
      .map(id => allItems.find(i => i.id === id))
      .filter(Boolean) as LauncherItem[];
    if (items.length < 2) return;

    const itemDtos = items.map(i => ({ type: i.type, value: i.value, title: i.title }));
    showToast(`${items.length}개 앱 시작 중...`);
    const { identifiers, waitMs } = await electronAPI.launchItemsForTile(itemDtos);
    showToast(`창 열리면 자동 배치됩니다...`);
    const tileResult = await electronAPI.runTilePs({ identifiers, waitMs, monitor: group.monitor ?? 0 });
    if (tileResult.success) showToast(`${items.length}분할 완료`);
    else showToast(`창 배치 실패: ${tileResult.error || '시간 초과'}`);
    showTileOverlay(groupId);
  }, [nodeGroups, allItems, nodeEditMode, showToast, showTileOverlay]);

  // ── Deck handlers ─────────────────────────────────────────
  const handleDeckBuildingClick = useCallback((itemId: string) => {
    setDeckItems(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  }, []);

  const handleSaveDeck = useCallback((name: string) => {
    if (deckItems.length < 1) return;
    store.addDeck(name, deckItems);
    setDeckBuilding(false);
    setDeckItems([]);
    setActiveMode('normal');
    dismissToast();
    showToast(`"${name}" 덱 저장됨`);
  }, [deckItems, store, showToast, dismissToast]);

  const handleDeckLaunch = useCallback(async (deckId: string) => {
    const deck = (data.decks ?? []).find(d => d.id === deckId);
    if (!deck) return;
    const items = deck.itemIds.map(id => allItems.find(i => i.id === id)).filter(Boolean) as LauncherItem[];
    if (items.length === 0) return;

    showToast(`"${deck.name}" 실행 (${items.length}개)`);
    let failCount = 0;
    const targetMonitor = deck.monitor ?? 0;

    const launchOne = async (item: LauncherItem, idx: number): Promise<boolean> => {
      switch (item.type) {
        case 'url': case 'browser': electronAPI.openUrl(item.value, false); break;
        case 'folder': electronAPI.openPath(item.value, false); break;
        case 'app': electronAPI.launchOrFocusApp(item.value, false, targetMonitor || item.monitor); break;
        case 'window': electronAPI.focusWindow(item.value, false); break;
        case 'text': electronAPI.copyText(item.value, false); break;
        case 'cmd': electronAPI.runCmd(item.value, false); break;
      }
      if (item.type === 'app' || item.type === 'window') {
        const MAX = 20;
        for (let a = 0; a < MAX; a++) {
          const interval = a < 4 ? 300 : a < 10 ? 500 : 1000;
          await new Promise(r => setTimeout(r, interval));
          const results = await electronAPI.checkItemsForTile([{ type: item.type, value: item.value, title: item.title }]);
          if (results[0]?.alive) {
            showToast(`${idx + 1}/${items.length} ${item.title}`);
            electronAPI.maximizeWindow({ item: { type: item.type, value: item.value, title: item.title }, monitor: targetMonitor });
            return true;
          }
          if (a >= 3) showToast(`${idx + 1}/${items.length} ${item.title} 대기 중... (${a + 1}/${MAX})`);
        }
        showToast(`${item.title} 열기 실패 (시간 초과)`);
        return false;
      }
      showToast(`${idx + 1}/${items.length} ${item.title}`);
      return true;
    };

    for (let i = 0; i < items.length; i += 2) {
      const batch = items.slice(i, i + 2);
      const results = await Promise.all(batch.map((item, j) => launchOne(item, i + j)));
      failCount += results.filter(r => !r).length;
    }
    if (failCount === 0) showToast(`"${deck.name}" 완료`);
    else showToast(`"${deck.name}" ${failCount}개 실패`);
  }, [data.decks, allItems, showToast]);

  const handleDeckGroupLaunch = useCallback((itemId: string) => {
    const deck = (data.decks ?? []).find(d => d.itemIds.includes(itemId));
    if (deck) handleDeckLaunch(deck.id);
  }, [data.decks, handleDeckLaunch]);

  return {
    activeMode, setActiveMode,
    nodeEditMode, setNodeEditMode,
    nodeBuilding, setNodeBuilding,
    deckBuilding, setDeckBuilding,
    deckItems, setDeckItems,
    nodeGroups, decks, allItems, deckAnchorItemIds,
    handleModeChange,
    handleStartNodeEdit, handleCancelNodeEdit,
    handleSaveNodeGroup, handleNodeBuildingClick, handleNodeGroupLaunch,
    handleDeckBuildingClick, handleSaveDeck, handleDeckLaunch, handleDeckGroupLaunch,
  };
}
