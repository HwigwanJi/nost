/**
 * Device registration — Phase 2 P2.A.
 *
 * Identifies which PC produced each snapshot edit. On signed-in boot
 * we UPSERT a row in `public.devices` keyed by deviceId (uuid persisted
 * in electron-store). Touches `last_seen_at` so the AccountTab device
 * list (P2.D) can sort by recent activity.
 *
 * Phase 2.A does NOT enforce device quotas — Free 1-device limit lands
 * in P2.D once we have the UI to show the user "you've hit the limit,
 * which device do you want to drop?".
 */

import { supabase } from '../supabase';
import { electronAPI } from '../../electronBridge';

export interface DeviceIdentity {
  /** Stable UUID from electron-store (`deviceId` key). */
  deviceId: string;
  /** OS hostname — user-readable in AccountTab device list. */
  hostname: string;
  /** 'win32' | 'darwin' | 'linux'. */
  platform: string;
}

/** A device row as the AccountTab list renders it. The `deviceTag`
 *  field is the electron-store UUID we suffix to `name` — we expose
 *  it so the UI can compare against the current device and mark it
 *  with a "이 PC" badge. */
export interface DeviceRow {
  id: string;
  name: string;
  hostname: string | null;
  platform: string | null;
  lastSeenAt: string;
  createdAt: string;
  /** The electron-store UUID parsed out of `name`'s `[uuid]` suffix
   *  (or null if the suffix is missing — rows created by some future
   *  schema migration without a tag). */
  deviceTag: string | null;
}

let cached: DeviceIdentity | null = null;

/** Read (and cache) the device identity from main. Safe to call repeatedly. */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  if (cached) return cached;
  cached = await electronAPI.deviceGetInfo();
  return cached;
}

/** UPSERT this device's row, refreshing last_seen_at. Returns the row's
 *  `id` (uuid) so subsequent snapshot writes can stamp updated_by_device.
 *
 *  We key the upsert on (user_id, deviceId) — the `devices` table's
 *  primary key is its own uuid, but we use the electron-store deviceId
 *  as a natural key to keep one row per (user, PC). For Phase 2.A we
 *  store the deviceId in the row's `name` column suffix so the upsert
 *  conflict resolution works without changing the schema. Later P2.D
 *  will add a dedicated `device_uuid` column with a UNIQUE index. */
export async function registerOrTouchDevice(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const identity = await getDeviceIdentity();

  // Look for an existing row matching this (user_id, deviceId). We tag
  // the row's `name` with the deviceId as a discoverable suffix so the
  // current schema (no dedicated device_uuid column) still lets us find
  // it without a migration.
  const tag = `[${identity.deviceId}]`;

  const { data: existing, error: selectError } = await supabase
    .from('devices')
    .select('id, name')
    .eq('user_id', userId)
    .like('name', `%${tag}`)
    .limit(1);

  if (selectError) {
    console.warn('[sync/device] lookup failed:', selectError.message);
    return null;
  }

  const displayName = `${identity.hostname} ${tag}`;

  if (existing && existing.length > 0) {
    const row = existing[0];
    const { error } = await supabase
      .from('devices')
      .update({ last_seen_at: new Date().toISOString(), name: displayName })
      .eq('id', row.id);
    if (error) {
      console.warn('[sync/device] touch failed:', error.message);
      return null;
    }
    return row.id;
  }

  const { data: inserted, error } = await supabase
    .from('devices')
    .insert({
      user_id: userId,
      name: displayName,
      hostname: identity.hostname,
      platform: identity.platform,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[sync/device] insert failed:', error.message);
    return null;
  }
  return inserted?.id ?? null;
}

/** List all devices for the current user, most-recent-first. The
 *  caller uses this to render the AccountTab device list. */
export async function listDevices(userId: string): Promise<DeviceRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('devices')
    .select('id, name, hostname, platform, last_seen_at, created_at')
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false });
  if (error) {
    console.warn('[sync/device] list failed:', error.message);
    return [];
  }
  return (data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    platform: row.platform,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    deviceTag: extractTag(row.name),
  }));
}

/** Delete a device row by its primary-key id. The user does this to
 *  "이 PC 에서 해제" from the AccountTab list. We do NOT cascade to the
 *  app_data_snapshots row (the user's data stays put — only this PC's
 *  device record is removed). If the user later signs in on the same
 *  PC again, registerOrTouchDevice will recreate the row. */
export async function deleteDevice(deviceRowId: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: 'supabase 미설정' };
  const { error } = await supabase
    .from('devices')
    .delete()
    .eq('id', deviceRowId);
  if (error) {
    console.warn('[sync/device] delete failed:', error.message);
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

/** Parse the `[uuid]` suffix the registerOrTouchDevice writes into the
 *  `name` column so we can identify "the device I'm running on right now". */
function extractTag(name: string | null): string | null {
  if (!name) return null;
  const m = name.match(/\[([0-9a-fA-F-]{8,})\]\s*$/);
  return m ? m[1] : null;
}
