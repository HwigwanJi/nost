/**
 * Snapshot push/pull — Phase 2 P2.A.
 *
 * MVP design (per `plans/sync-and-auth.md` §4.1):
 *   - Whole AppData (Cohort A subset only) is one jsonb row.
 *   - `generation` is a monotonically-incrementing LWW counter.
 *   - Push uses optimistic locking: UPDATE WHERE generation = lastSeen.
 *     If 0 rows affected, another device wrote in between — pull then retry.
 *   - Pull on conflict is server-wins at AppData level (per-field LWW
 *     lands in P2.C with entity-level lastModifiedAt).
 *
 * What goes in the snapshot:
 *   - All Cohort A items (url / memo / widget / text / browser)
 *   - Structural metadata (spaces, presets, nodeGroups, decks,
 *     floatingBadges, collapsedSpaceIds)
 *   - Settings minus device-only keys (DEVICE_ONLY_SETTING_KEYS)
 *
 * What we strip BEFORE push (Cohort C):
 *   - app / folder / doc / window / cmd cards — paths/exe are PC-local
 *
 * Memo bodies live in the snapshot for P2.A. P2.B will split them into
 * the dedicated `memos` table (better for large bodies + future
 * full-text search).
 */

import { supabase } from '../supabase';
import {
  DEVICE_ONLY_SETTING_KEYS,
  type DeviceOnlySettingKey,
} from '../cohort';
import type { AppData, LauncherItem, Space, Preset, NodeGroup, Deck, FloatingBadge } from '../../types';

export interface SnapshotState {
  /** Server's last-known generation. 0 means "no row on server yet". */
  generation: number;
  /** Server timestamp from the most recent pull/push. */
  updatedAt: string | null;
}

export interface PullResult {
  /** True if the server had a row at all. */
  found: boolean;
  /** The synced AppData payload (already filtered by cohort). null when found=false. */
  data: AppData | null;
  /** Server's current generation. */
  generation: number;
  /** Server timestamp. */
  updatedAt: string | null;
}

export interface PushResult {
  /** 'ok' = wrote, 'conflict' = lost the optimistic race (caller pulls + retries),
   *  'error' = network/RLS/etc, 'no-supabase' = client not configured. */
  status: 'ok' | 'conflict' | 'error' | 'no-supabase';
  generation: number;
  message?: string;
}

/** Merge a pulled server payload INTO the current local AppData.
 *
 *  Strategy: **local-first union**. Everything local stays as-is; only
 *  server entries with ids NOT present locally are added. Nothing local
 *  is overwritten, mutated, or deleted by the pull. This is the
 *  conservative model the user explicitly asked for — "local 에 동일
 *  항목 없을 때만 server 에서 가져온다".
 *
 *  Why local-first (not server-wins LWW):
 *    - P2.A has no per-entity `lastModifiedAt` yet. Server-wins would
 *      let stale server state overwrite fresh local edits made between
 *      pushes.
 *    - Server-side **deletions** therefore don't propagate to other
 *      devices in P2.A — that's the documented trade-off, fixed in P2.C
 *      when tombstones land. Until then, the worst case is a "ghost"
 *      card resurrecting on a second device; data is never lost.
 *    - Cohort C cards (folder / app / doc / window / cmd) survive
 *      because they live exclusively on local and server has no copy
 *      to compete with.
 *
 *  Settings, activePresetId, dismissals, completedTours: keep local
 *  entirely. Server values only fill keys that are absent locally
 *  (rare — defaults populate most). Device-only setting keys are never
 *  touched regardless.
 */
export function mergeServerIntoLocal(local: AppData, server: Partial<AppData>): AppData {
  const mergedSpaces = mergeSpaces(local.spaces, server.spaces ?? []);

  // Presets: keep local list intact; for each matching preset id splice
  // in any server-only items per space. Server-only presets are
  // appended at the end (they came from another device).
  const localPresetIds = new Set(local.presets.map(p => p.id));
  const serverPresets = server.presets ?? [];
  const mergedPresets: Preset[] = local.presets.map(p => {
    const sp = serverPresets.find(s => s.id === p.id);
    if (!sp) return p;
    return { ...p, spaces: mergeSpaces(p.spaces, sp.spaces) };
  });
  for (const sp of serverPresets) {
    if (!localPresetIds.has(sp.id)) mergedPresets.push(sp);
  }

  // Settings: local wins on every collision. Server only fills keys
  // that are literally absent locally (`undefined`). Device-only keys
  // are never touched regardless of which side defines them.
  const settings = { ...local.settings };
  if (server.settings) {
    for (const k of Object.keys(server.settings)) {
      if ((DEVICE_ONLY_SETTING_KEYS as readonly string[]).includes(k)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((settings as any)[k] === undefined) (settings as any)[k] = (server.settings as any)[k];
    }
  }

  return {
    ...local,
    spaces: mergedSpaces,
    presets: mergedPresets,
    nodeGroups: localFirstUnionById<NodeGroup>(local.nodeGroups ?? [], server.nodeGroups ?? []),
    decks: localFirstUnionById<Deck>(local.decks ?? [], server.decks ?? []),
    floatingBadges: localFirstUnionById<FloatingBadge>(local.floatingBadges ?? [], server.floatingBadges ?? []),
    // Local-only fields below — never touched by pull in P2.A.
    collapsedSpaceIds: local.collapsedSpaceIds,
    settings,
    activePresetId: local.activePresetId,
    dismissals: local.dismissals,
    completedTours: local.completedTours,
  };
}

/** Local-first union: keep local entries intact, append server entries
 *  whose ids don't already exist locally. Server cannot overwrite or
 *  reorder anything that was there. */
function localFirstUnionById<T extends { id: string }>(local: readonly T[], server: readonly T[]): T[] {
  const localIds = new Set(local.map(x => x.id));
  const out: T[] = [...local];
  for (const x of server) {
    if (!localIds.has(x.id)) out.push(x);
  }
  return out;
}

/** Merge spaces lists with local-first semantics:
 *    - Every local space is kept as-is (its items array is not touched
 *      except to **add** missing-from-local Cohort-A items the server has).
 *    - Server-only spaces (no local match) are appended.
 *  Item-level rule inside a matched space: union by id, local wins on
 *  collision (item exists on both sides — keep local). Server items
 *  whose ids don't appear locally get appended to the space. */
function mergeSpaces(localSpaces: readonly Space[], serverSpaces: readonly Space[]): Space[] {
  const merged: Space[] = [];
  const seenIds = new Set<string>();
  const serverById = new Map(serverSpaces.map(s => [s.id, s]));

  for (const local of localSpaces) {
    seenIds.add(local.id);
    const server = serverById.get(local.id);
    if (!server) {
      merged.push(local);
      continue;
    }
    const localItemIds = new Set((local.items as LauncherItem[]).map(it => it.id));
    const additions = (server.items as LauncherItem[]).filter(it => !localItemIds.has(it.id));
    merged.push({
      ...local,
      items: [...(local.items as LauncherItem[]), ...additions],
    });
  }
  for (const server of serverSpaces) {
    if (!seenIds.has(server.id)) merged.push(server);
  }
  return merged;
}

/** Build the payload that goes into `app_data_snapshots.data`.
 *
 *  User-explicit decision (2026-05-14): the snapshot carries **all card
 *  types** — including folder/app/doc/window/cmd. The previous Cohort C
 *  filter was removed because the sync model is now manual ("동기화하기"
 *  button does pull-merge-push, no background tick) and the user wants
 *  every card available across devices. Paths that don't resolve on the
 *  other PC become Cohort B "broken link" UX work in Phase 3.
 *
 *  We still strip **device-only settings** (shortcut, autoHide,
 *  monitorDirections, etc.) — those are PC-specific OS bindings that
 *  must not stomp on the other device's customisations. */
export function buildSyncPayload(local: AppData): Partial<AppData> {
  // Strip device-only settings; everything else passes through.
  const settings = { ...local.settings };
  for (const k of DEVICE_ONLY_SETTING_KEYS) {
    delete (settings as Record<DeviceOnlySettingKey, unknown>)[k];
  }

  return {
    spaces: local.spaces,
    presets: local.presets,
    nodeGroups: local.nodeGroups,
    decks: local.decks,
    floatingBadges: local.floatingBadges,
    collapsedSpaceIds: local.collapsedSpaceIds,
    settings,
    activePresetId: local.activePresetId,
    dismissals: local.dismissals,
    completedTours: local.completedTours,
  };
}

/** Read the user's snapshot row. Returns `{found: false}` if the row
 *  doesn't exist yet (first-time user — caller does the initial push). */
export async function pullSnapshot(userId: string): Promise<PullResult> {
  if (!supabase) {
    return { found: false, data: null, generation: 0, updatedAt: null };
  }
  const { data, error } = await supabase
    .from('app_data_snapshots')
    .select('data, generation, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[sync/snapshot] pull failed:', error.message);
    return { found: false, data: null, generation: 0, updatedAt: null };
  }
  if (!data) {
    return { found: false, data: null, generation: 0, updatedAt: null };
  }
  return {
    found: true,
    data: data.data as AppData,
    generation: Number(data.generation ?? 1),
    updatedAt: data.updated_at,
  };
}

/** Initial push for a user whose server row doesn't exist yet.
 *  Idempotent w.r.t. retries — if the row already exists this returns
 *  conflict (caller falls back to pullSnapshot + a regular push). */
export async function insertInitialSnapshot(
  userId: string,
  local: AppData,
  deviceRowId: string | null,
): Promise<PushResult> {
  if (!supabase) return { status: 'no-supabase', generation: 0 };
  const payload = buildSyncPayload(local);
  const { data, error } = await supabase
    .from('app_data_snapshots')
    .insert({
      user_id: userId,
      data: payload,
      generation: 1,
      updated_by_device: deviceRowId,
    })
    .select('generation')
    .single();
  if (error) {
    // Likely a primary-key conflict — another device or earlier session
    // already inserted. Caller should pull + push instead.
    if (error.code === '23505') return { status: 'conflict', generation: 0, message: error.message };
    return { status: 'error', generation: 0, message: error.message };
  }
  return { status: 'ok', generation: Number(data?.generation ?? 1) };
}

/** Optimistic-locked UPDATE. `expectedGeneration` is the last gen the
 *  client knows; if the server's has moved ahead, 0 rows match and we
 *  return 'conflict' so the caller pulls + retries. */
export async function pushSnapshot(
  userId: string,
  local: AppData,
  expectedGeneration: number,
  deviceRowId: string | null,
): Promise<PushResult> {
  if (!supabase) return { status: 'no-supabase', generation: expectedGeneration };
  const payload = buildSyncPayload(local);
  const nextGeneration = expectedGeneration + 1;
  const { data, error } = await supabase
    .from('app_data_snapshots')
    .update({
      data: payload,
      generation: nextGeneration,
      updated_at: new Date().toISOString(),
      updated_by_device: deviceRowId,
    })
    .eq('user_id', userId)
    .eq('generation', expectedGeneration)
    .select('generation');

  if (error) return { status: 'error', generation: expectedGeneration, message: error.message };
  if (!data || data.length === 0) {
    // 0 rows matched → either row was deleted or generation moved on.
    return { status: 'conflict', generation: expectedGeneration };
  }
  return { status: 'ok', generation: Number(data[0].generation) };
}
