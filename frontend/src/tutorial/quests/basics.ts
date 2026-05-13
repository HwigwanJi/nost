/**
 * Category 1 — Basics. Onboarding quests for the four core
 * concepts: Spaces · Cards · Presets · Quick Search.
 *
 * Conventions:
 *   - Reward = 1 day per quest (basics tier).
 *   - Tone: `~해요` 톤으로 통일 (basics는 가벼운 인사말).
 *   - 본문은 1~2 문장, 평균 80자 이하. 과도한 친절·메타포·칭찬조 금지
 *     (plans/tutorial-writing-style.md § 1).
 *   - spotlight는 본문이 가리키는 요소와 일치 (§ 5.2). 동적 요소면
 *     배열 fallback으로 안전망.
 *   - "잘했어요" 류 칭찬 마무리 대신 다음 액션 또는 결과 요약.
 *
 * NOTE: 기존 `basics.templates` 였던 자리는 이번 polish에서
 * `basics.presets`로 재정의. 사용자의 원래 의도("템플릿 = 1·2·3
 * Tab 토글")가 시작 키트가 아닌 프리셋 토글이었음. advanced.preset
 * 은 cross-preset 카드 이동 같은 심화 동작으로 별도 유지.
 */

import type { Quest } from '../types';

// ── basics.spaces ─────────────────────────────────────────────
const basicsSpaces: Quest = {
  id: 'basics.spaces',
  category: 'basics',
  title: '스페이스란?',
  summary: '카드를 모으는 단위 — 만들고, 이름 짓고, 정리',
  estimatedSec: 90,
  rewardDays: 1,
  prereqs: [],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '스페이스 = 카드 묶음 단위',
      body: '주제·맥락별로 카드를 묶어서 한 화면에 보여주는 단위입니다. 직접 하나 추가해봐요.',
      spotlight: ['header-add-space', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'add',
      title: '+ 새 스페이스 누르기',
      body: '오른쪽 위 + 아이콘을 누르면 빈 스페이스가 생겨요.',
      spotlight: 'header-add-space',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'space-added' },
      fallbackHint: '상단 우측 — 닫기(✕) 옆의 + 동그라미 아이콘.',
    },
    {
      id: 'rename',
      title: '이름 더블클릭으로 바꾸기',
      body: '방금 만든 스페이스의 이름을 더블클릭하면 입력란으로 바뀌어요. "업무" / "프로젝트" 같은 이름 추천.',
      spotlight: 'space-header',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'space-renamed' },
      fallbackHint: '스페이스 헤더 내의 이름 텍스트만 더블클릭. 아이콘이나 빈 영역은 동작 안 해요.',
    },
    {
      id: 'wrap',
      title: '다음은 카드 채우기',
      body: '이름 붙인 스페이스 안에 카드가 들어갑니다. "카드란?" 퀘스트로 이어가봐요.',
      spotlight: ['add-card-button', 'space-header'],
      advance: { kind: 'auto-advance', ms: 2200 },
    },
  ],
  contextNudge: {
    trigger: { type: 'item-dialog-cancelled', cooldownMin: 60 * 24 * 7 },
    headline: '스페이스부터 만들어볼까요?',
    body: '카드를 둘 곳이 먼저 필요해요',
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
      title: '카드 = nost의 기본 단위',
      body: 'URL · 앱 · 폴더 · 텍스트를 카드로 만들어 한 번 클릭에 실행해요. 직접 하나 추가해봐요.',
      spotlight: ['add-card-button', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'add-url',
      title: '+ 추가 → URL 카드',
      body: '아무 스페이스 하단의 + 추가를 누르고 URL 유형으로 추가해보세요. 예: https://github.com',
      spotlight: 'add-card-button',
      gesture: 'left-click',
      advance: {
        kind: 'expects',
        check: (d) => d.spaces.some(s => s.items.some(i => i.type === 'url')),
      },
      fallbackHint: '+ 추가 → 유형: URL → 값에 https://... → 추가.',
    },
    {
      id: 'click-card',
      title: '카드 클릭하면 실행',
      body: '방금 만든 URL 카드를 한 번 클릭하면 브라우저에서 열려요.',
      spotlight: ['item-card', 'space-header'],
      gesture: 'left-click',
      advance: { kind: 'event', type: 'item-launched' },
      fallbackHint: '카드 본체를 짧게 한 번만 클릭. 길게 누르면 다른 동작이 트리거돼요.',
    },
    {
      id: 'wrap',
      title: '다른 유형도 같은 흐름',
      body: '앱 · 폴더 · 텍스트 · 창 모두 같은 방식으로 추가하고 클릭해요. 다음 카테고리에서 더 빠른 추가법.',
      spotlight: 'item-card',
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
  contextNudge: {
    trigger: { type: 'first-card-error', cooldownMin: 60 * 24 * 3 },
    headline: '카드 추가가 막혀요?',
    body: '1분짜리 가이드',
  },
};

// ── basics.presets (재정의: 1·2·3 Tab 토글) ────────────────────
const basicsPresets: Quest = {
  id: 'basics.presets',
  category: 'basics',
  title: '프리셋이란?',
  summary: '1·2·3 토글 — 통째로 다른 작업환경',
  estimatedSec: 75,
  rewardDays: 1,
  prereqs: ['basics.spaces'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '프리셋 = 독립된 작업환경 3벌',
      body: '상단 좌측의 1·2·3 토글로 보이는 스페이스가 통째로 바뀌어요. 업무·개인·사이드 분리 용도.',
      spotlight: 'preset-toggle',
      advance: { kind: 'next-button' },
    },
    {
      id: 'switch-2',
      title: '프리셋 전환 — Tab 또는 1·2·3',
      body: 'Tab을 한 번 누르거나 상단 토글의 다른 숫자를 클릭. 빈 작업공간이 보여요 — 1번 카드는 안 보이고, 2번만의 카드를 따로 채울 수 있어요.',
      spotlight: 'preset-toggle',
      gesture: 'keyboard',
      shortcut: ['Tab'],
      advance: { kind: 'event', type: 'preset-switched' },
    },
    {
      id: 'switch-back',
      title: '다시 1번으로',
      body: 'Tab을 한 번 더 (또는 "1" 클릭). 원래 작업환경 그대로 돌아와요. 2번에 두고 온 카드도 그대로 보존돼 있어요.',
      spotlight: 'preset-toggle',
      gesture: 'keyboard',
      shortcut: ['Tab'],
      advance: { kind: 'event', type: 'preset-switched' },
    },
    {
      id: 'wrap',
      title: '맥락 분리 = 집중력',
      body: '한 화면에 한 맥락만 두면 머리가 덜 피로해요. 프리셋을 자주 활용해보세요.',
      spotlight: 'preset-toggle',
      advance: { kind: 'auto-advance', ms: 2200 },
    },
  ],
};

// ── basics.search ─────────────────────────────────────────────
const basicsSearch: Quest = {
  id: 'basics.search',
  category: 'basics',
  title: '빠른 검색이란?',
  summary: '`/`로 모든 카드 즉시 찾기',
  estimatedSec: 45,
  rewardDays: 1,
  prereqs: [],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '`/` 또는 검색창으로 즉시 호출',
      body: '카드 이름·URL·경로 무엇으로든 검색돼요. `/`로 시작하면 명령어 실행도 가능.',
      spotlight: 'search-input',
      advance: { kind: 'next-button' },
    },
    {
      id: 'focus',
      title: '검색창 호출 — `/` 또는 클릭',
      body: '키보드 `/`를 누르거나 상단 검색창을 클릭하면 즉시 입력 모드.',
      spotlight: 'search-input',
      gesture: 'keyboard',
      shortcut: ['/'],
      advance: { kind: 'event', type: 'search-focused' },
    },
    {
      id: 'try',
      title: '글자 입력해서 결과 확인',
      body: '검색어를 입력하면 일치하는 카드가 실시간으로 추려져요. 결과 클릭으로 바로 실행.',
      spotlight: 'search-input',
      gesture: 'keyboard',
      advance: { kind: 'next-button' },
    },
    {
      id: 'wrap',
      title: '카드 많을수록 검색이 빨라요',
      body: '`/`는 nost의 만능 입구. 손에 익을수록 마우스 의존도가 줄어들어요.',
      spotlight: 'search-input',
      advance: { kind: 'auto-advance', ms: 2000 },
    },
  ],
};

export const BASICS_QUESTS: Quest[] = [
  basicsSpaces,
  basicsCards,
  basicsPresets,
  basicsSearch,
];
