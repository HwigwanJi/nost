/**
 * Category 4 — Advanced. Power features beyond the basic
 * launch-and-organize loop.
 *
 * `advanced.preset` 은 basics.presets (1·2·3 토글)과 별도로
 * **다른 프리셋으로 카드 옮기기** 같은 cross-preset 동작을 다룸.
 *
 * Pro-only 동작은 `requiresEntitlement: 'pro'`로 표시. 현재
 * BETA_FORCE_PRO 시기엔 락이 사실상 비활성, 빌링 도입 후 자동 적용.
 */

import type { Quest } from '../types';

const advancedFloating: Quest = {
  id: 'advanced.floating',
  category: 'advanced',
  title: '플로팅 뱃지 만들기',
  summary: '카드를 nost 밖으로 — 화면 어디든 떠있는 뱃지로',
  estimatedSec: 120,
  rewardDays: 3,
  prereqs: ['basics.cards'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '플로팅 뱃지 = 화면 상주 단축',
      body: '자주 쓰는 카드를 nost 창 밖으로 꺼내 화면 어디든 떠있게 둘 수 있어요. nost 창 안 열어도 클릭으로 즉시 실행.',
      spotlight: ['item-card', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'try',
      title: '카드 우클릭 → 플로팅으로',
      body: '아무 카드 위에서 우클릭하면 메뉴가 떠요. "플로팅으로" 항목 선택.',
      spotlight: ['item-card', 'space-header'],
      gesture: 'right-click',
      advance: { kind: 'event', type: 'floating-converted' },
      fallbackHint: '카드 우클릭 → 컨텍스트 메뉴 → "플로팅" 항목.',
    },
    {
      id: 'observe',
      title: '바탕화면 확인',
      body: 'nost 창 밖, 모니터 어디엔가 작은 뱃지가 떠 있어요. 클릭하면 카드 동작 실행.',
      spotlight: ['item-card', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'wrap',
      title: '필요할 때만 nost 열기',
      body: '플로팅으로 충분한 단축은 nost 창을 굳이 띄우지 않아도 돼요. 우클릭 → 풀어내기로 다시 카드.',
      spotlight: ['item-card', 'space-header'],
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
};

const advancedNodegroup: Quest = {
  id: 'advanced.nodegroup',
  category: 'advanced',
  title: '노드 그룹 (한 키 다중 실행)',
  summary: '여러 카드를 묶어 단축키 한 번에 실행',
  estimatedSec: 150,
  rewardDays: 3,
  prereqs: ['layout.tile'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '노드 그룹 = 멀티-실행의 핵심',
      body: '"매일 켜는 5개" 같은 워크플로우를 묶어두면 한 키로 정리된 작업환경이 떠요. 타일링과 결합하면 모니터 자동 분할까지.',
      spotlight: ['node-mode-button', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'enter-mode',
      title: '노드 모드 진입',
      body: '왼쪽 사이드바의 노드 도구 버튼을 클릭해 활성화하세요.',
      spotlight: 'node-mode-button',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'node-mode-entered' },
      fallbackHint: '두 점이 선으로 이어진 hub 아이콘.',
    },
    {
      id: 'select',
      title: '카드 클릭으로 그룹 멤버 추가',
      body: '카드를 클릭하면 그룹에 들어가요. 한 번 더 누르면 빠져요. 여러 스페이스의 카드를 섞어 묶을 수 있어요.',
      spotlight: ['item-card', 'space-header'],
      gesture: 'left-click',
      advance: { kind: 'event', type: 'node-added' },
    },
    {
      id: 'launch',
      title: '단축키로 실행',
      body: '그룹에 단축키를 할당하거나 사이드바 그룹 패널에서 실행 버튼을 눌러보세요. 묶인 카드들이 동시에 실행돼요.',
      spotlight: ['node-mode-button', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'wrap',
      title: '워크플로우 = 한 번의 키',
      body: '아침 루틴, 회의 시작, 코딩 세션 — 모두 한 키로. 카드를 묶을수록 nost가 손에 익어요.',
      spotlight: ['node-mode-button', 'space-header'],
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
};

// 재정의: basics.presets는 토글 익히기, advanced.preset은 카드를
// 다른 프리셋으로 이동하는 심화 동작.
const advancedPreset: Quest = {
  id: 'advanced.preset',
  category: 'advanced',
  title: '카드를 다른 프리셋으로',
  summary: '카드 다이얼로그의 프리셋 토글로 cross-preset 이동',
  estimatedSec: 90,
  rewardDays: 3,
  prereqs: ['basics.presets'],
  requiresEntitlement: 'pro',
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '카드 단위로 프리셋 이동',
      body: '기존 카드를 다른 프리셋의 스페이스로 옮길 수 있어요. 카드 다이얼로그 안에서 프리셋 토글로.',
      spotlight: ['item-card', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'open-edit',
      title: '카드 우클릭 → 수정 또는 더블클릭',
      body: '편집할 카드의 다이얼로그를 열어주세요.',
      spotlight: ['item-card', 'space-header'],
      gesture: 'right-click',
      advance: { kind: 'event', type: 'item-dialog-opened' },
    },
    {
      id: 'phase-3',
      title: '페이즈 ③ "위치"로 이동',
      body: '다이얼로그 우상단의 프리셋 칩 (1·2·3) 으로 다른 프리셋의 스페이스 칩 그리드를 볼 수 있어요.',
      spotlight: ['item-dialog', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'pick-other',
      title: '다른 프리셋의 스페이스 클릭',
      body: '클릭과 동시에 카드가 그 프리셋·스페이스로 이동돼요.',
      spotlight: ['item-dialog', 'space-header'],
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'wrap',
      title: '맥락이 바뀐 카드는 옮기기',
      body: '업무용으로 만들었다가 사이드 프로젝트로 갈 카드 — cross-preset 이동으로 정리.',
      spotlight: 'preset-toggle',
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
};

export const ADVANCED_QUESTS: Quest[] = [
  advancedFloating,
  advancedNodegroup,
  advancedPreset,
];
