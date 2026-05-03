/**
 * Category 5 — Widgets. Active mini-tools that share a card slot.
 *
 * Music widget controls system media keys (no SMTC integration);
 * Color widget holds a hex code with swipe → complementary/
 * analogous; Memo widget hosts the editor + cleanup palette.
 *
 * Quest steps lean on `next-button` for any action that can't be
 * reliably detected (system media key fired in another app, swipe
 * inside a non-droptarget surface). The 가이드 톤이 강한 이유:
 * widgets are by-design subtle, so we err toward explanation +
 * directed practice over hard automation gates.
 */

import type { Quest } from '../types';

const widgetsMusic: Quest = {
  id: 'widgets.music',
  category: 'widgets',
  title: '음악 위젯',
  summary: 'swipe로 트랙 이동, 슬라이더로 볼륨',
  estimatedSec: 60,
  rewardDays: 3,
  prereqs: ['basics.cards'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '음악 위젯 = 시스템 미디어 키를 카드로',
      body: '재생/일시정지·이전/다음 트랙·볼륨 — 모두 한 카드 안에서. 백그라운드의 어떤 음악 앱이든 OS 미디어 키만 받으면 동작해요.',
      spotlight: 'music-widget',
      advance: { kind: 'next-button' },
    },
    {
      id: 'add',
      title: '음악 위젯 추가',
      body: '+ 추가 → 위젯 → 음악. 추가 후 카드 영역에 음악 컨트롤이 나타납니다.',
      spotlight: 'add-card-button',
      gesture: 'left-click',
      advance: {
        kind: 'expects',
        check: (d) => d.spaces.some(s => s.items.some(i => i.widget?.kind === 'media-control')),
      },
      fallbackHint: '+ 추가 다이얼로그의 유형에서 위젯 카테고리를 찾으세요.',
    },
    {
      id: 'play',
      title: '재생/일시정지 — 짧게 클릭',
      body: '위젯 가운데 큰 영역(필)을 짧게 클릭하면 재생/일시정지 토글.',
      spotlight: 'music-widget',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'swipe',
      title: '트랙 이동 — 좌우 swipe',
      body: '필을 잡고 왼쪽으로 끌면 이전 트랙, 오른쪽이면 다음 트랙. 시각적인 잔상이 방향을 알려줘요.',
      spotlight: 'music-widget',
      gesture: 'swipe',
      advance: { kind: 'next-button' },
    },
    {
      id: 'volume',
      title: '볼륨 — 아래쪽 슬라이더',
      body: '슬라이더로 볼륨 조절, 좌측 아이콘 클릭으로 음소거 토글.',
      spotlight: 'music-widget',
      gesture: 'drag',
      advance: { kind: 'next-button' },
    },
    {
      id: 'success',
      title: '한 카드 = 미디어 컨트롤 풀세트',
      body: '음악 앱을 굳이 띄우지 않아도 nost 안에서 끝나요.',
      spotlight: 'music-widget',
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
};

const widgetsColor: Quest = {
  id: 'widgets.color',
  category: 'widgets',
  title: '컬러 코드 위젯',
  summary: '디자인 작업의 팔레트를 카드로',
  estimatedSec: 90,
  rewardDays: 3,
  prereqs: ['cards.clipboard'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '컬러 위젯 = 자주 쓰는 색을 카드로',
      body: '브랜드 색상·자주 쓰는 팔레트를 카드로 두면 swipe로 보색·유사색 복사도 가능해요.',
      spotlight: 'color-widget',
      advance: { kind: 'next-button' },
    },
    {
      id: 'add',
      title: '컬러 위젯 추가',
      body: '+ 추가 → 위젯 → 컬러 또는 #RRGGBB 형식 헥스를 클립보드에 복사 → 게이트웨이의 "컬러 위젯으로" 클릭.',
      spotlight: 'add-card-button',
      gesture: 'left-click',
      advance: {
        kind: 'expects',
        check: (d) => d.spaces.some(s => s.items.some(i => i.widget?.kind === 'color-swatch')),
      },
      fallbackHint: '#1abc9c 같은 헥스 코드를 복사한 뒤 nost로 돌아오면 게이트웨이 배너가 떠요.',
    },
    {
      id: 'tap',
      title: 'Hex 복사 — 짧게 클릭',
      body: '위젯의 색상 영역을 짧게 클릭하면 hex 코드가 클립보드로.',
      spotlight: 'color-widget',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'swipe-actions',
      title: '보색/유사색 — 좌우 swipe',
      body: '왼쪽으로 swipe하면 보색(complementary), 오른쪽이면 유사색(analogous)이 클립보드에 복사돼요. 디자인 작업 때 빠릅니다.',
      spotlight: 'color-widget',
      gesture: 'swipe',
      advance: { kind: 'next-button' },
    },
    {
      id: 'success',
      title: '한 카드 = 색·보색·유사색 셋',
      body: '브랜드 컬러를 컬러 위젯으로 모아두면 디자인 협업 때 즉시 공유 가능해요.',
      spotlight: 'color-widget',
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
};

const widgetsMemo: Quest = {
  id: 'widgets.memo',
  category: 'widgets',
  title: '메모 위젯 + 정리 도구',
  summary: '에디터의 정리 도구 팔레트 활용하기',
  estimatedSec: 90,
  rewardDays: 3,
  prereqs: ['basics.cards'],
  provision: async () => ({}),
  steps: [
    {
      id: 'intro',
      title: '메모는 본문 + 정리 도구 한 세트',
      body: '메모 카드를 만들고, 에디터의 도구 팔레트로 마크다운으로 정리 / 서식 제거 / 빈 줄 합치기 등을 한 번에 처리해요.',
      spotlight: 'space-header',
      advance: { kind: 'next-button' },
    },
    {
      id: 'add',
      title: '빈 메모 카드 추가',
      body: '+ 추가 → 위젯 → 메모. 또는 게이트웨이의 "메모로" 버튼으로 클립보드 텍스트를 메모로.',
      spotlight: 'add-card-button',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'memo-created' },
    },
    {
      id: 'open-editor',
      title: '메모 클릭으로 에디터 열기',
      body: '메모 카드를 클릭하면 풀스크린 에디터가 열려요. 마크다운 작성, 미리보기, 자동 저장이 됩니다.',
      spotlight: 'memo-card',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'cleanup',
      title: '도구 팔레트로 정리',
      body: '에디터 상단의 정리 아이콘에 마우스를 올려 도구를 골라보세요. "마크다운으로 정리"는 paste된 GPT/Notion 본문을 자동 변환합니다.',
      spotlight: 'memo-card',
      gesture: 'left-click',
      advance: { kind: 'next-button' },
    },
    {
      id: 'success',
      title: '메모 = 가벼운 작업 노트',
      body: '7일 TTL이 지나면 자동 만료(보호하면 영구). 휘발성을 활용해 부담 없이 기록하세요.',
      spotlight: 'memo-card',
      advance: { kind: 'auto-advance', ms: 2400 },
    },
  ],
  contextNudge: {
    trigger: { type: 'memo-edit-stuck', cooldownMin: 60 * 24 * 7 },
    headline: '메모 에디터 도구가 궁금하세요?',
    body: '정리 도구 팔레트 사용법 가이드 (3일 적립)',
  },
};

export const WIDGETS_QUESTS: Quest[] = [
  widgetsMusic,
  widgetsColor,
  widgetsMemo,
];
