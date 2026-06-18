# SSOT Index — nost 코드/문서 단일 진실 출처 인벤토리

> 모든 SSOT를 한 곳에 모아둔 색인. 어떤 값/규칙을 바꿀 때 "또 어디 미러가 있나?" 묻지 않게 하기 위함.
>
> 갱신 규칙: 새 SSOT를 만들거나 기존 SSOT를 옮길 때 **반드시 여기도 같이 갱신**. 미러를 만들지 말 것 — 만들면 항상 둘이 어긋난다.
>
> 분류: (A) 런타임 데이터·상태 SSOT → 코드 / (B) 설계·계획 SSOT → `plans/*.md`

---

## A. 런타임 / 코드 SSOT

각 항목: **무엇** · **어디** · **읽는 곳(consumers)**.

### A.1 윈도우 크기 (`windowSizePct`)
- **무엇**: 런처 BrowserWindow 크기를 work area의 % 로 표현 (25..100). zoom 아니고 `setBounds`.
- **타입 SSOT**: `frontend/src/types.ts:206` — `windowSizePct`, `DEFAULT_WINDOW_SIZE_PCT=100`, `WINDOW_SIZE_PCT_MIN=25`, `MAX=100`, `PRESETS=[25,33,50,66,75,100]`
- **런타임 SSOT (main)**: `main.js:971` `applyWindowSizePct(win, pct)` + `cachedWindowSizePct`
- **읽는 곳**:
  - cold-start `createWindow` (main.js:1850 부근)
  - `showMainWindow` 재적용
  - IPC `set-window-size-pct` (status bar slider, preset dropdown)
  - IPC `resize-active-window` (`/N` slash)
  - `frontend/src/components/StatusBar.tsx:34,149`
- **금지**: `webContents.setZoomFactor` 로 흉내내기. `did-finish-load`에서 `setZoomFactor(1.0)` 강제 리셋 중.

### A.2 윈도우 위치
- **규칙 SSOT**: `main.js:1850, 2052` — "cold start always centers, position NOT persisted".
- 사용자가 드래그한 위치는 의도적으로 저장 안 함.

### A.3 카드/스페이스 데이터 (electron-store)
- **디스크 SSOT**: `electron-store` (main 프로세스 소유, 계획상)
- **현재 상태**: localStorage 미러 + IPC가 4-way로 흐르는 상태 → Round 2에서 1-way로 정리 예정. (`plans/refactor-roadmap.md` Round 2)
- **읽는 곳**: `frontend/src/hooks/useAppData.ts` (renderer 측 진입점)
- ⚠️ **현재 SSOT 미정착**. 코드 고칠 때 미러 늘리지 말 것.

### A.4 스플릿 비율 (sidebar/main pair)
- **SSOT**: `frontend/src/hooks/useAppData.ts:553` — pair가 `splitRatio` 보유, [0.25, 0.75]로 clamp.
- **읽는 곳**: `App.tsx:493` (배열 shape), pair 렌더러.

### A.5 Pro / Entitlement
- **SSOT 훅**: `frontend/src/hooks/useEntitlement.ts` — "지금 사용자가 X 할 수 있는가?"의 단일 출처
- **읽는 곳**: `App.tsx:608` 및 모든 게이트
- **금지**: 컴포넌트 내부에서 license 필드 직접 비교

### A.6 Escape 키 처리
- **SSOT**: `frontend/src/lib/escapeStack.ts` — ESC 눌렀을 때 무엇이 닫히는지의 단일 스택
- **금지**: 컴포넌트마다 `keydown` 리스너 직접 달기

### A.6b Conflict avoidance policy (v1.3.31+)
- **정책 SSOT**: `plans/conflict-avoidance-policy.md` — 모드/모달 충돌 매트릭스 + 규칙
- **코드 SSOT**: `frontend/src/lib/conflictPolicy.ts` `canPerform(actionId, ctx)` — 모든 trigger 가 실행 전 통과
- **피드백 SSOT**: `frontend/src/lib/conflictFeedback.ts` — `shakeElement(el)` (220ms micro-shake) + `BLOCK_TOAST_DEFAULTS`. 차단 시 visible/audible 반응 일관성.
- **현재 마이그레이션 위치**: `ItemCard.handlePointerDown` (hold-press), `ItemCard.handleClick` (card.launch — v1.3.50), `ItemCard` contextmenu (card.edit), `App.tsx` Tab key (preset cycle), `App.tsx` cmd.open
- **policyCtx 전달**: ItemCard 등 카드 trigger 는 window-전역 충돌 상태를 `useAppState().policyCtx` (App 이 build) 로 받아 canPerform 에 넘김. ItemCard 가 dialog/memo/overlay/cmd 를 직접 못 보던 갭(satellite 다이얼로그 뒤 그리드 클릭) 해소 — v1.3.50.
- **주의**: `useLaunchPipeline.launchAndPosition` 은 canPerform 가드 **금지** — cmd 팔레트·badge 등 정당한 cross-context launch 의 공용 SSOT. 가드는 trigger 레이어 (카드 클릭) 에만.
- **금지**: 컴포넌트마다 `if (activeMode !== 'normal') return;` 같은 ad-hoc 모드 체크. 새 trigger 는 반드시 `canPerform` 통과 후 실행. 새 mode/modal 추가 시 정책 문서의 매트릭스 한 줄 + `conflictPolicy.ts:MODE_ALLOWLIST` 한 줄 추가가 유일한 의무.

### A.7 "현재 열린 창" 스캔
- **SSOT**: `frontend/src/lib/scanEngine.ts` — foreground/열린 창 enumeration
- **읽는 곳**: `useGhostCards.ts:130` (ghost 카드 동기화), ScanDialog, 그 외 "지금 뭐 열려있냐" 묻는 모든 곳
- **금지**: koffi/PS 호출 직접 흩뿌리기 — 전부 scanEngine 통과

### A.8 카드 launch pipeline
- **단일 항목 SSOT**: `frontend/src/hooks/useLaunchPipeline.ts:59` `launchAndPosition` — 모든 카드-실행 경로(메인 클릭/엔터/슬래시/단축키/플로팅 배지 미니윈도우 항목 클릭)는 이 파이프라인 통과
- **노드 그룹 SSOT**: `frontend/src/hooks/useNodeDeckMode.ts:241` `handleNodeGroupLaunch` — 메인 노드 헤더 클릭, 배지 노드 클릭, 미니윈도우 "묶음 실행" 모두 이리로 funnel
- **덱 SSOT**: `frontend/src/hooks/useNodeDeckMode.ts:277` `handleDeckLaunch` — 메인 덱 헤더, 배지 덱 클릭, 미니윈도우 "순차 실행" funnel
- **배지 → 메인 라우팅**: `main.js` `'badges-launch-item'` / `'badges-launch-ref'` IPC → 메인 렌더러 listener (`App.tsx:1272-1306`) → 위 SSOT 호출
- **OS-level launch SSOT (v1.3.31+)**: app/folder/window 타입의 실제 OS 실행은 **반드시 `ps-scripts/launch-or-focus-app.ps1` / `open-path.ps1` / `focus-window.ps1`** 통과. 단일 카드 path (`launch-or-focus-app` IPC) 와 노드/덱 tile path (`launchItemsForTile` → `fireLaunchItem` in main.js) 모두 같은 스크립트 사용. 이 스크립트들은 versioned-browser rebase (Chrome/Edge/Whale auto-update), AUMID `shell:AppsFolder` fallback (Store/MSIX), .lnk Arguments+WorkingDirectory 캐리오버 (Adobe/JetBrains) 등 통합 처리.
- **UX 일관성 (v1.3.28+)**: 메인 카드 1-click = 즉시 실행 ↔ 배지 1-click = 즉시 실행 (node/deck), space 배지만 미니윈도우 토글
- **금지**: 컴포넌트에서 직접 `launchOrFocus` IPC 호출, 배지에서 자체 launch 로직 (반드시 IPC 통해 메인 렌더러의 SSOT 사용), main.js 안에서 인라인 PS 스크립트로 launch 흉내내기 (반드시 dedicated `.ps1` 파일 사용 — 안 그러면 fallback 로직이 두 군데로 갈라져 일부 카드만 작동하는 버그 재발)

### A.9 카드 종류별 디자인 토큰
- **SSOT**: `frontend/src/widgets/widgetTokens.ts` — 카드/위젯 종류별 색·여백·border-radius
- **금지**: 컴포넌트 인라인 색/사이즈

### A.10 타입 그럴듯함(typePlausibility)
- **SSOT**: `frontend/src/lib/typePlausibility.ts:26` — "X에 어떤 타입이 말 되는가" 의 단일 정답표
- **읽는 곳**: 카드 추가 흐름, 자동 분류

### A.10b 이미지 확장자 (v1.3.46+)
- **renderer SSOT**: `frontend/src/lib/imageExtensions.ts` — `DEFAULT_IMAGE_EXTENSIONS`, `isImagePath`, `mimeFromExt`
- **main SSOT**: `main.js` `_IMAGE_EXTS` Set + `_isImagePath(p)` helper (analyze-clipboard 안)
- **읽는 곳**: `typePlausibility.ts` (path 분기), `App.tsx::inferItemFromPath`, `documentExtensions.ts::detectClipboardType`, main 의 `classifyFile` / file-drop image 분기
- **금지**: 컴포넌트나 핸들러에 인라인 `['png','jpg',...]` 박기. 새 확장자 추가는 위 두 SSOT 만 수정

### A.11 노드/덱 빌딩 모드 상태
- **SSOT**: `frontend/src/hooks/useNodeDeckMode.ts:149` — B(빌드) 단계의 상태는 local `nodeBuilding`만 읽음

### A.12 트리거(트리거 콜러블) 파이어 위치
- **SSOT 컨텍스트**: `App.tsx:1692, 2327` — `launchAndPosition` 등 SSOT 메서드가 트리거 한 번만 발사. 호출자가 또 발사하면 안 됨.
- **계획**: Round 3에서 callee-fires 패턴으로 통일 (`refactor-roadmap.md`).

### A.13 튜토리얼 퀘스트
- **레지스트리 SSOT**: `frontend/src/tutorial/registry.ts` — 모든 퀘스트 목록
- **타입 SSOT**: `frontend/src/tutorial/types.ts` — Quest/Step/Nudge/persisted state 모양
- **글쓰기 SSOT**: `plans/tutorial-writing-style.md` — 톤/금칙어
- **목표 SSOT**: `plans/tutorial-goals.md` — 섹션·퀘스트 단위 학습 목표
- **감사 SSOT**: `plans/tutorial-coherence-audit.md` — 위 목표 대비 step 정합성

### A.14 버전
- **SSOT**: 레포 루트 `package.json` `version` 필드.
- **읽는 곳**: `frontend/vite.config.ts:9` 가 빌드시 주입. 별도 sync 안 함.
- **금지**: `frontend/package.json` 에 별도 버전 박기

### A.15 Phase 2 sync cohort (v1.3.34+)
- **타입 분류 SSOT**: `frontend/src/lib/cohort.ts` — `cohortOfType(type)`, `isSyncable(item)`, `partitionByCohort(items)`, `DEVICE_ONLY_SETTING_KEYS`
- **설계 SSOT**: `plans/sync-and-auth.md` §15 (사용자 합의 표)
- **DB 스키마 SSOT**: `plans/phase2-schema.sql` (Supabase 대시보드에서 실행)
- **읽는 곳**: Phase 2 sync 실제 구현은 다음 라운드. 일단 분류 SSOT 만 정착.
- **금지**: 컴포넌트나 hook 에서 `if (item.type === 'url' || item.type === 'memo' ...) sync()` 같은 ad-hoc 분류. 반드시 `cohort.ts` 통과.

### A.17 Dialog 너비 (v1.3.35+)
- **토큰 SSOT**: `frontend/src/components/ui/dialog.tsx` `DIALOG_SIZE = { sm: 360, md: 440, lg: 520, xl: 640 }`
- **타입 SSOT**: 같은 파일 `export type DialogSize = 'sm'|'md'|'lg'|'xl'`
- **호출 패턴**: `<DialogContent size="md" style={{ padding: 0, overflow: 'hidden' }}>` — size 토큰 + 그 외 인라인 스타일 (padding 등)
- **선택 기준** (사이즈 calibration):
  - `sm` 360 — 단일 확인/취소 prompt
  - `md` 440 — 위자드 step, picker, 작은 picker
  - `lg` 520 — list + detail (ScanDialog, DocCohortDialog)
  - `xl` 640 — full 편집기 (ItemDialog with all tabs)
- **금지**: `style={{ width: 480 }}` 같은 인라인 너비 박기 → size 토큰 사용. 너비가 토큰과 안 맞으면 toolkit 에 새 토큰 추가 (`xs`/`2xl` 등) 후 사용.
- **이행 현황 (2026-05-14)**: DocCohortDialog 만 size 사용 (squeeze bug fix 동기). 나머지 8 곳은 점진 마이그레이션. 마이그 끝나면 dialog.tsx 의 `!size && ...` 레거시 분기 제거 가능.

### A.18 Satellite cross-cutting state injection (v1.3.48+)
- **무엇**: satellite BrowserWindow (SettingsDialog 등) 가 메인 윈도우의 글로벌 상태 (auth 세션 / sync 진행 상황) 를 보여줘야 할 때 — satellite 의 자체 supabase / sync module-singleton 은 항상 빈 상태이므로 직접 호출 불가. 메인을 SSOT 로 두고 satellite 는 read-only view.
- **메커니즘**:
  1. 메인 renderer 가 상태 변경 감지 → `electronAPI.{syncAuthState|publishSyncPreview}()` 로 main 에 publish
  2. `main.js` 의 캐시 (`_authStateCache` / `_syncPreviewCache`) 에 저장 + `pushSatelliteState('settings-dialog')` 트리거
  3. `pushSatelliteState` 가 settings-dialog 의 sat.state 에 cross-cutting 필드 (`auth`, `syncPreview`) 를 자동 주입해서 send
  4. satellite renderer 가 onState 에서 받음 → `applyExternalAuthState()` 같은 inject 함수로 자체 외부 store 에 mirror
- **위성 → 메인 액션 (write)**: satellite 의 `signOut` / `sync-preview` 같은 사용자 액션은 직접 호출 X. 반드시 `settings-dialog-action` IPC 의 `kind: signout|sync-preview|sync-commit|sync-cancel` 로 라우팅 → App.tsx 가 실제 실행.
- **금지**:
  - satellite renderer 에서 `supabase.auth.signOut()` / `syncFull()` 직접 호출 (세션 없으므로 silent 실패)
  - cross-cutting 필드를 위성 자체 state machine 에 write back
  - 새 cross-cutting state 영역 추가 시 — main.js 캐시 + pushSatelliteState 주입 + electronBridge publish 함수 + 위성 inject 함수 4-tuple 모두 동기화 필수
- **읽는 곳**: `frontend/src/AppShell.tsx`, `frontend/src/App.tsx` (publish 측) / `frontend/src/settings-dialog/SettingsDialogSatellite.tsx` (consume 측) / `main.js` (forward 측)

### A.16 Auth KV 영속화 (v1.3.34+)
- **SSOT**: `main.js` `auth:kv-get` / `auth:kv-set` / `auth:kv-list` IPC (safeStorage 암호화). store key `authKv.<key>` 아래.
- **읽는 곳**: `frontend/src/lib/supabase.ts` `safeStorageAdapter` + `hydrateSession()`
- **목적**: supabase-js 의 PKCE code-verifier 같은 short-lived key 가 인스턴스 분리 시에도 살아남도록. session token 은 별도의 `auth:get-session/set-session` 으로 back-compat 유지.
- **금지**: supabase-js storage adapter 우회해서 직접 `electron-store` 에 토큰 박기

---

## B. 계획·설계 SSOT (plans/*.md)

각 plan 파일이 자기 영역의 SSOT. 영역 겹치면 더 좁은 쪽이 우선.

| 영역 | SSOT 파일 | 비고 |
|---|---|---|
| 인증 (Phase 1) 진행 상태 | `plans/auth-status.md` | §3, §4 체크박스가 진행 상태 그 자체 |
| 인증·동기화 전체 설계 | `plans/sync-and-auth.md` | Phase 1·2 설계, §14 Open Questions |
| 리팩토링 로드맵 | `plans/refactor-roadmap.md` | Round별 순서, Settings SSOT 정착 포함 |
| 백로그 | `plans/backlog.md` | 우선순위 매겨진 할 일 큐 (#D-4 Settings SSOT 등) |
| 메모 기능 v1 | `plans/memo-feature-v1.md` | 모니터 SSOT 커밋 히스토리 포함 |
| 컬러피커 / 위젯 | `plans/color-picker-plan.md` | v1.3.31 진행분 |
| 튜토리얼 시스템 v2 | `plans/tutorial-system-v2.md` | 챕터 단위 점진 개발의 SSOT (§12 갱신 규칙) |
| 튜토리얼 글쓰기 톤 | `plans/tutorial-writing-style.md` | 새 퀘스트 추가 전 통과해야 함 |
| 튜토리얼 학습 목표 | `plans/tutorial-goals.md` | 섹션 5 + 퀘스트 18개 목표 1문장씩 |
| 튜토리얼 정합성 감사 | `plans/tutorial-coherence-audit.md` | 자동 생성, 목표 대비 step 검증 |
| 튜토리얼 단축키 교육 | `plans/tutorial-shortcut-teaching.md` | 단축키 챕터 SSOT |
| ESC 키 스택 (closest closer) | `plans/escape-stack-audit.md` | ESC 누르면 무엇이 닫히는지의 LIFO 스택 |
| autoHide / alwaysOnTop 정책 | `plans/focus-state-audit.md` | 창 활성화 / blur / 다이얼로그 보호 SSOT |
| 모드/모달 충돌 정책 | `plans/conflict-avoidance-policy.md` | `canPerform()` 매트릭스, 새 trigger 추가 시 §3 갱신 |
| **신규 (2026-05-14):** | | |
| 자주 하는 작업 체크리스트 | `plans/checklists.md` | 카드 타입 / IPC / 모달 / 설정 / 알림 5개 표준 절차 |
| 릴리스 절차 | `plans/release-runbook.md` | 8단계 배포 + 검증 + 실패 모드 |
| UI 어휘 사전 | `plans/ui-vocabulary.md` | 한국어 동사 통일, 금지어 |
| 트러블슈팅 카탈로그 | `plans/troubleshooting.md` | 빌드/실행/배포/런타임 자주 부딪치는 케이스 |
| Anti-pattern grep 레시피 | `plans/anti-pattern-grep.md` | 자동 점검 명령어 모음 |

---

## C. 자주 어기는 SSOT 관련 안티패턴

1. **localStorage 미러**: settings는 `electron-store`만이 디스크 SSOT여야 함. localStorage에 같은 키 저장하면 4-way sync 발생 → 어긋남.
2. **두 곳에서 트리거 발사**: caller도 fire, callee도 fire → 더블 발사. SSOT 메서드 안에서만 fire.
3. **인라인 색/사이즈**: `widgetTokens.ts` 우회.
4. **수동 zoom**: `setZoomFactor` 사용 금지. 크기는 `windowSizePct`만.
5. **scanEngine 우회**: koffi/PS 직접 호출해서 창 정보 얻는 코드 추가 금지.
6. **버전 sync**: `frontend/package.json`에 version 박지 말 것 (vite가 root에서 주입).
7. **`var(--accent)` fallback**: `var(--accent, #6366f1)` 형태 절대 금지 (사용자 강조색 무력화).
8. **컴포넌트 ad-hoc mode 체크**: `if (activeMode !== 'normal') return;` — `canPerform()` SSOT 우회.
9. **다이얼로그 좌우 padding 부족**: `padding: 'Npx 0'` 또는 `'Npx 8px'` 같은 버튼 — 좌우 ≥ 14px 필수.
10. **캐주얼 한국어 어휘**: "발사", "짧게/길게 :" — `plans/ui-vocabulary.md` 통과 필수.
11. **inline ref callback**: `ref={node => {...}}` 매 렌더 새 함수 → dnd-kit 죽임. `useCallback` 으로 메모이제이션.
12. **IPC 4-file 불일치**: main.js 에만 등록하고 preload.js / electronBridge.ts 동기화 누락 — `plans/checklists.md` §2.

→ 자동 점검: [`plans/anti-pattern-grep.md`](./anti-pattern-grep.md)

---

## D. SSOT 점검 체크리스트 (PR 리뷰용)

새 코드/문서 추가 시:

- [ ] 같은 값이 두 곳에 저장되지 않는가?
- [ ] 새 SSOT면 본 인덱스에 추가했는가?
- [ ] 기존 SSOT를 옮겼다면 본 인덱스 경로/줄 번호 갱신했는가?
- [ ] 같은 영역 plan 파일이 이미 있는데 새로 또 만들지 않았는가?
- [ ] "금지" 패턴(C) 중 하나를 새로 도입하지 않았는가?
- [ ] 자주 하는 작업 (카드 타입 / IPC / 모달 / 설정 / 알림) 이면 [`plans/checklists.md`](./checklists.md) 통과했는가?
- [ ] anti-pattern grep ([`plans/anti-pattern-grep.md`](./anti-pattern-grep.md) §8 종합 점검) 통과하는가?
- [ ] UI 텍스트 추가 시 [`plans/ui-vocabulary.md`](./ui-vocabulary.md) §2 동사 통일표 따랐는가?
