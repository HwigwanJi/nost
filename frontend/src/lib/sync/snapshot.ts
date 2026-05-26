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
 *  Strategy (Phase 2.C): **LWW per-entity + tombstone-aware union**.
 *    - For each entity present on both sides (same id), pick whichever
 *      has the higher `lastModifiedAt`. Ties go to local (since the
 *      sync was user-initiated locally — "I just pushed").
 *    - For server-only entities: include them UNLESS a local tombstone
 *      says we deleted that id (preventing resurrection of deleted
 *      cards / spaces / nodes).
 *    - For local-only entities: keep them UNLESS a server tombstone
 *      says another device deleted that id (propagating the delete).
 *    - Tombstone maps from both sides are unioned (max ts on collision)
 *      and carried forward — so a third device that hasn't seen the
 *      delete still learns of it on its next pull.
 *
 *  Settings: local-first as before. Device-only keys never touched.
 *  Dismissals / completedTours / activePresetId / collapsedSpaceIds:
 *  local-only fields, not synced.
 */
export function mergeServerIntoLocal(local: AppData, server: Partial<AppData>): AppData {
  // ── Tombstones: union by max(ts) ───────────────────────────────────
  const mergedTombstones = mergeTombstones(local.tombstones, server.tombstones);

  // ── Spaces (active preset, flat mirror) ────────────────────────────
  const mergedSpaces = mergeSpacesLWW(local.spaces, server.spaces ?? [], mergedTombstones);

  // ── Presets (per-preset same logic) ────────────────────────────────
  const localPresetMap = new Map<string, Preset>(local.presets.map(p => [p.id, p]));
  const serverPresets = server.presets ?? [];
  const mergedPresets: Preset[] = local.presets.map(p => {
    const sp = serverPresets.find(x => x.id === p.id);
    if (!sp) return p;
    // Preset-level fields (label etc.) LWW; per-space items merged via
    // mergeSpacesLWW so item-level tombstone rules still apply.
    const winner = (sp.lastModifiedAt ?? 0) > (p.lastModifiedAt ?? 0) ? sp : p;
    return {
      ...winner,
      spaces: mergeSpacesLWW(p.spaces, sp.spaces, mergedTombstones),
      nodeGroups: mergeListLWW<NodeGroup>(p.nodeGroups ?? [], sp.nodeGroups ?? [], mergedTombstones.nodeGroups),
      decks: mergeListLWW<Deck>(p.decks ?? [], sp.decks ?? [], mergedTombstones.decks),
      floatingBadges: mergeListLWW<FloatingBadge>(p.floatingBadges ?? [], sp.floatingBadges ?? [], mergedTombstones.floatingBadges),
    };
  });
  // Server-only presets: add if not tombstoned
  for (const sp of serverPresets) {
    if (localPresetMap.has(sp.id)) continue;
    if (mergedTombstones.presets?.[sp.id]) continue;
    mergedPresets.push(sp);
  }

  // ── Settings: local-first (no LWW per-key in P2.C — settings rarely
  //     change and per-field timestamps would be heavy). Server fills
  //     undefined-locally keys; device-only keys never touched. ─────
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
    nodeGroups:     mergeListLWW<NodeGroup>(local.nodeGroups ?? [], server.nodeGroups ?? [], mergedTombstones.nodeGroups),
    decks:          mergeListLWW<Deck>(local.decks ?? [], server.decks ?? [], mergedTombstones.decks),
    floatingBadges: mergeListLWW<FloatingBadge>(local.floatingBadges ?? [], server.floatingBadges ?? [], mergedTombstones.floatingBadges),
    collapsedSpaceIds: local.collapsedSpaceIds,
    settings,
    activePresetId: local.activePresetId,
    dismissals: local.dismissals,
    completedTours: local.completedTours,
    tombstones: mergedTombstones,
  };
}

/** Union two tombstone maps. On id collision, keep max(ts) — the
 *  later-deleted timestamp wins so a re-delete after a resurrection
 *  attempt is still recognised. */
type TombstoneMap = NonNullable<AppData['tombstones']>;
function mergeTombstones(local: TombstoneMap | undefined, server: TombstoneMap | undefined): TombstoneMap {
  const kinds = ['items', 'spaces', 'presets', 'nodeGroups', 'decks', 'floatingBadges'] as const;
  const out: TombstoneMap = {};
  for (const k of kinds) {
    const ml = local?.[k] ?? {};
    const ms = server?.[k] ?? {};
    if (Object.keys(ml).length === 0 && Object.keys(ms).length === 0) continue;
    const merged: Record<string, number> = { ...ml };
    for (const [id, ts] of Object.entries(ms)) {
      merged[id] = merged[id] !== undefined ? Math.max(merged[id], ts) : ts;
    }
    out[k] = merged;
  }
  return out;
}

/** LWW merge for any entity list keyed by `id`. Drops entries whose id
 *  is in the supplied tombstone map. Used for nodeGroups / decks /
 *  floatingBadges (flat lists with optional lastModifiedAt). */
function mergeListLWW<T extends { id: string; lastModifiedAt?: number }>(
  localList: readonly T[],
  serverList: readonly T[],
  tombstones: Record<string, number> | undefined,
): T[] {
  const t = tombstones ?? {};
  const byId = new Map<string, T>();
  for (const x of localList) {
    if (t[x.id]) continue;
    byId.set(x.id, x);
  }
  for (const x of serverList) {
    if (t[x.id]) continue;
    const existing = byId.get(x.id);
    if (!existing) {
      byId.set(x.id, x);
      continue;
    }
    const lv = existing.lastModifiedAt ?? 0;
    const sv = x.lastModifiedAt ?? 0;
    byId.set(x.id, sv > lv ? x : existing);
  }
  return Array.from(byId.values());
}

/** LWW merge for spaces — nested because each space carries an `items`
 *  list that needs its own per-item merge.
 *
 *  v1.3.48 Phase 2.D: 위치/내용 분리.
 *    - space.lastModifiedAt 가 더 최신인 쪽 = "ORDER 의 winner". 그쪽 space
 *      의 items[] 배열 순서를 primary 로 채택.
 *    - 각 item 의 CONTENT 는 별도로 LWW (item.lastModifiedAt 기준) — 다른
 *      쪽이 더 최근 컨텐츠 편집이 있으면 그게 이김.
 *    - 즉 "한쪽이 reorder + 다른 쪽이 본문 편집" 케이스에 양쪽이 다 살아남음.
 */
function mergeSpacesLWW(
  localSpaces: readonly Space[],
  serverSpaces: readonly Space[],
  tombstones: TombstoneMap,
): Space[] {
  const spaceT = tombstones.spaces ?? {};
  const itemT  = tombstones.items ?? {};
  const byId = new Map<string, Space>();

  for (const ls of localSpaces) {
    if (spaceT[ls.id]) continue;
    byId.set(ls.id, ls);
  }
  for (const ss of serverSpaces) {
    if (spaceT[ss.id]) continue;
    const existing = byId.get(ss.id);
    if (!existing) {
      // Server-only space — merge items too (apply item tombstones).
      byId.set(ss.id, {
        ...ss,
        items: filterByTombstone(ss.items as LauncherItem[], itemT),
      });
      continue;
    }
    // Both sides — LWW for space metadata, items merged with primary
    // = winner's order so reorder/move propagates correctly.
    const localNewer = (existing.lastModifiedAt ?? 0) >= (ss.lastModifiedAt ?? 0);
    const winnerMeta = localNewer ? existing : ss;
    const primary    = localNewer ? existing.items : ss.items;
    const secondary  = localNewer ? ss.items       : existing.items;
    byId.set(ss.id, {
      ...winnerMeta,
      items: mergeItemsLWW(primary, secondary, itemT),
    });
  }
  return Array.from(byId.values());
}

/** Merge two item arrays. The PRIMARY array drives the resulting order;
 *  for each id present on both sides, content is LWW per-item; items
 *  only-in-secondary are appended at the end (they're new from the
 *  other device that hadn't been synced yet). Tombstoned ids skipped. */
function mergeItemsLWW(
  primary: readonly LauncherItem[],
  secondary: readonly LauncherItem[],
  itemTombstones: Record<string, number>,
): LauncherItem[] {
  const secondaryById = new Map(secondary.map(i => [i.id, i]));
  const out: LauncherItem[] = [];
  const consumed = new Set<string>();
  for (const p of primary) {
    if (itemTombstones[p.id]) continue;
    consumed.add(p.id);
    const s = secondaryById.get(p.id);
    if (!s) { out.push(p); continue; }
    const winner = (s.lastModifiedAt ?? 0) > (p.lastModifiedAt ?? 0) ? s : p;
    out.push(winner);
  }
  for (const s of secondary) {
    if (consumed.has(s.id) || itemTombstones[s.id]) continue;
    out.push(s);
  }
  return out;
}

function filterByTombstone<T extends { id: string }>(arr: readonly T[], tomb: Record<string, number>): T[] {
  if (Object.keys(tomb).length === 0) return [...arr];
  return arr.filter(x => !tomb[x.id]);
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
    // v1.3.48 Phase 2.C: tombstones travel with the payload so other
    // devices learn of deletes on pull (otherwise they'd resurrect the
    // entity from their stale server snapshot).
    tombstones: local.tombstones,
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
