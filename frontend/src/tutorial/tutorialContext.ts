/**
 * Bare React context for TutorialProvider — extracted to its own
 * file so Fast Refresh is happy (a .tsx with both component and
 * non-component exports breaks HMR boundaries).
 */

import { createContext } from 'react';
import type { Quest } from './types';

export interface TutorialContextValue {
  start: (quest: Quest) => void;
  showResumePromptIfAny: () => void;
}

export const TutorialContext = createContext<TutorialContextValue | null>(null);
