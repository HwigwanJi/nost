import { useState, useCallback, useMemo, useEffect } from 'react';
import type { AppData, AppMode, LauncherItem } from '../types';
import { electronAPI } from '../electronBridge';
import type { ShowToast } from '../contexts/AppContext';

interface UseNodeDeckModeOptions {
  data: AppData;
  store: {
    addNodeGroup: (name: string, itemIds: string[]) => void;
    /** Patch a node group's itemIds (used by edit-existing-group mode
     *  for live add/remove/FIFO-replace as the user clicks main grid). */
    updateNodeGroup: (id: string, updates: { itemIds?: string[] }) => void;
    addDeck: (name: string, itemIds: string[]) => void;
  };
  showToast: ShowToast;
  dismissToast: () => void;
  showTileOverlay: (groupId: string) => void;
}

const NODE_MAX = 3;

const arraysShallowEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

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
  // ── Edit-existing-group mode ─────────────────────────────────────
  // When set, node mode is editing an EXISTING NodeGroup (B mode in
  // the spec) rather than building a new one (A mode). The single
  // global `activeMode === 'node'` flag covers both — this id is the
  // discriminator. nodeBuilding mirrors group.itemIds while we're in
  // B mode so ItemCard's existing visual grammar (membership, order)
  // works without a new context field.
  const [editingNodeGroupId, setEditingNodeGroupId] = useState<string | null>(null);
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
  //
  // Tool-mode exclusivity:
  //   - Same tool while active → toggles off (quick exit shortcut)
  //   - Different tool while in a tool → BLOCKED with a toast; user must
  //     ESC (or click the active tool) first. Prevents accidental loss of
  //     in-progress work like a half-built node group.
  //   - normal ↔ any tool → allowed as before.
  const handleModeChange = useCallback((mode: AppMode) => {
    setActiveMode(current => {
      if (current !== 'normal' && mode !== 'normal' && current !== mode) {
        showToast('ESC로 현재 도구를 먼저 해제하세요', { duration: 2000 });
        return current;
      }

      if (mode !== 'node') { setNodeEditMode(false); setNodeBuilding([]); }
      if (mode !== 'deck') { setDeckBuilding(false); setDeckItems([]); }
      dismissToast();

      if (mode === 'pin')   showToast('📌 고정 모드 — 카드 클릭하면 핀 토글', { persistent: true });
      if (mode === 'clean') showToast('🧹 청소 모드 — 스페이스의 청소 버튼을 눌러 고정 안 된 카드 삭제 (ESC로 해제)', { persistent: true });
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
      return mode;
    });
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
    setEditingNodeGroupId(null);
    setActiveMode('normal');
    dismissToast();
  }, [dismissToast]);

  // ── Edit existing node group (B mode) ──────────────────────────
  //
  // Triggered by the ✏️ button on a NodePanel group card. Promotes the
  // app into the same `activeMode === 'node'` modality used for new-
  // build, but with `editingNodeGroupId` set as the routing
  // discriminator. ItemCard reads the same `nodeBuilding` array — we
  // just preload it from the group's current itemIds so member cards
  // already show the correct order badges from frame 1.
  const handleStartEditExistingGroup = useCallback((groupId: string) => {
    const group = (data.nodeGroups ?? []).find(g => g.id === groupId);
    if (!group) return;
    // Exit conflicting modes first (deck etc.). Same exclusivity rule
    // as handleModeChange — a half-built deck shouldn't survive a node
    // edit start.
    setDeckBuilding(false);
    setDeckItems([]);
    setNodeEditMode(true);
    setNodeBuilding([...group.itemIds]);
    setEditingNodeGroupId(groupId);
    setActiveMode('node');
    dismissToast();
    showToast(
      `🔗 "${group.name}" 편집 — 카드 클릭으로 추가/제거 · ESC로 종료`,
      { persistent: true },
    );
  }, [data.nodeGroups, showToast, dismissToast]);

  // Click handler used during B mode (edit existing). Mutates the
  // group LIVE — no separate save step. Three branches:
  //   1. Card already a member → remove it.
  //   2. Group has < 3 → append the new card at the end.
  //   3. Group has 3 (full) → FIFO slide: drop the OLDEST member, push
  //      the new card to the tail. Per Decision C in the design chat
  //      ("가득차면 1번 대신 4번 추가"). Toast announces the swap so
  //      the displacement isn't silent — silent eviction is the worst
  //      outcome (user thinks add failed).
  const handleNodeEditClick = useCallback((itemId: string) => {
    if (!editingNodeGroupId) return;
    const group = (data.nodeGroups ?? []).find(g => g.id === editingNodeGroupId);
    if (!group) return;
    // Read from local nodeBuilding (single source of truth during B
    // mode) rather than data.nodeGroups, which is one render behind
    // when the user clicks rapidly. The sync useEffect reconciles
    // both directions, so nodeBuilding is always at-least-as-fresh.
    const cur = nodeBuilding;

    // Remove if already a member.
    if (cur.includes(itemId)) {
      const next = cur.filter(id => id !== itemId);
      store.updateNodeGroup(group.id, { itemIds: next });
      setNodeBuilding(next);
      // Brief, transient toast — don't drown the persistent edit-mode
      // toast. Use immediate so it stacks above without delay.
      const removed = allItems.find(i => i.id === itemId);
      if (removed) {
        showToast(`"${removed.title}" 제거`, { duration: 1400, immediate: true });
      }
      return;
    }

    // Append when not full.
    if (cur.length < NODE_MAX) {
      const next = [...cur, itemId];
      store.updateNodeGroup(group.id, { itemIds: next });
      setNodeBuilding(next);
      const added = allItems.find(i => i.id === itemId);
      if (added) {
        showToast(`"${added.title}" 추가 (${next.length}/${NODE_MAX})`, { duration: 1400, immediate: true });
      }
      return;
    }

    // FIFO slide replace at full. Oldest (index 0) drops off, new card
    // takes the tail. Visual order: [B, C, D] from prior [A, B, C].
    const evictedId = cur[0];
    const next = [...cur.slice(1), itemId];
    store.updateNodeGroup(group.id, { itemIds: next });
    setNodeBuilding(next);
    const evicted = allItems.find(i => i.id === evictedId);
    const added = allItems.find(i => i.id === itemId);
    if (evicted && added) {
      showToast(
        `"${evicted.title}" → "${added.title}" 교체 (가득 참)`,
        { duration: 2000, immediate: true },
      );
    }
  }, [editingNodeGroupId, data.nodeGroups, nodeBuilding, allItems, store, showToast]);

  // Sync nodeBuilding ← group.itemIds whenever the group changes from
  // OUTSIDE (NodePanel internal drag-reorder, picker add, X-remove on
  // a member chip). Without this, the panel's local mutations would
  // diverge from the visual on the main grid until the user clicked
  // again. Cheap: shallow-equal guard prevents render thrash.
  useEffect(() => {
    if (!editingNodeGroupId) return;
    const g = (data.nodeGroups ?? []).find(g => g.id === editingNodeGroupId);
    if (!g) {
      // Group was deleted while editing — bail out of B mode.
      handleCancelNodeEdit();
      return;
    }
    if (!arraysShallowEqual(g.itemIds, nodeBuilding)) {
      setNodeBuilding(g.itemIds);
    }
  }, [editingNodeGroupId, data.nodeGroups, nodeBuilding, handleCancelNodeEdit]);

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
    editingNodeGroupId,
    deckBuilding, setDeckBuilding,
    deckItems, setDeckItems,
    nodeGroups, decks, allItems, deckAnchorItemIds,
    handleModeChange,
    handleStartNodeEdit, handleCancelNodeEdit,
    handleStartEditExistingGroup,
    handleNodeEditClick,
    handleSaveNodeGroup, handleNodeBuildingClick, handleNodeGroupLaunch,
    handleDeckBuildingClick, handleSaveDeck, handleDeckLaunch, handleDeckGroupLaunch,
  };
}
