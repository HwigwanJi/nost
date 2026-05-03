/**
 * Provisioner — runs a quest's `provision()` to add any missing
 * prerequisite resources, and reverses those additions when the
 * user picks "정리하기" at completion.
 *
 * Stateless: every entry point takes the live AppData / store
 * handle as args. The active quest's added*Ids list (which
 * cleanup reads from) lives in TutorialState (state.ts) — we
 * just produce IDs to record there.
 */

import type { AppData } from '../types';
import type { Quest, ProvisionResult } from './types';

/** Run the quest's provision step and normalise its return so
 *  downstream callers can rely on every array existing (even
 *  empty). The catch keeps quest authors from accidentally
 *  blocking the runner with an unhandled rejection. */
export async function runProvisioning(quest: Quest, data: AppData): Promise<ProvisionResult> {
  try {
    const r = await quest.provision(data);
    return {
      addedItemIds:  r.addedItemIds  ?? [],
      addedSpaceIds: r.addedSpaceIds ?? [],
      addedMemoIds:  r.addedMemoIds  ?? [],
      note: r.note,
    };
  } catch (e) {
    console.warn('[tutorial.provisioner]', quest.id, e);
    return { addedItemIds: [], addedSpaceIds: [], addedMemoIds: [] };
  }
}

/** Surface used by the CompletionModal — the host App passes its
 *  store delete fns; we sequence them in dependency order so a
 *  space deletion doesn't orphan its item-deletion attempts. */
export interface CleanupHandles {
  deleteItem: (spaceId: string, itemId: string) => void;
  deleteSpace: (spaceId: string) => void;
  deleteMemo:  (spaceId: string, itemId: string) => void;
}

export interface Cleanup {
  /** Items added during the quest. */
  itemIds: string[];
  /** Spaces added during the quest. Deleted last (after their items). */
  spaceIds: string[];
  /** Memo cards. Deleted via deleteMemo, since memo lifecycle is
   *  separate from item lifecycle (trash → retention sweep). */
  memoIds: string[];
}

/** Reverse the provisioning + any user additions during the
 *  quest. Best-effort: a missing id (already deleted by the user
 *  during the quest) is silently ignored. */
export function cleanup(handles: CleanupHandles, data: AppData, ids: Cleanup): void {
  // Items first — find each id's owning space, then delete.
  for (const itemId of ids.itemIds) {
    const space = data.spaces.find(s => s.items.some(i => i.id === itemId));
    if (space) handles.deleteItem(space.id, itemId);
  }
  for (const memoId of ids.memoIds) {
    const space = data.spaces.find(s => s.items.some(i => i.id === memoId));
    if (space) handles.deleteMemo(space.id, memoId);
  }
  // Spaces last so item deletions above could find their parent.
  for (const spaceId of ids.spaceIds) {
    handles.deleteSpace(spaceId);
  }
}
