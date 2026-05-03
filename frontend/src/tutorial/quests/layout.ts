/**
 * Category 3 — Layout. Spatial control over cards & spaces.
 *
 * Card move uses RIGHT-click drag (left-click is reserved for
 * swipe gestures on swipe-aware widgets — see useHorizontalSwipe).
 * The gesture badge in the runner makes this explicit so users
 * don't fight the wrong button.
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
      title: '카드 이동은 우클릭 드래그',
      body: '좌클릭은 카드 실행이라 충돌해요. 그래서 nost는 카드 이동에 우클릭을 씁니다.',
      spotlight: 'item-card',
      advance: { kind: 'next-button' },
    },
    {
      id: 'try',
      title: '카드 우클릭으로 잡고 끌기',
      body: '카드를 우클릭한 채로 끌어 다른 위치로 옮겨보세요. 같은 스페이스 내·다른 스페이스로 모두 가능합니다.',
      spotlight: 'item-card',
      gesture: 'right-click',
      advance: { kind: 'next-button' },
      fallbackHint: '우클릭 메뉴는 즉시 나타나지 않아요 — 우클릭 누른 상태로 8px 이상 끌면 드래그 모드로 진입합니다.',
    },
    {
      id: 'success',
      title: '자유로운 카드 배치',
      body: '드래그 중 빈 스페이스 위에 놓으면 그 스페이스로 이동, 같은 스페이스 안의 다른 카드 사이에 놓으면 순서 변경.',
      spotlight: 'item-card',
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
      title: '스페이스 자체도 순서 바꿀 수 있어요',
      body: '자주 쓰는 스페이스를 상단으로, 가끔 쓰는 건 아래로. 손에 익는 위치로 정리하세요.',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'try',
      title: '스페이스 헤더를 잡고 위로/아래로',
      body: '스페이스 헤더 영역(이름·아이콘 표시되는 칸)을 좌클릭으로 잡고 끌어 옮기세요.',
      spotlight: 'space-header',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
      fallbackHint: '헤더 좌측의 그립 영역(::: 점)을 잡으면 드래그 모드 진입이 더 안정적입니다.',
    },
    {
      id: 'success',
      title: '레이아웃은 사용자의 것',
      body: '스페이스가 많아질수록 정리 순서가 작업 속도를 좌우합니다.',
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
      body: '여러 카드를 묶어서 한 번에 실행하고, 각 창을 모니터에 자동 정렬할 수 있어요.',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'sidebar-node',
      title: '왼쪽 사이드바의 노드 모드 진입',
      body: '왼쪽 사이드바에서 노드 도구를 활성화하면 카드를 묶어 노드 그룹을 만들 수 있어요.',
      spotlight: 'space-header',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
      fallbackHint: '사이드바의 노드(연결) 아이콘 — 두 점이 선으로 이어진 모양.',
    },
    {
      id: 'pick-cards',
      title: '카드 2~3개를 묶기',
      body: '노드 모드에서 카드를 클릭하면 그룹에 포함됩니다. 한 번 더 누르면 빠지고요.',
      spotlight: 'item-card',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'launch',
      title: '단축키로 한 번에 실행',
      body: '묶은 노드 그룹은 단축키로 한 번에 실행할 수 있고, 각 창은 자동으로 화면을 분할해 자리잡습니다.',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'success',
      title: '회의 루틴 = 한 키',
      body: '"매일 켜는 5개"를 묶어두면 출근 직후 한 번에 정리된 작업환경이 떠요.',
      spotlight: 'space-header',
      advance: { kind: 'auto-advance', ms: 2200 },
    },
  ],
};

export const LAYOUT_QUESTS: Quest[] = [
  layoutCardmove,
  layoutSpacereorder,
  layoutTile,
];
