/**
 * Category 4 — Advanced. Power features beyond the basic
 * launch-and-organize loop.
 *
 * `advanced.preset` carries `requiresEntitlement: 'pro'`. Free
 * users see the lock chrome on the AccordionPanel card; the
 * runner doesn't start the quest. (Sprint 1 infrastructure
 * BETA-forces every user to pro, so this gates against future
 * billing-on state.)
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
      title: '플로팅 뱃지 = 화면에 상주하는 단축',
      body: '자주 쓰는 카드를 nost 창 밖으로 꺼내 화면 어디든 떠있게 둘 수 있어요. nost 창을 열지 않아도 클릭으로 즉시 실행됩니다.',
      spotlight: 'item-card',
      advance: { kind: 'next-button' },
    },
    {
      id: 'try',
      title: '카드 우클릭 → 플로팅으로',
      body: '아무 카드 위에서 우클릭하면 메뉴가 나와요. "플로팅으로" 또는 비슷한 옵션을 선택하세요.',
      spotlight: 'item-card',
      gesture: 'right-click',
      advance: { kind: 'next-button' },
      fallbackHint: '카드 우클릭 → 컨텍스트 메뉴 → "플로팅" 항목.',
    },
    {
      id: 'observe',
      title: '바탕화면을 확인',
      body: 'nost 창 밖, 모니터 어디에든 작은 뱃지가 떠 있어요. 클릭하면 카드 동작이 실행됩니다.',
      spotlight: 'item-card',
      advance: { kind: 'next-button' },
    },
    {
      id: 'success',
      title: '필요할 때만 nost를 열어요',
      body: '플로팅 뱃지로 충분한 단축은 굳이 nost 창을 띄우지 않아도 됩니다. 우클릭 → 풀어내기로 다시 카드로.',
      spotlight: 'item-card',
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
      title: '노드 그룹은 멀티-실행의 핵심',
      body: '"매일 켜는 5개" 같은 워크플로우를 묶어두면 한 키로 정리된 작업환경이 떠요. 타일링과 결합하면 모니터 자동 분할까지.',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'enter-mode',
      title: '노드 모드 진입',
      body: '왼쪽 사이드바의 노드 도구 버튼을 클릭해 활성화하세요.',
      spotlight: 'space-header',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'select',
      title: '카드 클릭으로 그룹 멤버 추가',
      body: '카드를 클릭하면 그룹에 들어가요. 한 번 더 누르면 빠지고요. 같은 스페이스에 있을 필요 없습니다 — 여러 스페이스의 카드를 섞어 묶을 수 있어요.',
      spotlight: 'item-card',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'launch',
      title: '단축키로 실행',
      body: '그룹에 단축키를 할당하거나 사이드바의 그룹 패널에서 실행 버튼을 눌러보세요. 묶인 카드들이 동시에 실행됩니다.',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'success',
      title: '워크플로우 = 한 번의 키',
      body: '아침 루틴, 회의 시작, 코딩 세션 시작 — 모두 한 키로. 카드를 묶을수록 nost가 손에 익습니다.',
      spotlight: 'space-header',
      advance: { kind: 'auto-advance', ms: 2500 },
    },
  ],
};

const advancedPreset: Quest = {
  id: 'advanced.preset',
  category: 'advanced',
  title: '프리셋 전환',
  summary: '업무·개인·프로젝트 — 통째로 다른 작업환경',
  estimatedSec: 90,
  rewardDays: 3,
  prereqs: ['basics.spaces'],
  requiresEntitlement: 'pro',
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '프리셋은 완전히 독립된 작업 공간',
      body: '프리셋 1·2·3을 토글하면 보이는 스페이스가 통째로 바뀝니다. 업무용·개인용·사이드 프로젝트별로 분리하세요.',
      spotlight: 'preset-toggle',
      advance: { kind: 'next-button' },
    },
    {
      id: 'switch',
      title: '프리셋 2 클릭',
      body: '상단 좌측의 프리셋 토글에서 "2"를 클릭하면 빈 작업공간이 보일 거예요 (아직 카드 없음).',
      spotlight: 'preset-toggle',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'add-here',
      title: '프리셋 2에 카드 만들기',
      body: '여기서 만든 카드는 프리셋 1에 영향을 주지 않아요. 완전히 독립된 환경입니다.',
      spotlight: 'add-card-button',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'switch-back',
      title: '프리셋 1로 돌아가기',
      body: '프리셋 1을 다시 누르면 원래 작업환경이 돌아옵니다. 프리셋 2의 카드는 그대로 보존돼요.',
      spotlight: 'preset-toggle',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'success',
      title: '맥락 분리 = 집중력',
      body: '맥락이 섞이면 머리가 피로해집니다. 프리셋으로 한 번에 한 맥락만 보세요.',
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
