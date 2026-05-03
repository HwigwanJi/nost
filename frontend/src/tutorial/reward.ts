/**
 * Reward arithmetic — quest payouts, category-completion bonuses,
 * master bonus.
 *
 * Per § 11 of the design doc:
 *   - basics quests   : 1 day each
 *   - everything else : 3 days each
 *   - category complete bonus : +2 days
 *   - master (all categories) : +7 days
 *
 * The per-quest rewardDays sits on Quest.rewardDays so registry
 * authors are explicit about it; this module supplies the bonuses
 * that depend on cross-quest state.
 */

import type { TutorialState, CategoryId } from './types';
import { QUESTS, CATEGORY_ORDER } from './registry';

export const CATEGORY_COMPLETE_BONUS = 2;
export const MASTER_BONUS = 7;

/** True when every quest in `category` is completed. */
export function isCategoryComplete(category: CategoryId, completed: TutorialState['completed']): boolean {
  const inCategory = QUESTS.filter(q => q.category === category);
  if (inCategory.length === 0) return false;
  return inCategory.every(q => q.id in completed);
}

/** True when every category in CATEGORY_ORDER is complete. */
export function isMasterComplete(completed: TutorialState['completed']): boolean {
  return CATEGORY_ORDER.every(c => isCategoryComplete(c, completed));
}

/**
 * Compute any bonus that should fire when `justFinished` quest is
 * marked complete. Returns the delta in days (0 when no boundary
 * crossed). Caller hands this to tutorialActions.addBonusDays.
 *
 * The check uses a hypothetical "post-completion" state so the
 * boundary detection works on the same render the quest finishes:
 *   1. Did completing this quest tip its category to complete?
 *   2. Did it tip the WHOLE app to master?
 */
export function bonusForCompletion(
  questId: string,
  completedAfter: TutorialState['completed'],
): number {
  const q = QUESTS.find(qq => qq.id === questId);
  if (!q) return 0;
  let bonus = 0;
  if (isCategoryComplete(q.category, completedAfter)) bonus += CATEGORY_COMPLETE_BONUS;
  if (isMasterComplete(completedAfter)) bonus += MASTER_BONUS;
  return bonus;
}

/** Total days available across the whole tutorial — used by the
 *  accordion header ("N일 적립 / X일 가능"). */
export function totalAvailableDays(): number {
  const questDays = QUESTS.reduce((sum, q) => sum + q.rewardDays, 0);
  const categoryBonus = CATEGORY_ORDER.length * CATEGORY_COMPLETE_BONUS;
  return questDays + categoryBonus + MASTER_BONUS;
}
