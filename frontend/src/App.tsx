import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Toaster } from 'sonner';
import { Icon } from '@/components/ui/Icon';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SpaceAccordion } from './components/SpaceAccordion';
import { ItemDialog } from './components/ItemDialog';
import { ItemWizard } from './components/ItemWizard';
import { ScanDialog } from './components/ScanDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { RecommendPanel } from './components/RecommendPanel';
import { useGhostCards } from './hooks/useGhostCards';
import { GhostCard } from './components/GhostCard';
import { DialogContextBar } from './components/DialogContextBar';
import { NodePanel } from './components/NodePanel';
import { ContainerSlotPicker, type PendingRemoval, type PendingNewItem } from './components/ContainerSlotPicker';
import { CommandBar, parseCommand, buildSuggestions } from './components/CommandBar';
import { ToastOverlay } from './components/ToastOverlay';
import { ClipboardSuggestion } from './components/ClipboardSuggestion';
import { WelcomeModal } from './components/WelcomeModal';
import { TileOverlay } from './components/TileOverlay';
import type { ParsedCommand } from './components/CommandBar';
import { useAppData } from './hooks/useAppData';
import { useToastQueue, type ToastAction } from './hooks/useToastQueue';
import { useTileOverlay } from './hooks/useTileOverlay';
import { useLaunchPipeline } from './hooks/useLaunchPipeline';
import { useWindowDrag } from './hooks/useWindowDrag';
import { useNodeDeckMode } from './hooks/useNodeDeckMode';
import { electronAPI } from './electronBridge';
import type { LauncherItem, Space } from './types';
import { AppStateProvider, AppActionsProvider } from './contexts/AppContext';
import type { AppActions, AppState } from './contexts/AppContext';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  DragOverlay,
} from '@dnd-kit/core';

// ── Right-click sensor for card reordering ──────────────────
class RightPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        return event.button === 2;
      },
    },
  ];
}
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Sortable space wrapper ───────────────────────────────────
// Only the ⠿ grip renders listeners (passed as dragHandle prop)
function SortableSpace({
  id,
  children,
}: {
  id: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const dragHandle = (
    <span
      {...listeners}
      {...attributes}
      style={{ cursor: 'grab', fontSize: 13, lineHeight: 1, touchAction: 'none' }}
      title="드래그해서 순서 변경"
    >
      ⠿
    </span>
  );
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
      }}
    >
      {children(dragHandle)}
    </div>
  );
}

type DialogMode = 'none' | 'item' | 'scan' | 'settings' | 'wizard' | 'quickadd' | 'container-slots';

export default function App() {
  const store = useAppData();
  const { data } = store;

  const [dialog, setDialog] = useState<DialogMode>('none');
  const [editItem, setEditItem] = useState<LauncherItem | null>(null);
  const [editSpaceId, setEditSpaceId] = useState<string>('');
  const [prefilledItem, setPrefilledItem] = useState<Partial<LauncherItem> | null>(null);
  const [recommendOpen, setRecommendOpen] = useState(false);

  const ghostCards = useGhostCards({
    spaces: data.spaces,
    dismissedValues: data.dismissedSuggestions ?? [],
    documentExtensions: data.settings.documentExtensions,
    onDismiss: (value) => store.dismissSuggestion(value),
  });

  const [query, setQuery] = useState('');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  // ── CommandBar state ──────────────────────────────────────
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState('');

  const { tileOverlayGroup, tileOverlayLeaving, showTileOverlay, dismissTileOverlay } = useTileOverlay();
  const { toasts, showToast, dismissToast, pauseToast, resumeToast } = useToastQueue();
  const { launchAndPosition } = useLaunchPipeline({ showToast, dismissToast });

  // ── Mode / Node / Deck state ──────────────────────────────
  const {
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
  } = useNodeDeckMode({ data, store, showToast, dismissToast, showTileOverlay });


  // ── Toast notification — FIFO queue (non-overlapping) ────

  // ── Monitor tracking ─────────────────────────────────────
  const [monitorCount, setMonitorCount] = useState(1);
  useEffect(() => {
    electronAPI.getMonitors().then(ms => { if (ms.length > 0) setMonitorCount(ms.length); });
    electronAPI.onMonitorsChanged(monitors => {
      if (monitors.length > 0) setMonitorCount(monitors.length);
    });
  }, []);

  // ── Clipboard quick-add suggestion ───────────────────────
  const [clipSuggestion, setClipSuggestion] = useState<{ type: 'url' | 'app' | 'folder'; value: string; label: string } | null>(null);
  const lastClipValueRef = useRef('');
  useEffect(() => {
    const check = async () => {
      const result = await electronAPI.analyzeClipboard();
      if (result.type === 'none' || !result.value) { return; }
      if (result.value === lastClipValueRef.current) return; // same as last time — don't re-show
      lastClipValueRef.current = result.value;
      setClipSuggestion({ type: result.type, value: result.value, label: result.label ?? result.value });
    };
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    check(); // also check on mount
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // ── Extension banner ──────────────────────────────────────
  const [extBannerDismissed, setExtBannerDismissed] = useState(
    () => localStorage.getItem('ext-banner-dismissed') === '1'
  );
  const [extConnected, setExtConnected] = useState<boolean | null>(null);
  useEffect(() => {
    electronAPI.getExtensionBridgeStatus().then(s => {
      setExtConnected(s.connected || s.tabsCount > 0 || s.lastExtensionConnectedAt > 0);
    });
  }, []);

  // ── Settings initial tab ──────────────────────────────────
  const [settingsInitialTab, setSettingsInitialTab] = useState<'general' | 'monitor' | 'docs' | 'extension' | 'data' | undefined>(undefined);
  const openSettingsTab = (tab: 'general' | 'monitor' | 'docs' | 'extension' | 'data') => {
    setSettingsInitialTab(tab);
    setDialog('settings');
  };

  // ── Inactive window tracking ──────────────────────────────
  const [inactiveWindowIds, setInactiveWindowIds] = useState<Set<string>>(new Set());

  const checkWindowsNow = useCallback(async () => {
    const windowItems = data.spaces.flatMap(s => s.items).filter(i => i.type === 'window');
    if (!windowItems.length) { setInactiveWindowIds(new Set()); return; }
    const titles = [...new Set(windowItems.map(i => i.value))];
    const aliveMap = await electronAPI.checkWindowsAlive(titles);
    const deadIds = new Set<string>();
    for (const item of windowItems) {
      if (!aliveMap[item.value]) deadIds.add(item.id);
    }
    setInactiveWindowIds(deadIds);
  }, [data.spaces]);

  useEffect(() => {
    checkWindowsNow();
    const timer = setInterval(checkWindowsNow, 15000);
    return () => clearInterval(timer);
  }, [checkWindowsNow]);

  // ── Theme sync to <html> ──────────────────────────────────
  useEffect(() => {
    // Ghost card mode → force fully opaque so cards are visible
    electronAPI.setOpacity(ghostCards.active ? 1 : data.settings.opacity);
  }, [data.settings.opacity, ghostCards.active]);

  useEffect(() => {
    const root = document.documentElement;
    if (data.settings.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [data.settings.theme]);

  // Apply accent color as CSS variable
  useEffect(() => {
    const accent = data.settings.accentColor || '#6366f1';
    document.documentElement.style.setProperty('--accent', accent);
    // Derive a muted version for borders/hover
    document.documentElement.style.setProperty('--accent-dim', accent + '33');
  }, [data.settings.accentColor]);

  // ── Right-click drag to move window ───────────────────────
  useWindowDrag();

  // ── Sync mode → body class + custom cursor ────────────────
  useEffect(() => {
    document.getElementById('ql-mode-cursor')?.remove();
    document.body.classList.remove('mode-pin', 'mode-node', 'mode-deck');

    if (activeMode === 'pin') document.body.classList.add('mode-pin');
    if (activeMode === 'node') document.body.classList.add('mode-node');
    if (activeMode === 'deck') document.body.classList.add('mode-deck');

    if (activeMode === 'normal') return;

    const colorMap: Record<string, string> = { pin: '#f59e0b', node: '#6366f1', deck: '#f97316' };
    const color = colorMap[activeMode] ?? '';
    if (!color) return;

    // Icon-based fill cursors — each mode gets a recognizable filled icon
    // pin: filled pushpin path, node: hub circles+lines, deck: stacked bars
    const iconMap: Record<string, string> = {
      pin:  `<circle cx='16' cy='16' r='16' fill='${color}'/><path d='M18 3v2l-1 1v5l3 2v2h-4v5h-2v-5H10v-2l3-2V6l-1-1V3h6z' fill='white'/>`,
      node: `<circle cx='16' cy='16' r='16' fill='${color}'/><circle cx='16' cy='11' r='2.5' fill='white'/><circle cx='10' cy='21' r='2.5' fill='white'/><circle cx='22' cy='21' r='2.5' fill='white'/><line x1='16' y1='13.5' x2='10' y2='18.5' stroke='white' stroke-width='1.4'/><line x1='16' y1='13.5' x2='22' y2='18.5' stroke='white' stroke-width='1.4'/>`,
      deck: `<circle cx='16' cy='16' r='16' fill='${color}'/><rect x='8' y='10' width='16' height='3' rx='1.5' fill='white'/><rect x='8' y='14.5' width='16' height='3' rx='1.5' fill='white' opacity='0.75'/><rect x='8' y='19' width='16' height='3' rx='1.5' fill='white' opacity='0.5'/>`,
    };
    const icon = iconMap[activeMode] ?? '';

    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'>${icon}</svg>`;
    const cursorUrl = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, default`;

    // Inject a <style> so the cursor overrides even elements with cursor:pointer
    const styleEl = document.createElement('style');
    styleEl.id = 'ql-mode-cursor';
    styleEl.textContent = `* { cursor: ${cursorUrl} !important; }`;
    document.head.appendChild(styleEl);

    return () => {
      document.getElementById('ql-mode-cursor')?.remove();
      document.body.classList.remove('mode-pin', 'mode-node', 'mode-deck');
    };
  }, [activeMode]);

  // ── Global key capture → open CommandBar ─────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if already in CommandBar, a dialog is open, or inside an input
      if (cmdOpen) return;
      if (dialog !== 'none') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Only capture printable characters (single char, no modifier key combos)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      // Open CommandBar with first character pre-filled
      setCmdInput(e.key);
      setCmdOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cmdOpen, dialog]);

  // ── Global Esc key ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Priority 0: close CommandBar
      if (cmdOpen) { setCmdOpen(false); setCmdInput(''); return; }
      // Priority 1: save node group if building ≥2
      if (nodeEditMode) {
        if (nodeBuilding.length >= 2) handleSaveNodeGroup(undefined);
        else { setNodeEditMode(false); setNodeBuilding([]); dismissToast(); }
        return;
      }
      // Priority 1b: cancel deck build
      if (deckBuilding) {
        setDeckBuilding(false);
        setDeckItems([]);
        setActiveMode('normal');
        dismissToast();
        return;
      }
      // Priority 2: exit pin mode
      if (activeMode !== 'normal') {
        setActiveMode('normal');
        dismissToast();
        return;
      }
      // Priority 3: close tile overlay
      if (tileOverlayGroup) { dismissTileOverlay(); return; }
      // Priority 4: close dialog
      if (dialog !== 'none') { setDialog('none'); setEditItem(null); setPrefilledItem(null); return; }
      // Priority 5: hide app
      electronAPI.hideApp();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, activeMode, tileOverlayGroup, nodeEditMode, nodeBuilding, deckBuilding, cmdOpen]);


  // ── Dialog helpers ────────────────────────────────────────
  const openEditItem = useCallback((item: LauncherItem, spaceId: string) => {
    setEditItem(item);
    setEditSpaceId(spaceId);
    setPrefilledItem(null);
    setDialog('item');
  }, []);

  const openScan = useCallback((spaceId: string) => {
    setEditSpaceId(spaceId);
    setDialog('scan');
  }, []);

  const openQuickAdd = useCallback((spaceId?: string) => {
    setEditSpaceId(spaceId ?? data.spaces[0]?.id ?? '');
    setDialog('quickadd');
  }, [data.spaces]);

  const openManualWizard = useCallback((spaceId?: string) => {
    setEditItem(null);
    setPrefilledItem(null);
    setEditSpaceId(spaceId ?? data.spaces[0]?.id ?? '');
    setDialog('wizard');
  }, [data.spaces]);

  const handleClipboardAdd = useCallback(() => {
    if (!clipSuggestion) return;
    const { type, value, label } = clipSuggestion;
    setEditItem(null);
    setPrefilledItem({ type, value, title: label, clickCount: 0, pinned: false } as Partial<import('./types').LauncherItem>);
    setEditSpaceId(data.spaces[0]?.id ?? '');
    setClipSuggestion(null);
    setDialog('item');
  }, [clipSuggestion, data.spaces]);

  // ── Kick feature (file dialog detection) ─────────────────
  const [activeDialog, setActiveDialog] = useState<{ isDialog: boolean; title?: string } | null>(null);
  useEffect(() => {
    const timer = setInterval(async () => {
      const res = await electronAPI.detectDialog();
      if (res.isDialog && res.title !== activeDialog?.title) setActiveDialog(res);
      else if (!res.isDialog && activeDialog) setActiveDialog(null);
    }, 1500);
    return () => clearInterval(timer);
  }, [activeDialog]);

  const jumpFolders = data.spaces.flatMap(s => s.items.filter(i => i.type === 'folder'));

  // ── Scan select → prefill ItemDialog ─────────────────────
  const handleScanSelect = useCallback((type: string, title: string, value: string, extra?: { exePath?: string; iconType?: 'material' | 'image'; icon?: string }) => {
    setPrefilledItem({
      type: type as LauncherItem['type'],
      title,
      value,
      ...(extra?.exePath ? { exePath: extra.exePath } : {}),
      ...(extra?.iconType ? { iconType: extra.iconType } : {}),
      ...(extra?.icon ? { icon: extra.icon } : {}),
    });
    setEditItem(null);
    setDialog('item');
  }, []);

  const handleSaveItem = useCallback((spaceId: string, item: Omit<LauncherItem, 'id'> | LauncherItem) => {
    if ('id' in item) {
      // Find the item's CURRENT space (might differ if user changed space in dialog)
      const currentSpaceId = data.spaces.find(s => s.items.some(i => i.id === (item as LauncherItem).id))?.id;
      if (currentSpaceId && currentSpaceId !== spaceId) {
        // Space changed: update data AND move atomically
        store.updateItemAndMove(currentSpaceId, spaceId, item as LauncherItem);
      } else {
        store.updateItem(currentSpaceId ?? spaceId, item as LauncherItem);
      }
    } else {
      store.addItem(spaceId, item as Omit<LauncherItem, 'id'>);
    }
  }, [store, data.spaces]);

  // ── Item launcher (shared between card clicks & commands) ─
  const launchItem = useCallback((item: LauncherItem, spaceId: string) => {
    store.incrementClickCount(spaceId, item.id);
    launchAndPosition(item, data.settings.closeAfterOpen);
  }, [store, data.settings.closeAfterOpen, launchAndPosition]);

  const handleSetMonitor = useCallback((spaceId: string, itemId: string, monitor: number | undefined) => {
    const space = data.spaces.find(s => s.id === spaceId);
    const item = space?.items.find(i => i.id === itemId);
    if (!item) return;
    store.updateItem(spaceId, { ...item, monitor });
  }, [data.spaces, store]);

  // ── Container state ───────────────────────────────────────
  const [containerSlotItem, setContainerSlotItem] = useState<{ spaceId: string; itemId: string; defaultDir?: string } | null>(null);

  const handleConvertToContainer = useCallback((spaceId: string, itemId: string) => {
    const space = data.spaces.find(s => s.id === spaceId);
    const item = space?.items.find(i => i.id === itemId);
    if (!item) return;
    store.updateItem(spaceId, { ...item, isContainer: true, slots: {} });
  }, [data.spaces, store]);

  const handleConvertFromContainer = useCallback((spaceId: string, itemId: string) => {
    const space = data.spaces.find(s => s.id === spaceId);
    const item = space?.items.find(i => i.id === itemId);
    if (!item) return;
    const { isContainer: _ic, slots: _slots, ...rest } = item;
    store.updateItem(spaceId, rest);
  }, [data.spaces, store]);

  const handleEditSlots = useCallback((spaceId: string, itemId: string, dir?: string) => {
    setContainerSlotItem({ spaceId, itemId, defaultDir: dir });
    setDialog('container-slots');
  }, []);

  const handleSaveSlots = useCallback((
    slots: import('./types').ContainerSlots,
    removals: PendingRemoval[],
    newItems: PendingNewItem[],
  ) => {
    if (!containerSlotItem) return;
    const { spaceId, itemId } = containerSlotItem;
    // Use atomic saveContainerSlots to avoid stale-closure overwrite race:
    // previously addItem/updateItem/updateItem each spread the same stale `data`,
    // causing each call to overwrite the previous one (only the last write survived).
    store.saveContainerSlots(spaceId, itemId, slots, removals, newItems);
    setDialog('none');
    setContainerSlotItem(null);
  }, [containerSlotItem, store]);

  const handleTogglePin = useCallback((space: Space, itemId: string) => {
    const current = space.pinnedIds ?? [];
    const next = current.includes(itemId)
      ? current.filter(i => i !== itemId)
      : [...current, itemId];
    store.lockSpaceSort(space.id, next);
  }, [store]);


  const handleWindowInactiveClick = useCallback(async (item: LauncherItem) => {
    const actions: ToastAction[] = [
      {
        label: '새로고침',
        icon: 'refresh',
        onClick: async () => {
          dismissToast();
          await checkWindowsNow();
          const aliveMap = await electronAPI.checkWindowsAlive([item.value]);
          if (aliveMap[item.value]) {
            electronAPI.focusWindow(item.value, data.settings.closeAfterOpen);
            showToast('✅ 창이 다시 활성화됨');
          } else {
            showToast('창을 여전히 찾을 수 없습니다');
          }
        },
      },
    ];

    if (item.exePath) {
      const exeExists = await electronAPI.checkFileExists(item.exePath);
      if (exeExists) {
        actions.push({
          label: '앱 열기',
          icon: 'launch',
          onClick: () => {
            dismissToast();
            launchAndPosition(item, data.settings.closeAfterOpen);
          },
        });
      } else {
        actions.push({
          label: '삭제',
          icon: 'delete',
          danger: true,
          onClick: () => {
            dismissToast();
            const space = data.spaces.find(s => s.items.some(i => i.id === item.id));
            if (space) store.deleteItem(space.id, item.id);
          },
        });
      }
    }

    showToast(`"${item.title}" 창을 찾을 수 없습니다`, { actions });
  }, [data.spaces, data.settings.closeAfterOpen, checkWindowsNow, dismissToast, showToast, store]);

  const handlePinModeClick = useCallback((itemId: string) => {
    // Find which space contains this item
    const space = data.spaces.find(s => s.items.some(i => i.id === itemId));
    if (!space) return;
    handleTogglePin(space, itemId);
    const isPinned = (space.pinnedIds ?? []).includes(itemId);
    showToast(isPinned ? '📌 핀 해제됨' : '📌 핀 고정됨');
  }, [data.spaces, handleTogglePin, showToast]);


  const handleMaximizeFromOverlay = useCallback(async (itemId: string) => {
    const allItems = data.spaces.flatMap(s => s.items);
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    await electronAPI.maximizeWindow({ item: { type: item.type, value: item.value, title: item.title } });
    dismissTileOverlay();
  }, [data.spaces, dismissTileOverlay]);

  // ── CommandBar execute ─────────────────────────────────────
  const handleCommandExecute = useCallback(async (cmd: ParsedCommand) => {
    setCmdOpen(false);
    setCmdInput('');

    if (cmd.kind === 'search') {
      setQuery(cmd.query);
      return;
    }

    if (cmd.kind === 'launch-card') {
      const space = data.spaces[cmd.spaceIdx];
      const item = space?.items[cmd.cardIdx];
      if (!item) { showToast(`❌ 카드 ${cmd.spaceIdx + 1}-${cmd.cardIdx + 1} 없음`); return; }
      launchItem(item, space.id);
      return;
    }

    if (cmd.kind === 'launch-node') {
      const ng = (data.nodeGroups ?? [])[cmd.nodeIdx];
      if (!ng) { showToast(`❌ 노드 ${cmd.nodeIdx + 1} 없음`); return; }
      handleNodeGroupLaunch(ng.id);
      return;
    }

    if (cmd.kind === 'settings') {
      setDialog('settings');
      return;
    }

    if (cmd.kind === 'help') {
      setCmdInput('/?');
      setCmdOpen(true);
      return;
    }

    if (cmd.kind === 'clipboard') {
      try {
        const text = await electronAPI.readClipboard();
        if (!text.trim()) { showToast('📋 클립보드가 비어있습니다'); return; }
        const isUrl = /^https?:\/\//i.test(text.trim()) || /^www\./i.test(text.trim());
        const isPath = /^[a-zA-Z]:\\/i.test(text.trim()) || text.startsWith('\\\\');
        const itemType = isUrl ? 'url' : isPath ? 'folder' : 'text';
        const displayTitle = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        let targetSpace: Space | undefined;
        if (cmd.spaceIdx === -1) {
          targetSpace = data.spaces[0];
          if (!targetSpace) { showToast('❌ 스페이스가 없습니다'); return; }
        } else {
          targetSpace = data.spaces[cmd.spaceIdx];
          if (!targetSpace) { showToast(`❌ 스페이스 ${cmd.spaceIdx + 1} 없음`); return; }
        }
        store.addItem(targetSpace.id, {
          title: displayTitle,
          type: itemType as LauncherItem['type'],
          value: text.trim(),
        });
        showToast(`📋 "${displayTitle}" 저장됨 → ${targetSpace.name}`);
      } catch {
        showToast('❌ 클립보드 읽기 실패');
      }
      return;
    }

    if (cmd.kind === 'tile') {
      const items = cmd.pairs.map(p => {
        const space = data.spaces[p.spaceIdx];
        return space?.items[p.cardIdx];
      });
      if (items.some(i => !i)) { showToast('❌ 일부 카드를 찾을 수 없습니다'); return; }
      const validItems = items as LauncherItem[];
      showToast(`🔗 ${validItems.length}개 창 분할 실행 중...`);
      await electronAPI.tileWindows(validItems.map(i => ({ type: i.type, value: i.value, title: i.title })));
      return;
    }

    if (cmd.kind === 'new-space') {
      store.addSpace(cmd.name);
      showToast(`✅ "${cmd.name}" 스페이스 생성됨`);
      return;
    }

    if (cmd.kind === 'pin') {
      const space = data.spaces[cmd.spaceIdx];
      const item = space?.items[cmd.cardIdx];
      if (!item) { showToast(`❌ 카드 ${cmd.spaceIdx + 1}-${cmd.cardIdx + 1} 없음`); return; }
      handleTogglePin(space, item.id);
      const isPinned = (space.pinnedIds ?? []).includes(item.id);
      showToast(isPinned ? `📌 핀 해제: ${item.title}` : `📌 핀 고정: ${item.title}`);
      return;
    }

    if (cmd.kind === 'resize-window') {
      showToast(`⏳ 창 크기 ${cmd.pct}%로 조정 중...`);
      const result = await electronAPI.resizeActiveWindow(cmd.pct);
      if (result?.success) showToast(`✅ 런처 크기 ${cmd.pct}%`);
      else showToast('❌ 창 크기 조정 실패');
      return;
    }

    if (cmd.kind === 'invalid') {
      showToast(`❌ ${cmd.reason}`);
    }
  }, [data.spaces, data.nodeGroups, store, showToast, launchItem, handleNodeGroupLaunch, handleTogglePin]);

  // ── DnD sensors ───────────────────────────────────────────
  // Single combined sensor set: PointerSensor (space grip, left-click) + RightPointerSensor (item cards, right-click)
  const allSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(RightPointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Space reorder DnD
  function handleSpaceDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = data.spaces.findIndex(s => s.id === active.id);
    const newIdx = data.spaces.findIndex(s => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    store.reorderSpaces(arrayMove(data.spaces, oldIdx, newIdx));
  }

  // Item DnD (cross-space)
  function handleItemDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDraggingItemId(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // ── Drop onto node/deck building zones ──────────────
    if (overId === 'drop-node-building' && nodeEditMode) {
      if (!nodeBuilding.includes(activeId) && nodeBuilding.length < 3) {
        setNodeBuilding(prev => [...prev, activeId]);
      }
      return;
    }
    if (overId === 'drop-deck-building' && deckBuilding) {
      if (!deckItems.includes(activeId)) {
        setDeckItems(prev => [...prev, activeId]);
      }
      return;
    }

    // ── Drop onto an existing NodeGroupCard ──────────────
    if (overId.startsWith('drop-node-group-')) {
      const groupId = overId.replace('drop-node-group-', '');
      const group = nodeGroups.find(g => g.id === groupId);
      if (group && !group.itemIds.includes(activeId) && group.itemIds.length < 3) {
        store.updateNodeGroup(groupId, { itemIds: [...group.itemIds, activeId] });
        showToast(`✅ 노드 "${group.name}"에 추가됨`);
      }
      return;
    }

    // ── Drop onto an existing DeckCard ───────────────────
    if (overId.startsWith('drop-deck-')) {
      const deckId = overId.replace('drop-deck-', '');
      const deck = decks.find(d => d.id === deckId);
      if (deck && !deck.itemIds.includes(activeId)) {
        store.updateDeck(deckId, { itemIds: [...deck.itemIds, activeId] });
        showToast(`✅ 덱 "${deck.name}"에 추가됨`);
      }
      return;
    }

    const sourceSpace = data.spaces.find(s => s.items.some(i => i.id === activeId));
    if (!sourceSpace) return;

    // Dropped onto a space droppable zone
    if (overId.startsWith('drop-space-')) {
      const toSpaceId = overId.replace('drop-space-', '');
      if (toSpaceId !== sourceSpace.id) store.moveItemToSpace(activeId, sourceSpace.id, toSpaceId);
      return;
    }

    // Dropped onto another item
    const targetSpace = data.spaces.find(s => s.items.some(i => i.id === overId));
    if (!targetSpace) return;

    if (sourceSpace.id === targetSpace.id) {
      const items = sourceSpace.items;
      const oldIdx = items.findIndex(i => i.id === activeId);
      const newIdx = items.findIndex(i => i.id === overId);
      if (oldIdx === -1 || newIdx === -1) return;
      if (oldIdx !== newIdx) store.reorderItems(sourceSpace.id, arrayMove(items, oldIdx, newIdx));
    } else {
      store.moveItemToSpace(activeId, sourceSpace.id, targetSpace.id);
    }
  }

  // Combined drag end: space sort (left-click grip) OR item sort/move (right-click)
  function handleAllDragEnd(event: DragEndEvent) {
    const isSpaceDrag = data.spaces.some(s => s.id === (event.active.id as string));
    if (isSpaceDrag) { handleSpaceDragEnd(event); }
    else { handleItemDragEnd(event); }
  }

  // ── Slash command detection in search bar ─────────────────
  const isSlashMode = query.startsWith('/');

  // ── Search filter (suppressed in slash mode) ──────────────
  const filteredSpaces = (!query.trim() || isSlashMode)
    ? data.spaces
    : data.spaces
        .map(s => ({
          ...s,
          items: s.items.filter(i =>
            i.title.toLowerCase().includes(query.toLowerCase()) ||
            i.value.toLowerCase().includes(query.toLowerCase())
          ),
        }))
        .filter(s => s.items.length > 0);

  // ── Slash suggestions (shown below search bar in slash mode) ─
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0);
  const slashCmd = useMemo(() => isSlashMode ? parseCommand(query, data.spaces, data.nodeGroups ?? []) : null, [isSlashMode, query, data.spaces, data.nodeGroups]);
  const slashSuggestions = useMemo(() => {
    if (!isSlashMode || !slashCmd) return [];
    return buildSuggestions(query, slashCmd, data.spaces, data.nodeGroups ?? [], handleCommandExecute);
  }, [isSlashMode, slashCmd, query, data.spaces, data.nodeGroups, handleCommandExecute]);

  // Reset selection when slash suggestions change
  useEffect(() => { setSlashSelectedIdx(0); }, [slashSuggestions.length]);

  // ── Search Enter → launch first visible item / execute slash cmd ──────────────
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isSlashMode) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSelectedIdx(i => Math.min(i + 1, slashSuggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSelectedIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Escape') { setQuery(''); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const sg = slashSuggestions[slashSelectedIdx];
        if (sg && !sg.dimmed) { sg.onSelect(); setQuery(''); }
        return;
      }
      return;
    }
    if (e.key !== 'Enter') return;
    const firstSpace = filteredSpaces[0];
    const firstItem = firstSpace?.items[0];
    if (!firstItem) return;
    store.incrementClickCount(firstSpace.id, firstItem.id);
    launchAndPosition(firstItem, data.settings.closeAfterOpen);
    setQuery('');
  }, [isSlashMode, slashSuggestions, slashSelectedIdx, filteredSpaces, data.settings.closeAfterOpen, store, launchAndPosition]);

  // ── First-run welcome popup ────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (store.isFirstRun) setShowWelcome(true);
  }, [store.isFirstRun]);

  // ── Auto-updater notifications ────────────────────────────
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  useEffect(() => {
    electronAPI.onUpdateAvailable((info) => {
      showToast(`🆕 업데이트 ${info.version} 다운로드 중...`);
    });
    electronAPI.onUpdateDownloaded((info) => {
      setUpdateDownloaded(true);
      showToast(`✅ ${info.version} 다운로드 완료 — 설정에서 재시작하세요`);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Currently dragging item (for DragOverlay)
  const draggingItem = draggingItemId
    ? data.spaces.flatMap(s => s.items).find(i => i.id === draggingItemId)
    : null;

  const tileOverlayItems = useMemo(() => {
    if (!tileOverlayGroup) return [];
    const group = nodeGroups.find((entry) => entry.id === tileOverlayGroup);
    if (!group) return [];

    return group.itemIds
      .map((id) => allItems.find((item) => item.id === id))
      .filter(Boolean) as LauncherItem[];
  }, [allItems, nodeGroups, tileOverlayGroup]);

  const appState = useMemo<AppState>(() => ({
    activeMode,
    nodeGroups,
    nodeBuilding,
    deckItems,
    decks,
    deckAnchorItemIds,
    inactiveWindowIds,
    monitorCount,
    allItems,
    monitorDirections: data.settings.monitorDirections as Record<number, string> | undefined,
    closeAfter: data.settings.closeAfterOpen,
    searchQuery: query,
  }), [activeMode, nodeGroups, nodeBuilding, deckItems, decks, deckAnchorItemIds, inactiveWindowIds, monitorCount, allItems, data.settings.monitorDirections, data.settings.closeAfterOpen, query]);

  const appActions = useMemo<AppActions>(() => ({
    showToast,
    launchAndPosition,
    openMonitorSettings: () => openSettingsTab('monitor'),
    onPinModeClick: handlePinModeClick,
    onNodeModeClick: handleNodeBuildingClick,
    onNodeGroupLaunch: handleNodeGroupLaunch,
    onDeckModeClick: handleDeckBuildingClick,
    onDeckGroupLaunch: handleDeckGroupLaunch,
    onWindowInactiveClick: handleWindowInactiveClick,
  }), [showToast, launchAndPosition, handlePinModeClick, handleNodeBuildingClick, handleNodeGroupLaunch, handleDeckBuildingClick, handleDeckGroupLaunch, handleWindowInactiveClick]);

  return (
    <AppStateProvider value={appState}>
    <AppActionsProvider value={appActions}>
    <TooltipProvider delay={500}>
      <div style={{ position: 'fixed', inset: '6px', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
        {/* Glass card */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            background: 'var(--bg-rgba)',
            backdropFilter: 'blur(40px) saturate(140%)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border-rgba)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
            overflow: 'hidden',
            color: 'var(--text-color)',
          }}
        >
          {/* ── Sidebar ───────────────────────────────── */}
          <Sidebar
            activeMode={activeMode}
            onModeChange={handleModeChange}
            recommendOpen={ghostCards.active}
            onRecommendClick={() => ghostCards.toggle()}
          />

          <RecommendPanel
            open={recommendOpen}
            spaces={data.spaces}
            onClose={() => setRecommendOpen(false)}
            onAddItems={(spaceId, items) => {
              for (const item of items) store.addItem(spaceId, item);
              showToast(`${items.length}개 항목 추가됨`);
              setRecommendOpen(false);
            }}
          />

          {/* ── Unified DnD: space grip (left-click) + card right-click drag ───── */}
          <DndContext
            sensors={allSensors}
            collisionDetection={closestCenter}
            onDragStart={e => {
              const activeId = e.active.id as string;
              if (!data.spaces.some(s => s.id === activeId)) setDraggingItemId(activeId);
            }}
            onDragCancel={() => setDraggingItemId(null)}
            onDragEnd={handleAllDragEnd}
          >

          {/* ── Main content ──────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* ── Title bar (draggable) ────────────────── */}
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 14px',
              borderBottom: '1px solid var(--border-rgba)',
              userSelect: 'none',
              WebkitAppRegion: 'drag',
            } as React.CSSProperties}
          >
            {/* Logo */}
            <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="bolt" size={12} color="var(--text-muted)" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
            </div>

            {/* Search */}
            <div style={{ flex: 1, position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <Icon name={isSlashMode ? 'terminal' : 'search'} size={15} color={isSlashMode ? 'var(--accent)' : 'var(--text-dim)'} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setSlashSelectedIdx(0); }}
                onKeyDown={handleSearchKeyDown}
                placeholder="빠른 검색... (/ 로 명령어)"
                style={{
                  width: '100%',
                  background: 'var(--surface)',
                  border: `1px solid ${isSlashMode ? 'var(--accent, #6366f1)' : 'var(--border-rgba)'}`,
                  borderRadius: isSlashMode && slashSuggestions.length > 0 ? '6px 6px 0 0' : '6px',
                  padding: '5px 10px 5px 28px',
                  color: 'var(--text-color)',
                  fontSize: '12px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.1s',
                }}
                onFocus={e => { if (!isSlashMode) e.target.style.borderColor = 'var(--border-focus)'; }}
                onBlur={e => { if (!isSlashMode) e.target.style.borderColor = 'var(--border-rgba)'; }}
              />

              {/* Slash command suggestions dropdown */}
              {isSlashMode && slashSuggestions.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'var(--bg-rgba)',
                    border: '1px solid var(--accent, #6366f1)',
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                    backdropFilter: 'blur(20px)',
                    zIndex: 200,
                    overflow: 'hidden',
                  }}
                >
                  {slashSuggestions.slice(0, 6).map((sg, i) => (
                    <div
                      key={i}
                      onMouseDown={e => { e.preventDefault(); if (!sg.dimmed) { sg.onSelect(); setQuery(''); } }}
                      onMouseEnter={() => setSlashSelectedIdx(i)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        background: i === slashSelectedIdx ? 'var(--surface-hover)' : 'transparent',
                        cursor: sg.dimmed ? 'default' : 'pointer',
                        opacity: sg.dimmed ? 0.5 : 1,
                        transition: 'background 0.08s',
                      }}
                    >
                      <Icon name={sg.icon} size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{sg.label}</span>
                      {sg.sub && (
                        <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', flexShrink: 0 }}>{sg.sub}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Header actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              {[
                { icon: 'add_circle', title: '새 스페이스', fn: () => store.addSpace() },
                { icon: 'settings', title: '환경설정', fn: () => setDialog('settings') },
                { icon: 'close', title: '닫기(Esc)', fn: () => electronAPI.hideApp() },
              ].map(btn => (
                <button
                  key={btn.icon}
                  onClick={btn.fn}
                  title={btn.title}
                  className="action-icon-btn"
                  style={{ width: 28, height: 28 }}
                >
                  <Icon name={btn.icon} size={17} />
                </button>
              ))}
            </div>
          </div>

          {/* ── Kick Bar ─────────────────────────────── */}
          {activeDialog && jumpFolders.length > 0 && (
            <div style={{ flexShrink: 0, padding: '6px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border-rgba)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="radar" size={13} color="var(--text-muted)" className="animate-spin" />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                '{activeDialog.title?.slice(0, 16)}' 감지
              </span>
              <div style={{ flex: 1, overflowX: 'auto', display: 'flex', gap: 5 }}>
                {jumpFolders.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => electronAPI.jumpToDialogFolder(folder.value)}
                    style={{
                      flexShrink: 0,
                      padding: '3px 8px',
                      background: 'var(--bg-rgba)',
                      border: '1px solid var(--border-rgba)',
                      borderRadius: 5,
                      fontSize: 10,
                      color: 'var(--text-color)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontFamily: 'inherit',
                    }}
                  >
                    <Icon name="folder" size={11} />
                    {folder.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Clipboard quick-add suggestion ──────── */}
          {clipSuggestion && (
            <ClipboardSuggestion
              type={clipSuggestion.type}
              value={clipSuggestion.value}
              label={clipSuggestion.label}
              onAdd={handleClipboardAdd}
              onDismiss={() => setClipSuggestion(null)}
            />
          )}

          {/* ── Extension banner ─────────────────────── */}
          {extConnected === false && !extBannerDismissed && (
            <div style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              borderBottom: '1px solid var(--border-rgba)',
              background: 'var(--surface)',
            }}>
              <Icon name="extension_off" size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                브라우저 익스텐션이 감지되지 않았습니다. 탭 제어 기능을 사용하려면 설치해주세요.
              </span>
              <button
                onClick={() => openSettingsTab('extension')}
                style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border-focus)', background: 'transparent', color: 'var(--accent)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Icon name="open_in_new" size={12} />
                설치 안내
              </button>
              <button
                onClick={() => { setExtBannerDismissed(true); localStorage.setItem('ext-banner-dismissed', '1'); }}
                style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
                title="닫기"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}

          {/* ── Spaces list ──────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 12px' }}>

            {/* Empty states */}
            {filteredSpaces.length === 0 && query && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 20px', gap: 10 }}>
                <Icon name="search_off" size={36} color="var(--text-dim)" />
                <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>'{query}' 결과 없음</p>
              </div>
            )}
            {filteredSpaces.length === 0 && !query && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 20px', gap: 12 }}>
                <Icon name="space_dashboard" size={44} color="var(--text-dim)" style={{ opacity: 0.5 }} />
                <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>스페이스를 추가하고 아이템을 등록해보세요!</p>
                <button
                  onClick={() => store.addSpace()}
                  style={{ marginTop: 4, padding: '7px 18px', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  + 새 스페이스
                </button>
              </div>
            )}

            {/* ── Space ordering DnD ────────────────── */}
              <SortableContext items={filteredSpaces.map(s => s.id)} strategy={verticalListSortingStrategy}>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filteredSpaces.map((space) => (
                      <SortableSpace key={space.id} id={space.id}>
                        {dragHandle => (
                          <SpaceAccordion
                            space={space}
                            dragHandle={dragHandle}
                            onRename={name => store.renameSpace(space.id, name)}
                            onDelete={() => store.deleteSpace(space.id)}
                          onDuplicate={() => store.duplicateSpace(space.id)}
                            onSetColor={color => store.setSpaceColor(space.id, color)}
                          onSetIcon={icon => store.setSpaceIcon(space.id, icon)}
                          onToggleCollapse={() => store.toggleSpaceCollapsed(space.id)}
                            onEditItem={item => openEditItem(item, space.id)}
                            onDeleteItem={itemId => store.deleteItem(space.id, itemId)}
                            onIncrementClick={itemId => {
                              store.incrementClickCount(space.id, itemId);
                            }}
                            onSortByUsage={() => store.sortSpaceByUsage(space.id)}
                            onTogglePin={itemId => handleTogglePin(space, itemId)}
                            onQuickAdd={() => openQuickAdd(space.id)}
                            onAddItem={() => openManualWizard(space.id)}
                            onScanItem={() => openScan(space.id)}
                            defaultOpen={!(data.collapsedSpaceIds ?? []).includes(space.id)}
                            onSetMonitor={(itemId, monitor) => handleSetMonitor(space.id, itemId, monitor)}
                            onConvertToContainer={itemId => handleConvertToContainer(space.id, itemId)}
                            onConvertFromContainer={itemId => handleConvertFromContainer(space.id, itemId)}
                            onEditSlots={(itemId, dir) => handleEditSlots(space.id, itemId, dir)}
                            ghostItems={ghostCards.ghostsForSpace(space.id)}
                            onGhostAccept={(ghost) => {
                              store.addItem(ghost.spaceId, { title: ghost.title, value: ghost.value, type: ghost.type });
                              ghostCards.accept(ghost);
                              showToast(`✓ "${ghost.title}" 추가됨`);
                            }}
                            onGhostDismiss={(value) => ghostCards.dismiss(value)}
                          />
                        )}
                      </SortableSpace>
                    ))}
                  </div>

              </SortableContext>

              {/* ── Ghost "추천" space (unmatched items) ── */}
              {ghostCards.hasGhostSpace && (
                <div style={{
                  margin: '8px 10px', padding: '12px', borderRadius: 12,
                  border: '1.5px dashed var(--accent-dim)', background: 'var(--surface)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <Icon name="lightbulb" size={14} color="var(--accent)" />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>추천 항목</span>
                  </div>
                  {/* Type-grouped sections */}
                  {(['folder', 'app', 'document', 'url'] as const).map(dtype => {
                    const items = ghostCards.ghostSpaceItems.filter(g => g.displayType === dtype);
                    if (items.length === 0) return null;
                    const label = dtype === 'folder' ? '폴더' : dtype === 'app' ? '앱' : dtype === 'document' ? '문서' : '사이트';
                    const icon = dtype === 'folder' ? 'folder' : dtype === 'app' ? 'apps' : dtype === 'document' ? 'description' : 'language';
                    return (
                      <div key={dtype} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, padding: '0 2px' }}>
                          <Icon name={icon} size={12} color="var(--text-dim)" />
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)' }}>{label}</span>
                          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{items.length}</span>
                        </div>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
                          gap: 8,
                        }}>
                          {items.map(ghost => (
                            <GhostCard
                              key={`ghost-${ghost.value}`}
                              ghost={ghost}
                              onAccept={() => {
                                const targetId = data.spaces[0]?.id;
                                if (targetId) {
                                  store.addItem(targetId, { title: ghost.title, value: ghost.value, type: ghost.type });
                                  ghostCards.accept(ghost);
                                  showToast(`✓ "${ghost.title}" → ${data.spaces[0].name}`);
                                }
                              }}
                              onDismiss={() => ghostCards.dismiss(ghost.value)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

          </div>
          </div>{/* close main content */}

          {/* ── Right Panel: Node + Deck (tabs) ──── */}
          <NodePanel
            draggingItemId={draggingItemId}
            nodeGroups={nodeGroups}
            allItems={allItems}
            nodeEditMode={nodeEditMode}
            nodeBuilding={nodeBuilding}
            onStartEdit={handleStartNodeEdit}
            onCancelEdit={handleCancelNodeEdit}
            onRemoveFromBuilding={id => setNodeBuilding(prev => prev.filter(x => x !== id))}
            onSaveGroup={handleSaveNodeGroup}
            onLaunchGroup={handleNodeGroupLaunch}
            onDeleteGroup={store.deleteNodeGroup}
            onRenameGroup={(id, name) => store.updateNodeGroup(id, { name })}
            onReorderGroupItems={(id, itemIds) => store.updateNodeGroup(id, { itemIds })}
            onUpdateGroup={(id, patch) => store.updateNodeGroup(id, patch)}
            monitorCount={monitorCount}
            decks={decks}
            deckBuilding={deckBuilding}
            deckItems={deckItems}
            onStartDeckBuild={() => handleModeChange('deck')}
            onCancelDeckBuild={() => { setDeckBuilding(false); setDeckItems([]); setActiveMode('normal'); }}
            onRemoveFromDeckBuilding={id => setDeckItems(prev => prev.filter(x => x !== id))}
            onSaveDeck={handleSaveDeck}
            onLaunchDeck={handleDeckLaunch}
            onDeleteDeck={store.deleteDeck}
            onUpdateDeck={(id, patch) => store.updateDeck(id, patch)}
          />

          {/* DragOverlay: ghost card while dragging */}
          <DragOverlay>
            {draggingItem && (
              <div
                style={{
                  padding: '8px',
                  borderRadius: 10,
                  background: 'var(--bg-rgba)',
                  border: '1px solid var(--border-focus)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                  fontSize: 11,
                  color: 'var(--text-color)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 84,
                  backdropFilter: 'blur(12px)',
                }}
              >
                {draggingItem.iconType === 'image' && draggingItem.icon ? (
                  <img src={draggingItem.icon} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <Icon name={draggingItem.icon ?? 'link'} size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                )}
                {draggingItem.title}
              </div>
            )}
          </DragOverlay>
          </DndContext>
        </div>
      </div>

      {/* ── Node Tile Overlay (after split-screen launch) ─────── */}
      <TileOverlay
        items={tileOverlayItems}
        leaving={tileOverlayLeaving}
        onDismiss={dismissTileOverlay}
        onMaximize={handleMaximizeFromOverlay}
      />

      {/* ── Dialog context bar (download/save dialog detection) ── */}
      <DialogContextBar allItems={allItems} />

      {/* ── Toast ────────────────────────────────────────────── */}
      <ToastOverlay
        toasts={toasts}
        onPause={pauseToast}
        onResume={resumeToast}
        onDismiss={dismissToast}
      />

      {/* ── Dialogs ──────────────────────────────────────────── */}
      <ItemDialog
        key={editItem?.id || (prefilledItem ? 'prefill-' + prefilledItem.value : 'none')}
        open={dialog === 'item'}
        onClose={() => { setDialog('none'); setEditItem(null); setPrefilledItem(null); }}
        spaces={data.spaces}
        editItem={editItem || (prefilledItem as LauncherItem)}
        defaultSpaceId={editSpaceId}
        monitorCount={monitorCount}
        onSave={handleSaveItem}
      />
      <ItemWizard
        open={dialog === 'quickadd'}
        mode="quick"
        spaces={data.spaces}
        defaultSpaceId={editSpaceId}
        docExtensions={data.settings.documentExtensions}
        onClose={() => setDialog('none')}
        onSave={(spaceId, item) => { handleSaveItem(spaceId, item); setDialog('none'); }}
      />
      <ItemWizard
        open={dialog === 'wizard'}
        mode="manual"
        spaces={data.spaces}
        defaultSpaceId={editSpaceId}
        docExtensions={data.settings.documentExtensions}
        onClose={() => setDialog('none')}
        onSave={(spaceId, item) => { handleSaveItem(spaceId, item); setDialog('none'); }}
      />
      <ScanDialog
        open={dialog === 'scan'}
        onClose={() => setDialog('none')}
        onSelect={handleScanSelect}
      />
      <SettingsDialog
        open={dialog === 'settings'}
        onClose={() => { setDialog('none'); setSettingsInitialTab(undefined); }}
        settings={data.settings}
        onSave={store.updateSettings}
        updateDownloaded={updateDownloaded}
        initialTab={settingsInitialTab}
      />
      {containerSlotItem && (
        <ContainerSlotPicker
          open={dialog === 'container-slots'}
          onClose={() => { setDialog('none'); setContainerSlotItem(null); }}
          containerItem={allItems.find(i => i.id === containerSlotItem.itemId)!}
          containerSpaceId={containerSlotItem.spaceId}
          defaultDir={containerSlotItem.defaultDir}
          allSpaces={data.spaces}
          onSave={handleSaveSlots}
        />
      )}

      {/* ── Command Bar (Spotlight-style) ──────────── */}
      <CommandBar
        isOpen={cmdOpen}
        inputValue={cmdInput}
        onInputChange={v => {
          setCmdInput(v);
          // Mirror into regular search if it's a plain text query
          const parsed = parseCommand(v, data.spaces, data.nodeGroups ?? []);
          if (parsed.kind === 'search') setQuery(v);
          else setQuery('');
        }}
        onClose={() => { setCmdOpen(false); setCmdInput(''); setQuery(''); }}
        onExecute={handleCommandExecute}
        spaces={data.spaces}
        nodeGroups={data.nodeGroups ?? []}
      />

      {/* ── Welcome / First-run modal ────────────────────────── */}
      {showWelcome && (
        <WelcomeModal
          extConnected={extConnected}
          onClose={() => setShowWelcome(false)}
          onOpenExtensionSettings={() => openSettingsTab('extension')}
        />
      )}
      <Toaster
        position="bottom-center"
        offset={16}
        toastOptions={{
          style: {
            background: 'var(--text-color)',
            color: 'var(--bg-rgba)',
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 20,
            padding: '7px 14px',
            border: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            fontFamily: 'inherit',
            zIndex: 99999,
          },
        }}
      />
    </TooltipProvider>
    </AppActionsProvider>
    </AppStateProvider>
  );
}
