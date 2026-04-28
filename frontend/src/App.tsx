import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Toaster } from 'sonner';
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
import { ContainerBloom, hitTestBloomZone, type Dir as BloomDir } from './components/ContainerBloom';
import type { ParsedCommand } from './components/CommandBar';
import { useAppData } from './hooks/useAppData';
import { faviconCandidates } from './hooks/useFavicon';
import { setBusy, whenIdle, isUserBusy } from './lib/userBusy';
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
import { CSS } from '@dnd-kit/utilities';

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
        transform: CSS.Transform.toString(transform),
        transition: resizing ? undefined : transition,
        opacity: isDragging ? 0.45 : 1,
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
    deckBuilding, setDeckBuilding,
    deckItems, setDeckItems,
    nodeGroups, decks, allItems, deckAnchorItemIds,
    handleModeChange,
    handleStartNodeEdit, handleCancelNodeEdit,
    handleSaveNodeGroup, handleNodeBuildingClick, handleNodeGroupLaunch,
    handleDeckBuildingClick, handleSaveDeck, handleDeckLaunch, handleDeckGroupLaunch,
  } = useNodeDeckMode({ data, store, showToast, dismissToast, showTileOverlay });

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
  });
  badgeLaunchRef.current = {
    spaces: data.spaces,
    closeAfterOpen: data.settings.closeAfterOpen,
    launchAndPosition,
    handleNodeGroupLaunch,
    handleDeckLaunch,
    store,
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
        r.launchAndPosition(item, r.closeAfterOpen);
        r.store.incrementClickCount(ownerSpaceId, itemId);
      }
    });
    const offRef = electronAPI.onBadgesLaunchRef(({ refType, refId }) => {
      const r = badgeLaunchRef.current;
      if (refType === 'node') r.handleNodeGroupLaunch(refId);
      else if (refType === 'deck') r.handleDeckLaunch(refId);
    });
    return () => { offItem(); offRef(); };
  }, []);


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
  const [clipSuggestion, setClipSuggestion] = useState<{ type: 'url' | 'app' | 'folder' | 'hex' | 'text'; value: string; label: string } | null>(null);
  const lastClipValueRef = useRef('');

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
  const [extRechecking, setExtRechecking] = useState(false);

  const recheckExtension = useCallback(async () => {
    setExtRechecking(true);
    try {
      const s = await electronAPI.getExtensionBridgeStatus();
      const connected = s.connected || s.tabsCount > 0 || s.lastExtensionConnectedAt > 0;
      setExtConnected(connected);
      // If user manually clicked refresh and they had previously dismissed the
      // banner, surface it again — otherwise an extension that comes back
      // online has no visible feedback.
      if (connected && extBannerDismissed) {
        setExtBannerDismissed(false);
        localStorage.removeItem('ext-banner-dismissed');
      }
    } finally {
      setExtRechecking(false);
    }
  }, [extBannerDismissed]);

  useEffect(() => {
    // First check on mount.
    void recheckExtension();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After an app update / cold start, the SSE handshake with the bridge can
  // take a few seconds to settle (Chrome has to wake the service worker).
  // So when status is "not connected" we retry every 4s for up to 40s.
  // Once connected we stop polling — manual refresh button covers later
  // disconnects (uninstall, Chrome closed, etc).
  useEffect(() => {
    if (extConnected !== false) return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts++;
      if (attempts > 10) { clearInterval(id); return; }
      electronAPI.getExtensionBridgeStatus().then(s => {
        const connected = s.connected || s.tabsCount > 0 || s.lastExtensionConnectedAt > 0;
        if (connected) {
          setExtConnected(true);
          clearInterval(id);
        }
      });
    }, 4000);
    return () => clearInterval(id);
  }, [extConnected]);

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
    document.body.classList.remove('mode-pin', 'mode-node', 'mode-deck', 'mode-clean', 'mode-tool');

    if (activeMode === 'pin')   document.body.classList.add('mode-pin',   'mode-tool');
    if (activeMode === 'node')  document.body.classList.add('mode-node',  'mode-tool');
    if (activeMode === 'deck')  document.body.classList.add('mode-deck',  'mode-tool');
    if (activeMode === 'clean') document.body.classList.add('mode-clean', 'mode-tool');

    // Cursor visuals are owned by index.css via the body.mode-* classes —
    // arrow + colored badge with a mode icon. We used to inject a JS-built
    // cursor here, but that duplicated and overrode the CSS rules, defeating
    // the established arrow+badge design. Body class handling below is enough.

    return () => {
      document.body.classList.remove('mode-pin', 'mode-node', 'mode-deck', 'mode-clean', 'mode-tool');
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

  // ── Tab key cycles through available presets ─────────────
  //
  // Press Tab anywhere (outside of inputs / modals) to advance to the
  // next preset the user has access to. Pro-locked presets are skipped
  // silently rather than triggering a paywall every time the user taps
  // Tab — discovery happens via the explicit preset toggle click,
  // which DOES open the paywall with full context. We also bail when
  // any modal/dialog is busy so Tab still works as expected for form
  // navigation inside dialogs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // Modifier-tabs are reserved for the browser / OS (Ctrl+Tab, Alt+Tab,
      // Shift+Tab traversal). We only claim plain Tab.
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      // Don't hijack while the user is typing or interacting with a control.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (t?.isContentEditable) return;
      // Skip while any modal / drag / tour is busy — preserves form-Tab
      // behaviour inside ItemDialog, SettingsDialog, etc.
      if (isUserBusy()) return;
      // Skip while CommandBar is open (its own focus management).
      if (cmdOpen) return;

      // Build the cycle from accessible presets only. Free tier ⇒ ['1'],
      // so cycling is a no-op for that user and we don't even
      // preventDefault (lets focus traversal still work). Pro ⇒ all three.
      const order: Array<'1' | '2' | '3'> = ['1', '2', '3'];
      const accessible = order.filter(id => entitlement.canUsePreset(id));
      if (accessible.length <= 1) return;
      e.preventDefault();
      const idx = accessible.indexOf(store.activePresetId as '1' | '2' | '3');
      const next = accessible[(idx + 1) % accessible.length];
      store.setActivePreset(next);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cmdOpen, entitlement, store]);

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

  // openQuickAdd is declared AFTER handleAddColorSwatch (further
  // down) so its closure can refer to that handler — see below.
  const openManualWizard = useCallback((spaceId?: string) => {
    setEditItem(null);
    setPrefilledItem(null);
    setEditSpaceId(spaceId ?? data.spaces[0]?.id ?? '');
    setDialog('wizard');
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
    store.addItem(spaceId, {
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
    showToast(`팔레트에 ${hex} 추가됨`);
    return newItem;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotaChecks, store]);

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
      const r = await electronAPI.analyzeClipboard();
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

  const handleClipboardAdd = useCallback(() => {
    if (!clipSuggestion) return;
    const { type, value, label } = clipSuggestion;
    setClipSuggestion(null);
    // Hex fast-path — add the swatch and follow up with the edit
    // dialog so the user can immediately label it (matches the
    // "+ 빠른추가" hex flow). Earlier this was a silent add; the
    // user asked for the labelling bay because an unlabelled #hex
    // is hard to recall later.
    if (type === 'hex') {
      const targetSpaceId = data.spaces[0]?.id;
      if (targetSpaceId) {
        const newItem = handleAddColorSwatch(targetSpaceId, { hex: value });
        if (newItem) {
          setEditItem(newItem);
          setEditSpaceId(targetSpaceId);
          setDialog('item');
        }
      }
      return;
    }
    setEditItem(null);
    setPrefilledItem({ type, value, title: label, clickCount: 0, pinned: false } as Partial<import('./types').LauncherItem>);
    setEditSpaceId(data.spaces[0]?.id ?? '');
    setDialog('item');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipSuggestion, data.spaces, handleAddColorSwatch]);

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
      if (currentSpaceId && currentSpaceId !== spaceId) {
        store.updateItemAndMove(currentSpaceId, spaceId, item as LauncherItem);
      } else {
        store.updateItem(currentSpaceId ?? spaceId, item as LauncherItem);
      }
    } else {
      // New item — pre-generate ID so we can trigger the entry animation immediately
      if (!quotaChecks.card()) return;
      const newId = generateId();
      store.addItem(spaceId, item as Omit<LauncherItem, 'id'>, newId);
      markItemsAsNew([newId]);
      // First-card celebration: fired here so it covers manual adds, ghost
      // accepts, batch drops, and any other path that lands here. The
      // component itself dedupes via localStorage.
      fireFirstCardCelebration();
    }
  }, [store, data.spaces, markItemsAsNew, quotaChecks]);

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
    // Electron 32+ removed File.path; resolve via the webUtils bridge.
    // Fall back through the (deprecated) path prop and finally the filename
    // so we still work on older Electron builds and in dev.
    const resolvePath = (file: File): string => {
      const legacy = (file as File & { path?: string }).path;
      if (legacy) return legacy;
      return electronAPI.getFilePath(file) ?? file.name;
    };
    if (files.length === 1) {
      // Single file → open ItemDialog pre-filled so the user can confirm/tweak
      const filePath = resolvePath(files[0]);
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
        const filePath = resolvePath(file);
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
  }, [data.spaces, data.nodeGroups, data.settings, store, showToast, launchItem, handleNodeGroupLaunch, handleTogglePin]);

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
    if (next) store.reorderSpaces(next);
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

    // Dropped directly on a space's outer wrapper (the SortableSpace
    // itself, not its inner drop-space-* zone). Happens for empty
    // spaces because dnd-kit's closestCorners picks the wrapper
    // sortable over the inner droppable when there are no items
    // around to disambiguate. Without this branch, drops onto empty
    // spaces silently no-op'd — visible bug.
    const directSpaceMatch = data.spaces.find(s => s.id === overId);
    if (directSpaceMatch) {
      if (directSpaceMatch.id !== sourceSpace.id) {
        store.moveItemToSpace(activeId, sourceSpace.id, directSpaceMatch.id);
      }
      return;
    }

    // Dropped onto another item
    const targetSpace = data.spaces.find(s => s.items.some(i => i.id === overId));
    if (!targetSpace) {
      // Last-resort fallback: hit-test the pointer against every
      // visible space rect. Covers cases where collision detection
      // returns null (rare DPI / scroll edge cases).
      const start = event.activatorEvent as PointerEvent | MouseEvent | undefined;
      if (start) {
        const px = (start.clientX ?? 0) + event.delta.x;
        const py = (start.clientY ?? 0) + event.delta.y;
        const els = document.querySelectorAll<HTMLElement>('[data-space-id]');
        for (const el of Array.from(els)) {
          const r = el.getBoundingClientRect();
          if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
            const spaceId = el.dataset.spaceId;
            if (spaceId && spaceId !== sourceSpace.id) {
              store.moveItemToSpace(activeId, sourceSpace.id, spaceId);
            }
            return;
          }
        }
      }
      return;
    }

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
  const [updateNewVer, setUpdateNewVer] = useState<string | null>(null);
  useEffect(() => {
    electronAPI.onUpdateAvailable((info) => {
      setUpdateNewVer(info.version);
      showToast(`v${info.version} 다운로드 시작...`, { duration: 2500 });
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
    onCleanSpace: handleCleanSpace,
  }), [showToast, launchAndPosition, handlePinModeClick, handleNodeBuildingClick, handleNodeGroupLaunch, handleDeckBuildingClick, handleDeckGroupLaunch, handleWindowInactiveClick, handleCleanSpace]);

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
              onSelect={id => { if (quotaChecks.preset(id)) store.setActivePreset(id); }}
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
              {[
                { icon: 'add_circle', title: '새 스페이스', fn: () => { if (quotaChecks.space()) store.addSpace(); }, dim: true  },
                { icon: 'settings',   title: '환경설정',   fn: () => setDialog('settings'),            dim: true  },
                { icon: 'close',      title: '닫기(Esc)',  fn: () => electronAPI.hideApp(),            dim: false },
              ].map(btn => (
                <button
                  key={btn.icon}
                  onClick={btn.fn}
                  title={btn.title}
                  className="action-icon-btn"
                  style={{ width: 28, height: 28 }}
                  {...(btn.dim ? { 'data-mode-dim': 'true' } : {})}
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
                브라우저 익스텐션이 감지되지 않았습니다. 이미 설치돼 있다면 새로고침해보세요.
              </span>
              <button
                onClick={() => void recheckExtension()}
                disabled={extRechecking}
                title="연결 상태 새로고침"
                style={{ flexShrink: 0, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border-rgba)', background: 'transparent', color: 'var(--text-muted)', fontSize: 10, cursor: extRechecking ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, opacity: extRechecking ? 0.5 : 1 }}
              >
                <Icon name="refresh" size={12} style={{ animation: extRechecking ? 'spin 0.9s linear infinite' : 'none' }} />
                새로고침
              </button>
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
                onAddBlank={() => { if (quotaChecks.space()) store.addSpace(); }}
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
                            onRename={name => store.renameSpace(space.id, name)}
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
                            defaultOpen={!(data.collapsedSpaceIds ?? []).includes(space.id)}
                            onSetMonitor={(itemId, monitor) => handleSetMonitor(space.id, itemId, monitor)}
                            onConvertToContainer={itemId => { if (quotaChecks.container()) handleConvertToContainer(space.id, itemId); }}
                            onConvertFromContainer={itemId => handleConvertFromContainer(space.id, itemId)}
                            onEditSlots={(itemId, dir) => handleEditSlots(space.id, itemId, dir)}
                            ghostItems={ghostCards.ghostsForSpace(space.id)}
                            onGhostAccept={(ghost) => {
                              if (!quotaChecks.card()) return;
                              store.addItem(ghost.spaceId, { title: ghost.title, value: ghost.value, type: ghost.type });
                              ghostCards.accept(ghost);
                              showToast(`"${ghost.title}" 추가됨`);
                            }}
                            onGhostDismiss={(value) => ghostCards.dismiss(value)}
                            fileDragActive={fileDragOver}
                            fileDragTarget={fileDragTargetSpaceId === space.id}
                            onFileDragEnter={() => setFileDragTargetSpaceId(space.id)}
                            onFileDragLeave={() => setFileDragTargetSpaceId(prev => prev === space.id ? null : prev)}
                            onFloatOut={() => pinAsFloating('space', space.id)}
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

          {/* ── Update progress strip ─────────────────── */}
          {/* Slim persistent bar at the bottom of the main content column.     */}
          {/* Visible during download and after download (until user installs). */}
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
                /* ── Downloaded: install button ── */
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
                /* ── Downloading: progress bar ── */
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
        presets={store.presets}
        currentPresetId={store.activePresetId}
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
    </TooltipProvider>
    </AppActionsProvider>
    </AppStateProvider>
  );
}
