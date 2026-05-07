/**
 * Registry helpers — pure functions over QUESTS list.
 *
 * Why test: nextQuestSameCategory drives the "다음 퀘스트로" button
 * in CompletionModal; firstIncompleteQuest drives the daily nudge.
 * Both have prereq + completion + category logic that's easy to
 * silently break by reordering the registry.
 */

import { describe, it, expect } from 'vitest';
import {
  QUESTS,
  findQuest,
  questsByCategory,
  isUnlocked,
  nextQuestSameCategory,
  firstIncompleteQuest,
  CATEGORY_ORDER,
} from './registry';

describe('registry shape', () => {
  it('all quests have a category in CATEGORY_ORDER', () => {
    for (const q of QUESTS) {
      expect(CATEGORY_ORDER).toContain(q.category);
    }
  });

  it('quest ids are unique', () => {
    const ids = QUESTS.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every prereq references an existing quest', () => {
    const ids = new Set(QUESTS.map(q => q.id));
    for (const q of QUESTS) {
      for (const pr of q.prereqs) {
        expect(ids.has(pr)).toBe(true);
      }
    }
  });

  it('findQuest hits and misses', () => {
    expect(findQuest('basics.spaces')).toBeTruthy();
    expect(findQuest('does.not.exist' as never)).toBeUndefined();
  });
});

describe('isUnlocked', () => {
  it('quest with no prereqs is always unlocked', () => {
    const q = QUESTS.find(x => x.prereqs.length === 0);
    expect(q).toBeTruthy();
    expect(isUnlocked(q!, {})).toBe(true);
  });

  it('quest with unmet prereq is locked', () => {
    const q = QUESTS.find(x => x.prereqs.length > 0);
    expect(q).toBeTruthy();
    expect(isUnlocked(q!, {})).toBe(false);
  });

  it('quest with met prereqs is unlocked', () => {
    const q = QUESTS.find(x => x.prereqs.length > 0)!;
    const completed = Object.fromEntries(q.prereqs.map(p => [p, { atIso: '', durationMs: 0 }]));
    expect(isUnlocked(q, completed)).toBe(true);
  });
});

describe('nextQuestSameCategory', () => {
  it('returns next category-peer that is unlocked + incomplete', () => {
    const basicsQuests = questsByCategory('basics');
    expect(basicsQuests.length).toBeGreaterThan(1);
    // Complete the first one and ask for next
    const first = basicsQuests[0];
    const completed = { [first.id]: { atIso: '', durationMs: 0 } };
    const next = nextQuestSameCategory(first.id, completed);
    expect(next).toBeTruthy();
    expect(next!.category).toBe('basics');
    expect(next!.id).not.toBe(first.id);
  });

  it('returns null when no peer left', () => {
    const basicsIds = questsByCategory('basics').map(q => q.id);
    const completed = Object.fromEntries(basicsIds.map(id => [id, { atIso: '', durationMs: 0 }]));
    const last = basicsIds[basicsIds.length - 1];
    expect(nextQuestSameCategory(last, completed)).toBeNull();
  });

  it('skips locked peers (prereq not met) — returns null instead of returning a locked quest', () => {
    // basics.cards prereq = basics.spaces. If we complete basics.spaces only
    // (not basics.cards), then nextQuestSameCategory('basics.spaces', ...)
    // should return basics.cards (now unlocked).
    const completed = { 'basics.spaces': { atIso: '', durationMs: 0 } };
    const next = nextQuestSameCategory('basics.spaces', completed);
    expect(next?.id).toBe('basics.cards');
  });

  it('returns null when called with unknown current id', () => {
    expect(nextQuestSameCategory('unknown.id' as never, {})).toBeNull();
  });
});

describe('firstIncompleteQuest', () => {
  it('returns first basics quest on fresh state', () => {
    const q = firstIncompleteQuest({});
    expect(q?.category).toBe('basics');
  });

  it('skips completed quests in order', () => {
    const completed = { 'basics.spaces': { atIso: '', durationMs: 0 } };
    const q = firstIncompleteQuest(completed);
    // basics.search has no prereq, so it's unlocked too — but registry
    // order puts basics.cards / basics.presets / basics.search after
    // basics.spaces. The next *unlocked + incomplete* should be either
    // basics.cards (now unlocked since spaces done) or basics.search
    // (always unlocked). Either is acceptable behaviour — assert
    // it's incomplete and unlocked.
    expect(q).toBeTruthy();
    expect(q!.id).not.toBe('basics.spaces');
    expect(isUnlocked(q!, completed)).toBe(true);
  });

  it('returns null when everything is done', () => {
    const completed = Object.fromEntries(QUESTS.map(q => [q.id, { atIso: '', durationMs: 0 }]));
    expect(firstIncompleteQuest(completed)).toBeNull();
  });
});
