# nost — 개발 컨텍스트 워크스루

> 정본 — 옛 walkthrough.md / PROJECT_NOTES.md / research_favicon_caching.md 는 v1.3.34 시점에 일몰됨.
> 마지막 업데이트: 2026-05-14 (v1.3.33 출시 + v1.3.34 미커밋 작업 진행 중)
> **새 세션 시작 시**: 먼저 [`MASTER.md`](MASTER.md) 를 읽고, 거기서 가리키는 순서대로 본 파일 + plans/* 를 읽으세요.

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
| v1.3.4~7 | **미디어 컨트롤 / 컬러 스와치 위젯**, 컨테이너 bloom UX |
| v1.3.8~12 | Chrome 웹스토어 등록, **Save-As 컨텍스트 팝업** (자주 가는 폴더 빠른 paste), 다중 DPI Node/Deck fix |
| v1.3.15 | **모니터 SSOT** (per-monitor BrowserWindow), 렌더링 폭풍 진압 (~7000 re-render 제거), 네이티브 다이얼로그 감지 (koffi user32) |
| v1.3.22~27 | 튜토리얼 시스템 v2 (sprint 1+2 — 18 quests × 5 카테고리), 스포트라이트 정합성, 단축키 교육 |
| v1.3.28~31 | **충돌 회피 정책** (`canPerform()` + shake feedback), launch SSOT 정착, 컬러피커 정착, 다이얼로그 정렬 |
| v1.3.32 | 알림센터 SSOT (확장 끊김 배너 → kind:'system' 통합), guide.md 갱신 |
| v1.3.33 | **calm-by-default 알림** (`extensionEverConnected` latch, stale-update sweep), 튜토리얼 daily nudge 알림센터 미러, Whale 분기 제거 |
| v1.3.34 | 환경설정 Option C 재구조화 (4 groups × 2-3 sub-tabs), **doc 코호트 first-class type 승격**, ItemWizard segmented tab (카드/메모), **공식 Google/GitHub 브랜드 마크**, **Auth CSP allowlist + PKCE verifier safeStorage 영속화**, Phase 2 sync 범위 합의 + cohort SSOT 골격 |
| v1.3.35 | **Single-instance lock 강화** (second instance `process.exit(0)`) + **DocCohortDialog 깨짐 fix** + **Dialog 너비 SSOT 도입** (`dialog.tsx` 의 `DIALOG_SIZE` 토큰 + `<DialogContent size="sm\|md\|lg\|xl">` 패턴, ssot-index §A.17) |
| v1.3.36 | **Auth loopback HTTP callback** — `nost://` protocol 대신 `http://127.0.0.1:14502/auth/callback` 사용. 새 electron 인스턴스 spawn 없음 (single-instance race 우회). 사용자에게 "로그인 완료" HTML 페이지 직접 응답. **로그인 토스트** 추가 (sessionStorage flag 패턴). **Dialog minWidth** 도입 (좁은 pair-split 윈도우에서도 contents 안 깨짐). **DocCohort suffix wildcard** — mask 의 per-revision suffix 가 `{*}` placeholder 가 되어 `_260513.pptx` / `_260512_콘진.pptx` / `_260511_F.pptx` 같은 변형이 모두 같은 cohort 로 인식 + 옛 binding 자동 reset |
| v1.3.37 | **path → type 분류기 SSOT 회귀 fix** — `handleFileDrop` 의 URL/text 폴백 + `/clipboard` 슬래시 명령어 2곳에서 `isPath ? 'folder' : ...` 하드코딩이 `inferItemFromPath` SSOT 를 우회. .pptx 등 OneDrive virtual file 처럼 `dataTransfer.files` 가 비고 text/uri-list 로만 들어올 때 확장자 검사 없이 'folder' 로 저장되던 v1.3.34 회귀. **Save-As 컨텍스트바 위치** — title bar 18px 오버랩에서 dialog 위 6px 여백 외부로 이동 (사용자 선호 환원). **Save-As 컨텍스트바 정밀도** — `#32770` 자식 walk (`GetWindow` GW_CHILD/HWNDNEXT) 로 "저장/Save"+"취소/Cancel" Button 쌍 검사 → `isFileDialog` 산출. Slack/Discord 등 third-party `#32770` 차단 |
| v1.3.38 | **Phase 2.A 수동 동기화 MVP** — Supabase 기반, 사용자 클릭 시에만 (백그라운드 push 없음). lib/sync/{device, snapshot, index}.ts 신규. Local-first union 머지 (로컬 카드 절대 안 덮어쓰임). 디바이스 등록/조회/삭제 UI. **창 모서리 드래그 → 슬라이더 % 자동 반영** (main 'resized' → IPC → renderer settings 패치) |
| v1.3.39 | **성능 측정 probe** — IPC 채널별 호출수, electron-store 쓰기 빈도, 타이머 tick, React 리렌더 횟수를 10초 윈도우로 main.log 에 집계. `[perf]` prefix. 자세히 `plans/perf-probe.md` |
| v1.3.40 | **렉 fix** — `ItemCard`/`MemoCard`/`SpaceAccordion` 에 `React.memo` + 커스텀 comparator (콜백 ref 무시, 데이터 필드만 비교). 클립보드 분류 캐시 (analyze-clipboard IPC 가 텍스트 hash 동일 시 cached return). App 1회 리렌더에 카드 41개 다 따라가던 패턴 해결 |
| v1.3.41 | **doc 드롭 fix (커스텀 docExtensions 반영)** — `plausibleTypes(v, docExts?)` 시그너처 변경, App.tsx 가 `data.settings.documentExtensions` 전달. **SortableSpace transform 'none' 정책** — dnd-kit 자동 shift 폐기 (페어 모델과 mismatch 로 3-열 시각 글리치). **컨텍스트바 BFS** — depth 5 walk 로 modern Common Item Dialog (DirectUIHWND 중첩) 의 버튼 발견. 타이틀 fallback 안전망. **Free/Pro 게이팅 활성화** — `BETA_FORCE_PRO=false` flip. quotaChecks 활성화, PaywallModal 11 reason, 프리셋/스페이스/카드 잠금 UI |
| v1.3.42 (hotfix) | **`updateSettings` idempotent — 창 크기 조정 시 렌더러 크래시 fix**. base-ui Slider 가 array reference 변경에 onValueChange 발사 → updateSettings → 5개 IPC + save 무조건 발사 → setRawData → 재렌더 → 슬라이더 재발사 → 무한 루프. IPC 100회+/10s, 4.5MB 디스크 쓰기, 결국 renderer 크래시. fix: updateSettings 가 각 IPC 를 해당 필드 실제 변경 시에만 발사 + settings JSON 동일 시 save skip. perf-probe 가 진단 결정적이었음 (v1.3.39 의 보람) |
| Free/Pro 조정 (미커밋, 2026-05-16) | 카드 16→40, 프리셋 1→2, 플로팅 뱃지 1→2, 위젯 1→2. 메모 정리도구 (markdownify 등) Pro→Free 전환 (preview 만 Pro 유지). `canUsePreset` 로직 데이터-드리븐으로 일반화. 자세히 `plans/free-pro-policy.md` |

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

## 10. 현재 WIP 상태 (v1.3.42 출시 완료, Free/Pro 조정 미커밋)

> 매 세션마다 갱신 — `git status --short`로 직접 확인하세요.
> v1.3.37 ~ v1.3.42 전부 출시됨 (GitHub Releases). 자세히는 §0 변경 요약 + §11 해결됨.

### 미커밋 변경 (2026-05-16)

**Free/Pro 정책 조정** — 한도 너그럽게, 명확한 paywall 라인 유지:

| 자원 | 이전 | 지금 |
|---|---|---|
| 카드 | 16 / preset | **40** / preset |
| 프리셋 | 1 | **2** (3만 잠금) |
| 플로팅 뱃지 | 1 | **2** |
| 위젯 카드 | 1 / preset | **2** / preset |
| 메모 정리도구 (markdownify 등) | Pro | **Free** (텍스트 변환은 단독 유용) |

변경 파일: `types.ts FREE_LIMITS`, `useEntitlement.ts` (`canUseMemoMarkdownCleanup` 신규, `canUsePreset` 데이터-드리븐), `PaywallModal.tsx` (카피 4건), `MemoEditor.tsx` (정리기 게이트 분리), `App.tsx` (prop 전달).

자세히 `plans/free-pro-policy.md` (Free/Pro 정책 SSOT, 결정 로그, 추가 게이트 체크리스트).

### 다음 라운드 작업 후보

**우선순위 1 — 결제 인프라 (Pro 실제 발급)**
- Supabase Function — license verify endpoint (key + deviceFingerprint → JWT 서명)
- Stripe / Toss webhook → license 발급
- PaywallModal "Pro로 업그레이드" 버튼 → checkout flow 연결
- 무료 체험 (trial) 자동 발급 — `newTrialLicense()` 호출 site 추가 (첫 Pro 게이트 hit 시)

**우선순위 2 — Phase 2.B Realtime + memos 분리**
- Supabase Realtime channel 구독 (`app_data_snapshots` + `memos`)
- 메모 body → `memos` 별도 테이블 (large body 분리, 향후 full-text search)
- (`plans/sync-and-auth.md` §11 Phase 2 의 미완 부분)

**우선순위 3 — 메모 폴더 sync 실제 구현**
- 게이트 (`canUseMemoFolderSync`) 만 깔려있고 실제 sync 로직 미구현
- `exportFolder` 설정 옆에 "자동 동기화" 토글 (Pro)
- memo body 변경 watcher → 폴더에 .md 파일 mirror
- 단방향 (memo → folder). Obsidian Vault 호환

**우선순위 4 — 튜토리얼 Pro 뱃지**
- quest 에 "Pro" 표시
- Free 사용자가 Pro quest 시도 → "구경하기 모드" (실제 기능 잠금)

**우선순위 5 — PS 폴백 detect-dialog.ps1 에 BFS 미러링** (정밀도 개선 완성용, koffi init 실패 케이스 대비)

### v1.3.34 출시분 (참고용 — 자세히는 §0 변경 요약 + §11 해결됨)

1. **환경설정 Option C 재구조화** — 8 flat tabs → 4 그룹 × 2-3 sub-tabs
   - "나의 nost": 계정 · 데이터
   - "작업 환경": 테마 및 색상 · 동작 · 플로팅 및 모니터
   - "콘텐츠 규칙": 메모 · 문서
   - "도움": 튜토리얼 · 확장
   - `Section` 컴포넌트 shadcn-풍 아코디언 (gray box 제거, hairline divider, chevron toggle)

2. **문서 코호트 first-class type 승격** — `LauncherItem.type`에 `'doc'` 추가
   - 7개 분류기 (inferItemFromPath, analyzeClipboard IPC, detectClipboardType, ItemWizard, ContainerSlotPicker, ItemDialog auto-prefill, batch drop) 모두 doc 반환
   - 마이그레이션: 기존 `'app'` 카드 중 `documentExtensions`에 매치되는 항목 자동 reclassify
   - 사용자 설정 (`AppSettings.documentExtensions`) 기반 SSOT — 모든 지점이 동일 리스트 사용

3. **빠른 추가 (ItemWizard) 재설계** — 하단 3-버튼 → 상단 segmented tab + 단일 추가
   - text 타입일 때만 노출: `[클립보드 카드] [메모]` segmented control
   - 메모 탭: 이름 필드 + 아이콘 영역 자동 숨김 (메모는 body 첫 줄이 title)

4. **알림 카테고리 뱃지** — `NotificationPanel.deriveCategory()` 신설
   - `action.intent === 'open-tour'` → `[튜토리얼]` 뱃지
   - `dedupKey` 가 `ext-*` → `[확장]` 뱃지
   - 미래 카테고리 추가는 deriveCategory 한 줄

5. **세 곳의 튜토리얼 nudge → 알림센터 미러링** (v1.3.33의 누락 fix)
   - TutorialProvider daily nudge
   - TutorialProvider resume prompt
   - NudgeToast 이벤트 nudge (`installNudges` ToastApi에 `addNotification` 추가)

6. **호버 힌트 어투 폴리쉬** — "짧게/길게" → "클릭/길게 누르기", "발사" 등 캐주얼 어휘 제거
   - widgets/widgetTokens.ts `HOVER_HINT` 헬퍼 docstring 갱신

7. **저장 버튼 좌우 padding 전수 fix** — 8개 버튼의 `padding: 'Npx 0'` / `'Npx 8px'` → `14~18px` 보정
   - NodePanel × 2, DeckPanel × 1, WelcomeModal × 2, ItemWizard WizardBtn × 1

8. **컨테이너 호버 ContainerSlotGhosts 일몰** — 4-corner dot은 유지, hover 시 펄럭이는 ghost rectangles 제거 + 파일 삭제

9. **ItemDialog Tab/Enter 페이지네이션** — Tab=다음 / Shift+Tab=이전 / Enter Enter=완성, 양옆 글래스모피 `< / >` 버튼

10. **Whale 분기 제거** — Chrome 확장 단일 카드 (Whale 사용자도 동일)

11. **공식 Google/GitHub 브랜드 마크** (2026-05-14)
    - `frontend/src/components/ui/BrandLogo.tsx` 신규 — `GoogleLogo` (공식 4색 G, viewBox 48), `GitHubLogo` (공식 Invertocat 실루엣, `currentColor`)
    - SignInScreen 의 `ProviderButton` API 가 `icon: string` → `leading: ReactNode` 로 변경
    - SettingsDialog AccountTab 의 Google 버튼은 AccentBtn 배경 위에 작은 흰색 pill 로 감싸 브랜드 가이드라인 준수

12. **Auth CSP allowlist** (2026-05-14, `main.js` CSP 블록)
    - `connect-src` 에 `https://*.supabase.co` + `wss://*.supabase.co` 추가 (Phase 2 Realtime 까지 미리 반영)
    - `img-src` 에 `https://lh3.googleusercontent.com` (Google 아바타), `https://avatars.githubusercontent.com` (GitHub 아바타), `https://*.supabase.co` (Supabase Storage 아바타 미래분) 추가
    - 빠뜨리면: PKCE 토큰 교환 fetch 가 차단되어 deep-link 받은 후 토큰 못 받음 → SignInScreen 에서 영원히 못 빠져나옴

13. **PKCE verifier safeStorage 영속화** (2026-05-14, IPC 4-file)
    - 증상: dev mode 에서 `nost://auth-callback` 클릭 시 Windows 가 두 번째 electron.exe 를 spawn → 새 인스턴스가 lock 잡으면 첫 인스턴스의 renderer 메모리에 있던 PKCE `code_verifier` 손실 → 토큰 교환 실패
    - 해결: supabase-js 의 storage adapter 가 **모든 key** (verifier 포함) 를 safeStorage 영속화. 새 인스턴스가 boot 시 `hydrateSession()` 의 `authKvList()` 로 일괄 복원
    - 변경 파일: `main.js` (`auth:kv-get/set/list` IPC 신설, safeStorage 암호화), `preload.js` (3 메서드 노출), `frontend/src/electronBridge.ts` (타입 + noopApi), `frontend/src/lib/supabase.ts` (adapter 모든 키 영속화 + hydrate 일괄 복원)
    - 부분 fix — production installer 로 가면 single-instance lock 이 정상 작동해 인스턴스 분리 자체가 안 일어남. PKCE 영속화는 그래도 "어떤 인스턴스가 콜백 받든 OK" 안전망

14. **Phase 2 sync 범위 합의** (2026-05-14, `plans/sync-and-auth.md` §15)
    - Cohort A (sync): url / memo / widget / text / browser
    - Cohort C (PC-local): app / folder / doc / window / cmd
    - Cohort D (디바이스 settings 절대 sync X): shortcut / autoHide / monitorDirections 등
    - Cohort D-but-shared (default sync, 사용자 명시 override 시 분기): theme / accentColor / documentExtensions / docCohort / memo 설정
    - `plans/sync-and-auth.md` §14 #3 "기존 폴더 카드 처리" 답도 함께 적음

15. **Phase 2 SSOT 골격** (2026-05-14)
    - `frontend/src/lib/cohort.ts` — `cohortOf(type)` 함수 + `SYNCED_TYPES` / `LOCAL_TYPES` 상수. 향후 sync push/pull 분기 진입점
    - `plans/phase2-schema.sql` — Supabase 대시보드에서 실행할 DDL (app_data_snapshots / memos / devices + RLS)
    - 실제 sync 코드는 Phase 1 E2E 검증 후 별도 라운드에서

### 이전부터 진행 중 (별도 사이클)

- 🔄 **인증 Phase 1 E2E 검증** — `plans/auth-status.md` §3·§4 체크박스 미완. v1.3.34 production installer 로 검증 예정
- 🔄 **App.tsx 분리** — 4400줄+ → 도메인별 훅 (refactor-roadmap Round 3)
- 🔄 **Settings SSOT** — main이 소유, renderer는 IPC subscribe (Round 2)

### 신규 빈 폴더 / 파일
- `plans/_archive/` 없음 — 일몰 파일은 직접 삭제 (`research_favicon_caching.md`, 옛 `walkthrough.md`, `PROJECT_NOTES.md`, `frontend/README.md`)

---

## 11. 알려진 이슈 / 향후 과제

### 해결됨
- ✅ DPI 혼합 모니터 타일링 (.NET Screen 직접 조회)
- ✅ Store 앱 실행 (3단계 AUMID)
- ✅ Props drilling (AppContext)
- ✅ 자동 업데이트 404 (public repo)
- ✅ EADDRINUSE 크래시 (extServer graceful shutdown, v1.0.10)
- ✅ 스페이스 드래그 데이터 손실 (v1.2.1)
- ✅ 페어 모델 안정화 (v1.0.13)
- ✅ 모니터 SSOT (v1.3.15 — per-monitor BrowserWindow)
- ✅ 렌더링 폭풍 (v1.3.15 — ~7000 re-render 제거)
- ✅ 충돌 회피 정책 정착 (v1.3.31 — `canPerform()` SSOT)
- ✅ 확장 끊김 알림 false-positive (v1.3.33 — `extensionEverConnected` latch)
- ✅ Stale "설치 준비 완료" 알림 (v1.3.33 — boot sweep)
- ✅ 튜토리얼 nudge 알림센터 누락 (v1.3.34 — 3 경로 모두 미러링)
- ✅ 문서 코호트 분류 분산 (v1.3.34 — `'doc'` first-class)
- ✅ 환경설정 8-flat-tab → 4 그룹 × 2-3 sub-tabs (v1.3.34 Option C)
- ✅ 다이얼로그 푸터 버튼 좌우 padding 부족 8군데 (v1.3.34)
- ✅ Whale 분기 이중관리 (v1.3.34 — 단일 Chrome 확장으로 통합)
- ✅ Auth 일반 자물쇠/꺾쇠 아이콘 → 공식 Google·GitHub 브랜드 마크 (v1.3.34)
- ✅ Auth CSP 차단 — supabase 도메인 누락 (v1.3.34 — connect-src/img-src allowlist)
- ✅ PKCE verifier 인스턴스 분리 시 손실 (v1.3.34 — `auth:kv-*` IPC + 모든 키 영속화)
- ✅ Phase 2 sync 범위 결정 (v1.3.34 — `plans/sync-and-auth.md` §15 + `lib/cohort.ts` SSOT)
- ✅ OAuth 콜백 시 새 인스턴스 spawn + 첫 인스턴스 종료 race (v1.3.35 — `process.exit(0)` 으로 second instance module init 즉시 중단). 증상: 로그인/로그아웃 흐름 직후 nost 가 트레이까지 사라짐
- ✅ DocCohortDialog "다른 파일 선택" 시 컨테이너가 좁게 squeeze (v1.3.35 — `dialog.tsx` default `sm:max-w-sm` 가 인라인 width 를 깎던 문제. `size` prop + `DIALOG_SIZE` 토큰 SSOT 도입, ssot-index §A.17 + anti-pattern-grep §1.4)
- ✅ OAuth 콜백 흐름 — 새 nost 인스턴스 spawn + "supabase.co로 이동" 빈 페이지 (v1.3.36 — loopback HTTP callback `127.0.0.1:14502/auth/callback` + main.js ext-server 가 "로그인 완료" HTML 응답)
- ✅ 로그인 성공 시 토스트 누락 (v1.3.36 — `auth.ts` 가 signed-out → signed-in 전환 시 sessionStorage flag, App.tsx 첫 mount 에서 1회 showToast)
- ✅ pair-split 좁은 mainWindow 에서 dialog contents 깨짐 (v1.3.36 — `DIALOG_SIZE` 의 sizeStyle 에 minWidth 추가, 320px floor)
- ✅ DocCohort 가 같은 폴더의 버전 1개만 인식 (v1.3.36 — `rebuildMask` 가 suffix 를 `{*}` 와일드카드로 처리. main.js 의 mask→regex 변환에서 `{*}` 도 `.*?` 으로. 옛 binding 은 `maybeResetStaleCohortBinding` 마이그레이션이 자동 reset)
- ✅ .pptx 드롭이 'folder' 로 오분류 (v1.3.37 — `handleFileDrop` 의 text-fallback 분기와 `/clipboard` 슬래시 명령어 2곳에서 `isPath ? 'folder' : ...` 하드코딩이 `inferItemFromPath` SSOT 우회. 둘 다 SSOT 경유로 교체)
- ✅ Save-As 컨텍스트바가 dialog title bar 에 걸침 (v1.3.37 — `y = rect.y - STRIP - 6` 으로 dialog 외부 위치로 환원, 사용자 선호)
- ✅ Save-As 컨텍스트바가 Slack/Discord 등 비-파일-dialog 에서도 뜸 (v1.3.37 — `foreground-window.js` 에서 #32770 자식 walk + Button "accept+cancel" 쌍 검사로 `isFileDialog` 판정. 제목 블랙리스트 폐기)
- ✅ 창 모서리 드래그 후에도 슬라이더 % 가 옛 값에 머무름 (v1.3.38 — main 'resized' 이벤트에서 pct 재계산 + IPC `window-size-pct-changed` → renderer settings 패치. 200ms debounce + 1pct 가드로 echo 방지)
- ✅ Phase 2.A 수동 동기화 MVP — Supabase 기반, manual-only 모델 (v1.3.38). lib/sync/{device, snapshot, index}.ts. Local-first union 머지로 로컬 카드 절대 안 덮어쓰임. AccountTab 의 [현재 기기 추가] [동기화하기] 2-버튼 + 디바이스 목록 + 해제
- ✅ 성능 진단 부재 (v1.3.39 — IPC/store/timer/render 10초 윈도우 집계 main.log 에 자동 기록. `[perf]` prefix. `plans/perf-probe.md` 참조)
- ✅ App 1회 리렌더에 카드 41개 다 따라 리렌더되는 패턴 (v1.3.40 — `ItemCard`/`MemoCard`/`SpaceAccordion` 에 React.memo + 커스텀 comparator. 콜백 무시 + 데이터 필드만 비교. perf log 의 ItemCard×897 → 수십 단위로 감소)
- ✅ 클립보드 분류기 idle 시에도 1.5초마다 full 재계산 (v1.3.40 — main.js analyze-clipboard 에 텍스트 hash + docExts 캐시. 동일 입력 시 즉시 cached return)
- ✅ 커스텀 docExtensions 무시되는 plausibleTypes (v1.3.41 — `plausibleTypes(v, docExts?)` 시그너처 변경. App.tsx 가 `data.settings.documentExtensions` 전달. epub 등 사용자 추가 확장자도 doc 인식)
- ✅ 스페이스 페어 드래그 시 3-열 시각 글리치 (v1.3.41 — `SortableSpace` 의 dnd-kit auto-shift transform 폐기 (`transform: 'none'`). drag overlay + drop indicator 만으로 정확한 신호 전달. Notion/Linear 패턴)
- ✅ Modern Save-As (DirectUIHWND 중첩) 에서 컨텍스트바 안 뜸 (v1.3.41 — `foreground-window.js` 의 자식 walk 를 BFS depth 5 로 확장. 타이틀 fallback 안전망 추가)
- ✅ Free/Pro 게이팅 비활성 (v1.3.41 — `BETA_FORCE_PRO=false`. PaywallModal 11 reason 연결. 프리셋 탭 / +스페이스 / +카드 / 메모 마크다운 / .md 저장 잠금 UI)
- ✅ 창 크기 조정 시 렌더러 크래시 + 창 멈춤 (v1.3.42 hotfix — `updateSettings` 가 5개 IPC 무조건 발사하던 게 base-ui Slider 와 무한 루프 형성. fix: 각 IPC 가 해당 필드 실제 변경 시에만 발사 + settings JSON 동일 시 save skip. perf-probe 가 진단 결정적이었음)

### 진행 중
- 🔄 **인증 Phase 1 E2E** — `plans/auth-status.md` §3·§4 (외부 console 작업)
- 🔄 **App.tsx 분리** — 4400줄+ (refactor-roadmap Round 3)
- 🔄 **Settings SSOT** — Round 2
- 🔄 **Tutorial trigger callee-fires** — Round 4
- 🔄 **Pro-tier 서버 검증** — Phase 2 (sync)

### App.tsx 라인 수 추이 (재정리 필요 시그널)
- v1.0.9: 1,600
- v1.3.x: 2,961
- v1.3.34: 4,400+ (Round 3 분리 시점)

### 미해결 / 연구 중
- 🔍 **Favicon 캐싱** — v1.3.3에서 net.fetch 기반 캐싱 구현됨. 추가 개선 후보: cache TTL 정책, 만료된 캐시 자동 갱신
- 🔍 App.tsx 4,400+줄 재분리 (refactor-roadmap Round 3)
- 🔍 ItemDialog ↔ ItemWizard에 favicon 로직 중복 → 공유 훅으로 추출 필요
- 🔍 다운로드 감지를 폴링 대신 `SetWinEventHook` 이벤트 기반으로 (v1.3.15에서 koffi user32 직접 호출로 1차 가속됨, 추가 개선 여지)
- 🔍 3분할 타일 안정성 개선
- 🔍 고스트 카드 UX 세분화 (스페이스 선택 UI)
- 🔍 테스트 커버리지 확대 — 현재 `lib/typePlausibility.test.ts` 1개뿐

---

## 12. 세션 인수인계 룰 (정착 필수)

> 새 세션이 시작될 때 stale 정보로 작업하지 않도록 보장하는 메커니즘.
> 본 룰을 어기면 다음 세션이 잘못된 가정으로 작업 시작 → 회귀 발생.

### 12.1 세션 종료 시 의무 갱신

작업 마치고 대화 클리어 / 컨텍스트 컴팩트 전에:

| 갱신 대상 | 트리거 |
|---|---|
| **walkthrough_v2.md §10 WIP** | 이번 세션에서 코드 / 문서 변경분 있을 때 (커밋 여부 무관) |
| **walkthrough_v2.md §11 해결됨** | 어떤 항목이 커밋 + 배포 완료됐을 때 §10 → §11 이동 |
| **§0 변경 요약 표** | 새 버전 출시되면 한 줄 추가 |
| **plans/ssot-index.md** | 새 SSOT 만들었거나 코드 파일/라인 위치 옮겼을 때 |
| **MASTER.md §1** | 출시 버전 변경 시 (`현재 출시 버전`, `미커밋 작업`) |
| **MASTER.md §3.x** | 새 plan 추가 또는 plan 이름 변경 시 인덱스 갱신 |
| **plans/anti-pattern-grep.md** | 이번 세션에서 새 anti-pattern 발견 시 grep 추가 |
| **plans/checklists.md** | 4가지 표준 작업 (카드 타입 / IPC / 모달 / 설정) 외에 반복 패턴 발견 시 §X 신설 |
| **plans/troubleshooting.md** | 빌드/런타임 새 실패 모드 만났을 때 |
| **plans/ui-vocabulary.md** | 새 UI 동사 추가 또는 사용자가 어휘 피드백 줬을 때 |
| **plans/release-runbook.md** | 배포 절차 변경 시 (e.g., gh CLI → action 등) |

### 12.2 새 세션 시작 시 확인 순서

```
1. MASTER.md 읽기                                                ← 30초
2. walkthrough_v2.md §10 (현재 WIP) + §0 (변경 요약) 확인        ← 1분
3. git status --short + git log --oneline -5                    ← 10초
4. (작업 영역 결정 후) MASTER.md §3.2 표에서 해당 plan 1개 읽기   ← 5분
5. 작업 착수
```

### 12.3 stale 감지 휴리스틱

다음 경우 의심:
- walkthrough_v2 의 "마지막 업데이트" 일자와 `git log -1` 사이가 1주 이상
- §10 WIP 에 적힌 변경사항이 이미 §11 해결됨 으로 옮겨졌어야 할 것 같은 경우
- ssot-index 가 가리키는 `file:line` 이 실제 코드와 안 맞음

→ stale 감지 시 사용자에게 알리고 갱신 우선.

### 12.4 갱신 책임

- 코드 / 문서 변경 작업자가 같은 세션 안에서 갱신
- 사용자가 "정리해줘" 등 명시 요청 시 전수 점검 (이번 2026-05-14 작업 같이)
- 자동화 후보 (미래): pre-commit hook 으로 일자 freshness 체크
