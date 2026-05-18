import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Toaster } from 'sonner';
import { TutorialProvider, triggers as tutorialTriggers, findQuest as findTutorialQuest } from './tutorial';
import type { QuestId } from './tutorial';
import { Icon } from '@/components/ui/Icon';
import { NostLogo } from '@/components/ui/NostLogo';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SpaceAccordion } from './components/SpaceAccordion';
import { PresetToggle } from './components/PresetToggle';
import { TourOverlay } from './tour/TourOverlay';
import { TutorialBanner } from './tour/TutorialBanner';
import { SandboxExitModal } from './tour/SandboxExitModal';
import { buildSandboxSeed, snapshotData, mergeSandboxBack, SANDBOX_BACKUP_TAG } from './tour/sandbox';
import { findTour } from './tour/tours';
import type { AppData } from './types';
import { PaywallModal, type PaywallReason } from './components/PaywallModal';
import { useEntitlement } from './hooks/useEntitlement';
import { EmptyState } from './components/EmptyState';
import { WelcomeWizard } from './onboarding/WelcomeWizard';
import { FirstCardCelebration, fireFirstCardCelebration } from './onboarding/FirstCardCelebration';
import { ImportWizard } from './onboarding/ImportWizard';
import type { Template } from './onboarding/templates';
// ItemDialog is no longer rendered inline — it runs in a satellite
// BrowserWindow. The component file is still imported by
// src/item-dialog/ItemDialogSatellite.tsx (satellite renderer).
// DocCohortDialog now runs in a satellite (src/doc-cohort-dialog/).
// ItemWizard is no longer rendered inline — it runs in a satellite
// BrowserWindow. The component file is still imported by
// src/item-wizard/ItemWizardSatellite.tsx.
import { MemoEditor } from './components/MemoEditor';
import { MemoTrashDialog } from './components/MemoTrashDialog';
import { MemoExpiringBanner } from './components/MemoExpiringBanner';
import { memoIsExpiringSoon, memoBodyToPlain, htmlToMarkdown, htmlHasStructure } from './lib/memoUtils';
import { NotificationBell } from './components/NotificationBell';
import type { AppNotification } from './types';
import { runTopEscape } from './lib/escapeStack';
import { canPerform } from './lib/conflictPolicy';
import { ScanDialog } from './components/ScanDialog';
// SettingsDialog now runs in a satellite; component file is imported
// by src/settings-dialog/SettingsDialogSatellite.tsx.
import { StatusBar } from './components/StatusBar';
import { Sidebar } from './components/Sidebar';
import { RecommendPanel } from './components/RecommendPanel';
import { useGhostCards } from './hooks/useGhostCards';
import { NodePanel } from './components/NodePanel';
// ContainerSlotPicker now runs in a satellite (src/container-slot-picker/).
// We still import the supporting types — they're used by handleSaveSlots.
import type { PendingRemoval, PendingNewItem } from './components/ContainerSlotPicker';
// BatchDropDialog now runs in a satellite (src/batch-drop-dialog/).
import type { PendingDrop } from './components/BatchDropDialog';
import { CommandBar, parseCommand, buildSuggestions } from './components/CommandBar';
import { ToastOverlay } from './components/ToastOverlay';
import { WelcomeModal } from './components/WelcomeModal';
import { TileOverlay } from './components/TileOverlay';
import { ContainerBloom, hitTestBloomZone, type Dir as BloomDir } from './components/ContainerBloom';
import type { ParsedCommand } from './components/CommandBar';
import { useAppData } from './hooks/useAppData';
import { useAuth } from './lib/auth';
import { initSync, disposeSync } from './lib/sync';
import { bumpRender, startPerfFlush } from './lib/perf';
import { faviconCandidates } from './hooks/useFavicon';
import { setBusy, whenIdle, isUserBusy } from './lib/userBusy';
import { useToastQueue, type ToastAction } from './hooks/useToastQueue';
import { useTileOverlay } from './hooks/useTileOverlay';
import { pushUndo } from './hooks/useUndoStack';
import { useGlobalUndoShortcut } from './hooks/useGlobalUndoShortcut';
import { useLaunchPipeline } from './hooks/useLaunchPipeline';
import { useWindowDrag } from './hooks/useWindowDrag';
import { useNodeDeckMode } from './hooks/useNodeDeckMode';
import { electronAPI } from './electronBridge';
import Fuse from 'fuse.js';
import { generateId } from './lib/utils';
import { getDocumentExtensions } from './lib/documentExtensions';
import { createLogger } from './lib/logger';
import type { LauncherItem, Space } from './types';
import { DEFAULT_WINDOW_SIZE_PCT } from './types';
import { AppStateProvider, AppActionsProvider } from './contexts/AppContext';
import type { AppActions, AppState } from './contexts/AppContext';
import {
  DndContext,
  closestCorners,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  DragOverlay,
} from '@dnd-kit/core';

// Pointer-priority collision detection.
//
// Default `closestCorners` ranks droppables by the dragged element's four
// corners — fine for compact card sortables, terrible for the wide-space
// reorder UX where the user intuitively aims with the cursor, not the
// dragged rect's nearest corner. Symptom: dropping a wide space on the
// right edge of another wide space silently lands on a *different* row
// because the dragged left corner is closer to that other row's
// droppable than the right corner is to the actual target.
//
// Strategy:
//   1. `pointerWithin` first — any droppable whose rect literally
//      contains the cursor wins. Matches user mental model 1:1.
//   2. `rectIntersection` next — covers cases where the cursor is in a
//      gap (between rows) but the dragged rect overlaps a droppable.
//   3. `closestCorners` as a last resort so we never return [] when
//      there *is* a sensible target nearby.
const pointerFirstCollision: CollisionDetection = (args) => {
  const p = pointerWithin(args);
  if (p.length > 0) return p;
  const r = rectIntersection(args);
  if (r.length > 0) return r;
  return closestCorners(args);
};

// ── Unified pointer sensor ──────────────────────────────────
// One sensor handles BOTH left-click (space reorder) and right-click (card
// reorder) to avoid the multi-sensor conflict dnd-kit exhibits when two
// PointerSensor subclasses both register an onPointerDown activator.
//
// Gating rules live in the activator:
//  - button 0 (primary): drag allowed from anywhere the caller spread the
//    listeners (dnd-kit's setActivatorNodeRef scopes space drag to the header
//    title region; cards ignore button 0 on their own).
//  - button 2 (secondary): drag allowed on cards but NOT on space headers —
//    right-click on a header belongs to useWindowDrag (move the window).
class UnifiedPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        if (event.button === 0) return event.isPrimary;
        if (event.button === 2) {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.('.space-accordion-header')) return false;
          return true;
        }
        return false;
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

// ── Sortable space wrapper (Phase 3: pair-based layout) ─────────────────────
// Layout invariant: every row is either a SOLO space (full width) or a PAIR
// (two spaces splitting the width). No 3+ columns; no partial rows. See
// types.ts for the `pairedWithNext` / `splitRatio` data model.
//
// The whole header is the dnd-kit drag activator (we pass activator props to
// the child). When this space is the LEFT of a pair, it renders a resize
// handle on its right edge that adjusts the pair's splitRatio live.
type DragActivator = {
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
};

function SortableSpace({
  id,
  children,
  dropEdge,
  dropBlocked,
  pairPartnerId,
  currentSplitRatio,
  onSplitRatioChange,
}: {
  id: string;
  children: (activator: DragActivator) => React.ReactNode;
  dropEdge?: 'left' | 'right' | 'center';   // current drop indicator zone, if this space is the target
  dropBlocked?: boolean;                    // true when edge drop is disallowed (target row is already a pair)
  pairPartnerId?: string;                   // set if this space is the LEFT of a pair
  currentSplitRatio?: number;               // current ratio [0.25, 0.75] for the pair; only used when pairPartnerId set
  onSplitRatioChange?: (ratio: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transition, isDragging } = useSortable({ id });
  // Intentionally ignore `transform` from useSortable. With the pair
  // model (rows of 1 or 2 spaces with custom grid templates), dnd-kit's
  // auto-shift transforms compute against a flat sortable index and
  // ignore row membership — peers visually slide into the wrong row,
  // sometimes producing a 3-column squash during the drag.
  //
  // Policy: peers stay put during the drag. The user gets predictable
  // feedback from (a) the floating DragOverlay at the cursor, and (b)
  // the explicit drop indicator (left/right/center line on the hovered
  // target — see dropEdge below). Both signals are accurate; the
  // auto-shift was misleading anyway because the real drop outcome
  // depends on edge intent, not the flat reorder dnd-kit assumes.
  const elRef = useRef<HTMLDivElement | null>(null);
  const [resizing, setResizing] = useState(false);

  // Memoize the combined ref so React doesn't treat every render as a new ref
  // → prevents dnd-kit from receiving phantom setNodeRef(null) / setNodeRef(node)
  // cycles that abort an in-flight drag. This was the silent killer.
  const combinedNodeRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    elRef.current = node;
  }, [setNodeRef]);

  // Pair resize: drag the handle to change the split. We read the parent row's
  // width live, compute the cursor-relative ratio, clamp to [0.25, 0.75], and
  // commit on release. Live preview uses direct DOM style writes for 60fps.
  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (!onSplitRatioChange || !pairPartnerId) return;
    e.preventDefault();
    e.stopPropagation();

    const handleEl = e.currentTarget as HTMLElement;
    const el = elRef.current;
    const rowEl = el?.parentElement as HTMLElement | null;
    const partnerEl = rowEl?.querySelector(`[data-space-id="${pairPartnerId}"]`) as HTMLDivElement | null;
    if (!el || !rowEl || !partnerEl) return;

    const pointerId = e.pointerId;
    try { handleEl.setPointerCapture(pointerId); } catch { /* best-effort */ }
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const MIN = 0.25, MAX = 0.75;
    let lastRatio = currentSplitRatio ?? 0.5;

    const onMove = (ev: PointerEvent) => {
      const rowRect = rowEl.getBoundingClientRect();
      if (rowRect.width <= 0) return;
      // Ratio = how far across the row the cursor sits (0 = full left, 1 = full right)
      const raw = (ev.clientX - rowRect.left) / rowRect.width;
      const next = Math.max(MIN, Math.min(MAX, raw));
      if (Math.abs(next - lastRatio) < 0.001) return;
      lastRatio = next;
      // Live preview — write directly so we don't thrash React per pixel
      rowEl.style.gridTemplateColumns = `${next}fr ${1 - next}fr`;
    };
    const onUp = () => {
      try { handleEl.releasePointerCapture(pointerId); } catch { /* already released */ }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizing(false);
      rowEl.style.gridTemplateColumns = '';  // let React take over again
      if (Math.abs(lastRatio - (currentSplitRatio ?? 0.5)) > 0.001) {
        onSplitRatioChange(lastRatio);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, [pairPartnerId, currentSplitRatio, onSplitRatioChange]);

  return (
    <div
      ref={combinedNodeRef}
      data-space-id={id}
      style={{
        // Always 'none' (see comment above the useSortable destructure
        // for the rationale). Drag source stays put with opacity 0.35;
        // DragOverlay handles the cursor-follower preview; drop
        // indicators (left/right/center bars) communicate where the
        // drop will land. Peers are NOT auto-shifted.
        transform: 'none',
        transition: resizing ? undefined : transition,
        opacity: isDragging ? 0.35 : 1,
        height: '100%',
        position: 'relative',
        minWidth: 0,  // let grid tracks shrink without forcing overflow
      }}
    >
      {children({ setActivatorNodeRef, listeners, attributes })}

      {/* Drop indicator: Notion-style preview of where the drop will land.
          - Vertical line on left/right = pair with this space on that side
          - Horizontal line on bottom   = new solo row after this space
          - Red overlay + dashed border = edge drop BLOCKED (target row full) */}
      {dropEdge === 'left' && !dropBlocked && (
        <div className="drop-indicator-pulse" style={{
          position: 'absolute', top: 2, bottom: 2, left: -5,
          width: 4, borderRadius: 2,
          background: 'var(--accent)',
          boxShadow: '0 0 14px var(--accent)',
          zIndex: 50, pointerEvents: 'none',
        }} />
      )}
      {dropEdge === 'right' && !dropBlocked && (
        <div className="drop-indicator-pulse" style={{
          position: 'absolute', top: 2, bottom: 2, right: -5,
          width: 4, borderRadius: 2,
          background: 'var(--accent)',
          boxShadow: '0 0 14px var(--accent)',
          zIndex: 50, pointerEvents: 'none',
        }} />
      )}
      {dropEdge === 'center' && (
        <div className="drop-indicator-pulse" style={{
          position: 'absolute', left: 2, right: 2, bottom: -5,
          height: 4, borderRadius: 2,
          background: 'var(--accent)',
          boxShadow: '0 0 14px var(--accent)',
          zIndex: 50, pointerEvents: 'none',
        }} />
      )}
      {/* Blocked indicator: dashed red overlay with 🚫 cursor hint. Shown when
          the user tries to left/right-drop onto a row that's already a pair. */}
      {dropBlocked && (dropEdge === 'left' || dropEdge === 'right') && (
        <div style={{
          position: 'absolute', inset: 0,
          border: '2px dashed #ef4444',
          borderRadius: 12,
          background: 'rgba(239, 68, 68, 0.08)',
          zIndex: 50, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#ef4444', color: '#fff',
            fontSize: 11, fontWeight: 600,
            padding: '4px 10px', borderRadius: 6,
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)',
          }}>
            이미 꽉 찬 행
          </div>
        </div>
      )}

      {/* Pair resize handle — only on the LEFT space of a pair. */}
      {pairPartnerId && onSplitRatioChange && (
        <div
          onPointerDown={handleResizePointerDown}
          title="드래그해서 페어 너비 비율 조절"
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

// ── Pair-based row model ────────────────────────────────────────────────────
// Every row is either SOLO (one space, full width) or PAIR (two spaces, widths
// summing to 1). Driven entirely by `pairedWithNext` / `splitRatio` on each
// Space — no column math, no greedy packing, no ResizeObserver. See the pair
// invariant in useAppData.enforcePairInvariant.
interface SpaceRow {
  leftSpace: Space;
  rightSpace?: Space;           // undefined → solo row
  leftRatio: number;            // left space's share of the row; 1 for solo, [0.25, 0.75] for pair
}

function computeRows(spaces: Space[]): SpaceRow[] {
  const rows: SpaceRow[] = [];
  let i = 0;
  while (i < spaces.length) {
    const cur = spaces[i];
    const next = spaces[i + 1];
    if (cur.pairedWithNext && next) {
      const ratio = Math.max(0.25, Math.min(0.75, cur.splitRatio ?? 0.5));
      rows.push({ leftSpace: cur, rightSpace: next, leftRatio: ratio });
      i += 2;
    } else {
      rows.push({ leftSpace: cur, leftRatio: 1 });
      i += 1;
    }
  }
  return rows;
}

// ── Pair-aware drag drop ────────────────────────────────────────────────────
// Given a source spaces array and a drop intent, return the new spaces array.
// All pair flags are expressed declaratively on a row model, then flattened —
// this avoids the "update-by-side-effect" traps of editing pairedWithNext on
// one space without touching its neighbor.
function applySpaceDrop(
  spaces: Space[],
  draggedId: string,
  targetId: string,
  edge: 'left' | 'right' | 'center' | null,
): Space[] | null {
  const dragged = spaces.find(s => s.id === draggedId);
  if (!dragged) return null;

  // Work with the row model so pairing is always a structural property, never
  // a stale bit on a space that happens to be next to the wrong neighbor.
  const rows = computeRows(spaces);

  // 1) Strip the dragged space from its current row.
  //    - If it was solo:       drop the row entirely.
  //    - If it was in a pair:  the partner becomes a solo row in place.
  const stripped: SpaceRow[] = [];
  for (const r of rows) {
    if (r.leftSpace.id === draggedId) {
      if (r.rightSpace) stripped.push({ leftSpace: r.rightSpace, leftRatio: 1 });
      // solo row with dragged → skip
    } else if (r.rightSpace?.id === draggedId) {
      stripped.push({ leftSpace: r.leftSpace, leftRatio: 1 });
    } else {
      stripped.push(r);
    }
  }

  // Strip any stale pair flag from the space we're moving — its new pair state
  // is determined entirely by the drop edge below.
  const cleanDragged: Space = { ...dragged, pairedWithNext: false, splitRatio: undefined };

  // 2) Locate the target row in the stripped model.
  const targetRowIdx = stripped.findIndex(r =>
    r.leftSpace.id === targetId || r.rightSpace?.id === targetId
  );
  if (targetRowIdx === -1) {
    // Target was the dragged itself (shouldn't happen — caller guards), or
    // the target id is stale / doesn't exist in the stripped model.
    //
    // CRITICAL: the dragged space has already been stripped from its row
    // (step 1). Without re-inserting it we'd silently delete the space —
    // this was the "drop into gray zone = space disappears" bug.
    //
    // Safe default: append the dragged as a new solo row at the end. The
    // user's intent couldn't be resolved, but no data is lost and the
    // visual reordering is predictable (same as dropping at the bottom).
    stripped.push({ leftSpace: cleanDragged, leftRatio: 1 });
    return flattenRows(stripped);
  }

  const targetRow = stripped[targetRowIdx];

  // 3) Apply the drop. We REPLACE the target's row with one-or-two new rows.
  const replacement: SpaceRow[] = (() => {
    // Center → dragged becomes a solo row AFTER the target's row (pair preserved)
    if (edge === 'center' || edge === null) {
      return [targetRow, { leftSpace: cleanDragged, leftRatio: 1 }];
    }

    // Left/right → pair dragged with the target space. If the target was already
    // in a pair, the other partner gets kicked out to a solo row BEFORE or AFTER
    // the new pair depending on which side was left alone.
    const targetIsLeft = targetRow.leftSpace.id === targetId;
    const otherInOldPair =
      targetRow.rightSpace && targetIsLeft ? targetRow.rightSpace :
      targetRow.rightSpace && !targetIsLeft ? targetRow.leftSpace :
      undefined;
    const targetSpace = targetIsLeft ? targetRow.leftSpace : targetRow.rightSpace!;

    const newPair: SpaceRow = edge === 'left'
      ? { leftSpace: cleanDragged, rightSpace: targetSpace, leftRatio: 0.5 }
      : { leftSpace: targetSpace, rightSpace: cleanDragged, leftRatio: 0.5 };

    if (!otherInOldPair) return [newPair];
    // Kicked-out partner keeps its visual position relative to target:
    //   target was LEFT, dropped RIGHT → partner was on the right, bump below
    //   target was RIGHT, dropped LEFT → partner was on the left, bump above
    const kickedRow: SpaceRow = { leftSpace: otherInOldPair, leftRatio: 1 };
    return targetIsLeft ? [newPair, kickedRow] : [kickedRow, newPair];
  })();

  const nextRows = [
    ...stripped.slice(0, targetRowIdx),
    ...replacement,
    ...stripped.slice(targetRowIdx + 1),
  ];
  return flattenRows(nextRows);
}

// Is this space currently sharing its row with another? True if the space is
// the LEFT of a pair (its own pairedWithNext) OR the RIGHT of one (the space
// immediately before has pairedWithNext).
function isSpaceInPair(spaces: Space[], id: string): boolean {
  const idx = spaces.findIndex(s => s.id === id);
  if (idx === -1) return false;
  if (spaces[idx].pairedWithNext && spaces[idx + 1]) return true;
  if (idx > 0 && spaces[idx - 1].pairedWithNext) return true;
  return false;
}

// Are these two spaces in the same pair row? Used to allow same-row reordering
// (which is a no-op, not a "block") without showing the forbidden indicator.
function isSameRowNeighbor(spaces: Space[], a: string, b: string): boolean {
  for (let i = 0; i < spaces.length - 1; i++) {
    if (spaces[i].pairedWithNext) {
      const leftId = spaces[i].id, rightId = spaces[i + 1].id;
      if ((leftId === a && rightId === b) || (leftId === b && rightId === a)) return true;
    }
  }
  return false;
}

// Flatten the row model back into a Space[] with correct pairedWithNext /
// splitRatio. Single source of truth for the array shape.
function flattenRows(rows: SpaceRow[]): Space[] {
  const out: Space[] = [];
  for (const row of rows) {
    if (row.rightSpace) {
      out.push({
        ...row.leftSpace,
        pairedWithNext: true,
        splitRatio: Math.max(0.25, Math.min(0.75, row.leftRatio)),
      });
      out.push({ ...row.rightSpace, pairedWithNext: false, splitRatio: undefined });
    } else {
      out.push({ ...row.leftSpace, pairedWithNext: false, splitRatio: undefined });
    }
  }
  return out;
}

// ── File drag-and-drop helper ──────────────────────────────────────────────
// Infers item type + display title from a file-system path using extension
// heuristic. v1.3.34: `'doc'` is now a first-class type — files whose
// extension matches the user's documentExtensions setting get tagged as
// docs instead of being collapsed into 'app'. `docExtensions` is passed
// in from the caller's settings (single source of truth — same list
// drives the cohort feature, ghost-card recommendations, clipboard
// classification, container slot picker).
//
// Resolution order:
//   .exe / .lnk     → app (executable)
//   .url            → url
//   no extension    → folder
//   docExtensions[] → doc
//   anything else   → app (default for unknown binaries)
function inferItemFromPath(filePath: string, docExtensions: string[]): { type: LauncherItem['type']; title: string } {
  const filename = filePath.replace(/\//g, '\\').split('\\').pop() ?? filePath;
  const ext = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? '';
  const type: LauncherItem['type'] =
    ext === 'exe' || ext === 'lnk' ? 'app' :
    ext === 'url'                  ? 'url' :
    !ext                           ? 'folder' :
    docExtensions.includes(ext)    ? 'doc' :
                                     'app';
  const title = ext
    ? filename.replace(new RegExp(`\\.${ext}$`, 'i'), '')
    : filename;
  return { type, title };
}

type DialogMode = 'none' | 'item' | 'scan' | 'settings' | 'wizard' | 'quickadd' | 'container-slots';

// Stable empty dismissal map — referenced by ghostCardsOptions when the
// user has no dismissals yet. A fresh `{}` per render would make the
// memoised options change reference every parent render.
const EMPTY_DISMISSALS: Record<string, { at: number; count: number }> = {};

export default function App() {
  bumpRender('App');
  const appLog = useMemo(() => createLogger('App'), []);
  appLog.debug('App() render');
  useEffect(() => { appLog.debug('App mounted (first useEffect)'); startPerfFlush(); }, [appLog]);
  const store = useAppData();
  const { data } = store;

  // ── Favicon migration (Option B) ─────────────────────────────
  // Older builds saved URL-typed item icons as the *remote* URL (e.g.
  // "https://www.google.com/s2/favicons?...") because the renderer-side
  // tryLoadImage loop ran in a CSP that only allowed Google's host. After
  // the switch to main-process fetch + data URL caching, those legacy
  // icons still render through the broken path. Fix them in the
  // background, once per session: scan items, fetch fresh data URLs in
  // parallel, then commit ALL conversions in ONE store write via
  // patchItems — calling store.updateItem in a loop would close over
  // stale `data` and let later writes silently overwrite earlier ones.
  const faviconMigratedRef = useRef(false);
  useEffect(() => {
    if (faviconMigratedRef.current) return;
    if (!data?.spaces?.length) return;
    faviconMigratedRef.current = true;

    type Job = { spaceId: string; itemId: string; value: string };
    const jobs: Job[] = [];
    for (const space of data.spaces) {
      for (const item of space.items ?? []) {
        if (item.iconType === 'image'
            && typeof item.icon === 'string'
            && /^https?:\/\//i.test(item.icon)
            && (item.type === 'url' || item.type === 'browser')) {
          jobs.push({ spaceId: space.id, itemId: item.id, value: item.value });
        }
      }
    }
    if (jobs.length === 0) return;
    appLog.info(`[favicon-migrate] ${jobs.length} legacy icon(s) to convert`);

    let cancelled = false;
    const patches: Array<{ spaceId: string; itemId: string; patch: { icon: string; iconType: 'image' } }> = [];
    let cursor = 0;
    const MAX_CONCURRENT = 4;

    const runWorker = async () => {
      while (!cancelled && cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          const dataUrl = await electronAPI.downloadFavicon(faviconCandidates(job.value));
          if (cancelled) return;
          if (dataUrl) {
            patches.push({ spaceId: job.spaceId, itemId: job.itemId, patch: { icon: dataUrl, iconType: 'image' } });
          }
        } catch (e) {
          appLog.warn('[favicon-migrate] job failed', { url: job.value, error: String(e) });
        }
      }
    };

    (async () => {
      const workers = Array.from({ length: Math.min(MAX_CONCURRENT, jobs.length) }, () => runWorker());
      await Promise.all(workers);
      if (cancelled || patches.length === 0) return;
      store.patchItems(patches);
      appLog.info(`[favicon-migrate] committed ${patches.length}/${jobs.length} icon(s)`);
    })();

    return () => { cancelled = true; };
    // The ref guard above ensures this body executes at most once per
    // session. Re-running the effect when `data.spaces` changes is fine
    // and cheap — we just bail on the ref check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.spaces]);

  // ── Entitlement (Phase 5) ────────────────────────────────────
  // Single source of truth for "is this user on Pro?". Every gate in the
  // tree calls this (or reads the memoised result via props). The modal
  // below is shown whenever a component triggers `openPaywall(reason)`.
  const entitlement = useEntitlement(data);
  const [paywall, setPaywall] = useState<{ open: boolean; reason: PaywallReason }>(
    { open: false, reason: 'generic' }
  );
  const openPaywall = useCallback((reason: PaywallReason = 'generic') => {
    setPaywall({ open: true, reason });
  }, []);
  const closePaywall = useCallback(() => setPaywall(p => ({ ...p, open: false })), []);

  // ── Onboarding (Phase 6) ─────────────────────────────────────
  // WelcomeWizard opens automatically the first time a fresh install lands
  // on a brand-new (default-seeded) preset, AND can be re-opened from the
  // EmptyState's "템플릿으로 시작" CTA at any time. Storage key is in
  // localStorage so we don't depend on the migrated AppData shape.
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  useEffect(() => {
    if (localStorage.getItem('nost-welcome-shown')) return;
    // Defer a tick so the loading overlay finishes its fade-out first.
    // We then gate on `whenIdle` — if the user is mid-drag, mid-edit, or
    // already has another modal up (rare on first launch but possible if
    // the import wizard auto-opened from a CLI flag), we wait to avoid
    // popping a second surface on top of the first.
    const fire = () => whenIdle(() => setWelcomeOpen(true), { timeoutMs: 30_000 });
    const t = setTimeout(fire, 600);
    return () => clearTimeout(t);
  }, []);

  const closeWelcome = useCallback(() => {
    setWelcomeOpen(false);
    localStorage.setItem('nost-welcome-shown', '1');
  }, []);
  // Import wizard — opened from Settings or the slash command /import.
  const [importOpen, setImportOpen] = useState(false);
  // applyTemplate / applyImport are defined further down once showToast is
  // in scope.

  // ── Tutorial sandbox ────────────────────────────────────────
  // While `tutorialActive` is true the live AppData is a TEMPORARY swap
  // — the user is poking around fake seed data so they can practice each
  // tour interactively. The real data lives in `tutorialSnapshotRef` and
  // also on disk at the path returned by `autoBackupData`. On exit we
  // either restore the snapshot (default) or merge any new spaces/badges
  // the user actually built (post-tour modal).
  //
  // The sandbox is intentionally NOT preset-scoped — most things the
  // tours teach (floating badges, search, etc.) are global. A 4th
  // hidden preset wouldn't isolate them. See sandbox.ts for the full
  // rationale.
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialBackupPath, setTutorialBackupPath] = useState<string | undefined>();
  const [sandboxExitOpen, setSandboxExitOpen] = useState(false);
  const tutorialSnapshotRef = useRef<AppData | null>(null);
  // Used by the SandboxExitModal copy ("스페이스 N개를 만드셨네요").
  const [sandboxNewCounts, setSandboxNewCounts] = useState({ spaces: 0, badges: 0 });

  // Forward declarations — defined further down once `data`, `store`, and
  // `showToast` are in scope. We wrap them in refs so the public-facing
  // listener for nost:start-tour can reach them without re-registering.
  const tourBridgeRef = useRef<{
    enterSandbox: (tourId: string) => Promise<void>;
    exitSandbox:  (mode: 'discard' | 'merge') => Promise<void>;
    requestExit:  () => void;
  } | null>(null);

  // ── Centralised quota checks (Phase 5) ───────────────────────
  // Every mutation that touches a limited resource (card, space, node, deck,
  // floating badge, preset switch, container toggle) funnels its pre-check
  // through these helpers. Returns `true` when the action is allowed; opens
  // the paywall modal and returns `false` otherwise. Callers then just guard:
  //     if (!checks.card()) return;
  //     store.addItem(...)
  const quotaChecks = useMemo(() => {
    const currentCardTotal = (data.spaces ?? []).reduce(
      (sum, s) => sum + (s.items ?? []).length, 0,
    );
    return {
      card: () => {
        if (entitlement.canAddCard(currentCardTotal)) return true;
        openPaywall('card-limit');
        return false;
      },
      space: () => {
        if (entitlement.canAddSpace(data.spaces.length)) return true;
        openPaywall('space-limit');
        return false;
      },
      node: () => {
        if (entitlement.canAddNode((data.nodeGroups ?? []).length)) return true;
        openPaywall('node-limit');
        return false;
      },
      deck: () => {
        if (entitlement.canAddDeck((data.decks ?? []).length)) return true;
        openPaywall('deck-limit');
        return false;
      },
      floatingBadge: () => {
        if (entitlement.canAddFloatingBadge((data.floatingBadges ?? []).length)) return true;
        openPaywall('floating-badge-limit');
        return false;
      },
      widget: () => {
        // Count widget cards across ALL spaces of the active preset.
        const widgetTotal = (data.spaces ?? []).reduce(
          (n, s) => n + (s.items ?? []).filter(it => it.type === 'widget').length, 0,
        );
        if (entitlement.canAddWidget(widgetTotal)) return true;
        openPaywall('widget-limit');
        return false;
      },
      preset: (id: '1' | '2' | '3') => {
        if (entitlement.canUsePreset(id)) return true;
        openPaywall('preset-lock');
        return false;
      },
      container: () => {
        if (entitlement.canUseContainer()) return true;
        openPaywall('container-lock');
        return false;
      },
    };
  }, [data.spaces, data.nodeGroups, data.decks, data.floatingBadges, entitlement, openPaywall]);

  // ── Floating badges (Phase 2) — subset that doesn't depend on late hooks ──
  // Main is the authoritative owner of floatingBadges — it reacts to overlay
  // drags/clicks and mutates electron-store directly. We mirror every push
  // into local React state so the UI (e.g. "already pinned" hint) stays live.
  // Listeners that need launchAndPosition / handleNodeGroupLaunch are
  // registered further down (see the second badge useEffect) once those
  // identifiers have been declared.
  // Register the badges-updated / badges-reveal-space listeners EXACTLY
  // ONCE for the lifetime of App. Earlier this effect had `[store]`
  // deps and no cleanup — `store` is a fresh object every render, so
  // each render added another ipcRenderer listener. After ~10 it
  // tripped Node's MaxListenersExceededWarning and main-process IPC
  // started fanning out to every accumulated handler simultaneously,
  // saturating the renderer event loop and causing the freeze users
  // hit when YouTube was playing (timeline events at 5–10 Hz × N
  // accumulated listeners = renderer "Not Responding").
  //
  // Same fix shape as the badge-launch listeners (v1.3.2): `[]` deps,
  // ref-based access to `store` so we always read the latest, and
  // unsubscribe via the new return value of preload's onBadges*.
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    const offUpdated = electronAPI.onBadgesUpdated((badges) => {
      storeRef.current.setFloatingBadgesLocal(badges ?? []);
    });
    const offReveal = electronAPI.onBadgesRevealSpace(({ refId }) => {
      const el = document.querySelector(`[data-space-id="${refId}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => { offUpdated(); offReveal(); };
  }, []);

  const floatingBadges = data.floatingBadges ?? [];
  const spacesFloating = useMemo(() => {
    const s = new Set<string>();
    for (const b of floatingBadges) if (b.refType === 'space') s.add(b.refId);
    return s;
  }, [floatingBadges]);
  const nodesFloating = useMemo(() => {
    const s = new Set<string>();
    for (const b of floatingBadges) if (b.refType === 'node') s.add(b.refId);
    return s;
  }, [floatingBadges]);
  const decksFloating = useMemo(() => {
    const s = new Set<string>();
    for (const b of floatingBadges) if (b.refType === 'deck') s.add(b.refId);
    return s;
  }, [floatingBadges]);

  const pinAsFloating = useCallback(async (
    refType: 'space' | 'node' | 'deck',
    refId: string,
  ) => {
    if (!quotaChecks.floatingBadge()) return;
    // Spawn the badge near the user's current pointer (in screen
    // coords) so it lands where they're looking, not at the primary
    // monitor's bottom-right by default. Falls back to undefined if
    // no recent pointer telemetry is available — main's handler
    // then uses its own default placement.
    //
    // Why screen coords (not page/window): main writes badge
    // positions in screen coords because the overlay window spans
    // the entire virtual desktop. Window-relative coords would land
    // at the wrong place once main translates them to overlay-local.
    const lastPtr = lastPointerScreenRef.current;
    const screenX = lastPtr ? lastPtr.x - 23 : undefined;  // -23 ≈ half a 46px badge
    const screenY = lastPtr ? lastPtr.y - 23 : undefined;
    const r = await electronAPI.pinBadge(refType, refId, screenX, screenY);
    if (!r.success) {
      const reason = r.reason === 'missing-ref' ? '잘못된 대상' : '플로팅 실패';
      showToast(reason);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotaChecks]);
  appLog.debug(`data.spaces.length=${data?.spaces?.length ?? 'undefined'}`);

  const [dialog, setDialog] = useState<DialogMode>('none');
  const [editItem, setEditItem] = useState<LauncherItem | null>(null);
  const [editSpaceId, setEditSpaceId] = useState<string>('');
  const [prefilledItem, setPrefilledItem] = useState<Partial<LauncherItem> | null>(null);
  // Memo (사라지는 메모) — currently-open editor target, or null when
  // no memo is being edited. Lives on App-level state so the editor
  // can render as a fixed overlay above the grid (inplace sheet, no
  // BrowserWindow). spaceId is captured at open-time so the lookup
  // remains correct even if the active preset changes mid-edit.
  const [editingMemoId, setEditingMemoId] = useState<{ spaceId: string; itemId: string } | null>(null);
  // Today-expiring banner dismissed for this session (per spec: closeable,
  // doesn't reappear today). Keyed by date so it auto-resets next day.
  const [bannerDismissedYmd, setBannerDismissedYmd] = useState<string | null>(null);
  const [memoTrashOpen, setMemoTrashOpen] = useState(false);
  // Bell-icon popover open state. Lives at App level so the bell button
  // (in the title bar) and the panel (rendered via portal) share the
  // same toggle. Click anywhere outside the panel closes it via the
  // backdrop in NotificationBell.
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);

  // Memoise the options object — the inner hook reads it via reference
  // checks, and a fresh `{}` every render forced re-derivation of every
  // useMemo / useCallback inside the hook on every parent render. The
  // `dismissals ?? {}` fallback in particular created a new empty object
  // each render and made the hook think the dismissals map "changed".
  const ghostCardsOptions = useMemo(() => ({
    spaces: data.spaces,
    dismissals: data.dismissals ?? EMPTY_DISMISSALS,
    documentExtensions: data.settings.documentExtensions,
    onDismiss: (value: string) => store.dismissSuggestion(value),
  }), [data.spaces, data.dismissals, data.settings.documentExtensions, store]);
  const ghostCards = useGhostCards(ghostCardsOptions);

  const [query, setQuery] = useState('');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [draggingSpaceId, setDraggingSpaceId] = useState<string | null>(null);
  // Notion-style drop zone: where in the target space the cursor currently sits.
  //   center  → vertical drop (dragged becomes a new solo row after target)
  //   left    → column-join on target's LEFT  (insert before target in the row)
  //   right   → column-join on target's RIGHT (insert after target in the row)
  // Drives the drop indicator UI and the branching in handleSpaceDragEnd.
  // `blocked` = the target's row is already a pair. Left/right drops on blocked
  // targets are disallowed (would require a 3-space row); we render a distinct
  // indicator and the drop becomes a no-op on release. Center drops are always
  // allowed because they create a new solo row below the target's pair.
  const [dragOverEdge, setDragOverEdge] = useState<{ overId: string; edge: 'left' | 'right' | 'center'; blocked?: boolean } | null>(null);

  // ── Container bloom state (drag-into-slot UX) ─────────────────
  // While the user drags a card and dwells over a container for
  // ~250ms, the container "blooms" — 4 directional drop zones fan out
  // around it. Drop on a zone = assign that slot. Drop anywhere else
  // = collapse bloom and continue normal drag flow.
  type BloomState = {
    containerSpaceId: string;
    containerId:     string;
    containerRect:   DOMRect;
    accent?:         string;
    hotDir:          BloomDir | null;
  };
  const [bloomState, setBloomState] = useState<BloomState | null>(null);
  // Pending dwell timer + the candidate it's watching, so we can cancel
  // when the user moves off the candidate before the bloom fires.
  const bloomCandidateRef = useRef<{ containerId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearBloomCandidate = useCallback(() => {
    if (bloomCandidateRef.current) {
      clearTimeout(bloomCandidateRef.current.timer);
      bloomCandidateRef.current = null;
    }
  }, []);
  const closeBloom = useCallback(() => {
    clearBloomCandidate();
    setBloomState(null);
  }, [clearBloomCandidate]);
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
  // The most recently added single card via ItemDialog. Used by the
  // post-save toast nudge — when the user clicks "꾸미기" the parent
  // re-opens the dialog on this exact item with advanced expanded.
  // A ref (not state) because we only consult it from a click handler;
  // no render needs to react to it.
  const lastAddedItemRef = useRef<{ spaceId: string; id: string } | null>(null);
  // Tutorial public API reached up from <TutorialProvider onApiReady>.
  // Threaded into SettingsDialog so the 튜토리얼 tab can start a quest.
  const tutorialApiRef = useRef<{ start: (q: import('./tutorial').Quest) => void; showResumePromptIfAny: () => void } | null>(null);
  // Wrapper around store.addSpace that publishes the space-added
  // tutorial trigger, surfaces a toast with undo, and rate-limits
  // creation so a stuck/repeated keypress (or accidental long-press
  // if a button ever auto-repeats) can't spawn dozens of empty
  // spaces in one tick. The 600 ms gap matches the OS auto-repeat
  // period plus a comfortable margin.
  // Toast is reached via a ref because it's declared further below;
  // same forward-decl pattern as `tourBridgeRef`.
  const lastSpaceAddRef = useRef(0);
  const showToastRef = useRef<((msg: string, opts?: Parameters<ReturnType<typeof useToastQueue>['showToast']>[1]) => void) | null>(null);
  const addSpaceWithTrigger = useCallback((name?: string) => {
    const now = Date.now();
    if (now - lastSpaceAddRef.current < 600) return;
    lastSpaceAddRef.current = now;
    const before = data.spaces.length;
    const created = store.addSpace(name);
    setTimeout(() => {
      tutorialTriggers.fire('space-added', { previousCount: before, spaceId: created.id });
    }, 0);
    pushUndo({
      description: `스페이스 "${created.name}" 추가`,
      undo: () => store.deleteSpace(created.id),
      redo: () => store.restoreSpace(created),
    });
    showToastRef.current?.(`스페이스 "${created.name}" 추가됨`, {
      actions: [
        { label: '실행취소', icon: 'undo', onClick: () => store.deleteSpace(created.id) },
      ],
      duration: 4000,
    });
  }, [data.spaces.length, store]);
  // Once on mount, after the provider has wired itself, prompt the
  // user to resume any quest they paused last session.
  useEffect(() => {
    const t = setTimeout(() => tutorialApiRef.current?.showResumePromptIfAny(), 1500);
    return () => clearTimeout(t);
  }, []);

  // ── Text-clipboard prompt ──────────────────────────────────
  // When the user copies free text outside the app, we surface a
  // small inline banner offering two destinations: a clipboard
  // text card (saves the literal string) or a memo (treats it as
  // long-form prose). Other clipboard types (url / app / folder /
  // hex) flow through ItemDialog's auto-detect → no banner needed.
  // Only "text" gets the banner because it's the one type with two
  // genuinely different commit paths.
  // ── Clipboard gateway prompt ─────────────────────────────────
  // ONE banner, every clipboard type. analyzeClipboard returns one
  // of { url | app | folder | hex | text | none } and we render
  // per-type chrome and per-type actions:
  //   - url       → URL 카드 (ItemDialog prefilled)
  //   - app       → 앱 카드  (ItemDialog prefilled)
  //   - folder    → 폴더 카드 (ItemDialog prefilled)
  //   - hex       → 컬러 위젯 (instant-create + open dialog for label)
  //   - text      → 클립보드 카드 / 메모 (two destinations)
  //
  // The gateway centralises "what does nost do when you copied X" —
  // before this rewrite each type was scattered across separate
  // banners, ItemDialog auto-detects, openQuickAdd hex specialcase,
  // etc. Now there's a single SSOT.
  type ClipPrompt = {
    // v1.3.34 — `'doc'` is a first-class kind; banner gets its own
    // copy/icon for it (see meta switch below).
    type: 'url' | 'app' | 'folder' | 'doc' | 'hex' | 'text';
    value: string;
    label: string;
    html?: string;
  };
  const [clipPrompt, setClipPrompt] = useState<ClipPrompt | null>(null);
  const lastClipValueRef = useRef('');
  const dismissedClipRef = useRef<Set<string>>(new Set());
  // Forward-ref to handleAddColorSwatch (declared later; TDZ would
  // otherwise prevent the hex handler below from referring to it).
  // Populated in an effect below the swatch declaration.
  const addColorSwatchRef = useRef<((spaceId: string, opts: { hex: string; name?: string }) => LauncherItem | null) | null>(null);
  const [itemDialogStartAdvanced, setItemDialogStartAdvanced] = useState(false);

  // Marks IDs as "just added" so ItemCard can trigger @keyframes cardEnter.
  // Defined early so it can be referenced by handleSaveItem (below) and handleBatchConfirm (further below).
  const markItemsAsNew = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
    setJustAddedItemIds(new Set(ids));
    justAddedTimerRef.current = setTimeout(() => setJustAddedItemIds(new Set()), 700);
  }, []);

  // ── Adaptive container ref (Phase 3) ─────────────────────
  // Pair-based layout doesn't need column counting — rows are either solo
  // (100% width) or pair (fraction split). We keep a ref on the container for
  // the drop-edge hit-test in onDragMove.
  const gridContainerRef = useRef<HTMLDivElement | null>(null);

  // ── CommandBar state ──────────────────────────────────────
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState('');

  const { tileOverlayGroup, tileOverlayLeaving, showTileOverlay, dismissTileOverlay } = useTileOverlay();
  const { toasts, showToast, dismissToast, pauseToast, resumeToast } = useToastQueue();
  // Wire forward-declared ref now that showToast exists.
  showToastRef.current = showToast;

  // Downgrade toast: Pro → Free 전환을 한 번만 안내.
  // 트리거 — 같은 세션 내에서 license expired / canceled, 또는 BETA flag flip
  // 후 entitlement.tier 가 'pro' → 'free' 로 바뀌는 순간. 첫 mount
  // (prev undefined) 는 의도적으로 무시 — 새 부팅 때마다 토스트 띄우면
  // 시끄러움. 데이터는 그대로 살아있다는 점도 명시해서 사용자 불안 줄임.
  const prevTierRef = useRef<typeof entitlement.tier | undefined>(undefined);
  useEffect(() => {
    const prev = prevTierRef.current;
    prevTierRef.current = entitlement.tier;
    if (prev === undefined) return;
    if (prev === 'pro' && entitlement.tier === 'free') {
      const reasonLabel =
        entitlement.notProReason === 'trial-expired' ? '체험 기간이 만료됐어요' :
        entitlement.notProReason === 'subscription-expired' ? 'Pro 결제 기간이 끝났어요' :
        entitlement.notProReason === 'canceled' ? 'Pro 구독이 해지됐어요' :
        'Pro 권한이 해제됐어요';
      showToast(`${reasonLabel} · 기존 카드는 그대로 살아있습니다. 추가 시 한도 안내가 떠요.`, {
        duration: 6000,
        actions: [{ label: '업그레이드', icon: 'auto_awesome', onClick: () => openPaywall('generic') }],
      });
    }
  }, [entitlement.tier, entitlement.notProReason, showToast, openPaywall]);

  // Phase 2 sync — manual model (user-explicit, 2026-05-14). On
  // signed-in we just register the read/apply callbacks with the sync
  // orchestrator; nothing fetches or pushes until the user clicks
  // "동기화하기" in 설정 → 계정. syncDataRef tracks the latest AppData
  // so syncFull() reads the current state at click time, not a stale
  // closure from sign-in.
  const auth = useAuth();
  const syncDataRef = useRef(data);
  useEffect(() => { syncDataRef.current = data; }, [data]);

  // Status-bar slider stays in sync with user-driven window drags.
  // Main derives a new pct from the resized bounds and pushes it here;
  // we patch settings.windowSizePct via replaceAll (NOT updateSettings,
  // which would echo back through setWindowSizePct IPC and re-resize
  // the window during the user's own drag).
  useEffect(() => {
    const off = electronAPI.onWindowSizePctChanged((pct) => {
      const cur = syncDataRef.current;
      if (cur.settings.windowSizePct === pct) return;
      store.replaceAll({ ...cur, settings: { ...cur.settings, windowSizePct: pct } });
    });
    return () => { off?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (auth.status !== 'signed-in' || !auth.user) return;
    initSync({
      userId: auth.user.id,
      getLocal: () => syncDataRef.current,
      applyMerged: (mergedData) => store.replaceAll(mergedData),
    });
    return () => { disposeSync(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, auth.user?.id]);

  // One-shot "로그인됐어요" toast on first mount after a signed-in
  // transition. The auth subscriber in lib/auth.ts drops a
  // `nost:auth-toast` flag into sessionStorage right when supabase
  // flips to signed-in; we pick it up the moment App mounts (which
  // happens immediately after, since AppShell renders App once
  // auth.status === 'signed-in'). sessionStorage rather than a
  // useAuth-watching effect because the *transition* — not the
  // *state* — is what we want to surface (a persisted session
  // shouldn't toast on every app open).
  useEffect(() => {
    let flag: string | null = null;
    try { flag = sessionStorage.getItem('nost:auth-toast'); } catch { /* */ }
    if (!flag) return;
    try { sessionStorage.removeItem('nost:auth-toast'); } catch { /* */ }
    if (flag.startsWith('signed-in:')) {
      const label = flag.slice('signed-in:'.length);
      showToast(`${label}로 로그인됐어요`, { duration: 2800 });
    }
  }, [showToast]);

  // App-level Ctrl+Z / Ctrl+Shift+Z. Yields to native browser undo
  // when focus is on an editable surface (input / textarea /
  // contenteditable) — typing inside a memo body still uses the
  // textarea's own history. Outside any editor, the shortcut walks
  // the action stack populated by registerUndo() callsites below.
  useGlobalUndoShortcut({
    onUndo: (desc) => showToast(`되돌렸어요 — ${desc}`, { duration: 2400 }),
    onRedo: (desc) => showToast(`다시 적용 — ${desc}`, { duration: 2400 }),
    onNothingToUndo: () => showToast('되돌릴 작업이 없어요', { duration: 1400 }),
    onNothingToRedo: () => showToast('다시 적용할 작업이 없어요', { duration: 1400 }),
  });

  // ── Onboarding — applyTemplate (post-toast) ─────────────────
  // Declared here (not at the top of the component) because it depends on
  // showToast which comes from useToastQueue above. It's the only thing in
  // the onboarding cluster that needs the toast system; everything else
  // (state, closeWelcome) lived in the earlier block.
  const applyTemplate = useCallback((template: Template, alsoStartTour: boolean) => {
    const newSpaces = template.build();
    // reorderSpaces is the safest public API for a wholesale replacement —
    // it goes through the save() shim, so the active preset's spaces are
    // swapped atomically and persisted.
    store.reorderSpaces(newSpaces);
    setWelcomeOpen(false);
    localStorage.setItem('nost-welcome-shown', '1');
    if (alsoStartTour) {
      // Defer one tick so the wizard's exit animation finishes before the
      // tour spotlight starts hunting for its target.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('nost:start-tour', { detail: { tourId: 'presets' } }));
      }, 300);
    }
    showToast(`${template.label} 시작 키트를 적용했어요`);
  }, [store, showToast]);

  /**
   * Apply an import payload from the ImportWizard. Two shapes:
   *   - kind='spaces' + strategy='replace'  → reorderSpaces with the import
   *   - kind='spaces' + strategy='merge'    → reorderSpaces with [...current, ...import]
   *   - kind='full-restore'                  → wholesale AppData replacement via reload
   */
  const applyImport = useCallback((payload:
    | { kind: 'spaces'; spaces: import('./types').Space[]; strategy: 'merge' | 'replace' }
    | { kind: 'full-restore'; data: unknown }
  ) => {
    if (payload.kind === 'full-restore') {
      // .nost full restore — write the raw blob via electronAPI.storeSave
      // and then make the renderer pull it back in.
      electronAPI.storeSave(payload.data as Parameters<typeof electronAPI.storeSave>[0]).then(() => {
        store.reloadFromStore();
        showToast('백업 복원 완료');
      });
      return;
    }
    const next = payload.strategy === 'replace'
      ? payload.spaces
      : [...data.spaces, ...payload.spaces];
    store.reorderSpaces(next);
    const word = payload.strategy === 'replace' ? '대체' : '병합';
    const cardCount = payload.spaces.reduce((s, sp) => s + sp.items.length, 0);
    showToast(`${cardCount}개 카드 ${word}됨`);
  }, [data.spaces, store, showToast]);

  // ── Tutorial sandbox — enter / exit handlers ──────────────────
  //
  // enterSandbox: snapshot the live data, drop a disk backup as belt-and-
  // braces, swap AppData with seed content, then dispatch the actual tour
  // start event so TourOverlay opens against the seeded data (and not the
  // stale real data).
  //
  // exitSandbox: either restore the snapshot (discard) or merge any new
  // sandbox spaces/badges into the original (merge), then write that back
  // and reload from store. Always closes the modal and clears the active
  // flag, even on error — leaving `tutorialActive=true` after a failed
  // restore would strand the banner on screen.
  const enterSandbox = useCallback(async (tourId: string) => {
    if (tutorialActive) {
      // Already in sandbox — just re-fire the tour without re-swapping.
      window.dispatchEvent(new CustomEvent('nost:start-tour-now', { detail: { tourId } }));
      return;
    }
    // 1) Disk backup first. If this fails we abort — the user explicitly
    //    asked for a safety net and we don't proceed without it.
    let backupPath: string | undefined;
    try {
      const res = await electronAPI.autoBackupData(SANDBOX_BACKUP_TAG);
      if (res.success) backupPath = res.filePath;
      else { showToast('백업 실패 — 튜토리얼을 시작하지 않습니다'); return; }
    } catch (e) {
      showToast(`백업 실패 (${String(e).slice(0, 60)}) — 튜토리얼을 시작하지 않습니다`);
      return;
    }

    // 2) Snapshot in memory. JSON round-trip — see sandbox.ts.
    tutorialSnapshotRef.current = snapshotData(data);
    setTutorialBackupPath(backupPath);

    // 3) Swap to seed and reload the renderer's view of it.
    const seed = buildSandboxSeed(tourId, data);
    try {
      await electronAPI.storeSave(seed as Parameters<typeof electronAPI.storeSave>[0]);
      await store.reloadFromStore();
    } catch (e) {
      // Seed swap failed — best effort restore from snapshot, abort tour.
      try {
        if (tutorialSnapshotRef.current) {
          await electronAPI.storeSave(tutorialSnapshotRef.current as Parameters<typeof electronAPI.storeSave>[0]);
          await store.reloadFromStore();
        }
      } catch { /* nothing more we can do */ }
      tutorialSnapshotRef.current = null;
      setTutorialBackupPath(undefined);
      showToast(`튜토리얼 시작 실패 (${String(e).slice(0, 60)})`);
      return;
    }

    setTutorialActive(true);
    // 4) Tell TourOverlay to start. Defer one microtask so the data flush
    //    completes a render before the spotlight queries the DOM.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('nost:start-tour-now', { detail: { tourId } }));
    }, 0);
  }, [data, store, showToast, tutorialActive]);

  const exitSandbox = useCallback(async (mode: 'discard' | 'merge') => {
    const snap = tutorialSnapshotRef.current;
    setSandboxExitOpen(false);
    if (!snap) {
      // Defensive — the modal should never open without a snapshot, but if
      // it somehow did just clear the flag and bail.
      setTutorialActive(false);
      setTutorialBackupPath(undefined);
      return;
    }
    const target = mode === 'merge' ? mergeSandboxBack(snap, data) : snap;
    try {
      await electronAPI.storeSave(target as Parameters<typeof electronAPI.storeSave>[0]);
      await store.reloadFromStore();
      showToast(mode === 'merge' ? '튜토리얼에서 만든 항목을 가져왔어요' : '원래 데이터로 복원했습니다');
    } catch (e) {
      showToast(`복원 실패 (${String(e).slice(0, 60)}). 백업 파일을 직접 import 해주세요.`);
    } finally {
      tutorialSnapshotRef.current = null;
      setTutorialBackupPath(undefined);
      setTutorialActive(false);
      setSandboxNewCounts({ spaces: 0, badges: 0 });
    }
  }, [data, store, showToast]);

  const requestSandboxExit = useCallback(() => {
    // Compute new spaces / badges so the modal copy can be specific.
    const snap = tutorialSnapshotRef.current;
    if (!snap) {
      // No snapshot ⇒ wasn't sandboxed, don't show modal.
      setTutorialActive(false);
      return;
    }
    const oldSpaceIds = new Set(snap.spaces.map(s => s.id));
    const oldBadgeIds = new Set((snap.floatingBadges ?? []).map(b => b.id));
    const newSpaces = data.spaces.filter(s => !oldSpaceIds.has(s.id)).length;
    const newBadges = (data.floatingBadges ?? []).filter(b => !oldBadgeIds.has(b.id)).length;
    setSandboxNewCounts({ spaces: newSpaces, badges: newBadges });
    setSandboxExitOpen(true);
  }, [data]);

  // Mirror the latest handlers into the ref so the start-tour bridge
  // listener (registered once with `[]` deps) can reach the live closures
  // without forcing every dispatch caller to know about App's internals.
  tourBridgeRef.current = {
    enterSandbox,
    exitSandbox,
    requestExit: requestSandboxExit,
  };

  // Public start-tour bridge.
  //
  // All callers (CommandBar, EmptyState, SettingsDialog, WelcomeWizard)
  // dispatch `nost:start-tour { tourId }`. We catch it here and decide
  // whether to enter the sandbox first or pass through. TourOverlay
  // listens to `nost:start-tour-now`, which we dispatch after sandbox
  // setup completes (or immediately for non-interactive tours).
  useEffect(() => {
    const onRequest = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const tourId: string = detail.tourId ?? 'basics';
      const tour = findTour(tourId);
      if (tour?.interactive) {
        tourBridgeRef.current?.enterSandbox(tourId);
      } else {
        // Pass-through. TourOverlay's listener handles it.
        window.dispatchEvent(new CustomEvent('nost:start-tour-now', { detail: { tourId } }));
      }
    };
    window.addEventListener('nost:start-tour', onRequest);
    return () => window.removeEventListener('nost:start-tour', onRequest);
  }, []);

  const { launchAndPosition } = useLaunchPipeline({ showToast, dismissToast });

  // ── Mode / Node / Deck state ──────────────────────────────
  const {
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
  } = useNodeDeckMode({ data, store, showToast, dismissToast, showTileOverlay });

  // Click router for `activeMode === 'node'`. The single context action
  // `onNodeModeClick` doesn't know whether we're building new vs. editing
  // existing — that decision lives here where all state is in scope.
  // Without this, B mode would route through handleNodeBuildingClick and
  // mutate the staging array instead of the live group.
  const handleNodeModeClick = useCallback((itemId: string) => {
    if (editingNodeGroupId) {
      handleNodeEditClick(itemId);
    } else {
      handleNodeBuildingClick(itemId);
    }
  }, [editingNodeGroupId, handleNodeEditClick, handleNodeBuildingClick]);

  // ── Floating badges (Phase 2) — late listeners ─────────────
  //
  // CRITICAL: register the IPC listeners EXACTLY ONCE, not on every dep
  // change. The previous version had `[data.spaces, ...]` deps with no
  // cleanup, so each render added a new ipcRenderer.on listener while old
  // ones remained alive. After N data updates a single mini-window click
  // fired N launches — the user reported "50–60 windows pop up." Worse,
  // the click pipeline itself bumps clickCount → mutates data.spaces →
  // triggers another effect run → adds yet another listener, so the
  // count grows geometrically with use.
  //
  // Fix is two parts:
  //   1. preload's onBadges* now returns an unsubscribe function we call
  //      from cleanup.
  //   2. The listener body reads the latest closure values via a ref so
  //      we never need to re-register. `[]` deps = exactly one
  //      registration for the lifetime of App.
  const badgeLaunchRef = useRef({
    spaces: data.spaces,
    closeAfterOpen: data.settings.closeAfterOpen,
    launchAndPosition,
    handleNodeGroupLaunch,
    handleDeckLaunch,
    store,
    openMemoEditor: (sid: string, iid: string) => setEditingMemoId({ spaceId: sid, itemId: iid }),
  });
  badgeLaunchRef.current = {
    spaces: data.spaces,
    closeAfterOpen: data.settings.closeAfterOpen,
    launchAndPosition,
    handleNodeGroupLaunch,
    handleDeckLaunch,
    store,
    openMemoEditor: (sid: string, iid: string) => setEditingMemoId({ spaceId: sid, itemId: iid }),
  };

  useEffect(() => {
    const offItem = electronAPI.onBadgesLaunchItem(({ refType, refId, itemId }) => {
      const r = badgeLaunchRef.current;
      let item: LauncherItem | undefined;
      let ownerSpaceId: string | undefined;
      if (refType === 'space') {
        const sp = r.spaces.find(s => s.id === refId);
        item = sp?.items.find(i => i.id === itemId);
        ownerSpaceId = sp?.id;
      } else {
        // node / deck — items may live in any space; find the owner for
        // click-count bookkeeping.
        for (const sp of r.spaces) {
          const f = sp.items.find(i => i.id === itemId);
          if (f) { item = f; ownerSpaceId = sp.id; break; }
        }
      }
      if (item && ownerSpaceId) {
        // Memo cards "launch" by opening the editor — they have
        // no executable target. Mirrors the same guard inside
        // launchItem (in-app card click); the badge path bypasses
        // launchItem and goes straight to launchAndPosition,
        // which would have done nothing for a memo.
        if (item.type === 'memo') {
          r.openMemoEditor(ownerSpaceId, itemId);
          return;
        }
        r.launchAndPosition(item, r.closeAfterOpen);
        r.store.incrementClickCount(ownerSpaceId, itemId);
      }
    });
    const offRef = electronAPI.onBadgesLaunchRef(async ({ refType, refId }) => {
      const r = badgeLaunchRef.current;
      try {
        if (refType === 'node') await r.handleNodeGroupLaunch(refId);
        else if (refType === 'deck') await r.handleDeckLaunch(refId);
      } finally {
        // Tell the badge overlay the launch resolved (success or fail)
        // so the spinner ring stops without waiting on its safety
        // timeout. We await above so this fires AFTER launchItemsForTile
        // and runTilePs/deckLaunch settle, which is the right semantic
        // for "we're done working on this group".
        try { electronAPI.notifyBadgesLaunchDone({ refType, refId }); } catch { /* preload may be absent in tests */ }
      }
    });
    return () => { offItem(); offRef(); };
  }, []);


  // ── Toast notification — FIFO queue (non-overlapping) ────

  // ── Monitor tracking ─────────────────────────────────────
  // Two derived values from the same source — both surface to the
  // UI: `monitorCount` (cheap integer, used by every card for
  // count-based gating) and `monitors` (full layout info, consumed
  // by the new MonitorPicker for proportional rendering). Keeping
  // them split lets the cheap consumers skip re-renders when the
  // (rarely-changing) layout updates.
  const [monitorCount, setMonitorCount] = useState(1);
  const [monitors, setMonitors] = useState<Array<{ index: number; id: number; isPrimary: boolean; bounds: { x: number; y: number; width: number; height: number } }>>([]);
  useEffect(() => {
    electronAPI.getMonitors().then(ms => {
      if (ms.length > 0) {
        setMonitorCount(ms.length);
        setMonitors(ms);
      }
    });
    electronAPI.onMonitorsChanged(next => {
      if (next.length > 0) {
        setMonitorCount(next.length);
        setMonitors(next);
      }
    });
  }, []);

  // Tracks the user's most recent pointer position in SCREEN coords
  // (window x/y + clientX/y, then converted by main when needed).
  // pinAsFloating reads this so a freshly-promoted badge lands near
  // where the user clicked, not at the primary monitor's bottom-
  // right corner default. Throttled-ish via a single mousemove
  // listener — the cost is one int pair per move event.
  const lastPointerScreenRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // e.screenX/Y on Windows can return physical pixels under
      // fractional DPI scaling, but Electron normalises to DIP for
      // the window's own webContents. We use it as-is here since
      // main's badge code stores in DIP screen coords too.
      lastPointerScreenRef.current = { x: e.screenX, y: e.screenY };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  // ── Clipboard polling ──────────────────────────────────────
  // Single gateway: every non-'none' type becomes a clipPrompt.
  // The banner (rendered below) branches on `type` for chrome
  // and actions. Re-checks on window focus + 1.5 s interval to
  // catch external copies while nost stays focused.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const r = await electronAPI.analyzeClipboard(getDocumentExtensions(data.settings.documentExtensions));
      if (cancelled) return;
      if (r.type === 'none' || !r.value) return;
      if (r.value === lastClipValueRef.current) return;
      if (dismissedClipRef.current.has(r.value)) return;
      lastClipValueRef.current = r.value;
      setClipPrompt({
        type: r.type as ClipPrompt['type'],
        value: r.value,
        label: r.label ?? r.value,
        // html is only present (and only useful) for type==='text'
        // — used to reconstruct markdown when the source had
        // structural markup (GPT / Notion / Claude paste).
        html: r.type === 'text' ? r.html : undefined,
      });
    };
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    void check();
    const intervalId = window.setInterval(() => {
      if (!document.hidden) void check();
    }, 1500);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Convert a non-text prompt (url / app / folder / text-as-card)
   *  into a prefilled ItemDialog open. The dialog's allowedTypes
   *  is implicit via the prefill type — caller doesn't need to
   *  duplicate the type-narrowing logic here. */
  const handleClipPromptToCard = useCallback(() => {
    if (!clipPrompt) return;
    const { type, value, label } = clipPrompt;
    dismissedClipRef.current.add(value);
    setClipPrompt(null);
    setEditItem(null);
    setPrefilledItem({ type, value, title: label } as Partial<LauncherItem>);
    setEditSpaceId(data.spaces[0]?.id ?? '');
    setDialog('item');
  }, [clipPrompt, data.spaces]);

  /** Hex prompt → instant color-swatch widget creation in the
   *  first space, then the dialog opens on the new item so the
   *  user can label it (matches openQuickAdd's existing hex flow). */
  const handleClipPromptToColorSwatch = useCallback(() => {
    if (!clipPrompt || clipPrompt.type !== 'hex') return;
    const { value } = clipPrompt;
    dismissedClipRef.current.add(value);
    setClipPrompt(null);
    const target = data.spaces[0]?.id;
    if (!target) return;
    const newItem = addColorSwatchRef.current?.(target, { hex: value }) ?? null;
    if (newItem) {
      setEditItem(newItem);
      setEditSpaceId(target);
      setDialog('item');
    }
  }, [clipPrompt, data.spaces]);

  /** Text prompt → memo (only for type==='text'). HTML twin (when
   *  present) is converted to proper markdown so a paste from
   *  GPT / Notion lands as `## ` / `**` / `- ` instead of a flat
   *  blob. Plain text saves verbatim. */
  const handleClipPromptToMemo = useCallback(() => {
    if (!clipPrompt || clipPrompt.type !== 'text') return;
    const { value, html } = clipPrompt;
    const targetSpaceId = data.spaces[0]?.id;
    dismissedClipRef.current.add(value);
    setClipPrompt(null);
    if (!targetSpaceId) return;
    let body = value;
    if (html && htmlHasStructure(html)) {
      const converted = htmlToMarkdown(html).trim();
      if (converted) body = converted;
    }
    const newItem = store.addMemo(targetSpaceId, body);
    if (newItem) tutorialTriggers.fire('memo-created', { itemId: newItem.id, spaceId: targetSpaceId, fromClipboard: true });
    if (newItem) {
      // Clipboard → memo also belongs in the undo stack. Ctrl+Z
      // should rewind every kind of card creation symmetrically.
      pushUndo({
        description: '메모 추가 (클립보드)',
        undo: () => store.deleteItem(targetSpaceId, newItem.id),
        redo: () => store.restoreItem(targetSpaceId, newItem),
      });
      // Use the in-house toast queue (same chrome as every other
      // app toast) — sonner had a different look + position which
      // the user flagged as off-brand.
      showToast(`메모로 저장됨 · ${data.spaces[0].name}`, {
        actions: [{
          label: '열기',
          icon: 'open_in_new',
          onClick: () => setEditingMemoId({ spaceId: targetSpaceId, itemId: newItem.id }),
        }],
        duration: 4000,
      });
    }
  }, [clipPrompt, data.spaces, store, showToast]);

  const handleClipPromptDismiss = useCallback(() => {
    if (clipPrompt) {
      dismissedClipRef.current.add(clipPrompt.value);
      tutorialTriggers.fire('gateway-banner-dismissed', { type: clipPrompt.type });
    }
    setClipPrompt(null);
  }, [clipPrompt]);

  // ── Extension connection tracking (v1.3.33 — calm-by-default) ─────
  //
  // The Chrome service worker is suspended whenever the browser window
  // doesn't have focus, which means our SSE bridge appears "offline"
  // most of the time even when the user has everything correctly set
  // up. Showing a noisy "확장이 연결되지 않았어요" notification on every
  // sleep cycle drove users crazy.
  //
  // SSOT decision (per AppSettings.extensionEverConnected):
  //   • EVER connected → trust the install. Silent during disconnects;
  //     the bridge will wake up the moment the user actually uses the
  //     browser. We only re-surface a notification at the **use-site**
  //     (smart scan finds no tabs, browser-tab card launch reports no
  //     bridge) via notifyExtensionRequiredAtUseSite().
  //   • NEVER connected → after the 40 s grace window, fire ONE
  //     tip-kind notification suggesting install. Tip kind means it
  //     stays calm in the bell without a system-error color.
  //
  // Live polling continues in the background so the indicator badge in
  // Settings reflects current state, but it never pushes notifications
  // on its own once everConnected is true.
  type ExtState = 'init' | 'connected' | 'never-seen' | 'previously-offline';
  const [extState, setExtState] = useState<ExtState>('init');
  const everConnected = data.settings.extensionEverConnected === true;

  // Probe loop: 4 s during the initial 40 s grace, then 15 s steady-state.
  // The renderer-only state stays in sync for the Settings indicator;
  // store.markExtensionConnected() persists the latch the first time.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const probe = async () => {
      const s = await electronAPI.getExtensionBridgeStatus();
      if (cancelled) return;
      const live = s.connected || s.tabsCount > 0 || s.lastExtensionConnectedAt > 0;
      if (live) {
        setExtState('connected');
        // Latch the persistent "ever seen" flag on first connect — idempotent.
        if (!everConnected) store.markExtensionConnected();
        // Whatever notifications the old logic left behind, clear them.
        store.dismissNotificationByDedupKey('ext-disconnected');
        store.dismissNotificationByDedupKey('ext-install-nudge');
        store.dismissNotificationByDedupKey('ext-needed-now');
        return;
      }
      // Offline path — branch on whether we've ever seen it work.
      if (everConnected) {
        setExtState('previously-offline');
      } else if (attempts >= 10) {
        setExtState('never-seen');
      }
      // else stay 'init' until grace exhausted
    };

    // Kick the first probe immediately, then on a tightening cadence.
    void probe();
    intervalId = setInterval(() => {
      attempts++;
      void probe();
      if (attempts === 10 && intervalId) {
        // Switch from 4 s grace cadence to 15 s steady-state.
        clearInterval(intervalId);
        intervalId = setInterval(() => { void probe(); }, 15_000);
      }
    }, 4_000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everConnected]);

  // Notification rules — fires ONLY on state transitions into
  // 'never-seen' (initial install needs help). 'previously-offline' is
  // intentionally silent; use-site failures handle that case.
  useEffect(() => {
    if (extState === 'never-seen') {
      store.addNotification({
        kind: 'tip',
        title: '브라우저 확장을 설치해보세요',
        body: 'Chrome 확장을 깔면 브라우저 탭 스캔과 분할 배치를 쓸 수 있어요.',
        action: { label: '설치 안내', intent: 'open-settings', payload: 'extension' },
        dedupKey: 'ext-install-nudge',
      });
    } else if (extState === 'connected') {
      store.dismissNotificationByDedupKey('ext-install-nudge');
      store.dismissNotificationByDedupKey('ext-needed-now');
    }
    // 'previously-offline' → no-op. The user knows; Chrome is just sleeping.
  }, [extState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stale update-notification sweep (boot once) ───────────────────
  // After install + restart, the notification "v1.3.X 설치 준비 완료"
  // can persist in the bell even though the user IS now on v1.3.X.
  // On boot, scan for any 'update-available-<version>' dedup-keys
  // whose version is ≤ our current __APP_VERSION__ and dismiss them.
  // The dedup-key naming is locked into our convention — see
  // onUpdateAvailable / onUpdateDownloaded handlers below.
  useEffect(() => {
    const current = __APP_VERSION__;
    const parseSemver = (v: string): [number, number, number] | null => {
      const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
      return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
    };
    const cmpSemver = (a: string, b: string): number => {
      const pa = parseSemver(a), pb = parseSemver(b);
      if (!pa || !pb) return 0;
      for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
      }
      return 0;
    };
    for (const n of store.notifications) {
      if (n.dismissedAt) continue;
      const m = n.dedupKey?.match(/^update-available-(.+)$/);
      if (!m) continue;
      // Dismiss any notification whose version is ≤ the running app —
      // either we just installed it (was equal) or we leapfrogged past
      // it (was older).
      if (cmpSemver(m[1], current) <= 0) {
        store.dismissNotification(n.id);
      }
    }
    // Run once on mount; `store.notifications` mutations after this
    // come from live updater events which set fresh notifications for
    // versions > current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Use-site failure hook — called by features that *expect* the
  // extension to be live (smart scan, browser-tab card launch). Fires
  // an actionable notification only when the extension is missing AT
  // THE MOMENT the user reaches for it. dedupKey is shared so repeated
  // use-site failures don't pile up rows.
  // Exposed via AppActions for ScanDialog / useLaunchPipeline.
  const notifyExtensionRequiredAtUseSite = useCallback((feature: string) => {
    if (extState === 'connected') return; // it works — nothing to nudge about
    store.addNotification({
      kind: 'tip',
      title: '확장이 깨어있지 않아요',
      body: everConnected
        ? `Chrome 창에 포커스를 한 번 주면 확장이 다시 깨어납니다 (${feature}).`
        : `Chrome 확장을 먼저 설치하면 ${feature}을 쓸 수 있어요.`,
      action: { label: everConnected ? '다시 시도' : '설치 안내', intent: 'open-settings', payload: 'extension' },
      dedupKey: 'ext-needed-now',
    });
  }, [extState, everConnected, store]);

  // ── Settings initial tab ──────────────────────────────────
  // v1.3.34: SettingsDialog reorganised into 4 groups × 2–3 sub-tabs
  // (Option C). New tab ids are appearance/behavior/surfaces/memo/docs/
  // tutorial/extension/account/data. Legacy callers using 'general' or
  // 'monitor' still work — SettingsDialog's remapLegacyTab() funnels them
  // to the right new home — so this union accepts BOTH old and new names.
  type SettingsTab =
    | 'general' | 'monitor'                        // legacy aliases
    | 'appearance' | 'behavior' | 'surfaces'
    | 'memo' | 'docs' | 'tutorial'
    | 'extension' | 'account' | 'data';
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
  const openSettingsTab = (tab: SettingsTab) => {
    setSettingsInitialTab(tab);
    setDialog('settings');
  };

  // Listen for `nost:open-settings` custom events from anywhere in the
  // tree (e.g. StatusBar's AuthChip → 계정 tab). Decouples the chip
  // from App's dialog state without prop-drilling through StatusBar.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tab?: 'general' | 'monitor' | 'docs' | 'extension' | 'data' | 'account' } | undefined;
      openSettingsTab(detail?.tab ?? 'general');
    };
    window.addEventListener('nost:open-settings', handler);
    return () => window.removeEventListener('nost:open-settings', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Inactive window tracking ──────────────────────────────
  // Stale closures are fine here — we read data.spaces via a ref at tick
  // time. The OLD pattern had `useCallback([data.spaces])` + `useEffect
  // ([checkWindowsNow])`, which meant every spaces mutation rebuilt the
  // function and reset the 15-s interval (and re-fired the check). On a
  // launcher that mutates `spaces` constantly (drag, click count, etc),
  // that thrashed the renderer for no benefit. New shape: one mount-time
  // setInterval, fresh data via ref, bail when there's nothing to check.
  const [inactiveWindowIds, setInactiveWindowIds] = useState<Set<string>>(new Set());
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const tick = async () => {
      const spaces = dataRef.current?.spaces ?? [];
      const windowItems = spaces.flatMap(s => s.items).filter(i => i.type === 'window');
      if (!windowItems.length) {
        // Only fire setState when the dead-set was actually non-empty —
        // avoids gratuitous re-renders when the user has zero window
        // cards (the common case).
        setInactiveWindowIds(prev => prev.size === 0 ? prev : new Set());
        return;
      }
      const titles = [...new Set(windowItems.map(i => i.value))];
      const aliveMap = await electronAPI.checkWindowsAlive(titles);
      const deadIds = new Set<string>();
      for (const item of windowItems) {
        if (!aliveMap[item.value]) deadIds.add(item.id);
      }
      // Same dead set? skip the setState. This is the dominant case in
      // steady state — without this the 15-s tick produces a render every
      // tick even when nothing changed.
      setInactiveWindowIds(prev => {
        if (prev.size !== deadIds.size) return deadIds;
        for (const id of deadIds) if (!prev.has(id)) return deadIds;
        return prev;
      });
    };
    tick();
    const timer = setInterval(tick, 15000);
    return () => clearInterval(timer);
  }, []);

  // Manual refresh callable used by the inactive-window toast's
  // "새로고침" action. Kept as a useCallback so changing
  // identity doesn't matter for any effect (no effect depends on it).
  const checkWindowsNow = useCallback(async () => {
    const spaces = dataRef.current?.spaces ?? [];
    const windowItems = spaces.flatMap(s => s.items).filter(i => i.type === 'window');
    if (!windowItems.length) {
      setInactiveWindowIds(prev => prev.size === 0 ? prev : new Set());
      return;
    }
    const titles = [...new Set(windowItems.map(i => i.value))];
    const aliveMap = await electronAPI.checkWindowsAlive(titles);
    const deadIds = new Set<string>();
    for (const item of windowItems) {
      if (!aliveMap[item.value]) deadIds.add(item.id);
    }
    setInactiveWindowIds(prev => {
      if (prev.size !== deadIds.size) return deadIds;
      for (const id of deadIds) if (!prev.has(id)) return deadIds;
      return prev;
    });
  }, []);

  // ── Theme sync to <html> ──────────────────────────────────
  useEffect(() => {
    // Ghost card mode → force fully opaque so cards are visible
    const target = ghostCards.active ? 1 : data.settings.opacity;
    electronAPI.setOpacity(target);
    // CSS-side: the frosted-glass background uses rgba(_, _, _, 0.95~0.96)
    // by default. setOpacity alone leaves that 4-5% transparency baked
    // into the surface, so at "100%" the desktop still bleeds through.
    // When the user dials to 100% we override --bg-rgba to a fully
    // opaque value so the window reads as truly solid. Below 100% we
    // restore the default (let the stylesheet rule apply).
    const root = document.documentElement;
    if (target >= 0.999) root.style.setProperty('--bg-rgba', data.settings.theme === 'dark' ? 'rgb(5, 5, 8)' : 'rgb(255, 255, 255)');
    else root.style.removeProperty('--bg-rgba');
  }, [data.settings.opacity, data.settings.theme, ghostCards.active]);

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
    document.body.classList.remove('mode-pin', 'mode-node', 'mode-deck', 'mode-clean', 'mode-tool');

    if (activeMode === 'pin')   document.body.classList.add('mode-pin',   'mode-tool');
    if (activeMode === 'node')  document.body.classList.add('mode-node',  'mode-tool');
    if (activeMode === 'deck')  document.body.classList.add('mode-deck',  'mode-tool');
    if (activeMode === 'clean') document.body.classList.add('mode-clean', 'mode-tool');

    // Cursor visuals are owned by index.css via the body.mode-* classes —
    // arrow + colored badge with a mode icon. We used to inject a JS-built
    // cursor here, but that duplicated and overrode the CSS rules, defeating
    // the established arrow+badge design. Body class handling below is enough.

    // Clean mode steals window focus on every card click (the deletion
    // dialog is OS-level), which would trigger autoHide and dismiss
    // the launcher mid-cleanup. Suppress autoHide while clean mode is
    // active and restore on exit. Tagged source so the tutorial's
    // independent suppression doesn't collide.
    electronAPI.setSuppressAutoHide(activeMode === 'clean', 'clean-mode');

    return () => {
      document.body.classList.remove('mode-pin', 'mode-node', 'mode-deck', 'mode-clean', 'mode-tool');
    };
  }, [activeMode]);

  // ── Global key capture → open CommandBar ─────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Only capture printable characters (single char, no modifier key combos)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      // Conflict-avoidance: don't auto-open the command bar during
      // ANY blocking state (tool mode, memo editor, dialog, overlay,
      // etc.). Earlier code only checked `cmdOpen` + `dialog !==
      // 'none'`, which let printable keystrokes hijack focus mid-
      // pin/node/deck/clean. The policy gate covers every state in
      // one go.
      const verdict = canPerform('cmd.open', {
        activeMode, nodeEditMode, deckBuilding,
        editingMemoId: editingMemoId ? editingMemoId.itemId : null,
        dialog,
        tileOverlayGroup,
        cmdOpen,
      });
      if (verdict !== true) return;
      // Open CommandBar with first character pre-filled
      setCmdInput(e.key);
      setCmdOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdOpen, dialog, activeMode, nodeEditMode, deckBuilding, editingMemoId, tileOverlayGroup]);

  // ── Global Esc key ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Priority -1 (TOPMOST): consult the escape stack. Modal/sheet/
      // popover components push themselves there on mount; the
      // last-pushed handler runs first. If a stack handler ran, we
      // stop here — global priorities (CommandBar / mode exit / hide
      // app) shouldn't compound the action. This is the SSOT for
      // "what does ESC do right now" in the launcher.
      if (runTopEscape()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Priority 0: close CommandBar
      if (cmdOpen) { setCmdOpen(false); setCmdInput(''); return; }
      // Priority 1: node mode exit
      // Edit-existing (B mode): live mutations are already saved — just
      // tear down the mode. Don't fall into the "auto-save if ≥2" path
      // since that targets the new-build flow.
      if (nodeEditMode) {
        if (editingNodeGroupId) {
          handleCancelNodeEdit();
        } else if (nodeBuilding.length >= 2) {
          handleSaveNodeGroup(undefined);
        } else {
          setNodeEditMode(false); setNodeBuilding([]); dismissToast();
        }
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
      // Priority 5: hide app — but ONLY when nothing is busy. Any
      // open modal/wizard/picker marks itself via `useBusyMark`, and
      // we must not let ESC escalate past those layers and yank the
      // launcher away while the user is mid-task. Also covers cases
      // where a base-ui dialog handled ESC itself but didn't stop
      // native propagation; without this guard the global handler
      // would still reach hideApp() on the same keystroke. See
      // `plans/escape-stack-audit.md` §3 / §4.
      if (isUserBusy()) return;
      electronAPI.hideApp();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, activeMode, tileOverlayGroup, nodeEditMode, nodeBuilding, editingNodeGroupId, deckBuilding, cmdOpen]);

  // ── Tab key cycles through all 3 presets ──────────────────────
  //
  // Press Tab anywhere (outside of inputs / modals) to advance to the
  // next preset. ALL 3 presets are in the cycle regardless of
  // entitlement — landing on a Pro-locked preset opens the paywall
  // with `preset-lock` context (same as clicking the locked toggle).
  //
  // v1.3.44: restored from "silent skip" (introduced in v1.3.41 with
  // Pro gating). User feedback: the silent skip felt like the feature
  // had disappeared — Tab is muscle memory and now only cycles 2 of 3
  // presets on Free, which reads as "broken" not "gated". Better UX
  // is full cycle + paywall when reaching the locked one, mirroring
  // the explicit preset toggle click. The paywall close action
  // returns the user to their previous preset, so accidental
  // Tab-into-paywall isn't disruptive.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (t?.isContentEditable) return;
      const verdict = canPerform('preset.cycle', {
        activeMode, nodeEditMode, deckBuilding,
        editingMemoId: editingMemoId ? editingMemoId.itemId : null,
        dialog,
        tileOverlayGroup,
        cmdOpen,
      });
      if (verdict !== true) return;

      const order: Array<'1' | '2' | '3'> = ['1', '2', '3'];
      e.preventDefault();
      const idx = order.indexOf(store.activePresetId as '1' | '2' | '3');
      const next = order[(idx + 1) % order.length];
      if (!entitlement.canUsePreset(next)) {
        // Locked preset — surface paywall with the same context the
        // explicit toggle click uses. Don't switch the active preset.
        openPaywall('preset-lock');
        return;
      }
      store.setActivePreset(next);
      tutorialTriggers.fire('preset-switched', { from: store.activePresetId, to: next, via: 'tab' });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdOpen, entitlement, store, activeMode, nodeEditMode, deckBuilding, dialog, tileOverlayGroup, editingMemoId, openPaywall]);

  // ── Dialog helpers ────────────────────────────────────────
  const openEditItem = useCallback((item: LauncherItem, spaceId: string) => {
    setEditItem(item);
    setEditSpaceId(spaceId);
    setPrefilledItem(null);
    setDialog('item');
    tutorialTriggers.fire('item-dialog-opened', { mode: 'edit', itemId: item.id });
  }, []);

  const openScan = useCallback((spaceId: string) => {
    setEditSpaceId(spaceId);
    setDialog('scan');
  }, []);

  // openQuickAdd is declared AFTER handleAddColorSwatch (further
  // down) so its closure can refer to that handler — see below.
  const openManualWizard = useCallback((spaceId?: string) => {
    setEditItem(null);
    setPrefilledItem(null);
    setEditSpaceId(spaceId ?? data.spaces[0]?.id ?? '');
    setDialog('wizard');
    tutorialTriggers.fire('item-dialog-opened', { mode: 'add' });
  }, [data.spaces]);

  /**
   * Add a media-control widget to the given space. v1 has only one
   * widget kind so we skip the picker entirely and create the card
   * straight from the menu — if more kinds land later, this becomes
   * a sub-menu / mini-dialog.
   *
   * Gates:
   *   - quotaChecks.widget() — free tier is capped at 1 across the
   *     active preset (separate counter from regular cards)
   *   - quotaChecks.card() — widgets still occupy a slot in the
   *     20-card free total, so we double-gate. If either fails, the
   *     paywall opens with the more specific reason (widget-limit
   *     wins because it triggers first).
   */
  const handleAddWidget = useCallback((spaceId: string) => {
    if (!quotaChecks.widget()) return;
    if (!quotaChecks.card()) return;
    const newItem = store.addItem(spaceId, {
      type: 'widget',
      title: '미디어',
      value: '',                          // not used for widgets
      iconType: 'material',
      icon: 'widgets',
      // No color hardcode — let the widget inherit space color (or the
      // theme accent) at render time. User can still override via the
      // card context menu like any other card.
      clickCount: 0,
      pinned: false,
      widget: { kind: 'media-control' },
    });
    if (newItem) {
      pushUndo({
        description: '미디어 위젯 추가',
        undo: () => store.deleteItem(spaceId, newItem.id),
        redo: () => store.restoreItem(spaceId, newItem),
      });
    }
    showToast('미디어 위젯을 추가했어요');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotaChecks, store]);

  /**
   * Add a colour-swatch widget. Each swatch lives in its own grid
   * cell so the user can sort, pin, delete it like any other card —
   * see ColorSwatchWidget for the rationale ("one card per colour"
   * vs. multi-swatch palette in a single widget).
   *
   * Optional `prefill` lets the clipboard suggestion path drop a
   * detected hex straight into a new widget without opening a
   * picker. When omitted we seed with the theme accent so the user
   * gets *something* to look at — they can edit immediately.
   */
  const handleAddColorSwatch = useCallback((
    spaceId: string,
    prefill?: { hex: string; name?: string },
  ): LauncherItem | null => {
    if (!quotaChecks.widget()) return null;
    if (!quotaChecks.card()) return null;
    const hex = (prefill?.hex || '#6366F1').toUpperCase();
    const name = prefill?.name;
    const newItem = store.addItem(spaceId, {
      type: 'widget',
      title: name || hex,
      value: '',
      iconType: 'material',
      icon: 'palette',
      clickCount: 0,
      pinned: false,
      widget: { kind: 'color-swatch', options: name ? { hex, name } : { hex } },
    });
    if (newItem) {
      pushUndo({
        description: `팔레트에 ${hex} 추가`,
        undo: () => store.deleteItem(spaceId, newItem.id),
        redo: () => store.restoreItem(spaceId, newItem),
      });
    }
    showToast(`팔레트에 ${hex} 추가됨`);
    return newItem;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotaChecks, store]);
  // Wire the forward-ref so the clipboard hex handler (declared
  // earlier, before this useCallback) can call into the swatch
  // creator without a TDZ. Each render keeps the ref pointing to
  // the latest closure.
  addColorSwatchRef.current = handleAddColorSwatch;

  /**
   * Add a memo card. Creates the item with current settings.memo
   * defaults, then immediately opens the inplace editor so the user
   * can start typing — same UX rhythm as Apple Notes / Things.
   *
   * Quota: memo counts against the same 20-card free-tier total as
   * other cards (a memo is still a card on the grid). We don't
   * separate-meter memos; if a free user wants more, the path is
   * "use it or lose it" — old memos auto-fade and free up slots.
   */
  const handleAddMemo = useCallback((spaceId: string) => {
    if (!quotaChecks.card()) return;
    const newItem = store.addMemo(spaceId);
    if (newItem) {
      // Mark for cardEnter animation, same as the manual-add path.
      markItemsAsNew([newItem.id]);
      // Tutorial trigger — widgets.memo / cards.memo advance on memo creation.
      tutorialTriggers.fire('memo-created', { itemId: newItem.id, spaceId, fromClipboard: false });
      pushUndo({
        description: '메모 추가',
        undo: () => store.deleteItem(spaceId, newItem.id),
        redo: () => store.restoreItem(spaceId, newItem),
      });
      // Open the editor on the next tick — let the card mount first
      // so its position is the spring-pop anchor.
      setTimeout(() => setEditingMemoId({ spaceId, itemId: newItem.id }), 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotaChecks, store]);

  /** Copy memo body — variants for the swipe-right (plain text, the
   *  common case) and swipe-left (raw markdown, power users).
   *  Both end up writing to the system clipboard via the renderer's
   *  navigator.clipboard with a fallback through the main process
   *  when the document isn't focused. */
  const copyMemoToClipboard = useCallback(async (text: string, kind: 'plain' | 'markdown') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try { electronAPI.copyText(text, false); } catch { /* dev mode */ }
    }
    showToast(kind === 'markdown' ? '마크다운으로 복사했어요' : '메모를 복사했어요');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopyMemoBody = useCallback(async (spaceId: string, itemId: string) => {
    const space = data.spaces.find(s => s.id === spaceId);
    const item = space?.items.find(i => i.id === itemId);
    const body = item?.memo?.body ?? '';
    if (!body) { showToast('메모가 비어있어요'); return; }
    void copyMemoToClipboard(memoBodyToPlain(body), 'plain');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.spaces, copyMemoToClipboard]);

  const handleCopyMemoMarkdown = useCallback(async (spaceId: string, itemId: string) => {
    const space = data.spaces.find(s => s.id === spaceId);
    const item = space?.items.find(i => i.id === itemId);
    const body = item?.memo?.body ?? '';
    if (!body) { showToast('메모가 비어있어요'); return; }
    void copyMemoToClipboard(body, 'markdown');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.spaces, copyMemoToClipboard]);

  /** "톡 살리기" — TTL reset on the targeted memo. */
  const handleExtendMemoTtl = useCallback((spaceId: string, itemId: string) => {
    store.extendMemo(spaceId, itemId);
    showToast('수명을 다시 채웠어요');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  /** Card 💾 button = OS Save-as dialog. The user picks the location
   *  themselves — different from the previous "auto-write to fixed
   *  folder + shell-open + delete card" behaviour, which the user
   *  flagged as wrong. Save-as is a SNAPSHOT: the memo card stays,
   *  no editor opens. The "I want to convert this to a file card"
   *  flow lives in the editor's separate "메모장에서 열기" button. */
  const handleExportMemoTxt = useCallback(async (spaceId: string, itemId: string) => {
    const space = data.spaces.find(s => s.id === spaceId);
    const item = space?.items.find(i => i.id === itemId);
    const body = item?.memo?.body ?? '';
    if (!body.trim()) {
      showToast('빈 메모는 저장할 수 없어요');
      return;
    }
    const title = item?.title || '메모';
    const slug = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 40) || '메모';
    try {
      const result = await electronAPI.saveMemoAs({ body, slug });
      if (result.success) {
        showToast(`저장됨 — ${result.filePath?.split(/[/\\]/).pop()}`);
        // No deleteItem — the memo card stays. Save-as is a snapshot.
      } else if (result.reason !== 'canceled') {
        showToast('저장 실패: ' + (result.reason ?? '알 수 없는 오류'));
      }
    } catch (e) {
      showToast('저장 실패: ' + String(e));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.spaces]);

  /**
   * Notification action dispatcher — central switch for all bell-row
   * action buttons. Adding a new action surface = add an `intent`
   * literal in types.ts + a case here. Auto-dismisses the notification
   * after the action fires (the user has acted on it; keeping it in
   * the panel is just clutter).
   */
  /**
   * Lightbulb toggle — same toolbar standard as pin/node/deck/clean
   * modes: persistent toast on activate, dismiss on deactivate. The
   * panel itself + ghost cards on spaces both subscribe to
   * ghostCards.active, so this single toggle drives both surfaces.
   *
   * Why we don't fold this into handleModeChange:
   *   Recommend isn't an exclusive "tool mode" the way pin/node/deck
   *   are — it shouldn't lock out other interactions. The user can
   *   keep editing cards / dragging / opening dialogs while the
   *   panel is up. So it lives outside the activeMode state machine.
   */
  const handleToggleRecommend = useCallback(() => {
    if (ghostCards.active) {
      ghostCards.toggle();
      dismissToast();
    } else {
      ghostCards.toggle();
      showToast('💡 스마트 추천 — ESC로 종료', { persistent: true });
      // Tutorial trigger — cards.scan advances on panel open.
      tutorialTriggers.fire('recommend-panel-opened');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostCards]);

  const handleNotificationAction = useCallback((n: AppNotification) => {
    if (!n.action) return;
    switch (n.action.intent) {
      case 'install-update':
        electronAPI.installUpdate();
        break;
      case 'check-update':
        electronAPI.checkForUpdates().catch(() => { /* surface error in toast already */ });
        break;
      case 'open-billing':
        // Reusing the paywall as the billing surface for v1 — when a
        // dedicated billing page lands, swap this in.
        openPaywall('generic');
        break;
      case 'open-tour': {
        // payload = QuestId — daily-nudge notifications use this path.
        // Resolve to a Quest and hand it to the live tutorial API so
        // the user lands in the QuestRunner overlay directly. Falls
        // back to the legacy tour event (TourOverlay) if no API is
        // wired (defensive — should never happen in practice).
        if (!n.action.payload) break;
        const quest = findTutorialQuest(n.action.payload as QuestId);
        if (quest && tutorialApiRef.current) {
          tutorialApiRef.current.start(quest);
        } else {
          window.dispatchEvent(new CustomEvent('nost:start-tour', { detail: { tourId: n.action.payload } }));
        }
        break;
      }
      case 'open-settings': {
        // Notification payloads may carry either new (v1.3.34+) or legacy
        // tab ids. SettingsDialog's remapLegacyTab handles the conversion;
        // we just pass through whatever the producer set.
        const tab = (n.action.payload as SettingsTab | undefined) ?? 'appearance';
        setSettingsInitialTab(tab);
        setDialog('settings');
        break;
      }
      case 'open-trash':
        setMemoTrashOpen(true);
        break;
      case 'noop':
      default:
        break;
    }
    // The action consumed the notification — clear it.
    store.dismissNotification(n.id);
    // Close panel for actions that navigate elsewhere.
    setNotifPanelOpen(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  /**
   * "빠른추가" — peek at the clipboard first. Hex codes get the
   * fast-path: a colour-swatch widget is added directly without
   * opening the quick-add dialog (the user said "팔레트로 추가하게
   * 해줘" — they want the gesture to be one-step). Anything else
   * falls through to the normal quick-add UI.
   *
   * Declared here, AFTER handleAddColorSwatch, so the closure
   * captures a defined identifier (TS strict-mode TDZ guards).
   */
  const openQuickAdd = useCallback(async (spaceId?: string) => {
    const target = spaceId ?? data.spaces[0]?.id ?? '';
    try {
      const r = await electronAPI.analyzeClipboard(getDocumentExtensions(data.settings.documentExtensions));
      if (r.type === 'hex' && r.value && target) {
        // Add the swatch and immediately open the edit dialog
        // pre-targeted at it — the user explicitly wanted "labelling
        // bay" right after auto-detection, mirroring how URL / app
        // / folder quick-add lands the user in the dialog where
        // they can refine the title before committing.
        const newItem = handleAddColorSwatch(target, { hex: r.value });
        if (newItem) {
          setEditItem(newItem);
          setEditSpaceId(target);
          setDialog('item');
        }
        return;
      }
    } catch { /* fall through to normal quick-add */ }
    setEditSpaceId(target);
    setDialog('quickadd');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.spaces, handleAddColorSwatch]);

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

  const handleSaveItem = useCallback((
    spaceId: string,
    item: Omit<LauncherItem, 'id'> | LauncherItem,
    targetPresetId?: '1' | '2' | '3',
  ) => {
    if ('id' in item) {
      const itemId = (item as LauncherItem).id;

      // Cross-preset move: targetPresetId is set only when ItemDialog's
      // preset dropdown picked a different preset than the item's owner.
      if (targetPresetId) {
        store.moveItemAcrossPresets(itemId, targetPresetId, spaceId, item as LauncherItem);
        return;
      }

      // Edit existing within the same preset — find item's CURRENT space (may have changed in dialog)
      const currentSpaceId = data.spaces.find(s => s.items.some(i => i.id === itemId))?.id;
      // Snapshot pre-edit state for undo. Skip if we couldn't locate
      // the item (would mean the dialog had a stale reference).
      const before = currentSpaceId
        ? data.spaces.find(s => s.id === currentSpaceId)?.items.find(i => i.id === itemId)
        : undefined;
      if (currentSpaceId && currentSpaceId !== spaceId) {
        store.updateItemAndMove(currentSpaceId, spaceId, item as LauncherItem);
      } else {
        store.updateItem(currentSpaceId ?? spaceId, item as LauncherItem);
      }
      if (before && currentSpaceId) {
        const sourceSpaceId = currentSpaceId;
        const destSpaceId   = spaceId;
        const after = item as LauncherItem;
        pushUndo({
          description: `"${after.title || '카드'}" 편집`,
          undo: () => {
            // If edit also moved the card across spaces, move back first.
            if (sourceSpaceId !== destSpaceId) {
              store.updateItemAndMove(destSpaceId, sourceSpaceId, before);
            } else {
              store.updateItem(sourceSpaceId, before);
            }
          },
          redo: () => {
            if (sourceSpaceId !== destSpaceId) {
              store.updateItemAndMove(sourceSpaceId, destSpaceId, after);
            } else {
              store.updateItem(destSpaceId, after);
            }
          },
        });
      }
    } else {
      // New item — pre-generate ID so we can trigger the entry animation immediately
      if (!quotaChecks.card()) return;
      // Memo type: route to store.addMemo so MemoData (body, TTL,
      // timestamps) is constructed correctly. addItem alone produces
      // a half-built memo with no expiry, which would silently expire
      // on the next sweep. The dialog stuffs the body into `value`.
      if ((item as LauncherItem).type === 'memo') {
        const body = ((item as Omit<LauncherItem, 'id'>).value ?? '').toString();
        const newItem = store.addMemo(spaceId, body);
        if (newItem) {
          markItemsAsNew([newItem.id]);
          lastAddedItemRef.current = { spaceId, id: newItem.id };
          tutorialTriggers.fire('memo-created', { itemId: newItem.id, spaceId, fromClipboard: false });
          fireFirstCardCelebration();
          pushUndo({
            description: `메모 추가`,
            undo: () => store.deleteItem(spaceId, newItem.id),
            redo: () => store.restoreItem(spaceId, newItem),
          });
        }
        return;
      }
      const newId = generateId();
      store.addItem(spaceId, item as Omit<LauncherItem, 'id'>, newId);
      markItemsAsNew([newId]);
      // Stash for the post-save "꾸미기" toast — see handleRequestAdvanced.
      lastAddedItemRef.current = { spaceId, id: newId };
      // Tutorial trigger — basics.cards advances when an item is added.
      tutorialTriggers.fire('item-added', { itemId: newId, spaceId, type: (item as LauncherItem).type });
      // First-card celebration: fired here so it covers manual adds, ghost
      // accepts, batch drops, and any other path that lands here. The
      // component itself dedupes via localStorage.
      fireFirstCardCelebration();
      const addedSnapshot = { ...item, id: newId } as LauncherItem;
      pushUndo({
        description: `"${addedSnapshot.title || '카드'}" 추가`,
        undo: () => store.deleteItem(spaceId, newId),
        redo: () => store.restoreItem(spaceId, addedSnapshot),
      });
    }
  }, [store, data.spaces, markItemsAsNew, quotaChecks]);

  // ── Screen-pick mode (phase ③ "🎯 화면에서 고르기") ──────────
  // The dialog hands us a fully-built partial item; we close the
  // dialog, glow every space accordion in the main UI, and let the
  // user click one to commit. ESC or 취소 cancels — we then re-open
  // the dialog at phase ③ with the partial preserved so the user
  // doesn't lose state. Implementation choice: a capture-phase
  // document click listener that resolves the click target to the
  // nearest `[data-space-id]`, since SpaceAccordion + SortableSpace
  // already carry that attribute (used by the drag system too). No
  // per-component plumbing needed.
  const [screenPicker, setScreenPicker] = useState<{ partial: Omit<LauncherItem, 'id'> } | null>(null);

  const handlePickOnScreen = useCallback((partial: Omit<LauncherItem, 'id'>) => {
    // The partial item lives inside `screenPicker` state until the
    // user clicks a space (commit) or ESC (cancel-and-reopen).
    // Closing the dialog is enough — the dialog's own onClose will
    // clear prefilledItem/editItem, but we don't depend on those.
    setScreenPicker({ partial });
    setDialog('none');
  }, []);

  const cancelScreenPicker = useCallback((reopen: boolean) => {
    const partial = screenPicker?.partial;
    setScreenPicker(null);
    if (reopen && partial) {
      setEditItem(null);
      setPrefilledItem(partial as Partial<LauncherItem>);
      setEditSpaceId(data.spaces[0]?.id ?? '');
      setDialog('item');
    }
  }, [screenPicker, data.spaces]);

  // Body attribute drives the glow CSS (see index.css). Set/cleared
  // on screenPicker change so we never leak the picking state across
  // unrelated UI work.
  useEffect(() => {
    if (screenPicker) {
      document.body.setAttribute('data-screen-picking', 'true');
    } else {
      document.body.removeAttribute('data-screen-picking');
    }
    return () => { document.body.removeAttribute('data-screen-picking'); };
  }, [screenPicker]);

  // Safety net: if any other dialog opens while pick mode is active,
  // cancel the pick. The glow + click intercept would compete with
  // the new dialog's own UI, and the user has clearly moved on.
  useEffect(() => {
    if (screenPicker && dialog !== 'none') {
      cancelScreenPicker(false);
    }
  }, [screenPicker, dialog, cancelScreenPicker]);

  // Capture-phase click intercept — fires before the space's own
  // click handlers (drag init, expand toggle, etc.) so we can swallow
  // the event entirely.
  useEffect(() => {
    if (!screenPicker) return;
    const partial = screenPicker.partial;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const spaceEl = target?.closest('[data-space-id]') as HTMLElement | null;
      if (!spaceEl) return; // click outside any space — let it bubble (close dialog etc)
      const sid = spaceEl.getAttribute('data-space-id');
      if (!sid) return;
      e.preventDefault();
      e.stopPropagation();
      handleSaveItem(sid, partial);
      setScreenPicker(null);
      // Mirror ItemDialog's brain-off "꾸미기" nudge so this path
      // gets the same affordance — the user only "skipped advanced"
      // because it was never offered, not because they're sure.
      const refIdAfter = lastAddedItemRef.current;
      if (refIdAfter) {
        showToast('카드 추가됨 · 아이콘이나 색상을 바꿔볼까요?', {
          actions: [{
            label: '꾸미기',
            icon: 'palette',
            onClick: () => handleRequestAdvanced(sid),
          }],
          duration: 5000,
        });
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelScreenPicker(true);
      }
    };
    // Capture so we beat dnd-kit + the accordion's own onClick.
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenPicker]);

  // Latest-data ref so post-save toasts can resolve the freshly-added
  // item even though their `onRequestAdvanced` closure was captured
  // BEFORE setRawData committed (the toast button clicks fire 1-5 s
  // later through a stale closure that wouldn't otherwise see the
  // new id). Updated on every render — cheap.
  const dataSpacesRef = useRef(data.spaces);
  dataSpacesRef.current = data.spaces;

  // Stable identity (no deps) so the toast's captured `onRequestAdvanced`
  // remains valid no matter how many re-renders happen between the
  // showToast call and the user clicking 꾸미기. Reads `data.spaces`
  // through dataSpacesRef so each invocation sees the latest store.
  const handleRequestAdvanced = useCallback((spaceId: string) => {
    const ref = lastAddedItemRef.current;
    if (!ref) return;
    const finalSpaceId = spaceId || ref.spaceId;
    const space = dataSpacesRef.current.find(s => s.id === finalSpaceId);
    const item = space?.items.find(i => i.id === ref.id);
    if (!item) return;
    setEditItem(item);
    setEditSpaceId(finalSpaceId);
    setPrefilledItem(null);
    setItemDialogStartAdvanced(true);
    setDialog('item');
  }, []);

  // ── Item launcher (shared between card clicks & commands) ─
  const launchItem = useCallback((item: LauncherItem, spaceId: string) => {
    // Memo cards have no launch target — "launching" them just opens
    // the editor. This covers all entry points (badge click, search
    // result, keyboard command), not just the in-app card click.
    if (item.type === 'memo') {
      setEditingMemoId({ spaceId, itemId: item.id });
      return;
    }
    store.incrementClickCount(spaceId, item.id);
    launchAndPosition(item, data.settings.closeAfterOpen);
    // No trigger fire here — launchAndPosition is the SSOT for the
    // 'item-launched' tutorial event (covers in-app card click,
    // badge click, command bar). Duplicating here would advance
    // a quest step twice on the badge path.
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

  // ── Doc cohort ("최신 버전 확인") ─────────────────────────────────
  // Right-click menu on doc-like cards routes here. We stash the target
  // (spaceId + itemId) and flip the dialog; DocCohortDialog does the
  // scan + ranking via the SSOT functions in lib/docCohort.ts.
  // Commit path updates BOTH item.value (the picked file) AND
  // item.docCohort (the binding so subsequent "최신 확인" skips detection).
  const [cohortTarget, setCohortTarget] = useState<{ spaceId: string; itemId: string } | null>(null);
  const handleCheckDocCohort = useCallback((spaceId: string, itemId: string) => {
    const space = data.spaces.find(s => s.id === spaceId);
    const item  = space?.items.find(i => i.id === itemId);
    // Cards without a path-shaped value (text / cmd / url / window) wouldn't
    // produce useful scan results — bail with a gentle toast.
    const v = item?.value ?? '';
    const looksLikePath = /^[A-Za-z]:\\/.test(v) || v.startsWith('\\\\');
    if (!looksLikePath) {
      showToast('이 카드는 파일 경로가 아니에요');
      return;
    }
    setCohortTarget({ spaceId, itemId });
  }, [data.spaces, showToast]);

  const handleCohortCommit = useCallback((args: {
    value: string;
    pattern: string;
    tokenType: import('./types').TokenPreset;
    directory: string;
  }) => {
    if (!cohortTarget) return;
    const { spaceId, itemId } = cohortTarget;
    const space = data.spaces.find(s => s.id === spaceId);
    const item  = space?.items.find(i => i.id === itemId);
    if (!item) return;
    store.updateItem(spaceId, {
      ...item,
      value: args.value,
      docCohort: {
        directory: args.directory,
        pattern:   args.pattern,
        tokenType: args.tokenType,
      },
    });
    showToast('최신 파일로 갱신했어요');
  }, [cohortTarget, data.spaces, store, showToast]);

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
    // Toast undo button (one-shot, expires with toast) AND undo
    // stack entry (Ctrl+Z, lasts 10 actions). Both call the same
    // restore — the stack also needs a redo for Ctrl+Shift+Z.
    pushUndo({
      description: `"${item.title}" 삭제`,
      undo: () => store.restoreItem(spaceId, item),
      redo: () => store.deleteItem(spaceId, itemId),
    });
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
    pushUndo({
      description: `"${space.name}" 스페이스 삭제`,
      undo: () => store.restoreSpace(space),
      redo: () => store.deleteSpace(spaceId),
    });
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
    // Electron 32+ removed File.path; resolve via the webUtils bridge.
    // Fall back through the (deprecated) path prop and finally the filename
    // so we still work on older Electron builds and in dev.
    const resolvePath = (file: File): string => {
      const legacy = (file as File & { path?: string }).path;
      if (legacy) return legacy;
      return electronAPI.getFilePath(file) ?? file.name;
    };
    const docExts = getDocumentExtensions(data.settings.documentExtensions);
    if (files.length === 1) {
      const filePath = resolvePath(files[0]);
      const { type, title } = inferItemFromPath(filePath, docExts);

      // .txt / .md / .markdown → open ItemDialog at the TYPE phase with
      // memo as the recommended choice. We read the file contents up
      // front and stash them in form.value so that if the user picks
      // memo, the body is already there. If they pick a different type
      // (file card / text), the dialog overwrites value with the file
      // path on type-pick. plausibleTypes elevates memo for these
      // extensions so the type card grid shows it first-class.
      const ext = (filePath.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
      if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
        electronAPI.readTextFile(filePath).then(r => {
          if (r.ok) {
            setPrefilledItem({ type: 'memo', title, value: r.text });
          } else {
            // Read failed (too big or unreadable) — fall back to the
            // regular file-card flow so the user still gets something.
            setPrefilledItem({ type, title, value: filePath });
          }
          setEditItem(null);
          setEditSpaceId(targetSpaceId);
          setDialog('item');
        });
        return;
      }

      // Default: open ItemDialog pre-filled so the user can confirm/tweak
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
        const filePath = resolvePath(file);
        const { type, title } = inferItemFromPath(filePath, docExts);
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
    // Path → defer to inferItemFromPath SSOT so the extension (incl. user's
    // documentExtensions list) decides app/doc/folder. Earlier this branch
    // hard-coded 'folder' which silently mis-typed .pptx / .docx etc. when
    // the drop arrived as text-only (e.g. OneDrive virtual files).
    const inferred = isPath ? inferItemFromPath(raw, docExts) : null;
    const inferredType: LauncherItem['type'] = isUrl ? 'url' : inferred ? inferred.type : 'text';
    const inferredTitle = isUrl
      ? (raw.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] ?? raw)
      : (inferred?.title ?? inferItemFromPath(raw, docExts).title);
    setPrefilledItem({ type: inferredType, title: inferredTitle, value: raw });
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
    // Single stack entry for the whole batch — Ctrl+Z rewinds them
    // together. Mirrors what the inline toast button already did.
    pushUndo({
      description: `${added.length}개 항목 추가`,
      undo: () => store.deleteItems(spaceId, added.map(i => i.id)),
      redo: () => { for (const it of added) store.restoreItem(spaceId, it); },
    });
    showToast(`${added.length}개 항목 추가됨 → ${spaceName}`, {
      actions: [{
        label: '실행 취소',
        icon: 'undo',
        onClick: () => store.deleteItems(spaceId, added.map(i => i.id)),
      }],
    });
  }, [store, data.spaces, showToast, markItemsAsNew]);

  /**
   * Clean-mode action — delete every unpinned, non-container item in the
   * given space. Confirmation uses the native dialog so the destruction
   * can't be triggered by an accidental pointer event. Pinned and container
   * items are preserved intentionally.
   */
  // Pin truth lives on space.pinnedIds (see useAppData.deleteUnpinnedInSpace
  // for the full explanation). The filter here must match for the confirm
  // count to agree with what actually gets deleted.
  const handleCleanSpace = useCallback((spaceId: string) => {
    const space = data.spaces.find(s => s.id === spaceId);
    if (!space) return;
    const pinSet = new Set(space.pinnedIds ?? []);
    const victims = space.items.filter(i => !pinSet.has(i.id) && !i.isContainer);
    if (victims.length === 0) {
      showToast('삭제할 카드 없음 (모두 고정됨)', { duration: 1800 });
      return;
    }
    const ok = window.confirm(`"${space.name}"의 고정되지 않은 카드 ${victims.length}개를 삭제합니다. 계속하시겠습니까?`);
    if (!ok) return;
    const removed = store.deleteUnpinnedInSpace(spaceId);
    showToast(`"${space.name}"에서 ${removed}개 카드 삭제`, { duration: 2500 });
  }, [data.spaces, store, showToast]);

  const handleCleanAllSpaces = useCallback(() => {
    const total = data.spaces.reduce((acc, s) => {
      const pinSet = new Set(s.pinnedIds ?? []);
      return acc + s.items.filter(i => !pinSet.has(i.id) && !i.isContainer).length;
    }, 0);
    if (total === 0) {
      showToast('삭제할 카드 없음 (모두 고정됨)', { duration: 1800 });
      return;
    }
    const ok = window.confirm(`모든 스페이스에서 고정되지 않은 카드 ${total}개를 삭제합니다. 계속하시겠습니까?`);
    if (!ok) return;
    const removed = store.deleteUnpinnedInAllSpaces();
    showToast(`${removed}개 카드 삭제됨`, { duration: 2500 });
    // Exit clean mode after a full sweep — the obvious "done" state.
    setActiveMode('normal');
  }, [data.spaces, store, showToast, setActiveMode]);

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
    // Conflict gate — a slash command that runs during a tool /
    // dialog / overlay state can clobber the user's in-progress
    // work (e.g. /clip-text → addItem while in node-edit mode mid-
    // group). The command bar itself is already closed by the time
    // we reach here (its host modal blocks open), so cmdOpen reads
    // false; we still consult the policy for every OTHER state.
    // Search-only commands (kind === 'search') are exempt because
    // they only mutate the search query, which is safe everywhere.
    if (cmd.kind !== 'search') {
      const verdict = canPerform('slash.execute', {
        activeMode, nodeEditMode, deckBuilding,
        editingMemoId: editingMemoId ? editingMemoId.itemId : null,
        dialog,
        tileOverlayGroup,
        cmdOpen: false,
      });
      if (verdict !== true) {
        showToast(verdict.message, { duration: 1500 });
        setCmdOpen(false);
        setCmdInput('');
        return;
      }
    }

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
        const trimmed = text.trim();
        const isUrl = /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed);
        const isPath = /^[a-zA-Z]:\\/i.test(trimmed) || trimmed.startsWith('\\\\');
        // Path → use inferItemFromPath SSOT (honours documentExtensions for doc/app split)
        const docExtsForClip = getDocumentExtensions(data.settings.documentExtensions);
        const itemType: LauncherItem['type'] = isUrl
          ? 'url'
          : isPath ? inferItemFromPath(trimmed, docExtsForClip).type : 'text';
        const displayTitle = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        let targetSpace: Space | undefined;
        if (cmd.spaceIdx === -1) {
          targetSpace = data.spaces[0];
          if (!targetSpace) { showToast('스페이스가 없습니다'); return; }
        } else {
          targetSpace = data.spaces[cmd.spaceIdx];
          if (!targetSpace) { showToast(`스페이스 ${cmd.spaceIdx + 1} 없음`); return; }
        }
        const newItem = store.addItem(targetSpace.id, {
          title: displayTitle,
          type: itemType as LauncherItem['type'],
          value: text.trim(),
        });
        if (newItem) {
          const ts = targetSpace;
          pushUndo({
            description: `"${displayTitle}" 추가`,
            undo: () => store.deleteItem(ts.id, newItem.id),
            redo: () => store.restoreItem(ts.id, newItem),
          });
        }
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

    // ── Phase 4 — new commands ────────────────────────────────
    if (cmd.kind === 'switch-preset') {
      store.setActivePreset(cmd.presetId);
      const label = store.presets.find(p => p.id === cmd.presetId)?.label ?? `프리셋 ${cmd.presetId}`;
      showToast(`${label}로 전환`);
      return;
    }

    if (cmd.kind === 'toggle-theme') {
      const nextTheme = data.settings.theme === 'dark' ? 'light' : 'dark';
      store.updateSettings({ ...data.settings, theme: nextTheme });
      showToast(nextTheme === 'dark' ? '다크 테마' : '라이트 테마');
      return;
    }

    if (cmd.kind === 'set-opacity') {
      store.updateSettings({ ...data.settings, opacity: cmd.value });
      showToast(`투명도 ${Math.round(cmd.value * 100)}%`);
      return;
    }

    if (cmd.kind === 'start-tutorial') {
      // The tutorial runtime reads this ref and starts the matching tour.
      // If no id given, opens the tour picker.
      window.dispatchEvent(new CustomEvent('nost:start-tour', { detail: { tourId: cmd.tourId ?? null } }));
      return;
    }

    if (cmd.kind === 'open-import') {
      setImportOpen(true);
      return;
    }

    if (cmd.kind === 'clean-unpinned') {
      if (cmd.scope === 'all') {
        const deleted = store.deleteUnpinnedInAllSpaces();
        showToast(`${deleted}개 카드 청소됨`);
      } else {
        const sp = data.spaces[cmd.spaceIdx ?? 0];
        if (!sp) { showToast(`스페이스 ${(cmd.spaceIdx ?? 0) + 1} 없음`); return; }
        const deleted = store.deleteUnpinnedInSpace(sp.id);
        showToast(`${deleted}개 카드 청소됨 — ${sp.name}`);
      }
      return;
    }

    if (cmd.kind === 'invalid') {
      showToast(`${cmd.reason}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.spaces, data.nodeGroups, data.settings, store, showToast, launchItem, handleNodeGroupLaunch, handleTogglePin, activeMode, nodeEditMode, deckBuilding, editingMemoId, dialog, tileOverlayGroup]);

  // ── DnD sensors ───────────────────────────────────────────
  // Single UnifiedPointerSensor handles BOTH left-click (space reorder) and
  // right-click (card reorder). Previously two PointerSensor subclasses were
  // registered side by side, but dnd-kit silently dropped drag activation when
  // both were present — the unified sensor fixes the conflict.
  // See UnifiedPointerSensor (above) for the button-specific gating rules.
  const allSensors = useSensors(
    useSensor(UnifiedPointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Space reorder DnD (Phase 3 pair model)
  //
  // Three drop outcomes based on the hovered edge of the target space T:
  //   edge='left'   → pair becomes [dragged, T].  Any prior pair T was in is broken.
  //   edge='right'  → pair becomes [T, dragged].  Any prior pair T was in is broken.
  //   edge='center' → dragged becomes a SOLO row right after T (T's pair, if any, is
  //                   preserved by inserting AFTER both sides of the pair).
  //   no edge       → standard array reorder via arrayMove (positions only, pair
  //                   flags cleared for both dragged and its old neighbor).
  //
  // Every path funnels into store.reorderSpaces, which re-applies the pair
  // invariant (see enforcePairInvariant in useAppData).
  function handleSpaceDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const activeId = active.id as string;
    const edge = dragOverEdge;
    setDragOverEdge(null);

    const spaces = data.spaces;
    const draggedIdx = spaces.findIndex(s => s.id === activeId);
    if (draggedIdx === -1) return;

    // Blocked drops: the target row is already a pair and the user tried to drop
    // on its left/right edge. Swallow silently — the red indicator already
    // communicated that the action wasn't allowed.
    if (edge?.blocked) return;

    // Strip "drop-space-" prefix from dnd-kit's `over.id` fallback.
    const overIdRaw = over ? String(over.id) : '';
    const overId = overIdRaw.startsWith('drop-space-') ? overIdRaw.slice('drop-space-'.length) : overIdRaw;

    // Targeted edge drop (left/right/center) wins over dnd-kit's generic `over`.
    const targetId = edge?.overId ?? overId;
    if (!targetId || targetId === activeId) return;

    const next = applySpaceDrop(spaces, activeId, targetId, edge?.edge ?? null);
    if (next) {
      store.reorderSpaces(next);
      tutorialTriggers.fire('space-reordered', { spaceId: activeId });
    }
  }

  // Item DnD (cross-space)
  function handleItemDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDraggingItemId(null);

    // ── Bloom drop has highest precedence ────────────────────
    // If a bloom is open with a hot direction selected, route the
    // drop to slot assignment regardless of what dnd-kit thinks
    // `over` is. Bloom zones live OUTSIDE the container's rect so
    // dnd-kit's collisionDetection doesn't cover them.
    if (bloomState?.hotDir) {
      const dir = bloomState.hotDir;
      const containerSpaceId = bloomState.containerSpaceId;
      const containerId = bloomState.containerId;
      const sourceItemId = active.id as string;
      closeBloom();
      // Don't slot a container into itself.
      if (sourceItemId === containerId) return;
      store.assignSlotFromItem({ containerSpaceId, containerId, dir, sourceItemId });
      const dirKo = dir === 'up' ? '위' : dir === 'down' ? '아래' : dir === 'left' ? '왼쪽' : '오른쪽';
      showToast(`${dirKo} 슬롯에 추가됨`);
      return;
    }
    // Bloom open but released outside any zone → collapse, then
    // continue with the normal drag-end logic below (sortable, etc.).
    closeBloom();

    if (!over) {
      appLog.info(`[drag] drop SWALLOWED — over=null, activeId=${active.id}`);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    appLog.info(`[drag] drop START — activeId=${activeId} overId=${overId}`);

    // ── Drop onto node/deck building zones ──────────────
    if (overId === 'drop-node-building' && nodeEditMode) {
      if (!nodeBuilding.includes(activeId) && nodeBuilding.length < 3) {
        setNodeBuilding(prev => [...prev, activeId]);
        tutorialTriggers.fire('node-added', { itemId: activeId, target: 'building' });
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
        tutorialTriggers.fire('node-added', { itemId: activeId, groupId });
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

    // Diagnostic for backlog #1 (empty-slot drop intermittent failures).
    // Logs which branch handles each drop so future failure reports can
    // be triaged from main.log instead of guesswork.
    appLog.info(`[drag] drop: activeId=${activeId} overId=${overId} from=${sourceSpace.id}`);

    // Dropped onto a space droppable zone
    if (overId.startsWith('drop-space-')) {
      const toSpaceId = overId.replace('drop-space-', '');
      if (toSpaceId !== sourceSpace.id) {
        appLog.info(`[drag] branch=drop-space, cross-space → ${toSpaceId}`);
        store.moveItemToSpace(activeId, sourceSpace.id, toSpaceId);
        tutorialTriggers.fire('item-moved', { itemId: activeId, from: sourceSpace.id, to: toSpaceId });
      } else {
        // Same-space drop on empty droppable area (no item under cursor):
        // user wants the card moved to the END of the same space. Without
        // this, dropping in same-space-empty was a silent no-op — backlog
        // #1's primary cause.
        appLog.info(`[drag] branch=drop-space, same-space → reorder to end`);
        const items = sourceSpace.items;
        const oldIdx = items.findIndex(i => i.id === activeId);
        if (oldIdx !== -1 && oldIdx !== items.length - 1) {
          const [moved] = items.slice(oldIdx, oldIdx + 1);
          const next = [...items.slice(0, oldIdx), ...items.slice(oldIdx + 1), moved];
          store.reorderItems(sourceSpace.id, next);
          tutorialTriggers.fire('item-moved', { itemId: activeId, from: sourceSpace.id, to: sourceSpace.id, kind: 'reorder' });
        }
      }
      return;
    }

    // Dropped directly on a space's outer wrapper (the SortableSpace
    // itself, not its inner drop-space-* zone). Happens for empty
    // spaces because dnd-kit's closestCorners picks the wrapper
    // sortable over the inner droppable when there are no items
    // around to disambiguate. Without this branch, drops onto empty
    // spaces silently no-op'd — visible bug.
    const directSpaceMatch = data.spaces.find(s => s.id === overId);
    if (directSpaceMatch) {
      if (directSpaceMatch.id !== sourceSpace.id) {
        appLog.info(`[drag] branch=directSpaceMatch, cross-space → ${directSpaceMatch.id}`);
        store.moveItemToSpace(activeId, sourceSpace.id, directSpaceMatch.id);
        tutorialTriggers.fire('item-moved', { itemId: activeId, from: sourceSpace.id, to: directSpaceMatch.id });
      } else {
        appLog.info(`[drag] branch=directSpaceMatch, same-space — no-op`);
      }
      return;
    }

    // Dropped onto another item
    const targetSpace = data.spaces.find(s => s.items.some(i => i.id === overId));
    if (!targetSpace) {
      // Last-resort fallback: hit-test the pointer against every
      // visible space rect. Covers cases where collision detection
      // returns null (rare DPI / scroll edge cases) and drops over
      // the "+ 추가" button area which doesn't carry a droppable id.
      const start = event.activatorEvent as PointerEvent | MouseEvent | undefined;
      if (start) {
        const px = (start.clientX ?? 0) + event.delta.x;
        const py = (start.clientY ?? 0) + event.delta.y;
        const els = document.querySelectorAll<HTMLElement>('[data-space-id]');
        for (const el of Array.from(els)) {
          const r = el.getBoundingClientRect();
          if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
            const spaceId = el.dataset.spaceId;
            if (!spaceId) return;
            if (spaceId !== sourceSpace.id) {
              appLog.info(`[drag] branch=hit-test fallback, cross-space → ${spaceId}`);
              store.moveItemToSpace(activeId, sourceSpace.id, spaceId);
              tutorialTriggers.fire('item-moved', { itemId: activeId, from: sourceSpace.id, to: spaceId });
            } else {
              // Same-space hit-test fallback — same as drop-space same-space:
              // move to the end. Without this, hit-test landed on source
              // space and silently no-op'd (backlog #1 secondary cause).
              appLog.info(`[drag] branch=hit-test fallback, same-space → reorder to end`);
              const items = sourceSpace.items;
              const oldIdx = items.findIndex(i => i.id === activeId);
              if (oldIdx !== -1 && oldIdx !== items.length - 1) {
                const [moved] = items.slice(oldIdx, oldIdx + 1);
                const next = [...items.slice(0, oldIdx), ...items.slice(oldIdx + 1), moved];
                store.reorderItems(sourceSpace.id, next);
                tutorialTriggers.fire('item-moved', { itemId: activeId, from: sourceSpace.id, to: sourceSpace.id, kind: 'reorder' });
              }
            }
            return;
          }
        }
        appLog.info(`[drag] no branch matched — drop discarded. overId=${overId} px=${px} py=${py}`);
      } else {
        appLog.info(`[drag] no branch matched — no activatorEvent. overId=${overId}`);
      }
      return;
    }

    if (sourceSpace.id === targetSpace.id) {
      const items = sourceSpace.items;
      const oldIdx = items.findIndex(i => i.id === activeId);
      const newIdx = items.findIndex(i => i.id === overId);
      if (oldIdx === -1 || newIdx === -1) return;
      if (oldIdx !== newIdx) {
        store.reorderItems(sourceSpace.id, arrayMove(items, oldIdx, newIdx));
        tutorialTriggers.fire('item-moved', { itemId: activeId, from: sourceSpace.id, to: sourceSpace.id, kind: 'reorder' });
      }
    } else {
      store.moveItemToSpace(activeId, sourceSpace.id, targetSpace.id);
      tutorialTriggers.fire('item-moved', { itemId: activeId, from: sourceSpace.id, to: targetSpace.id });
    }
  }

  // Combined drag end: space sort (left-click grip) OR item sort/move (right-click)
  function handleAllDragEnd(event: DragEndEvent) {
    const isSpaceDrag = data.spaces.some(s => s.id === (event.active.id as string));
    if (isSpaceDrag) { handleSpaceDragEnd(event); setDraggingSpaceId(null); }
    else { handleItemDragEnd(event); }
    // Always clear the busy flag — both branches are terminal for the drag.
    setBusy('drag', false);
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
      if (e.key === 'Escape') {
        // Slash mode: cancel the command, swallow the event so the
        // global ESC handler doesn't escalate to "hide the app."
        // The user wanted ESC inside an active text surface to
        // close THAT surface first, not the window.
        e.preventDefault();
        e.stopPropagation();
        setQuery('');
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const sg = slashSuggestions[slashSelectedIdx];
        if (sg && !sg.dimmed) { sg.onSelect(); setQuery(''); }
        return;
      }
      return;
    }
    // Non-slash search: ESC steps down — first press clears the
    // input (if there's content), second press from an empty box
    // falls through to the global handler. One-press undo for
    // mistyping, two-press to close the app.
    if (e.key === 'Escape') {
      if (query.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setQuery('');
        return;
      }
      (e.currentTarget as HTMLInputElement).blur();
      return;
    }
    if (e.key !== 'Enter') return;
    const firstSpace = filteredSpaces[0];
    const firstItem = firstSpace?.items[0];
    if (!firstItem) return;
    store.incrementClickCount(firstSpace.id, firstItem.id);
    launchAndPosition(firstItem, data.settings.closeAfterOpen);
    setQuery('');
  }, [isSlashMode, slashSuggestions, slashSelectedIdx, filteredSpaces, query, data.settings.closeAfterOpen, store, launchAndPosition]);

  // ── First-run welcome popup ────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (store.isFirstRun) setShowWelcome(true);
  }, [store.isFirstRun]);

  // ── Auto-updater notifications ────────────────────────────
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [updateNewVer, setUpdateNewVer] = useState<string | null>(null);
  useEffect(() => {
    electronAPI.onUpdateAvailable((info) => {
      setUpdateNewVer(info.version);
      // Bell-only — the toast used to fire here too, but it doubled with
      // the persistent notification below. The download-complete event
      // still surfaces a toast (it has an actionable "지금 설치" button).
      store.addNotification({
        kind: 'update',
        title: `새 버전 v${info.version}`,
        body: '다운로드 중이에요. 끝나면 알려드릴게요.',
        dedupKey: `update-available-${info.version}`,
      });
    });
    electronAPI.onUpdateDownloadProgress((info) => {
      setDownloadProgress(info ? info.percent : null);
    });
    electronAPI.onUpdateDownloaded((info) => {
      setUpdateNewVer(info.version);
      setDownloadProgress(null);
      setUpdateDownloaded(true);
      // Toast with direct install action button
      showToast(`v${info.version} 다운로드 완료`, {
        duration: 10000,
        actions: [{ label: '지금 설치', icon: 'restart_alt', onClick: () => electronAPI.installUpdate() }],
      });
      // Replace the "downloading" notification with an "install ready"
      // one. Same dedupKey on the v-pair, so the panel doesn't show
      // both rows for the same version.
      store.addNotification({
        kind: 'update',
        title: `v${info.version} 설치 준비 완료`,
        body: '재시작하면 새 버전으로 업데이트됩니다.',
        action: { label: '지금 설치', intent: 'install-update' },
        dedupKey: `update-available-${info.version}`,
      });
    });

    // ── Floating orb bridges ────────────────────────────────
    // Orb right-click > "설정 열기" pipes in here so we can jump straight
    // to the 일반 tab where the floating settings live.
    electronAPI.onFloatingOpenSettings(() => {
      setSettingsInitialTab('general');
      setDialog('settings');
    });
    // Main mutated the floating-button setting out-of-band (tray menu or
    // orb right-click "숨기기"). Pull fresh settings so the Settings UI
    // toggle reflects reality the next time the user opens it.
    electronAPI.onFloatingSettingsChanged(() => {
      store.reloadFromStore();
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
    editingNodeGroupId,
    deckItems,
    decks,
    deckAnchorItemIds,
    inactiveWindowIds,
    monitorCount,
    monitors,
    allItems,
    monitorDirections: data.settings.monitorDirections as Record<number, string> | undefined,
    closeAfter: data.settings.closeAfterOpen,
    searchQuery: query,
    justAddedItemIds,
  }), [activeMode, nodeGroups, nodeBuilding, editingNodeGroupId, deckItems, decks, deckAnchorItemIds, inactiveWindowIds, monitorCount, monitors, allItems, data.settings.monitorDirections, data.settings.closeAfterOpen, query, justAddedItemIds]);

  const appActions = useMemo<AppActions>(() => ({
    showToast,
    launchAndPosition,
    openMonitorSettings: () => openSettingsTab('monitor'),
    onPinModeClick: handlePinModeClick,
    onNodeModeClick: handleNodeModeClick,
    onNodeGroupLaunch: handleNodeGroupLaunch,
    onDeckModeClick: handleDeckBuildingClick,
    onDeckGroupLaunch: handleDeckGroupLaunch,
    onWindowInactiveClick: handleWindowInactiveClick,
    onCleanSpace: handleCleanSpace,
    notifyExtensionRequiredAtUseSite,
  }), [showToast, launchAndPosition, handlePinModeClick, handleNodeModeClick, handleNodeGroupLaunch, handleDeckBuildingClick, handleDeckGroupLaunch, handleWindowInactiveClick, handleCleanSpace, notifyExtensionRequiredAtUseSite]);

  // ── Satellite ItemDialog bridge (v1.3.44+) ──────────────────────
  // The card add/edit dialog now lives in its own BrowserWindow (see
  // plans/satellite-dialogs.md). App.tsx no longer renders it inline —
  // instead, when dialog state transitions to 'item' we push a payload
  // to main, which spawns / re-uses the satellite. User actions come
  // back as IPC messages and dispatch to the same handlers the inline
  // dialog used as callback props (handleSaveItem etc.).
  useEffect(() => {
    if (dialog !== 'item') return;
    const allowedTypes: Array<LauncherItem['type']> | undefined =
      editItem?.id ? undefined :
      prefilledItem?.type === 'url' || prefilledItem?.type === 'browser' ? ['url', 'browser'] :
      prefilledItem?.type === 'folder' ? ['folder', 'doc', 'app'] :
      prefilledItem?.type === 'doc' ? ['doc', 'folder', 'app'] :
      prefilledItem?.type === 'app' || prefilledItem?.type === 'cmd' ? ['app', 'cmd'] :
      prefilledItem?.type === 'window' ? ['window'] :
      prefilledItem?.type === 'text' ? ['text'] :
      undefined;
    electronAPI.openItemDialog({
      spaces: data.spaces,
      presets: store.presets,
      currentPresetId: store.activePresetId,
      editItem: editItem || prefilledItem,
      defaultSpaceId: editSpaceId,
      monitorCount,
      allowedTypes,
      docExtensions: data.settings.documentExtensions,
      startAdvanced: itemDialogStartAdvanced,
      accentColor: data.settings.accentColor,
    });
  }, [
    dialog, editItem, prefilledItem, itemDialogStartAdvanced, editSpaceId,
    monitorCount, data.spaces, store.presets, store.activePresetId,
    data.settings.documentExtensions, data.settings.accentColor,
  ]);

  // Listen for actions from the satellite (save / request-advanced /
  // pick-on-screen / toast). These map 1:1 to the callback props the
  // inline dialog used to receive — wire them through the same handlers.
  // NOTE: toast actions (the "꾸미기" button after save) are dropped in
  // satellite mode because closure-onClick can't cross IPC. Documented
  // limitation; tracked in plans/satellite-dialogs.md as Phase 2 polish.
  useEffect(() => {
    const off = electronAPI.onItemDialogAction((action) => {
      switch (action.kind) {
        case 'save':
          handleSaveItem(action.spaceId, action.item, action.targetPresetId);
          // Synchronous state reset — without this, the data.spaces
          // mutation handleSaveItem just did would re-fire the trigger
          // useEffect (dialog still 'item') and re-spawn the satellite
          // before main's 'item-dialog-closed' IPC arrives. The closed
          // listener below is then a no-op (dialog already 'none').
          setDialog('none');
          setEditItem(null);
          setPrefilledItem(null);
          setItemDialogStartAdvanced(false);
          break;
        case 'request-advanced':
          handleRequestAdvanced(action.spaceId);
          break;
        case 'pick-on-screen':
          handlePickOnScreen(action.item);
          break;
        case 'toast':
          showToast(action.msg, action.opts);
          break;
      }
    });
    return off;
  }, [handleSaveItem, handleRequestAdvanced, handlePickOnScreen, showToast]);

  // Cleanup when the satellite window is destroyed (user closed it,
  // OS killed it, ESC pressed inside, etc.). Mirrors the inline
  // ItemDialog's onClose handler.
  useEffect(() => {
    const off = electronAPI.onItemDialogClosed(() => {
      if (dialog !== 'item') return; // not our dialog state
      tutorialTriggers.fire('item-dialog-cancelled');
      setDialog('none');
      setEditItem(null);
      setPrefilledItem(null);
      setItemDialogStartAdvanced(false);
    });
    return off;
  }, [dialog]);

  // ── Satellite ItemWizard bridge (v1.3.44+) ──────────────────────
  // The quick-add ('quickadd') and manual-add ('wizard') flows used to
  // be two separate inline <ItemWizard> renders. Both now go through
  // the same satellite — mode='quick' vs 'manual' threaded via payload.
  useEffect(() => {
    if (dialog !== 'quickadd' && dialog !== 'wizard') return;
    electronAPI.openItemWizard({
      mode: dialog === 'quickadd' ? 'quick' : 'manual',
      spaces: data.spaces,
      defaultSpaceId: editSpaceId,
      docExtensions: data.settings.documentExtensions,
      accentColor: data.settings.accentColor,
    });
  }, [
    dialog, editSpaceId, data.spaces,
    data.settings.documentExtensions, data.settings.accentColor,
  ]);

  useEffect(() => {
    const off = electronAPI.onItemWizardAction((action) => {
      if (action.kind === 'save') {
        handleSaveItem(action.spaceId, action.item);
        setDialog('none');  // race-fix — data.spaces change re-trigger guard
      } else if (action.kind === 'save-as-memo') {
        // SSOT parity with the top gateway banner — clipboard text gets
        // two commit destinations (card or memo) everywhere.
        const newItem = store.addMemo(action.spaceId, action.body);
        if (newItem) {
          const space = data.spaces.find(s => s.id === action.spaceId);
          tutorialTriggers.fire('memo-created', { itemId: newItem.id, spaceId: action.spaceId, fromClipboard: true });
          pushUndo({
            description: '메모 추가 (클립보드)',
            undo: () => store.deleteItem(action.spaceId, newItem.id),
            redo: () => store.restoreItem(action.spaceId, newItem),
          });
          showToast(`메모로 저장됨${space ? ` · ${space.name}` : ''}`, { duration: 4000 });
          // NOTE: the original inline render passed an "열기" toast
          // action button that called setEditingMemoId. Closures can't
          // cross IPC — same Phase 2-polish limitation noted for
          // ItemDialog's 꾸미기 toast.
        }
        setDialog('none');
      }
    });
    return off;
  }, [handleSaveItem, store, data.spaces, showToast, pushUndo]);

  useEffect(() => {
    const off = electronAPI.onItemWizardClosed(() => {
      if (dialog !== 'quickadd' && dialog !== 'wizard') return;
      setDialog('none');
    });
    return off;
  }, [dialog]);

  // ── Satellite SettingsDialog bridge (v1.3.44+) ─────────────────
  useEffect(() => {
    if (dialog !== 'settings') return;
    electronAPI.openSettingsDialog({
      settings: data.settings,
      updateDownloaded,
      downloadProgress,
      initialTab: settingsInitialTab,
      accentColor: data.settings.accentColor,
    });
  }, [dialog, data.settings, updateDownloaded, downloadProgress, settingsInitialTab]);

  useEffect(() => {
    const off = electronAPI.onSettingsDialogAction((action) => {
      switch (action.kind) {
        case 'save':
          // Live-preview path — slider drags, switch toggles. Frequency
          // ~60Hz during drags but payload is small. store.updateSettings
          // is idempotent (v1.3.42 hotfix) so no infinite-loop risk.
          store.updateSettings(action.settings);
          break;
        case 'start-tutorial':
          tutorialApiRef.current?.start(action.quest as never);
          break;
        case 'open-memo-trash':
          // Open the trash dialog — close settings first (matches the
          // inline render's behaviour).
          setDialog('none');
          setSettingsInitialTab(undefined);
          setMemoTrashOpen(true);
          break;
        case 'extend-all-memos':
          store.extendAllMemos();
          break;
        case 'empty-memo-trash':
          store.emptyMemoTrash();
          break;
      }
    });
    return off;
  }, [store]);

  useEffect(() => {
    const off = electronAPI.onSettingsDialogClosed(() => {
      if (dialog !== 'settings') return;
      setDialog('none');
      setSettingsInitialTab(undefined);
    });
    return off;
  }, [dialog]);

  // ── Satellite DocCohortDialog bridge ────────────────────────────
  useEffect(() => {
    if (!cohortTarget) return;
    const space = data.spaces.find(s => s.id === cohortTarget.spaceId);
    const item  = space?.items.find(i => i.id === cohortTarget.itemId);
    if (!item) return;
    const cohortSettings = data.settings.docCohort ?? { enabledPresets: [], labelOrder: [] };
    electronAPI.openDocCohortDialog({
      item,
      enabledPresets: cohortSettings.enabledPresets,
      labelOrder: cohortSettings.labelOrder,
      accentColor: data.settings.accentColor,
    });
  }, [cohortTarget, data.spaces, data.settings.docCohort, data.settings.accentColor]);

  useEffect(() => {
    const off = electronAPI.onDocCohortDialogAction((action) => {
      if (action.kind === 'commit') {
        handleCohortCommit(action.next);
        setCohortTarget(null);
      }
    });
    return off;
  }, [handleCohortCommit]);

  useEffect(() => {
    const off = electronAPI.onDocCohortDialogClosed(() => {
      setCohortTarget(null);
    });
    return off;
  }, []);

  // ── Satellite BatchDropDialog bridge ────────────────────────────
  useEffect(() => {
    if (!batchDrop) return;
    electronAPI.openBatchDropDialog({
      items: batchDrop.items,
      spaces: data.spaces,
      defaultSpaceId: batchDrop.spaceId,
      accentColor: data.settings.accentColor,
    });
  }, [batchDrop, data.spaces, data.settings.accentColor]);

  useEffect(() => {
    const off = electronAPI.onBatchDropDialogAction((action) => {
      if (action.kind === 'confirm') {
        handleBatchConfirm(action.spaceId, action.items);
        setBatchDrop(null);
      }
    });
    return off;
  }, [handleBatchConfirm]);

  useEffect(() => {
    const off = electronAPI.onBatchDropDialogClosed(() => {
      setBatchDrop(null);
    });
    return off;
  }, []);

  // ── Satellite ContainerSlotPicker bridge ────────────────────────
  useEffect(() => {
    if (dialog !== 'container-slots' || !containerSlotItem) return;
    const item = allItems.find(i => i.id === containerSlotItem.itemId);
    if (!item) return;
    electronAPI.openContainerSlotPicker({
      containerItem: item,
      containerSpaceId: containerSlotItem.spaceId,
      defaultDir: containerSlotItem.defaultDir,
      allSpaces: data.spaces,
      accentColor: data.settings.accentColor,
    });
  }, [dialog, containerSlotItem, allItems, data.spaces, data.settings.accentColor]);

  useEffect(() => {
    const off = electronAPI.onContainerSlotPickerAction((action) => {
      if (action.kind === 'save') {
        handleSaveSlots(action.slots, action.removals, action.newItems);
        setDialog('none');
        setContainerSlotItem(null);
      }
    });
    return off;
  }, [handleSaveSlots]);

  useEffect(() => {
    const off = electronAPI.onContainerSlotPickerClosed(() => {
      if (dialog !== 'container-slots') return;
      setDialog('none');
      setContainerSlotItem(null);
    });
    return off;
  }, [dialog]);

  return (
    <AppStateProvider value={appState}>
    <AppActionsProvider value={appActions}>
    <TooltipProvider delay={500}>
    <TutorialProvider
      data={data}
      showToast={showToast}
      addNotification={store.addNotification}
      deleteItem={(sid, iid) => store.deleteItem(sid, iid)}
      deleteSpace={(sid) => store.deleteSpace(sid)}
      deleteMemo={(sid, iid) => store.deleteItem(sid, iid)}
      isBusy={() => dialog !== 'none'}
      onApiReady={(api) => { tutorialApiRef.current = api; }}
    >
      <div style={{ position: 'fixed', inset: '6px', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
        {/* Glass card */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleFileDrop}
          style={{
            flex: 1,
            display: 'flex',
            // Glass card is now a COLUMN so the StatusBar (last child)
            // can span full width at the bottom — previously it was
            // a row, which left the bar tucked inside the main-content
            // column and visually misaligned with NodePanel's bottom
            // edge. The actual sidebar/main/right tri-column layout
            // lives in the inner div below.
            flexDirection: 'column',
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
        {/* Inner row: sidebar + main + right panel. Wraps the original
            tri-column layout so the new StatusBar at the bottom isn't
            forced into the row. flex:1 makes it consume all height
            above the bar. */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
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
            onRecommendClick={() => handleToggleRecommend()}
          />

          {/* ── Unified DnD: space grip (left-click) + card right-click drag ───── */}
          <DndContext
            sensors={allSensors}
            collisionDetection={pointerFirstCollision}
            onDragStart={e => {
              const activeId = e.active.id as string;
              // Mark busy so auto-popups (welcome wizard, tour starts) defer
              // until the user finishes / cancels the drag. Cleared in
              // onDragCancel and at the end of handleAllDragEnd.
              setBusy('drag', true);
              if (data.spaces.some(s => s.id === activeId)) setDraggingSpaceId(activeId);
              else setDraggingItemId(activeId);
            }}
            onDragMove={e => {
              const activeId = e.active.id as string;
              const isSpaceDrag = data.spaces.some(s => s.id === activeId);

              // ── Item drag → bloom controller ────────────────────
              // Runs only when dragging an item (not a space). Track
              // pointer position vs container rects + bloom zones to
              // open / update / collapse the bloom overlay.
              if (!isSpaceDrag) {
                const start = e.activatorEvent as PointerEvent | MouseEvent | undefined;
                if (!start) return;
                const px = (start.clientX ?? 0) + e.delta.x;
                const py = (start.clientY ?? 0) + e.delta.y;

                // If bloom is currently open, hit-test its zones first
                // and check whether the pointer is still in the bloom's
                // expanded area (container + 80px halo). If yes, just
                // update the hot direction; if no, collapse.
                if (bloomState) {
                  const r = bloomState.containerRect;
                  const inHalo =
                    px >= r.left   - 80 && px <= r.right  + 80 &&
                    py >= r.top    - 80 && py <= r.bottom + 80;
                  if (inHalo) {
                    const zone = hitTestBloomZone(r, { x: px, y: py });
                    if (zone !== bloomState.hotDir) {
                      setBloomState(s => s ? { ...s, hotDir: zone } : s);
                    }
                    return;
                  }
                  // Pointer wandered off — collapse bloom and let the
                  // rest of the move handler re-evaluate (could land
                  // on another container).
                  closeBloom();
                }

                // Bloom not active — find a container under the pointer.
                // We use dnd-kit's `over` first as a fast path (it
                // already does collisionDetection); fall back to nothing
                // (we don't manually iterate — rare miss is acceptable
                // and avoids an O(N) hit-test on every move).
                const overId = e.over?.id ? String(e.over.id) : null;
                if (!overId || overId === activeId) {
                  clearBloomCandidate();
                  return;
                }

                // Locate the container item and verify it's actually a
                // container (not a regular card with the same id space).
                let foundSpaceId: string | null = null;
                let foundContainer: import('./types').LauncherItem | null = null;
                for (const sp of data.spaces) {
                  const it = sp.items.find(i => i.id === overId);
                  if (it) {
                    if (it.isContainer) { foundSpaceId = sp.id; foundContainer = it; }
                    break;
                  }
                }
                if (!foundContainer || !foundSpaceId || foundContainer.id === activeId) {
                  clearBloomCandidate();
                  return;
                }

                // Same candidate as before — let the dwell timer keep
                // running. New candidate — restart the timer.
                if (bloomCandidateRef.current?.containerId !== foundContainer.id) {
                  clearBloomCandidate();
                  const cId = foundContainer.id;
                  const sId = foundSpaceId;
                  const accent = foundContainer.color;
                  bloomCandidateRef.current = {
                    containerId: cId,
                    timer: setTimeout(() => {
                      const el = document.querySelector(`[data-card-id="${cId}"]`);
                      if (!el) return;
                      setBloomState({
                        containerSpaceId: sId,
                        containerId: cId,
                        containerRect: el.getBoundingClientRect(),
                        accent,
                        hotDir: null,
                      });
                      bloomCandidateRef.current = null;
                    }, 250),
                  };
                }
                return;
              }
              // (else falls through to the existing space-drag edge logic.)

              // Resolve target via dnd-kit's `over` first. `over.id` may be
              // either the SortableSpace id (space.id) or the file-drop
              // droppable id (`drop-space-<id>`); strip the prefix to always
              // land on a real space id.
              const overIdRaw = e.over?.id ? String(e.over.id) : null;
              let overId: string | null = overIdRaw?.startsWith('drop-space-')
                ? overIdRaw.slice('drop-space-'.length)
                : overIdRaw;

              // Compute cursor-relative rect early — we may also need it for
              // the fallback below.
              const start = e.activatorEvent as PointerEvent | MouseEvent | undefined;
              if (!start) return;
              const cx0 = (start.clientX ?? 0) + e.delta.x;
              const cy0 = (start.clientY ?? 0) + e.delta.y;

              // Fallback: when closestCorners loses the `over` at the extreme
              // right edge of a narrow pair-half, iterate the visible space
              // rects and pick whichever one contains the cursor. This plugs
              // the "drop on right edge doesn't stick" bug without changing
              // the global collisionDetection.
              if (!overId) {
                const els = document.querySelectorAll<HTMLElement>('[data-space-id]');
                for (const el of Array.from(els)) {
                  const r = el.getBoundingClientRect();
                  if (cx0 >= r.left && cx0 <= r.right && cy0 >= r.top && cy0 <= r.bottom) {
                    overId = el.dataset.spaceId ?? null;
                    break;
                  }
                }
              }

              if (!overId || overId === activeId) {
                setDragOverEdge(prev => prev === null ? prev : null);
                return;
              }

              // Resolve the space's rect via DOM lookup for the edge math. The
              // SortableSpace root carries data-space-id=<id>.
              const spaceEl = document.querySelector(`[data-space-id="${overId}"]`) as HTMLElement | null;
              if (!spaceEl) {
                setDragOverEdge(prev => prev === null ? prev : null);
                return;
              }

              // Compute cursor X relative to the target space for left/center/right classification.
              // (cx0 was already resolved above for the null-over fallback.)
              const rect = spaceEl.getBoundingClientRect();
              const rx = cx0 - rect.left;
              const w = rect.width;

              // Edge zone sizing: 35% of the target width OR 80px, whichever
              // is larger. Ratio-only (the previous 25% / 75%) made the right
              // zone too small on narrow spaces (e.g. right half of a pair)
              // so users couldn't reliably hit it; the 80px floor guarantees
              // a comfortable target on any space width.
              const edgeZone = Math.max(80, w * 0.35);
              const edge: 'left' | 'right' | 'center' =
                rx < edgeZone ? 'left'
                : rx > w - edgeZone ? 'right'
                : 'center';

              // A left/right drop is blocked when the target's row is already a
              // pair AND the dragged space isn't its current partner. Center
              // drops are always allowed (they create a new solo row below the pair).
              const targetRowIsPair = isSpaceInPair(data.spaces, overId);
              const blocked = targetRowIsPair && edge !== 'center'
                && !isSameRowNeighbor(data.spaces, overId, activeId);
              setDragOverEdge(prev =>
                (prev?.overId === overId && prev.edge === edge && !!prev.blocked === blocked)
                  ? prev : { overId, edge, blocked }
              );
            }}
            onDragCancel={() => { setDraggingItemId(null); setDraggingSpaceId(null); setDragOverEdge(null); closeBloom(); setBusy('drag', false); }}
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

            {/* Preset toggle — three independent workspace slots */}
            <PresetToggle
              presets={store.presets}
              activeId={store.activePresetId}
              lockedIds={(['1','2','3'] as const).filter(id => !entitlement.canUsePreset(id))}
              onSelect={id => {
                if (!quotaChecks.preset(id)) return;
                const from = store.activePresetId;
                store.setActivePreset(id);
                if (from !== id) tutorialTriggers.fire('preset-switched', { from, to: id, via: 'click' });
              }}
              onRename={(id, label) => store.renamePreset(id, label)}
            />

            {/* Search — inert while a tool is active (data-mode-dim) */}
            <div
              data-tour-id="search-input"
              style={{ flex: 1, position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              data-mode-dim="true"
            >
              <Icon name={isSlashMode ? 'terminal' : 'search'} size={15} color={isSlashMode ? 'var(--accent)' : 'var(--text-dim)'} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setSlashSelectedIdx(0); }}
                onKeyDown={handleSearchKeyDown}
                placeholder="빠른 검색... (/ 로 명령어)"
                style={{
                  width: '100%',
                  background: 'var(--surface)',
                  border: `1px solid ${isSlashMode ? 'var(--accent)' : 'var(--border-rgba)'}`,
                  borderRadius: isSlashMode && slashSuggestions.length > 0 ? '6px 6px 0 0' : '6px',
                  padding: '5px 10px 5px 28px',
                  color: 'var(--text-color)',
                  fontSize: '12px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.1s',
                }}
                onFocus={e => {
                  if (!isSlashMode) e.target.style.borderColor = 'var(--border-focus)';
                  tutorialTriggers.fire('search-focused');
                }}
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
                    border: '1px solid var(--accent)',
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

            {/* Header actions — marked data-mode-dim so they go inert while
                a tool is active (CSS in index.css picks this up). Close
                stays interactive so the user can always dismiss the window. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              {/* Notification bell — placed before the gear so the
                  visual rhythm reads "things → preferences → close".
                  data-mode-dim so it's inert during tool modes (the
                  user shouldn't be opening notifications while in the
                  middle of a node-build). */}
              <div data-mode-dim="true">
                <NotificationBell
                  notifications={store.notifications}
                  open={notifPanelOpen}
                  onToggle={() => setNotifPanelOpen(o => !o)}
                  onDismiss={(id) => store.dismissNotification(id)}
                  onDismissAll={() => store.dismissAllNotifications()}
                  onMarkAllRead={() => store.markAllNotificationsRead()}
                  onAction={handleNotificationAction}
                />
              </div>
              {(() => {
                // Free-tier 한도 nudge: 스페이스 개수가 80% 이상이면 색 변화,
                // 도달하면 자물쇠 아이콘 + tooltip 으로 안내.
                const spaceCount = data.spaces.length;
                const spaceMax = entitlement.limits.spaces;
                const spaceFull = Number.isFinite(spaceMax) && spaceCount >= spaceMax;
                const spaceNear = Number.isFinite(spaceMax) && spaceCount / spaceMax >= 0.75;
                const spaceCountLabel = Number.isFinite(spaceMax) ? ` (${spaceCount}/${spaceMax})` : '';
                const buttons = [
                  {
                    icon: spaceFull ? 'lock' : 'add_circle',
                    title: spaceFull
                      ? `한도 도달 — Pro 로 업그레이드해서 추가${spaceCountLabel}`
                      : `새 스페이스${spaceCountLabel}`,
                    fn: () => { if (quotaChecks.space()) addSpaceWithTrigger(); },
                    dim: true, tourId: 'header-add-space',
                    nearLimit: spaceNear, atLimit: spaceFull,
                  },
                  { icon: 'settings', title: '환경설정', fn: () => setDialog('settings'), dim: true,  tourId: 'header-settings', nearLimit: false, atLimit: false },
                  { icon: 'close',    title: '닫기(Esc)', fn: () => electronAPI.hideApp(), dim: false, tourId: undefined,         nearLimit: false, atLimit: false },
                ];
                return buttons.map(btn => (
                  <button
                    key={btn.icon}
                    onClick={btn.fn}
                    title={btn.title}
                    className="action-icon-btn"
                    style={{
                      width: 28,
                      height: 28,
                      ...(btn.atLimit  ? { color: 'var(--accent)', opacity: 0.85 } : {}),
                      ...(btn.nearLimit && !btn.atLimit ? { color: 'var(--accent)' } : {}),
                    }}
                    {...(btn.dim ? { 'data-mode-dim': 'true' } : {})}
                    {...(btn.tourId ? { 'data-tour-id': btn.tourId } : {})}
                  >
                    <Icon name={btn.icon} size={17} />
                  </button>
                ));
              })()}
            </div>
          </div>

          {/* RecommendPanel — inline 3-column scan view. Bound to the
              same `ghostCards.active` toggle as the sidebar lightbulb so
              the panel and the per-space ghost suggestions appear and
              disappear together (one engine, two surfaces — see
              lib/scanEngine.ts). Lives INSIDE the main-content column so
              it pushes the spaces grid down by its height instead of
              overlaying (and hiding) the topmost spaces. */}
          <RecommendPanel
            open={ghostCards.active}
            spaces={data.spaces}
            onClose={handleToggleRecommend}
            onAddItems={(spaceId, items) => {
              for (const item of items) store.addItem(spaceId, item);
              showToast(`${items.length}개 항목 추가됨`);
            }}
          />

          {/* ── Clipboard gateway banner ──────────────────────
              Single banner, every detected clipboard type. Per-type
              chrome (icon, label, action set) is computed from a
              small map below so the JSX stays one shape. Hex gets
              a colour swatch instead of a Material icon since the
              swatch IS the value. Text gets two destinations
              (clipboard card / memo); url/app/folder/hex get one. */}
          {clipPrompt && (() => {
            const meta = (() => {
              switch (clipPrompt.type) {
                case 'url':    return { icon: 'link',         summary: 'URL이 복사되어 있어요',     primaryLabel: 'URL 카드로',    primaryIcon: 'language' };
                case 'app':    return { icon: 'apps',         summary: '앱 경로가 복사되어 있어요', primaryLabel: '앱 카드로',     primaryIcon: 'apps' };
                case 'doc':    return { icon: 'description',  summary: '문서 경로가 복사되어 있어요', primaryLabel: '문서 카드로',  primaryIcon: 'description' };
                case 'folder': return { icon: 'folder_open',  summary: '폴더 경로가 복사되어 있어요', primaryLabel: '폴더 카드로',  primaryIcon: 'folder' };
                case 'hex':    return { icon: 'palette',      summary: '컬러 코드가 복사되어 있어요', primaryLabel: '컬러 위젯으로', primaryIcon: 'palette' };
                case 'text':   return { icon: 'content_paste', summary: '텍스트가 복사되어 있어요',  primaryLabel: '클립보드 카드', primaryIcon: 'content_paste' };
              }
            })();
            const isHex  = clipPrompt.type === 'hex';
            const isText = clipPrompt.type === 'text';
            return (
              <div data-tour-id="gateway-banner" style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                borderBottom: '1px solid var(--border-rgba)',
                background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
                animation: 'slideDown 0.18s ease',
              }}>
                {/* Leading affordance — colour swatch for hex, icon for everything else. */}
                {isHex ? (
                  <span style={{
                    width: 14, height: 14, borderRadius: 4,
                    background: clipPrompt.value,
                    border: '1px solid var(--border-rgba)',
                    flexShrink: 0,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                  }} />
                ) : (
                  <Icon name={meta.icon} size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta.summary}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--text-color)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    maxWidth: 340,
                    fontFamily: (clipPrompt.type === 'url' || clipPrompt.type === 'folder' || clipPrompt.type === 'app' || clipPrompt.type === 'doc' || clipPrompt.type === 'hex')
                      ? 'ui-monospace, monospace'
                      : 'inherit',
                  }}>
                    {clipPrompt.label}
                  </span>
                </div>

                {/* Primary action — for text, this is "클립보드 카드";
                    for hex, "컬러 위젯으로"; for the rest, the
                    type-card label (URL/앱/폴더 카드로). Hex routes
                    to the instant-create swatch handler; everything
                    else opens ItemDialog with the prefill. */}
                <button
                  onClick={isHex ? handleClipPromptToColorSwatch : handleClipPromptToCard}
                  title={isHex
                    ? '컬러 스와치 위젯으로 즉시 추가 (이름 붙이기 다이얼로그가 열립니다)'
                    : '카드 추가 다이얼로그가 열립니다'}
                  style={{
                    height: 28, padding: '0 10px', borderRadius: 6,
                    background: isText ? 'var(--surface)' : 'var(--accent)',
                    border: `1px solid ${isText ? 'var(--border-rgba)' : 'var(--accent)'}`,
                    color: isText ? 'var(--text-color)' : '#fff',
                    fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                    cursor: 'pointer', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Icon name={meta.primaryIcon} size={12} color={isText ? 'currentColor' : '#fff'} />
                  {meta.primaryLabel}
                </button>

                {/* Text-only second action — memo. Long pasted prose
                    has a natural home in memos (auto html→md from
                    the rich clipboard); short text is more of a
                    clipboard-card thing. We expose both so the user
                    picks based on intent, not heuristic. */}
                {isText && (
                  <button
                    onClick={handleClipPromptToMemo}
                    title="첫 스페이스에 메모로 저장 — 마크다운 구조 자동 복원"
                    style={{
                      height: 28, padding: '0 10px', borderRadius: 6,
                      background: 'var(--accent)',
                      border: '1px solid var(--accent)',
                      color: '#fff',
                      fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                      cursor: 'pointer', flexShrink: 0,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <Icon name="sticky_note_2" size={12} />메모로
                  </button>
                )}

                <button
                  onClick={handleClipPromptDismiss}
                  title="닫기"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 4, display: 'flex', alignItems: 'center',
                    opacity: 0.55, flexShrink: 0,
                  }}
                >
                  <Icon name="close" size={13} color="var(--text-muted)" />
                </button>
              </div>
            );
          })()}

          {/* ── Screen-pick mode banner ──────────
              Shown while the user is in "pick a space by clicking
              one in the actual UI" mode (triggered from ItemDialog
              phase ③). The glow + cursor:pointer on every space is
              CSS-driven via [data-screen-picking="true"]. This bar
              just tells the user what's expected and gives an exit. */}
          {screenPicker && (
            <div style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 14px',
              borderBottom: '1px solid var(--accent)',
              background: 'color-mix(in srgb, var(--accent) 14%, var(--bg-rgba))',
              animation: 'slideDown 0.18s ease',
              color: 'var(--text-color)',
            }}>
              <Icon name="my_location" size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                  스페이스를 클릭해서 카드를 둘 곳을 골라주세요
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  ESC로 취소하고 다이얼로그로 돌아갑니다 · "{(screenPicker.partial as LauncherItem).title || (screenPicker.partial as LauncherItem).value}"
                </span>
              </div>
              <button
                onClick={() => cancelScreenPicker(true)}
                style={{
                  height: 28, padding: '0 12px', borderRadius: 7,
                  background: 'var(--surface)',
                  border: '1px solid var(--border-rgba)',
                  color: 'var(--text-muted)',
                  fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                  flexShrink: 0,
                }}
                title="ESC"
              >
                취소
              </button>
            </div>
          )}

          {/* ── Clean-mode action bar ────────────────
              Slides in below the title bar in the same inline slot as the
              clipboard-quick-add suggestion. Explains the tool, offers a
              one-shot sweep across every space, and a dedicated exit chip. */}
          {activeMode === 'clean' && (
            <div style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px 6px 12px',
              borderBottom: '1px solid var(--border-rgba)',
              background: 'var(--surface)',
              animation: 'slideDown 0.2s ease',
            }}>
              <style>{`@keyframes slideDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }`}</style>
              <Icon name="cleaning_services" size={13} color="var(--color-destructive)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>각 스페이스의 청소 버튼 또는 </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-destructive)' }}>한 번에 처리</span>
              </div>
              <button
                onClick={handleCleanAllSpaces}
                style={{
                  padding: '2px 8px',
                  borderRadius: 5,
                  border: '1px solid var(--color-destructive)',
                  background: 'var(--color-destructive)',
                  color: 'var(--color-destructive-foreground)',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <Icon name="delete_sweep" size={11} />
                모든 스페이스
              </button>
              <button
                onClick={() => setActiveMode('normal')}
                title="종료 (Esc)"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  opacity: 0.5,
                  flexShrink: 0,
                }}
              >
                <Icon name="close" size={13} color="var(--text-muted)" />
              </button>
            </div>
          )}

          {/* ── Spaces list ──────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 12px' }}>

            {/* Empty states */}
            {filteredSpaces.length === 0 && query && (
              <EmptyState
                kind="no-results"
                query={query}
                onAddBlank={() => { /* unused on this branch */ }}
                onOpenTemplates={() => { /* unused on this branch */ }}
              />
            )}
            {filteredSpaces.length === 0 && !query && (
              <EmptyState
                kind="no-spaces"
                presetLabel={store.presets.find(p => p.id === store.activePresetId)?.label}
                onAddBlank={() => { if (quotaChecks.space()) addSpaceWithTrigger(); }}
                onOpenTemplates={() => setWelcomeOpen(true)}
              />
            )}

            {/* ── Space ordering DnD (Phase 3: solo/pair rows) ── */}
            {/* data-tour-id="space-list" anchors the basicsTour 'card-click'
                step and the floatingTour spotlight. The wrapper div doesn't
                affect layout — it's sized by its children (display: contents
                isn't used because dnd-kit needs a real bounding rect to
                measure when targeting). */}
              <SortableContext items={filteredSpaces.map(s => s.id)} strategy={rectSortingStrategy}>

                  {(() => {
                    // Build rows from the currently filtered (search-aware) spaces.
                    // Rendering is a vertical flex column of rows; each row is a
                    // CSS grid with 1 column (solo) or two fractional columns (pair).
                    const rows = computeRows(filteredSpaces);

                    // Free 한도 nudge: 활성 프리셋의 모든 스페이스를 통틀어
                    // 카드 총합을 한 번 계산하고, 각 SpaceAccordion 에 동일
                    // limit-state 를 전달. limit 은 preset-wide 라서 어느 스페이스
                    // 의 +추가 버튼이든 같은 시각 상태를 보여야 함.
                    const totalCards = (data.spaces ?? []).reduce(
                      (n, s) => n + (s.items ?? []).length, 0,
                    );
                    const cardMax = entitlement.limits.totalCards;
                    const cardLimitLabel = Number.isFinite(cardMax) ? `${totalCards} / ${cardMax}` : undefined;
                    const cardLimitState: 'ok' | 'near' | 'full' = !Number.isFinite(cardMax)
                      ? 'ok'
                      : totalCards >= cardMax ? 'full'
                      : totalCards / cardMax >= 0.75 ? 'near'
                      : 'ok';

                    const renderSpace = (space: Space, pairPartnerId?: string, currentSplitRatio?: number) => (
                      <SortableSpace
                        key={space.id}
                        id={space.id}
                        dropEdge={dragOverEdge?.overId === space.id ? dragOverEdge.edge : undefined}
                        dropBlocked={dragOverEdge?.overId === space.id ? dragOverEdge.blocked : undefined}
                        pairPartnerId={pairPartnerId}
                        currentSplitRatio={currentSplitRatio}
                        onSplitRatioChange={pairPartnerId ? (r => store.setPairSplitRatio(space.id, r)) : undefined}
                      >
                        {dragActivator => (
                          <SpaceAccordion
                            space={space}
                            headerDragActivator={dragActivator}
                            cardLimitState={cardLimitState}
                            cardLimitLabel={cardLimitLabel}
                            onRename={name => {
                              const prevName = space.name;
                              if (prevName === name) return;
                              store.renameSpace(space.id, name);
                              tutorialTriggers.fire('space-renamed', { spaceId: space.id, name });
                              pushUndo({
                                description: `스페이스 이름 변경`,
                                undo: () => store.renameSpace(space.id, prevName),
                                redo: () => store.renameSpace(space.id, name),
                              });
                            }}
                            onDelete={() => handleDeleteSpace(space.id)}
                            onDuplicate={() => store.duplicateSpace(space.id)}
                            onSetColor={color => store.setSpaceColor(space.id, color)}
                            onSetIcon={icon => store.setSpaceIcon(space.id, icon)}
                            // Move-to-preset menu — only show targets the
                            // user can actually reach (filter the current
                            // preset and Pro-locked ones via entitlement).
                            movePresets={(['1','2','3'] as const)
                              .filter(id => id !== store.activePresetId && entitlement.canUsePreset(id))
                              .map(id => ({
                                id,
                                label: store.presets.find(p => p.id === id)?.label ?? `프리셋 ${id}`,
                              }))}
                            onMoveToPreset={(target) => {
                              store.moveSpaceToPreset(space.id, target);
                              showToast(`프리셋 ${target}로 이동했어요`);
                            }}
                            onToggleCollapse={() => store.toggleSpaceCollapsed(space.id)}
                            onEditItem={item => openEditItem(item, space.id)}
                            onDeleteItem={itemId => handleDeleteItem(space.id, itemId)}
                            onIncrementClick={itemId => store.incrementClickCount(space.id, itemId)}
                            onSortByUsage={() => store.sortSpaceByUsage(space.id)}
                            onTogglePin={itemId => handleTogglePin(space, itemId)}
                            onQuickAdd={() => openQuickAdd(space.id)}
                            onAddItem={() => openManualWizard(space.id)}
                            onScanItem={() => openScan(space.id)}
                            onAddWidget={() => handleAddWidget(space.id)}
                            onAddColorSwatch={() => handleAddColorSwatch(space.id)}
                            onAddMemo={() => handleAddMemo(space.id)}
                            onOpenMemoEditor={(itemId) => {
                              setEditingMemoId({ spaceId: space.id, itemId });
                              tutorialTriggers.fire('memo-editor-opened', { spaceId: space.id, itemId });
                            }}
                            onCopyMemoBody={(itemId) => handleCopyMemoBody(space.id, itemId)}
                            onCopyMemoMarkdown={(itemId) => handleCopyMemoMarkdown(space.id, itemId)}
                            onExtendMemoTtl={(itemId) => handleExtendMemoTtl(space.id, itemId)}
                            onExportMemoTxt={(itemId) => handleExportMemoTxt(space.id, itemId)}
                            defaultOpen={!(data.collapsedSpaceIds ?? []).includes(space.id)}
                            onSetMonitor={(itemId, monitor) => handleSetMonitor(space.id, itemId, monitor)}
                            onConvertToContainer={itemId => { if (quotaChecks.container()) handleConvertToContainer(space.id, itemId); }}
                            onConvertFromContainer={itemId => handleConvertFromContainer(space.id, itemId)}
                            onEditSlots={(itemId, dir) => handleEditSlots(space.id, itemId, dir)}
                            onCheckDocCohort={(itemId) => handleCheckDocCohort(space.id, itemId)}
                            ghostItems={ghostCards.ghostsForSpace(space.id)}
                            onGhostAccept={(ghost) => {
                              if (!quotaChecks.card()) return;
                              const newItem = store.addItem(ghost.spaceId, { title: ghost.title, value: ghost.value, type: ghost.type });
                              ghostCards.accept(ghost);
                              if (newItem) {
                                pushUndo({
                                  description: `"${ghost.title}" 추가 (감지)`,
                                  undo: () => store.deleteItem(ghost.spaceId, newItem.id),
                                  redo: () => store.restoreItem(ghost.spaceId, newItem),
                                });
                              }
                              showToast(`"${ghost.title}" 추가됨`);
                            }}
                            onGhostDismiss={(value) => ghostCards.dismiss(value)}
                            fileDragActive={fileDragOver}
                            fileDragTarget={fileDragTargetSpaceId === space.id}
                            onFileDragEnter={() => setFileDragTargetSpaceId(space.id)}
                            onFileDragLeave={() => setFileDragTargetSpaceId(prev => prev === space.id ? null : prev)}
                            onFloatOut={() => {
                              pinAsFloating('space', space.id);
                              tutorialTriggers.fire('floating-converted', { kind: 'space', spaceId: space.id });
                            }}
                            isFloating={spacesFloating.has(space.id)}
                          />
                        )}
                      </SortableSpace>
                    );

                    return (
                      <div
                        ref={gridContainerRef}
                        data-tour-id="space-list"
                        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                      >
                        {/* Today-expiring memos banner — counts across the
                            ACTIVE preset only (other presets' memos aren't
                            on-screen so warning about them is noise). One
                            click "지금 보기" jumps to the first space that
                            has an expiring memo. Closeable; reappears next day. */}
                        {(() => {
                          const ymd = (() => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; })();
                          if (bannerDismissedYmd === ymd) return null;
                          const now = Date.now();
                          let count = 0;
                          let firstSpaceId: string | null = null;
                          for (const sp of data.spaces) {
                            for (const it of sp.items) {
                              if (it.type === 'memo' && memoIsExpiringSoon(it, now)) {
                                count++;
                                if (!firstSpaceId) firstSpaceId = sp.id;
                              }
                            }
                          }
                          return (
                            <MemoExpiringBanner
                              count={count}
                              onView={() => {
                                if (!firstSpaceId) return;
                                const el = document.querySelector(`[data-space-id="${firstSpaceId}"]`);
                                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }}
                              onDismiss={() => setBannerDismissedYmd(ymd)}
                            />
                          );
                        })()}
                        {rows.map(row => {
                          const isPair = !!row.rightSpace;
                          return (
                            <div
                              key={row.leftSpace.id}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: isPair
                                  ? `${row.leftRatio}fr ${1 - row.leftRatio}fr`
                                  : '1fr',
                                gap: 8,
                                alignItems: 'stretch',
                              }}
                            >
                              {renderSpace(row.leftSpace, isPair ? row.rightSpace!.id : undefined, row.leftRatio)}
                              {row.rightSpace && renderSpace(row.rightSpace)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

              </SortableContext>

              {/* The bottom "추천 항목" ghost space was here — retired
                  per user directive. Smart recommendations now live
                  exclusively in the top-of-screen RecommendPanel
                  (lightbulb sidebar tool); duplicating them at the
                  bottom of the main column was redundant scroll noise.
                  Per-space ghost cards inside each SpaceAccordion are
                  kept since they're contextually scoped. */}

          </div>

          </div>{/* close main content */}

          {/* ── Right Panel: Node + Deck (tabs) ──── */}
          <NodePanel
            draggingItemId={draggingItemId}
            nodeGroups={nodeGroups}
            allItems={allItems}
            nodeEditMode={nodeEditMode}
            nodeBuilding={nodeBuilding}
            onStartEdit={() => { if (quotaChecks.node()) handleStartNodeEdit(); }}
            onCancelEdit={handleCancelNodeEdit}
            onRemoveFromBuilding={id => setNodeBuilding(prev => prev.filter(x => x !== id))}
            onSaveGroup={handleSaveNodeGroup}
            onLaunchGroup={handleNodeGroupLaunch}
            onDeleteGroup={store.deleteNodeGroup}
            onRenameGroup={(id, name) => store.updateNodeGroup(id, { name })}
            onReorderGroupItems={(id, itemIds) => store.updateNodeGroup(id, { itemIds })}
            onUpdateGroup={(id, patch) => store.updateNodeGroup(id, patch)}
            onStartEditExistingGroup={handleStartEditExistingGroup}
            onEndEditExistingGroup={handleCancelNodeEdit}
            editingNodeGroupId={editingNodeGroupId}
            monitorCount={monitorCount}
            decks={decks}
            deckBuilding={deckBuilding}
            deckItems={deckItems}
            onStartDeckBuild={() => { if (quotaChecks.deck()) handleModeChange('deck'); }}
            onCancelDeckBuild={() => { setDeckBuilding(false); setDeckItems([]); setActiveMode('normal'); }}
            onRemoveFromDeckBuilding={id => setDeckItems(prev => prev.filter(x => x !== id))}
            onSaveDeck={handleSaveDeck}
            onLaunchDeck={handleDeckLaunch}
            onDeleteDeck={store.deleteDeck}
            onUpdateDeck={(id, patch) => store.updateDeck(id, patch)}
            onFloatOutNode={id => pinAsFloating('node', id)}
            onFloatOutDeck={id => pinAsFloating('deck', id)}
            floatingNodeIds={nodesFloating}
            floatingDeckIds={decksFloating}
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
        </div>{/* close inner-row */}

        {/* ── Update progress strip — spans full glass-card width ──── */}
        {(downloadProgress != null || updateDownloaded) && (
          <div style={{
            flexShrink: 0,
            borderTop: '1px solid var(--border-rgba)',
            background: 'var(--surface)',
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            {updateDownloaded ? (
              <>
                <Icon name="system_update" size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                  {updateNewVer ? `v${updateNewVer}` : '업데이트'} 준비됨
                </span>
                <button
                  onClick={() => electronAPI.installUpdate()}
                  style={{
                    flexShrink: 0, padding: '4px 12px', borderRadius: 6,
                    background: 'var(--accent)', border: 'none',
                    color: '#fff', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <Icon name="restart_alt" size={13} />
                  재시작하여 설치
                </button>
              </>
            ) : (
              <>
                <Icon name="download" size={14} color="var(--text-dim)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10, color: 'var(--text-dim)' }}>
                    <span>{updateNewVer ? `v${updateNewVer} 다운로드 중...` : '업데이트 다운로드 중...'}</span>
                    <span>{downloadProgress}%</span>
                  </div>
                  <div style={{ height: 3, background: 'var(--border-rgba)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      width: `${downloadProgress}%`, height: '100%',
                      background: 'var(--accent)', borderRadius: 2,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Persistent status bar — spans full glass-card width ───── */}
        <StatusBar
          sizePct={data.settings.windowSizePct ?? DEFAULT_WINDOW_SIZE_PCT}
          onSizePctChange={(p) => store.updateSettings({ ...data.settings, windowSizePct: p })}
        />

        </div>{/* close glass-card */}
      </div>{/* close outer fixed div */}

      {/* ── Node Tile Overlay (after split-screen launch) ─────── */}
      <TileOverlay
        items={tileOverlayItems}
        leaving={tileOverlayLeaving}
        onDismiss={dismissTileOverlay}
        onMaximize={handleMaximizeFromOverlay}
      />

      {/* ── Toast ────────────────────────────────────────────── */}
      <ToastOverlay
        toasts={toasts}
        onPause={pauseToast}
        onResume={resumeToast}
        onDismiss={dismissToast}
      />

      {/* ── Memo inplace editor (사라지는 메모) ───────────────────
          Renders ABOVE everything as a fixed overlay sheet. Zero new
          BrowserWindow created — see MemoEditor docstring for why.
          Lookup runs through every preset because the user might have
          opened a memo, then switched preset (we want the editor to
          keep working). When the underlying item disappears (e.g. a
          preset wipe), the editor self-closes by detecting null. */}
      {(() => {
        if (!editingMemoId) return null;
        let foundItem: LauncherItem | undefined;
        let foundSpace = data.spaces.find(s => s.id === editingMemoId.spaceId);
        let foundPresetId = store.activePresetId;
        if (foundSpace) {
          foundItem = foundSpace.items.find(i => i.id === editingMemoId.itemId);
        }
        if (!foundItem) {
          // Cross-preset fallback — search all presets in case the user
          // navigated away. Keep editing target until user explicitly closes.
          for (const p of store.presets) {
            for (const sp of p.spaces) {
              const it = sp.items.find(i => i.id === editingMemoId.itemId);
              if (it && it.type === 'memo') {
                foundItem = it;
                foundSpace = sp;
                foundPresetId = p.id;
                break;
              }
            }
            if (foundItem) break;
          }
        }
        if (!foundItem || !foundSpace) {
          // Underlying memo got hard-deleted while editor was open. Close.
          setTimeout(() => setEditingMemoId(null), 0);
          return null;
        }
        const presetForUpdate = foundPresetId;
        const spaceIdForUpdate = foundSpace.id;
        const item = foundItem;
        const isPinned = (foundSpace.pinnedIds ?? []).includes(item.id);
        const exportFolder = data.settings.memo?.exportFolder;
        return (
          <MemoEditor
            key={item.id}
            item={item}
            pinned={isPinned}
            exportFolder={exportFolder}
            showToast={showToast}
            canUseMarkdownEditor={entitlement.canUseMemoMarkdownEditor()}
            canUseMarkdownCleanup={entitlement.canUseMemoMarkdownCleanup()}
            canUseMdExport={entitlement.canUseMemoMdExport()}
            onUpgradePrompt={(reason) => {
              if (reason === 'md-export') openPaywall('memo-md-export-lock');
              else if (reason === 'folder-sync') openPaywall('memo-folder-sync-lock');
              else openPaywall('memo-markdown-lock');
            }}
            onChangeBody={(body) => {
              // updateMemoBody only writes to the active preset. If the
              // user navigated away from the source preset mid-edit,
              // we'd silently lose the write — so pre-flight by switching
              // back to the owning preset just before the write. Cheap:
              // switching is immediate (mirror swap) and idempotent.
              if (store.activePresetId !== presetForUpdate) {
                store.setActivePreset(presetForUpdate as typeof store.activePresetId);
              }
              store.updateMemoBody(spaceIdForUpdate, item.id, body);
            }}
            onClose={() => setEditingMemoId(null)}
            onExtend={() => {
              if (store.activePresetId !== presetForUpdate) {
                store.setActivePreset(presetForUpdate as typeof store.activePresetId);
              }
              store.extendMemo(spaceIdForUpdate, item.id);
            }}
            onTogglePin={() => handleTogglePin(foundSpace!, item.id)}
            onTrash={() => {
              store.trashMemo(spaceIdForUpdate, item.id);
              setEditingMemoId(null);
              showToast('휴지통으로 이동했어요');
            }}
            onAutoDeleteIfEmpty={() => {
              store.deleteItem(spaceIdForUpdate, item.id);
            }}
          />
        );
      })()}

      {/* ── Memo trash dialog ──────────────────────────────────── */}
      <MemoTrashDialog
        open={memoTrashOpen}
        onClose={() => setMemoTrashOpen(false)}
        data={data}
        onRestore={(presetId, spaceId, itemId) => {
          if (store.activePresetId !== presetId) {
            store.setActivePreset(presetId as typeof store.activePresetId);
          }
          // Setting a fresh expiresAt + clearing trashedAt is exactly what
          // extendMemo does. (extendMemo also clears trashedAt — see hook.)
          store.extendMemo(spaceId, itemId);
          showToast('메모를 되살렸어요');
        }}
        onHardDelete={(presetId, spaceId, itemId) => {
          if (store.activePresetId !== presetId) {
            store.setActivePreset(presetId as typeof store.activePresetId);
          }
          store.deleteItem(spaceId, itemId);
        }}
        onEmptyAll={() => {
          const n = store.emptyMemoTrash();
          showToast(n > 0 ? `${n}개를 영구 삭제했어요` : '휴지통이 이미 비어있어요');
        }}
      />

      {/* ── Dialogs ──────────────────────────────────────────── */}
      {/* ItemDialog is now hosted in a satellite BrowserWindow — see the
          three useEffects above (trigger / action listener / closed
          listener) and plans/satellite-dialogs.md. */}
      {/* ItemWizard (quickadd / wizard) is now hosted in a satellite —
          see the three useEffects above (ItemWizard bridge) and
          plans/satellite-dialogs.md. */}
      <ScanDialog
        open={dialog === 'scan'}
        onClose={() => setDialog('none')}
        onSelect={handleScanSelect}
      />
      {/* SettingsDialog is hosted in a satellite — see the 3 useEffects
          (SettingsDialog bridge) below the ItemWizard ones, and
          plans/satellite-dialogs.md. */}
      {/* BatchDropDialog / ContainerSlotPicker / DocCohortDialog are
          all hosted in satellite BrowserWindows — see their respective
          useEffect bridges above and plans/satellite-dialogs.md. */}

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
          extConnected={extState === 'connected' ? true : extState === 'init' ? null : false}
          onClose={() => setShowWelcome(false)}
          onOpenExtensionSettings={() => openSettingsTab('extension')}
        />
      )}
      {/* First-card celebration — fires once per device when the first card
          is added. Self-hides; mounting it here costs nothing when idle. */}
      <FirstCardCelebration />
      {/* Welcome wizard — auto-opens on first run, also reachable from the
          EmptyState's 템플릿으로 시작 button. */}
      <WelcomeWizard
        open={welcomeOpen}
        onApply={applyTemplate}
        onClose={closeWelcome}
      />
      {/* Import wizard — opened via slash command (/import) or Settings. */}
      <ImportWizard
        open={importOpen}
        onApply={applyImport}
        onClose={() => setImportOpen(false)}
      />
      {/* Tour overlay — self-hidden when no tour is running (early-return null).
          Mount high in the tree so its spotlight sits above dialogs/toasters. */}
      <TourOverlay
        data={data}
        onComplete={id => store.markTourCompleted(id)}
        onEnd={(_id, _completed) => {
          // Sandbox-active tours need an exit decision (keep / discard).
          // Non-sandboxed tours just disappear normally — nothing to do.
          if (tutorialActive) tourBridgeRef.current?.requestExit();
        }}
      />
      {/* ── Tutorial sandbox UI ───────────────────────────────────
          Banner is mounted permanently while sandbox is active so users
          always have an obvious "exit" path. The exit modal opens when
          the tour ends OR the user clicks 종료 on the banner. */}
      {tutorialActive && (
        <TutorialBanner
          backupPath={tutorialBackupPath}
          onOpenBackupFolder={() => electronAPI.openUserDataFolder('tutorial-backups')}
          onExit={() => requestSandboxExit()}
        />
      )}
      <SandboxExitModal
        open={sandboxExitOpen}
        newSpacesCount={sandboxNewCounts.spaces}
        newBadgesCount={sandboxNewCounts.badges}
        backupPath={tutorialBackupPath}
        onDiscard={() => exitSandbox('discard')}
        onMerge={() => exitSandbox('merge')}
        onOpenBackupFolder={() => electronAPI.openUserDataFolder('tutorial-backups')}
      />
      {/* Paywall — lives here so any component in the tree can open it via
          the handlers passed down through props. Rendered above TourOverlay
          so the upgrade CTA beats any running tour in z-order. */}
      {/* Container drag-bloom — only mounted while a bloom is active.
          Component is portal-based so it renders above the rest of the
          app regardless of where it sits in this tree. */}
      {bloomState && (() => {
        const cont = data.spaces
          .find(s => s.id === bloomState.containerSpaceId)
          ?.items.find(i => i.id === bloomState.containerId);
        const allItems = data.spaces.flatMap(s => s.items);
        const filled = {
          up:    cont?.slots?.up    ? allItems.find(i => i.id === cont.slots!.up)    : undefined,
          down:  cont?.slots?.down  ? allItems.find(i => i.id === cont.slots!.down)  : undefined,
          left:  cont?.slots?.left  ? allItems.find(i => i.id === cont.slots!.left)  : undefined,
          right: cont?.slots?.right ? allItems.find(i => i.id === cont.slots!.right) : undefined,
        };
        return (
          <ContainerBloom
            containerRect={bloomState.containerRect}
            filledSlots={filled}
            hotDir={bloomState.hotDir}
            accent={bloomState.accent}
          />
        );
      })()}
      <PaywallModal
        open={paywall.open}
        reason={paywall.reason}
        entitlement={entitlement}
        onClose={closePaywall}
        onStartTrial={() => {
          store.startTrialIfEligible();
          closePaywall();
          showToast('14일 무료 체험 시작');
        }}
      />
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
    </TutorialProvider>
    </TooltipProvider>
    </AppActionsProvider>
    </AppStateProvider>
  );
}
