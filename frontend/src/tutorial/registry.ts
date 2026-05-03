/**
 * Quest registry — the SSOT list of every tutorial quest.
 *
 * Sprint 1 keeps this empty: the infrastructure (runner, state,
 * accordion, nudges) all work against an empty list, so the UI
 * shows a "곧 추가됩니다" empty-state in the accordion. Quests
 * land in subsequent sprints (one per PR) — see § 9 of the
 * design doc.
 *
 * Adding a quest = push an entry into QUESTS. Categories are
 * derived from the union of `q.category` values, ordered by
 * CATEGORY_ORDER.
 */

import type { Quest, QuestId, CategoryId } from './types';
import { BASICS_QUESTS } from './quests/basics';
import { CARDS_QUESTS } from './quests/cards';
import { LAYOUT_QUESTS } from './quests/layout';
import { ADVANCED_QUESTS } from './quests/advanced';
import { WIDGETS_QUESTS } from './quests/widgets';

export const QUESTS: Quest[] = [
  ...BASICS_QUESTS,
  ...CARDS_QUESTS,
  ...LAYOUT_QUESTS,
  ...ADVANCED_QUESTS,
  ...WIDGETS_QUESTS,
];

/** Display order of categories in the accordion. Categories not
 *  listed here are appended in alphabetical order. */
export const CATEGORY_ORDER: CategoryId[] = [
  'basics',
  'cards',
  'layout',
  'advanced',
  'widgets',
];

export const CATEGORY_LABELS: Record<CategoryId, { title: string; icon: string; summary: string }> = {
  basics:   { title: '기본기 소개',     icon: 'school',           summary: '스페이스 · 카드 · 템플릿 · 빠른 검색' },
  cards:    { title: '카드 탐구하기',   icon: 'add_card',         summary: '5가지 빠른 추가 방법' },
  layout:   { title: '자유롭게 배치하기', icon: 'view_compact',    summary: '카드 · 스페이스 · 타일링' },
  advanced: { title: '심화 기능',       icon: 'auto_awesome',     summary: '플로팅 · 노드 · 프리셋' },
  widgets:  { title: '위젯 알아보기',   icon: 'widgets',          summary: '음악 · 컬러 · 메모' },
};

/** Lookup helpers — keep as named exports so call sites read
 *  intent rather than passing the QUESTS array around. */
export function findQuest(id: QuestId): Quest | undefined {
  return QUESTS.find(q => q.id === id);
}

export function questsByCategory(category: CategoryId): Quest[] {
  return QUESTS.filter(q => q.category === category);
}

export function questsForNudgeTrigger(eventType: string): Quest[] {
  return QUESTS.filter(q => q.contextNudge?.trigger.type === eventType);
}

/** True when every prereq quest of `q` exists in `completed`. */
export function isUnlocked(q: Quest, completed: Record<QuestId, unknown>): boolean {
  return q.prereqs.every(pr => pr in completed);
}
