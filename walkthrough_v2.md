# nost — 개발 컨텍스트 워크스루 v2 (v1.3.0+)

> 이 문서는 기존 [walkthrough.md](walkthrough.md) (v1.0.9 기준, 2026-04-13)를 대체합니다.
> 마지막 업데이트: 2026-04-27 (v1.3.x WIP 시점)
> 새 대화 시작 시 이 파일과 [PROJECT_NOTES.md](PROJECT_NOTES.md), [guide.md](guide.md)를 같이 읽으세요.

---

## 0. 변경 요약 (v1.0.9 → v1.3.x)

| 버전 | 주요 변경 |
|------|----------|
| v1.0.10 | extServer graceful shutdown |
| v1.0.11~13 | **스페이스 페어 모델** (Notion-style column drop, paired resize) |
| v1.0.14~15 | .lnk 실행 fix, 트레이 동적 상태, 업데이트 진행 가시화 |
| v1.0.17 | **플로팅 Orb FAB** MVP, .lnk 아이콘, cross-DPI tiling |
| v1.0.18 | 멀티-doc 타일링, PPT 지원, clean tool, tool-mode exclusivity |
| v1.0.19 | **플로팅 뱃지** + 미니윈도우, slow-launch toast |
| v1.0.20 | 뱃지 폰트 로딩 hotfix |
| v1.1.0 | 뱃지 드래그 좌표 drift fix, landing 애니메이션 부드럽게 |
| v1.2.0 | **프리셋 1/2/3** 시스템, 새 슬래시 명령어, **튜토리얼 프레임워크** |
| v1.2.1 | **Pro-tier entitlement (Phase 5)** 골격, space-drag 데이터 손실 fix |
| v1.3.0 | **온보딩 팩** — 환영 위자드, 5종 템플릿, 빈 상태 UI, 가져오기 위자드 |
| v1.3.x WIP | userBusy 상태 레지스트리, sandbox 튜토리얼 모드 |

---

## 1. 프로젝트 개요

**nost** — Windows용 Electron 런처.

핵심 컨셉:
- **스페이스**(카드 묶음)으로 앱/URL/폴더/창/텍스트/명령어를 분류
- **노드**(2~3 카드 동시 분할 실행) + **덱**(순차 실행) 워크플로우
- **컨테이너**(상/하/좌/우 슬롯 카드, Pro 전용)
- **플로팅 Orb**(항상 떠있는 FAB) + **플로팅 뱃지**(스페이스/노드/덱 핀아웃)
- **프리셋 1/2/3** — 완전 분리된 작업 공간
- **`/` 커맨드바** (Spotlight/Alfred 스타일)
- **모니터별 배치, 스냅, DPI-safe 타일링**
- **스마트 추천**(고스트 카드) — 열린 창/Recent 스캔 → 유사도 매칭
- **다운로드 대화상자 감지** + 폴더 빠른 이동 바
- **Chrome/Whale 확장 연동** — 탭 감지, 분할 배치
- **튜토리얼 시스템** + 샌드박스 모드
- **Pro 구독** — 14일 무료 체험, 제한 해제

---

## 2. 기술 스택

| 레이어 | 기술 |
|-------|------|
| Electron | v41, CommonJS |
| Frontend | React 19 + TypeScript + Vite 8 |
| 스타일 | Tailwind CSS v4 + CSS 변수 |
| 상태관리 | `useAppData` hook + `AppContext` (State/Actions split) |
| 영속성 | `electron-store` (primary) + `localStorage` (fallback) |
| DnD | `@dnd-kit/core` + `@dnd-kit/sortable` |
| 아이콘 | Material Symbols Rounded (Google Fonts CDN) |
| 창 배치 | PowerShell + Win32 P/Invoke (.NET Forms.Screen for DPI) |
| 자동 업데이트 | `electron-updater` → GitHub Releases (public repo, 토큰 불필요) |
| 로깅 | `electron-log` (5MB rotation) |

---

## 3. 디렉토리 구조 (v1.3.x)

```
nost/  (D:\01_개인\06. launcher)
├── main.js                      # 2,522줄 — Electron main, IPC, PS, 창 관리
├── preload.js                   # 메인 윈도우용 contextBridge
├── preload-floating.js          # 플로팅 Orb 전용 preload
├── preload-badges.js            # 플로팅 뱃지 오버레이 전용 preload
├── package.json                 # v1.3.2, electron-builder 설정
├── walkthrough.md               # ← OLD (v1.0.9 시점, stale)
├── walkthrough_v2.md            # ← THIS FILE
├── PROJECT_NOTES.md             # 초기 개발 노트
├── guide.md                     # 사용자 설명서
├── PRIVACY.md                   # 개인정보 처리방침
│
├── ps-scripts/                  # PowerShell (Win32 P/Invoke)
│   ├── _Win32Types.ps1          # NostWin32 클래스 (P/Invoke 정의)
│   ├── _Functions.ps1           # Find-Hwnd 등 공유
│   ├── _Position.ps1            # Move-WindowToRect (DPI-safe 중앙화)
│   ├── run-tile-ps.ps1          # 노드 그룹 타일링 (30초 폴링 + settle)
│   ├── maximize-window.ps1
│   ├── snap-window.ps1          # 좌/우/상 스냅
│   ├── tile-windows.ps1         # /tile 명령어
│   ├── launch-or-focus-app.ps1  # 3단계 AUMID 폴백 (Store 앱 지원)
│   ├── get-recent-items.ps1     # Windows Recent 폴더
│   ├── get-open-windows.ps1
│   ├── check-items-for-tile.ps1
│   ├── focus-window.ps1
│   ├── open-path.ps1
│   ├── detect-dialog.ps1        # 파일 대화상자 감지
│   ├── jump-to-dialog-folder.ps1
│   └── check-windows-alive.ps1
│
├── chrome-extension/            # Chrome/Whale 확장 (탭 스캔, 타일)
├── assets/                      # 이미지/리소스
└── frontend/
    ├── index.html               # 메인 윈도우 진입
    ├── floating.html            # 플로팅 Orb 진입
    ├── badges.html              # 뱃지 오버레이 진입 (추정)
    └── src/
        ├── App.tsx              # 2,961줄 — 루트, 상태, 핸들러
        ├── types.ts             # 260줄 — LauncherItem, Space, License 등
        ├── electronBridge.ts    # IPC 타입 + dev-mode noop fallback
        │
        ├── contexts/
        │   └── AppContext.tsx   # AppState/AppActions 분리 context
        │
        ├── hooks/
        │   ├── useAppData.ts        # 데이터 CRUD + 페어 모델 + 프리셋 미러링
        │   ├── useNodeDeckMode.ts   # 노드/덱 상태 + 실행 파이프라인
        │   ├── useLaunchPipeline.ts # 단일 아이템 실행 + 배치
        │   ├── useTileOverlay.ts    # 타일 모드 오버레이
        │   ├── useGhostCards.ts     # 스마트 추천 (스캔/매칭/수락/거절)
        │   ├── useWindowDrag.ts     # 우클릭 창 드래그
        │   ├── useToastQueue.ts     # 토스트 큐
        │   └── useEntitlement.ts    # Pro 게이팅 (v1.2.1+)
        │
        ├── components/          # 36+ .tsx
        │   ├── Sidebar.tsx                # 좌측 사이드바
        │   ├── SpaceAccordion.tsx         # 스페이스 + 페어 모델 렌더
        │   ├── ItemCard.tsx               # 1,023줄 — 카드, 홀드 제스처
        │   ├── GhostCard.tsx              # 추천 고스트 카드 (점선)
        │   ├── ContainerSlotPicker.tsx    # 컨테이너 슬롯 편집
        │   ├── ItemDialog.tsx             # 694줄 — 아이템 편집 (favicon 로직 포함)
        │   ├── ItemWizard.tsx             # 빠른 추가 위자드
        │   ├── SettingsDialog.tsx         # 환경설정
        │   ├── ScanDialog.tsx             # 열린 창/탭 스캔
        │   ├── ExtensionInstallWizard.tsx # 확장 설치 가이드
        │   ├── PaywallModal.tsx           # Pro 게이트 (v1.2.1+)
        │   ├── WelcomeModal.tsx           # (옛 환영 모달 — onboarding/로 이전됨)
        │   ├── BatchDropDialog.tsx        # 일괄 드롭
        │   ├── NodePanel.tsx              # 노드 우측 패널
        │   ├── DeckPanel.tsx              # 덱 우측 패널
        │   ├── RecommendPanel.tsx         # 추천 드로어
        │   ├── DialogContextBar.tsx       # 다운로드 컨텍스트 바
        │   ├── TileOverlay.tsx
        │   ├── ToastOverlay.tsx
        │   ├── ClipboardSuggestion.tsx
        │   ├── ColorPicker.tsx
        │   ├── CommandBar.tsx             # `/` 커맨드바
        │   ├── PresetToggle.tsx           # 프리셋 1/2/3 pill (v1.2.0+)
        │   ├── EmptyState.tsx             # 빈 상태 + "템플릿으로 시작"
        │   └── ui/                        # shadcn/ui 기반
        │       ├── Icon.tsx               # Material Symbols 래퍼
        │       ├── NostLogo.tsx
        │       └── [dialog, button, …]
        │
        ├── lib/
        │   ├── utils.ts                   # generateId 등
        │   ├── userBusy.ts                # ★ NEW (v1.3.x WIP): busy 상태 레지스트리
        │   ├── logger.ts                  # 렌더러 로깅 (electron-log 연동)
        │   └── documentExtensions.ts      # 문서 확장자 판별
        │
        ├── tour/                # 튜토리얼 시스템 (v1.2.0+)
        │   ├── TourOverlay.tsx            # spotlight + 팝오버
        │   ├── tours.ts                   # 투어 정의 (data, not components)
        │   ├── TutorialBanner.tsx         # ★ WIP — 진행 상태 표시
        │   ├── SandboxExitModal.tsx       # ★ WIP — 샌드박스 종료 confirm
        │   └── sandbox.ts                 # ★ WIP — 튜토리얼 데이터 시드
        │
        ├── badges/              # 플로팅 뱃지 (v1.0.19+)
        │   ├── Badge.tsx                  # 46px 원형 bubble
        │   ├── BadgeOverlay.tsx           # 단일 BrowserWindow가 모든 뱃지 호스팅
        │   ├── MiniWindow.tsx             # 뱃지 클릭 → 팝오버 (아이템 목록)
        │   └── index.tsx
        │
        ├── floating/            # 플로팅 Orb (v1.0.17+)
        │   ├── FloatingOrb.tsx            # FAB (drag + context menu)
        │   └── index.tsx
        │
        ├── onboarding/          # 첫 실행 + 템플릿 (v1.3.0)
        │   ├── WelcomeWizard.tsx          # 페르소나 선택 → 템플릿 적용
        │   ├── ImportWizard.tsx           # .nost / .json 가져오기
        │   ├── templates.ts               # 5개 템플릿 (dev/design/student/general/blank)
        │   ├── importParsers.ts           # 백업 파일 파서
        │   └── FirstCardCelebration.tsx   # 첫 카드 추가 축하 애니메이션
        │
        ├── assets/              # 폰트, 이미지
        └── App.css              # 글로벌 스타일
```

---

## 4. 핵심 타입 ([frontend/src/types.ts](frontend/src/types.ts))

### LauncherItem

```typescript
interface LauncherItem {
  id: string;
  title: string;
  type: 'url' | 'folder' | 'app' | 'window' | 'browser' | 'text' | 'cmd';
  value: string;                    // 실행 경로/URL/커맨드/텍스트
  icon?: string;                    // material symbol name OR data URL OR remote URL
  iconType?: 'material' | 'image';
  color?: string;
  clickCount?: number;
  lastClickedAt?: number;           // epoch ms — staleness 신호
  pinned?: boolean;
  monitor?: number;                 // 1-indexed; undefined = no preference
  exePath?: string;                 // 'window' 타입: 창 닫혔을 때 재실행 경로
  hiddenInSpace?: boolean;          // 컨테이너 슬롯 전용 (스페이스 그리드에서 숨김)
  isContainer?: boolean;
  slots?: ContainerSlots;
}
```

> ⚠️ **iconPath 필드는 없다.** `icon: string` + `iconType: 'material' | 'image'`로 표현됨.
> - `iconType='material'` → `icon`은 Material Symbol 이름 (예: `'public'`, `'folder'`)
> - `iconType='image'` + `icon`이 `data:`로 시작 → base64 인라인 이미지 (앱 아이콘 추출, 사용자 업로드 후 crop)
> - `iconType='image'` + `icon`이 `http(s):` → **원격 URL 그대로 저장** (favicon 케이스, 캐싱 없음)

### Space (페어 모델, v1.0.12+)

```typescript
interface Space {
  id: string;
  name: string;
  items: LauncherItem[];
  color?: string;
  icon?: string;
  sortMode?: 'custom' | 'usage';
  pinnedIds?: string[];

  // 페어 모델
  pairedWithNext?: boolean;         // 다음 스페이스와 한 행 공유
  splitRatio?: number;              // 0.25~0.75, default 0.5 (이 스페이스의 폭 비율)

  /** @deprecated v1.0.12에 폐기, migrateData()에서 제거 */
  widthWeight?: number;
  /** @deprecated 동일 */
  columnSpan?: 1 | 2;
}
```

**불변 조건**: `spaces[i].pairedWithNext === true` ⇒ `spaces[i+1].pairedWithNext === false` (체인 페어 불가). [useAppData.ts](frontend/src/hooks/useAppData.ts)의 `enforcePairInvariant()`가 보장.

### Preset (v1.2.0+)

```typescript
interface Preset {
  id: '1' | '2' | '3';
  label: string;                    // 사용자 수정 가능
  spaces: Space[];
  nodeGroups?: NodeGroup[];
  decks?: Deck[];
  collapsedSpaceIds?: string[];
  floatingBadges?: FloatingBadge[];
}
```

`AppData.presets[]`은 항상 길이 3. 활성 프리셋은 `AppData.activePresetId`. `useAppData()`가 활성 프리셋의 데이터를 top-level `spaces`/`nodes`/`decks`로 미러링.

### License & Entitlement (v1.2.1+)

```typescript
type LicenseTier   = 'free' | 'pro';
type LicenseStatus = 'none' | 'trial' | 'active' | 'past_due' | 'canceled' | 'expired';

interface License {
  tier: LicenseTier;
  status: LicenseStatus;
  identity?: string;
  trialStartedAt?: number;
  trialEndsAt?: number;
  periodEndsAt?: number;
  licenseKey?: string;
  deviceId?: string;
  lastVerifiedAt?: number;
}

const FREE_LIMITS = {
  totalCards: 20,
  spaces: 4,
  nodes: 1,
  decks: 1,
  floatingBadges: 1,
  presets: 1,                       // 프리셋 2/3은 Pro 전용
  containerEnabled: false,
};
```

### FloatingBadge (v1.0.19+)

```typescript
interface FloatingBadge {
  id: string;                       // fb-{ts}-{rand}
  refType: 'space' | 'node' | 'deck';
  refId: string;
  x: number; y: number;             // screen coords (절대)
}
```

---

## 5. Favicon / 아이콘 처리 (현황)

> **사용자가 현재 캐싱 방안을 연구 중인 영역.** 자세한 분석과 개선안은 별도 파일 [research_favicon_caching.md](research_favicon_caching.md) 참고.

### 흐름

[ItemDialog.tsx:81-106](frontend/src/components/ItemDialog.tsx) / [ItemWizard.tsx](frontend/src/components/ItemWizard.tsx)에 동일한 로직이 중복됨:

```typescript
function faviconCandidates(inputUrl: string): string[] {
  const u = new URL(inputUrl);
  return [
    `${u.origin}/apple-touch-icon.png`,
    `${u.origin}/apple-touch-icon-precomposed.png`,
    `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=256`,
    `${u.origin}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`,
  ];
}

function tryLoadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(true);
    img.onerror = () => resolve(false);
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}
```

[ItemDialog.tsx:159-196](frontend/src/components/ItemDialog.tsx)의 `useEffect`가 url 입력 시 후보를 순차 시도, 첫 성공 시 `form.icon = candidate` (URL 문자열) + `iconType = 'image'`로 저장.

### 핵심 사실

| 항목 | 현황 |
|------|------|
| 저장 형태 | **원격 URL 문자열** (예: `https://www.google.com/s2/favicons?...`) |
| 로컬 캐시 | **없음** |
| 브라우저 캐시 | HTTP 캐시 헤더에만 의존 |
| 렌더링 | `<img src={item.icon}>` 직접 |
| 오프라인 | ❌ 표시 안됨 |
| 서버 다운/이동 | ❌ 영구 손실 |

### 비교: 앱 아이콘은 캐시됨

[main.js:1477-1500](main.js)의 `get-file-icon` IPC 핸들러는 `app.getFileIcon().toDataURL()`로 base64 변환 후 반환 → `iconType='image'` + data URL로 저장 → **재시작 후에도 영구 동작**. .lnk는 PS로 실 타겟 해석 후 추출.

→ favicon도 같은 패턴(data URL 저장)으로 통일 가능. 또는 `userData/icons/` 디렉토리에 파일로 캐시. 트레이드오프는 별도 연구노트 참고.

---

## 6. 새 기능 (v1.0.10 이후) 상세

### 6.1 스페이스 페어 모델 (v1.0.12~13)

- **타입**: `Space.pairedWithNext` + `Space.splitRatio` (위 4번 섹션 참고)
- **렌더**: [SpaceAccordion.tsx](frontend/src/components/SpaceAccordion.tsx)에서 두 스페이스를 한 row로 합쳐 flex 분할
- **드래그**: 스페이스 헤더를 페어로 묶거나 풀기 (Notion 컬럼 드롭 스타일, v1.0.11)
- **리사이저**: 페어 사이의 핸들로 splitRatio 조정
- **마이그레이션**: 옛 `widthWeight`/`columnSpan`을 `migrateData()`에서 제거

### 6.2 플로팅 Orb (v1.0.17+)

[floating/FloatingOrb.tsx](frontend/src/floating/FloatingOrb.tsx) — 항상 떠있는 FAB.

- 별도 BrowserWindow + [preload-floating.js](preload-floating.js)
- 좌클릭 → 메인 윈도우 토글 / 우클릭 → 컨텍스트 메뉴
- 드래그: `floating-drag-start` → 하트비트 폴링 → `floating-drag-end`
- 설정: `floatingButton: { enabled, idleOpacity, size, hideOnFullscreen, position }`
- 풀스크린 앱 포커스 시 자동 숨김

### 6.3 플로팅 뱃지 (v1.0.19+)

[badges/](frontend/src/badges/) — Space/Node/Deck을 미니윈도우로 핀아웃.

**구조**: 단일 `BadgeOverlay` BrowserWindow가 모든 뱃지 호스팅 (RAM 절약).
- `setIgnoreMouseEvents(true, {forward: true})` → 기본 click-through, 뱃지 hover/drag 시에만 capture

**컴포넌트**:
- `Badge.tsx` — 46px 원형 bubble (아이콘 + type glyph)
- `MiniWindow.tsx` — 클릭 시 팝오버, 아이템 목록 + 실행 버튼
- `BadgeOverlay.tsx` — 모든 뱃지 + 미니윈도우 호스팅

**IPC 채널** (`badges-*` 전부, 9개):
| 채널 | 방향 | 용도 |
|------|------|------|
| `badges-pin` | invoke | Space/Node/Deck 고정 (중복 방지) |
| `badges-unpin` | send | 뱃지 제거 |
| `badges-reposition` | send | 드래그 후 위치 저장 |
| `badges-launch-item` | send | 미니윈도우 → 아이템 실행 |
| `badges-launch-ref` | send | 미니윈도우 → Node/Deck 실행 |
| `badges-set-capture` | send | click-through 토글 |
| `badges-context-menu` | send | 우클릭 메뉴 |
| `badges-is-inside-main` | invoke | 좌표가 메인 윈도우 위인지 확인 |
| `onBadgesUpdated` | on | 렌더러 동기화 |

### 6.4 튜토리얼 시스템 (v1.2.0+ → 1.3.x WIP)

[tour/](frontend/src/tour/) — 인터랙티브 투어 + 샌드박스.

**동작**: data-tour-id 속성을 단 DOM 요소를 spotlight + 팝오버. `advanceOn` 조건(클릭/입력/외부 이벤트)에 따라 진행.

**파일**:
- `tours.ts` — Tour/TourStep 정의 (data, not React)
  - `TourStep`: dataTourId / selector / title / body / advanceOn / condition / expects
- `TourOverlay.tsx` — spotlight 마스크 + 팝오버 + 진행 핸들러
- `TutorialBanner.tsx` ★ — 진행 상태 표시 배너 (WIP)
- `SandboxExitModal.tsx` ★ — 샌드박스 모드 종료 confirm (WIP)
- `sandbox.ts` ★ — 튜토리얼 모드 데이터 시드 함수 (WIP)

**자동 팝업 조율**: [lib/userBusy.ts](frontend/src/lib/userBusy.ts) ★(WIP)
```typescript
const busy = new Set<string>();         // 'modal:welcome', 'drag', ...
export function setBusy(key, on) { ... }
export function isUserBusy() { return busy.size > 0; }
export function whenIdle(fn) { ... }    // 유휴 시 fn 실행
```
컴포넌트는 `useBusyMark('modal:item-edit', open)` 훅으로 자동 push/pop. 효과: WelcomeWizard / TourOverlay / PaywallModal이 동시 팝업되지 않음.

### 6.5 온보딩 팩 (v1.3.0)

[onboarding/](frontend/src/onboarding/) — 첫 실행 시 페르소나 선택 → 템플릿 자동 적용.

- `WelcomeWizard.tsx` — 5개 페르소나 (dev/design/student/general/blank)
- `templates.ts` — 함수형 팩토리 (호출 시마다 새 ID 발급)
- `ImportWizard.tsx` — .nost / .json 백업 가져오기
- `importParsers.ts` — 백업 포맷 파싱
- `FirstCardCelebration.tsx` — 첫 카드 추가 축하 애니메이션
- `EmptyState.tsx` (components/) — "템플릿으로 시작" 재진입 버튼

**튜토리얼 백업**: [main.js:1574](main.js)에서 샌드박스 진입 전 `userData/tutorial-backups/`에 타임스탬프 .nost 백업.

### 6.6 프리셋 (v1.2.0+)

3개의 완전 분리된 작업 공간. 각 프리셋이 자체 spaces/nodes/decks/badges 소유.

- UI: [PresetToggle.tsx](frontend/src/components/PresetToggle.tsx) — 3 pill, 더블클릭 이름 변경
- 게이트: 프리셋 2/3 진입 시 PaywallModal (free 한정 1)
- 슬래시: `/p1`, `/p2`, `/p3` 전환 (v1.2.0)

### 6.7 Pro-tier Entitlement (v1.2.1+)

[hooks/useEntitlement.ts](frontend/src/hooks/useEntitlement.ts) + [components/PaywallModal.tsx](frontend/src/components/PaywallModal.tsx).

- 14일 무료 체험: 첫 게이트 진입 시 클라이언트 측 자동 시작
- 게이팅 위치: 카드/스페이스/노드/덱/뱃지/프리셋/컨테이너 추가 또는 진입
- 검증: licenseKey + deviceId (서버 verify는 Phase 5 이후 작업)

---

## 7. 주요 아키텍처 패턴

### 7.1 AppContext 분리

```typescript
// contexts/AppContext.tsx
const AppStateContext   = createContext<AppState | null>(null);
const AppActionsContext = createContext<AppActions | null>(null);

// 사용
const { spaces, settings } = useAppState();
const { addSpace, deleteItem } = useAppActions();
```

### 7.2 DPI 처리 (멀티-DPI 모니터)

PS가 `.NET System.Windows.Forms.Screen`으로 Windows에서 직접 workArea 조회. Electron에서 좌표 변환 안 함.
- `_Position.ps1::Get-NativeWorkArea(monitorIndex)`
- `_Position.ps1::Move-WindowToRect`로 모든 창 배치 중앙화
- 모든 PS 호출에 timeout (run-tile-ps: 45s, maximize/snap: 10s, focus: 5s)

### 7.3 Store 앱 (WindowsApps) 실행

[ps-scripts/launch-or-focus-app.ps1](ps-scripts/launch-or-focus-app.ps1)의 3단계 폴백:
1. `Get-StartApps` → AUMID로 실행
2. `Get-AppxPackage` + manifest → PackageFamilyName + AppId
3. 경로에서 직접 AUMID 파싱 (`Name_PublisherId!AppId`)

### 7.4 타일링 파이프라인

```
[노드] handleNodeGroupLaunch (useNodeDeckMode.ts)
  → launchItemsForTile (앱 실행, fire & forget)
  → runTilePs ─┬─ Browser: SSE 폴링 15초 (main.js)
               └─ App/Window: run-tile-ps.ps1 (30초 폴링 + 스마트 settle)

[덱] handleDeckLaunch
  → 각 아이템 개별 실행 + checkItemsForTile 폴링 (300→500→1000ms 적응적)
  → maximizeWindow

[단일] launchAndPosition (useLaunchPipeline.ts)
  → launchOrFocusApp → 폴링 (400ms × 최대 15s) → maximizeWindow
```

`Settle 스마트화`: `GetWindowRect`로 위치 확인 → 맞으면 조기 탈출.

---

## 8. IPC 핸들러 카탈로그 ([main.js](main.js))

### 데이터
| 채널 | 타입 | 용도 |
|------|------|------|
| `store-load` | invoke | AppData 로드 |
| `store-save` | invoke | AppData 저장 |
| `export-data` | invoke | .nost 내보내기 |
| `import-data` | invoke | .nost / .json 가져오기 |
| `auto-backup-data` | invoke | 자동 백업 |
| `analyze-clipboard` | invoke | 클립보드 타입 판별 |

### 실행 & 창
| 채널 | 타입 | 용도 |
|------|------|------|
| `launch-or-focus-app` | invoke | 앱 실행/포커스 (3단계 AUMID) |
| `focus-window` | invoke | 제목으로 포커스 |
| `maximize-window` | invoke | 최대화 |
| `resize-active-window` | invoke | 비율 조정 (50/75/100) |
| `snap-window` | invoke | 좌/우/상 스냅 |
| `check-items-for-tile` | invoke | 창 생존 확인 |
| `launch-items-for-tile` | invoke | 타일용 일괄 실행 |
| `run-tile-ps` | invoke | 타일 배치 |
| `tile-windows` | invoke | /tile 전체 흐름 |

### 파일/아이콘
| 채널 | 타입 | 용도 |
|------|------|------|
| `pick-folder` | invoke | 폴더 다이얼로그 |
| `pick-exe` | invoke | exe 다이얼로그 |
| `check-file-exists` | invoke | 파일 존재 |
| `get-file-icon` | invoke | **앱/파일 아이콘 → data URL** ([main.js:1477](main.js)) |
| `open-path` | send | 탐색기 열기 |
| `open-userdata-folder` | invoke | %APPDATA%\nost 열기 |

### 스캔
| 채널 | 타입 | 용도 |
|------|------|------|
| `get-open-windows` | invoke | 열린 창 목록 |
| `check-windows-alive` | invoke | 제목으로 생존 |
| `get-recent-items` | invoke | Windows Recent |
| `detect-dialog` | invoke | 파일 대화상자 감지 |
| `jump-to-dialog-folder` | send | 대화상자 경로 이동 |

### 모니터/창 메타
| 채널 | 타입 | 용도 |
|------|------|------|
| `get-monitors` | invoke | 모니터 배열 |
| `identify-monitors` | invoke | 번호 매김 + 플래시 |
| `get-window-position` | invoke | 메인 좌표 |
| `window-move` / `window-drag-end` | send | 메인 드래그 |
| `hide-app` | send | 메인 숨김 |
| `set-opacity` | send | 투명도 |
| `update-shortcut` | send | 단축키 변경 |

### 플로팅 Orb
`floating-toggle-main`, `floating-context-menu`, `floating-drag-{start,heartbeat,end}`, `notifyFloatingSettingsChanged`, `onFloatingSettingsChanged`

### 플로팅 뱃지
`badges-{pin,unpin,reposition,launch-item,launch-ref,set-capture,context-menu,is-inside-main}`, `onBadgesUpdated`

### 브라우저 확장
`getExtensionBridgeStatus`, `openExtensionInstallHelper`

### 기타
`open-url`, `open-guide`, `copy-text`, `run-cmd`, `check-for-updates`, `install-update`, `nost-log`, `set-loading-status`, `open-logs-folder`

---

## 9. 빌드 & 실행

```bash
# 개발
cd frontend && npm run dev        # Vite (http://127.0.0.1:5173)
cd .. && npm start                # Electron (frontend/dist 로드)

# 빌드
npm run build:frontend            # → frontend/dist/
npm run dist                      # → release/ (exe + portable)

# 트러블슈팅
taskkill /f /im electron.exe      # 포트/프로세스 충돌
```

---

## 10. 현재 WIP 상태 (커밋 전)

```
M  frontend/src/App.tsx
M  frontend/src/badges/Badge.tsx
M  frontend/src/components/ItemDialog.tsx
M  frontend/src/components/ItemWizard.tsx
M  frontend/src/components/PaywallModal.tsx
M  frontend/src/components/SettingsDialog.tsx
M  frontend/src/components/SpaceAccordion.tsx
M  frontend/src/electronBridge.ts
M  frontend/src/onboarding/ImportWizard.tsx
M  frontend/src/onboarding/WelcomeWizard.tsx
M  frontend/src/tour/TourOverlay.tsx
M  frontend/src/tour/tours.ts
M  main.js
M  package.json
M  preload.js
?? frontend/src/lib/userBusy.ts            ← 신규: busy 상태 레지스트리
?? frontend/src/tour/SandboxExitModal.tsx  ← WIP: 샌드박스 종료 confirm
?? frontend/src/tour/TutorialBanner.tsx    ← WIP: 투어 진행 배너
?? frontend/src/tour/sandbox.ts            ← WIP: 샌드박스 데이터 시드
```

**추정 작업 방향**: 튜토리얼/샌드박스 모드 완성을 위해 자동 팝업 조율(userBusy), 진행 상태 가시화(TutorialBanner), 샌드박스 진입/이탈 플로우(SandboxExitModal, sandbox.ts) 동시 작업 중.

---

## 11. 알려진 이슈 / 향후 과제

### 해결됨
- ✅ DPI 혼합 모니터 타일링 (.NET Screen 직접 조회)
- ✅ Store 앱 실행 (3단계 AUMID)
- ✅ Props drilling (AppContext)
- ✅ App.tsx 비대화 (1,600 → 1,300, 그러나 다시 2,961로 증가 — 재정리 필요)
- ✅ 자동 업데이트 404 (public repo)
- ✅ EADDRINUSE 크래시 (extServer graceful shutdown, v1.0.10)
- ✅ 스페이스 드래그 데이터 손실 (v1.2.1)
- ✅ 페어 모델 안정화 (v1.0.13)

### 진행 중
- 🔄 **튜토리얼/샌드박스 모드** (WIP)
- 🔄 **userBusy 자동 팝업 조율** (WIP)
- 🔄 **Pro-tier 서버 검증** (Phase 5 이후)

### 미해결 / 연구 중
- 🔍 **Favicon 캐싱** ([research_favicon_caching.md](research_favicon_caching.md) 참고) — 한번 가져온 favicon을 영구 보관할 수 있는 방안
- 🔍 App.tsx 2,961줄 재분리 (다시 비대화됨)
- 🔍 ItemDialog ↔ ItemWizard에 favicon 로직 중복 → 공유 훅으로 추출 필요
- 🔍 다운로드 감지를 폴링 대신 `SetWinEventHook`으로
- 🔍 3분할 타일 안정성 개선
- 🔍 고스트 카드 UX 세분화 (스페이스 선택 UI)
