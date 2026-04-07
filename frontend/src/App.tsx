import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SpaceAccordion } from './components/SpaceAccordion';
import { ItemDialog } from './components/ItemDialog';
import { ItemWizard } from './components/ItemWizard';
import { ScanDialog } from './components/ScanDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { NodePanel } from './components/NodePanel';
import { ContainerSlotPicker, type PendingRemoval, type PendingNewItem } from './components/ContainerSlotPicker';
import { CommandBar, parseCommand, buildSuggestions } from './components/CommandBar';
import { ToastOverlay } from './components/ToastOverlay';
import { TileOverlay } from './components/TileOverlay';
import type { ParsedCommand } from './components/CommandBar';
import { useAppData } from './hooks/useAppData';
import { useToastQueue, type ToastAction } from './hooks/useToastQueue';
import { useTileOverlay } from './hooks/useTileOverlay';
import { electronAPI } from './electronBridge';
import type { LauncherItem, Space, AppMode } from './types';
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
  const [query, setQuery] = useState('');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  // ── CommandBar state ──────────────────────────────────────
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState('');

  // ── Mode state (pin / node / deck) ──────────────────────
  const [activeMode, setActiveMode] = useState<AppMode>('normal');
  // Node panel state
  const [nodeEditMode, setNodeEditMode] = useState(false);
  const [nodeBuilding, setNodeBuilding] = useState<string[]>([]);
  // Deck panel state
  const [deckBuilding, setDeckBuilding] = useState(false);
  const [deckItems, setDeckItems] = useState<string[]>([]);
  const { tileOverlayGroup, tileOverlayLeaving, showTileOverlay, dismissTileOverlay } = useTileOverlay();
  const { toast, showToast, dismissToast, pauseToast, resumeToast } = useToastQueue();


  // ── Toast notification — FIFO queue (non-overlapping) ────

  // ── Monitor tracking ─────────────────────────────────────
  const [monitorCount, setMonitorCount] = useState(1);
  useEffect(() => {
    electronAPI.getMonitors().then(ms => { if (ms.length > 0) setMonitorCount(ms.length); });
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
    electronAPI.setOpacity(data.settings.opacity);
  }, [data.settings.opacity]);

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
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null);

  useEffect(() => {
    const onMouseDown = async (e: MouseEvent) => {
      if (e.button !== 2) return; // right-click only
      // Cards handle right-click for reorder — don't start window drag
      if ((e.target as HTMLElement).closest('[data-card]')) return;
      e.preventDefault();
      const [wx, wy] = await electronAPI.getWindowPosition();
      dragRef.current = { startX: e.screenX, startY: e.screenY, winX: wx, winY: wy };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.screenX - dragRef.current.startX;
      const dy = e.screenY - dragRef.current.startY;
      electronAPI.moveWindow(dragRef.current.winX + dx, dragRef.current.winY + dy);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) dragRef.current = null;
    };

    // Suppress context menu globally (right-click is for window drag)
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

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
    const close = data.settings.closeAfterOpen;
    switch (item.type) {
      case 'url': case 'browser': electronAPI.openUrl(item.value, close); break;
      case 'folder':  electronAPI.openPath(item.value, close); break;
      case 'app':     electronAPI.launchOrFocusApp(item.value, close, item.monitor); break;
      case 'window':  electronAPI.focusWindow(item.value, close); break;
      case 'text':    electronAPI.copyText(item.value, close); break;
      case 'cmd':     electronAPI.runCmd(item.value, close); break;
    }
  }, [store, data.settings.closeAfterOpen]);

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

  // ── Mode handlers ─────────────────────────────────────────
  const handleModeChange = useCallback((mode: AppMode) => {
    // Cancel any active editing when switching modes (single-edit enforcement)
    if (mode !== 'node') {
      setNodeEditMode(false);
      setNodeBuilding([]);
    }
    if (mode !== 'deck') {
      setDeckBuilding(false);
      setDeckItems([]);
    }

    setActiveMode(mode);
    if (mode === 'pin') {
      showToast('📌 고정 모드 — 카드 클릭하면 핀 토글', { persistent: true });
    }
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
    if (mode === 'normal') {
      dismissToast();
    }
  }, [showToast, dismissToast]);

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
            electronAPI.launchOrFocusApp(item.exePath!, data.settings.closeAfterOpen);
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

  // Node edit mode handlers
  const handleStartNodeEdit = useCallback(() => {
    // Cancel deck if building
    setDeckBuilding(false);
    setDeckItems([]);
    setNodeEditMode(true);
    setNodeBuilding([]);
    setActiveMode('node');
    showToast('🔗 노드 편집 — 카드를 순서대로 클릭 (최대 3개)', { persistent: true });
  }, [showToast]);

  const handleCancelNodeEdit = useCallback(() => {
    setNodeEditMode(false);
    setNodeBuilding([]);
    setActiveMode('normal');
    dismissToast();
  }, [dismissToast]);

  const handleSaveNodeGroup = useCallback((name: string | undefined) => {
    if (nodeBuilding.length < 2) return;
    const nodeGroups = data.nodeGroups ?? [];
    const autoName = name?.trim() || `노드 ${nodeGroups.length + 1}`;
    store.addNodeGroup(autoName, nodeBuilding);
    setNodeEditMode(false);
    setNodeBuilding([]);
    setActiveMode('normal');
    dismissToast();
    showToast(`✅ "${autoName}" 저장됨`);
  }, [nodeBuilding, data.nodeGroups, store, showToast, dismissToast]);

  const handleNodeBuildingClick = useCallback((itemId: string) => {
    setNodeBuilding(prev => {
      if (prev.includes(itemId)) return prev.filter(id => id !== itemId);
      if (prev.length >= 3) return prev;
      return [...prev, itemId];
    });
  }, []);

  const nodeGroups = useMemo(() => data.nodeGroups ?? [], [data.nodeGroups]);
  const decks = useMemo(() => data.decks ?? [], [data.decks]);
  const allItems = useMemo(() => data.spaces.flatMap(s => s.items), [data.spaces]);

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
    showToast(`✅ "${name}" 덱 저장됨`);
  }, [deckItems, store, showToast]);

  const handleDeckLaunch = useCallback(async (deckId: string) => {
    const deck = (data.decks ?? []).find(d => d.id === deckId);
    if (!deck) return;
    const items = deck.itemIds.map(id => allItems.find(i => i.id === id)).filter(Boolean) as LauncherItem[];
    if (items.length === 0) return;

    showToast(`▶ "${deck.name}" 실행 (${items.length}개)`);
    let failCount = 0;
    const targetMonitor = deck.monitor ?? 0;

    // Helper: launch one deck item, poll until open, then maximize
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
        const MAX = 8;
        for (let a = 0; a < MAX; a++) {
          await new Promise(r => setTimeout(r, 500));
          const results = await electronAPI.checkItemsForTile([{ type: item.type, value: item.value, title: item.title }]);
          if (results[0]?.alive) {
            showToast(`✓ ${idx + 1}/${items.length} ${item.title}`);
            // Fill work area on target monitor (DPI-aware)
            electronAPI.maximizeWindow({ item: { type: item.type, value: item.value, title: item.title }, monitor: targetMonitor });
            return true;
          }
          if (a >= 2) showToast(`⏳ ${idx + 1}/${items.length} ${item.title} 대기 중... (${a + 1}/${MAX})`);
        }
        showToast(`⚠ ${item.title} 열기 실패`);
        return false;
      } else {
        showToast(`✓ ${idx + 1}/${items.length} ${item.title}`);
        return true;
      }
    };

    // Process in pairs (2 at a time) for parallelism
    for (let i = 0; i < items.length; i += 2) {
      const batch = items.slice(i, i + 2);
      const results = await Promise.all(batch.map((item, j) => launchOne(item, i + j)));
      failCount += results.filter(r => !r).length;
    }

    if (failCount === 0) showToast(`✅ "${deck.name}" 완료`);
    else showToast(`⚠ "${deck.name}" ${failCount}개 실패`);
  }, [data.decks, allItems, showToast]);

  const handleNodeGroupLaunch = useCallback(async (groupId: string) => {
    if (nodeEditMode) return;
    const group = nodeGroups.find(g => g.id === groupId);
    if (!group) return;

    const allItemsList = data.spaces.flatMap(s => s.items);
    const items = group.itemIds
      .map(id => allItemsList.find(i => i.id === id))
      .filter(Boolean) as LauncherItem[];
    if (items.length < 2) return;

    const itemDtos = items.map(i => ({ type: i.type, value: i.value, title: i.title }));
    const n = items.length;

    // ── Step 1: Trigger launch / focus for all windows ────────────
    showToast(`▶ ${n}개 앱 시작 중...`);
    const { identifiers } = await electronAPI.launchItemsForTile(itemDtos);

    // ── Step 2: Hand off to PS — it polls up to 30s, tiles each window
    //    as soon as it appears, then does a final settle pass. ─────
    showToast(`⏳ 창 열리면 자동 배치됩니다...`);
    const tileResult = await electronAPI.runTilePs({ identifiers, waitMs: 0, monitor: group.monitor ?? 0 });

    if (tileResult.success) showToast(`✅ ${n}분할 완료`);
    else showToast('창 배치 중 오류가 발생했습니다');

    showTileOverlay(groupId);
  }, [nodeGroups, data.spaces, nodeEditMode, showToast, showTileOverlay]);

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
    switch (firstItem.type) {
      case 'url':
      case 'browser': electronAPI.openUrl(firstItem.value, data.settings.closeAfterOpen); break;
      case 'folder':  electronAPI.openPath(firstItem.value, data.settings.closeAfterOpen); break;
      case 'app':     electronAPI.launchOrFocusApp(firstItem.value, data.settings.closeAfterOpen); break;
      case 'window':  electronAPI.focusWindow(firstItem.value, data.settings.closeAfterOpen); break;
      case 'text':    electronAPI.copyText(firstItem.value, data.settings.closeAfterOpen); break;
    }
    setQuery('');
  }, [isSlashMode, slashSuggestions, slashSelectedIdx, filteredSpaces, data.settings.closeAfterOpen, store]);

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

  return (
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
              <span className="material-symbols-rounded" style={{ fontSize: 12, color: 'var(--text-muted)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                bolt
              </span>
            </div>

            {/* Search */}
            <div style={{ flex: 1, position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <span
                className="material-symbols-rounded"
                style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: isSlashMode ? 'var(--accent, #6366f1)' : 'var(--text-dim)', pointerEvents: 'none' }}
              >
                {isSlashMode ? 'terminal' : 'search'}
              </span>
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
                      <span className="material-symbols-rounded" style={{ fontSize: 13, color: 'var(--accent, #6366f1)', flexShrink: 0 }}>{sg.icon}</span>
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
                  <span className="material-symbols-rounded" style={{ fontSize: 17 }}>{btn.icon}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Kick Bar ─────────────────────────────── */}
          {activeDialog && jumpFolders.length > 0 && (
            <div style={{ flexShrink: 0, padding: '6px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border-rgba)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-symbols-rounded animate-spin" style={{ fontSize: 13, color: 'var(--text-muted)' }}>radar</span>
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
                    <span className="material-symbols-rounded" style={{ fontSize: 11 }}>folder</span>
                    {folder.title}
                  </button>
                ))}
              </div>
            </div>
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
              <span className="material-symbols-rounded" style={{ fontSize: 14, color: 'var(--accent)', flexShrink: 0 }}>extension_off</span>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                브라우저 익스텐션이 감지되지 않았습니다. 탭 제어 기능을 사용하려면 설치해주세요.
              </span>
              <button
                onClick={() => openSettingsTab('extension')}
                style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border-focus)', background: 'transparent', color: 'var(--accent)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 12 }}>open_in_new</span>
                설치 안내
              </button>
              <button
                onClick={() => { setExtBannerDismissed(true); localStorage.setItem('ext-banner-dismissed', '1'); }}
                style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
                title="닫기"
              >
                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>close</span>
              </button>
            </div>
          )}

          {/* ── Spaces list ──────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 12px' }}>

            {/* Empty states */}
            {filteredSpaces.length === 0 && query && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 20px', gap: 10 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 36, color: 'var(--text-dim)' }}>search_off</span>
                <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>'{query}' 결과 없음</p>
              </div>
            )}
            {filteredSpaces.length === 0 && !query && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 20px', gap: 12 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 44, color: 'var(--text-dim)', opacity: 0.5 }}>space_dashboard</span>
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
                          searchQuery={query}
                            onEditItem={item => openEditItem(item, space.id)}
                            onDeleteItem={itemId => store.deleteItem(space.id, itemId)}
                            onIncrementClick={itemId => {
                            store.incrementClickCount(space.id, itemId);
                            const item = space.items.find(i => i.id === itemId);
                            if (item?.type === 'text') showToast(`📋 "${item.title}" 복사됨`);
                          }}
                            onSortByUsage={() => store.sortSpaceByUsage(space.id)}
                            onTogglePin={itemId => handleTogglePin(space, itemId)}
                            onQuickAdd={() => openQuickAdd(space.id)}
                            onAddItem={() => openManualWizard(space.id)}
                            onScanItem={() => openScan(space.id)}
                            closeAfter={data.settings.closeAfterOpen}
                            defaultOpen={!(data.collapsedSpaceIds ?? []).includes(space.id)}
                            activeMode={activeMode}
                            nodeGroups={nodeGroups}
                            nodeBuilding={nodeBuilding}
                            onPinModeClick={handlePinModeClick}
                            onNodeModeClick={handleNodeBuildingClick}
                            onNodeGroupLaunch={handleNodeGroupLaunch}
                            deckItems={deckItems}
                            onDeckModeClick={handleDeckBuildingClick}
                            inactiveWindowIds={inactiveWindowIds}
                            onWindowInactiveClick={handleWindowInactiveClick}
                            monitorCount={monitorCount}
                            onSetMonitor={(itemId, monitor) => handleSetMonitor(space.id, itemId, monitor)}
                            allItems={allItems}
                            onConvertToContainer={itemId => handleConvertToContainer(space.id, itemId)}
                            onConvertFromContainer={itemId => handleConvertFromContainer(space.id, itemId)}
                            onEditSlots={(itemId, dir) => handleEditSlots(space.id, itemId, dir)}
                            onShowToast={showToast}
                          />
                        )}
                      </SortableSpace>
                    ))}
                  </div>

              </SortableContext>
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
                  <span className="material-symbols-rounded" style={{ fontSize: 18, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {draggingItem.icon ?? 'link'}
                  </span>
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

      {/* ── Toast ────────────────────────────────────────────── */}
      <ToastOverlay
        toast={toast}
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
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowWelcome(false)}
        >
          <div
            style={{
              background: 'var(--bg-solid, #1a1a2e)',
              border: '1px solid var(--border-rgba)',
              borderRadius: 14,
              padding: '28px 28px 22px',
              width: 340,
              boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 28, color: 'var(--accent)' }}>waving_hand</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-color)' }}>nost</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>stary no more — 더 이상 헤매지 마세요.</div>
              </div>
            </div>

            {/* Description */}
            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              자주 쓰는 앱, 폴더, 웹사이트를 한 곳에 모아두고<br />
              단축키 하나로 즉시 꺼내 쓰는 런처입니다.
            </p>

            {/* Info rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { icon: 'keyboard', label: '호출 단축키', value: 'Alt + 4' },
                { icon: 'touch_app', label: '카드 꾹 누르기', value: '모니터 이동 · 스냅 · 삭제' },
                { icon: 'hub', label: '노드 / 덱', value: '여러 앱을 한번에 배치 · 실행' },
                { icon: 'settings', label: '설정', value: '단축키 · 테마 · 기타 설정' },
              ].map(({ icon, label, value }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border-rgba)' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 15, color: 'var(--text-muted)', flexShrink: 0 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 1 }}>{label}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-color)' }}>{value}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Extension install inline link */}
            {extConnected === false && (
              <button
                onClick={() => { setShowWelcome(false); openSettingsTab('extension'); }}
                style={{
                  width: '100%', padding: '8px 12px', background: 'var(--accent-dim)',
                  border: '1px solid var(--accent)', borderRadius: 8, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 15, color: 'var(--accent)', flexShrink: 0 }}>extension</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>브라우저 확장 설치하기</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>탭 제어 기능을 사용하려면 확장 프로그램이 필요합니다</div>
                </div>
                <span className="material-symbols-rounded" style={{ fontSize: 14, color: 'var(--accent)' }}>arrow_forward</span>
              </button>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => {
                  // Open the guide file from extraResources
                  electronAPI.openGuide();
                }}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  background: 'var(--surface)',
                  color: 'var(--text-color)',
                  border: '1px solid var(--border-rgba)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>menu_book</span>
                사용 설명서
              </button>
              <button
                onClick={() => setShowWelcome(false)}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  letterSpacing: '0.02em',
                }}
              >
                시작하기
              </button>
            </div>
          </div>
        </div>
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
  );
}
