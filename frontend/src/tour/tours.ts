/**
 * Tour definitions live as pure data. Adding a new tour = push an entry into
 * the TOURS array and annotate target DOM nodes with matching `data-tour-id`.
 * The runtime (TourOverlay) interprets this data — there is no per-tour
 * component, so adding a tour costs ~30 lines of JSON-like description and
 * zero React code.
 */

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
   */
  advanceOn?: 'target-click' | 'next-button' | 'condition';
  /** For advanceOn='condition'. Polled every 400ms. */
  condition?: () => boolean;
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
}

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
      title: '클릭해 전환',
      body: '2 또는 3을 클릭하면 빈 프리셋으로 이동합니다. 그곳에서 새로 카드를 만들어보세요.',
      placement: 'bottom',
      advanceOn: 'target-click',
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

export const TOURS: Tour[] = [presetsTour, slashTour, floatingTour];

export function findTour(id: string): Tour | undefined {
  return TOURS.find(t => t.id === id);
}
