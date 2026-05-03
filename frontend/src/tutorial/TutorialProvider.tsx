/**
 * TutorialProvider — single mount point that orchestrates the
 * runtime surfaces (ScanLoader → QuestRunner → CompletionModal)
 * and installs the nudge listeners.
 *
 * App.tsx renders this once, near the top of the tree, passing
 * the live AppData and a small adapter ({ deleteItem, deleteSpace,
 * deleteMemo, showToast, isBusy }) so we can clean up provisioned
 * resources and surface nudges through the in-house toast queue.
 *
 * Quest start (from AccordionPanel OR a nudge action) flows through
 * `start(quest)` exposed via context — keeps the wiring one-way:
 * accordion / nudge → provider → state → UI surfaces.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppData } from '../types';
import type { Quest, ProvisionResult } from './types';
import { useTutorialState, tutorialActions } from './state';
import { findQuest } from './registry';
import { ScanLoader } from './ScanLoader';
import { QuestRunner } from './QuestRunner';
import { CompletionModal } from './CompletionModal';
import { installNudges } from './NudgeToast';
import { bonusForCompletion } from './reward';
import { TutorialContext, type TutorialContextValue } from './tutorialContext';

interface ProviderProps {
  data: AppData;
  /** In-house toast for nudges + ad-hoc messages. */
  showToast: (msg: string, opts?: { actions?: Array<{ label: string; icon: string; onClick: () => void }>; duration?: number }) => void;
  /** Cleanup handles — called by CompletionModal when user picks "정리하기". */
  deleteItem:  (spaceId: string, itemId: string) => void;
  deleteSpace: (spaceId: string) => void;
  deleteMemo:  (spaceId: string, itemId: string) => void;
  /** True when other modal-class UI is up; nudges defer. */
  isBusy: () => boolean;
  /** Optional — fires once on mount with the public API so call
   *  sites OUTSIDE the provider tree (e.g. App.tsx threading it
   *  into SettingsDialog) can hold a ref. Inside the tree, use
   *  the `useTutorial` hook instead. */
  onApiReady?: (api: TutorialContextValue) => void;
  children?: React.ReactNode;
}


type Phase =
  | { kind: 'idle' }
  | { kind: 'scanning'; quest: Quest }
  | { kind: 'running';  quest: Quest } // stepIdx comes from state.active
  | { kind: 'completing'; quest: Quest; earnedDays: number; bonusCategoryName?: string; bonusMaster?: boolean };

export function TutorialProvider({ data, showToast, deleteItem, deleteSpace, deleteMemo, isBusy, onApiReady, children }: ProviderProps) {
  const state = useTutorialState();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const startTimeRef = useRef<number>(0);

  // Install nudge subscribers once. Use refs for the dependent
  // closures so we don't re-bind on every parent re-render.
  const apiRef = useRef({ showToast });
  apiRef.current = { showToast };
  const dataRef = useRef(data);
  dataRef.current = data;
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  useEffect(() => {
    const off = installNudges(
      { showToast: (m, o) => apiRef.current.showToast(m, o) },
      {
        startQuest: (q) => start(q),
        getData: () => dataRef.current,
        isBusy: () => isBusyRef.current(),
      },
    );
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback((quest: Quest) => {
    startTimeRef.current = Date.now();
    setPhase({ kind: 'scanning', quest });
  }, []);

  const handleScanReady = useCallback((quest: Quest, result: ProvisionResult) => {
    tutorialActions.startQuest(quest.id, result);
    setPhase({ kind: 'running', quest });
  }, []);

  const handleAdvance = useCallback(() => {
    if (phase.kind !== 'running') return;
    const { quest } = phase;
    const stepIdx = state.active?.stepIdx ?? 0;
    if (stepIdx + 1 >= quest.steps.length) {
      // Last step done → finish. Bonuses computed against the
      // post-completion state.
      const completedAfter = { ...state.completed, [quest.id]: { atIso: '', durationMs: 0 } };
      const bonus = bonusForCompletion(quest.id, completedAfter);
      const earned = quest.rewardDays + bonus;
      const dur = Date.now() - startTimeRef.current;
      tutorialActions.markCompleted(quest.id, dur, earned);
      const bonusCategoryName = bonus >= 2 ? quest.category : undefined;
      const bonusMaster = bonus >= 9; // 2 + 7
      setPhase({ kind: 'completing', quest, earnedDays: earned, bonusCategoryName, bonusMaster });
    } else {
      tutorialActions.advanceStep();
    }
  }, [phase, state.active?.stepIdx, state.completed]);

  const handleSkip = useCallback(() => {
    if (phase.kind !== 'running') return;
    setPhase({ kind: 'completing', quest: phase.quest, earnedDays: 0 });
  }, [phase]);

  const handlePause = useCallback(() => {
    // active state preserved by tutorialActions — just unmount the
    // overlay. Resume prompt fires next session via showResumePromptIfAny.
    tutorialActions.pauseActive();
    setPhase({ kind: 'idle' });
  }, []);

  const handleKeep = useCallback(() => {
    tutorialActions.clearActive();
    setPhase({ kind: 'idle' });
  }, []);

  const handleCleanup = useCallback(() => {
    if (phase.kind !== 'completing') return;
    const added = state.active ?? { addedItemIds: [], addedSpaceIds: [], addedMemoIds: [] };
    // Reverse provisioned + user-added resources.
    for (const id of added.addedItemIds) {
      const sp = dataRef.current.spaces.find(s => s.items.some(i => i.id === id));
      if (sp) deleteItem(sp.id, id);
    }
    for (const id of added.addedMemoIds) {
      const sp = dataRef.current.spaces.find(s => s.items.some(i => i.id === id));
      if (sp) deleteMemo(sp.id, id);
    }
    for (const id of added.addedSpaceIds) deleteSpace(id);
    tutorialActions.clearActive();
    setPhase({ kind: 'idle' });
  }, [phase, state.active, deleteItem, deleteSpace, deleteMemo]);

  // Resume prompt — caller (App) invokes once on startup.
  const showResumePromptIfAny = useCallback(() => {
    const s = state;
    if (!s.active) return;
    const quest = findQuest(s.active.questId);
    if (!quest) {
      // Stale active — quest no longer in registry. Clear silently.
      tutorialActions.clearActive();
      return;
    }
    apiRef.current.showToast(
      `🎯 ${quest.title} 진행 중 (${(s.active.stepIdx + 1)}/${quest.steps.length}) · +${quest.rewardDays}일 적립 가능`,
      {
        actions: [
          { label: '이어서', icon: 'play_arrow', onClick: () => {
              startTimeRef.current = Date.now();
              setPhase({ kind: 'running', quest });
            } },
          { label: '그만',   icon: 'close',      onClick: () => tutorialActions.clearActive() },
        ],
        duration: 9000,
      },
    );
  }, [state]);

  const ctx = useMemo<TutorialContextValue>(() => ({ start, showResumePromptIfAny }), [start, showResumePromptIfAny]);

  // Hand the api up once on mount (and whenever it changes) so a
  // parent above the Provider tree can invoke start() directly.
  useEffect(() => {
    onApiReady?.(ctx);
  }, [ctx, onApiReady]);

  return (
    <TutorialContext.Provider value={ctx}>
      {children}

      {phase.kind === 'scanning' && (
        <ScanLoader
          quest={phase.quest}
          data={data}
          onReady={(r) => handleScanReady(phase.quest, r)}
          onCancel={() => setPhase({ kind: 'idle' })}
        />
      )}

      {phase.kind === 'running' && state.active && (
        <QuestRunner
          quest={phase.quest}
          stepIdx={state.active.stepIdx}
          data={data}
          onAdvance={handleAdvance}
          onSkip={handleSkip}
          onPause={handlePause}
        />
      )}

      {phase.kind === 'completing' && (
        <CompletionModal
          open
          quest={phase.quest}
          added={state.active ?? { addedItemIds: [], addedSpaceIds: [], addedMemoIds: [] }}
          data={data}
          earnedDays={phase.earnedDays}
          totalDays={state.rewardDays}
          bonusCategory={phase.bonusCategoryName}
          bonusMaster={phase.bonusMaster}
          onKeep={handleKeep}
          onCleanup={handleCleanup}
        />
      )}
    </TutorialContext.Provider>
  );
}
