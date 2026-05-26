import { useState, useCallback, useEffect } from 'react';
import type { AppData, Space, LauncherItem, AppSettings, NodeGroup, Deck, ContainerSlots, Preset, PresetId, MemoData, AppNotification } from '../types';
import { DEFAULT_MEMO_SETTINGS, NOTIFICATION_MAX_AGE_MS, DEFAULT_DOC_COHORT_SETTINGS, TOMBSTONE_MAX_AGE_MS } from '../types';
import { newTrialLicense } from './useEntitlement';
import { electronAPI } from '../electronBridge';
import { generateId } from '../lib/utils';
import { createLogger } from '../lib/logger';
import { purgeExpiredMemos } from '../lib/memoUtils';

const log = createLogger('useAppData');

const STORAGE_KEY = 'quicklauncherData';

/** Build a brand-new preset with a single default space. */
function buildDefaultPreset(id: PresetId, seeded: boolean): Preset {
  const firstSpace: Space = {
    id: generateId(),
    name: seeded ? '즐겨찾기' : '새 스페이스',
    items: seeded ? [
      { id: generateId(), type: 'url', title: '네이버', value: 'https://www.naver.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '다음', value: 'https://www.daum.net', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '유튜브', value: 'https://www.youtube.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '구글', value: 'https://www.google.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '지메일', value: 'https://mail.google.com', clickCount: 0, pinned: false },
      { id: generateId(), type: 'url', title: '카카오', value: 'https://www.kakao.com', clickCount: 0, pinned: false },
    ] : [],
    color: undefined,
    sortMode: 'custom',
    pinnedIds: [],
  };
  return {
    id,
    label: `프리셋 ${id}`,
    spaces: [firstSpace],
    nodeGroups: [],
    decks: [],
    collapsedSpaceIds: [],
    floatingBadges: [],
  };
}

function defaultData(): AppData {
  const presets = [
    buildDefaultPreset('1', true),
    buildDefaultPreset('2', false),
    buildDefaultPreset('3', false),
  ];
  const active = presets[0];
  return {
    presets,
    activePresetId: '1',
    // Top-level mirrors of active preset (required by the AppData type; kept
    // in sync by the `setDataRaw` shim on every write).
    spaces: active.spaces,
    nodeGroups: active.nodeGroups,
    decks: active.decks,
    collapsedSpaceIds: active.collapsedSpaceIds,
    floatingBadges: active.floatingBadges,
    settings: { opacity: 0.95, closeAfterOpen: false, shortcut: 'Alt+4', theme: 'dark', autoLaunch: false },
    shortcut: 'Alt+4',
  };
}

// Ensure the pair-chain invariant: at most one pair per row (no [A→B→C] chain).
// Also fix dangling pairs where pairedWithNext=true but there's no next space.
// This runs on every load and on every mutation that could violate the invariant.
export function enforcePairInvariant(spaces: Space[]): Space[] {
  const out = spaces.map(s => ({ ...s }));
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    if (!cur.pairedWithNext) continue;
    // No next space to pair with → cannot be paired
    if (i === out.length - 1) {
      cur.pairedWithNext = false;
      cur.splitRatio = undefined;
      continue;
    }
    // Breaking a chain: if the next space also has pairedWithNext=true, clear
    // the next's flag so the pair is [i, i+1] only, and i+2 starts a new row.
    const nxt = out[i + 1];
    if (nxt.pairedWithNext) {
      nxt.pairedWithNext = false;
      nxt.splitRatio = undefined;
    }
  }
  return out;
}

/**
 * v1.3.34 migration helper — reclassify legacy 'app'-typed items whose
 * value is a document path. Previously every non-.exe/.lnk file was
 * stored as 'app'; the new 'doc' type lets the cohort feature and the
 * UI render documents distinctly. Only flips items where the extension
 * is definitively a document; non-matching '.app' items stay as-is so
 * we don't accidentally relabel legitimate executables we don't know
 * about. Idempotent — already-'doc' items pass through untouched.
 *
 * docExts is the user's customised list when present, otherwise the
 * conservative default — same source of truth as inferItemFromPath /
 * main.js analyze-clipboard.
 */
const DEFAULT_DOC_EXTS_FOR_MIGRATION = [
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'hwp', 'hwpx', 'hwt',
  'pdf', 'txt', 'md', 'csv',
  'odt', 'ods', 'odp',
];
/**
 * v1.3.36 — reset cohort bindings written by older builds that baked the
 * literal per-revision suffix (e.g. `_F`, `_콘진`) into the mask. Those
 * masks only ever matched the original file, defeating the entire point.
 * The new rebuildMask emits `{*}` placeholder for the suffix; any binding
 * whose pattern lacks `{*}` AND has non-extension text after `{token}` is
 * pre-v1.3.36 and gets cleared so the next "최신 버전 확인" re-detects.
 */
function maybeResetStaleCohortBinding(item: LauncherItem): LauncherItem {
  if (!item.docCohort) return item;
  const p = item.docCohort.pattern;
  if (!p || p.includes('{*}')) return item;
  // Inspect what comes after {token}: just the extension (`.xxx`) is fine;
  // anything else means a literal suffix that should have been wildcarded.
  const tokenAt = p.indexOf('{token}');
  if (tokenAt < 0) return item;
  const afterToken = p.slice(tokenAt + '{token}'.length);
  // Allow only `.<ext>` (single extension segment, no further separators).
  if (/^\.[^./\\]+$/.test(afterToken)) return item;
  const { docCohort: _drop, ...rest } = item;
  void _drop;
  return rest;
}

function maybeReclassifyAsDoc(item: LauncherItem, docExts: string[]): LauncherItem {
  if (item.type !== 'app') return item;
  const v = item.value ?? '';
  if (!v) return item;
  const m = v.match(/\.([a-zA-Z0-9]+)$/);
  if (!m) return item;
  const ext = m[1].toLowerCase();
  if (!docExts.includes(ext)) return item;
  return { ...item, type: 'doc' };
}

/**
 * Normalise one space's shape (pairing / pins / item defaults). Extracted so
 * migrateData() can apply it inside every preset uniformly.
 */
function normaliseSpace(s: Space, docExts: string[]): Space {
  const { columnSpan: _cs, widthWeight: _ww, ...rest } = s;
  return {
    ...rest,
    sortMode: s.sortMode ?? 'custom',
    pinnedIds: s.pinnedIds ?? [],
    pairedWithNext: s.pairedWithNext ?? false,
    splitRatio: s.pairedWithNext ? (s.splitRatio ?? 0.5) : undefined,
    items: s.items.map(i => maybeResetStaleCohortBinding(maybeReclassifyAsDoc(
      { ...i, clickCount: i.clickCount ?? 0, pinned: i.pinned ?? false },
      docExts,
    ))),
  };
}

function normalisePreset(p: Preset, docExts: string[]): Preset {
  return {
    ...p,
    label: p.label ?? `프리셋 ${p.id}`,
    spaces: enforcePairInvariant((p.spaces ?? []).map(s => normaliseSpace(s, docExts))),
    nodeGroups: p.nodeGroups ?? [],
    decks: p.decks ?? [],
    collapsedSpaceIds: p.collapsedSpaceIds ?? [],
    floatingBadges: p.floatingBadges ?? [],
  };
}

function migrateData(parsed: AppData): AppData {
  // One-shot v1.3.46 defaults migration. Pre-1.3.46 store had the
  // historic windowOpenAt default 'cursor' baked in — even users who
  // never opened settings ended up with 'cursor' persisted. The
  // v1.3.45 code change to default 'last' only affected fresh installs.
  // This migration force-flips 'cursor' → 'last' ONCE per device, then
  // stamps the flag so it doesn't keep undoing the user's explicit
  // choice on later loads. Users who genuinely prefer 'cursor' can
  // toggle it back in settings after the migration.
  const needs1346 = !parsed.settings._defaultsV146Migrated;
  // ── Settings defaults (global — same as before) ─────────────
  parsed.settings = {
    ...parsed.settings,
    theme: parsed.settings.theme ?? 'dark',
    autoLaunch: parsed.settings.autoLaunch ?? false,
    autoHide: parsed.settings.autoHide ?? false,
    // 'last' for missing, 'cursor' only when explicitly chosen post-
    // migration. The migration block below force-flips legacy 'cursor'
    // to 'last' once.
    windowOpenAt: needs1346
      ? 'last'   // ← migration: ignore stored value for old installs
      : (parsed.settings.windowOpenAt === 'cursor' ? 'cursor' : 'last'),
    _defaultsV146Migrated: true,
    accentColor: parsed.settings.accentColor ?? '#6366f1',
    documentExtensions: parsed.settings.documentExtensions ?? [],
    floatingButton: parsed.settings.floatingButton ?? {
      enabled: false,
      idleOpacity: 0.65,
      size: 'normal',
      hideOnFullscreen: true,
    },
    // Floating badge size — additive global field, no schema bump needed.
    // We default to 46 (the legacy hardcoded value in Badge.tsx) so any
    // pre-v1.3.x save file lights up the new slider at exactly the size
    // its user has been seeing for months.
    badgeSize: parsed.settings.badgeSize ?? 46,
    memo: parsed.settings.memo ?? { ...DEFAULT_MEMO_SETTINGS },
    docCohort: parsed.settings.docCohort ?? { ...DEFAULT_DOC_COHORT_SETTINGS },
  };

  // ── Preset shape migration ──────────────────────────────────
  // Older save files stored spaces/nodeGroups/decks/etc. at the top level.
  // Move any legacy flat fields into presets[0] so the rest of the app can
  // uniformly treat "active preset" as the source of truth.
  if (!Array.isArray(parsed.presets) || parsed.presets.length === 0) {
    const legacySpaces = parsed.spaces ?? [];
    const legacyPreset: Preset = {
      id: '1',
      label: '프리셋 1',
      spaces: legacySpaces.length > 0 ? legacySpaces : buildDefaultPreset('1', true).spaces,
      nodeGroups: parsed.nodeGroups ?? [],
      decks: parsed.decks ?? [],
      collapsedSpaceIds: parsed.collapsedSpaceIds ?? [],
      floatingBadges: parsed.floatingBadges ?? [],
    };
    parsed.presets = [
      legacyPreset,
      buildDefaultPreset('2', false),
      buildDefaultPreset('3', false),
    ];
  }

  // Ensure exactly 3 presets in the '1','2','3' id order.
  // v1.3.34: doc reclassification needs the user's documentExtensions list;
  // empty list ([]) means "user hasn't customised", fall back to defaults.
  const docExtsForMigration = (parsed.settings.documentExtensions && parsed.settings.documentExtensions.length > 0)
    ? parsed.settings.documentExtensions
    : DEFAULT_DOC_EXTS_FOR_MIGRATION;
  const byId = new Map<PresetId, Preset>();
  for (const p of parsed.presets) byId.set(p.id, normalisePreset(p, docExtsForMigration));
  parsed.presets = (['1', '2', '3'] as PresetId[]).map(id =>
    byId.get(id) ?? buildDefaultPreset(id, false)
  );

  if (parsed.activePresetId !== '1' && parsed.activePresetId !== '2' && parsed.activePresetId !== '3') {
    parsed.activePresetId = '1';
  }

  // Mirror active preset onto top-level flat fields — the AppData type treats
  // spaces[] as required; the shim in useAppData keeps them synced on writes.
  const activeForMirror = parsed.presets.find(p => p.id === parsed.activePresetId) ?? parsed.presets[0];
  parsed.spaces            = activeForMirror.spaces;
  parsed.nodeGroups        = activeForMirror.nodeGroups;
  parsed.decks             = activeForMirror.decks;
  parsed.collapsedSpaceIds = activeForMirror.collapsedSpaceIds;
  parsed.floatingBadges    = activeForMirror.floatingBadges;

  // ── Dismissals migration (global) ────────────────────────────
  if (!parsed.dismissals) {
    const dismissals: Record<string, { at: number; count: number }> = {};
    (parsed.dismissedSuggestions ?? []).forEach(v => { dismissals[v] = { at: 0, count: 1 }; });
    parsed.dismissals = dismissals;
  }

  parsed.completedTours = parsed.completedTours ?? [];

  // ── v1.3.48 (Phase 2.C) lastModifiedAt + tombstones migration ──
  // (a) Stamp lastModifiedAt on legacy entities so they participate in
  //     LWW from this boot onward. Use boot time so a sync done right
  //     after upgrade still favours the freshly-edited side (further
  //     edits will stamp again with a later ts). Idempotent — entities
  //     that already have lastModifiedAt are not touched.
  // (b) Sweep tombstones older than TOMBSTONE_MAX_AGE_MS. Old deletes
  //     are forgotten so the registry never grows unbounded.
  const stampTs = Date.now();
  const stamp = <T extends { lastModifiedAt?: number }>(x: T): T =>
    x.lastModifiedAt === undefined ? { ...x, lastModifiedAt: stampTs } : x;
  parsed.presets = parsed.presets.map(p => ({
    ...stamp(p),
    spaces: p.spaces.map(s => ({
      ...stamp(s),
      items: s.items.map(stamp),
    })),
    nodeGroups: (p.nodeGroups ?? []).map(stamp),
    decks: (p.decks ?? []).map(stamp),
    floatingBadges: (p.floatingBadges ?? []).map(stamp),
  }));
  // Re-mirror flat fields after stamping (the references just rotated).
  const activeAfterStamp = parsed.presets.find(p => p.id === parsed.activePresetId) ?? parsed.presets[0];
  parsed.spaces         = activeAfterStamp.spaces;
  parsed.nodeGroups     = activeAfterStamp.nodeGroups;
  parsed.decks          = activeAfterStamp.decks;
  parsed.floatingBadges = activeAfterStamp.floatingBadges;
  // Tombstone sweep
  const t = parsed.tombstones;
  if (t) {
    const cutoff = stampTs - TOMBSTONE_MAX_AGE_MS;
    const sweep = (m: Record<string, number> | undefined) => {
      if (!m) return undefined;
      const out: Record<string, number> = {};
      for (const [id, ts] of Object.entries(m)) if (ts > cutoff) out[id] = ts;
      return out;
    };
    parsed.tombstones = {
      items:          sweep(t.items),
      spaces:         sweep(t.spaces),
      presets:        sweep(t.presets),
      nodeGroups:     sweep(t.nodeGroups),
      decks:          sweep(t.decks),
      floatingBadges: sweep(t.floatingBadges),
    };
  }

  return parsed;
}

function loadDataSync(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      log.debug(`loadDataSync: localStorage hit, size=${raw.length}`);
      return migrateData(JSON.parse(raw) as AppData);
    }
    log.debug('loadDataSync: no localStorage, using defaultData');
  } catch (e) { log.warn('loadDataSync: parse error', e); }
  return defaultData();
}

// ── Loading screen helpers (DOM direct — works before React paint) ──
function setLoadingProgress(pct: number) {
  const bar = document.getElementById('ql-loading-bar');
  if (bar) bar.style.width = `${pct}%`;
  log.debug(`setLoadingProgress(${pct}) bar=${!!bar}`);
}

function dismissLoadingScreen() {
  const el = document.getElementById('ql-loading');
  // Promoted to info: production debug logs are stripped, so we can't
  // see whether dismiss fires in user logs. Without that visibility
  // the boot-stuck path is undebuggable. Keep this until we have
  // enough confidence the unified flow is reliable.
  log.info(`[boot] dismissLoadingScreen called, overlay=${!!el}`);
  if (!el) return;
  setLoadingProgress(100);
  // Signal Electron main that renderer is fully ready — window will be shown now
  log.info('[boot] electronAPI.signalReady() →');
  electronAPI.signalReady();
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => { el.remove(); log.info('[boot] loading overlay removed'); }, 280);
  }, 150);
}

export function useAppData() {
  log.info('[boot] useAppData() function called');
  // `raw` is the true on-disk shape (presets[] + globals). All mutating
  // callers still see a backward-compat "flat" view via `data` (below) — the
  // `save` shim intercepts their writes and redirects per-preset keys into
  // presets[activePresetId].
  const [raw, setRawData] = useState<AppData>(() => loadDataSync());
  const [isFirstRun, setIsFirstRun] = useState(false);

  // On mount: load from electron-store (migrating from localStorage if needed)
  useEffect(() => {
    log.info('[boot] useAppData mount effect running');
    setLoadingProgress(60);
    // Push a status string into the in-window #ql-loading overlay.
    // boot-recovery.js wires `window.__bootStatus` for both main-IPC
    // and direct calls; this is the direct path used by React.
    (window as { __bootStatus?: (s: string) => void }).__bootStatus?.('데이터 불러오는 중...');
    electronAPI.setLoadingStatus('데이터 불러오는 중...');
    log.info('[boot] electronAPI.storeLoad() →');
    electronAPI.storeLoad().then(stored => {
      const hasStore = !!(stored && typeof stored === 'object' && (
        'presets' in (stored as AppData) || 'spaces' in (stored as AppData)
      ));
      log.info(`[boot] storeLoad resolved. hasStore=${hasStore}`);
      (window as { __bootStatus?: (s: string) => void }).__bootStatus?.('마무리하는 중...');
      if (hasStore) {
        // Run the memo auto-purge sweep RIGHT after migration so the
        // first paint already reflects expired→trash and trash→deleted
        // transitions. We persist the swept shape so the store on disk
        // matches what's in memory (otherwise an unchanged-on-render
        // close+reopen would resurrect ghosts).
        const migrated = migrateData(stored as AppData);
        const swept = purgeExpiredMemos(migrated, Date.now());
        setRawData(swept);
        if (swept !== migrated) {
          // No-op when nothing changed (purge returns ===).
          electronAPI.storeSave(swept);
        }
      } else {
        const localRaw = localStorage.getItem(STORAGE_KEY);
        if (!localRaw) setIsFirstRun(true);
        const localData = loadDataSync();
        electronAPI.storeSave(localData);
      }
      setLoadingProgress(90);
      electronAPI.setLoadingStatus('화면 그리는 중...');
      // Notify the boot-gate orchestrator (AppShell) that data is
      // ready. AppShell waits for this + auth + fonts before it
      // dismisses the overlay. Going through a window event keeps
      // useAppData's old call-site simple (no callback prop) and
      // dodges a wider context refactor for a one-shot signal.
      try { window.dispatchEvent(new Event('nost:store-ready')); } catch { /* noop */ }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        log.debug('double-rAF fired (store-ready dispatched)');
      }));
    }).catch(err => {
      // Crucial: even if storeLoad rejects, dismiss the overlay so the
      // user sees the (possibly empty) app shell rather than being
      // stuck on the loading screen forever. signalReady() inside
      // dismissLoadingScreen also unblocks main's window-show path.
      log.error('storeLoad rejected — dismissing overlay anyway', err);
      try { dismissLoadingScreen(); } catch (e) { log.error('dismiss after error failed', e); }
    });
  }, []);

  // `raw` already has its top-level flat fields mirrored to the active preset
  // (migrateData + every shim call maintains this invariant), so `data` is
  // literally `raw` — no extra object allocation per render.
  const data: AppData = raw;

  /**
   * Commit a mutation. `next` is the flat-view shape callers produce via
   * `save({ ...data, ... })`. Per-preset fields land on the active preset;
   * global fields land on raw.
   *
   * We intentionally DO NOT read `next.presets` or `next.activePresetId` —
   * those are managed only by `setActivePreset` / `renamePreset`, which
   * mutate `raw` directly. Allowing `save` to overwrite them would let a
   * stale data-view spread clobber a newly-switched preset.
   */
  /**
   * Accepts either a `next: AppData` object (legacy callers) OR a
   * `(prev) => AppData` updater function. The function form is the
   * race-safe one — caller computes `next.spaces` from the latest
   * committed state instead of a captured closure, so back-to-back
   * mutations in the same tick can't clobber each other.
   *
   * v1.3.45 bug: pre-existing mutators passed `next` built from the
   * captured `data` closure. Two events in the same render tick (e.g.
   * "satellite save action arrived + user dragged a card") both saw
   * the same stale `data`. The second save overwrote the first with
   * its own pre-computed `next.spaces`, dropping the just-added
   * URL card. The functional form passes `prev` straight from React's
   * state queue, so each update layers correctly.
   */
  const save = useCallback((nextOrFn: AppData | ((prev: AppData) => AppData)) => {
    setRawData(prev => {
      const next: AppData = typeof nextOrFn === 'function'
        ? (nextOrFn as (p: AppData) => AppData)(prev)
        : nextOrFn;
      const activeId = prev.activePresetId;
      const nextPresets = prev.presets.map(p => p.id === activeId ? {
        ...p,
        spaces:            next.spaces            ?? p.spaces,
        nodeGroups:        next.nodeGroups        ?? p.nodeGroups,
        decks:             next.decks             ?? p.decks,
        collapsedSpaceIds: next.collapsedSpaceIds ?? p.collapsedSpaceIds,
        floatingBadges:    next.floatingBadges    ?? p.floatingBadges,
      } : p);
      const active = nextPresets.find(p => p.id === activeId)!;
      const newRaw: AppData = {
        ...prev,
        settings:        next.settings        ?? prev.settings,
        shortcut:        next.shortcut        ?? prev.shortcut,
        dismissals:      next.dismissals      ?? prev.dismissals,
        completedTours:  next.completedTours  ?? prev.completedTours,
        presets: nextPresets,
        // Refresh flat-view mirrors from the authoritative preset.
        spaces:            active.spaces,
        nodeGroups:        active.nodeGroups,
        decks:             active.decks,
        collapsedSpaceIds: active.collapsedSpaceIds,
        floatingBadges:    active.floatingBadges,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newRaw));
      electronAPI.storeSave(newRaw);
      // Phase 2 sync is manual — no auto-push here. User clicks
      // "동기화하기" in 설정 → 계정 when they want to sync.
      return newRaw;
    });
  }, []);

  // ── Preset management ───────────────────────────────────────
  const setActivePreset = useCallback((id: PresetId) => {
    setRawData(prev => {
      if (prev.activePresetId === id) return prev;
      const active = prev.presets.find(p => p.id === id) ?? prev.presets[0];
      const next: AppData = {
        ...prev,
        activePresetId: id,
        // Swap in the new preset's mirrors so `data.spaces` etc. flips atomically.
        spaces:            active.spaces,
        nodeGroups:        active.nodeGroups,
        decks:             active.decks,
        collapsedSpaceIds: active.collapsedSpaceIds,
        floatingBadges:    active.floatingBadges,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      // Persist first, THEN tell main to rebuild the badge overlay so it sees
      // the fresh floatingBadges belonging to the newly-active preset.
      electronAPI.storeSave(next).then(() => electronAPI.syncBadges());
      return next;
    });
  }, []);

  const renamePreset = useCallback((id: PresetId, label: string) => {
    setRawData(prev => {
      const trimmed = label.trim() || `프리셋 ${id}`;
      const next = {
        ...prev,
        presets: prev.presets.map(p => p.id === id ? { ...p, label: trimmed } : p),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  /**
   * Move a single space (with all its items) from the active preset
   * to another preset. The receiver gets the space appended to the
   * end of its `spaces[]`; the sender loses it.
   *
   * Caveats consciously NOT handled here (yet):
   *   - Floating badges referencing the moved space stay in the
   *     SOURCE preset's badges array. They become dangling — the
   *     overlay will quietly skip them on next render. Cleaning these
   *     up would require deciding which preset "owns" each badge,
   *     which is a UX call the user hasn't asked for. For now: live
   *     dangling references; user can recreate the badge if they
   *     want it on the target preset.
   *   - Node groups / decks similarly may reference items inside the
   *     moved space. Same trade-off — they're scoped per-preset, so
   *     references in the source preset go stale.
   *
   * Why we mirror the active preset back into top-level `spaces`:
   * the rest of the codebase reads `data.spaces` (not
   * `data.presets[active].spaces`) — see migrateData. So when the
   * source preset IS the active one, we have to update both views.
   * When moving FROM active, the active preset loses the space; we
   * mirror that. When moving TO the active preset, we'd never call
   * this (target === active is filtered out at the call site), but
   * the mirror logic stays defensive.
   */
  const moveSpaceToPreset = useCallback((spaceId: string, targetPresetId: PresetId) => {
    setRawData(prev => {
      // Find the source preset that owns this space.
      const sourcePreset = prev.presets.find(p => p.spaces.some(s => s.id === spaceId));
      if (!sourcePreset) return prev;
      if (sourcePreset.id === targetPresetId) return prev;
      const space = sourcePreset.spaces.find(s => s.id === spaceId);
      if (!space) return prev;

      // Atomic preset-array rebuild: source loses the space, target
      // appends it. We don't rely on chained .map mutations because a
      // future change might land both in the same render batch.
      const newPresets = prev.presets.map(p => {
        if (p.id === sourcePreset.id) {
          return { ...p, spaces: p.spaces.filter(s => s.id !== spaceId) };
        }
        if (p.id === targetPresetId) {
          // Don't reinsert if the target somehow already has it — the
          // `targetPresetId !== sourcePreset.id` guard above means
          // we'd only see it as a duplicate from a pathological state.
          if (p.spaces.some(s => s.id === spaceId)) return p;
          return { ...p, spaces: [...p.spaces, space] };
        }
        return p;
      });

      // Top-level `spaces` mirror — only changes when the active
      // preset is involved. If the active preset is the source, drop
      // the space from the mirror. If it's the target, append.
      let nextSpaces = prev.spaces;
      if (prev.activePresetId === sourcePreset.id) {
        nextSpaces = nextSpaces.filter(s => s.id !== spaceId);
      } else if (prev.activePresetId === targetPresetId) {
        if (!nextSpaces.some(s => s.id === spaceId)) {
          nextSpaces = [...nextSpaces, space];
        }
      }

      const next = { ...prev, presets: newPresets, spaces: nextSpaces };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next).then(() => electronAPI.syncBadges());
      return next;
    });
  }, []);

  const markTourCompleted = useCallback((tourId: string) => {
    setRawData(prev => {
      if ((prev.completedTours ?? []).includes(tourId)) return prev;
      const next = { ...prev, completedTours: [...(prev.completedTours ?? []), tourId] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  /**
   * Flat-view setter shim. A handful of legacy callers (setFloatingBadgesLocal,
   * setPairSplitRatio, bulk item operations, …) call `setDataRaw(prev => ...)`
   * and read `prev.spaces` / `prev.collapsedSpaceIds` / etc. at the top level.
   * After the preset refactor those fields live under `activePreset`, so this
   * shim rewrites the updater callback to operate on a flat-view snapshot and
   * folds any returned per-preset mutations back into the raw shape.
   *
   * Direct `setDataRaw(nextAppData)` calls fall through to `setRawData` as-is
   * — the only caller who does that (reloadFromStore) supplies an already-
   * migrated full AppData which is what we want persisted wholesale.
   */
  const setDataRaw = useCallback((updater: AppData | ((prev: AppData) => AppData)) => {
    if (typeof updater !== 'function') {
      setRawData(updater);
      return;
    }
    setRawData(prevRaw => {
      const flatNext = updater(prevRaw);
      if (flatNext === prevRaw) return prevRaw;
      const activeId = prevRaw.activePresetId;
      const nextPresets = prevRaw.presets.map(p => p.id === activeId ? {
        ...p,
        spaces:            flatNext.spaces            ?? p.spaces,
        nodeGroups:        flatNext.nodeGroups        ?? p.nodeGroups,
        decks:             flatNext.decks             ?? p.decks,
        collapsedSpaceIds: flatNext.collapsedSpaceIds ?? p.collapsedSpaceIds,
        floatingBadges:    flatNext.floatingBadges    ?? p.floatingBadges,
      } : p);
      const active = nextPresets.find(p => p.id === activeId)!;
      return {
        ...prevRaw,
        settings:        flatNext.settings        ?? prevRaw.settings,
        shortcut:        flatNext.shortcut        ?? prevRaw.shortcut,
        dismissals:      flatNext.dismissals      ?? prevRaw.dismissals,
        completedTours:  flatNext.completedTours  ?? prevRaw.completedTours,
        presets: nextPresets,
        spaces:            active.spaces,
        nodeGroups:        active.nodeGroups,
        decks:             active.decks,
        collapsedSpaceIds: active.collapsedSpaceIds,
        floatingBadges:    active.floatingBadges,
      };
    });
  }, []);

  // ── Spaces ──────────────────────────────────────────────
  const addSpace = useCallback((name?: string): Space => {
    const newSpace: Space = {
      id: generateId(),
      name: name?.trim() || `Space ${data.spaces.length + 1}`,
      items: [],
      sortMode: 'custom',
      pinnedIds: [],
    };
    const ts = Date.now();
    save(prev => ({ ...prev, spaces: [...prev.spaces, { ...newSpace, lastModifiedAt: ts }] }));
    return newSpace;
  }, [save]);

  const renameSpace = useCallback((id: string, name: string) => {
    const ts = Date.now();
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s => s.id === id ? { ...s, name, lastModifiedAt: ts } : s),
    }));
  }, [save]);

  const deleteSpace = useCallback((id: string) => {
    const ts = Date.now();
    save(prev => {
      // v1.3.48 Phase 2.C: tombstone the space + cascade-tombstone every
      // item it owned. Without item-level tombstones too, a later sync
      // would resurrect the children from the server.
      const target = prev.spaces.find(s => s.id === id);
      const childItemIds = (target?.items ?? []).map(i => i.id);
      const itemTombs = { ...((prev.tombstones?.items) ?? {}) };
      for (const iid of childItemIds) itemTombs[iid] = ts;
      return {
        ...prev,
        spaces: prev.spaces.filter(s => s.id !== id),
        tombstones: {
          ...(prev.tombstones ?? {}),
          spaces: { ...((prev.tombstones?.spaces) ?? {}), [id]: ts },
          items: itemTombs,
        },
      };
    });
  }, [save]);

  // Reorder entry point. All drag operations funnel here — we always enforce the
  // pair invariant after reordering so the saved state can never have a [A→B→C]
  // chain or a dangling pairedWithNext at the tail.
  const reorderSpaces = useCallback((newSpaces: Space[]) => {
    const ts = Date.now();
    // Stamp every space — reorder is a position change for ALL spaces in
    // the array (their relative position is what changed, not which one
    // moved). Without stamping all, only the user-dragged one would win
    // LWW and the others' positions could revert.
    save(prev => ({ ...prev, spaces: enforcePairInvariant(newSpaces).map(s => ({ ...s, lastModifiedAt: ts })) }));
  }, [save]);

  const setSpaceColor = useCallback((id: string, color: string) => {
    const ts = Date.now();
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s => s.id === id ? { ...s, color, lastModifiedAt: ts } : s),
    }));
  }, [save]);

  const setSpaceIcon = useCallback((id: string, icon: string) => {
    const ts = Date.now();
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s => s.id === id ? { ...s, icon, lastModifiedAt: ts } : s),
    }));
  }, [save]);

  // Pair split-ratio setter. The handle sits between the two paired spaces and
  // dragging it adjusts how the row's width is divided. Only the LEFT space of a
  // pair stores the ratio (single source of truth); clamped to [0.25, 0.75] so
  // neither side collapses below a usable width.
  const setPairSplitRatio = useCallback((leftSpaceId: string, ratio: number) => {
    const clamped = Math.max(0.25, Math.min(0.75, ratio));
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s => s.id === leftSpaceId ? { ...s, splitRatio: clamped } : s),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const duplicateSpace = useCallback((spaceId: string) => {
    save(prev => {
      const src = prev.spaces.find(s => s.id === spaceId);
      if (!src) return prev;
      const clone: Space = {
        ...src,
        id: generateId(),
        name: `${src.name} (복사)`,
        items: src.items.map(i => ({ ...i, id: generateId(), clickCount: 0 })),
        pinnedIds: [],
      };
      const idx = prev.spaces.findIndex(s => s.id === spaceId);
      const newSpaces = [...prev.spaces];
      newSpaces.splice(idx + 1, 0, clone);
      return { ...prev, spaces: newSpaces };
    });
  }, [save]);

  const toggleSpaceCollapsed = useCallback((spaceId: string) => {
    save(prev => {
      const collapsed = prev.collapsedSpaceIds ?? [];
      const next = collapsed.includes(spaceId)
        ? collapsed.filter(id => id !== spaceId)
        : [...collapsed, spaceId];
      return { ...prev, collapsedSpaceIds: next };
    });
  }, [save]);

  // F1: frequency + recency score. `clickCount × exp(-ageDays / 30)` — items
  // used a lot rise to the top, but a burst a year ago decays versus recent
  // clicks. Items never clicked fall back to count 0 (always last).
  const usageScore = (item: LauncherItem, now: number): number => {
    const count = item.clickCount ?? 0;
    if (count === 0) return 0;
    const ageDays = item.lastClickedAt ? Math.max(0, (now - item.lastClickedAt) / (24 * 60 * 60 * 1000)) : 365;
    return count * Math.exp(-ageDays / 30);
  };

  const sortSpaceByUsage = useCallback((id: string) => {
    const now = Date.now();
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s => {
        if (s.id !== id) return s;
        const pinnedIds = s.pinnedIds ?? [];
        const pinned = s.items.filter(i => pinnedIds.includes(i.id));
        const rest = s.items.filter(i => !pinnedIds.includes(i.id));
        rest.sort((a, b) => usageScore(b, now) - usageScore(a, now));
        return { ...s, items: [...pinned, ...rest], sortMode: 'usage' };
      }),
    }));
  }, [save]);

  const lockSpaceSort = useCallback((spaceId: string, pinnedIds: string[]) => {
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s => s.id === spaceId ? { ...s, pinnedIds } : s),
    }));
  }, [save]);

  // ── Items ────────────────────────────────────────────────
  // v1.3.48 Phase 2.C: every Item / Space mutation stamps lastModifiedAt
  // so sync's LWW per-entity merger can pick the freshly-edited side on
  // id collision. Deletions push to `tombstones.items` so other devices
  // learn of the removal on pull (instead of resurrecting it from the
  // server's stale snapshot). Host space also stamps when its items
  // array shape changes (add / delete) — so a space-level LWW correctly
  // wins over a stale server-side space record.
  const addItem = useCallback((spaceId: string, item: Omit<LauncherItem, 'id'>, presetId?: string) => {
    const ts = Date.now();
    const newItem: LauncherItem = {
      ...item,
      id: presetId ?? generateId(),
      clickCount: 0,
      pinned: false,
      lastModifiedAt: ts,
    };
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s =>
        s.id === spaceId
          ? { ...s, lastModifiedAt: ts, items: [...s.items, newItem] }
          : s
      ),
    }));
    return newItem;
  }, [save]);

  const updateItem = useCallback((spaceId: string, item: LauncherItem) => {
    const ts = Date.now();
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s =>
        s.id === spaceId
          ? { ...s, items: s.items.map(i => i.id === item.id ? { ...item, lastModifiedAt: ts } : i) }
          : s
      ),
    }));
  }, [save]);

  const deleteItem = useCallback((spaceId: string, itemId: string) => {
    // Cascade cleanup: remove the deleted id from any node groups,
    // decks, container slots, and pinned-id sets that still
    // reference it. Without this, node order numbers drift (a node
    // shows "1, _, 3" with a hole) and the gauge / staging UI counts
    // a phantom member ("3/3" when only 2 cards exist). Same for
    // decks. Same write tx as the items[] mutation so we don't
    // momentarily expose a half-cleaned state to subscribers.
    const ts = Date.now();
    save(prev => ({
      ...prev,
      // v1.3.48 Phase 2.C: register the deletion in the tombstone map so
      // sync can propagate it to other devices. Without this, the next
      // pull from a server that still has this card would treat it as
      // "new server-only" and resurrect it locally.
      tombstones: {
        ...(prev.tombstones ?? {}),
        items: { ...((prev.tombstones?.items) ?? {}), [itemId]: ts },
      },
      spaces: prev.spaces.map(s => {
        if (s.id !== spaceId) {
          const slotsCleaner = (i: LauncherItem): LauncherItem => {
            if (!i.isContainer || !i.slots) return i;
            const newSlots: ContainerSlots = { ...i.slots };
            (['up','down','left','right'] as const).forEach(d => {
              if (newSlots[d] === itemId) delete newSlots[d];
            });
            return { ...i, slots: newSlots };
          };
          return { ...s, items: s.items.map(slotsCleaner) };
        }
        const slotsCleaner = (i: LauncherItem): LauncherItem => {
          if (!i.isContainer || !i.slots) return i;
          const newSlots: ContainerSlots = { ...i.slots };
          (['up','down','left','right'] as const).forEach(d => {
            if (newSlots[d] === itemId) delete newSlots[d];
          });
          return { ...i, slots: newSlots };
        };
        return {
          ...s,
          lastModifiedAt: ts,
          items: s.items.filter(i => i.id !== itemId).map(slotsCleaner),
          pinnedIds: (s.pinnedIds ?? []).filter(id => id !== itemId),
        };
      }),
      nodeGroups: (prev.nodeGroups ?? [])
        .map(g => ({ ...g, itemIds: g.itemIds.filter(id => id !== itemId) }))
        .filter(g => g.itemIds.length >= 2),
      decks: (prev.decks ?? [])
        .map(d => ({ ...d, itemIds: d.itemIds.filter(id => id !== itemId) })),
    }));
  }, [save]);

  /**
   * Apply many partial item patches in a single store write. The favicon
   * migration uses this to fold N data-URL conversions into one save —
   * calling updateItem in a loop closes over stale `data` and makes later
   * calls overwrite earlier ones. Patches are keyed by (spaceId, itemId)
   * and only the listed fields are merged; everything else on the item
   * stays as-is.
   */
  const patchItems = useCallback((patches: Array<{
    spaceId: string;
    itemId: string;
    patch: Partial<LauncherItem>;
  }>) => {
    if (patches.length === 0) return;
    const bySpace = new Map<string, Map<string, Partial<LauncherItem>>>();
    for (const { spaceId, itemId, patch } of patches) {
      let m = bySpace.get(spaceId);
      if (!m) { m = new Map(); bySpace.set(spaceId, m); }
      m.set(itemId, { ...(m.get(itemId) ?? {}), ...patch });
    }
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s => {
          const updates = bySpace.get(s.id);
          if (!updates) return s;
          return {
            ...s,
            items: s.items.map(i => {
              const u = updates.get(i.id);
              return u ? { ...i, ...u } : i;
            }),
          };
        }),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, [setDataRaw]);

  // ── Batch add / delete (functional-update form — safe for loops) ──
  // Regular addItem/deleteItem close over `data`, so calling them in a synchronous
  // loop makes each call overwrite the previous one. These two operate on `prev`
  // inside setDataRaw, so every item in the batch is preserved / removed atomically.
  const addItems = useCallback((spaceId: string, items: Omit<LauncherItem, 'id'>[]): LauncherItem[] => {
    const ts = Date.now();
    const newItems: LauncherItem[] = items.map(it => ({
      ...it,
      id: generateId(),
      clickCount: 0,
      pinned: false,
      lastModifiedAt: ts,
    }));
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s =>
          s.id === spaceId ? { ...s, lastModifiedAt: ts, items: [...s.items, ...newItems] } : s
        ),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
    return newItems;
  }, []);

  const deleteItems = useCallback((spaceId: string, itemIds: string[]) => {
    if (itemIds.length === 0) return;
    const idSet = new Set(itemIds);
    const ts = Date.now();
    setDataRaw(prev => {
      // Cascade cleanup mirrors single deleteItem — strip from
      // nodeGroups / decks / pinnedIds, drop sub-2 nodes.
      // v1.3.48 Phase 2.C: batch tombstone — same propagation guarantee
      // as deleteItem (other devices learn of the deletes on pull).
      const newItemTombs = { ...((prev.tombstones?.items) ?? {}) };
      for (const id of itemIds) newItemTombs[id] = ts;
      const newNodeGroups = (prev.nodeGroups ?? [])
        .map(g => ({ ...g, itemIds: g.itemIds.filter(id => !idSet.has(id)) }))
        .filter(g => g.itemIds.length >= 2);
      const newDecks = (prev.decks ?? [])
        .map(d => ({ ...d, itemIds: d.itemIds.filter(id => !idSet.has(id)) }));
      const next: AppData = {
        ...prev,
        tombstones: {
          ...(prev.tombstones ?? {}),
          items: newItemTombs,
        },
        spaces: prev.spaces.map(s =>
          s.id === spaceId
            ? {
                ...s,
                lastModifiedAt: ts,
                items: s.items.filter(i => !idSet.has(i.id)),
                pinnedIds: (s.pinnedIds ?? []).filter(id => !idSet.has(id)),
              }
            : s
        ),
        nodeGroups: newNodeGroups,
        decks: newDecks,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  /**
   * Delete every unpinned, non-container item in a single space.
   *
   * Pin state in this app is tracked via `space.pinnedIds` (an id-set on the
   * space), NOT `item.pinned` (a legacy boolean used for initial seed data).
   * The pin-mode click handler in App.tsx toggles pinnedIds and never
   * touches `i.pinned`, so a filter on `i.pinned` would see every user-pinned
   * card as unpinned. We intersect against `pinnedIds` to match UI reality.
   *
   * Containers are also preserved — they hold layout metadata (slots) and
   * removing them orphans their child windows.
   */
  const deleteUnpinnedInSpace = useCallback((spaceId: string): number => {
    let removed = 0;
    setDataRaw(prev => {
      const target = prev.spaces.find(s => s.id === spaceId);
      if (!target) return prev;
      const pinSet = new Set(target.pinnedIds ?? []);
      const keep = target.items.filter(i => pinSet.has(i.id) || i.isContainer);
      removed = target.items.length - keep.length;
      if (removed === 0) return prev;
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s => s.id === spaceId ? { ...s, items: keep } : s),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
    return removed;
  }, []);

  /**
   * Delete unpinned items across every space. Preserves the space structure —
   * only items are touched, empty spaces remain.
   */
  const deleteUnpinnedInAllSpaces = useCallback((): number => {
    let removed = 0;
    setDataRaw(prev => {
      let total = 0;
      const nextSpaces = prev.spaces.map(s => {
        const pinSet = new Set(s.pinnedIds ?? []);
        const keep = s.items.filter(i => pinSet.has(i.id) || i.isContainer);
        total += s.items.length - keep.length;
        return { ...s, items: keep };
      });
      removed = total;
      if (removed === 0) return prev;
      const next: AppData = { ...prev, spaces: nextSpaces };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
    return removed;
  }, []);

  // ── Undo helpers (functional-update form — no stale closure risk) ──
  // Always reads latest state via `prev`, so the closure captured at delete-time
  // still restores correctly even after subsequent state changes.
  const restoreItem = useCallback((spaceId: string, item: LauncherItem) => {
    setDataRaw(prev => {
      const space = prev.spaces.find(s => s.id === spaceId);
      // Skip if the space is gone or the item already exists (double-undo guard)
      if (!space || space.items.some(i => i.id === item.id)) return prev;
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s =>
          s.id === spaceId ? { ...s, items: [...s.items, item] } : s
        ),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const restoreSpace = useCallback((space: Space) => {
    setDataRaw(prev => {
      // Skip if the space was somehow re-added already
      if (prev.spaces.some(s => s.id === space.id)) return prev;
      const next: AppData = { ...prev, spaces: [...prev.spaces, space] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const incrementClickCount = useCallback((spaceId: string, itemId: string) => {
    // Functional save — closure-stale `data` would silently overwrite
    // any not-yet-committed mutation (e.g. a card add from the same
    // tick). 카드 클릭 = 매우 빈번한 트리거이므로 race 의 주범. (Pattern A)
    // v1.3.48 Phase 2.C: stamp item.lastModifiedAt — click count is part
    // of the synced state (usage score) so it should win LWW on conflict.
    const now = Date.now();
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s =>
        s.id === spaceId
          ? { ...s, items: s.items.map(i => i.id === itemId ? { ...i, clickCount: (i.clickCount ?? 0) + 1, lastClickedAt: now, lastModifiedAt: now } : i) }
          : s
      ),
    }));
  }, [save]);

  const reorderItems = useCallback((spaceId: string, items: LauncherItem[]) => {
    const ts = Date.now();
    // v1.3.48 Phase 2.D: 위치는 space.items[] 의 순서가 소유 — item 컨텐츠
    // 자체엔 position 필드가 없음. 따라서 reorder 는 SPACE 만 stamp.
    // (이전 Phase 2.C 에선 모든 item 도장했는데, 그 결과 한쪽에서 본문 수정
    // → 다른쪽에서 reorder → sync 시 reorder 가 본문 수정을 덮음. P2.D 의
    // mergeSpacesLWW primary 기반 머지 로직과 함께 이 분리가 핵심.)
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s =>
        s.id === spaceId ? { ...s, lastModifiedAt: ts, items } : s
      ),
    }));
  }, [save]);

  const moveItemToSpace = useCallback((itemId: string, fromSpaceId: string, toSpaceId: string) => {
    if (fromSpaceId === toSpaceId) return;
    const ts = Date.now();
    // v1.3.48 Phase 2.D: 이동도 위치 변경이지 컨텐츠 변경이 아니므로
    // item 은 도장 안 함. 두 space (잃은 쪽 / 얻은 쪽) 만 도장. 동시 편집
    // 시 PC1 본문수정 + PC2 이동 → 둘 다 살아남음.
    save(prev => {
      const fromSpace = prev.spaces.find(s => s.id === fromSpaceId);
      const item = fromSpace?.items.find(i => i.id === itemId);
      if (!item) return prev;
      return {
        ...prev,
        spaces: prev.spaces.map(s => {
          if (s.id === fromSpaceId) return { ...s, lastModifiedAt: ts, items: s.items.filter(i => i.id !== itemId) };
          if (s.id === toSpaceId)   return { ...s, lastModifiedAt: ts, items: [...s.items, item] };
          return s;
        }),
      };
    });
  }, [save]);

  const updateItemAndMove = useCallback((fromSpaceId: string, toSpaceId: string, item: LauncherItem) => {
    const ts = Date.now();
    const updatedItem = { ...item, lastModifiedAt: ts };
    save(prev => ({
      ...prev,
      spaces: prev.spaces.map(s => {
        if (s.id === fromSpaceId) return { ...s, lastModifiedAt: ts, items: s.items.filter(i => i.id !== item.id) };
        if (s.id === toSpaceId)   return { ...s, lastModifiedAt: ts, items: [...s.items, updatedItem] };
        return s;
      }),
    }));
  }, [save]);

  /**
   * Move an item to a space in a DIFFERENT preset (and update its content
   * in the same write). Used by ItemDialog when the user picks a different
   * preset in the edit dropdowns.
   *
   * IMPORTANT: bypasses `setDataRaw` and goes straight to `setRawData`.
   * `setDataRaw` is a convenience wrapper that folds active-preset
   * mutations back into the `presets[]` shape — but it does the OPPOSITE
   * of what we need here: it ignores any direct `presets[]` modification
   * the caller makes and only propagates `flatNext.spaces`. We're
   * deliberately mutating non-active presets, so we need raw control.
   *
   * The bug this fixes: cards moved into a non-active preset would
   * disappear into the void. The mirror logic dropped the item from the
   * source (which IS the active preset) but never propagated the addition
   * to the target preset, so the card vanished from both ends.
   */
  const moveItemAcrossPresets = useCallback((
    itemId: string,
    targetPresetId: string,
    targetSpaceId: string,
    updatedItem: LauncherItem,
  ) => {
    setRawData(prev => {
      const sourcePreset = prev.presets.find(p => p.spaces.some(s => s.items.some(i => i.id === itemId)));
      if (!sourcePreset || sourcePreset.id === targetPresetId) return prev;

      const removeFrom = (s: Space) => ({ ...s, items: s.items.filter(i => i.id !== itemId) });
      const addTo = (s: Space) => s.id === targetSpaceId ? { ...s, items: [...s.items, updatedItem] } : s;

      const newPresets = prev.presets.map(p => {
        if (p.id === sourcePreset.id) return { ...p, spaces: p.spaces.map(removeFrom) };
        if (p.id === targetPresetId)  return { ...p, spaces: p.spaces.map(addTo) };
        return p;
      });

      let nextSpaces = prev.spaces;
      if (prev.activePresetId === sourcePreset.id) nextSpaces = nextSpaces.map(removeFrom);
      if (prev.activePresetId === targetPresetId)  nextSpaces = nextSpaces.map(addTo);

      const next = { ...prev, presets: newPresets, spaces: nextSpaces };
      // Mirror what `save` does — persist + tell main to refresh badges,
      // since cross-preset moves can affect floatingBadges visibility on
      // preset switch.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next).then(() => electronAPI.syncBadges());
      return next;
    });
  }, []);

  // ── Node Groups ──────────────────────────────────────────
  const getNodeGroupForItem = useCallback((itemId: string): NodeGroup | undefined => {
    return (data.nodeGroups ?? []).find(g => g.itemIds.includes(itemId));
  }, [data.nodeGroups]);

  // ── Node Groups / Decks — Pattern A + Phase 2.C stamping/tombstone ─
  const addNodeGroup = useCallback((name: string, itemIds: string[]) => {
    const ts = Date.now();
    const group: NodeGroup = { id: generateId(), name, itemIds, lastModifiedAt: ts };
    save(prev => ({ ...prev, nodeGroups: [...(prev.nodeGroups ?? []), group] }));
  }, [save]);

  const updateNodeGroup = useCallback((id: string, updates: Partial<Pick<NodeGroup, 'name' | 'itemIds' | 'monitor' | 'icon'>>) => {
    const ts = Date.now();
    save(prev => ({
      ...prev,
      nodeGroups: (prev.nodeGroups ?? []).map(g => g.id === id ? { ...g, ...updates, lastModifiedAt: ts } : g),
    }));
  }, [save]);

  const deleteNodeGroup = useCallback((id: string) => {
    const ts = Date.now();
    save(prev => ({
      ...prev,
      nodeGroups: (prev.nodeGroups ?? []).filter(g => g.id !== id),
      tombstones: {
        ...(prev.tombstones ?? {}),
        nodeGroups: { ...((prev.tombstones?.nodeGroups) ?? {}), [id]: ts },
      },
    }));
  }, [save]);

  const reorderNodeGroups = useCallback((groups: NodeGroup[]) => {
    const ts = Date.now();
    save(prev => ({ ...prev, nodeGroups: groups.map(g => ({ ...g, lastModifiedAt: ts })) }));
  }, [save]);

  // ── Decks ────────────────────────────────────────────────
  const addDeck = useCallback((name: string, itemIds: string[]) => {
    const ts = Date.now();
    const deck: Deck = { id: generateId(), name, itemIds, lastModifiedAt: ts };
    save(prev => ({ ...prev, decks: [...(prev.decks ?? []), deck] }));
  }, [save]);

  const updateDeck = useCallback((id: string, updates: Partial<Pick<Deck, 'name' | 'itemIds' | 'monitor'>>) => {
    const ts = Date.now();
    save(prev => ({ ...prev, decks: (prev.decks ?? []).map(d => d.id === id ? { ...d, ...updates, lastModifiedAt: ts } : d) }));
  }, [save]);

  const deleteDeck = useCallback((id: string) => {
    const ts = Date.now();
    save(prev => ({
      ...prev,
      decks: (prev.decks ?? []).filter(d => d.id !== id),
      tombstones: {
        ...(prev.tombstones ?? {}),
        decks: { ...((prev.tombstones?.decks) ?? {}), [id]: ts },
      },
    }));
  }, [save]);

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
    save(prev => {
    let nextSpaces = prev.spaces;

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
    // v1.3.48 Phase 2.C: stamp container item — slots is content of the
    // container card, content change deserves LWW timestamp bump.
    const slotsTs = Date.now();
    nextSpaces = nextSpaces.map(s =>
      s.id === containerSpaceId
        ? { ...s, lastModifiedAt: slotsTs, items: s.items.map(i => i.id === containerItemId ? { ...i, slots, lastModifiedAt: slotsTs } : i) }
        : s
    );

      return { ...prev, spaces: nextSpaces };
    });
  }, [save]);

  /**
   * Atomic "drag-into-slot" assignment used by the Bloom UX.
   *
   *  - Source item: marked `hiddenInSpace: true` so it disappears from
   *    its source space's grid (it now lives "inside" the container).
   *  - Container's slots[dir] = sourceItemId. Other directions kept,
   *    *unless* the same source was already in another direction —
   *    that slot is cleared (a single item never lives in two slots).
   *  - Whatever was previously in `dir` (if anything, and if it's not
   *    still in another slot of this container) is *restored*: we flip
   *    its `hiddenInSpace` back to `false` so the user gets that item
   *    back in their space grid instead of orphaning it. This is
   *    intentionally different from the modal's "save slots" flow,
   *    which keeps replaced items hidden — drag interactions are
   *    incremental, so the principle of least surprise wins.
   *
   * Single `save()` call — atomic — because doing this as three chained
   * store mutations races against stale closures (same lesson as
   * saveContainerSlots).
   */
  const assignSlotFromItem = useCallback((opts: {
    containerSpaceId: string;
    containerId: string;
    dir: 'up' | 'down' | 'left' | 'right';
    sourceItemId: string;
  }) => {
    const { containerSpaceId, containerId, dir, sourceItemId } = opts;
    save(prev => {
    let nextSpaces = prev.spaces;

    const container = nextSpaces.find(s => s.id === containerSpaceId)
                                ?.items.find(i => i.id === containerId);
    if (!container?.isContainer) return prev;
    const oldSlots = container.slots ?? {};
    const oldSlotItemId = oldSlots[dir];
    if (oldSlotItemId === sourceItemId) return prev; // no-op

    // Compose new slots: copy others, drop source from any other slot,
    // then write source into `dir`.
    const newSlots: ContainerSlots = {};
    for (const k of ['up', 'down', 'left', 'right'] as const) {
      const cur = oldSlots[k];
      if (cur && cur !== sourceItemId && k !== dir) newSlots[k] = cur;
    }
    newSlots[dir] = sourceItemId;

    // Items that need their hiddenInSpace flipped to false (restored
    // to their original space). Only the previous occupant of `dir`
    // qualifies, and only if it's not still referenced by some other
    // slot in this container (which can happen if the source item
    // came from another slot of the same container).
    const toRestore = new Set<string>();
    if (oldSlotItemId && oldSlotItemId !== sourceItemId &&
        !Object.values(newSlots).includes(oldSlotItemId)) {
      toRestore.add(oldSlotItemId);
    }

    // Apply hidden-flag changes everywhere they need to apply.
    nextSpaces = nextSpaces.map(s => ({
      ...s,
      items: s.items.map(i =>
        i.id === sourceItemId ? { ...i, hiddenInSpace: true }
        : toRestore.has(i.id) ? { ...i, hiddenInSpace: false }
        : i,
      ),
    }));

    // Update the container's slots field.
    // v1.3.48 Phase 2.C: stamp container — slots is content.
    const assignTs = Date.now();
    nextSpaces = nextSpaces.map(s =>
      s.id === containerSpaceId
        ? { ...s, lastModifiedAt: assignTs, items: s.items.map(i => i.id === containerId ? { ...i, slots: newSlots, lastModifiedAt: assignTs } : i) }
        : s,
    );

      return { ...prev, spaces: nextSpaces };
    });
  }, [save]);

  // ── Dismissed suggestions (F5: cooldown structure) ────────
  // Each dismiss records its timestamp and increments the count; useGhostCards
  // checks if the cooldown window has elapsed before re-showing the suggestion.
  const dismissSuggestion = useCallback((value: string) => {
    const now = Date.now();
    save(prev => {
      const prior = prev.dismissals?.[value];
      const dismissals = {
        ...(prev.dismissals ?? {}),
        [value]: { at: now, count: (prior?.count ?? 0) + 1 },
      };
      return { ...prev, dismissals };
    });
  }, [save]);

  /**
   * Pull the persisted data from electron-store and replace local state.
   * Used when the main process mutates settings out-of-band (e.g. tray menu
   * or floating-orb right-click toggling the floating button on/off).
   */
  const reloadFromStore = useCallback(async () => {
    const loaded = await electronAPI.storeLoad();
    if (!loaded) return;
    const next = migrateData(loaded as AppData);
    setRawData(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  // ── Floating badges (Phase 2) ────────────────────────────
  // Main is the source of truth for the floatingBadges array — mutations from
  // the overlay (click/unpin/drag) flow back through the `badges-updated` IPC,
  // and this setter reconciles local state without triggering a redundant
  // storeSave (main has already persisted to electron-store).
  const setFloatingBadgesLocal = useCallback((next: import('../types').FloatingBadge[]) => {
    setDataRaw(prev => {
      if (JSON.stringify(prev.floatingBadges) === JSON.stringify(next)) return prev;
      const patched = { ...prev, floatingBadges: next };
      // Mirror into localStorage so next session's sync-load reflects latest.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(patched));
      return patched;
    });
  }, []);

  // ── Licensing (Phase 5) ───────────────────────────────────
  /**
   * Replace the license snapshot. Called by useLicenseSync when the server
   * returns a fresh verify response, by the checkout flow on successful
   * payment, and by startTrial() below.
   */
  const setLicense = useCallback((license: import('../types').License | undefined) => {
    setRawData(prev => {
      const next: AppData = {
        ...prev,
        settings: { ...prev.settings, license },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  /** Client-award the 14-day trial. Idempotent — if a trial is already active
   *  or previously consumed, this is a no-op. The server re-signs the trial
   *  window on first login so stolen clocks can't extend it. */
  const startTrialIfEligible = useCallback(() => {
    setRawData(prev => {
      const existing = prev.settings.license;
      // Trial is a one-shot gift — any prior license (even expired) forfeits it.
      if (existing) return prev;
      const next: AppData = {
        ...prev,
        settings: { ...prev.settings, license: newTrialLicense() },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  // ── Settings ─────────────────────────────────────────────
  // Idempotent: every IPC AND the save fire only when their respective
  // value actually changed vs. the current store state. Critical for
  // the v1.3.42 loop fix — without this guard, a slider re-firing
  // onValueChange on programmatic value updates (base-ui quirk) would
  // call updateSettings every render with the same payload, blasting
  // setOpacity/setAutoHide/setWindowOpenAt/updateShortcut IPCs in a
  // tight loop and saving 100KB+ to electron-store 25×/s — which
  // crashed the renderer on heavy interaction (resize / drag).
  const updateSettings = useCallback((settings: AppSettings) => {
    const prev = data.settings;
    if (settings.opacity !== prev.opacity) {
      electronAPI.setOpacity(settings.opacity);
    }
    if (settings.shortcut !== prev.shortcut) {
      electronAPI.updateShortcut(settings.shortcut);
    }
    if (!!settings.autoHide !== !!prev.autoHide) {
      electronAPI.setAutoHide(!!settings.autoHide);
    }
    const nextOpenAt = settings.windowOpenAt === 'last' ? 'last' : 'cursor';
    const prevOpenAt = prev.windowOpenAt === 'last' ? 'last' : 'cursor';
    if (nextOpenAt !== prevOpenAt) {
      electronAPI.setWindowOpenAt(nextOpenAt);
    }
    if (typeof settings.windowSizePct === 'number' &&
        settings.windowSizePct !== prev.windowSizePct) {
      electronAPI.setWindowSizePct(settings.windowSizePct);
    }
    // Skip the entire save round-trip when nothing changed. Equality
    // via stringify — settings is < 1 KB so the cost is negligible
    // (~3 µs) vs. the ~12 ms of a wasted storeSave IPC + disk write.
    try {
      if (JSON.stringify(settings) === JSON.stringify(prev)) return;
    } catch { /* settings has unserialisable shape — fall through, do save */ }
    save(prev => ({ ...prev, settings }));
  }, [data.settings, save]);

  // ── Memos (사라지는 메모) ─────────────────────────────────
  // Thin wrappers over addItem/updateItem that bake the memo-specific
  // shape — keeping the call sites readable. The TTL math lives in
  // memoUtils so tests can validate it without going through React.
  const addMemo = useCallback((spaceId: string, initialBody?: string): LauncherItem | null => {
    const now = Date.now();
    const settings = data.settings.memo ?? { ...DEFAULT_MEMO_SETTINGS };
    const ttlDays = settings.defaultTtlDays;
    const memo: MemoData = {
      body: initialBody ?? '',
      createdAt: now,
      expiresAt: now + ttlDays * 24 * 60 * 60 * 1000,
      lastTouchedAt: now,
    };
    return addItem(spaceId, {
      type: 'memo',
      title: '',                    // computed from body at render time
      value: '',                    // unused for memo (mirrors widget pattern)
      iconType: 'material',
      icon: 'sticky_note_2',
      clickCount: 0,
      pinned: false,
      memo,
    });
  }, [data.settings.memo, addItem]);

  /**
   * Update a memo's body and RESET its TTL (edits = 살리기). Caller is
   * responsible for the debounce; we just commit the latest snapshot.
   * The title field is also regenerated so search / accessibility stay
   * in sync.
   */
  const updateMemoBody = useCallback((spaceId: string, itemId: string, body: string) => {
    const now = Date.now();
    const settings = data.settings.memo ?? { ...DEFAULT_MEMO_SETTINGS };
    const ttlMs = settings.defaultTtlDays * 24 * 60 * 60 * 1000;
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s => s.id !== spaceId ? s : {
          ...s,
          items: s.items.map(i => {
            if (i.id !== itemId || i.type !== 'memo' || !i.memo) return i;
            // Lazy-import to avoid circular: derive title here inline.
            const firstLine = (() => {
              for (const raw of body.split(/\r?\n/)) {
                const line = raw.replace(/^\s*[-*+•]\s+/, '').replace(/^\s*#{1,6}\s+/, '').replace(/^\s*\[[ xX]\]\s+/, '').trim();
                if (line.length > 0) return line.slice(0, 80);
              }
              return '';
            })();
            return {
              ...i,
              title: firstLine,
              memo: {
                ...i.memo,
                body,
                lastTouchedAt: now,
                expiresAt: now + ttlMs,
              },
            };
          }),
        }),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, [data.settings.memo, setDataRaw]);

  /** "점 톡 살리기" — TTL reset only, body untouched. */
  const extendMemo = useCallback((spaceId: string, itemId: string) => {
    const now = Date.now();
    const settings = data.settings.memo ?? { ...DEFAULT_MEMO_SETTINGS };
    const ttlMs = settings.defaultTtlDays * 24 * 60 * 60 * 1000;
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s => s.id !== spaceId ? s : {
          ...s,
          items: s.items.map(i => {
            if (i.id !== itemId || i.type !== 'memo' || !i.memo) return i;
            return { ...i, memo: { ...i.memo, lastTouchedAt: now, expiresAt: now + ttlMs, trashedAt: undefined } };
          }),
        }),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, [data.settings.memo, setDataRaw]);

  /** Manual trash (× button on card) — sets trashedAt without waiting for TTL. */
  const trashMemo = useCallback((spaceId: string, itemId: string) => {
    const now = Date.now();
    setDataRaw(prev => {
      const next: AppData = {
        ...prev,
        spaces: prev.spaces.map(s => s.id !== spaceId ? s : {
          ...s,
          items: s.items.map(i => {
            if (i.id !== itemId || i.type !== 'memo' || !i.memo) return i;
            return { ...i, memo: { ...i.memo, trashedAt: now } };
          }),
        }),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, [setDataRaw]);

  /** Bulk: extend every active (non-trashed, non-pinned) memo by the
   *  default TTL — the buried-in-settings emergency button. */
  const extendAllMemos = useCallback((): number => {
    let count = 0;
    const now = Date.now();
    const settings = data.settings.memo ?? { ...DEFAULT_MEMO_SETTINGS };
    const ttlMs = settings.defaultTtlDays * 24 * 60 * 60 * 1000;
    setDataRaw(prev => {
      const sweep = (i: LauncherItem): LauncherItem => {
        if (i.type !== 'memo' || !i.memo || i.memo.trashedAt || i.pinned) return i;
        count++;
        return { ...i, memo: { ...i.memo, lastTouchedAt: now, expiresAt: now + ttlMs } };
      };
      const newPresets = prev.presets.map(p => ({
        ...p,
        spaces: p.spaces.map(s => ({ ...s, items: s.items.map(sweep) })),
      }));
      const active = newPresets.find(p => p.id === prev.activePresetId)!;
      const next: AppData = { ...prev, presets: newPresets, spaces: active.spaces };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
    return count;
  }, [data.settings.memo, setDataRaw]);

  // ── Notifications (bell-icon panel) ──────────────────────────
  //
  // Sources push via `addNotification`; the panel reads via the
  // returned `notifications` array. Dedup keys collapse repeated
  // pushes from the same source (electron-updater fires "available"
  // on every check; we dedupe by `update-available-${version}`).
  // Mark-all-read fires when the panel opens — this is the entire
  // "read" model (no per-row click-to-read).
  const addNotification = useCallback((notif: Omit<AppNotification, 'id' | 'createdAt'> & { id?: string }) => {
    const now = Date.now();
    setRawData(prev => {
      const existing = prev.notifications ?? [];
      // Dedup by key — if we already have a non-dismissed notif with
      // the same key, refresh its createdAt and bail (no duplicate).
      if (notif.dedupKey) {
        const dupIdx = existing.findIndex(n => n.dedupKey === notif.dedupKey && !n.dismissedAt);
        if (dupIdx >= 0) {
          const merged: AppNotification = {
            ...existing[dupIdx],
            // Refresh fields the source might have updated, but keep id/createdAt.
            title: notif.title,
            body: notif.body,
            action: notif.action,
            // A repeat push counts as a fresh read prompt — clear readAt.
            readAt: undefined,
          };
          const nextList = existing.slice();
          nextList[dupIdx] = merged;
          const next = { ...prev, notifications: nextList };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          electronAPI.storeSave(next);
          return next;
        }
      }
      const newNotif: AppNotification = {
        ...notif,
        id: notif.id ?? generateId(),
        createdAt: now,
      };
      // Newest first — panel renders in order.
      const nextList = [newNotif, ...existing];
      const next = { ...prev, notifications: nextList };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  // Set the persistent "extension has ever connected" flag. Once true,
  // stays true — only manual reset (Settings → 데이터 → 초기화) clears it.
  // Idempotent: no-op when already true so we can call it on every
  // successful SSE handshake without thrashing the store.
  const markExtensionConnected = useCallback(() => {
    setRawData(prev => {
      if (prev.settings.extensionEverConnected) return prev;
      const next: AppData = {
        ...prev,
        settings: { ...prev.settings, extensionEverConnected: true },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const dismissNotification = useCallback((id: string) => {
    const now = Date.now();
    setRawData(prev => {
      const existing = prev.notifications ?? [];
      let touched = false;
      const nextList = existing.map(n => {
        if (n.id === id && !n.dismissedAt) { touched = true; return { ...n, dismissedAt: now }; }
        return n;
      });
      if (!touched) return prev;
      const next = { ...prev, notifications: nextList };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  // Dismiss a notification by its dedupKey — handy when a source wants
  // to retract its own alert (e.g. ext reconnect after a disconnect
  // notification was shown). No-ops if nothing matches.
  const dismissNotificationByDedupKey = useCallback((dedupKey: string) => {
    const now = Date.now();
    setRawData(prev => {
      const existing = prev.notifications ?? [];
      const idx = existing.findIndex(n => n.dedupKey === dedupKey && !n.dismissedAt);
      if (idx < 0) return prev;
      const nextList = existing.slice();
      nextList[idx] = { ...nextList[idx], dismissedAt: now };
      const next = { ...prev, notifications: nextList };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const dismissAllNotifications = useCallback(() => {
    const now = Date.now();
    setRawData(prev => {
      const existing = prev.notifications ?? [];
      let touched = false;
      const nextList = existing.map(n => {
        if (!n.dismissedAt) { touched = true; return { ...n, dismissedAt: now }; }
        return n;
      });
      if (!touched) return prev;
      const next = { ...prev, notifications: nextList };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    const now = Date.now();
    setRawData(prev => {
      const existing = prev.notifications ?? [];
      let touched = false;
      const nextList = existing.map(n => {
        if (!n.readAt && !n.dismissedAt) { touched = true; return { ...n, readAt: now }; }
        return n;
      });
      if (!touched) return prev;
      const next = { ...prev, notifications: nextList };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  }, []);

  // 30-day sweep — runs ONCE on mount. Keeps the array bounded for
  // users who never open the bell. We delete (not just dismiss) since
  // these have already been ignored for a month.
  useEffect(() => {
    const now = Date.now();
    setRawData(prev => {
      const existing = prev.notifications ?? [];
      if (existing.length === 0) return prev;
      const kept = existing.filter(n => now - n.createdAt < NOTIFICATION_MAX_AGE_MS);
      if (kept.length === existing.length) return prev;
      const next = { ...prev, notifications: kept };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Hard-empty trash across all presets. Returns count purged. */
  const emptyMemoTrash = useCallback((): number => {
    let count = 0;
    setDataRaw(prev => {
      const filterSpace = (s: Space): Space => {
        const kept = s.items.filter(i => !(i.type === 'memo' && i.memo?.trashedAt));
        const removed = s.items.length - kept.length;
        if (removed === 0) return s;
        count += removed;
        return { ...s, items: kept };
      };
      const newPresets = prev.presets.map(p => ({
        ...p,
        spaces: p.spaces.map(filterSpace),
      }));
      const active = newPresets.find(p => p.id === prev.activePresetId)!;
      const next: AppData = { ...prev, presets: newPresets, spaces: active.spaces };
      if (count === 0) return prev;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      electronAPI.storeSave(next);
      return next;
    });
    return count;
  }, [setDataRaw]);

  return {
    data,
    isFirstRun,
    /** Replace the entire AppData tree. Used by Phase 2 sync's
     *  server-wins pull (P2.A) and by future restore/import flows.
     *  Equivalent to internal `save()` but exposed with a more
     *  intention-revealing name. */
    replaceAll: save,
    addSpace,
    renameSpace,
    deleteSpace,
    reorderSpaces,
    setSpaceColor,
    setSpaceIcon,
    setPairSplitRatio,
    duplicateSpace,
    toggleSpaceCollapsed,
    sortSpaceByUsage,
    lockSpaceSort,
    addItem,
    addItems,
    updateItem,
    patchItems,
    deleteItem,
    deleteItems,
    deleteUnpinnedInSpace,
    deleteUnpinnedInAllSpaces,
    restoreItem,
    restoreSpace,
    incrementClickCount,
    reorderItems,
    moveItemToSpace,
    updateItemAndMove,
    moveItemAcrossPresets,
    updateSettings,
    reloadFromStore,
    getNodeGroupForItem,
    addNodeGroup,
    updateNodeGroup,
    deleteNodeGroup,
    reorderNodeGroups,
    addDeck,
    updateDeck,
    deleteDeck,
    saveContainerSlots,
    assignSlotFromItem,
    setFloatingBadgesLocal,
    dismissSuggestion,
    // ── Preset + tour (Phase 4) ────────────────────────────────
    presets: raw.presets,
    activePresetId: raw.activePresetId,
    setActivePreset,
    renamePreset,
    moveSpaceToPreset,
    completedTours: raw.completedTours ?? [],
    markTourCompleted,
    // ── Licensing (Phase 5) ────────────────────────────────────
    setLicense,
    startTrialIfEligible,
    // ── Memos (사라지는 메모) ──────────────────────────────────
    addMemo,
    updateMemoBody,
    extendMemo,
    trashMemo,
    extendAllMemos,
    emptyMemoTrash,
    // ── Notifications (bell icon panel) ────────────────────────
    notifications: raw.notifications ?? [],
    addNotification,
    dismissNotification,
    dismissNotificationByDedupKey,
    dismissAllNotifications,
    markAllNotificationsRead,
    // ── Extension state (persistent "once-seen" flag) ──────────
    markExtensionConnected,
  };
}
