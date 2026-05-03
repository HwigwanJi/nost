/**
 * NudgeToast — bridge between the trigger bus and the in-house
 * showToast queue.
 *
 * Not a React component (the toast itself IS the rendering — we
 * just call showToast). One subscribe call per AppEvent in the
 * registry; when triggered, we look up the matching quest, check
 * cooldown / completion / busy mark, and fire the toast with a
 * "시작하기" action button that runs the quest.
 *
 * Per-session counter caps total nudges at 2 so the UX doesn't
 * feel pestered (§ 6.2). Reset on app reload (in-memory).
 */

import type { AppData } from '../types';
import type { AppEvent, Quest } from './types';
import { triggers } from './triggers';
import { QUESTS, questsForNudgeTrigger } from './registry';
import { readTutorialState, isNudgeAllowed, tutorialActions } from './state';

interface ToastApi {
  showToast: (msg: string, opts?: {
    actions?: Array<{ label: string; icon: string; onClick: () => void }>;
    duration?: number;
  }) => void;
}

interface Hooks {
  /** Called when the user clicks "시작하기" — host runs ScanLoader → runner. */
  startQuest: (quest: Quest) => void;
  /** Live AppData reader (for nudge.match secondary filters). */
  getData: () => AppData;
  /** True when other modal-class UI is up — we defer until clear. */
  isBusy: () => boolean;
}

const SESSION_NUDGE_CAP = 2;
let sessionNudgeCount = 0;

/** Subscribe nudge handlers for every AppEvent that any registered
 *  quest cares about. Returns an unsubscribe function for cleanup
 *  on app teardown. Idempotent — calling twice rebinds without
 *  duplicating handlers. */
export function installNudges(api: ToastApi, hooks: Hooks): () => void {
  const offFns: Array<() => void> = [];

  // Find every distinct AppEvent referenced by any quest's nudge.
  const seen = new Set<AppEvent>();
  for (const ev of allTriggerEvents()) {
    if (seen.has(ev)) continue;
    seen.add(ev);
    const off = triggers.on(ev, () => maybeFire(ev, api, hooks));
    offFns.push(off);
  }

  return () => { for (const f of offFns) f(); };
}

function allTriggerEvents(): AppEvent[] {
  const out: AppEvent[] = [];
  for (const q of QUESTS) {
    if (q.contextNudge) out.push(q.contextNudge.trigger.type);
  }
  return out;
}

function maybeFire(event: AppEvent, api: ToastApi, hooks: Hooks) {
  if (sessionNudgeCount >= SESSION_NUDGE_CAP) return;
  if (hooks.isBusy()) return;

  const candidates = questsForNudgeTrigger(event);
  if (candidates.length === 0) return;

  const state = readTutorialState();
  const data = hooks.getData();

  // Pick the FIRST matching quest that:
  //   1. isn't already completed
  //   2. isn't on cooldown
  //   3. passes the optional `match` predicate
  // Quests are searched in registry order, so the author controls
  // priority when multiple quests share an event.
  const pick = candidates.find(q => {
    if (q.id in state.completed) return false;
    if (!isNudgeAllowed(state, q.id)) return false;
    const match = q.contextNudge!.trigger.match;
    if (match && !match(data)) return false;
    return true;
  });
  if (!pick) return;

  sessionNudgeCount += 1;

  const nudge = pick.contextNudge!;
  api.showToast(`${nudge.headline} · ${nudge.body} (+${pick.rewardDays}일)`, {
    actions: [
      { label: '시작하기', icon: 'play_arrow', onClick: () => hooks.startQuest(pick) },
      { label: '다음에',   icon: 'schedule',   onClick: () => tutorialActions.dismissNudge(pick.id, nudge.trigger.cooldownMin) },
    ],
    duration: 8000,
  });
}

