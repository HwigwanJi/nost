/**
 * Category 2 — Card Mastery. The five paths to add a card.
 *
 * Reward = 3 days each. spotlight 정합성 원칙:
 *   - 사용자가 클립보드에서 복사하는 단계는 외부 동작이라 spotlight를
 *     `gateway-banner` (배너가 떴을 때) 또는 fallback `space-header`로.
 *   - 게이트웨이 배너 spotlight는 배너가 마운트되기 전엔 fallback에
 *     떨어지므로 array selector로 `['gateway-banner', 'space-header']`.
 *   - 본문에서 어떤 버튼을 가리킨다면 spotlight도 그 버튼.
 */

import type { Quest } from '../types';
import type { AppData } from '../../types';

// ── cards.scan ────────────────────────────────────────────────
const cardsScan: Quest = {
  id: 'cards.scan',
  category: 'cards',
  title: '스마트 스캔',
  summary: '지금 열려있는 앱·폴더·탭을 한 번에 카드로',
  estimatedSec: 90,
  rewardDays: 3,
  prereqs: ['basics.cards'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '직접 입력 없이 카드 만들기',
      body: '지금 열려있는 앱·폴더·브라우저 탭을 스캔해서 추천 카드로 보여줍니다.',
      spotlight: 'recommend-button',
      advance: { kind: 'next-button' },
    },
    {
      id: 'open-panel',
      title: '💡 추천 패널 열기',
      body: '왼쪽 사이드바의 전구 아이콘을 클릭하면 화면 상단에 스캔 결과가 펼쳐집니다.',
      spotlight: 'recommend-button',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'recommend-panel-opened' },
      fallbackHint: '왼쪽 사이드바 — 청소 도구 아래의 전구 아이콘.',
    },
    {
      id: 'pick',
      title: '추천 카드 1개 클릭',
      body: '패널 안의 카드 하나를 클릭하면 스페이스 선택 → 추가까지 두 번 클릭으로 끝납니다.',
      spotlight: ['recommend-panel', 'recommend-button'],
      advance: {
        kind: 'expects',
        check: (() => {
          let initial = -1;
          return (d: AppData) => {
            const count = d.spaces.reduce((sum, s) => sum + s.items.length, 0);
            if (initial === -1) { initial = count; return false; }
            return count > initial;
          };
        })(),
      },
      fallbackHint: '추천 패널 안의 아무 카드 하나만 클릭하면 됩니다.',
    },
    {
      id: 'wrap',
      title: '직접 입력 0번으로 카드 추가',
      body: '평소 자주 쓰는 워크플로우라면 시작할 때마다 한 번씩 패널 열어보세요.',
      spotlight: 'recommend-button',
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
  contextNudge: {
    trigger: { type: 'recommend-panel-opened', cooldownMin: 60 * 24 * 14 },
    headline: '스마트 스캔 처음이세요?',
    body: '추천 카드 빠른 추가 가이드 (3일 적립)',
  },
};

// ── cards.clipboard ───────────────────────────────────────────
const cardsClipboard: Quest = {
  id: 'cards.clipboard',
  category: 'cards',
  title: '클립보드로 빠른 추가',
  summary: '복사만 하면 게이트웨이가 권유',
  estimatedSec: 120,
  rewardDays: 3,
  prereqs: ['basics.cards'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '복사하면 nost가 권유합니다',
      body: 'URL · 경로 · 헥스 컬러 · 텍스트 — 무엇이든 복사하면 상단에 작은 알림이 떠요.',
      spotlight: ['gateway-banner', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'copy-url',
      title: '아무 URL이나 복사해보기',
      body: '브라우저 주소창의 URL을 복사하고 nost로 돌아오면 게이트웨이 배너가 뜹니다.',
      spotlight: ['gateway-banner', 'space-header'],
      gesture: 'keyboard',
      shortcut: ['Ctrl', 'C'],
      advance: { kind: 'next-button' },
      fallbackHint: 'nost를 잠깐 숨기고 (Esc) 브라우저에서 https://... URL 복사 → 다시 nost.',
    },
    {
      id: 'commit',
      title: '"URL 카드로" 버튼 누르기',
      body: '게이트웨이 배너의 액션 버튼을 누르면 카드 다이얼로그가 자동 채움 상태로 열려요.',
      spotlight: ['gateway-banner', 'space-header'],
      gesture: 'left-click',
      advance: {
        kind: 'expects',
        check: (() => {
          let initial = -1;
          return (d: AppData) => {
            const count = d.spaces.reduce((sum, s) => sum + s.items.length, 0);
            if (initial === -1) { initial = count; return false; }
            return count > initial;
          };
        })(),
      },
      fallbackHint: '배너 우측의 "URL 카드로" 버튼 → 다이얼로그 열림 → 추가/저장.',
    },
    {
      id: 'wrap',
      title: '복사 → 한 번 클릭 → 끝',
      body: '폴더 경로 · 앱 경로 · 헥스 컬러도 같은 흐름이에요. 텍스트는 메모로 저장하는 옵션도 함께 떠요.',
      spotlight: ['gateway-banner', 'space-header'],
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
  contextNudge: {
    trigger: { type: 'gateway-banner-dismissed', cooldownMin: 60 * 24 * 7 },
    headline: '클립보드 추가 더 알아볼래요?',
    body: '게이트웨이 배너 사용법 (3일 적립)',
  },
};

// ── cards.memo ────────────────────────────────────────────────
const cardsMemo: Quest = {
  id: 'cards.memo',
  category: 'cards',
  title: '메모도 카드처럼',
  summary: 'GPT/Notion 답변을 메모로 — 마크다운 자동 복원',
  estimatedSec: 120,
  rewardDays: 3,
  prereqs: ['cards.clipboard'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '긴 텍스트는 메모가 맞아요',
      body: 'ChatGPT/Notion에서 답변을 복사하면 게이트웨이의 "메모로" 버튼이 마크다운 구조까지 복원해줘요.',
      spotlight: ['gateway-banner', 'space-header'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'copy',
      title: 'GPT나 Notion 답변 복사',
      body: '제목·목록·굵기가 있는 답변일수록 효과가 큽니다. 일반 텍스트도 동작.',
      spotlight: ['gateway-banner', 'space-header'],
      gesture: 'keyboard',
      shortcut: ['Ctrl', 'C'],
      advance: { kind: 'next-button' },
      fallbackHint: 'AI 챗 답변, Notion 페이지 본문 — 어디든 OK.',
    },
    {
      id: 'memo-action',
      title: '"메모로" 버튼 누르기',
      body: '배너에 두 액션이 떠요. "메모로"를 누르면 메모 카드가 즉시 생성되고 마크다운으로 정리돼요.',
      spotlight: ['gateway-banner', 'space-header'],
      gesture: 'left-click',
      advance: { kind: 'event', type: 'memo-created' },
      fallbackHint: '배너 두 번째 (액센트 색) 버튼 — sticky_note_2 아이콘.',
    },
    {
      id: 'wrap',
      title: '복붙 한 번 = 정리된 메모',
      body: '메모 카드를 클릭하면 에디터가 열려요. 정리 도구 팔레트로 추가 가공도 가능.',
      spotlight: ['memo-card', 'space-header'],
      advance: { kind: 'auto-advance', ms: 2600 },
    },
  ],
};

// ── cards.dragdrop ────────────────────────────────────────────
const cardsDragdrop: Quest = {
  id: 'cards.dragdrop',
  category: 'cards',
  title: '드래그 앤 드롭',
  summary: 'Explorer에서 파일을 끌어다 놓기',
  estimatedSec: 60,
  rewardDays: 3,
  prereqs: ['basics.cards'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: 'Explorer에서 직접 드래그',
      body: '파일 · 폴더 · 인터넷 바로가기를 nost 위로 끌어다 놓으면 카드 다이얼로그가 자동 채움으로 열려요.',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'try',
      title: '파일 1개를 스페이스 위로 드래그',
      body: 'Windows Explorer에서 파일을 끌어 nost의 스페이스 영역에 놓으세요. 스페이스 테두리가 액센트로 변하면 놓아도 됩니다.',
      spotlight: 'space-header',
      gesture: 'drag',
      advance: {
        kind: 'expects',
        check: (() => {
          let initial = -1;
          return (d: AppData) => {
            const count = d.spaces.reduce((sum, s) => sum + s.items.length, 0);
            if (initial === -1) { initial = count; return false; }
            return count > initial;
          };
        })(),
      },
      fallbackHint: '여러 파일은 일괄 추가 다이얼로그, 한 개는 단일 카드 다이얼로그.',
    },
    {
      id: 'wrap',
      title: '브라우저 링크도 같은 방식',
      body: '브라우저 주소창의 자물쇠 아이콘 옆을 잡아 끌어와도 URL 카드가 됩니다.',
      spotlight: 'space-header',
      advance: { kind: 'auto-advance', ms: 2200 },
    },
  ],
};

// ── cards.dialog ──────────────────────────────────────────────
const cardsDialog: Quest = {
  id: 'cards.dialog',
  category: 'cards',
  title: '카드 다이얼로그 깊게',
  summary: '3-페이즈 흐름 + 화면에서 직접 고르기',
  estimatedSec: 150,
  rewardDays: 3,
  prereqs: ['basics.cards'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '카드 다이얼로그는 3단계 흐름',
      body: '유형 → 값·이름 → 위치. 좌우 화살표나 드래그로 단계 이동, ⌘/Ctrl+Enter로 어느 단계에서나 즉시 저장.',
      spotlight: 'add-card-button',
      advance: { kind: 'next-button' },
    },
    {
      id: 'open',
      title: '+ 추가 클릭으로 다이얼로그 열기',
      body: '아무 스페이스 하단의 + 추가를 누르면 페이즈 ① 유형 선택부터 시작해요.',
      spotlight: 'add-card-button',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'item-dialog-opened' },
    },
    {
      id: 'phase-flow',
      title: '페이즈 진행 체험',
      body: '유형 카드 클릭 → 값 입력 → 위치 선택. 페이즈마다 다음으로 진행하거나, 어느 페이즈에서나 즉시 저장.',
      spotlight: ['item-dialog', 'add-card-button'],
      shortcut: ['Ctrl', 'Enter'],
      shortcutAsHint: true,
      advance: { kind: 'next-button' },
    },
    {
      id: 'screen-pick',
      title: '"🎯 화면에서 고르기" 옵션',
      body: '페이즈 ③ 우하단의 화면 픽 모드를 활용하면, 다이얼로그가 잠시 사라지고 메인 화면의 스페이스를 직접 클릭해서 카드를 둘 수 있어요.',
      spotlight: ['item-dialog', 'add-card-button'],
      advance: { kind: 'next-button' },
    },
    {
      id: 'wrap',
      title: '평소엔 1~2번 클릭이면 끝',
      body: '클립보드 자동감지 + 페이즈 자동 점프 덕분에 손이 덜 가요.',
      spotlight: 'add-card-button',
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
};

export const CARDS_QUESTS: Quest[] = [
  cardsScan,
  cardsClipboard,
  cardsMemo,
  cardsDragdrop,
  cardsDialog,
];
