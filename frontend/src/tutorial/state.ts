/**
 * Tutorial state store — localStorage-backed React hook.
 *
 * Why localStorage and not electron-store: TutorialState is small
 * (a few KB at most), single-window (no multi-window sync needed),
 * and lives entirely in the renderer. Avoiding the IPC roundtrip
 * keeps reads cheap and component code synchronous. We can promote
 * to electron-store later via a single migration pass if cross-
 * window sync becomes needed.
 *
 * Subscribers use `useSyncExternalStore` so multiple components
 * (AccordionPanel, NudgeToast machinery, QuestRunner, the settings
 * "rewardDays" indicator) all see the same value and re-render
 * together on update — no Provider component required.
 */

import { useSyncExternalStore } from 'react';
import { EMPTY_STATE, type TutorialState, type QuestId, type ActiveQuest } from './types';

const LS_KEY = 'nost.tutorial.v2';

// ── Read / write LS ──────────────────────────────────────────────

function readStorage(): TutorialState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<TutorialState>;
    // Spread over EMPTY_STATE so a forward-compatible field added
    // later doesn't crash an older client. Same pattern as useAppData.
    return { ...EMPTY_STATE, ...parsed };
  } catch {
    return EMPTY_STATE;
  }
}

function writeStorage(s: TutorialState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* quota / disabled */ }
}

// ── External-store plumbing for useSyncExternalStore ─────────────

let snapshot: TutorialState = readStorage();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): TutorialState {
  return snapshot;
}

function emit() {
  for (const l of listeners) l();
}

/** Replace the entire state. Always commits to LS + notifies subscribers. */
function setState(updater: (prev: TutorialState) => TutorialState) {
  const next = updater(snapshot);
  if (next === snapshot) return;
  snapshot = next;
  writeStorage(next);
  emit();
}

// Cross-tab / cross-window: react to LS changes from another renderer
// (won't happen for nost today since one renderer, but cheap insurance).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== LS_KEY) return;
    snapshot = readStorage();
    emit();
  });
}

// ── Public hook + actions ────────────────────────────────────────

export function useTutorialState(): TutorialState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Read once without subscribing — for nudge fire-and-forget paths. */
export function readTutorialState(): TutorialState {
  return snapshot;
}

export const tutorialActions = {
  /** Mark a quest completed. No-op if already completed. Adds the
   *  quest's reward to `rewardDays`. Caller passes rewardDays
   *  explicitly so reward.ts can compute bonuses (category +
   *  master) elsewhere — this fn just persists. */
  markCompleted(questId: QuestId, durationMs: number, rewardDays: number) {
    setState(prev => {
      if (prev.completed[questId]) return prev;
      return {
        ...prev,
        completed: {
          ...prev.completed,
          [questId]: { atIso: new Date().toISOString(), durationMs },
        },
        rewardDays: prev.rewardDays + rewardDays,
        // Clearing active here is the runner's job, not ours, but we
        // do it defensively in case markCompleted is called out of
        // band (e.g. dev tools). The runner usually calls finishActive
        // first which is a no-op when called twice.
        active: prev.active?.questId === questId ? null : prev.active,
      };
    });
  },

  /** Add a one-off bonus (category complete / master) — bumps rewardDays. */
  addBonusDays(days: number) {
    if (days <= 0) return;
    setState(prev => ({ ...prev, rewardDays: prev.rewardDays + days }));
  },

  /** Open a fresh active quest. Replaces any existing active. */
  startQuest(questId: QuestId, provisionResult: { addedItemIds?: string[]; addedSpaceIds?: string[]; addedMemoIds?: string[] }) {
    const active: ActiveQuest = {
      questId,
      stepIdx: 0,
      startedAtIso: new Date().toISOString(),
      addedItemIds: provisionResult.addedItemIds ?? [],
      addedSpaceIds: provisionResult.addedSpaceIds ?? [],
      addedMemoIds: provisionResult.addedMemoIds ?? [],
    };
    setState(prev => ({ ...prev, active }));
  },

  /** Advance the active quest one step. Caller is responsible for
   *  bounds-checking (last step → call markCompleted instead). */
  advanceStep() {
    setState(prev => prev.active
      ? { ...prev, active: { ...prev.active, stepIdx: prev.active.stepIdx + 1 } }
      : prev);
  },

  /** Record a runtime addition during the active quest so the
   *  CompletionModal can list it (and offer cleanup). Idempotent
   *  per-id so the same id added twice doesn't pollute the list. */
  recordAddedItem(kind: 'item' | 'space' | 'memo', id: string) {
    setState(prev => {
      if (!prev.active) return prev;
      const key =
        kind === 'item'  ? 'addedItemIds' :
        kind === 'space' ? 'addedSpaceIds' :
                           'addedMemoIds';
      const arr = prev.active[key];
      if (arr.includes(id)) return prev;
      return {
        ...prev,
        active: { ...prev.active, [key]: [...arr, id] },
      };
    });
  },

  /** Pause active without losing progress. The next session shows
   *  the "이어서 하기" toast (§ 11.2). Use clearActive for a
   *  user-initiated abandon. */
  pauseActive() {
    // No-op storage-wise — `active` already persists. Provided as
    // an intent marker so call sites read clearly.
  },

  /** Drop the active quest entirely. CompletionModal calls this
   *  after the user picks keep/discard. */
  clearActive() {
    setState(prev => ({ ...prev, active: null }));
  },

  /** Mark a nudge dismissed for `cooldownMin` minutes. */
  dismissNudge(questId: QuestId, cooldownMin: number) {
    const cooldownUntil = new Date(Date.now() + cooldownMin * 60_000).toISOString();
    setState(prev => ({
      ...prev,
      dismissedNudges: { ...prev.dismissedNudges, [questId]: { cooldownUntilIso: cooldownUntil } },
    }));
  },

  markFinalNudgeShown() {
    setState(prev => ({ ...prev, finalNudgeShown: true }));
  },

  /** Stamp today's local YYYY-MM-DD as the day we last fired the
   *  daily incomplete-quest nudge. Caller compares against today
   *  before firing to enforce the once-per-day cap. */
  markDailyNudgeShown(ymd: string) {
    setState(prev => prev.lastDailyNudgeYmd === ymd ? prev : { ...prev, lastDailyNudgeYmd: ymd });
  },

  /** Test/dev only — wipe everything. Don't expose in UI. */
  __reset() {
    setState(() => EMPTY_STATE);
  },
};

/** True when the dismissNudge cooldown has expired (or no record). */
export function isNudgeAllowed(state: TutorialState, questId: QuestId): boolean {
  const rec = state.dismissedNudges[questId];
  if (!rec) return true;
  return new Date(rec.cooldownUntilIso).getTime() <= Date.now();
}
