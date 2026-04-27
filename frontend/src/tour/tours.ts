/**
 * Tour definitions live as pure data. Adding a new tour = push an entry into
 * the TOURS array and annotate target DOM nodes with matching `data-tour-id`.
 * The runtime (TourOverlay) interprets this data — there is no per-tour
 * component, so adding a tour costs ~30 lines of JSON-like description and
 * zero React code.
 */

import type { AppData } from '../types';

export interface TourStep {
  /** Unique within the tour. */
  id: string;
  /**
   * Element to spotlight. Prefer `data-tour-id` attributes on UI components
   * — they survive refactors better than CSS paths. When both are set,
   * `dataTourId` wins.
   */
  dataTourId?: string;
  selector?: string;
  title: string;
  body: string;
  /** Where to anchor the popover relative to the target. Default: auto. */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  /**
   * How the user advances.
   *   - 'target-click' : listen for a click on the spotlighted element
   *   - 'next-button'  : show a 다음 button (default)
   *   - 'condition'    : poll `condition()` and auto-advance when true
   *   - 'expects'      : poll `expects(data)` against the live AppData and
   *                      auto-advance when it returns true. This is the
   *                      sandbox-friendly variant — the tour overlay reads
   *                      whatever the user is actually doing in the
   *                      tutorial preset and advances on real progress.
   */
  advanceOn?: 'target-click' | 'next-button' | 'condition' | 'expects';
  /** For advanceOn='condition'. Polled every 400ms. */
  condition?: () => boolean;
  /**
   * For advanceOn='expects'. Pure predicate over the live AppData. Must
   * stay synchronous and side-effect-free — the overlay polls it on every
   * data update, plus a 600ms timer as a fallback for non-React state
   * changes (e.g. floating badge drag persisted via IPC, which doesn't
   * trigger a re-render until main pushes back).
   */
  expects?: (data: AppData) => boolean;
  /**
   * Short call-to-action shown next to the 다음 button when `expects` is
   * set, so the user knows the tour is waiting on them. e.g. "직접 추가해
   * 보세요". Falls back to no extra label if absent.
   */
  hint?: string;
  /** When the step ends (either advanced or aborted). */
  onLeave?: () => void;
  /**
   * Optional — show nothing and auto-advance after N ms. Handy for a brief
   * "success" beat between two real steps.
   */
  autoAdvanceMs?: number;
}

export interface Tour {
  id: string;
  title: string;
  summary: string;
  steps: TourStep[];
  /**
   * When true, the tour runs inside the tutorial sandbox: App.tsx swaps
   * AppData with seed content before the spotlight starts and offers a
   * keep/discard modal on exit. Tours without `interactive` are pure text
   * walkthroughs over the user's real data — no swap, no banner.
   */
  interactive?: boolean;
}

// ── Tour: Basics — 첫 실행용 ────────────────────────────────
//
// Order matters: this tour goes FIRST in TOURS so the WelcomeWizard's
// default "투어 보기" picks it up. Earlier the default was the presets
// tour, which told free users to click preset 2 — but that's a paywalled
// action, so the paywall modal would pop, our busy-abort logic would
// kill the tour, and the user got a confusing crash mid-onboarding.
//
// All steps here use `next-button` advance only. We never tell the user
// to click something that might trigger a modal: clicking would advance
// the tour, the modal's busy mark would then trip the abort effect, and
// the spotlight would vanish before the user finishes reading. Free
// guidance > forced interaction.
const basicsTour: Tour = {
  id: 'basics',
  title: '기본 사용법',
  summary: '직접 카드를 만들고 실행해보는 60초 가이드',
  interactive: true,
  steps: [
    {
      id: 'intro',
      dataTourId: 'space-list',
      title: '튜토리얼 모드입니다',
      body: '지금부터 가짜 데이터로 nost를 직접 만져 봅니다. 여기서 만든 건 저장되지 않으니 마음껏 눌러보세요. 실제 데이터는 자동으로 백업됐습니다.',
      placement: 'right',
      advanceOn: 'next-button',
    },
    {
      id: 'add',
      dataTourId: 'add-card-button',
      title: '+ 추가를 눌러 첫 카드 만들기',
      body: '스페이스 하단의 "+ 추가"를 누르면 마법사가 열립니다. URL이나 앱 경로를 입력하고 저장해 보세요. 카드를 하나 만들면 자동으로 다음 단계로 갑니다.',
      placement: 'top',
      advanceOn: 'expects',
      // Wait until the user actually creates a card in the sandbox space.
      expects: (data) => (data.spaces[0]?.items?.length ?? 0) >= 1,
      hint: '카드 1개를 만들면 자동 진행',
    },
    {
      id: 'celebrate',
      dataTourId: 'space-list',
      title: '잘했어요',
      body: '방금 만든 카드를 클릭하면 실제로 실행됩니다 (URL은 브라우저, 앱은 그 앱). 우클릭으로 편집·삭제·핀 메뉴를 열 수 있어요.',
      placement: 'right',
      advanceOn: 'next-button',
      autoAdvanceMs: undefined,
    },
    {
      id: 'search',
      dataTourId: 'search-input',
      title: '검색으로 빠르게 찾기',
      body: '검색창에 카드 이름의 한두 글자만 입력해 보세요. 매칭되는 카드가 하이라이트되고 Enter로 실행됩니다. 오타도 어느 정도 잡아내요.',
      placement: 'bottom',
      advanceOn: 'expects',
      // The `data` arg goes unused — search query lives in component state,
      // not AppData. We cheat and read the input's DOM value directly. The
      // tour overlay still polls this on every data change AND on a 600ms
      // timer, so even a non-React typing path advances the step.
      expects: (_data: AppData) => {
        const el = document.querySelector<HTMLInputElement>(
          '[data-tour-id="search-input"] input, input[data-tour-id="search-input"]',
        );
        return !!el && (el.value ?? '').trim().length >= 1;
      },
      hint: '한 글자만 입력해도 진행',
    },
    {
      id: 'more',
      dataTourId: 'search-input',
      title: '/?로 더 알아보기',
      body: '검색창에 /? 를 입력하면 쓸 수 있는 모든 명령이 정리돼서 나옵니다. 다른 튜토리얼은 설정 → 일반에서 다시 볼 수 있어요.',
      placement: 'bottom',
      advanceOn: 'next-button',
    },
  ],
};

// ── Tour: Presets 소개 ─────────────────────────────────────
const presetsTour: Tour = {
  id: 'presets',
  title: '프리셋',
  summary: '한 앱 안에 3개의 독립 작업 공간을 두는 법',
  steps: [
    {
      id: 'intro',
      dataTourId: 'preset-toggle',
      title: '프리셋 1 / 2 / 3',
      body: '완전히 별개인 카드·노드·덱 구성을 3개까지 저장할 수 있어요. "업무"와 "개인"을 분리하거나, 평소 구성과 프로젝트용 구성을 나눠 쓸 수 있습니다.',
      placement: 'bottom',
      advanceOn: 'next-button',
    },
    {
      id: 'switch',
      dataTourId: 'preset-toggle',
      title: '전환 방법',
      body: '숫자를 클릭하면 그 프리셋으로 전환됩니다. 무료 플랜에서는 1번만 사용 가능하고, 2·3번은 Pro 전용이에요. 지금은 둘러만 보세요 — 클릭하면 결제 안내가 뜹니다.',
      placement: 'bottom',
      // Was 'target-click' before — but on free tier, clicking 2/3 fires
      // the paywall, which interrupts the tour. Walk through with the
      // Next button instead and just describe what would happen.
      advanceOn: 'next-button',
    },
    {
      id: 'rename',
      dataTourId: 'preset-toggle',
      title: '이름 바꾸기',
      body: '프리셋 숫자를 더블클릭하면 이름을 지을 수 있습니다. 예: "1" → "업무".',
      placement: 'bottom',
      advanceOn: 'next-button',
    },
    {
      id: 'shortcut',
      dataTourId: 'search-input',
      title: '단축 전환',
      body: '검색창에 /1, /2, /3 을 입력하면 빠르게 전환됩니다. 열어두지 않은 상태에서도 동작해요.',
      placement: 'bottom',
      advanceOn: 'next-button',
    },
  ],
};

// ── Tour: Slash commands 소개 ──────────────────────────────
const slashTour: Tour = {
  id: 'slash',
  title: '슬래시 명령',
  summary: '검색창에서 쓸 수 있는 명령어 맛보기',
  steps: [
    {
      id: 'search',
      dataTourId: 'search-input',
      title: '검색창 = 명령창',
      body: '검색창에 텍스트를 치면 실시간 검색, / 로 시작하면 명령 모드로 바뀝니다.',
      placement: 'bottom',
      advanceOn: 'next-button',
    },
    {
      id: 'slash-preset',
      dataTourId: 'search-input',
      title: '/1 /2 /3',
      body: '프리셋 전환. Enter만 치면 바로 적용됩니다.',
      placement: 'bottom',
      advanceOn: 'next-button',
    },
    {
      id: 'slash-help',
      dataTourId: 'search-input',
      title: '/? 로 전체 목록 보기',
      body: '언제든 /? 를 입력하면 모든 명령어가 정리된 도움말이 뜹니다.',
      placement: 'bottom',
      advanceOn: 'next-button',
    },
  ],
};

// ── Tour: 플로팅 뱃지 ─────────────────────────────────────
const floatingTour: Tour = {
  id: 'floating',
  title: '플로팅 뱃지',
  summary: '자주 쓰는 스페이스를 항상-위 뱃지로 꺼내놓기',
  steps: [
    {
      id: 'what',
      dataTourId: 'space-list',
      title: '스페이스 헤더의 ↗ 아이콘',
      body: '스페이스 헤더에 마우스를 올리면 나오는 ↗ 버튼을 누르면 화면 위를 떠다니는 원형 뱃지로 분리됩니다.',
      placement: 'right',
      advanceOn: 'next-button',
    },
    {
      id: 'click',
      dataTourId: 'space-list',
      title: '뱃지 클릭 → 미니 윈도우',
      body: '뱃지를 클릭하면 그 스페이스의 카드들만 담긴 작은 창이 열립니다. 메인 창 없이도 바로 실행 가능해요.',
      placement: 'right',
      advanceOn: 'next-button',
    },
    {
      id: 'unpin',
      dataTourId: 'space-list',
      title: '원래대로 — 메인 창에 드롭',
      body: '뱃지를 nost 창 위로 드래그해 놓으면 다시 편입됩니다. 우클릭 메뉴에서도 해제 가능.',
      placement: 'right',
      advanceOn: 'next-button',
    },
  ],
};

// Order is meaningful: TOURS[0] is what the WelcomeWizard runs by default
// when the user clicks "투어 보기" without specifying an id.
export const TOURS: Tour[] = [basicsTour, presetsTour, slashTour, floatingTour];

export function findTour(id: string): Tour | undefined {
  return TOURS.find(t => t.id === id);
}
