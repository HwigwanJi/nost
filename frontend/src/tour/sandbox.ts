/**
 * Tutorial sandbox — temporary AppData replacement so users can practice
 * each tour interactively without nuking their real cards.
 *
 * Why a full data swap rather than a separate "tutorial preset"
 * ────────────────────────────────────────────────────────────
 * - Several features the tours teach are GLOBAL, not preset-scoped:
 *   floating badges, license/quota state, completedTours, settings.
 *   A "4th preset" wouldn't isolate those.
 * - The renderer's store hooks all read from a single AppData shape; making
 *   every mutation route-aware was a bigger refactor than just swapping the
 *   whole object.
 * - Tutorial is short (≤90s) — paying for one extra storeSave round-trip on
 *   enter and one on exit is fine.
 *
 * Safety net
 * ──────────
 * Before the swap we ask main to write a timestamped .nost file to
 * userData/tutorial-backups/. The user reported once losing their cards
 * during an experimental flow, so even though we keep an in-memory snapshot
 * we ALSO drop a disk copy as belt-and-braces. If the renderer crashes
 * mid-tour, on next launch the user can find the file and import it.
 */

import { generateId } from '../lib/utils';
import type { AppData, Space, FloatingBadge, AppSettings } from '../types';

/** Identifier passed to autoBackupData so the file is recognizable. */
export const SANDBOX_BACKUP_TAG = 'tutorial';

/**
 * Build the sandbox seed for a given tour. Returns a *complete* AppData
 * (all required fields) so storeSave can drop it in directly.
 *
 * Each seed must:
 *   - Carry over real settings/license (sandbox is gameplay, not config)
 *   - Use ids generated on every call (calling twice gives independent data)
 *   - Stay in active preset 1 — preset 2/3 are paywalled and we don't want
 *     the sandbox accidentally trip the paywall modal mid-tour.
 */
export function buildSandboxSeed(tourId: string, current: AppData): AppData {
  const settings = current.settings;
  const baseSeed = blankSeed(settings, current);
  switch (tourId) {
    case 'basics':    return basicsSeed(baseSeed);
    case 'floating':  return floatingSeed(baseSeed);
    // presets / slash tours don't yet have interactive seeds — they fall
    // back to the same blank-with-one-empty-space seed and walk the user
    // through the UI without expecting interactive completions.
    default:          return baseSeed;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function blankSeed(settings: AppSettings, current: AppData): AppData {
  const presetId = '1' as const;
  const spaces: Space[] = [];
  const floatingBadges: FloatingBadge[] = [];
  return {
    spaces,
    nodeGroups: [],
    decks: [],
    collapsedSpaceIds: [],
    floatingBadges,
    presets: [
      { id: '1', label: '튜토리얼',  spaces, nodeGroups: [], decks: [], floatingBadges },
      // Keep 2/3 as Pro-locked stubs — the same shape the migrator expects.
      { id: '2', label: '프리셋 2', spaces: [], nodeGroups: [], decks: [], floatingBadges: [] },
      { id: '3', label: '프리셋 3', spaces: [], nodeGroups: [], decks: [], floatingBadges: [] },
    ],
    activePresetId: presetId,
    settings,
    shortcut: current.shortcut,
    completedTours: current.completedTours,   // preserve completion bookkeeping
    // license / dismissals omitted — they are not preset-scoped and we'd
    // rather read them from the live snapshot than risk diverging copies.
  };
}

// ── basics: empty space, user adds their first card themselves ──────
function basicsSeed(seed: AppData): AppData {
  const spaceId = generateId();
  const space: Space = {
    id: spaceId,
    name: '내 첫 스페이스',
    items: [],            // empty on purpose — step 1 is "add a card"
    sortMode: 'custom',
    pinnedIds: [],
  };
  return mergeIntoActivePreset(seed, [space]);
}

// ── floating: pre-seeded space + one floating badge to play with ────
//
// Why these specific cards: the user mentioned URL + clipboard would be
// good. We use famous, instantly-recognizable services so a brand-new
// user doesn't need to read each title to know what they are. Clipboard
// clue lives in the empty 3rd row — it's a hint card the user can fill
// from their clipboard mid-tour.
function floatingSeed(seed: AppData): AppData {
  const spaceId = generateId();
  const items = [
    { id: generateId(), type: 'url' as const, title: 'Google',  value: 'https://google.com',  clickCount: 0, pinned: false },
    { id: generateId(), type: 'url' as const, title: 'GitHub',  value: 'https://github.com',  clickCount: 0, pinned: false },
    { id: generateId(), type: 'url' as const, title: 'YouTube', value: 'https://youtube.com', clickCount: 0, pinned: false },
  ];
  const space: Space = {
    id: spaceId,
    name: '북마크',
    items,
    sortMode: 'custom',
    pinnedIds: [],
  };
  // Pre-pinned floating badge anchored to a sane position. The exact
  // coords get clamped by main to fit the user's actual virtual desktop
  // when the overlay mounts, so a hardcoded value is fine here.
  const badge: FloatingBadge = {
    id: generateId(),
    refType: 'space',
    refId: spaceId,
    x: 200,
    y: 200,
  };
  return mergeIntoActivePreset(seed, [space], [badge]);
}

function mergeIntoActivePreset(
  seed: AppData,
  spaces: Space[],
  floatingBadges: FloatingBadge[] = [],
): AppData {
  return {
    ...seed,
    spaces,
    floatingBadges,
    presets: seed.presets.map(p =>
      p.id === seed.activePresetId
        ? { ...p, spaces, floatingBadges }
        : p,
    ),
  };
}

/**
 * Deep-clone an AppData snapshot. We keep this in memory while a tour is
 * running so we can restore on completion without re-reading from disk.
 * Plain JSON round-trip is enough — AppData carries no class instances or
 * functions. Doing this manually instead of relying on `structuredClone`
 * keeps it portable to older Electron renderers.
 */
export function snapshotData(data: AppData): AppData {
  return JSON.parse(JSON.stringify(data));
}

/**
 * Take the in-memory `original` and merge any new spaces the user created
 * during the tutorial. Used by the post-tour "이대로 가져갈래요?" path so
 * a curious user who actually built something useful in the sandbox
 * doesn't lose it.
 *
 * Conservative merge: we only KEEP spaces from sandbox that were not in
 * original (new ids). Settings, license, presets list itself, completed
 * tours — those all come from `original`. New floating badges are kept too.
 */
export function mergeSandboxBack(original: AppData, sandbox: AppData): AppData {
  const originalSpaceIds = new Set(original.spaces.map(s => s.id));
  const newSpaces        = sandbox.spaces.filter(s => !originalSpaceIds.has(s.id));
  if (newSpaces.length === 0) return original;       // user added nothing

  // Insert into the original's active preset.
  const activeId = original.activePresetId;
  const mergedSpaces = [...original.spaces, ...newSpaces];
  const originalBadgeIds = new Set((original.floatingBadges ?? []).map(b => b.id));
  const newBadges = (sandbox.floatingBadges ?? []).filter(b => !originalBadgeIds.has(b.id));
  const mergedBadges = [...(original.floatingBadges ?? []), ...newBadges];
  return {
    ...original,
    spaces: mergedSpaces,
    floatingBadges: mergedBadges,
    presets: original.presets.map(p =>
      p.id === activeId
        ? { ...p, spaces: mergedSpaces, floatingBadges: mergedBadges }
        : p,
    ),
  };
}
