/**
 * Tutorial system v2 — type definitions.
 *
 * SSOT for the shape of every quest, step, nudge, and persisted
 * state record. Imported by every other module in this folder; do
 * NOT re-declare these shapes elsewhere. See plans/tutorial-system-v2.md
 * for the full design rationale.
 */

import type { AppData } from '../types';

// ── Identifiers ─────────────────────────────────────────────────

/** Stable string id for a quest, namespaced by category. e.g. 'basics.cards' */
export type QuestId = string;

export type CategoryId =
  | 'basics'
  | 'cards'
  | 'layout'
  | 'advanced'
  | 'widgets';

// ── Quest spec ──────────────────────────────────────────────────

/** Gesture hint shown next to the spotlight popover so users know
 *  whether the step expects a click, drag, swipe, etc. Visual only;
 *  never enforces input mode. */
export type GestureKind =
  | 'left-click'
  | 'right-click'
  | 'long-press'
  | 'drag'
  | 'keyboard'
  | 'swipe';

/** How a step advances. Multiple variants share the discriminated
 *  union so QuestRunner can dispatch with one switch. */
export type AdvanceCriterion =
  | { kind: 'next-button' }
  | { kind: 'click-target' }
  | { kind: 'expects'; check: (data: AppData) => boolean }
  | { kind: 'event'; type: AppEvent }
  | { kind: 'auto-advance'; ms: number };

/** Internal app events that quests/nudges can listen for. Strings
 *  rather than enums so call sites can publish without importing
 *  this file. Keep stable — they're effectively a public API for
 *  the trigger bus. */
export type AppEvent =
  | 'item-launched'
  | 'item-added'
  | 'item-deleted'
  | 'space-added'
  | 'space-renamed'
  | 'memo-created'
  | 'memo-edited'
  | 'recommend-panel-opened'
  | 'item-dialog-cancelled'
  | 'gateway-banner-dismissed'
  | 'first-card-error'
  | 'memo-edit-stuck';

export interface QuestStep {
  id: string;
  title: string;
  body: string;
  /** `data-tour-id` attribute value(s) on target element(s). */
  spotlight: string | string[];
  advance: AdvanceCriterion;
  gesture?: GestureKind;
  /** Soft fallback hint, shown after ~15 s of no progress. */
  fallbackHint?: string;
}

/** Result of a quest's `provision()` — temp resources added to make
 *  the quest runnable. Recorded in active state so cleanup can
 *  reverse them. */
export interface ProvisionResult {
  addedItemIds?: string[];
  addedSpaceIds?: string[];
  addedMemoIds?: string[];
  /** Optional one-line note shown in ScanLoader to explain what was
   *  added on the user's behalf. */
  note?: string;
}

export interface NudgeTrigger {
  type: AppEvent;
  /** Optional secondary filter — e.g. only fire for url-type cards. */
  match?: (data: AppData) => boolean;
  /** Cool-down before this trigger can re-fire the same nudge. */
  cooldownMin: number;
}

export interface Quest {
  id: QuestId;
  category: CategoryId;
  title: string;
  summary: string;
  estimatedSec: number;
  rewardDays: number;
  /** Other quest IDs that must be `completed` before this one is unlocked. */
  prereqs: QuestId[];
  /** Optional Pro-only gate. Free users see a paywall on click. */
  requiresEntitlement?: 'pro';
  provision: (data: AppData) => Promise<ProvisionResult>;
  steps: QuestStep[];
  /** When omitted, this quest is settings-launchable only — no nudge surface. */
  contextNudge?: {
    trigger: NudgeTrigger;
    headline: string;
    body: string;
  };
}

// ── Persisted state ─────────────────────────────────────────────

export interface CompletedRecord {
  /** ISO8601 wall-clock time of completion. */
  atIso: string;
  /** End-to-end runtime, ms. */
  durationMs: number;
}

export interface ActiveQuest {
  questId: QuestId;
  stepIdx: number;
  startedAtIso: string;
  /** Items added by provision OR by the user during the quest. The
   *  CompletionModal lists these; the cleanup option deletes them. */
  addedItemIds: string[];
  addedSpaceIds: string[];
  addedMemoIds: string[];
}

export interface DismissedNudge {
  /** ISO8601 — earliest time we may re-fire this quest's nudge. */
  cooldownUntilIso: string;
}

export interface TutorialState {
  completed: Record<QuestId, CompletedRecord>;
  active: ActiveQuest | null;
  dismissedNudges: Record<QuestId, DismissedNudge>;
  /** Sum of rewardDays from completed quests + bonuses. Persisted
   *  so a clean reinstall (with restored data) doesn't lose
   *  earned days. */
  rewardDays: number;
  /** True once the user has explicitly opted out of "you have
   *  N days available" 3-day-after-onboarding nudge (§ 11.1). */
  finalNudgeShown: boolean;
}

export const EMPTY_STATE: TutorialState = {
  completed: {},
  active: null,
  dismissedNudges: {},
  rewardDays: 0,
  finalNudgeShown: false,
};
