import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Toaster } from 'sonner';
import { Icon } from '@/components/ui/Icon';
import { NostLogo } from '@/components/ui/NostLogo';
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
import { BatchDropDialog, type PendingDrop } from './components/BatchDropDialog';
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
import Fuse from 'fuse.js';
import { generateId } from './lib/utils';
import { createLogger } from './lib/logger';
import type { LauncherItem, Space } from './types';
import { AppStateProvider, AppActionsProvider } from './contexts/AppContext';
import type { AppActions, AppState } from './contexts/AppContext';
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  DragOverlay,
} from '@dnd-kit/core';

// ── Right-click sensor for card reordering ──────────────────
// Cards reorder via right-click drag (original design). We skip targets inside
// a space header so useWindowDrag can still grab the window there.
// Spaces themselves use the stock PointerSensor — we restrict which sub-region
// of the header is actually draggable via where we spread `listeners` in the
// SpaceAccordion markup (no custom sensor subclass needed).
class RightPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        if (event.button !== 2) return false;
        const target = event.target as HTMLElement | null;
        if (target?.closest?.('.space-accordion-header')) return false;
        return true;
      },
    },
  ];
}
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Sortable space wrapper ───────────────────────────────────
// Notion-style paired resize: the handle between space A and its row-neighbor B
// is zero-sum — dragging right grows A and shrinks B by the same amount, so the
// row stays exactly full. Solo-in-row spaces fill the whole row and don't show
// a handle. Last-in-row (no right neighbor) also doesn't show a handle — the
// user resizes via the handle of the space to its LEFT instead.
//
// The whole header is the dnd-kit drag activator (we pass activator props to the
// child). The resize handle uses pointer capture + direct DOM writes for 60fps
// feel, then persists both A.widthWeight and B.widthWeight atomically on release.
type DragActivator = {
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
};

function SortableSpace({
  id,
  children,
  span,
  totalCols,
  minSpan,
  neighborId,
  dropEdge,
  onWeightsChange,
}: {
  id: string;
  children: (activator: DragActivator) => React.ReactNode;
  span: number;
  totalCols: number;
  minSpan: number;
  neighborId?: string;                      // undefined for solo/last-in-row
  dropEdge?: 'left' | 'right' | 'center';   // current drop indicator zone, if this space is the target
  onWeightsChange?: (updates: Array<{ id: string; widthWeight: number }>) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const elRef = useRef<HTMLDivElement | null>(null);
  const [resizing, setResizing] = useState(false);

  // Memoize the combined ref so React doesn't treat every render as a new ref
  // → prevents dnd-kit from receiving phantom setNodeRef(null) / setNodeRef(node)
  // cycles that abort an in-flight drag. This was the silent killer.
  const combinedNodeRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    elRef.current = node;
  }, [setNodeRef]);

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (!onWeightsChange || !neighborId) return;
    e.preventDefault();
    e.stopPropagation();

    const el = elRef.current;
    const grid = el?.parentElement as HTMLElement | null;
    const handleEl = e.currentTarget as HTMLElement;
    const neighborEl = grid?.querySelector(`[data-space-id="${neighborId}"]`) as HTMLDivElement | null;
    if (!el || !grid || !neighborEl) return;

    const gridRect = grid.getBoundingClientRect();
    const cs = getComputedStyle(grid);
    const gap = parseFloat(cs.columnGap || cs.gap || '0') || 0;
    const unitWidth = (gridRect.width - gap * Math.max(0, totalCols - 1)) / totalCols;
    const step = unitWidth + gap;
    if (!isFinite(step) || step <= 0) return;

    // Snap start-spans from current rendered widths → pair sum is our invariant
    const aStart = Math.max(1, Math.round(el.getBoundingClientRect().width / step));
    const bStart = Math.max(1, Math.round(neighborEl.getBoundingClientRect().width / step));
    const pairSum = aStart + bStart;

    const startX = e.clientX;
    const pointerId = e.pointerId;

    try { handleEl.setPointerCapture(pointerId); } catch { /* best-effort */ }
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let currentA = aStart;
    let currentB = bStart;

    const onMove = (ev: PointerEvent) => {
      const rawDelta = (ev.clientX - startX) / step;
      const snap = ev.shiftKey ? 2 : 1;
      const delta = Math.round(rawDelta / snap) * snap;
      // Clamp A so that B = pairSum - A is also ≥ minSpan
      const nextA = Math.max(minSpan, Math.min(pairSum - minSpan, aStart + delta));
      const nextB = pairSum - nextA;
      if (nextA !== currentA) {
        currentA = nextA;
        currentB = nextB;
        el.style.gridColumn = `span ${nextA}`;
        neighborEl.style.gridColumn = `span ${nextB}`;
      }
    };
    const onUp = () => {
      try { handleEl.releasePointerCapture(pointerId); } catch { /* already released */ }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizing(false);
      if (currentA !== aStart) {
        onWeightsChange([
          { id, widthWeight: currentA },
          { id: neighborId, widthWeight: currentB },
        ]);
      }
      el.style.gridColumn = '';
      neighborEl.style.gridColumn = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, [id, neighborId, totalCols, minSpan, onWeightsChange]);

  return (
    <div
      ref={combinedNodeRef}
      data-space-id={id}
      style={{
        gridColumn: `span ${span}`,
        transform: CSS.Transform.toString(transform),
        transition: resizing ? undefined : transition,
        opacity: isDragging ? 0.45 : 1,
        height: '100%',
        position: 'relative',
      }}
    >
      {children({ setActivatorNodeRef, listeners, attributes })}

      {/* Drop indicator: Notion-style preview of where the drop will land.
          Vertical line on left/right = column-join into this row; horizontal
          line on bottom = new row after this space. Pulses via CSS keyframe. */}
      {dropEdge === 'left' && (
        <div className="drop-indicator-pulse" style={{
          position: 'absolute', top: 2, bottom: 2, left: -5,
          width: 4, borderRadius: 2,
          background: 'var(--accent, #6366f1)',
          boxShadow: '0 0 14px var(--accent, #6366f1)',
          zIndex: 50, pointerEvents: 'none',
        }} />
      )}
      {dropEdge === 'right' && (
        <div className="drop-indicator-pulse" style={{
          position: 'absolute', top: 2, bottom: 2, right: -5,
          width: 4, borderRadius: 2,
          background: 'var(--accent, #6366f1)',
          boxShadow: '0 0 14px var(--accent, #6366f1)',
          zIndex: 50, pointerEvents: 'none',
        }} />
      )}
      {dropEdge === 'center' && (
        <div className="drop-indicator-pulse" style={{
          position: 'absolute', left: 2, right: 2, bottom: -5,
          height: 4, borderRadius: 2,
          background: 'var(--accent, #6366f1)',
          boxShadow: '0 0 14px var(--accent, #6366f1)',
          zIndex: 50, pointerEvents: 'none',
        }} />
      )}

      {/* Paired resize handle — only shown when there's a row-sibling to pair with.
          Solo/last-in-row spaces have no handle (cannot grow without pushing others). */}
      {onWeightsChange && neighborId && (
        <div
          onPointerDown={handleResizePointerDown}
          title="드래그해서 이웃과 너비 조절 (Shift: 굵은 스냅)"
          style={{
            position: 'absolute',
            right: -6,
            top: '10%',
            height: '80%',
            width: 12,
            cursor: 'col-resize',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            touchAction: 'none',
          }}
          className="space-resize-handle"
          data-no-dnd="true"
        >
          <div style={{
            width: 3,
            height: '60%',
            borderRadius: 2,
            background: resizing ? 'var(--accent)' : 'var(--border-rgba)',
            transition: 'background 0.15s, opacity 0.15s',
            opacity: resizing ? 1 : 0,
          }} className="space-resize-line" />
        </div>
      )}
    </div>
  );
}

// ── Row-based layout on the virtual 12-col master grid ─────────────────────
// Each unit ≈ 120px. Minimum space span is ~3 units; very narrow grids (≤4 cols)
// fall back to full-row so spaces never get squeezed unreadably small.
export function spaceMinSpan(totalCols: number): number {
  return totalCols <= 4 ? totalCols : Math.min(totalCols, 3);
}

interface SpaceLayout {
  span: number;             // final rendered CSS grid span
  rowIndex: number;
  indexInRow: number;
  isLastInRow: boolean;
  isSoloInRow: boolean;
  neighborId?: string;      // next space in the same row, if any
}

// Natural weight before row normalization: explicit widthWeight wins; otherwise
// auto-pick based on item count + open/collapsed state.
function computeSpaceNaturalWeight(s: Space, isOpen: boolean, totalCols: number, minSpan: number): number {
  if (s.widthWeight !== undefined) {
    return Math.max(minSpan, Math.min(totalCols, Math.round(s.widthWeight)));
  }
  const visibleCount = s.items.filter(i => !i.hiddenInSpace).length;
  if (!isOpen) return minSpan;
  if (visibleCount >= 15) return totalCols;
  if (visibleCount >= 7) return Math.max(minSpan, Math.ceil(totalCols / 2));
  return minSpan;
}

// Greedy left-to-right packing into rows, then:
// - Solo row        → fills the whole row (span = totalCols)
// - Multi-row       → last space absorbs remainder so row ≡ totalCols exactly
//                     (Notion-like "row always full")
function computeSpaceLayout(
  spaces: Space[],
  totalCols: number,
  isOpenOf: (id: string) => boolean,
): Map<string, SpaceLayout> {
  const MIN = spaceMinSpan(totalCols);
  const info = new Map<string, SpaceLayout>();

  const items = spaces.map(s => ({
    space: s,
    weight: computeSpaceNaturalWeight(s, isOpenOf(s.id), totalCols, MIN),
  }));

  const rows: Array<typeof items> = [];
  let row: typeof items = [];
  let sum = 0;
  for (const item of items) {
    if (sum + item.weight > totalCols && row.length > 0) {
      rows.push(row);
      row = [];
      sum = 0;
    }
    row.push(item);
    sum += item.weight;
  }
  if (row.length) rows.push(row);

  rows.forEach((rowItems, rowIndex) => {
    if (rowItems.length === 1) {
      info.set(rowItems[0].space.id, {
        span: totalCols, rowIndex, indexInRow: 0,
        isLastInRow: true, isSoloInRow: true,
      });
      return;
    }
    const prefixSum = rowItems.slice(0, -1).reduce((a, b) => a + b.weight, 0);
    const lastSpan = Math.max(MIN, totalCols - prefixSum);
    rowItems.forEach((item, i) => {
      const isLast = i === rowItems.length - 1;
      info.set(item.space.id, {
        span: isLast ? lastSpan : item.weight,
        rowIndex, indexInRow: i,
        isLastInRow: isLast,
        isSoloInRow: false,
        neighborId: isLast ? undefined : rowItems[i + 1].space.id,
      });
    });
  });

  return info;
}

// ── File drag-and-drop helper ──────────────────────────────────────────────
// Infers item type + display title from a file-system path using extension heuristic.
// .exe / .lnk → app  |  .url → url  |  no extension → folder  |  else → file
function inferItemFromPath(filePath: string): { type: LauncherItem['type']; title: string } {
  const filename = filePath.replace(/\//g, '\\').split('\\').pop() ?? filePath;
  const ext = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? '';
  const type: LauncherItem['type'] =
    ext === 'exe' || ext === 'lnk' ? 'app' :
    ext === 'url'                  ? 'url' :
    !ext                           ? 'folder' : 'app';
  const title = ext
    ? filename.replace(new RegExp(`\\.${ext}$`, 'i'), '')
    : filename;
  return { type, title };
}

type DialogMode = 'none' | 'item' | 'scan' | 'settings' | 'wizard' | 'quickadd' | 'container-slots';

export default function App() {
  const appLog = useMemo(() => createLogger('App'), []);
  appLog.debug('App() render');
  useEffect(() => { appLog.debug('App mounted (first useEffect)'); }, [appLog]);
  const store = useAppData();
  const { data } = store;
  appLog.debug(`data.spaces.length=${data?.spaces?.length ?? 'undefined'}`);

  const [dialog, setDialog] = useState<DialogMode>('none');
  const [editItem, setEditItem] = useState<LauncherItem | null>(null);
  const [editSpaceId, setEditSpaceId] = useState<string>('');
  const [prefilledItem, setPrefilledItem] = useState<Partial<LauncherItem> | null>(null);
  const [recommendOpen, setRecommendOpen] = useState(false);

  const ghostCards = useGhostCards({
    spaces: data.spaces,
    dismissals: data.dismissals ?? {},
    documentExtensions: data.settings.documentExtensions,
    onDismiss: (value) => store.dismissSuggestion(value),
  });

  const [query, setQuery] = useState('');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [draggingSpaceId, setDraggingSpaceId] = useState<string | null>(null);
  // Notion-style drop zone: where in the target space the cursor currently sits.
  //   center  → vertical drop (dragged becomes a new solo row after target)
  //   left    → column-join on target's LEFT  (insert before target in the row)
  //   right   → column-join on target's RIGHT (insert after target in the row)
  // Drives the drop indicator UI and the branching in handleSpaceDragEnd.
  const [dragOverEdge, setDragOverEdge] = useState<{ overId: string; edge: 'left' | 'right' | 'center' } | null>(null);
  // ── File-Explorer drag state ────────────────────────────────
  // fileDragOver:          any file drag in progress over the app
  // fileDragTargetSpaceId: which SpaceAccordion the cursor is hovering (null = no target → first space fallback)
  // fileDragCount:         number of items being dragged (dataTransfer.items.length)
  // fileDragKind:          'files' | 'url' (for icon/label selection)
  const [fileDragOver, setFileDragOver] = useState(false);
  const [fileDragTargetSpaceId, setFileDragTargetSpaceId] = useState<string | null>(null);
  const [fileDragCount, setFileDragCount] = useState(0);
  const [fileDragKind, setFileDragKind] = useState<'files' | 'url'>('files');
  // Batch review state: non-null when BatchDropDialog is open with a pending set
  const [batchDrop, setBatchDrop] = useState<{ items: PendingDrop[]; spaceId: string } | null>(null);
  // Cards added in the last ~700ms get a spring-pop entry animation (see @keyframes cardEnter in index.css)
  const [justAddedItemIds, setJustAddedItemIds] = useState<Set<string>>(new Set());
  const justAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Marks IDs as "just added" so ItemCard can trigger @keyframes cardEnter.
  // Defined early so it can be referenced by handleSaveItem (below) and handleBatchConfirm (further below).
  const markItemsAsNew = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
    setJustAddedItemIds(new Set(ids));
    justAddedTimerRef.current = setTimeout(() => setJustAddedItemIds(new Set()), 700);
  }, []);

  // ── Adaptive master grid (Phase 2) ──────────────────────
  // ResizeObserver drives totalCols off the grid container width. 1 unit ≈ 120px
  // (tuned against a ~1440px target where 12 cols feel natural). We keep this as
  // React state so spaceGridSpan() and SortableSpace can clamp widthWeight to
  // whatever the current window actually fits.
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const [totalCols, setTotalCols] = useState<number>(8);
  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el) return;
    const UNIT_PX = 120;
    const MIN_COLS = 3;
    const MAX_COLS = 12;
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(w / UNIT_PX)));
      setTotalCols(prev => prev === cols ? prev : cols);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Belt-and-suspenders: window resize as a fallback in case ResizeObserver is
    // throttled (e.g. background tab) — measure() is idempotent via the setter guard.
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

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
      // Edit existing — find item's CURRENT space (may have changed in dialog)
      const currentSpaceId = data.spaces.find(s => s.items.some(i => i.id === (item as LauncherItem).id))?.id;
      if (currentSpaceId && currentSpaceId !== spaceId) {
        store.updateItemAndMove(currentSpaceId, spaceId, item as LauncherItem);
      } else {
        store.updateItem(currentSpaceId ?? spaceId, item as LauncherItem);
      }
    } else {
      // New item — pre-generate ID so we can trigger the entry animation immediately
      const newId = generateId();
      store.addItem(spaceId, item as Omit<LauncherItem, 'id'>, newId);
      markItemsAsNew([newId]);
    }
  }, [store, data.spaces, markItemsAsNew]);

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
            showToast('창이 다시 활성화됨');
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

  // ── Undo-delete wrappers ─────────────────────────────────
  // Immediately commits the delete, then shows a 5-second toast with an
  // "실행 취소" button. restoreItem/restoreSpace use functional-update
  // internally, so the captured closure stays correct regardless of re-renders.
  const handleDeleteItem = useCallback((spaceId: string, itemId: string) => {
    const space = data.spaces.find(s => s.id === spaceId);
    const item = space?.items.find(i => i.id === itemId);
    if (!item) return;
    store.deleteItem(spaceId, itemId);
    showToast(`"${item.title}" 삭제됨`, {
      actions: [{
        label: '실행 취소',
        icon: 'undo',
        onClick: () => store.restoreItem(spaceId, item),
      }],
    });
  }, [data.spaces, store, showToast]);

  const handleDeleteSpace = useCallback((spaceId: string) => {
    const space = data.spaces.find(s => s.id === spaceId);
    if (!space) return;
    store.deleteSpace(spaceId);
    showToast(`"${space.name}" 스페이스 삭제됨`, {
      actions: [{
        label: '실행 취소',
        icon: 'undo',
        onClick: () => store.restoreSpace(space),
      }],
    });
  }, [data.spaces, store, showToast]);

  // ── File-Explorer drag-and-drop handlers ─────────────
  // dnd-kit uses pointer events so there is no conflict with HTML5 drag events.
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only react to file drags (from File Explorer) or URI drags from a browser
    const types = Array.from(e.dataTransfer.types);
    const hasFiles = types.includes('Files');
    const hasUri   = types.includes('text/uri-list');
    if (!hasFiles && !hasUri) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!fileDragOver) {
      // dragover fires many times per second — only snapshot count/kind on entry
      setFileDragOver(true);
      // items.length is accessible during dragover (file names are not, per spec)
      setFileDragCount(e.dataTransfer.items.length);
      setFileDragKind(hasFiles ? 'files' : 'url');
    }
  }, [fileDragOver]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only reset when truly leaving the card — ignore events fired by child elements
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setFileDragOver(false);
    setFileDragTargetSpaceId(null);
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Snapshot target BEFORE clearing drag state (setState is async)
    const targetSpaceId = fileDragTargetSpaceId ?? data.spaces[0]?.id;
    setFileDragOver(false);
    setFileDragTargetSpaceId(null);

    if (!targetSpaceId) return;
    const targetSpace = data.spaces.find(s => s.id === targetSpaceId);
    if (!targetSpace) return;

    // ── File drop from File Explorer ───────────────────────────
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 1) {
      // Single file → open ItemDialog pre-filled so the user can confirm/tweak
      const filePath = (files[0] as File & { path?: string }).path ?? files[0].name;
      const { type, title } = inferItemFromPath(filePath);
      setPrefilledItem({ type, title, value: filePath });
      setEditItem(null);
      setEditSpaceId(targetSpaceId);
      setDialog('item');
      return;
    }
    if (files.length > 1) {
      // Multiple files → open BatchDropDialog so the user can review / toggle / retype
      // before committing. This replaces the previous silent bulk-add.
      const pending: PendingDrop[] = files.map((file, idx) => {
        const filePath = (file as File & { path?: string }).path ?? file.name;
        const { type, title } = inferItemFromPath(filePath);
        return {
          tempId: `drop-${Date.now()}-${idx}`,
          title,
          type,
          value: filePath,
          checked: true,
        };
      });
      setBatchDrop({ items: pending, spaceId: targetSpaceId });
      return;
    }

    // ── URL / text drop (from browser address bar, link, etc.) ─
    const uriList = e.dataTransfer.getData('text/uri-list');
    const text    = e.dataTransfer.getData('text/plain');
    const raw     = (uriList || text).trim();
    if (!raw) return;
    const isUrl  = /^https?:\/\//i.test(raw);
    const isPath = /^[a-zA-Z]:\\/i.test(raw) || raw.startsWith('\\\\');
    const inferredType  = isUrl ? 'url' : isPath ? 'folder' : 'text';
    const inferredTitle = isUrl
      ? (raw.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] ?? raw)
      : inferItemFromPath(raw).title;
    setPrefilledItem({ type: inferredType as LauncherItem['type'], title: inferredTitle, value: raw });
    setEditItem(null);
    setEditSpaceId(targetSpaceId);
    setDialog('item');
  }, [data.spaces, store, showToast, fileDragTargetSpaceId]);

  // Batch-drop confirm: adds all checked items atomically and shows a 5-second Undo toast.
  // store.addItems returns the newly-generated IDs so deleteItems can reverse exactly
  // this batch, without affecting anything the user added afterwards.
  const handleBatchConfirm = useCallback((spaceId: string, items: Omit<LauncherItem, 'id'>[]) => {
    if (items.length === 0 || !spaceId) { setBatchDrop(null); return; }
    const added = store.addItems(spaceId, items);
    const space = data.spaces.find(s => s.id === spaceId);
    const spaceName = space?.name ?? '';
    setBatchDrop(null);
    markItemsAsNew(added.map(i => i.id));
    showToast(`${added.length}개 항목 추가됨 → ${spaceName}`, {
      actions: [{
        label: '실행 취소',
        icon: 'undo',
        onClick: () => store.deleteItems(spaceId, added.map(i => i.id)),
      }],
    });
  }, [store, data.spaces, showToast, markItemsAsNew]);

  const handlePinModeClick = useCallback((itemId: string) => {
    // Find which space contains this item
    const space = data.spaces.find(s => s.items.some(i => i.id === itemId));
    if (!space) return;
    handleTogglePin(space, itemId);
    const isPinned = (space.pinnedIds ?? []).includes(itemId);
    showToast(isPinned ? '핀 해제됨' : '핀 고정됨');
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
      if (!item) { showToast(`카드 ${cmd.spaceIdx + 1}-${cmd.cardIdx + 1} 없음`); return; }
      launchItem(item, space.id);
      return;
    }

    if (cmd.kind === 'launch-node') {
      const ng = (data.nodeGroups ?? [])[cmd.nodeIdx];
      if (!ng) { showToast(`노드 ${cmd.nodeIdx + 1} 없음`); return; }
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
        if (!text.trim()) { showToast('클립보드가 비어있습니다'); return; }
        const isUrl = /^https?:\/\//i.test(text.trim()) || /^www\./i.test(text.trim());
        const isPath = /^[a-zA-Z]:\\/i.test(text.trim()) || text.startsWith('\\\\');
        const itemType = isUrl ? 'url' : isPath ? 'folder' : 'text';
        const displayTitle = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        let targetSpace: Space | undefined;
        if (cmd.spaceIdx === -1) {
          targetSpace = data.spaces[0];
          if (!targetSpace) { showToast('스페이스가 없습니다'); return; }
        } else {
          targetSpace = data.spaces[cmd.spaceIdx];
          if (!targetSpace) { showToast(`스페이스 ${cmd.spaceIdx + 1} 없음`); return; }
        }
        store.addItem(targetSpace.id, {
          title: displayTitle,
          type: itemType as LauncherItem['type'],
          value: text.trim(),
        });
        showToast(`"${displayTitle}" 저장됨 → ${targetSpace.name}`);
      } catch {
        showToast('클립보드 읽기 실패');
      }
      return;
    }

    if (cmd.kind === 'tile') {
      const items = cmd.pairs.map(p => {
        const space = data.spaces[p.spaceIdx];
        return space?.items[p.cardIdx];
      });
      if (items.some(i => !i)) { showToast('일부 카드를 찾을 수 없습니다'); return; }
      const validItems = items as LauncherItem[];
      showToast(`${validItems.length}개 창 분할 실행 중...`);
      await electronAPI.tileWindows(validItems.map(i => ({ type: i.type, value: i.value, title: i.title })));
      return;
    }

    if (cmd.kind === 'new-space') {
      store.addSpace(cmd.name);
      showToast(`"${cmd.name}" 스페이스 생성됨`);
      return;
    }

    if (cmd.kind === 'pin') {
      const space = data.spaces[cmd.spaceIdx];
      const item = space?.items[cmd.cardIdx];
      if (!item) { showToast(`카드 ${cmd.spaceIdx + 1}-${cmd.cardIdx + 1} 없음`); return; }
      handleTogglePin(space, item.id);
      const isPinned = (space.pinnedIds ?? []).includes(item.id);
      showToast(isPinned ? `핀 해제: ${item.title}` : `핀 고정: ${item.title}`);
      return;
    }

    if (cmd.kind === 'resize-window') {
      showToast(`⏳ 창 크기 ${cmd.pct}%로 조정 중...`);
      const result = await electronAPI.resizeActiveWindow(cmd.pct);
      if (result?.success) showToast(`런처 크기 ${cmd.pct}%`);
      else showToast('창 크기 조정 실패');
      return;
    }

    if (cmd.kind === 'invalid') {
      showToast(`${cmd.reason}`);
    }
  }, [data.spaces, data.nodeGroups, store, showToast, launchItem, handleNodeGroupLaunch, handleTogglePin]);

  // ── DnD sensors ───────────────────────────────────────────
  //  - PointerSensor (stock, left-click) picks up drags from any element that
  //    spreads the useSortable `listeners` — in practice that's the small
  //    drag-activator region inside each space header (icon + name + count).
  //    Items don't spread listeners on left-click (their onPointerDown handler
  //    overrides), so cards still launch on click.
  //  - RightPointerSensor handles right-click drag for card reordering; skips
  //    space headers so useWindowDrag can grab the window there.
  const allSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(RightPointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Space reorder DnD
  // Notion-style drop with three distinct outcomes depending on the edge zone
  // that the cursor was in when released:
  //
  //   edge = 'left' or 'right'  (column-join)
  //     Dragged space slides into target's row. We split the target's currently
  //     rendered span 50/50 with the newcomer so the row stays visually balanced
  //     AND row-sum stays constant (other row siblings untouched).
  //
  //   edge = 'center'  (vertical drop, new row)
  //     Dragged space lands after target on its own row. We force widthWeight
  //     = totalCols so the layout's greedy packer wraps it onto a fresh row
  //     even if it would otherwise have had space to join target's row.
  //
  //   no edge (dropped on empty area or no valid target)
  //     Fall back to dnd-kit's reported `over` for a standard array reorder.
  function handleSpaceDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const activeId = active.id as string;
    const edge = dragOverEdge;
    setDragOverEdge(null);

    const draggedIdx = data.spaces.findIndex(s => s.id === activeId);
    if (draggedIdx === -1) return;

    if (edge && edge.overId !== activeId) {
      const dragged = data.spaces[draggedIdx];
      const withoutDragged = data.spaces.filter(s => s.id !== activeId);
      const newTargetIdx = withoutDragged.findIndex(s => s.id === edge.overId);
      if (newTargetIdx === -1) return;

      if (edge.edge === 'center') {
        const moved: Space = { ...dragged, widthWeight: totalCols };
        const next = [...withoutDragged];
        next.splice(newTargetIdx + 1, 0, moved);
        store.reorderSpaces(next);
        return;
      }

      // Column-join: split target's rendered span with the newcomer. We compute
      // target's span based on the spaces list *without* the dragged space —
      // that way, if the dragged was already a row-sibling of target (e.g.,
      // same-row reorder), target reflows first (potentially becoming solo)
      // and we get a clean span to halve.
      const layoutAfterRemove = computeSpaceLayout(
        withoutDragged, totalCols,
        id => !(data.collapsedSpaceIds ?? []).includes(id),
      );
      const targetRendered = layoutAfterRemove.get(edge.overId)?.span ?? totalCols;
      const MIN = spaceMinSpan(totalCols);

      // If target can't accommodate a splitter at MIN+MIN, fall through to a
      // vertical drop (newcomer on its own row after target) rather than
      // producing a below-minimum sliver.
      if (targetRendered < MIN * 2) {
        const moved: Space = { ...dragged, widthWeight: totalCols };
        const next = [...withoutDragged];
        next.splice(newTargetIdx + 1, 0, moved);
        store.reorderSpaces(next);
        return;
      }

      const halfSpan = Math.floor(targetRendered / 2);
      const draggedWeight = Math.max(MIN, Math.min(targetRendered - MIN, halfSpan));
      const targetNewWeight = targetRendered - draggedWeight;

      const moved: Space = { ...dragged, widthWeight: draggedWeight };
      const insertAt = edge.edge === 'left' ? newTargetIdx : newTargetIdx + 1;
      const next = [...withoutDragged];
      next.splice(insertAt, 0, moved);
      const finalSpaces = next.map(s =>
        s.id === edge.overId ? { ...s, widthWeight: targetNewWeight } : s
      );
      store.reorderSpaces(finalSpaces);
      return;
    }

    // Fallback: dnd-kit's standard reorder. `over.id` might be either the
    // sortable id (space.id) or the file-drop droppable id (drop-space-<id>)
    // because each space registers both — strip the prefix so findIndex finds
    // the actual space array entry.
    if (!over || activeId === over.id) return;
    const overIdRaw = String(over.id);
    const overId = overIdRaw.startsWith('drop-space-') ? overIdRaw.slice('drop-space-'.length) : overIdRaw;
    if (activeId === overId) return;
    const oldIdx = data.spaces.findIndex(s => s.id === activeId);
    const newIdx = data.spaces.findIndex(s => s.id === overId);
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
        showToast(`노드 "${group.name}"에 추가됨`);
      }
      return;
    }

    // ── Drop onto an existing DeckCard ───────────────────
    if (overId.startsWith('drop-deck-')) {
      const deckId = overId.replace('drop-deck-', '');
      const deck = decks.find(d => d.id === deckId);
      if (deck && !deck.itemIds.includes(activeId)) {
        store.updateDeck(deckId, { itemIds: [...deck.itemIds, activeId] });
        showToast(`덱 "${deck.name}"에 추가됨`);
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
    if (isSpaceDrag) { handleSpaceDragEnd(event); setDraggingSpaceId(null); }
    else { handleItemDragEnd(event); }
  }

  // ── Slash command detection in search bar ─────────────────
  const isSlashMode = query.startsWith('/');

  // ── Fuzzy search filter (suppressed in slash mode) ───────
  // Fuse.js: threshold 0.4 = tolerates ~1-2 char typos / partial initials.
  // Items within each space are sorted by match score (best match first)
  // so the most relevant result floats to the top during search.
  const filteredSpaces = useMemo(() => {
    if (!query.trim() || isSlashMode) return data.spaces;

    // Flatten all items with their space reference for Fuse to search across
    const flatItems = data.spaces.flatMap(s =>
      s.items.map(item => ({ item, spaceId: s.id }))
    );

    const fuse = new Fuse(flatItems, {
      keys: [
        { name: 'item.title', weight: 2 },  // title is more important than path/url
        { name: 'item.value', weight: 1 },
      ],
      threshold: 0.4,       // 0 = exact, 1 = anything — 0.4 allows minor typos
      ignoreLocation: true, // match anywhere in the string, not just the start
      minMatchCharLength: 1,
      includeScore: true,
    });

    // score: 0 = perfect match, 1 = no match (ascending = best first)
    const scoreMap = new Map(
      fuse.search(query).map(r => [r.item.item.id, r.score ?? 1])
    );

    return data.spaces
      .map(s => ({
        ...s,
        items: s.items
          .filter(i => scoreMap.has(i.id))
          .sort((a, b) => (scoreMap.get(a.id) ?? 1) - (scoreMap.get(b.id) ?? 1)),
      }))
      .filter(s => s.items.length > 0);
  }, [query, isSlashMode, data.spaces]);

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
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  useEffect(() => {
    electronAPI.onUpdateAvailable((info) => {
      showToast(`🆕 업데이트 ${info.version} 다운로드 중...`);
    });
    electronAPI.onUpdateDownloadProgress((info) => {
      setDownloadProgress(info ? info.percent : null);
    });
    electronAPI.onUpdateDownloaded((info) => {
      setDownloadProgress(null);
      setUpdateDownloaded(true);
      showToast(`${info.version} 다운로드 완료 — 설정에서 재시작하세요`);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Currently dragging item (for DragOverlay)
  const draggingSpace = draggingSpaceId ? data.spaces.find(s => s.id === draggingSpaceId) : undefined;
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
    justAddedItemIds,
  }), [activeMode, nodeGroups, nodeBuilding, deckItems, decks, deckAnchorItemIds, inactiveWindowIds, monitorCount, allItems, data.settings.monitorDirections, data.settings.closeAfterOpen, query, justAddedItemIds]);

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
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleFileDrop}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            position: 'relative',
            background: 'var(--bg-rgba)',
            backdropFilter: 'blur(40px) saturate(140%)',
            borderRadius: 'var(--radius)',
            border: fileDragOver ? '1px solid var(--accent)' : '1px solid var(--border-rgba)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
            overflow: 'hidden',
            color: 'var(--text-color)',
            transition: 'border-color 0.15s',
          }}
        >
          {/* ── File drag pill banner ─────────────────── */}
          {/* Bottom-center pill instead of full overlay, so the user can see   */}
          {/* each SpaceAccordion's highlight and target a specific space.      */}
          {fileDragOver && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 999,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 18px',
                borderRadius: 22,
                background: 'var(--accent)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                boxShadow: '0 10px 32px rgba(0,0,0,0.28)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <Icon name={fileDragKind === 'url' ? 'link' : 'file_download'} size={15} color="#fff" />
              <span>
                {fileDragKind === 'url'
                  ? '링크'
                  : fileDragCount > 1 ? `${fileDragCount}개 파일` : '파일'}
              </span>
              <span style={{ opacity: 0.55, fontWeight: 400 }}>·</span>
              {fileDragTargetSpaceId ? (
                <>
                  <Icon name="arrow_forward" size={13} color="#fff" />
                  <span>{data.spaces.find(s => s.id === fileDragTargetSpaceId)?.name}</span>
                </>
              ) : (
                <span style={{ opacity: 0.85, fontWeight: 500 }}>스페이스에 놓아주세요</span>
              )}
            </div>
          )}
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
            collisionDetection={closestCorners}
            onDragStart={e => {
              const activeId = e.active.id as string;
              if (data.spaces.some(s => s.id === activeId)) setDraggingSpaceId(activeId);
              else setDraggingItemId(activeId);
            }}
            onDragMove={e => {
              // Only track edge zones while dragging a SPACE (not an item card).
              // `activatorEvent` + `delta` gives us the current pointer position;
              // we use elementFromPoint to resolve which space (if any) is under
              // the cursor, then classify left/right/center by relative X.
              const activeId = e.active.id as string;
              if (!data.spaces.some(s => s.id === activeId)) return;
              const start = e.activatorEvent as PointerEvent | MouseEvent | undefined;
              if (!start) return;
              const cx = (start.clientX ?? 0) + e.delta.x;
              const cy = (start.clientY ?? 0) + e.delta.y;
              const el = document.elementFromPoint(cx, cy);
              const spaceEl = (el as HTMLElement | null)?.closest('[data-space-id]') as HTMLElement | null;
              const overId = spaceEl?.getAttribute('data-space-id');
              if (!overId || overId === activeId) {
                setDragOverEdge(prev => prev === null ? prev : null);
                return;
              }
              const rect = spaceEl!.getBoundingClientRect();
              const rx = cx - rect.left;
              const w = rect.width;
              const edge: 'left' | 'right' | 'center' =
                rx < w * 0.25 ? 'left' : rx > w * 0.75 ? 'right' : 'center';
              setDragOverEdge(prev =>
                (prev?.overId === overId && prev.edge === edge) ? prev : { overId, edge }
              );
            }}
            onDragCancel={() => { setDraggingItemId(null); setDraggingSpaceId(null); setDragOverEdge(null); }}
            onDragEnd={handleAllDragEnd}
          >

          {/* ── Main content ──────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* ── Title bar (draggable) ────────────────── */}
          {/* height 49 (48 content + 1 border-bottom) is the reference for all
              sibling section headers. NodePanel "Table" header matches via minHeight
              so the border-bottom lines align perfectly — no step at the divider. */}
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              height: 49,
              padding: '0 14px',
              borderBottom: '1px solid var(--border-rgba)',
              boxSizing: 'border-box',
              userSelect: 'none',
              WebkitAppRegion: 'drag',
            } as React.CSSProperties}
          >
            {/* Logo */}
            <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <NostLogo size={12} color="var(--text-muted)" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
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

            {/* ── Space ordering DnD (Adaptive Row: grid-auto-flow:dense) ── */}
              <SortableContext items={filteredSpaces.map(s => s.id)} strategy={rectSortingStrategy}>

                  <div
                    ref={gridContainerRef}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${totalCols}, minmax(0, 1fr))`,
                      gridAutoFlow: 'dense',
                      gap: 8,
                      alignItems: 'stretch',
                    }}
                  >
                    {(() => {
                      const minSpan = spaceMinSpan(totalCols);
                      const layout = computeSpaceLayout(
                        filteredSpaces,
                        totalCols,
                        sid => !(data.collapsedSpaceIds ?? []).includes(sid),
                      );
                      return filteredSpaces.map((space) => {
                      const info = layout.get(space.id);
                      const renderedSpan = info?.span ?? minSpan;
                      const neighborId = info?.neighborId;
                      return (
                      <SortableSpace
                        key={space.id}
                        id={space.id}
                        span={renderedSpan}
                        totalCols={totalCols}
                        minSpan={minSpan}
                        neighborId={neighborId}
                        dropEdge={dragOverEdge?.overId === space.id ? dragOverEdge.edge : undefined}
                        onWeightsChange={updates => store.setSpacesWidthWeights(updates)}
                      >
                        {dragActivator => (
                          <SpaceAccordion
                            space={space}
                            headerDragActivator={dragActivator}
                            onRename={name => store.renameSpace(space.id, name)}
                            onDelete={() => handleDeleteSpace(space.id)}
                          onDuplicate={() => store.duplicateSpace(space.id)}
                            onSetColor={color => store.setSpaceColor(space.id, color)}
                          onSetIcon={icon => store.setSpaceIcon(space.id, icon)}
                          onToggleCollapse={() => store.toggleSpaceCollapsed(space.id)}
                            onEditItem={item => openEditItem(item, space.id)}
                            onDeleteItem={itemId => handleDeleteItem(space.id, itemId)}
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
                              showToast(`"${ghost.title}" 추가됨`);
                            }}
                            onGhostDismiss={(value) => ghostCards.dismiss(value)}
                            fileDragActive={fileDragOver}
                            fileDragTarget={fileDragTargetSpaceId === space.id}
                            onFileDragEnter={() => setFileDragTargetSpaceId(space.id)}
                            onFileDragLeave={() => setFileDragTargetSpaceId(prev => prev === space.id ? null : prev)}
                          />
                        )}
                      </SortableSpace>
                      );
                    });
                    })()}
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
                                  showToast(`"${ghost.title}" → ${data.spaces[0].name}`);
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

          {/* DragOverlay: ghost preview while dragging a card OR a whole space */}
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }}>
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
            {/* Space-reorder ghost: show the space header label with accent outline,
                matching Notion's drag-handle affordance when moving a block.  */}
            {draggingSpace && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: draggingSpace.color ? `${draggingSpace.color}22` : 'var(--bg-rgba)',
                  border: `1.5px solid ${draggingSpace.color ?? 'var(--accent)'}`,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
                  backdropFilter: 'blur(16px)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, fontWeight: 600, color: 'var(--text-color)',
                  minWidth: 200,
                  cursor: 'grabbing',
                }}
              >
                {draggingSpace.icon && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(draggingSpace.icon) ? (
                  <Icon name={draggingSpace.icon} size={15} color={draggingSpace.color ?? 'var(--text-muted)'} />
                ) : draggingSpace.icon ? (
                  <span style={{ fontSize: 14 }}>{draggingSpace.icon}</span>
                ) : null}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{draggingSpace.name}</span>
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-dim)', background: 'var(--border-rgba)', padding: '2px 7px', borderRadius: 10 }}>
                  {draggingSpace.items.length}
                </span>
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
        // Drag-drop / paste / scan prefills land here with a known type; narrow the Type
        // dropdown to the plausible alternatives so the picker isn't full of nonsense.
        // Editing an existing item (editItem.id present) keeps all types open.
        allowedTypes={
          editItem?.id ? undefined :
          prefilledItem?.type === 'url' || prefilledItem?.type === 'browser' ? ['url', 'browser'] :
          prefilledItem?.type === 'folder' ? ['folder'] :
          prefilledItem?.type === 'app' || prefilledItem?.type === 'cmd' ? ['app', 'cmd'] :
          prefilledItem?.type === 'window' ? ['window'] :
          prefilledItem?.type === 'text' ? ['text'] :
          undefined
        }
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
        downloadProgress={downloadProgress}
        initialTab={settingsInitialTab}
      />
      {batchDrop && (
        <BatchDropDialog
          open={!!batchDrop}
          items={batchDrop.items}
          spaces={data.spaces}
          defaultSpaceId={batchDrop.spaceId}
          onClose={() => setBatchDrop(null)}
          onConfirm={handleBatchConfirm}
        />
      )}
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
