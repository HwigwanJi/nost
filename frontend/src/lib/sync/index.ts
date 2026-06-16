/**
 * Sync orchestrator — Phase 2 P2.A.
 *
 * **Manual-only model** (user-explicit, 2026-05-14): nothing happens in
 * the background. The orchestrator just wires up callbacks at signed-in
 * time; the user clicks "동기화하기" in the AccountTab to do the
 * pull-merge-push round-trip, and "현재 기기 추가" to register this PC
 * in the `devices` table.
 *
 * Why no auto-push:
 *   - User explicitly asked for it ("백그라운드 리소스가 계속 커지는
 *     방향은 부담스러워"). No debounced push on save, no realtime
 *     subscription, no periodic poll.
 *   - Simpler conflict story — generation only changes when the user
 *     deliberately syncs.
 *
 * The sync round-trip:
 *   1. pull server snapshot
 *   2. local-first merge (preserves everything local, adds server-only
 *      items the user doesn't have yet — see snapshot.ts:mergeServerIntoLocal)
 *   3. apply merged data locally (so the user sees "got X new cards")
 *   4. push the merged result back so server reflects the union
 *
 * State exposure: `useSyncState()` is a tiny external store the
 * AccountTab subscribes to for live status (idle / syncing / error +
 * lastSyncedAt + generation).
 */

import { useSyncExternalStore } from 'react';
import type { AppData } from '../../types';
import {
  registerOrTouchDevice,
} from './device';
import {
  insertInitialSnapshot,
  pullSnapshot,
  pushSnapshot,
  mergeServerIntoLocal,
} from './snapshot';

export type SyncPhase = 'idle' | 'ready' | 'syncing' | 'error';

export interface SyncState {
  phase: SyncPhase;
  /** Last successfully-known server generation. */
  generation: number;
  /** When the last successful sync completed (epoch ms). */
  lastSyncedAt: number | null;
  errorMessage: string | null;
  /** This device's row id in `public.devices` — null until the user
   *  clicks "현재 기기 추가" (or "동기화하기" which auto-registers). */
  deviceRowId: string | null;
}

const INITIAL: SyncState = {
  phase: 'idle',
  generation: 0,
  lastSyncedAt: null,
  errorMessage: null,
  deviceRowId: null,
};

let state: SyncState = INITIAL;
const listeners = new Set<() => void>();

function setState(updater: (prev: SyncState) => SyncState) {
  const next = updater(state);
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
  );
}

/** Read-only snapshot for non-React callers. */
export function getSyncState(): SyncState { return state; }

// ── Internals ────────────────────────────────────────────────────

let currentUserId: string | null = null;
/** App.tsx supplies these on signed-in transition. The orchestrator
 *  never reads `data` itself — it just hands the latest snapshot back
 *  to whoever wants to push or pull. Manual model means the user-click
 *  drives every operation; no closures of stale data. */
let getCurrentLocal: (() => AppData) | null = null;
let applyMergedData: ((data: AppData) => void) | null = null;

/** Called from App on signed-in transition. The two callbacks are the
 *  *only* points where the orchestrator touches AppData: getCurrentLocal
 *  reads what's in memory right now (called every sync click), and
 *  applyMergedData replaces local state with the freshly-merged result
 *  (called after a successful pull). No background work runs as a
 *  consequence of init — the user has to click a button. */
export function initSync(opts: {
  userId: string;
  getLocal: () => AppData;
  applyMerged: (data: AppData) => void;
}): void {
  currentUserId = opts.userId;
  getCurrentLocal = opts.getLocal;
  applyMergedData = opts.applyMerged;
  setState(prev => ({ ...prev, phase: 'ready', errorMessage: null }));
}

/** Manual button: "현재 기기 추가". UPSERTs a row in `public.devices`
 *  for this PC and stores the row id so subsequent pushes can stamp
 *  `updated_by_device`. Safe to call repeatedly — touches last_seen_at
 *  on an existing row. */
export async function registerThisDevice(): Promise<{ ok: boolean; message?: string }> {
  if (!currentUserId) return { ok: false, message: '로그인 필요' };
  const id = await registerOrTouchDevice(currentUserId);
  if (!id) return { ok: false, message: '디바이스 등록 실패' };
  setState(prev => ({ ...prev, deviceRowId: id }));
  return { ok: true };
}

/** Sync direction (v1.3.49 사용자 요청 — 단방향 선택).
 *  - 'both' : 양방향. server 변경을 local 에 적용 + local 을 server 에 push (기본)
 *  - 'push' : 이 PC → 클라우드. server 에만 쓰고 local 은 안 건드림.
 *  - 'pull' : 클라우드 → 이 PC. local 에만 적용하고 server 는 안 건드림.
 *  머지는 항상 비파괴 union (mergeServerIntoLocal) — 방향은 "어느 쪽에
 *  쓸지" 게이트만 한다. 그래서 push-only 가 server-only 카드를 지우거나
 *  pull-only 가 local-only 카드를 지우지 않음. */
export type SyncDirection = 'both' | 'push' | 'pull';

/** Manual button: "동기화하기". One round-trip:
 *    pull → merge (local-first union) → (apply?) → (push?).
 *  Lazy-registers this device if the user hasn't clicked "현재 기기 추가"
 *  yet, so a fresh login can sync without two-step UX. */
export async function syncFull(direction: SyncDirection = 'both'): Promise<{ ok: boolean; message?: string }> {
  if (!currentUserId || !getCurrentLocal || !applyMergedData) {
    return { ok: false, message: '로그인 필요' };
  }
  const doApply = direction === 'both' || direction === 'pull';  // local 에 쓸지
  const doPush  = direction === 'both' || direction === 'push';  // server 에 쓸지
  setState(prev => ({ ...prev, phase: 'syncing', errorMessage: null }));

  try {
    // Lazy device registration — first sync click acts as a "register
    // this PC + push" combo. Users who clicked "현재 기기 추가"
    // beforehand just no-op through this (touch updates last_seen_at).
    let deviceId = state.deviceRowId;
    if (!deviceId) {
      deviceId = await registerOrTouchDevice(currentUserId);
      if (deviceId) setState(prev => ({ ...prev, deviceRowId: deviceId }));
    }

    // Step 1: pull
    const pulled = await pullSnapshot(currentUserId);

    // Step 2 + 3: merge + (apply if direction allows local writes).
    let merged: AppData = getCurrentLocal();
    let expectedGen = 0;
    if (pulled.found && pulled.data) {
      merged = mergeServerIntoLocal(merged, pulled.data);
      expectedGen = pulled.generation;
      if (doApply) applyMergedData(merged);
    }

    // v1.3.49 — pull-only: server 는 안 건드림. local 적용까지만 하고 종료.
    if (!doPush) {
      setState(prev => ({
        ...prev,
        phase: 'ready',
        // generation 은 server 가 안 바뀌었으니 pulled 기준 유지.
        generation: pulled.found ? pulled.generation : prev.generation,
        lastSyncedAt: Date.now(),
      }));
      return { ok: true };
    }

    // Step 4: push the merged result. If there's no server row, insert;
    // otherwise optimistic-locked update.
    if (!pulled.found) {
      const r = await insertInitialSnapshot(currentUserId, merged, deviceId);
      if (r.status !== 'ok') {
        setState(prev => ({ ...prev, phase: 'error', errorMessage: r.message ?? '저장 실패' }));
        return { ok: false, message: r.message };
      }
      setState(prev => ({
        ...prev,
        phase: 'ready',
        generation: r.generation,
        lastSyncedAt: Date.now(),
      }));
      return { ok: true };
    }

    let pushed = await pushSnapshot(currentUserId, merged, expectedGen, deviceId);

    // v1.3.48 Phase 2.C: one automatic retry on optimistic-lock conflict.
    // Another device pushed between our pull and our push — re-pull, re-
    // merge, push again. LWW + tombstone merge means the second attempt
    // either succeeds cleanly or surfaces a genuine race we can't auto-
    // resolve (very rare, then we surface to the user).
    if (pushed.status === 'conflict') {
      const repulled = await pullSnapshot(currentUserId);
      if (repulled.found && repulled.data) {
        merged = mergeServerIntoLocal(getCurrentLocal(), repulled.data);
        if (doApply) applyMergedData(merged);  // push-only 면 local 안 건드림
        pushed = await pushSnapshot(currentUserId, merged, repulled.generation, deviceId);
      }
    }

    if (pushed.status === 'ok') {
      setState(prev => ({
        ...prev,
        phase: 'ready',
        generation: pushed.generation,
        lastSyncedAt: Date.now(),
      }));
      return { ok: true };
    }
    if (pushed.status === 'conflict') {
      // Second consecutive conflict — surface to user. Highly unusual:
      // three devices pushing in the same second. Retry-button UX.
      setState(prev => ({
        ...prev,
        phase: 'error',
        errorMessage: '다른 기기에서 동시에 동기화됐어요. 다시 눌러주세요.',
      }));
      return { ok: false, message: 'conflict' };
    }
    setState(prev => ({ ...prev, phase: 'error', errorMessage: pushed.message ?? '저장 실패' }));
    return { ok: false, message: pushed.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setState(prev => ({ ...prev, phase: 'error', errorMessage: msg }));
    return { ok: false, message: msg };
  }
}

/** Called on sign-out. */
export function disposeSync(): void {
  currentUserId = null;
  getCurrentLocal = null;
  applyMergedData = null;
  state = INITIAL;
  for (const l of listeners) l();
}
