import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { LauncherItem, Space, AppMode } from '../types';
import { electronAPI } from '../electronBridge';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ItemCardProps {
  item: LauncherItem;
  space: Space;
  closeAfter: boolean;
  onEdit: (item: LauncherItem) => void;
  onDelete: (itemId: string) => void;
  onClickCountIncrement: () => void;
  pinned: boolean;
  onTogglePin: () => void;
  searchQuery?: string;
  activeMode?: AppMode;
  isNodeLinked?: boolean;
  isNodeAnchor?: boolean;
  isDeckAnchor?: boolean;
  nodeBadges?: number[];
  onPinModeClick?: () => void;
  onNodeModeClick?: () => void;
  onDeckModeClick?: () => void;
  onNodeGroupLaunch?: () => void;
  onDeckGroupLaunch?: () => void;
  isInactive?: boolean;
  onInactiveClick?: () => void;
  monitorCount?: number;
  onSetMonitor?: (monitor: number | undefined) => void;
  allItems?: LauncherItem[];
  onConvertToContainer?: () => void;
  onConvertFromContainer?: () => void;
  onEditSlots?: (dir?: SlotDir) => void;
  onShowToast?: (msg: string) => void;
  onLaunchAndPosition?: (item: LauncherItem, closeAfter: boolean, monitor?: number) => Promise<void>;
  monitorDirections?: Record<number, string>;
  onOpenMonitorSettings?: () => void;
}

type SlotDir = 'up' | 'down' | 'left' | 'right';

const DBLCLICK_MS = 220;
const HOLD_MS = 450;
const HOLD_CANCEL_DIST = 20; // px — tolerates small hand tremors

const DIR_ICONS: Record<SlotDir, string> = {
  up: 'arrow_upward', down: 'arrow_downward', left: 'arrow_back', right: 'arrow_forward',
};
const DIR_LABELS: Record<SlotDir, string> = {
  up: '위', down: '아래', left: '왼쪽', right: '오른쪽',
};
const DIRS: SlotDir[] = ['up', 'right', 'down', 'left'];

const CARD_ACTIONS: Record<SlotDir, { icon: string; label: string }> = {
  up:    { icon: 'edit',         label: '카드 수정' },
  down:  { icon: 'monitor',      label: '모니터 선택' },
  left:  { icon: 'open_in_new',  label: '새창으로 열기' },
  right: { icon: 'content_copy', label: '값 복사' },
};

function getRightLabel(type: LauncherItem['type']) {
  if (type === 'url' || type === 'browser') return 'URL 복사';
  if (type === 'folder' || type === 'app') return '경로 복사';
  if (type === 'window') return '창 제목 복사';
  if (type === 'cmd') return '명령어 복사';
  return '텍스트 복사';
}

function getHoldDir(cx: number, cy: number, px: number, py: number): SlotDir | null {
  const dx = px - cx; const dy = py - cy;
  if (Math.sqrt(dx * dx + dy * dy) < 30) return null;
  const a = Math.atan2(dy, dx) * 180 / Math.PI;
  if (a > -45 && a <= 45)   return 'right';
  if (a > 45  && a <= 135)  return 'down';
  if (a > -135 && a <= -45) return 'up';
  return 'left';
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(99,102,241,0.35)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function getTypeColor(_type: LauncherItem['type']) { return 'var(--text-muted)'; }
function getTypeIcon(type: LauncherItem['type']) {
  const map: Record<string, string> = {
    url: 'language', folder: 'folder_open', app: 'apps',
    window: 'window', browser: 'public', text: 'content_copy', cmd: 'terminal',
  };
  return map[type] ?? 'link';
}

export function ItemCard({
  item, space, closeAfter, onEdit, onDelete, onClickCountIncrement,
  pinned, onTogglePin, searchQuery = '',
  activeMode = 'normal', isNodeLinked = false, isNodeAnchor = false, isDeckAnchor = false,
  nodeBadges, onPinModeClick, onNodeModeClick, onDeckModeClick, onNodeGroupLaunch: _onNodeGroupLaunch, onDeckGroupLaunch,
  isInactive = false, onInactiveClick,
  monitorCount = 1, onSetMonitor,
  allItems = [], onConvertToContainer, onConvertFromContainer, onEditSlots,
  onShowToast: _onShowToast, onLaunchAndPosition,
  monitorDirections, onOpenMonitorSettings,
}: ItemCardProps) {
  const [loading, setLoading] = useState(false);
  const [imageIconFailed, setImageIconFailed] = useState(false);
  const [monitorPickerPos, setMonitorPickerPos] = useState<{ x: number; y: number } | null>(null);

  // Hold popup state
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdDir, setHoldDir] = useState<SlotDir | null>(null);
  const [holdMonitorMode, setHoldMonitorMode] = useState(false);
  const [holdClosing, setHoldClosing] = useState(false);

  // Refs
  const cardRef = useRef<HTMLDivElement | null>(null);
  const monitorBadgeRef = useRef<HTMLSpanElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartRef = useRef<{ x: number; y: number } | null>(null);
  const holdCardRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const holdDirRef = useRef<SlotDir | null>(null);
  const holdExecutedRef = useRef(false);
  const wasHoldRef = useRef(false);
  const isHoldActiveRef = useRef(false);
  const monitorBadgeClickedRef = useRef(false);
  const globalMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const globalUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  // Sync holdDir to ref
  useEffect(() => { holdDirRef.current = holdDir; }, [holdDir]);

  useEffect(() => { setImageIconFailed(false); }, [item.id, item.icon, item.iconType]);

  // ── dnd-kit ─────────────────────────────────────────────────
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  // Outside-click is handled by a transparent overlay rendered in the portal — no document listeners needed.

  // ── Keyboard for hold popup ──────────────────────────────────
  useEffect(() => {
    if (!holdOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (holdMonitorMode) {
        const key = e.key.toLowerCase();
        // Build dir→monitor map from settings (fallback: 1→d, 2→a, 3→s)
        const DEFAULT_DIRS: Record<number, string> = { 1:'d', 2:'a', 3:'s' };
        const effDirs = monitorDirections ?? DEFAULT_DIRS;
        const usedDirs = new Set(Object.values(effDirs).filter(d => d !== 'c'));
        // Reverse map: key → monitor number
        const keyToMonitor: Record<string, number> = {};
        for (const [mStr, dir] of Object.entries(effDirs)) {
          if (dir !== 'c') keyToMonitor[dir] = Number(mStr);
        }
        if (key === 'escape') { e.preventDefault(); e.stopImmediatePropagation(); setHoldMonitorMode(false); return; }
        e.preventDefault(); e.stopImmediatePropagation();
        // 'w' = Auto (if not taken by a monitor)
        if (key === 'w' && !usedDirs.has('w')) { launchOnMonitorRef.current(undefined); closeHoldPopup(); }
        else if (key in keyToMonitor && keyToMonitor[key] <= monitorCount) {
          launchOnMonitorRef.current(keyToMonitor[key]); closeHoldPopup();
        }
        return;
      }
      const dirMap: Record<string, SlotDir> = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right' };
      if (e.key === 'Escape') { closeHoldPopup(true); return; }
      if (dirMap[e.key]) { e.preventDefault(); setHoldDir(dirMap[e.key]); holdDirRef.current = dirMap[e.key]; }
      if (e.key === 'Enter' && holdDirRef.current) doHoldAction(holdDirRef.current);
    };
    // capture:true — fires before App's global keydown handler so we can block it
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdOpen, holdMonitorMode, monitorCount]);

  // ── Cleanup on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      removeGlobalHandlers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeGlobalHandlers = () => {
    if (globalMoveRef.current) { document.removeEventListener('pointermove', globalMoveRef.current); globalMoveRef.current = null; }
    if (globalUpRef.current)   { document.removeEventListener('pointerup',   globalUpRef.current);   globalUpRef.current = null; }
  };

  const closeHoldPopup = (animate = false) => {
    if (animate) {
      setHoldClosing(true);
      setTimeout(() => {
        setHoldOpen(false);
        setHoldClosing(false);
        setHoldDir(null);
        setHoldMonitorMode(false);
        holdCardRectRef.current = null;
        isHoldActiveRef.current = false;
        holdExecutedRef.current = false;
      }, 200);
    } else {
      setHoldOpen(false);
      setHoldClosing(false);
      setHoldDir(null);
      setHoldMonitorMode(false);
      holdCardRectRef.current = null;
      isHoldActiveRef.current = false;
      holdExecutedRef.current = false;
      removeGlobalHandlers();
    }
  };

  const launchSlot = useCallback((slotItemId: string) => {
    const slotItem = allItems.find(i => i.id === slotItemId);
    if (!slotItem) return;
    closeHoldPopup();
    if (onLaunchAndPosition) {
      onLaunchAndPosition(slotItem, closeAfter);
    } else {
      switch (slotItem.type) {
        case 'url': case 'browser': electronAPI.openUrl(slotItem.value, closeAfter); break;
        case 'folder':  electronAPI.openPath(slotItem.value, closeAfter); break;
        case 'window':  electronAPI.focusWindow(slotItem.value, closeAfter); break;
        case 'app':     electronAPI.launchOrFocusApp(slotItem.value, closeAfter, slotItem.monitor); break;
        case 'text':    electronAPI.copyText(slotItem.value, closeAfter); break;
        case 'cmd':     electronAPI.runCmd(slotItem.value, closeAfter); break;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, closeAfter, onLaunchAndPosition]);

  const executeLaunchNoClose = useCallback(() => {
    onClickCountIncrement();
    if (onLaunchAndPosition) {
      onLaunchAndPosition(item, false);
    } else {
      switch (item.type) {
        case 'url': case 'browser': electronAPI.openUrl(item.value, false); break;
        case 'folder':  electronAPI.openPath(item.value, false); break;
        case 'window':  electronAPI.focusWindow(item.value, false); break;
        case 'app':     electronAPI.launchOrFocusApp(item.value, false, item.monitor); break;
        case 'text':    electronAPI.copyText(item.value, false); break;
        case 'cmd':     electronAPI.runCmd(item.value, false); break;
      }
    }
  }, [item, onClickCountIncrement, onLaunchAndPosition]);

  // doHoldAction — safe to call from event handlers (uses current closure via inline def)
  // We store a ref so global handlers (added once) always call the latest version
  // launchOnMonitor — one-time launch on specified monitor (does NOT persist item.monitor)
  const launchOnMonitorRef = useRef<(monitor: number | undefined) => void>(() => {});
  launchOnMonitorRef.current = (monitor: number | undefined) => {
    onClickCountIncrement();
    if (onLaunchAndPosition) {
      onLaunchAndPosition(item, closeAfter, monitor);
    } else {
      // Fallback: fire-and-forget without pipeline
      switch (item.type) {
        case 'url': case 'browser': electronAPI.openUrl(item.value, closeAfter); break;
        case 'folder':  electronAPI.openPath(item.value, closeAfter); break;
        case 'window':  electronAPI.focusWindow(item.value, closeAfter); break;
        case 'app':     electronAPI.launchOrFocusApp(item.value, closeAfter, monitor); break;
        case 'text':    electronAPI.copyText(item.value, closeAfter); break;
        case 'cmd':     electronAPI.runCmd(item.value, closeAfter); break;
      }
    }
  };

  const doHoldActionRef = useRef<(dir: SlotDir) => void>(() => {});
  doHoldActionRef.current = (dir: SlotDir) => {
    if (holdExecutedRef.current) return;
    holdExecutedRef.current = true;

    if (item.isContainer) {
      const slotId = item.slots?.[dir];
      if (slotId) { launchSlot(slotId); closeHoldPopup(); }
      else { closeHoldPopup(); setTimeout(() => onEditSlots?.(dir), 0); }
    } else {
      switch (dir) {
        case 'up':
          closeHoldPopup();
          setTimeout(() => onEdit(item), 0);
          break;
        case 'down':
          holdExecutedRef.current = false; // allow re-entry for monitor sub-mode
          setHoldMonitorMode(true);
          break;
        case 'left':
          closeHoldPopup();
          executeLaunchNoClose();
          break;
        case 'right':
          closeHoldPopup();
          electronAPI.copyText(item.value, false);
          break;
      }
    }
  };

  const doHoldAction = (dir: SlotDir) => doHoldActionRef.current(dir);

  const setupGlobalHandlers = () => {
    removeGlobalHandlers();

    const onMove = (e: PointerEvent) => {
      const rect = holdCardRectRef.current;
      if (!rect) return;
      const dir = getHoldDir(rect.x + rect.w / 2, rect.y + rect.h / 2, e.clientX, e.clientY);
      setHoldDir(dir);
      holdDirRef.current = dir;
    };

    const onUp = () => {
      removeGlobalHandlers();
      wasHoldRef.current = true;
      setTimeout(() => { wasHoldRef.current = false; }, 80);

      const dir = holdDirRef.current;
      if (dir) {
        // Released inside a direction zone → execute action (closes popup internally)
        doHoldActionRef.current(dir);
      } else {
        // Released outside any direction zone → animate close
        closeHoldPopup(true);
      }
    };

    globalMoveRef.current = onMove;
    globalUpRef.current = onUp;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const executeLaunch = useCallback(async (maximize = false) => {
    if (loading) return;
    setLoading(true);
    onClickCountIncrement();
    try {
      if (onLaunchAndPosition) {
        // Use the unified pipeline (handles polling, positioning, toasts)
        if (maximize && (item.type === 'window' || item.type === 'app' || item.type === 'folder')) {
          // Double-click = maximize on assigned monitor
          await onLaunchAndPosition(item, closeAfter, item.monitor);
        } else {
          await onLaunchAndPosition(item, closeAfter);
        }
      } else {
        // Fallback: direct launch without pipeline
        switch (item.type) {
          case 'url': case 'browser': electronAPI.openUrl(item.value, closeAfter); break;
          case 'folder':  electronAPI.openPath(item.value, closeAfter); break;
          case 'window':  electronAPI.focusWindow(item.value, closeAfter); break;
          case 'app':     electronAPI.launchOrFocusApp(item.value, closeAfter, item.monitor); break;
          case 'text':    electronAPI.copyText(item.value, closeAfter); break;
          case 'cmd':     electronAPI.runCmd(item.value, closeAfter); break;
        }
      }
    } finally {
      setLoading(false);
    }
  }, [item, closeAfter, loading, onClickCountIncrement, onLaunchAndPosition]);

  const handleClick = useCallback(() => {
    if (monitorBadgeClickedRef.current) { monitorBadgeClickedRef.current = false; return; }
    if (wasHoldRef.current || holdOpen) return;
    if (activeMode === 'pin') { onPinModeClick?.(); return; }
    if (activeMode === 'node') { onNodeModeClick?.(); return; }
    if (activeMode === 'deck') { onDeckModeClick?.(); return; }
    if (isInactive && item.type === 'window') { onInactiveClick?.(); return; }

    // Deck-anchor: click launches the saved deck (only fires in normal mode when isDeckAnchor reflects saved decks)
    if (isDeckAnchor && onDeckGroupLaunch) { onDeckGroupLaunch(); return; }

    // All cards (including containers): short click = launch normally
    if (item.type === 'window' || item.type === 'app' || item.type === 'folder') {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        executeLaunch(true);
      } else {
        clickTimerRef.current = setTimeout(() => { clickTimerRef.current = null; executeLaunch(false); }, DBLCLICK_MS);
      }
    } else {
      executeLaunch(false);
    }
  }, [activeMode, item, isInactive, holdOpen, onPinModeClick, onNodeModeClick, onInactiveClick, executeLaunch]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      e.stopPropagation();
      if (listeners?.onPointerDown) (listeners.onPointerDown as unknown as (e: React.PointerEvent) => void)(e);
      return;
    }
    if (e.button !== 0) return;

    holdStartRef.current = { x: e.clientX, y: e.clientY };
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      holdCardRectRef.current = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      isHoldActiveRef.current = true;
      holdExecutedRef.current = false;
      (document.activeElement as HTMLElement)?.blur(); // prevent search/cmd input from capturing keys
      setupGlobalHandlers();
      setHoldOpen(true);
      setHoldDir(null);
      setHoldMonitorMode(false);
    }, HOLD_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeners]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isHoldActiveRef.current && holdStartRef.current && holdTimerRef.current) {
      const dx = e.clientX - holdStartRef.current.x;
      const dy = e.clientY - holdStartRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > HOLD_CANCEL_DIST) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
        holdStartRef.current = null;
      }
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    // Cancel hold timer on pointer release — prevents click from triggering hold
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    holdStartRef.current = null;
  }, []);

  const handlePointerCancel = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    holdStartRef.current = null;
  }, []);

  // ── Render ───────────────────────────────────────────────────
  const accentColor = isInactive ? 'var(--text-dim)' : (item.color ?? getTypeColor(item.type));
  const icon = item.icon ?? getTypeIcon(item.type);
  const nodeClasses = [isNodeLinked ? 'node-linked' : '', isNodeAnchor ? 'node-anchor' : '', isDeckAnchor ? 'deck-anchor' : ''].filter(Boolean).join(' ');

  const slotItems = item.isContainer ? {
    up:    allItems.find(i => i.id === item.slots?.up),
    down:  allItems.find(i => i.id === item.slots?.down),
    left:  allItems.find(i => i.id === item.slots?.left),
    right: allItems.find(i => i.id === item.slots?.right),
  } : null;
  const filledSlots = slotItems ? DIRS.filter(d => slotItems[d]) : [];

  const cardEl = (
    <div
      ref={(el) => { setNodeRef(el); (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
      data-card
      style={{
        ...style,
        background: isNodeAnchor ? 'var(--accent-dim)' : isDeckAnchor ? 'rgba(249,115,22,0.12)' : 'var(--surface)',
        borderColor: isNodeLinked ? 'var(--accent)' : isDeckAnchor ? '#f97316' : item.isContainer ? 'var(--accent)' : 'var(--border-rgba)',
        borderStyle: item.isContainer ? 'dashed' : 'solid',
      }}
      {...attributes}
      {...listeners}
      draggable={activeMode === 'node'}
      onDragStart={activeMode === 'node' ? (e) => {
        e.dataTransfer.setData('itemId', item.id);
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'copy';
      } : undefined}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={e => e.preventDefault()}
      className={`
        group relative flex flex-col items-center justify-center gap-1.5
        rounded-xl p-3 min-h-[82px] cursor-pointer select-none
        border transition-all duration-150 ease-out active:scale-[0.96]
        ${nodeClasses} ${isInactive ? 'opacity-50' : ''}
      `}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)';
        if (!item.isContainer) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-focus)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.background = isNodeAnchor ? 'var(--accent-dim)' : isDeckAnchor ? 'rgba(249,115,22,0.12)' : 'var(--surface)';
        (e.currentTarget as HTMLDivElement).style.borderColor = isNodeLinked ? 'var(--accent)' : isDeckAnchor ? '#f97316' : item.isContainer ? 'var(--accent)' : 'var(--border-rgba)';
      }}
    >
      {/* Container badge */}
      {item.isContainer && (
        <span className="material-symbols-rounded" style={{ position:'absolute', top:5, right:5, fontSize:10, color:'var(--accent)', opacity:0.7 }}>grid_view</span>
      )}

      {/* Container slot dots */}
      {item.isContainer && (['up','down','left','right'] as SlotDir[]).map(d => {
        const filled = !!slotItems?.[d];
        const pos: Record<SlotDir, React.CSSProperties> = {
          up:    { top:3,    left:'50%', transform:'translateX(-50%)' },
          down:  { bottom:3, left:'50%', transform:'translateX(-50%)' },
          left:  { left:3,   top:'50%',  transform:'translateY(-50%)' },
          right: { right:3,  top:'50%',  transform:'translateY(-50%)' },
        };
        return <span key={d} style={{ position:'absolute', ...pos[d], width:5, height:5, borderRadius:'50%', background: filled ? 'var(--accent)' : 'var(--border-rgba)', opacity: filled ? 0.75 : 0.3 }} />;
      })}

      {/* Hold hint ring (shown when holdOpen) */}
      {holdOpen && (
        <span style={{ position:'absolute', inset:-2, borderRadius:13, border:'2px solid var(--accent)', opacity:0.5, pointerEvents:'none', animation:'none' }} />
      )}

      {/* Inactive indicator */}
      {isInactive && (
        <span className="absolute top-1 left-1 material-symbols-rounded" style={{ fontSize:10, color:'var(--destructive, #ef4444)' }} title="창이 닫혀있습니다">wifi_off</span>
      )}

      {/* Monitor badge */}
      {monitorCount > 1 && onSetMonitor && (
        <>
          <span
            ref={monitorBadgeRef}
            onPointerDown={e => {
              monitorBadgeClickedRef.current = true;
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onClick={e => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              monitorBadgeClickedRef.current = false;
              if (monitorPickerPos) { setMonitorPickerPos(null); return; }
              const rect = monitorBadgeRef.current?.getBoundingClientRect();
              if (rect) setMonitorPickerPos({ x: rect.left, y: rect.bottom + 4 });
            }}
            title={item.monitor ? `모니터 ${item.monitor}` : '자동'}
            style={{ position:'absolute', bottom:5, left:5, width:15, height:15, borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, fontWeight:700, lineHeight:1, cursor:'pointer', userSelect:'none', transition:'opacity 0.15s, background 0.15s', background: item.monitor ? 'var(--accent)' : 'var(--border-rgba)', color: item.monitor ? '#fff' : 'var(--text-dim)', opacity: item.monitor ? 0.85 : 0.3, zIndex:5 }}
            className="group-hover:!opacity-100"
          >
            {item.monitor ?? 'C'}
          </span>
          {monitorPickerPos && createPortal(
            <>
              {/* Transparent overlay — clicking outside the picker closes it without interfering with picker buttons */}
              <div
                style={{ position:'fixed', inset:0, zIndex:99998 }}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); setMonitorPickerPos(null); }}
              />
              {/* Picker content — above the overlay */}
              <div
                onPointerDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                style={{ position:'fixed', left:monitorPickerPos.x, top:monitorPickerPos.y, zIndex:99999, background:'var(--bg-rgba, rgba(18,18,28,0.95))', backdropFilter:'blur(20px) saturate(150%)', border:'1px solid var(--border-rgba)', borderRadius:8, padding:4, display:'flex', flexDirection:'column', gap:2, boxShadow:'0 8px 28px rgba(0,0,0,0.35)', minWidth:120 }}
              >
                <div style={{ fontSize:9, color:'var(--text-dim)', padding:'2px 8px 4px', fontWeight:600, letterSpacing:'0.05em' }}>모니터 지정</div>
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSetMonitor(undefined); setMonitorPickerPos(null); }} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 8px', border:'none', borderRadius:5, cursor:'pointer', fontFamily:'inherit', background: item.monitor===undefined ? 'var(--accent-dim)' : 'transparent', color: item.monitor===undefined ? 'var(--accent)' : 'var(--text-color)', fontSize:11, fontWeight:600 }}>
                  <span style={{ width:18, height:18, borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:800, background: item.monitor===undefined ? 'var(--accent)' : 'var(--border-rgba)', color: item.monitor===undefined ? '#fff' : 'var(--text-dim)' }}>C</span>
                  자동 (마지막 위치)
                </button>
                {Array.from({ length: monitorCount }, (_, i) => i + 1).map(n => (
                  <button key={n} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSetMonitor(n); setMonitorPickerPos(null); }} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 8px', border:'none', borderRadius:5, cursor:'pointer', fontFamily:'inherit', background: item.monitor===n ? 'var(--accent-dim)' : 'transparent', color: item.monitor===n ? 'var(--accent)' : 'var(--text-color)', fontSize:11, fontWeight:600 }}>
                    <span style={{ width:18, height:18, borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:800, background: item.monitor===n ? 'var(--accent)' : 'var(--border-rgba)', color: item.monitor===n ? '#fff' : 'var(--text-dim)' }}>{n}</span>
                    모니터 {n}{n===1 ? ' (주)' : ''}
                  </button>
                ))}
              </div>
            </>,
            document.body
          )}
        </>
      )}

      {/* Pin dot */}
      {pinned && <span style={{ position:'absolute', bottom:5, right:5, width:5, height:5, borderRadius:'50%', background:'var(--accent)', opacity:0.55 }} />}

      {/* Node badges */}
      {nodeBadges && nodeBadges.length > 0 && !isNodeAnchor && (
        <div style={{ position:'absolute', top:5, left:5, display:'flex' }}>
          {nodeBadges.map((idx, i) => (
            <span key={idx} style={{ width:14, height:14, borderRadius:'50%', background:'var(--accent)', color:'#fff', fontSize:7, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', marginLeft: i>0 ? -5 : 0, border:'1.5px solid rgba(120,120,140,0.25)', position:'relative', zIndex:nodeBadges.length-i }}>
              {idx}
            </span>
          ))}
        </div>
      )}

      {/* Icon */}
      {loading ? (
        <span className="material-symbols-rounded animate-spin" style={{ fontSize:28, color:accentColor }}>sync</span>
      ) : item.iconType === 'image' && item.icon && !imageIconFailed ? (
        <img src={item.icon} alt="" className="w-8 h-8 rounded-md object-cover" onError={() => setImageIconFailed(true)} />
      ) : (
        <span className="material-symbols-rounded" style={{ fontSize:28, color:accentColor }}>{icon}</span>
      )}

      <span className="text-[11.5px] font-medium leading-tight text-center line-clamp-2 w-full" style={{ color:'var(--text-color)' }}>
        <HighlightText text={item.title} query={searchQuery} />
      </span>

      {(pinned || space.color) && (
        <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ background: pinned ? 'var(--accent)' : space.color, opacity: pinned ? 0.45 : 0.6 }} />
      )}
    </div>
  );

  // ── Hold popup ───────────────────────────────────────────────
  const hRect = holdCardRectRef.current;
  // Compute action label for current direction
  const holdDirLabel = holdDir && !holdMonitorMode ? (() => {
    if (item.isContainer) {
      const si = slotItems?.[holdDir];
      return si ? si.title : `${DIR_LABELS[holdDir]} 슬롯 추가`;
    }
    if (holdDir === 'right') return getRightLabel(item.type);
    return CARD_ACTIONS[holdDir].label;
  })() : null;

  const holdPopup = holdOpen && hRect && createPortal(
    <div
      data-hold-popup
      style={{
        position:'fixed',
        left: hRect.x + hRect.w / 2,
        top:  hRect.y + hRect.h / 2,
        transform: `translate(-50%, -50%) scale(${holdClosing ? 0.65 : 1})`,
        opacity: holdClosing ? 0 : 1,
        transition: holdClosing ? 'transform 0.18s ease-in, opacity 0.18s ease-in' : 'opacity 0.1s',
        zIndex:99998,
        width:240, height:240,
        pointerEvents:'none',
      }}
    >
      {/* Center button — minimal */}
      <button
        data-hold-popup
        onPointerDown={e => e.stopPropagation()}
        onClick={() => holdMonitorMode ? setHoldMonitorMode(false) : closeHoldPopup(true)}
        style={{
          position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)',
          width:28, height:28, borderRadius:'50%',
          background:'var(--bg-rgba, rgba(18,18,28,0.8))', backdropFilter:'blur(12px)',
          border:'1px solid var(--border-rgba)',
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', zIndex:2, pointerEvents:'auto',
          opacity: 0.7,
          transition: 'opacity 0.1s',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
      >
        <span className="material-symbols-rounded" style={{ fontSize:13, color:'var(--text-muted)' }}>
          {holdMonitorMode ? 'arrow_back' : 'close'}
        </span>
      </button>

      {holdMonitorMode ? (
        // ── Monitor picker sub-mode ────────────────────────────
        (() => {
          // Direction → CSS position constants
          const DIR_POS: Record<string, React.CSSProperties> = {
            w: { bottom:'calc(50% + 38px)', left:'50%', transform:'translateX(-50%)' },
            d: { left:'calc(50% + 38px)', top:'50%', transform:'translateY(-50%)' },
            a: { right:'calc(50% + 38px)', top:'50%', transform:'translateY(-50%)' },
            s: { top:'calc(50% + 38px)', left:'50%', transform:'translateX(-50%)' },
          };
          const DIR_HINT: Record<string, string> = { w:'W', a:'A', s:'S', d:'D' };
          const DEFAULT_DIRS: Record<number, string> = { 1:'d', 2:'a', 3:'s' };
          const effDirs = monitorDirections ?? DEFAULT_DIRS;
          const usedDirs = new Set(Object.values(effDirs).filter(d => d !== 'c'));
          const showAuto = !usedDirs.has('w');
          return (
            <>
              {/* Glassmorphism circular backdrop */}
              <div style={{
                position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)',
                width:190, height:190, borderRadius:'50%',
                background:'var(--bg-rgba, rgba(18,18,28,0.5))',
                backdropFilter:'blur(28px) saturate(160%)',
                WebkitBackdropFilter:'blur(28px) saturate(160%)',
                border:'1px solid rgba(255,255,255,0.1)',
                boxShadow:'0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)',
                pointerEvents:'none', zIndex:0,
              }} />

              {/* Auto (C) button — top, shown only if 'w' not taken by a monitor */}
              {showAuto && (
                <MonitorHoldBtn label="C" subLabel="자동" hint="W" active={item.monitor === undefined}
                  position={DIR_POS.w}
                  onClick={() => { launchOnMonitorRef.current(undefined); closeHoldPopup(); }} />
              )}

              {/* Monitor buttons — positioned by configured direction */}
              {([1, 2, 3] as const).map(n => {
                const dir = effDirs[n] ?? DEFAULT_DIRS[n] ?? 'd';
                if (dir === 'c' || !DIR_POS[dir]) return null;
                return (
                  <MonitorHoldBtn key={n} label={String(n)} subLabel={n===1?'주 모니터':`모니터 ${n}`}
                    hint={DIR_HINT[dir] ?? ''} active={item.monitor === n} disabled={n > monitorCount}
                    position={DIR_POS[dir]}
                    onClick={() => { launchOnMonitorRef.current(n); closeHoldPopup(); }} />
                );
              })}

              {/* Settings icon — 5 o'clock position */}
              <button
                data-hold-popup
                onPointerDown={e => e.stopPropagation()}
                onClick={() => { closeHoldPopup(); setTimeout(() => onOpenMonitorSettings?.(), 50); }}
                title="모니터 설정"
                style={{
                  position:'absolute',
                  left:'calc(50% + 45px)', top:'calc(50% + 78px)',
                  transform:'translate(-50%,-50%)',
                  width:20, height:20, borderRadius:'50%',
                  background:'var(--bg-rgba, rgba(18,18,28,0.7))',
                  backdropFilter:'blur(12px)',
                  border:'1px solid rgba(255,255,255,0.15)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  cursor:'pointer', pointerEvents:'auto', zIndex:2,
                  opacity:0.55, transition:'opacity 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity='1')}
                onMouseLeave={e => (e.currentTarget.style.opacity='0.55')}
              >
                <span className="material-symbols-rounded" style={{ fontSize:11, color:'var(--text-muted)' }}>settings</span>
              </button>

              <div style={{ position:'absolute', left:'50%', bottom:-22, transform:'translateX(-50%)', whiteSpace:'nowrap', fontSize:9, color:'var(--text-dim)', pointerEvents:'none' }}>
                이번 한 번만 · Esc
              </div>
            </>
          );
        })()
      ) : (
        // ── 4-direction icon buttons ───────────────────────────
        DIRS.map(dir => {
          const isSelected = holdDir === dir;
          const slotItem = slotItems?.[dir];
          const cardAction = !item.isContainer ? CARD_ACTIONS[dir] : null;
          const isEmpty = item.isContainer && !slotItem;

          const positions: Record<SlotDir, React.CSSProperties> = {
            up:    { bottom:'calc(50% + 38px)', left:'50%', transform:'translateX(-50%)' },
            down:  { top:'calc(50% + 38px)',    left:'50%', transform:'translateX(-50%)' },
            left:  { right:'calc(50% + 38px)',  top:'50%',  transform:'translateY(-50%)' },
            right: { left:'calc(50% + 38px)',   top:'50%',  transform:'translateY(-50%)' },
          };

          return (
            <div
              key={dir}
              data-hold-dir={dir}
              data-hold-popup
              onPointerDown={e => e.stopPropagation()}
              onClick={() => doHoldAction(dir)}
              onMouseEnter={() => setHoldDir(dir)}
              onMouseLeave={() => setHoldDir(null)}
              style={{
                position:'absolute',
                ...positions[dir],
                width:46, height:46, borderRadius:12,
                background: isSelected
                  ? 'var(--accent)'
                  : 'var(--bg-rgba, rgba(18,18,28,0.88))',
                backdropFilter:'blur(20px) saturate(150%)',
                border:`1.5px solid ${isSelected ? 'var(--accent)' : slotItem ? 'var(--border-focus)' : 'var(--border-rgba)'}`,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:0,
                cursor:'pointer', pointerEvents:'auto',
                transition:'background 0.1s, border-color 0.1s, transform 0.1s, box-shadow 0.1s',
                transform: `${positions[dir].transform ?? ''} scale(${isSelected ? 1.12 : 1})`,
                boxShadow: isSelected ? '0 4px 18px rgba(99,102,241,0.45)' : '0 2px 10px rgba(0,0,0,0.22)',
                opacity: isEmpty ? 0.38 : 1,
              }}
            >
              {/* Container: filled slot → item icon */}
              {item.isContainer && slotItem && (
                slotItem.iconType === 'image' && slotItem.icon
                  ? <img src={slotItem.icon} alt="" style={{ width:22, height:22, borderRadius:4, objectFit:'cover' }} />
                  : <span className="material-symbols-rounded" style={{ fontSize:22, color: isSelected ? '#fff' : 'var(--text-muted)' }}>{slotItem.icon ?? getTypeIcon(slotItem.type)}</span>
              )}
              {/* Container: empty slot → direction arrow */}
              {item.isContainer && !slotItem && (
                <span className="material-symbols-rounded" style={{ fontSize:18, color:'var(--text-dim)' }}>{DIR_ICONS[dir]}</span>
              )}
              {/* Card action → action icon */}
              {cardAction && (
                <span className="material-symbols-rounded" style={{ fontSize:20, color: isSelected ? '#fff' : 'var(--text-muted)' }}>{cardAction.icon}</span>
              )}
            </div>
          );
        })
      )}

      {/* Action label toast — fixed below popup */}
      {holdDirLabel && (
        <div
          data-hold-popup
          style={{
            position:'absolute', left:'50%', bottom:-32,
            transform:'translateX(-50%)',
            pointerEvents:'none',
            whiteSpace:'nowrap',
            fontSize:10, fontWeight:600,
            color:'var(--text-color)',
            background:'var(--bg-rgba, rgba(18,18,28,0.9))',
            backdropFilter:'blur(12px)',
            border:'1px solid var(--border-rgba)',
            borderRadius:6,
            padding:'3px 10px',
            boxShadow:'0 2px 10px rgba(0,0,0,0.2)',
          }}
        >
          {holdDirLabel}
        </div>
      )}
    </div>,
    document.body
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <Tooltip>
            <TooltipTrigger render={cardEl} />
            <TooltipContent side="bottom" className="text-xs max-w-[200px] truncate">
              {item.isContainer ? `컨테이너 · ${filledSlots.length}/${DIRS.length} 슬롯` : item.value}
            </TooltipContent>
          </Tooltip>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={() => onEdit(item)} className="gap-2 cursor-pointer">
            <span className="material-symbols-rounded text-sm">edit</span>카드 수정
          </ContextMenuItem>
          <ContextMenuItem onClick={onTogglePin} className="gap-2 cursor-pointer">
            <span className="material-symbols-rounded text-sm">{pinned ? 'push_pin' : 'keep'}</span>
            {pinned ? '핀 해제' : '위치 고정'}
          </ContextMenuItem>

          <ContextMenuSeparator />

          {!item.isContainer && onConvertToContainer && (
            <ContextMenuItem onClick={onConvertToContainer} className="gap-2 cursor-pointer">
              <span className="material-symbols-rounded text-sm">grid_view</span>컨테이너로 전환
            </ContextMenuItem>
          )}
          {item.isContainer && (
            <>
              <ContextMenuItem onClick={() => onEditSlots?.()} className="gap-2 cursor-pointer">
                <span className="material-symbols-rounded text-sm">tune</span>슬롯 편집
              </ContextMenuItem>
              {onConvertFromContainer && (
                <ContextMenuItem onClick={onConvertFromContainer} className="gap-2 cursor-pointer">
                  <span className="material-symbols-rounded text-sm">grid_off</span>일반 카드로 전환
                </ContextMenuItem>
              )}
            </>
          )}

          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onDelete(item.id)} className="gap-2 cursor-pointer text-red-400 focus:text-red-400 focus:bg-red-500/10">
            <span className="material-symbols-rounded text-sm">delete</span>삭제
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {holdPopup}
    </>
  );
}

// ── Monitor button in hold popup ─────────────────────────────
function MonitorHoldBtn({ label, subLabel, hint, active, disabled, position, onClick }: {
  label: string; subLabel: string; hint?: string; active: boolean; disabled?: boolean;
  position: React.CSSProperties; onClick: () => void;
}) {
  return (
    <button
      data-hold-popup
      onPointerDown={e => e.stopPropagation()}
      onClick={disabled ? undefined : onClick}
      style={{
        position:'absolute', ...position,
        width:46, height:46, borderRadius:12,
        background: disabled ? 'rgba(255,255,255,0.08)' : active ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
        backdropFilter:'blur(20px)',
        border:`1.5px solid ${disabled ? 'rgba(255,255,255,0.12)' : active ? 'var(--accent)' : 'rgba(255,255,255,0.35)'}`,
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3,
        cursor: disabled ? 'not-allowed' : 'pointer', pointerEvents:'auto',
        opacity: disabled ? 0.35 : 1,
        boxShadow: active && !disabled ? '0 4px 20px rgba(99,102,241,0.4)' : '0 4px 16px rgba(0,0,0,0.25)',
        transition:'all 0.1s',
        fontFamily:'inherit',
      }}
    >
      {hint && (
        <span style={{ position:'absolute', top:3, right:4, fontSize:8, fontWeight:700, lineHeight:1, color: active && !disabled ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)', letterSpacing:'0.02em' }}>{hint}</span>
      )}
      <span style={{ fontSize:15, fontWeight:800, color:'#fff', lineHeight:1, opacity: disabled ? 0.4 : 1 }}>{label}</span>
      <span style={{ fontSize:7, color: disabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)', fontWeight:500, textAlign:'center', maxWidth:42, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{subLabel}</span>
    </button>
  );
}
