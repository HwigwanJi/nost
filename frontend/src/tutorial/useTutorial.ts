/**
 * useTutorial — hook accessor for the TutorialProvider context.
 *
 * Lives in its own file (separate from TutorialProvider.tsx) so
 * Fast Refresh stays happy: a single .tsx file may only export
 * React components for HMR to work cleanly.
 */

import { useContext } from 'react';
import { TutorialContext } from './tutorialContext';

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be used inside <TutorialProvider>');
  return ctx;
}
