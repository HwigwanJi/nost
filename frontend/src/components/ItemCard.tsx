import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import type { LauncherItem, Space } from '../types';
import { electronAPI } from '../electronBridge';
import { useAppState, useAppActions } from '../contexts/AppContext';
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
import { MediaWidget } from '../widgets/MediaWidget';
import { ColorSwatchWidget } from '../widgets/ColorSwatchWidget';
import { MemoCard } from './MemoCard';
import { MonitorPicker } from './MonitorPicker';
// ContainerSlotGhosts import removed in v1.3.34 — see commit message.
// isUserBusy import was used by the now-retired ContainerSlotGhosts
// hover; no remaining consumer in this file. Reintroduce if a future
// hover surface needs to defer to modal-class UI.
import { canPerform } from '../lib/conflictPolicy';
import { bumpRender } from '../lib/perf';
import { shakeElement } from '../lib/conflictFeedback';

interface ItemCardProps {
  item: LauncherItem;
  space: Space;
  onEdit: (item: LauncherItem) => void;
  onDelete: (itemId: string) => void;
  onClickCountIncrement: () => void;
  pinned: boolean;
  onTogglePin: () => void;
  onSetMonitor?: (monitor: number | undefined) => void;
  onConvertToContainer?: () => void;
  onConvertFromContainer?: () => void;
  onEditSlots?: (dir?: SlotDir) => void;
  /**
   * "최신 버전 확인" — opens DocCohortDialog for path-like cards.
   * Caller (App.tsx) gates on item.value being a real file path; we
   * expose the menu item only when this callback is defined so older
   * call sites stay compiling without touching every wire-up.
   */
  onCheckDocCohort?: () => void;
  // ── Memo (사라지는 메모) ────────────────────────────────────────
  // Plumbed in for type === 'memo' items only. Optional so existing
  // call sites that don't render memo yet stay compiling.
  onOpenMemoEditor?: (itemId: string) => void;
  /** Copy body as plain text (markdown stripped) — bottom 📋 button +
   *  swipe-right gesture both fire this. */
  onCopyMemoBody?: (itemId: string) => void;
  /** Copy body as raw markdown — only the swipe-LEFT gesture fires
   *  this; we don't surface a button because plain is the common
   *  case and a 4-button row gets cluttered. */
  onCopyMemoMarkdown?: (itemId: string) => void;
  onExtendMemoTtl?: (itemId: string) => void;
  onExportMemoTxt?: (itemId: string) => void;
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

/** v1.3.49 — Type-specific override for the 4-direction hold actions.
 *  Image card 의 좌측 (open) 은 일반 카드처럼 "새창으로 열기" 가 아니라
 *  OS 기본 이미지 뷰어로 직접 열기. 카드 click 은 이미 클립보드 복사
 *  역할이라 hold-left = "보기" 의 의도 명확. */
function getCardAction(type: LauncherItem['type'], dir: SlotDir): { icon: string; label: string } {
  if (type === 'image' && dir === 'left') {
    return { icon: 'image', label: '이미지 뷰어로 보기' };
  }
  return CARD_ACTIONS[dir];
}

function getRightLabel(type: LauncherItem['type']) {
  if (type === 'url' || type === 'browser') return 'URL 복사';
  if (type === 'folder' || type === 'app') return '경로 복사';
  if (type === 'window') return '창 제목 복사';
  if (type === 'cmd') return '명령어 복사';
  if (type === 'image') return '경로 복사';  // 이미지 자체 복사는 카드 클릭(좌클릭); 우클릭 메뉴에선 path 복사가 더 유용
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
    url: 'language', folder: 'folder_open', app: 'apps', doc: 'description',
    window: 'window', browser: 'public', text: 'content_copy', cmd: 'terminal',
    // image: fallback icon when the actual <img> render fails (broken
    // path / deleted file). The normal render path branches on
    // item.type === 'image' BEFORE this map and renders the thumbnail.
    image: 'image',
  };
  return map[type] ?? 'link';
}

/** v1.3.48 — Korean type label SSOT for at-a-glance card identification.
 *  Used by the type chip (bottom-right of card) + CardHoverHint tooltip
 *  prefix. Keeps the same vocabulary as ui-vocabulary.md so the chip /
 *  tooltip / shortVerb verbs all read consistently. */
function getTypeLabel(type: LauncherItem['type']): string {
  switch (type) {
    case 'url':     case 'browser': return 'URL';
    case 'folder':  return '폴더';
    case 'app':     return '앱';
    case 'doc':     return '문서';
    case 'window':  return '창';
    case 'cmd':     return '명령어';
    case 'text':    return '텍스트';
    case 'image':   return '이미지';
    case 'memo':    return '메모';
    case 'widget':  return '위젯';
  }
  return '';
}

function ItemCardImpl({
  item, space, onEdit, onDelete, onClickCountIncrement,
  pinned, onTogglePin, onSetMonitor,
  onConvertToContainer, onConvertFromContainer, onEditSlots,
  onCheckDocCohort,
  onOpenMemoEditor, onCopyMemoBody, onCopyMemoMarkdown, onExtendMemoTtl, onExportMemoTxt,
}: ItemCardProps) {
  bumpRender('ItemCard');
  const [loading, setLoading] = useState(false);
  const [imageIconFailed, setImageIconFailed] = useState(false);
  const [monitorPickerPos, setMonitorPickerPos] = useState<{ x: number; y: number } | null>(null);

  // Hold popup state
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdDir, setHoldDir] = useState<SlotDir | null>(null);
  const [holdMonitorMode, setHoldMonitorMode] = useState(false);
  const [holdClosing, setHoldClosing] = useState(false);
  // v1.3.50 — 팝업이 클릭(ctrl/더블)으로 열렸는지. true 면 바깥클릭 백드롭
  // 렌더 (hold 는 pointerup 으로 닫혀서 백드롭 불필요).
  const [clickOpened, setClickOpened] = useState(false);

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
  // Set true between right-button drag-start and the upcoming contextmenu
  // event so the menu doesn't pop in the middle of a drag. See
  // handlePointerDown below for lifecycle.
  const suppressContextMenuRef = useRef(false);
  const monitorBadgeClickedRef = useRef(false);
  const globalMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const globalUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  // Hold-hint: surfaces the 4-direction gesture after hover dwell (350ms < HOLD_MS 450ms)
  const [hintVisible, setHintVisible] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Context ──────────────────────────────────────────────────
  const {
    activeMode = 'normal', nodeGroups = [], nodeBuilding = [], decks = [],
    deckAnchorItemIds, inactiveWindowIds, monitorCount = 1, monitors = [], allItems = [],
    monitorDirections, closeAfter, searchQuery = '',
    justAddedItemIds, cardActionGesture = 'ctrl-click', policyCtx,
    docCohortOutdated,
  } = useAppState();
  const isDocOutdated = item.type === 'doc' && !!item.docCohort && !!docCohortOutdated?.has(item.id);
  const isJustAdded = justAddedItemIds?.has(item.id) ?? false;
  const {
    launchAndPosition: onLaunchAndPosition,
    openMonitorSettings: onOpenMonitorSettings,
    onPinModeClick: onPinModeClickCtx, onNodeModeClick: onNodeModeClickCtx,
    onDeckModeClick: onDeckModeClickCtx,
    onWindowInactiveClick: onWindowInactiveClickCtx,
    onCleanModeClick: onCleanModeClickCtx,
  } = useAppActions();

  // ── Derived values from context ──────────────────────────────
  const isNodeLinked = nodeGroups.some(g => g.itemIds.includes(item.id));
  // isNodeAnchor: card is in the active node staging set (build OR
  // edit). nodeBuilding mirrors the editing group's itemIds in B mode
  // (kept in sync by useNodeDeckMode), so a single read covers both.
  const isNodeAnchor = nodeBuilding.includes(item.id);
  // 1-indexed order within the active node staging set. Drives the
  // big "1 / 2 / 3" badge on member cards during node mode. Returns 0
  // when the card isn't a member (or we're not in node mode at all).
  const nodeOrderIndex = activeMode === 'node'
    ? (nodeBuilding.indexOf(item.id) + 1)
    : 0;
  // True when node staging is full and THIS card isn't a member —
  // surfaces the "click to slide-replace" affordance via subtle dim.
  const isNodeFullNonMember = activeMode === 'node'
    && nodeBuilding.length >= 3
    && !isNodeAnchor;
  const isDeckAnchor = deckAnchorItemIds?.has(item.id) ?? false;
  const nodeBadges = (() => {
    const arr: number[] = [];
    nodeGroups.forEach((g, i) => { if (g.itemIds.includes(item.id)) arr.push(i + 1); });
    return arr.length ? arr : undefined;
  })();
  const deckBadges = (() => {
    const arr: number[] = [];
    decks.forEach((d, i) => { if (d.itemIds.includes(item.id)) arr.push(i + 1); });
    return arr.length ? arr : undefined;
  })();
  const isInactive = inactiveWindowIds?.has(item.id) ?? false;
  const onPinModeClick = () => onPinModeClickCtx(item.id);
  const onNodeModeClick = () => onNodeModeClickCtx(item.id);
  const onDeckModeClick = () => onDeckModeClickCtx(item.id);
  const onCleanModeClick = () => onCleanModeClickCtx(space.id, item.id);
  const onInactiveClick = () => onWindowInactiveClickCtx(item);

  // Sync holdDir to ref
  useEffect(() => { holdDirRef.current = holdDir; }, [holdDir]);

  useEffect(() => { setImageIconFailed(false); }, [item.id, item.icon, item.iconType]);

  // ── dnd-kit ─────────────────────────────────────────────────
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  // Container cards stay PUT during another card's drag.
  //
  // Why: dnd-kit's rectSortingStrategy displaces every card in the
  // SortableContext to make room for the dragged item. When the
  // dragged item passes over a container, the container shifts away
  // — visually the container "runs from" the user, and the bloom UX
  // (which relies on the container's position to anchor the slot
  // zones) ends up chasing a moving target. The user reported this
  // exact behaviour as "this isn't worth paying for".
  //
  // Suppressing the displacement only when:
  //   - this card IS a container (item.isContainer)
  //   - this card is NOT itself the active drag (isDragging === false,
  //     so the user can still pick up & move containers normally)
  // …leaves the rest of the row free to shift, while the container
  // stays anchored. The bloom geometry stays stable, drops land where
  // the user expects, and reordering between non-container cards
  // works unchanged.
  const suppressTransform = item.isContainer && !isDragging;
  const style = {
    transform: suppressTransform ? undefined : CSS.Transform.toString(transform),
    transition: suppressTransform ? undefined : transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // ── Widget mode flag ─────────────────────────────────────────
  // Widget items render their own UI surface (one of MediaWidget /
  // ColorSwatchWidget) instead of ItemCard's standard launchable
  // card. Earlier versions early-returned here, which bypassed the
  // ContextMenu / Tooltip wrapper and broke parity with regular
  // cards (no rename, no delete from right-click). We now keep the
  // wrapper and just swap the inner body — context menu, drag, pin,
  // edit, delete all work the same way as for any other card.
  const isWidget = item.type === 'widget' && !!item.widget;
  // Memo branch — same wrapper-swap pattern as widgets. The wrapper still
  // owns drag, context menu, pin badge, delete; MemoCard owns body markup
  // and click intent (open editor, not launch). When a memo's onOpenMemoEditor
  // callback is missing (older parents), we fall back to the standard card
  // — defensive against partial integration during the v1.3.16 rollout.
  const isMemo = item.type === 'memo' && !!item.memo;

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

  // ── Hold 팝업 — 포커스 이탈 시 강제 닫기 (v1.3.50) ──────────────
  // 버그: 4방향 중 하나를 골라 새 창(이미지 뷰어 / 카드 수정 satellite /
  // 새창 열기)을 띄우면 메인 윈도우가 blur 됨. 그 창을 보고 ESC 로
  // 돌아오면 4방향 팝업이 그대로 남아있는 경우가 있었음 (분기·타이밍
  // 따라 closeHoldPopup 이 누락되거나, 닫기 애니메이션 도중 포커스가
  // 빠지면서 후처리가 어긋남). 분기마다 개별로 잡는 대신, "팝업이 떠
  // 있는데 메인 윈도우가 포커스를 잃었다 = 사용자가 다른 창으로 갔다"
  // 는 단일 신호로 무조건 닫는다. 어떤 방향/액션이든 일관되게 정리됨.
  useEffect(() => {
    if (!holdOpen) return;
    const dismiss = () => closeHoldPopup();
    window.addEventListener('blur', dismiss);
    document.addEventListener('visibilitychange', dismiss);
    return () => {
      window.removeEventListener('blur', dismiss);
      document.removeEventListener('visibilitychange', dismiss);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdOpen]);

  // ── Cleanup on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
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
      setClickOpened(false);
      holdCardRectRef.current = null;
      isHoldActiveRef.current = false;
      holdExecutedRef.current = false;
      removeGlobalHandlers();
    }
  };

  // v1.3.50 — ctrl-click / double-click 으로 4방향 팝업 열기. hold 와 달리
  // 누르고 있는 포인터가 없으므로 global pointermove/up 핸들러를 붙이지
  // 않음 — 사용자는 방향 버튼을 직접 '클릭'하거나 (버튼 onClick=doHoldAction),
  // 바깥/center 버튼/ESC/blur 로 닫는다. clickOpened state 가 바깥클릭
  // 백드롭 렌더를 트리거.
  const openActionPopupViaClick = () => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    holdCardRectRef.current = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    isHoldActiveRef.current = true;
    holdExecutedRef.current = false;
    (document.activeElement as HTMLElement)?.blur();
    setClickOpened(true);
    setHoldOpen(true);
    setHoldDir(null);
    setHoldMonitorMode(false);
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
          // v1.3.49 — 이미지 카드는 자체 ImageViewerSatellite (다크 backdrop +
          // wheel zoom + drag pan + ESC 닫기) 로 보기. OS default viewer 무거운
          // 거 회피, 톤앤매너 (메모 에디터) 일관. 카드 클릭은 여전히 클립보드
          // 복사.
          if (item.type === 'image' && item.value) {
            electronAPI.openImageViewer({
              path: item.value,
              label: item.title,
              accentColor: item.color,
            });
          } else {
            executeLaunchNoClose();
          }
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

  const handleClick = useCallback((e?: React.MouseEvent) => {
    if (monitorBadgeClickedRef.current) { monitorBadgeClickedRef.current = false; return; }
    if (wasHoldRef.current || holdOpen) return;
    if (activeMode === 'pin') { onPinModeClick(); return; }
    if (activeMode === 'node') { onNodeModeClick(); return; }
    if (activeMode === 'deck') { onDeckModeClick(); return; }
    if (activeMode === 'clean') { onCleanModeClick(); return; }
    if (isInactive && item.type === 'window') { onInactiveClick(); return; }

    // v1.3.50 — 전역 충돌 가드 (conflict-avoidance-policy.md §3). 여기
    // 도달 = activeMode==='normal' (tool 모드는 위에서 처리). 남은 차단
    // 상태는 memo 편집 / 오버레이 / satellite 다이얼로그 / cmd 팔레트 —
    // 그땐 launch 도 4방향 팝업도 모두 차단(matrix). 단일 게이트로 커버.
    // 이전엔 ItemCard 가 activeMode 만 봐서, 다이얼로그(별도 창) 뒤
    // 그리드 카드 클릭이 launch 되던 정책 위반. cmd 팔레트 자체 launch 는
    // App.launchItem 경유라 이 게이트와 무관 (regression 없음).
    if (policyCtx && canPerform('card.launch', policyCtx) !== true) {
      shakeElement(cardRef.current);
      return;
    }

    // v1.3.50 — ctrl-click 제스처: Ctrl/⌘+클릭 → 4방향 팝업. 단일클릭
    // (실행) 과 modifier 로 분리돼 지연 없음. 설정이 'ctrl-click' 일 때만.
    if (cardActionGesture === 'ctrl-click' && (e?.ctrlKey || e?.metaKey)) {
      openActionPopupViaClick();
      return;
    }

    // v1.3.50 — double-click 제스처: 더블클릭 → 4방향 팝업. 단일클릭
    // (실행) 은 두번째 클릭을 기다려야 하므로 DBLCLICK_MS 지연. 이 모드
    // 에서만 모든 실행이 ~220ms 늦어지는 비용 (설정 화면에서 안내).
    if (cardActionGesture === 'double-click') {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        openActionPopupViaClick();   // 두번째 클릭 = 팝업
      } else {
        clickTimerRef.current = setTimeout(() => { clickTimerRef.current = null; executeLaunch(false); }, DBLCLICK_MS);
      }
      return;
    }

    // 기본 단일클릭 = 실행. window/app/folder 는 더블클릭=최대화 (gesture
    // 가 double-click 이 아닐 때만 — 그 모드는 위에서 팝업으로 가로챔).
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, item, isInactive, holdOpen, executeLaunch, cardActionGesture, policyCtx]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      // Right-click intent disambiguation:
      //   - If the user *moves* more than 8px before releasing, treat it
      //     as a sortable drag and suppress the upcoming contextmenu so
      //     Radix's menu doesn't pop on top of the dragged card.
      //   - If they release without movement, let contextmenu fire and
      //     Radix opens the menu as before.
      // Why a flag-based approach instead of just preventDefault on
      // contextmenu always: we want the menu in the no-movement case.
      // The native contextmenu event fires AFTER button-up on Windows,
      // so we have time to flip the flag during the press.
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      let dragged = false;
      const onMove = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) dragged = true;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (dragged) {
          suppressContextMenuRef.current = true;
          // Clear after the contextmenu event has had a chance to consume
          // the flag (browser fires it within a frame of pointerup).
          setTimeout(() => { suppressContextMenuRef.current = false; }, 120);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      if (listeners?.onPointerDown) (listeners.onPointerDown as unknown as (e: React.PointerEvent) => void)(e);
      return;
    }
    if (e.button !== 0) return;
    // Conflict-avoidance policy — see plans/conflict-avoidance-policy.md.
    // Hold-press would otherwise let the user pop the slot-popup
    // mid-pin/node/deck/clean mode, which silently ignores their
    // tool intent and launches the card on release. The policy
    // gate also covers memo-editor / dialog / overlay / cmd states
    // for free, so this single check supersedes the older ad-hoc
    // v1.3.50 — 이전엔 dialog/memo/overlay/cmd 를 'none' 하드코딩해서
    // hold 가 그 상태들에서 안 막혔음 ("activeMode 외엔 상위 레이어가
    // 포인터를 먹는다" 가정인데, satellite 다이얼로그는 별도 창이라
    // 메인 그리드가 그대로 클릭됨 → 가정 깨짐). 이제 App 이 내려주는
    // 실제 policyCtx 로 전체 충돌 상태 반영.
    const verdict = canPerform('card.hold-press', policyCtx ?? {
      activeMode, nodeEditMode: nodeBuilding.length > 0, deckBuilding: false,
      editingMemoId: null, dialog: 'none', tileOverlayGroup: null, cmdOpen: false,
    });
    if (verdict !== true) {
      shakeElement(cardRef.current);
      return;
    }

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

  // For widget cards, dispatch on `widget.kind`. Each widget renders
  // its own body (with data-card / data-card-id and dragHandle
  // participation). Unknown kinds fall through to the standard card
  // as a safety net — store data corruption shouldn't crash the grid.
  let widgetBody: React.ReactNode = null;
  if (isWidget && item.widget) {
    const dragHandle = { setNodeRef, style, attributes, listeners, isDragging };
    if (item.widget.kind === 'media-control') {
      widgetBody = <MediaWidget item={item} space={space} dragHandle={dragHandle} />;
    } else if (item.widget.kind === 'color-swatch') {
      widgetBody = (
        <ColorSwatchWidget
          item={item}
          space={space}
          dragHandle={dragHandle}
          onEdit={() => onEdit(item)}
        />
      );
    }
  }
  // Memo body — uses same dragHandle convention as widgets.
  let memoBody: React.ReactNode = null;
  if (isMemo && item.memo && onOpenMemoEditor) {
    const dragHandle = { setNodeRef, style, attributes, listeners, isDragging };
    memoBody = (
      <MemoCard
        item={item}
        space={space}
        dragHandle={dragHandle}
        pinned={pinned}
        isJustAdded={isJustAdded}
        onOpenEditor={() => onOpenMemoEditor(item.id)}
        onCopyPlain={() => onCopyMemoBody?.(item.id)}
        onCopyMarkdown={() => (onCopyMemoMarkdown ?? onCopyMemoBody)?.(item.id)}
        onExtend={() => onExtendMemoTtl?.(item.id)}
        onExportTxt={() => onExportMemoTxt?.(item.id)}
      />
    );
  }
  const cardEl = memoBody ?? widgetBody ?? (
    <div
      ref={(el) => { setNodeRef(el); (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
      data-card
      data-card-id={item.id}
      data-card-type={item.type}
      data-tour-id="item-card"
      style={{
        ...style,
        background: isNodeAnchor ? 'var(--accent-dim)' : 'var(--surface)',
        borderColor: isNodeLinked ? 'var(--accent)' : item.isContainer ? 'var(--accent)' : 'var(--border-rgba)',
        borderStyle: item.isContainer ? 'dashed' : 'solid',
        // Spring-pop entry animation — only plays once when card is newly added (via drop/dialog).
        // isDragging guard: dnd-kit sets its own transform — avoid conflict during drag.
        ...(isJustAdded && !isDragging
          ? { animation: 'cardEnter 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both' }
          : {}),
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
      onContextMenu={e => {
        if (suppressContextMenuRef.current) {
          // Drag was initiated — eat the contextmenu so Radix doesn't
          // open the menu over the dragged card. Don't reset here; the
          // setTimeout in handlePointerDown clears it on its own
          // schedule (avoids missing a duplicate fire on weird DPIs).
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Conflict-avoidance: opening the card's right-click menu
        // mid-tool-mode lets the user "수정 / 삭제" the very card
        // they should be slotting / linking / cleaning — silently
        // breaks the tool flow. Block + shake instead.
        // v1.3.50 — 실제 policyCtx 사용 (이전 하드코딩 'none' → 전체 충돌
        // 상태 반영).
        const verdict = canPerform('card.edit', policyCtx ?? {
          activeMode, nodeEditMode: nodeBuilding.length > 0, deckBuilding: false,
          editingMemoId: null, dialog: 'none', tileOverlayGroup: null, cmdOpen: false,
        });
        if (verdict !== true) {
          e.preventDefault();
          e.stopPropagation();
          shakeElement(cardRef.current);
          return;
        }
        // Suppress only the BROWSER default menu — Radix ContextMenu's
        // own listener still fires off this event (we don't stopPropagation),
        // so right-click without movement still opens our menu.
        e.preventDefault();
      }}
      className={`
        group relative flex flex-col items-center justify-center gap-1.5
        rounded-xl p-3 min-h-[82px] cursor-pointer select-none
        border transition-all duration-150 ease-out active:scale-[0.96]
        ${nodeClasses} ${isInactive ? 'opacity-50' : ''}
        ${isNodeFullNonMember ? 'opacity-60' : ''}
      `}
      onMouseEnter={e => {
        // v1.3.48 — 청소 모드 + 비고정/비컨테이너 카드 호버 시 destructive
        // tint. 클릭하면 그 카드 삭제된다는 시각 시그널. 핀/컨테이너는
        // 보호 대상이라 normal hover.
        const pinSet = new Set(space.pinnedIds ?? []);
        const cleanTargetable = activeMode === 'clean' && !pinSet.has(item.id) && !item.isContainer;
        if (cleanTargetable) {
          (e.currentTarget as HTMLDivElement).style.background = 'color-mix(in srgb, var(--color-destructive) 12%, var(--surface))';
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-destructive)';
        } else {
          (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)';
          if (!item.isContainer) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-focus)';
        }
        // Show hint after short dwell — just before hold would fire (HOLD_MS = 450ms)
        if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
        hintTimerRef.current = setTimeout(() => setHintVisible(true), 350);
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.background = isNodeAnchor ? 'var(--accent-dim)' : 'var(--surface)';
        (e.currentTarget as HTMLDivElement).style.borderColor = isNodeLinked ? 'var(--accent)' : item.isContainer ? 'var(--accent)' : 'var(--border-rgba)';
        // Cancel pending hint and hide immediately on leave
        if (hintTimerRef.current) { clearTimeout(hintTimerRef.current); hintTimerRef.current = null; }
        setHintVisible(false);
      }}
    >
      {/* ── Top-right state chip (v1.3.48) ──────────────────────────
           통합 chip 시스템:
             - 우상단 (top-right): 상태 chip — 컨테이너 OR 고정 (mutually
               exclusive, accent 색)
             - 우하단 (bottom-right): type chip (muted 색)
             둘 다 동일 박스 (18×18, var(--bg-rgba), var(--border-rgba)) 로
             "시각적으로 정리된 느낌". 사용자 피드백: 이전엔 chip 이 너무
             작고 (12-14px) pin 은 bookmark / 컨테이너는 grid_view 가 자유
             좌표에 흩어져 있어 일관성 없음.
           Pin 아이콘: bookmark → push_pin 통일 (Sidebar / CommandBar /
           ContextMenu 와 동일 어휘). */}
      {(item.isContainer || pinned) && (
        <span
          title={item.isContainer ? '컨테이너' : '고정됨'}
          aria-label={item.isContainer ? '컨테이너' : '고정됨'}
          style={{
            position: 'absolute', top: 4, right: 4,
            width: 18, height: 18, borderRadius: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-rgba)',
            border: '1px solid var(--accent)',
            opacity: 0.85,
            transition: 'opacity 0.15s',
            pointerEvents: 'none',
            zIndex: 3,
          }}
          className="group-hover:!opacity-100"
        >
          <Icon name={item.isContainer ? 'grid_view' : 'push_pin'} size={11} color="var(--accent)" />
        </span>
      )}

      {/* ── Doc cohort "새 버전 있음" 배지 (v1.3.50) ────────────────
          좌상단 (우상단 state chip / 우하단 type chip / 좌하단 monitor
          chip 과 안 겹침). "최신" 은 무배지 — outdated 만 표시 (알림
          노이즈 0). 클릭 동작 없음 (순수 시그널) — 실제 교체는 우클릭
          '최신 버전 확인'. node 모드 order 배지(좌상단)와 겹칠 수 있어
          node 모드일 땐 숨김 (order 배지 우선). */}
      {isDocOutdated && activeMode === 'normal' && (
        <span
          title="새 버전이 있어요 — 우클릭 → 최신 버전 확인"
          aria-label="새 버전 있음"
          style={{
            position: 'absolute', top: 4, left: 4,
            width: 18, height: 18, borderRadius: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-rgba)',
            border: '1px solid var(--color-destructive)',
            opacity: 0.9,
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <Icon name="new_releases" size={11} color="var(--color-destructive)" />
        </span>
      )}

      {/* Container slot direction ghost rectangles on hover were removed in
          v1.3.34 — they were visually faint AND redundant with the hold
          gesture's 4-way picker (which already covers the same intent
          with stronger affordance). Empty slot positions are still
          conveyed by the 4 corner dots below. ContainerSlotGhosts file
          kept dormant for the time being — purge when no other call site
          references it. */}

      {/* ── Container slot dots (4 edges) ────────────────────────── */}
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

      {/* ── Hold hint ring ───────────────────────────────────────── */}
      {holdOpen && (
        <span style={{ position:'absolute', inset:-2, borderRadius:13, border:'2px solid var(--accent)', opacity:0.5, pointerEvents:'none', animation:'none' }} />
      )}

      {/* ── Hold gesture hint arrows ─────────────────────────────── */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          opacity: (hintVisible && !holdOpen && !isInactive && !item.isContainer && activeMode === 'normal') ? 1 : 0,
          transition: 'opacity 0.15s ease',
        }}
      >
        <Icon name="keyboard_arrow_up"    size={9} color="var(--text-dim)" style={{ position:'absolute', top:2,    left:'50%',  transform:'translateX(-50%)' }} />
        <Icon name="keyboard_arrow_down"  size={9} color="var(--text-dim)" style={{ position:'absolute', bottom:2, left:'50%',  transform:'translateX(-50%)' }} />
        <Icon name="keyboard_arrow_left"  size={9} color="var(--text-dim)" style={{ position:'absolute', left:2,   top:'50%',   transform:'translateY(-50%)' }} />
        <Icon name="keyboard_arrow_right" size={9} color="var(--text-dim)" style={{ position:'absolute', right:2,  top:'50%',   transform:'translateY(-50%)' }} />
      </div>

      {/* ── Node mode — BIG order badge (top-left) ──────────────────
          During node mode (build OR edit-existing), member cards show
          the 1-indexed launch order as a prominent accent badge. Drives
          the user's mental model of "this is selected AND it's the
          Nth in the launch sequence" — much louder than the small
          membership pill that's used in normal mode hover.
          The membership pill below is suppressed when this badge is
          rendering (the !isNodeAnchor guard there) so they don't
          double-render. */}
      {nodeOrderIndex > 0 && (
        <div
          className="absolute top-[5px] left-[5px]"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: 6,
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 800,
            lineHeight: 1,
            boxShadow: '0 2px 8px rgba(99,102,241,0.45)',
            // Spring-pop entry so the badge reads as a fresh state
            // change rather than always-there decoration.
            animation: 'cardEnter 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) both',
            zIndex: 4,
          }}
          title={`노드 ${nodeOrderIndex}번 · 클릭으로 제거`}
        >
          {nodeOrderIndex}
        </div>
      )}

      {/* ── Workflow membership pill (top-left) ──────────────────────
          Replaces the previous "two separate coloured circles per card"
          with ONE compact pill that lists membership inline. Reduces
          colour count (was: blue node + orange deck on the same card =
          chromatic mismatch), brings node and deck under one visual
          grammar (small caps "n1·d2" letters), and saves space when a
          card belongs to both.

          Visibility: full opacity in node/deck mode; fades in on hover
          in normal mode — same trigger as before. */}
      {((nodeBadges && nodeBadges.length > 0 && !isNodeAnchor) || (deckBadges && deckBadges.length > 0)) && (() => {
        const parts: Array<{ k: 'n' | 'd'; n: number }> = [];
        if (nodeBadges && !isNodeAnchor) for (const i of nodeBadges.slice(0, 2)) parts.push({ k: 'n', n: i });
        if (deckBadges)                  for (const i of deckBadges.slice(0, 2)) parts.push({ k: 'd', n: i });
        if (parts.length === 0) return null;

        return (
          <div
            className={`absolute top-[5px] left-[5px] transition-opacity duration-150 ${
              (activeMode === 'node' || activeMode === 'deck') ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              height: 14,
              padding: '0 5px',
              borderRadius: 7,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '0.02em',
              fontFamily: 'inherit',
            }}
            title={parts.map(p => `${p.k === 'n' ? '노드' : '덱'} ${p.n}`).join(' · ')}
          >
            {parts.map((p, i) => (
              <span key={`${p.k}${p.n}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {i > 0 && <span style={{ opacity: 0.5, margin: '0 2px' }}>·</span>}
                <span style={{ opacity: 0.7, marginRight: 1 }}>{p.k}</span>
                <span>{p.n}</span>
              </span>
            ))}
          </div>
        );
      })()}

      {/* ── Monitor badge (bottom-left) ──────────────────────────────
          Invisible when auto (monitor === undefined) — becomes visible on hover.
          Always visible when a specific monitor is assigned.
          Removes the constant "C" noise from every card.                       */}
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
            title={item.monitor ? `모니터 ${item.monitor} 고정` : '모니터 지정'}
            style={{
              position:'absolute', bottom:5, left:5,
              width:15, height:15, borderRadius:4,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:8, fontWeight:700, lineHeight:1,
              cursor:'pointer', userSelect:'none',
              transition:'opacity 0.15s, background 0.15s',
              background: item.monitor ? 'var(--accent)' : 'var(--border-rgba)',
              color: item.monitor ? '#fff' : 'var(--text-dim)',
              // Auto (unset) = invisible until hover; assigned monitor = always visible
              opacity: item.monitor ? 0.85 : 0,
              zIndex: 5,
            }}
            className="group-hover:!opacity-100"
          >
            {item.monitor ?? 'M'}
          </span>
          {monitorPickerPos && createPortal(
            <>
              <div
                style={{ position:'fixed', inset:0, zIndex:99998 }}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); setMonitorPickerPos(null); }}
              />
              <div
                onPointerDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                style={{
                  position:'fixed',
                  left: monitorPickerPos.x,
                  top:  monitorPickerPos.y,
                  zIndex: 99999,
                  borderRadius: 10,
                  boxShadow:'0 10px 32px rgba(0,0,0,0.32)',
                }}
              >
                <MonitorPicker
                  monitors={monitors}
                  value={item.monitor}
                  onPick={(idx) => { onSetMonitor(idx); setMonitorPickerPos(null); }}
                  size="compact"
                />
              </div>
            </>,
            document.body
          )}
        </>
      )}

      {/* ── Image card: full-card thumbnail (v1.3.46+) ──────────────
          For type='image' we replace the icon+title vertical stack
          with a Pinterest-style cover thumbnail + small label slice
          at the bottom. All the other overlays (pin, badges, slot
          dots, hold ring, monitor pill) keep their absolute positions
          and float on top of the image. */}
      {item.type === 'image' && item.value ? (
        <div
          style={{
            position: 'absolute',
            inset: 4,
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--surface-hover)',
            pointerEvents: 'none',
          }}
        >
          {imageIconFailed ? (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-dim)',
            }}>
              <Icon name="broken_image" size={28} color="var(--text-dim)" />
            </div>
          ) : (
            <img
              src={`file:///${item.value.replace(/\\/g, '/')}`}
              alt=""
              loading="lazy"
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
              onError={() => setImageIconFailed(true)}
            />
          )}
          {/* Label slice — small caption over a bottom gradient so the
              title stays legible regardless of the image's bottom edge. */}
          {item.title && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '8px 6px 4px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 600,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}>
              {item.title}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ── Icon — type-tint badge container ────────────────────────
              Wraps the icon in a 36×36 rounded square with 8% opacity type-color
              background. This gives the card a visual anchor and passively encodes
              the item type through colour.
              Inactive items used to get a red tint here, but combined with the
              50% card opacity it read as alarming — like an error. We now rely
              on the card-level opacity alone, which is enough to communicate
              "this is dimmed" without the safety-orange. */}
          <div
            title={isInactive ? '창이 닫혀 있어요' : undefined}
            style={{
              width: 36, height: 36, borderRadius: 9, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // Image icons: let the image speak for itself — no tint behind it
              background: (item.iconType === 'image' && item.icon && !imageIconFailed)
                ? 'transparent'
                : `${accentColor}14`,     // 8% type-color tint (always)
              transition: 'background 0.15s',
            }}
          >
            {loading ? (
              <Icon name="sync" size={22} color={accentColor} className="animate-spin" />
            ) : item.iconType === 'image' && item.icon && !imageIconFailed ? (
              <img
                src={item.icon} alt=""
                style={{ width: 32, height: 32, borderRadius: 7, objectFit: 'cover' }}
                onError={() => setImageIconFailed(true)}
              />
            ) : (
              <Icon name={icon} size={22} color={accentColor} />
            )}
          </div>

          {/* ── Title ───────────────────────────────────────────────────── */}
          <span className="text-[11px] font-medium leading-tight text-center line-clamp-2 w-full" style={{ color:'var(--text-color)' }}>
            <HighlightText text={item.title} query={searchQuery} />
          </span>
        </>
      )}

      {/* ── Bottom stripe — space-color only ────────────────────────
          Pre-v1.3.9 this stripe doubled as the pin indicator (accent
          colour when pinned, space colour otherwise). That meant pinned
          cards lost their space-membership signal, and unpinned cards
          competed visually for the accent colour with node-linked cards.
          Now: the stripe is ALWAYS the space colour; pin lives as a
          dedicated bookmark glyph in the top-right corner. */}
      {space.color && (
        <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ background: space.color, opacity: 0.55 }} />
      )}

      {/* ── Type chip — bottom-right (v1.3.48) ─────────────────────
          사용자 피드백: 이전 14px chip 너무 작음. 우상단 state chip 과
          동일한 18×18 박스로 통일 — 시각적으로 정리된 느낌. 컬러도
          디자인 시스템 토큰만 (text-muted, bg-rgba, border-rgba — accent
          은 안 씀, 그건 state chip 의 영역). 자명한 타입 (image 썸네일 /
          memo body / widget UI / container grid) 은 chip 생략 — 중복.
          위치 충돌 가드: 좌하단 monitor chip 과 좌-우 분리, 컨테이너 슬롯
          점은 chip 비대상이라 자동 회피. */}
      {!isWidget && !isMemo && !item.isContainer && item.type !== 'image' && (
        <span
          title={getTypeLabel(item.type)}
          aria-label={getTypeLabel(item.type)}
          style={{
            position: 'absolute', bottom: 4, right: 4,
            width: 18, height: 18, borderRadius: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-rgba)',
            border: '1px solid var(--border-rgba)',
            opacity: 0.7,
            transition: 'opacity 0.15s',
            pointerEvents: 'none',
            zIndex: 3,
          }}
          className="group-hover:!opacity-100"
        >
          <Icon name={getTypeIcon(item.type)} size={11} color="var(--text-muted)" />
        </span>
      )}

      {/* F6: stale dot — item hasn't been clicked in 60+ days AND was used before
          (clickCount > 0). Subtle, hover-only tooltip; not a badge so it stays calm. */}
      {(() => {
        const count = item.clickCount ?? 0;
        const last = item.lastClickedAt;
        if (count === 0 || !last) return null;
        const staleMs = 60 * 24 * 60 * 60 * 1000;
        if (Date.now() - last < staleMs) return null;
        return (
          <div
            title="60일째 안 썼어요 · 정리 후보"
            className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--text-dim)', opacity: 0.5 }}
          />
        );
      })()}
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
    return getCardAction(item.type, holdDir).label;
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
      {/* v1.3.50 — 바깥클릭 닫기 백드롭. 클릭(ctrl/더블)으로 연 팝업은
          hold 처럼 pointerup 으로 안 닫히므로 명시적 백드롭 필요. 첫 자식
          이라 방향 버튼들(이후 렌더)이 위에 깔림 — 버튼 클릭은 버튼이,
          그 외 영역 클릭은 백드롭이 받아 닫음. hold-open 시엔 미렌더. */}
      {clickOpened && (
        <div
          data-hold-popup
          onClick={() => closeHoldPopup(true)}
          style={{ position:'fixed', inset:0, pointerEvents:'auto', background:'transparent' }}
        />
      )}
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
        <Icon name={holdMonitorMode ? 'arrow_back' : 'close'} size={13} color="var(--text-muted)" />
      </button>

      {holdMonitorMode ? (
        // ── Monitor picker sub-mode (proportional visual) ──────
        // Replaces the previous WASD-mapped circular wheel. The new
        // MonitorPicker shows the user's actual monitor layout
        // scaled to fit, so it stays legible regardless of how
        // many monitors they have. The circular ring backdrop
        // stays for visual continuity with the 4-direction primary
        // mode — we just punch the picker through its centre.
        <>
          <div style={{
            position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)',
            width:220, height:220, borderRadius:'50%',
            background:'var(--bg-rgba, rgba(18,18,28,0.55))',
            backdropFilter:'blur(28px) saturate(160%)',
            WebkitBackdropFilter:'blur(28px) saturate(160%)',
            border:'1px solid rgba(255,255,255,0.1)',
            boxShadow:'0 8px 40px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.12)',
            pointerEvents:'none', zIndex:0,
          }} />
          <div
            data-hold-popup
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
            style={{
              position:'absolute', left:'50%', top:'50%',
              transform:'translate(-50%,-50%)',
              zIndex: 2, pointerEvents: 'auto',
            }}
          >
            <MonitorPicker
              monitors={monitors}
              value={item.monitor}
              size="wheel"
              onPick={(idx) => { launchOnMonitorRef.current(idx); closeHoldPopup(); }}
              onOpenSettings={onOpenMonitorSettings ? () => { closeHoldPopup(); setTimeout(() => onOpenMonitorSettings(), 50); } : undefined}
            />
          </div>
          <div style={{ position:'absolute', left:'50%', bottom:-22, transform:'translateX(-50%)', whiteSpace:'nowrap', fontSize:9, color:'var(--text-dim)', pointerEvents:'none' }}>
            이번 한 번만 · Esc로 취소
          </div>
        </>
      ) : (
        // ── 4-direction icon buttons ───────────────────────────
        DIRS.map(dir => {
          const isSelected = holdDir === dir;
          const slotItem = slotItems?.[dir];
          const cardAction = !item.isContainer ? getCardAction(item.type, dir) : null;
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
                  : <Icon name={slotItem.icon ?? getTypeIcon(slotItem.type)} size={22} color={isSelected ? '#fff' : 'var(--text-muted)'} />
              )}
              {/* Container: empty slot → direction arrow */}
              {item.isContainer && !slotItem && (
                <Icon name={DIR_ICONS[dir]} size={18} color="var(--text-dim)" />
              )}
              {/* Card action → action icon */}
              {cardAction && (
                <Icon name={cardAction.icon} size={20} color={isSelected ? '#fff' : 'var(--text-muted)'} />
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
          {/* Widgets and memos skip the Tooltip wrapper — they have no
              `value` to show and their body already communicates what
              they are. Regular cards' tooltip teaches the click model:
              the user sees "짧게: 카드 실행 / 길게: 4방향 액션" at a
              glance, instead of a cryptic file path. Discoverability
              of the long-press gesture was effectively zero before;
              this surfaces it on every hover. */}
          {(isWidget || isMemo) ? cardEl : (
            <Tooltip>
              <TooltipTrigger render={cardEl} />
              <TooltipContent side="bottom" className="text-xs max-w-[260px]">
                <CardHoverHint
                  type={item.type}
                  isContainer={item.isContainer}
                  filledSlots={filledSlots.length}
                  totalSlots={DIRS.length}
                />
              </TooltipContent>
            </Tooltip>
          )}
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={() => onEdit(item)} className="gap-2 cursor-pointer">
            <Icon name="edit" className="text-sm" />카드 수정
          </ContextMenuItem>
          <ContextMenuItem onClick={onTogglePin} className="gap-2 cursor-pointer">
            {/* v1.3.48 — pin icon SSOT: push_pin 만 사용 (Sidebar /
                CommandBar / Card top-right chip / 본 컨텍스트 메뉴 모두
                동일 어휘). 이전엔 unpinned 상태에서 'keep' 아이콘이 떠서
                "이게 뭐지?" 혼란. 동일 행위는 동일 글리프. */}
            <Icon name="push_pin" className="text-sm" />
            {pinned ? '핀 해제' : '위치 고정'}
          </ContextMenuItem>

          {/* 최신 버전 확인 — 문서 코호트 전용. v1.3.48 사용자 피드백:
              이전엔 app/folder/doc/image 모두 노출됐는데, 사실 doc cohort
              스캐너 (dirname + 파일명 패턴) 가 의미있는 건 doc type 뿐임.
              app/folder 는 폴더 안 파일들이 같은 family 일 가능성 낮고,
              image 는 버전 관리 대상 아님. type === 'doc' 만 남김. */}
          {onCheckDocCohort && item.type === 'doc' && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onCheckDocCohort} className="gap-2 cursor-pointer">
                <Icon name="schedule" className="text-sm" />최신 버전 확인
              </ContextMenuItem>
            </>
          )}

          {/* Container-related items don't apply to widget or memo cards
              — neither is launchable, so wrapping them in a 4-slot
              container has no meaning. */}
          {!isWidget && !isMemo && (
            <>
              <ContextMenuSeparator />
              {!item.isContainer && onConvertToContainer && (
                <ContextMenuItem onClick={onConvertToContainer} className="gap-2 cursor-pointer">
                  <Icon name="grid_view" className="text-sm" />컨테이너로 전환
                </ContextMenuItem>
              )}
              {item.isContainer && (
                <>
                  <ContextMenuItem onClick={() => onEditSlots?.()} className="gap-2 cursor-pointer">
                    <Icon name="tune" className="text-sm" />슬롯 편집
                  </ContextMenuItem>
                  {onConvertFromContainer && (
                    <ContextMenuItem onClick={onConvertFromContainer} className="gap-2 cursor-pointer">
                      <Icon name="grid_off" className="text-sm" />일반 카드로 전환
                    </ContextMenuItem>
                  )}
                </>
              )}
            </>
          )}

          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onDelete(item.id)} className="gap-2 cursor-pointer text-red-400 focus:text-red-400 focus:bg-red-500/10">
            <Icon name="delete" className="text-sm" />삭제
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Hold popup is the long-press monitor / slot picker — only
          relevant for launchable / container cards, not widgets. */}
      {!isWidget && !isMemo && holdPopup}
    </>
  );
}

/** Memoised export — skip re-render unless rendered fields actually changed.
 *  Callbacks (onEdit / onDelete / …) are intentionally NOT compared because
 *  they often get fresh refs from App on every render; the rendered output
 *  only depends on the data props below. Field-by-field cost is a few
 *  hundred nanoseconds × 41 cards × App-render-rate — well under the cost
 *  of a single avoided re-render. */
export const ItemCard = memo(ItemCardImpl, (prev, next) => {
  if (prev.pinned !== next.pinned) return false;
  // Space attrs that affect rendering. We compare a stable set of fields
  // rather than `prev.space === next.space` so a parent-side spread that
  // gives the same content but a new ref doesn't break memoisation.
  const ps = prev.space, ns = next.space;
  if (ps.id !== ns.id || ps.color !== ns.color || ps.sortMode !== ns.sortMode) return false;
  // Item content equality.
  const a = prev.item, b = next.item;
  if (a === b) return true;
  return a.id === b.id
    && a.type === b.type
    && a.title === b.title
    && a.value === b.value
    && a.icon === b.icon
    && a.iconType === b.iconType
    && a.color === b.color
    && a.monitor === b.monitor
    && a.clickCount === b.clickCount
    && a.lastClickedAt === b.lastClickedAt
    && a.pinned === b.pinned
    && a.hiddenInSpace === b.hiddenInSpace
    && a.isContainer === b.isContainer
    && a.slots === b.slots
    && a.widget === b.widget
    && a.memo === b.memo;
});

// ── Card hover hint — discoverability copy in tooltip ───────────
//
// Replaces the old "show path/URL on hover" with a 2-line teaching
// affordance:
//   line 1: short-click verb tailored to type (실행 / 열기 / 복사…)
//   line 2: long-press explanation, surfacing the 4-direction wheel
//
// The 4 directions are constants in this file (CARD_ACTIONS) — the
// hint mirrors them so the user can build muscle memory. For
// containers we show the slot status instead since the click model
// is fundamentally different (slot picker, not launch).
function CardHoverHint({
  type, isContainer, filledSlots, totalSlots,
}: {
  type: LauncherItem['type'];
  isContainer?: boolean;
  filledSlots: number;
  totalSlots: number;
}) {
  // Two-column ledger format — `라벨 : 동작`. Same vocabulary
  // across every interactive surface in the launcher (see
  // widgets/widgetTokens.ts → HOVER_HINT).
  //
  // Wording note (v1.3.34): casual verbs like "발사" were toned down to
  // a more neutral register that reads consistently across types. The
  // pattern is now `클릭 : <동사>` / `길게 누르기 : <설명>` rather than
  // "짧게/길게" with playful verbs.
  if (isContainer) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>
          컨테이너 · {filledSlots}/{totalSlots} 슬롯
        </div>
        <div>클릭 : 슬롯 카드 실행</div>
        <div>길게 누르기 : 슬롯 편집</div>
      </div>
    );
  }

  const shortVerb =
    type === 'url' || type === 'browser' ? 'URL 열기' :
    type === 'folder' ? '폴더 열기' :
    type === 'app' ? '앱 실행' :
    type === 'doc' ? '문서 열기' :
    type === 'window' ? '창 전환' :
    type === 'cmd' ? '명령어 실행' :
    type === 'text' ? '텍스트 복사' :
    type === 'image' ? '이미지 복사' :
    '실행';

  // v1.3.48: type 라벨을 첫 줄 헤더로 prepend — "URL · 클릭 : URL 열기".
  // 호버 시점에 type 이 명시적으로 보여서 우하단 chip 의 의미를 보강.
  const typeLabel = getTypeLabel(type);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.5 }}>
      {typeLabel && (
        <div style={{ fontWeight: 600, color: 'var(--accent)' }}>{typeLabel}</div>
      )}
      <div>클릭 : {shortVerb}</div>
      <div>길게 누르기 : ↑ 수정 ↓ 모니터 ← 새 창 → 복사</div>
    </div>
  );
}

// MonitorHoldBtn was the per-direction button used by the old WASD-
// style monitor picker. Replaced by MonitorPicker (proportional
// visual) so this is dead code. Kept intentionally empty here as a
// breadcrumb in case anyone greps for the symbol in the history.
