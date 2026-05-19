/**
 * Cohort SSOT — which card types are sync-eligible.
 *
 * Phase 2 (sync) reads this to decide what to push to / pull from
 * Supabase. Adding a new LauncherItem.type means adding a line here
 * AND to `plans/sync-and-auth.md` §15 (where the decision lives).
 *
 * See `plans/sync-and-auth.md` §15 for the human-readable rationale.
 */

import type { LauncherItem } from '../types';

/** Per spec — `plans/sync-and-auth.md` §15. */
export type Cohort =
  | 'A'  // sync — content makes sense on any PC (url / memo / widget / text / browser)
  | 'C'  // PC-local — path/binary depends on this machine (app / folder / doc / window / cmd)
  | 'D'  // device settings — never synced (shortcut, autoHide, monitorDirections…) — not a card type
  ;

const SYNC_TYPES: ReadonlySet<LauncherItem['type']> = new Set([
  'url',
  'memo',
  'widget',
  'text',
  'browser',
]);

const LOCAL_TYPES: ReadonlySet<LauncherItem['type']> = new Set([
  'app',
  'folder',
  'doc',
  'window',
  'cmd',
  // v1.3.46: image cards store the binary in userData/images/{uuid}.png
  // — a path that's meaningless on another PC. Phase C may introduce
  // a per-card "promote to cloud" option that uploads the bytes to
  // Supabase Storage and re-tags the card as cohort A; until then,
  // image cards stay device-local with the "🖥️ 이 PC만" badge.
  'image',
]);

/** Which cohort a given card-type belongs to. */
export function cohortOfType(type: LauncherItem['type']): 'A' | 'C' {
  return SYNC_TYPES.has(type) ? 'A' : 'C';
}

/** Convenience: should this item's content be pushed to the server? */
export function isSyncable(item: Pick<LauncherItem, 'type'>): boolean {
  return SYNC_TYPES.has(item.type);
}

/** Convenience: should this item stay on this PC only? */
export function isLocalOnly(item: Pick<LauncherItem, 'type'>): boolean {
  return LOCAL_TYPES.has(item.type);
}

/** Partition an items array into (sync, local) buckets. Used by the
 *  initial push to drop local-only cards before serialising. */
export function partitionByCohort<T extends Pick<LauncherItem, 'type'>>(
  items: readonly T[]
): { sync: T[]; local: T[] } {
  const sync: T[] = [];
  const local: T[] = [];
  for (const it of items) {
    (SYNC_TYPES.has(it.type) ? sync : local).push(it);
  }
  return { sync, local };
}

/** Settings keys that are NEVER synced (Cohort D). The complement —
 *  settings that DO sync by default (theme/accent/etc) — lives in
 *  `plans/sync-and-auth.md` §15 and the sync push code will whitelist
 *  by exclusion of this set. */
export const DEVICE_ONLY_SETTING_KEYS = [
  'shortcut',
  'autoLaunch',
  'autoHide',
  'windowSizePct',
  'windowOpenAt',
  'floatingButton',
  'monitorDirections',
  'badgeSize',
] as const;

export type DeviceOnlySettingKey = typeof DEVICE_ONLY_SETTING_KEYS[number];
