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

### A.7 "현재 열린 창" 스캔
- **SSOT**: `frontend/src/lib/scanEngine.ts` — foreground/열린 창 enumeration
- **읽는 곳**: `useGhostCards.ts:130` (ghost 카드 동기화), ScanDialog, 그 외 "지금 뭐 열려있냐" 묻는 모든 곳
- **금지**: koffi/PS 호출 직접 흩뿌리기 — 전부 scanEngine 통과

### A.8 카드 launch pipeline
- **단일 항목 SSOT**: `frontend/src/hooks/useLaunchPipeline.ts:59` `launchAndPosition` — 모든 카드-실행 경로(메인 클릭/엔터/슬래시/단축키/플로팅 배지 미니윈도우 항목 클릭)는 이 파이프라인 통과
- **노드 그룹 SSOT**: `frontend/src/hooks/useNodeDeckMode.ts:241` `handleNodeGroupLaunch` — 메인 노드 헤더 클릭, 배지 노드 클릭, 미니윈도우 "묶음 실행" 모두 이리로 funnel
- **덱 SSOT**: `frontend/src/hooks/useNodeDeckMode.ts:277` `handleDeckLaunch` — 메인 덱 헤더, 배지 덱 클릭, 미니윈도우 "순차 실행" funnel
- **배지 → 메인 라우팅**: `main.js` `'badges-launch-item'` / `'badges-launch-ref'` IPC → 메인 렌더러 listener (`App.tsx:1272-1306`) → 위 SSOT 호출
- **UX 일관성 (v1.3.28+)**: 메인 카드 1-click = 즉시 실행 ↔ 배지 1-click = 즉시 실행 (node/deck), space 배지만 미니윈도우 토글
- **금지**: 컴포넌트에서 직접 `launchOrFocus` IPC 호출, 배지에서 자체 launch 로직 (반드시 IPC 통해 메인 렌더러의 SSOT 사용)

### A.9 카드 종류별 디자인 토큰
- **SSOT**: `frontend/src/widgets/widgetTokens.ts` — 카드/위젯 종류별 색·여백·border-radius
- **금지**: 컴포넌트 인라인 색/사이즈

### A.10 타입 그럴듯함(typePlausibility)
- **SSOT**: `frontend/src/lib/typePlausibility.ts:26` — "X에 어떤 타입이 말 되는가" 의 단일 정답표
- **읽는 곳**: 카드 추가 흐름, 자동 분류

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
| 튜토리얼 시스템 v2 | `plans/tutorial-system-v2.md` | 챕터 단위 점진 개발의 SSOT (§12 갱신 규칙) |
| 튜토리얼 글쓰기 톤 | `plans/tutorial-writing-style.md` | 새 퀘스트 추가 전 통과해야 함 |
| 튜토리얼 학습 목표 | `plans/tutorial-goals.md` | 섹션 5 + 퀘스트 18개 목표 1문장씩 |
| 튜토리얼 정합성 감사 | `plans/tutorial-coherence-audit.md` | 자동 생성, 목표 대비 step 검증 |
| 튜토리얼 단축키 교육 | `plans/tutorial-shortcut-teaching.md` | 단축키 챕터 SSOT |

---

## C. 자주 어기는 SSOT 관련 안티패턴

1. **localStorage 미러**: settings는 `electron-store`만이 디스크 SSOT여야 함. localStorage에 같은 키 저장하면 4-way sync 발생 → 어긋남.
2. **두 곳에서 트리거 발사**: caller도 fire, callee도 fire → 더블 발사. SSOT 메서드 안에서만 fire.
3. **인라인 색/사이즈**: `widgetTokens.ts` 우회.
4. **수동 zoom**: `setZoomFactor` 사용 금지. 크기는 `windowSizePct`만.
5. **scanEngine 우회**: koffi/PS 직접 호출해서 창 정보 얻는 코드 추가 금지.
6. **버전 sync**: `frontend/package.json`에 version 박지 말 것 (vite가 root에서 주입).

---

## D. SSOT 점검 체크리스트 (PR 리뷰용)

새 코드/문서 추가 시:

- [ ] 같은 값이 두 곳에 저장되지 않는가?
- [ ] 새 SSOT면 본 인덱스에 추가했는가?
- [ ] 기존 SSOT를 옮겼다면 본 인덱스 경로/줄 번호 갱신했는가?
- [ ] 같은 영역 plan 파일이 이미 있는데 새로 또 만들지 않았는가?
- [ ] "금지" 패턴(C) 중 하나를 새로 도입하지 않았는가?
