/**
 * Category 3 — Layout. Spatial control over cards & spaces.
 *
 * 카드 이동은 우클릭 드래그 (좌클릭은 카드 실행과 충돌). 사이드바
 * 노드 모드 진입은 `node-mode-button` tour-id로 spotlight.
 */

import type { Quest } from '../types';

const layoutCardmove: Quest = {
  id: 'layout.cardmove',
  category: 'layout',
  title: '카드 이동하기',
  summary: '우클릭으로 카드를 잡아 다른 자리로',
  estimatedSec: 60,
  rewardDays: 3,
  prereqs: ['basics.cards'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '카드 이동 = 우클릭 드래그',
      body: '좌클릭은 카드 실행이라 충돌해요. 그래서 nost는 이동에 우클릭을 사용해요.',
      spotlight: ['item-card', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'try',
      title: '카드 우클릭으로 잡고 끌기',
      body: '카드를 우클릭한 채 끌어 다른 위치로 옮겨보세요. 같은 스페이스 내·다른 스페이스 모두 가능.',
      spotlight: ['item-card', 'space-header'],
      gesture: 'right-click',
      advance: { kind: 'event', type: 'item-moved' },
      fallbackHint: '우클릭 메뉴는 즉시 안 떠요 — 우클릭 누른 상태로 8px 이상 끌면 드래그 모드 진입.',
    },
    {
      id: 'wrap',
      title: '드래그 끝점이 위치를 결정',
      body: '빈 스페이스 위에 놓으면 그 스페이스로 이동, 다른 카드 사이에 놓으면 순서 변경.',
      spotlight: ['item-card', 'space-header'],
      advance: { kind: 'auto-advance', ms: 2200 },
    },
  ],
};

const layoutSpacereorder: Quest = {
  id: 'layout.spacereorder',
  category: 'layout',
  title: '스페이스 순서 바꾸기',
  summary: '스페이스 헤더 좌클릭 드래그로 위·아래 이동',
  estimatedSec: 60,
  rewardDays: 3,
  prereqs: ['basics.spaces'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '스페이스 순서도 바꿀 수 있어요',
      body: '자주 쓰는 스페이스를 상단으로, 가끔 쓰는 건 아래로. 손에 익는 위치로 정리.',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'try',
      title: '스페이스 헤더 잡고 위/아래로',
      body: '스페이스 헤더 (이름·아이콘 칸)를 좌클릭으로 잡고 끌어 옮기세요.',
      spotlight: 'space-header',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'space-reordered' },
      fallbackHint: '헤더 좌측의 그립 영역(::: 점)을 잡으면 더 안정적.',
    },
    {
      id: 'wrap',
      title: '레이아웃은 사용자의 것',
      body: '스페이스가 많아질수록 정리 순서가 작업 속도를 좌우해요.',
      spotlight: 'space-header',
      advance: { kind: 'auto-advance', ms: 2000 },
    },
  ],
};

const layoutTile: Quest = {
  id: 'layout.tile',
  category: 'layout',
  title: '타일링 알아보기',
  summary: '여러 카드를 한 번에 정렬해서 실행',
  estimatedSec: 90,
  rewardDays: 3,
  prereqs: ['basics.cards'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '노드 모드 + 타일링',
      body: '여러 카드를 묶어 한 번에 실행하고, 각 창을 모니터에 자동 정렬할 수 있어요.',
      spotlight: ['node-mode-button', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'sidebar-node',
      title: '왼쪽 사이드바의 노드 모드 진입',
      body: '왼쪽 사이드바의 hub (점 연결) 아이콘을 클릭하면 노드 편집 모드.',
      spotlight: 'node-mode-button',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'node-mode-entered' },
      fallbackHint: '사이드바 두 점이 선으로 이어진 모양 아이콘 — 핀 도구 바로 아래.',
    },
    {
      id: 'pick-cards',
      title: '카드 2~3개를 묶기',
      body: '노드 모드에서 카드를 클릭하면 그룹에 포함, 한 번 더 누르면 빠져요.',
      spotlight: ['item-card', 'space-header'],
      gesture: 'left-click',
      advance: { kind: 'event', type: 'node-added' },
    },
    {
      id: 'launch',
      title: '단축키로 한 번에 실행',
      body: '묶은 노드 그룹은 단축키로 한 번에 실행할 수 있고, 각 창은 자동으로 화면을 분할해 자리잡아요.',
      spotlight: ['node-mode-button', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'wrap',
      title: '회의 루틴 = 한 키',
      body: '"매일 켜는 5개"를 묶어두면 출근 직후 한 키로 정리된 작업환경이 떠요.',
      spotlight: ['node-mode-button', 'space-header'],
      advance: { kind: 'auto-advance', ms: 2200 },
    },
  ],
};

export const LAYOUT_QUESTS: Quest[] = [
  layoutCardmove,
  layoutSpacereorder,
  layoutTile,
];
