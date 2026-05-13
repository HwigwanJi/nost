/**
 * Tutorial system v2 — public surface.
 *
 * App-level call sites import from here only. Internal modules
 * (NudgeToast, provisioner, etc.) stay private to the folder.
 */

export { TutorialProvider } from './TutorialProvider';
export { useTutorial } from './useTutorial';
export { AccordionPanel } from './AccordionPanel';
export { triggers } from './triggers';
export { useTutorialState, tutorialActions } from './state';
export { totalAvailableDays } from './reward';
// Quest lookup — needed by App.tsx to resolve notification action payloads
// (an open-tour intent carries the QuestId, dispatcher converts to a Quest
// and hands it to the tutorial API).
export { findQuest } from './registry';
export type { Quest, QuestId, QuestStep, AppEvent, GestureKind, TutorialState } from './types';
