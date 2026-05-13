# 근본 리팩토링 로드맵

> 사용자 grilling 세션에서 8개 결정사항 도출. 표면 fix가 아닌
> 구조 정비로 lag/focus/window-down 증상 근본 해결 + 향후
> sync 작업의 foundation 마련.

## 결정 요약

| # | Thread | 결정 |
|---|---|---|
| 1 | Hide 정책 | **보수적 통합** — 자동 hide(blur, closeAfter)만 단일 정책 함수로. 명시적 hide(Esc/X/단축키)는 그대로 |
| 2 | alwaysOnTop | **'screen-saver' 레벨로 격상** + 외부 launch 후 reassert |
| 3 | Multi-monitor | **마우스 따라가기** — 단축키 호출 시 현재 마우스가 있는 모니터로 이동 후 show |
| 4 | Settings SSOT | **main이 소유**, renderer는 IPC subscribe. mirror 4-way → 1-way |
| 5 | App.tsx | **한 번에 큰 분리** — drag-drop / launch / tutorial wiring 등 도메인별 훅 |
| 6 | Tutorial trigger | **callee-fires** — store action이 트리거 publish. 또는 공통 action bus |
| 7 | Lag 정점 | **앱 전환 / 창 show 시점** — 그 path 깊이 진단 |
| 8 | 작업 순서 | Window → Settings SSOT → App.tsx 분리 → Trigger callee-fires → lag 진단 |

## 4 Round 진행

### Round 1 — Window 도메인 (현재)
범위: 결정 1, 2, 3 (+ 7의 일부 — show path 진단)

작업:
- main.js에 `tryDismissWindow(reason)` 단일 함수. blur + closeAfter는 이걸 호출
- mainWindow `setAlwaysOnTop(true, 'screen-saver')`
- 외부 launch (open-url/path/cmd, launch-or-focus-app, focus-window) 직후 200ms 후 `mainWindow.moveTop()` 재선언
- `toggleMainWindow()` 내부에서 마우스 위치 → `screen.getDisplayNearestPoint(cursor)` → 그 디스플레이의 work area 중앙으로 mainWindow 이동 → show
- 부산물: 앱 show 직전 위치 이동이 lag으로 느껴지는지 확인 (사용자 7번 답: show 시점 lag 정점)

검증:
- 풀스크린 영상 위에 단축키 호출 → nost가 위에 뜸
- monitor 2에서 마우스 두고 단축키 → nost가 monitor 2에 뜸
- 외부 앱 launch → 그 앱이 켜지고 nost는 alwaysOnTop 유지
- 두 settings 모두 OFF인 상태에서 외부 클릭 → nost 안 사라짐

### Round 2 — Settings SSOT (다음)
범위: 결정 4

작업:
- `main.js`에 settings store API: `getSettings()`, `updateSettings(patch)`, `subscribeSettings(cb)`
- electron-store가 단일 디스크 SSOT. localStorage 미러 제거
- renderer는 mount 시 settings 한 번 fetch + IPC subscribe → 변경 알림 받아 React state 갱신
- main.js의 cachedAutoHide 등 ad-hoc cache 모두 제거. 이제 main이 항상 fresh
- 변경: blur handler가 직접 `getSettings().autoHide` 호출 → cache 불필요

### Round 3 — App.tsx 큰 분리
범위: 결정 5

작업 (도메인별 훅 추출):
- `useDragDrop` — handleFileDrop, batchDrop, screenPicker 일부
- `useCardCreation` — handleSaveItem, openEditItem, openManualWizard, prefilledItem state
- `useTutorialBindings` — tutorialApiRef 처리, daily nudge fire 등 (callee-fires로 옮긴 후엔 더 작아짐)
- `useGlobalShortcuts` — Tab/Esc/cmdbar 등 keydown handler들
- 5개 forward-decl ref → 자연스럽게 제거 (각 훅 안에서 self-contained)

### Round 4 — Tutorial trigger callee-fires
범위: 결정 6

작업:
- store action들이 변경 시 `events.emit('item-moved', {...})` 형태로 공통 채널 publish
- tutorialTriggers는 그 채널의 subscriber로 변환 (현재 구현 거의 그대로)
- 19곳 흩어진 `tutorialTriggers.fire(...)` 호출 → store action 안으로 흡수, caller에서 제거
- 새 action 추가 시 트리거 fire 누락 우려 X

### Round X — Lag 진단 (Round 1 후 즉시)
범위: 결정 7

작업:
- mainWindow show path 측정 (performance.mark): toggleMainWindow → moveTop → display follow → show 각 단계 ms
- `recoverTransparentBacking` 호출이 frame 멈춤 원인인지 확인
- 필요 시 show를 microtask로 분리

## 비-목표 (이번 라운드들에서 안 함)

- Mode state machine (Thread 4) — 우선순위 낮음, 현 구조 OK
- localStorage 완전 제거 — Settings SSOT에 포함되지만 다른 데이터(tutorial state 등)는 그대로
- DB schema / sync 자체 — login Phase 2 작업
- App 분리 시 component 단위 분리 (ItemCard 등) — 이미 OK

## Git 전략

각 Round = 1 commit. Commit 사이에 빌드 통과 + 사용자 검증.
릴리즈는 사용자 명시적 "릴리즈해줘" 시점에만.
