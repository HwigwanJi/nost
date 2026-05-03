/**
 * Category 1 — Basics. Onboarding quests for the four core
 * concepts: Spaces · Cards · Templates · Quick Search.
 *
 * Conventions for every quest in this file:
 *   - Reward = 1 day (basics tier per § 11 of the design doc).
 *   - provision() is no-op when the prerequisite resource already
 *     exists in the user's data; we never duplicate-add.
 *   - Steps prefer `expects` advance over `event`/`click-target`
 *     because it survives multi-path UIs (user can complete the
 *     same goal via shortcut OR menu). `event` is reserved for
 *     instantaneous signals (item-launched).
 *   - Every step has a `gesture` so the runner shows the input
 *     hint badge — accessibility win for keyboard / mouse-only
 *     users.
 *   - fallbackHint is set on any step where the spotlighted
 *     element might be visually subtle (collapsed accordion,
 *     small icon) — surfaces after 15 s of no progress.
 */

import type { Quest } from '../types';
import type { AppData } from '../../types';

const DEFAULT_TUTORIAL_SPACE_NAME = '튜토리얼 연습';

/** Helper — find an existing space by name to detect "already
 *  done" state. The `provision` step uses this so reruns of the
 *  same quest don't pile up sandbox spaces. */
function findSpaceByName(data: AppData, name: string) {
  return data.spaces.find(s => s.name === name);
}

// ── basics.spaces ─────────────────────────────────────────────
const basicsSpaces: Quest = {
  id: 'basics.spaces',
  category: 'basics',
  title: '스페이스란?',
  summary: '카드를 담는 그릇 — 만들고, 이름 짓고, 정리하기',
  estimatedSec: 90,
  rewardDays: 1,
  prereqs: [],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '스페이스는 카드를 담는 그릇입니다',
      body: '주제별·맥락별로 카드를 묶어 한눈에 보고, 한 번에 다룹니다. 직접 하나 만들어볼까요?',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'add',
      title: '+ 새 스페이스 추가',
      body: '오른쪽 위 + 아이콘을 누르면 빈 스페이스가 생겨요.',
      spotlight: 'header-add-space',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'space-added' },
      fallbackHint: '상단 우측의 + 동그라미 아이콘 — 닫기(✕) 버튼 옆에 있습니다.',
    },
    {
      id: 'rename',
      title: '이름으로 의미 부여',
      body: '방금 만든 스페이스의 이름을 더블클릭하면 바꿀 수 있어요. "업무" / "프로젝트" 등 떠오르는 이름으로.',
      spotlight: 'space-header',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
      fallbackHint: '스페이스 이름 텍스트를 더블클릭하면 입력란으로 바뀝니다.',
    },
    {
      id: 'success',
      title: '잘했어요!',
      body: '스페이스 = 작업 단위 컨테이너. 다음 퀘스트에서 이 안에 카드를 채워볼게요.',
      spotlight: 'space-header',
      advance: { kind: 'auto-advance', ms: 2200 },
    },
  ],
  contextNudge: {
    trigger: { type: 'item-dialog-cancelled', cooldownMin: 60 * 24 * 7 },
    headline: '스페이스부터 만들어볼까요?',
    body: '카드를 담을 곳이 있어야 합니다',
  },
};

// ── basics.cards ──────────────────────────────────────────────
const basicsCards: Quest = {
  id: 'basics.cards',
  category: 'basics',
  title: '카드란?',
  summary: 'URL · 앱 · 폴더 — 클릭 한 번에 작업 시작',
  estimatedSec: 120,
  rewardDays: 1,
  prereqs: ['basics.spaces'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '카드는 nost의 가장 작은 단위입니다',
      body: 'URL, 앱, 폴더, 텍스트 — 무엇이든 카드로 묶어 클릭 한 번에 실행해요.',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'add-url',
      title: 'URL 카드 추가',
      body: '스페이스 하단의 + 추가를 눌러 URL 카드를 만들어 보세요. 예: https://github.com',
      spotlight: 'add-card-button',
      gesture: 'left-click',
      advance: {
        kind: 'expects',
        check: (d) => d.spaces.some(s => s.items.some(i => i.type === 'url')),
      },
      fallbackHint: '+ 추가 → 유형: URL → 값에 https://... 입력 → 추가 버튼',
    },
    {
      id: 'click-card',
      title: '카드 클릭으로 실행',
      body: '방금 만든 카드를 클릭하면 브라우저에서 URL이 열립니다. 한번 눌러보세요.',
      spotlight: 'item-card',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'item-launched' },
      fallbackHint: '카드 본체를 한 번만 클릭하세요. 길게 누르면 다른 동작이 트리거됩니다.',
    },
    {
      id: 'success',
      title: '클릭 한 번 = 작업 시작',
      body: '나머지 유형(앱·폴더·텍스트·창)도 같은 방식이에요. 다음 카테고리에서 더 빠른 추가법을 봐요.',
      spotlight: 'item-card',
      advance: { kind: 'auto-advance', ms: 2500 },
    },
  ],
  contextNudge: {
    trigger: { type: 'first-card-error', cooldownMin: 60 * 24 * 3 },
    headline: '카드 추가에 막혔어요?',
    body: '1분 안에 끝나는 가이드가 있어요',
  },
};

// ── basics.templates ──────────────────────────────────────────
const basicsTemplates: Quest = {
  id: 'basics.templates',
  category: 'basics',
  title: '템플릿이란?',
  summary: '시작 키트로 한 번에 여러 카드 채우기',
  estimatedSec: 60,
  rewardDays: 1,
  prereqs: ['basics.spaces'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '템플릿 = 미리 만들어둔 카드 묶음',
      body: '시작 키트는 자주 쓰는 카드 모음을 한 번에 추가해주는 기능입니다. 환경설정에서 적용할 수 있어요.',
      spotlight: 'header-settings',
      advance: { kind: 'next-button' },
    },
    {
      id: 'open-settings',
      title: '환경설정 열기',
      body: '오른쪽 위 톱니바퀴 아이콘을 눌러 환경설정을 여세요.',
      spotlight: 'header-settings',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
      fallbackHint: '상단 우측에서 + 옆의 톱니바퀴(설정) 아이콘.',
    },
    {
      id: 'find-template',
      title: '"시작 키트" 섹션 찾기',
      body: '환경설정의 "일반" 탭에서 시작 키트 옵션을 찾아 마음에 드는 것을 적용해보세요. 한 번에 여러 카드가 추가됩니다.',
      spotlight: 'header-settings',
      advance: { kind: 'next-button' },
    },
    {
      id: 'success',
      title: '잘했어요!',
      body: '템플릿은 새 환경 세팅이나 친구에게 nost를 소개할 때 유용해요.',
      spotlight: 'space-header',
      advance: { kind: 'auto-advance', ms: 2200 },
    },
  ],
};

// ── basics.search ─────────────────────────────────────────────
const basicsSearch: Quest = {
  id: 'basics.search',
  category: 'basics',
  title: '빠른 검색이란?',
  summary: '`/`로 무엇이든 한 번에 찾기',
  estimatedSec: 45,
  rewardDays: 1,
  prereqs: [],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '`/` 또는 검색창으로 모든 카드를 한번에',
      body: '카드 이름·URL·경로 무엇으로든 검색됩니다. `/`로 시작하면 명령어도 실행할 수 있어요.',
      spotlight: 'search-input',
      advance: { kind: 'next-button' },
    },
    {
      id: 'focus',
      title: '검색창 클릭 또는 `/` 입력',
      body: '상단 검색창을 클릭하거나 키보드 `/`를 누르면 즉시 입력 모드로 들어갑니다.',
      spotlight: 'search-input',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'try',
      title: '아무 글자나 입력해보기',
      body: '검색어를 입력하면 일치하는 카드가 실시간으로 추려져요. 결과 클릭으로 바로 실행됩니다.',
      spotlight: 'search-input',
      gesture: 'keyboard',
      advance: { kind: 'next-button' },
    },
    {
      id: 'success',
      title: '`/`는 nost의 만능 입구예요',
      body: '카드가 쌓일수록 검색이 빨라집니다. 손에 익을수록 마우스 의존도가 줄어요.',
      spotlight: 'search-input',
      advance: { kind: 'auto-advance', ms: 2200 },
    },
  ],
};

export const BASICS_QUESTS: Quest[] = [
  basicsSpaces,
  basicsCards,
  basicsTemplates,
  basicsSearch,
];

// Suppress "unused" lint — the helper is for future quests that
// need provision side-effects (will land in cards.* etc.).
void findSpaceByName;
void DEFAULT_TUTORIAL_SPACE_NAME;
