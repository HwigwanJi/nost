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
import { electronAPI } from '../electronBridge';
import type { Quest, ProvisionResult } from './types';
import { useTutorialState, tutorialActions, readTutorialState } from './state';
import { findQuest, nextQuestSameCategory, firstIncompleteQuest } from './registry';
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
  /** Daily-nudge + resume-prompt MIRROR into the bell. Toast is
   *  transient (9 s) — the bell entry is the permanent affordance
   *  the user can come back to. Both flow through the same dedupKey
   *  so the panel doesn't pile up if multiple sessions skip the
   *  nudge without dismissing the prior bell entry. */
  addNotification: (notif: {
    kind: 'tip';
    title: string;
    body?: string;
    action?: { label: string; intent: 'open-tour'; payload: string };
    dedupKey: string;
  }) => void;
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

export function TutorialProvider({ data, showToast, addNotification, deleteItem, deleteSpace, deleteMemo, isBusy, onApiReady, children }: ProviderProps) {
  const state = useTutorialState();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const startTimeRef = useRef<number>(0);

  // Install nudge subscribers once. Use refs for the dependent
  // closures so we don't re-bind on every parent re-render.
  const apiRef = useRef({ showToast, addNotification });
  apiRef.current = { showToast, addNotification };
  const dataRef = useRef(data);
  dataRef.current = data;
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  // While a tutorial is on-screen (scanning loader, runner overlay,
  // or completion modal) suppress the main window's autoHide-on-blur
  // regardless of the user's setting — losing the launcher mid-step
  // breaks immersion and the overlay would survive without anything
  // to focus on. Tagged source 'tutorial' so clean mode's separate
  // suppression isn't disturbed. Cleanup releases on every exit
  // path: completion (keep/cleanup), skip, ESC pause, unmount.
  useEffect(() => {
    const active = phase.kind !== 'idle';
    electronAPI.setSuppressAutoHide(active, 'tutorial');
    return () => {
      if (active) electronAPI.setSuppressAutoHide(false, 'tutorial');
    };
  }, [phase.kind]);

  useEffect(() => {
    const off = installNudges(
      {
        showToast: (m, o) => apiRef.current.showToast(m, o),
        // Mirror nudges into the bell — see NudgeToast.ts comment.
        addNotification: (n) => apiRef.current.addNotification(n),
      },
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

  // Daily nudge — once per local day, on the first launch of that
  // day, surface the first incomplete + unlocked quest as a toast
  // with a "시작" action. State.lastDailyNudgeYmd caps to one fire/day.
  // Skipped while a quest is already active (don't pile UI on UI) or
  // when everything is complete.
  useEffect(() => {
    const t = setTimeout(() => {
      const s = readTutorialState();
      if (s.active) return;
      const today = (() => {
        const d = new Date();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
      })();
      if (s.lastDailyNudgeYmd === today) return;
      const next = firstIncompleteQuest(s.completed);
      if (!next) { tutorialActions.markDailyNudgeShown(today); return; }
      if (isBusyRef.current()) return;
      tutorialActions.markDailyNudgeShown(today);
      // Toast = transient (9 s) attention grab. Notification center =
      // permanent affordance the user can come back to. Both should
      // fire so a missed toast still lands in the bell. dedupKey is
      // per-quest so re-suggesting the same quest later doesn't
      // duplicate the row.
      apiRef.current.showToast(
        `📚 아직 안 한 튜토리얼: ${next.title} · +${next.rewardDays}일`,
        {
          actions: [
            { label: '시작', icon: 'play_arrow', onClick: () => start(next) },
            { label: '나중에', icon: 'close', onClick: () => { /* dismiss */ } },
          ],
          duration: 9000,
        },
      );
      apiRef.current.addNotification({
        kind: 'tip',
        title: '안 한 튜토리얼이 있어요',
        body: `${next.title} · +${next.rewardDays}일 보상`,
        action: { label: '시작', intent: 'open-tour', payload: next.id },
        dedupKey: `tutorial-nudge-${next.id}`,
      });
    }, 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Mirror into the bell — the toast is a 9 s reminder, the bell row
    // is the permanent affordance. Clicking "이어서" in the bell row
    // routes through open-tour intent → tutorialApi.start(quest) (same
    // path as the toast's onClick) thanks to App.tsx's dispatcher.
    apiRef.current.addNotification({
      kind: 'tip',
      title: `${quest.title} 진행 중`,
      body: `${s.active.stepIdx + 1}/${quest.steps.length} 단계 · +${quest.rewardDays}일 적립 가능`,
      action: { label: '이어서', intent: 'open-tour', payload: quest.id },
      dedupKey: `tutorial-resume-${quest.id}`,
    });
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

      {phase.kind === 'completing' && (() => {
        const nq = nextQuestSameCategory(phase.quest.id, {
          ...state.completed,
          [phase.quest.id]: { atIso: '', durationMs: 0 },
        });
        return (
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
            nextQuest={nq}
            onStartNext={nq ? () => { handleKeep(); start(nq); } : undefined}
          />
        );
      })()}
    </TutorialContext.Provider>
  );
}
