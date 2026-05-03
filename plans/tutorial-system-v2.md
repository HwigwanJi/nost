# 튜토리얼 시스템 v2 — 설계 문서

> **상태**: 설계 (개발 시작 전)
> **작성**: 2026-05-03
> **대체 대상**: 기존 sandbox-preset 기반 tour (`frontend/src/tour/sandbox.ts`, `tours.ts`의 4개 tour, `SandboxExitModal`)
> **개발 방식**: 이 문서를 SSOT로 두고 챕터 단위 점진 개발. 한 챕터씩 PR-사이즈로 끊어서 머지.

---

## 1. 디자인 원칙

1. **사용자 데이터를 대체하지 않는다.** 기존 v1은 "샌드박스 프리셋으로 전환 → 끝나면 원래 프리셋 복원" 방식. 이건 (a) 프리셋이 가득 찬 사용자에겐 동작 안 함, (b) "튜토리얼 = 별세계" 인식을 만들어 학습 전이가 약함. v2는 **현재 데이터를 그대로 두고**, 부족한 요소만 임시로 보충한다.
2. **퀘스트는 실제 작업이다.** 매 단계 실제 카드/스페이스/메모를 조작. `next-button`만으로 넘어가는 단계는 최소화. 마지막에 사용자가 만든 산출물을 **남길지 버릴지** 선택.
3. **두 가지 진입.** ① 설정 → 튜토리얼 아코디언에서 명시적 시작 ② 사용자가 관련 동작을 하다 막히면 알림으로 슬쩍 권유 (강제 X, "도와드릴까요?" 톤).
4. **보상 = 유료일수.** 챕터 완주 시 주당 N일 무료 적용. 이미 유료면 적립 (만료일 연장).
5. **2단 구조.** 카테고리 (대) ↔ 퀘스트 (소). 카테고리 내 퀘스트는 순서 무관하게 시작 가능, 단 일부 퀘스트는 선행 의존성 표기 (e.g. "스페이스 만들기" 안 하고 "카드 만들기"는 어색).

---

## 2. 아키텍처 개요

### 2.1 상태 모델

```ts
// frontend/src/tutorial/types.ts (예정)
type QuestId = string; // 'basics.spaces' / 'cards.scan' / ...

interface TutorialState {
  // 완주한 퀘스트 (영구). localStorage + electron-store 양쪽 백업
  completed: Record<QuestId, { atIso: string; durationMs: number }>;

  // 마지막 진행 (재개 가능). 한 번에 하나만 활성
  active: null | {
    questId: QuestId;
    stepIdx: number;
    startedAtIso: string;
    /** 이번 세션에서 추가/생성된 임시 항목들. 끝나고 keep/discard 결정에 사용. */
    addedItemIds: string[];
    addedSpaceIds: string[];
    addedMemoIds: string[];
  };

  // "이 알림은 다시 안 보겠음" 사용자 dismiss 기록 (퀘스트별)
  dismissedNudges: Record<QuestId, true>;

  // 적립된 유료일수 (보상 누적). 결제 만료일 계산에서 차감 사용
  rewardDays: number;
}
```

### 2.2 컴포넌트 / 모듈

| 모듈 | 역할 |
|---|---|
| `tutorial/registry.ts` | 모든 카테고리 + 퀘스트 정의 (현 `tours.ts` 대체). 순수 데이터 |
| `tutorial/QuestRunner.tsx` | 활성 퀘스트의 현재 step을 화면에 띄움. focus + dim + 힌트 + 진행바. 현 `TourOverlay` 발전형 |
| `tutorial/ScanLoader.tsx` | 퀘스트 시작 직전 짧은 로딩 ("준비 중…"). 사용자 데이터 스캔 결과 + 부족 요소 보충 결정을 가시화 |
| `tutorial/AccordionPanel.tsx` | 설정 다이얼로그 안에 들어갈 2단 아코디언. 카테고리 펼침 ↔ 퀘스트 카드 그리드. 완주/미완 표시 |
| `tutorial/NudgeToast.tsx` | 컨텍스트 알림. 사용자 동작 매처에 걸리면 "관련 튜토리얼 있음 — 시작?" |
| `tutorial/CompletionModal.tsx` | 퀘스트 끝났을 때 — 보상 유료일수 표시 + "이 작업물을 노스트에 남길까요? [남기기 / 정리하기]" |
| `tutorial/provisioner.ts` | 사용자 데이터 스캔 + 퀘스트 prerequisite 보충. 임시 추가한 항목 ID를 active state에 기록해 cleanup 가능 |
| `tutorial/gestureHints.ts` | 단계별 제스처 힌트 (좌클릭 / 우클릭 / 길게 / 드래그) — 통일된 작은 글리프 + 라벨 |

### 2.3 통합 포인트 (기존 코드와의 접점)

- **AppData**: TutorialState는 별도 키로 electron-store. AppData를 더럽히지 않음
- **showToast**: NudgeToast는 in-house 큐 사용 (디자인 시스템 일관성)
- **escapeStack**: QuestRunner가 ESC 우선순위에 등록 — 사용자가 ESC로 일시중단 가능
- **busyMark**: `tutorial:running` 마크로 다른 자동 모달(WelcomeWizard 등) 차단
- **paywall/entitlement**: rewardDays 누적 → entitlement 만료 계산에서 차감

---

## 3. 튜토리얼 분류 (카테고리 × 퀘스트)

### 보상 단위 (확정)

- **basics 카테고리** — 퀘스트당 **+1일**
- **그 외 모든 카테고리** (cards / layout / advanced / widgets) — 퀘스트당 **+3일**
- 카테고리 전체 완주 보너스 — **+2일**
- 전 카테고리 완주 마스터 보너스 — **+7일**

basics는 빠르고 짧으니 진입장벽 낮춤. 나머지는 학습량이 크고 실제 워크플로우 가치가 높으니 보상 비중 ↑. 총 적립 가능 일수 = 4(basics) + 14×3(rest) + 5×2(category) + 7(master) = **63일** (모두 완주 시).

### 3.1 카테고리 1. 기본기 소개 (Onboarding)

> 처음 nost를 켠 사용자가 30분 안에 모든 핵심 개념을 한 번씩 만져보게 한다.

| ID | 이름 | 시간 | 핵심 동작 | 보상 |
|---|---|---|---|---|
| `basics.spaces` | 스페이스란? | ~90s | 스페이스 1개 추가, 이름 변경, 아이콘 변경 | 1일 |
| `basics.cards` | 카드란? | ~120s | URL/앱/폴더 카드 각 1개씩 추가, 클릭으로 실행 확인 | 1일 |
| `basics.templates` | 템플릿이란? | ~60s | 시작 키트 1개 적용 → 결과 확인 → 되돌리기 | 1일 |
| `basics.search` | 빠른 검색이란? | ~45s | `/`로 검색 열기, 카드 검색, 결과 클릭 | 1일 |

### 3.2 카테고리 2. 카드 탐구하기 (Card Mastery)

> "카드를 만드는 5가지 방법"을 직접 경험.

| ID | 이름 | 시간 | 핵심 동작 | 보상 |
|---|---|---|---|---|
| `cards.scan` | 스마트 스캔으로 빠르게 추가 | ~90s | 사이드바 💡 클릭 → RecommendPanel 열림 → 추천 1개 클릭 | 3일 |
| `cards.clipboard` | 클립보드 복사로 빠르게 추가 | ~120s | URL 복사 → 게이트웨이 배너 등장 → URL 카드 변환 | 3일 |
| `cards.memo` | 메모도 카드처럼 | ~120s | 텍스트 복사 → 게이트웨이 → "메모로" → 마크다운 자동 정리 시연 | 3일 |
| `cards.dragdrop` | 드래그 앤 드롭으로 추가 | ~60s | 파일 드래그 → 스페이스에 드롭 (실제 파일 안 만들고 가상 드래그 이벤트) | 3일 |
| `cards.dialog` | 다이얼로그 깊이 알기 | ~150s | + 추가 → 3-phase 다이얼로그 한 사이클 → 화면 픽 모드 체험 | 3일 |

### 3.3 카테고리 3. 자유롭게 배치하기 (Layout)

| ID | 이름 | 시간 | 핵심 동작 | 보상 |
|---|---|---|---|---|
| `layout.cardmove` | 카드 이동하기 | ~60s | 카드 우클릭 드래그 → 다른 위치로. 우클릭임을 명시 (좌클릭은 swipe-gesture로 충돌) | 3일 |
| `layout.spacereorder` | 스페이스 순서 바꾸기 | ~60s | 스페이스 그립 좌클릭 드래그 → 위/아래 | 3일 |
| `layout.tile` | 타일링 알아보기 | ~90s | 노드 그룹 빌드 → 타일링 실행 (모니터 1개로도 가능한 시나리오) | 3일 |

### 3.4 카테고리 4. 심화 기능 (Advanced)

| ID | 이름 | 시간 | 핵심 동작 | 보상 |
|---|---|---|---|---|
| `advanced.floating` | 플로팅 뱃지 만들기 | ~120s | 카드 우클릭 → 플로팅으로 → 화면 어디든 떠있는 뱃지 확인 | 3일 |
| `advanced.nodegroup` | 노드 그룹 (한 번에 여러 개 실행) | ~150s | 노드 모드 진입 → 카드 2~3개 묶기 → 단축키로 한 번에 실행 | 3일 |
| `advanced.preset` | 프리셋 전환 | ~90s | 프리셋 1↔2 토글 (Pro 사용자만 — 무료는 락 화면 + "이 퀘스트는 유료" 안내) | 3일 |

### 3.5 카테고리 5. 위젯 알아보기 (Widgets)

| ID | 이름 | 시간 | 핵심 동작 | 보상 |
|---|---|---|---|---|
| `widgets.music` | 음악 위젯 | ~60s | 음악 위젯 추가 → 재생/일시정지 swipe → 볼륨 슬라이더 | 3일 |
| `widgets.color` | 컬러 코드 위젯 | ~90s | 헥스 복사 → 게이트웨이로 위젯 추가 → swipe (보색/유사색 복사) | 3일 |
| `widgets.memo` | 메모 위젯 | ~90s | 빈 메모 추가 → 에디터 열기 → 정리 도구 팔레트 한 번 사용 | 3일 |

> 향후 위젯 추가될 때마다 이 카테고리에 퀘스트 1개씩 푸시.

---

## 4. 퀘스트 데이터 스펙

### 4.1 Quest 정의 (TypeScript)

```ts
interface Quest {
  id: QuestId;
  category: 'basics' | 'cards' | 'layout' | 'advanced' | 'widgets';
  title: string;          // "스페이스란?"
  summary: string;        // 1줄 요약
  estimatedSec: number;   // 시간 예상 (UI 표시용)
  rewardDays: number;     // 완주 시 적립 일수

  /** 선행 의존성 (모두 completed여야 시작 가능). 빈 배열이면 자유 시작. */
  prereqs: QuestId[];

  /** 시작 직전 보충 — 사용자 데이터에 없는 prerequisite 자원 추가.
   *  ScanLoader가 이 함수를 호출, 결과의 addedXxxIds를 active state에 저장.
   *  Cleanup 시 이 ID들 삭제. */
  provision: (data: AppData) => Promise<{
    addedItemIds?: string[];
    addedSpaceIds?: string[];
    addedMemoIds?: string[];
    note?: string; // 사용자에게 보여줄 한 줄 ("스페이스가 없어 임시로 1개 추가했어요")
  }>;

  steps: QuestStep[];

  /** 사용자가 외부에서 이 퀘스트와 관련된 동작을 시작했을 때 nudge 표시.
   *  null이면 nudge 안 함 (명시적 시작만). */
  contextNudge?: {
    /** App 레벨 이벤트 매처. 'card-add-cancel' 같은 의미 있는 신호. */
    trigger: NudgeTrigger;
    headline: string; // "카드 추가에 익숙하지 않으세요?"
    body: string;     // "1분이면 끝나는 가이드가 있어요"
  };
}

interface QuestStep {
  id: string;
  title: string;          // 헤더
  body: string;           // 1~3줄 설명
  /** focus 대상 — `data-tour-id` 속성 기준. 다중 가능 (모든 매칭 요소 spotlight). */
  spotlight: string | string[];
  /** 단계 진행 조건 */
  advance:
    | { kind: 'next-button' }                      // 그냥 [다음] 클릭
    | { kind: 'click-target' }                     // spotlight 요소 클릭으로 진행
    | { kind: 'expects'; check: (d: AppData) => boolean }
    | { kind: 'event'; type: AppEvent }            // 'item-added' 등
    | { kind: 'auto-advance'; ms: number };
  /** 제스처 힌트 — 단계의 의도된 동작 타입. UI에 작은 글리프로 표시. */
  gesture?: 'left-click' | 'right-click' | 'long-press' | 'drag' | 'keyboard' | 'swipe';
  /** 진행 못 하면 노출되는 보조 힌트 (15s 후 페이드인). */
  fallbackHint?: string;
}

interface NudgeTrigger {
  /** 어떤 사용자 동작 후에 nudge 후보가 되는지 */
  type:
    | 'item-dialog-cancel'   // 다이얼로그 취소했음
    | 'first-card-error'     // 카드 만들다 valueError 자주 봄
    | 'recommend-panel-open' // 💡 처음 열었음
    | 'paste-no-action'      // 클립보드 게이트웨이 dismiss
    | 'memo-edit-stuck';     // 메모 편집기 30s 무동작
  /** 매처 추가 조건 (특정 type에만 매치 등) */
  match?: (data: AppData) => boolean;
  /** 이 nudge 표시 후 cooldown — 같은 카테고리 nudge가 N분 안에 또 뜨지 않게 */
  cooldownMin: number;
}
```

### 4.2 예시 퀘스트 — `basics.cards`

```ts
{
  id: 'basics.cards',
  category: 'basics',
  title: '카드란?',
  summary: 'URL · 앱 · 폴더를 카드로 만들고 한 번에 실행',
  estimatedSec: 120,
  rewardDays: 1,
  prereqs: ['basics.spaces'],

  provision: async (data) => {
    // 카드 만들 스페이스가 1개 이상 있어야 시작 가능
    if (data.spaces.length === 0) {
      const newSpaceId = await store.addSpace({ name: '튜토리얼' });
      return { addedSpaceIds: [newSpaceId], note: '연습용 스페이스를 추가했어요' };
    }
    return {};
  },

  steps: [
    {
      id: 'intro',
      title: '카드는 nost의 가장 작은 단위입니다',
      body: 'URL, 앱, 폴더, 텍스트 — 무엇이든 카드로 묶어 한 번에 실행할 수 있어요. 직접 만들어볼게요.',
      spotlight: 'add-card-button',
      advance: { kind: 'next-button' },
    },
    {
      id: 'add-url',
      title: 'URL 카드 추가',
      body: '+ 추가 버튼을 누르고 URL 카드를 만들어 보세요. 예: https://github.com',
      spotlight: 'add-card-button',
      gesture: 'left-click',
      advance: { kind: 'expects', check: (d) =>
        d.spaces.some(s => s.items.some(i => i.type === 'url')) },
      fallbackHint: '하단 + 추가 → 유형: URL → 값에 https://... 입력 → 추가',
    },
    {
      id: 'click-card',
      title: '카드 클릭으로 실행',
      body: '방금 만든 URL 카드를 클릭하면 브라우저에서 열려요.',
      spotlight: '[data-card][data-card-type="url"]',
      gesture: 'left-click',
      advance: { kind: 'event', type: 'item-launched' },
    },
    {
      id: 'success',
      title: '잘했어요!',
      body: '카드 = 클릭 1번에 작업 시작. 다음 퀘스트에선 더 빠른 추가 방법을 배워봐요.',
      spotlight: 'space-list',
      advance: { kind: 'auto-advance', ms: 2500 },
    },
  ],

  contextNudge: {
    trigger: { type: 'item-dialog-cancel', cooldownMin: 30 },
    headline: '카드 만들기가 어려우신가요?',
    body: '1분짜리 가이드가 있어요',
  },
}
```

---

## 5. 진행 흐름 (UX)

```
[설정 다이얼로그]
   ▼ "튜토리얼" 탭 (아코디언)
[카테고리 1]   [카테고리 2]   ...
   ▼ 펼침
   ┌─ 퀘스트 1 (✓ 완료, +1일 적립)
   ├─ 퀘스트 2 (▶ 시작)            ← 클릭
   └─ 퀘스트 3 (🔒 prereq 필요)
                ▼
          [ScanLoader]              "튜토리얼 준비 중… (스캔 + 보충)"
          1.0~1.5s
                ▼
          [QuestRunner]             전체화면 dim + spotlight + 헤더/본문/힌트/진행바 + [건너뛰기 / 다음]
          ESC → "일시중단? 진행 저장됨" 모달
                ▼ 마지막 단계 완료
          [CompletionModal]
          ┌────────────────────────────────────┐
          │ 🎉 카드란? 완료                    │
          │ +1일 적립 (총 N일)                 │
          │                                    │
          │ 이번에 만든 항목 (3개):           │
          │  · "github.com" (URL 카드)        │
          │  · "튜토리얼" 스페이스 (자동 추가)  │
          │                                    │
          │ [정리하기]      [남기기]           │
          └────────────────────────────────────┘
```

### 5.1 ScanLoader 구체

- 시작 즉시 **반투명 풀스크린 + 작은 로딩 카드** 1.0~1.5s 표시
- 스캔 항목 (체크리스트 UI):
  - ☑ 카드 X개 발견
  - ☑ 스페이스 Y개 발견
  - ☐ 메모 카드 없음 → 임시 메모 1개 추가 ✓
- 추가된 항목은 active state의 added*Ids 배열에 기록
- 끝나면 자동으로 QuestRunner로 트랜지션

### 5.2 QuestRunner UI

```
┌────────────────────── (full screen dim, opacity 0.55) ──────────────────┐
│                                                                          │
│        ┌─ spotlight (CSS box-shadow 0 0 0 9999px rgba dim) ─┐            │
│        │                                                    │            │
│        │           [실제 UI 요소 — 클릭 가능]                │            │
│        │                                                    │            │
│        └────────────────────────────────────────────────────┘            │
│                                                                          │
│   ┌─ 풍선 패널 (spotlight 옆) ─────────────────────────────┐             │
│   │ 🖱 좌클릭                              ① / ④          │             │
│   │ ─────────────────────────────────                     │             │
│   │ 카드 클릭으로 실행                                     │             │
│   │ 방금 만든 URL 카드를 클릭하면 브라우저에서 열려요.    │             │
│   │                                                       │             │
│   │  [건너뛰기]                              [다음 →]    │             │
│   └───────────────────────────────────────────────────────┘             │
│                                                                          │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 25%                    │
└──────────────────────────────────────────────────────────────────────────┘
```

- 좌상단: 제스처 글리프 + 라벨 (좌클릭 / 우클릭 / 길게 / 드래그 / 키보드 / swipe)
- 우상단: 단계 N/M
- 본문 + [건너뛰기] [다음] 또는 자동 진행 시 [다음] 비활성
- 하단: 스텝 비율 진행바 (퀘스트 전체 기준)

### 5.3 CompletionModal — 정리 / 남기기

- **정리하기**: provision에서 추가한 항목 삭제 + 사용자가 퀘스트 중 만든 항목도 삭제 (active state의 added*Ids)
- **남기기**: 모두 보존. 사용자가 보고 싶다면 "지금까지 한 작업, nost가 기억합니다"
- 보상은 어느 쪽이든 동일하게 적립

---

## 6. 컨텍스트 알림 (Nudge) 시스템

### 6.1 트리거 종류

| Trigger type | 발사 조건 | 예시 매칭 퀘스트 |
|---|---|---|
| `item-dialog-cancel` | ItemDialog를 1회라도 열고 저장 없이 취소 | `basics.cards`, `cards.dialog` |
| `first-card-error` | 카드 추가 중 valueError 5초+ 노출 | `basics.cards` |
| `recommend-panel-open` | 💡 사이드바 처음 열음 | `cards.scan` |
| `paste-no-action` | 게이트웨이 배너 dismiss (사용자가 X 클릭) | `cards.clipboard` |
| `memo-edit-stuck` | 메모 에디터 열어둔 채 30s 무동작 | `widgets.memo`, `cards.memo` |
| `widget-not-touched` | 위젯 카드 N개 있는데 일주일+ 클릭/swipe 0회 | `widgets.music` 또는 `widgets.color` |

### 6.2 발사 규칙

1. 매 세션 최대 2회 (스팸 방지)
2. 같은 퀘스트의 nudge는 dismiss 후 7일 동안 재출현 X
3. 이미 completed인 퀘스트는 nudge 안 띄움
4. `tutorial:running` busyMark 활성 시 nudge 보류
5. NudgeToast = 인하우스 토스트 큐, 7~9s 자동 dismiss, action: [시작하기 / 다음에]

### 6.3 NudgeToast 시각 톤

```
┌─────────────────────────────────────────────────────┐
│ 💡 카드 만들기가 어려우신가요?                       │
│    1분짜리 가이드가 있어요 (+1일 무료 적립)         │
│                       [시작하기]    [다음에]   ✕    │
└─────────────────────────────────────────────────────┘
```

배경 = `var(--accent-dim)` 톤. 강제 X. 보상 일수 명시 → 완주 동기.

---

## 7. 보상 (유료일수)

### 7.1 적립 규칙

- 챕터 완주 시 `rewardDays += quest.rewardDays`
- 동일 퀘스트 중복 보상 X (completed 검사)
- electron-store에 영구 저장
- `entitlement.expiresAt` 계산 시 `now + rewardDays` 만큼 가산 (이미 Pro면 만료일 연장)

### 7.2 표시

- 설정 → 튜토리얼 헤더에 "지금까지 N일 적립 / 총 X일 가능"
- CompletionModal: "+1일 적립" + 누적 표시
- NudgeToast: "(+1일 무료 적립)"

### 7.3 완주율 인센티브

- 한 카테고리 전체 완주 시 보너스 +2일
- 모든 카테고리 완주 시 보너스 +7일

---

## 8. 영구 저장 (Persistence)

### 8.1 키 구조 (electron-store)

```
tutorial:
  state:
    completed: { 'basics.spaces': { atIso: '...', durationMs: 87000 }, ... }
    rewardDays: 12
    dismissedNudges: { 'basics.cards': true }
  active: null | { questId, stepIdx, ... }   ← 세션 중단 시 재개용
```

### 8.2 마이그레이션

- v1 sandbox tour의 진행 기록은 사용 안 함 (구조 다름). 신규 시스템 = clean slate
- v1 tour 코드 (`SandboxExitModal`, `sandbox.ts`)는 삭제. `TourOverlay`는 v2 `QuestRunner`의 베이스로 흡수 (focus + dim 로직 재사용 가치 큼)
- v1 `tours.ts`의 4개 tour는 v2 카테고리 1~2에 흡수 매핑

---

## 9. 개발 로드맵 (챕터 단위 PR)

### Sprint 1 — 인프라 (1~2일)
- [ ] PR-01 `tutorial/types.ts` + `tutorial/registry.ts` 빈 스켈레톤
- [ ] PR-02 `TutorialStateStore` (electron-store + React hook)
- [ ] PR-03 `QuestRunner` (TourOverlay 흡수 → 제스처 힌트 + 진행바 추가)
- [ ] PR-04 `ScanLoader` + `provisioner.ts`
- [ ] PR-05 `CompletionModal` (정리/남기기) — added*Ids cleanup 로직 포함
- [ ] PR-06 `AccordionPanel` (설정 다이얼로그 안)
- [ ] PR-07 `NudgeToast` + 최소 1개 트리거 (`item-dialog-cancel`)
- [ ] PR-08 보상 적립 → entitlement 만료 계산 결합

### Sprint 2 — 카테고리 1 (basics)
- [ ] PR-09 `basics.spaces` 퀘스트 정의 + data-tour-id 추가 + 단위 검증
- [ ] PR-10 `basics.cards`
- [ ] PR-11 `basics.templates`
- [ ] PR-12 `basics.search`

### Sprint 3 — 카테고리 2 (cards)
- [ ] PR-13 `cards.scan`
- [ ] PR-14 `cards.clipboard` (게이트웨이 배너 직접 시연)
- [ ] PR-15 `cards.memo`
- [ ] PR-16 `cards.dragdrop` (가상 드래그 이벤트로 시뮬)
- [ ] PR-17 `cards.dialog`

### Sprint 4 — 카테고리 3~5
- [ ] PR-18 `layout.*` 3개
- [ ] PR-19 `advanced.*` 3개
- [ ] PR-20 `widgets.*` 3개

### Sprint 5 — Polish
- [ ] PR-21 추가 nudge 트리거 (5종)
- [ ] PR-22 카테고리 완주 보너스
- [ ] PR-23 v1 tour 코드 (`sandbox.ts`, `SandboxExitModal`) 제거
- [ ] PR-24 분석 (퀘스트별 abandon rate 로깅 — 옵셔널)

---

## 10. 위험 요소 & 의사결정

| 위험 | 대응 |
|---|---|
| 사용자가 퀘스트 중 다른 다이얼로그 열어 spotlight 깨짐 | `tutorial:running` busyMark + `escapeStack` 우선순위로 다른 모달 차단. 단 로그아웃/긴급 종료 등 critical은 허용. |
| Provisioner가 사용자 데이터에 의도치 않은 항목 추가 | `note` 필드로 첫 단계에서 명시. CompletionModal에서 정확한 added 목록 노출. |
| 보상 일수 어뷰즈 (퀘스트 중간에 끄고 다시 시작 반복) | `completed` 한 번만 체크. 동일 퀘스트 중복 보상 절대 안 됨. |
| 다국어 — 현재 한국어 only | 스펙은 ko-KR로 진행. v2 끝난 뒤 i18n 분리 (string은 한 번에 추출 가능하게 모아둠) |
| Pro 락 퀘스트 (preset 같은) 무료 사용자가 시작 시도 | prereqs와 별도로 `requiresEntitlement: 'pro'` 필드. 잠긴 카드 클릭 시 paywall로 라우팅 |

---

## 11. 확정 결정 (사용자 답변 반영)

### 11.1 신규 사용자 진입점 (확정)

**자동 풀스크린 강제 X. 자연스런 첫 동작에 nudge로 접점.**

- 첫 실행 시 `WelcomeWizard`(기존)에서 **"튜토리얼 시작"** CTA 한 줄 노출. 사용자가 명시적으로 클릭해야 시작
- 첫 카드 추가 / 첫 스페이스 추가 / 💡 첫 클릭 같은 **자연스런 첫 동작 직후** 짧은 nudge 토스트 (§6 NudgeToast)
- 무시하면 그냥 사라짐. 다음 자연스런 트리거에서 다시 권유 (cooldown 7일 적용 안 함 — "첫 동작" 류는 1회성이라 자연 한도)
- 단, 모든 nudge 무시한 사용자에게 **3일 후 한 번** "튜토리얼 = N일 무료 적립 가능" 알림 (마지막 권유, 이후 자동 호출 안 함)

이 방식이 (a) 강제감 없음 (b) 보상 동기는 명확히 (c) 사용자가 진짜로 어려움 겪는 시점에 도움 제안 — 학습 효과 ↑.

### 11.2 일시중단 재개 UI (확정)

- 퀘스트 도중 ESC / 다른 작업으로 이탈하면 `active` state 보존 (§ 2.1)
- **다음 nost 활성화 시점**에 작은 인하우스 토스트:

  ```
  ┌────────────────────────────────────────────┐
  │ 🎯 튜토리얼 진행 중 — 카드란? (2/4 단계)   │
  │ 이어서 하시겠어요? (+1일 적립)              │
  │              [이어서]    [그만]    ✕       │
  └────────────────────────────────────────────┘
  ```

- "그만" 클릭 → `active = null`, addedItemIds에 따라 정리/남기기 미니 다이얼로그
- "이어서" → 마지막 stepIdx부터 재개, ScanLoader 스킵
- 토스트 dismiss 후엔 설정 → 튜토리얼 아코디언에서만 재개 가능

### 11.3 Nudge 기본 동작 (확정)

**Show-first 옵트아웃 모델.** 트리거 매치 시 nudge가 **즉시 토스트로 등장** (먼저 묻지 않음).

- 사용자가 dismiss(✕) 또는 "다음에" 클릭 → 해당 퀘스트 nudge 7일 cooldown
- "시작하기" 클릭 → 즉시 ScanLoader → QuestRunner
- 세션당 최대 2회 (§ 6.2)
- "show first"인 이유: ask first(예: "도움말 받으시겠어요?") 는 메타-방해. 그냥 짧은 nudge 자체가 답을 담고 있어서, 보고 안 누르면 자동 사라짐 = 더 가벼운 인터럽트.

---

## 12. SSOT 갱신 규칙

- 새 카테고리/퀘스트 추가 시 § 3에 행 추가
- 새 nudge trigger 추가 시 § 6.1에 행 추가
- 구현 PR 머지마다 § 9의 체크박스 갱신
- 위험/결정 변경 시 § 10/11에 추가
