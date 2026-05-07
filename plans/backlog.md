# Backlog — known issues + deferred work

> 작업 도중 발견된 이슈/요구사항 누적 장소. Plan 문서가 따로 필요한
> 큰 건은 별도 plan으로 승격, 그 외 작은 건은 여기서 status 추적.
> 형식: 증상 → 가설/근거 → 우선순위 → 비고. 끝나면 ✅ 표시 후 한
> 사이클 뒤 제거.

---

## 🟡 Open

### #1. 빈 카드 슬롯에 드롭이 간헐적으로 실패
- **증상**: 카드를 다른 스페이스의 "+ 추가" 슬롯 (또는 빈 영역)으로 드래그 했을 때, 어떤 경우엔 잘 옮겨지고 어떤 경우엔 그냥 풀려버림 (no-op).
- **재현**: 멀티 스페이스 + 일부 스페이스가 비어있는 상태에서 카드를 드래그. 빈 스페이스 또는 "+ 추가" 슬롯 위에서 떨어뜨리면 가끔 안 들어감.
- **가설** (코드 기반):
  - `App.tsx:2885~` `handleItemDragEnd`에 분기 4중첩:
    1. `drop-space-{id}` (droppable zone hit)
    2. `directSpaceMatch` (SortableSpace wrapper hit — 빈 스페이스 fallback)
    3. `targetSpace = spaces.find(s => s.items.some(i => i.id === overId))` (카드 위 hit)
    4. last-resort hit-test (DOM rect 검사)
  - 빈 스페이스의 "+ 추가" 자체가 어떤 droppable id 도 가지고 있지 않다면 분기 1·2·3 다 fail → fallback hit-test가 마지막 안전망인데, 이게 실제로 hit하지 못하는 경우가 있을 듯
  - 분기 1의 droppable id `drop-space-{id}` 가 SpaceAccordion 안에서만 등록된다면, "+ 추가" 슬롯 자체가 droppable이 아니라 그 위에 떨어뜨릴 때 dnd-kit가 정확히 어디로 분류하는지가 모호
  - 또는 dnd-kit `closestCorners` collision detection이 빈 스페이스의 droppable을 못 찾는 케이스 (rect 0 또는 작은 rect)
- **재현 변수**: 스페이스가 비어있는지, 다른 스페이스 카드 수, 화면 스크롤 위치, DPI
- **우선순위**: 中 (한 번씩 거슬리지만 회피 가능 — 다른 위치로 떨어뜨리면 됨)
- **다음 액션**: 재현 시점에 main.log + 콘솔에 dnd-kit collision 결과 + 4분기 어디까지 갔는지 진단 로그 추가. 그 다음 fix
- **개선 방향 후보**: "+ 추가" 슬롯 자체에 droppable id 부여 → 항상 분기 1 또는 신규 분기에서 잡힘

### #2. 메모 정리 도구 (cleanup palette) 액션을 Ctrl+Z 범위에 포함
- **증상**: 메모 에디터의 정리 도구 (마크다운으로 정리 / 평문 / 빈 줄 합치기 등)가 본문을 수정하는데, **글로벌 Ctrl+Z 범위 밖**임. 현재는:
  - `inPlace` 모드: `MemoEditor.tsx:495~` 근처에서 자체 undo 클로저 (이전 body로 setBody) — 하지만 **로컬 React state만**, 디스크/store에 저장된 후엔 undo 못 함
  - `clipboard` 모드: 결과를 클립보드 복사만 — body 수정 X, undo 무관
- **요구**: 정리 도구로 본문이 바뀌었을 때 사용자가 Ctrl+Z로 정확히 그 변경분만 되돌리기를 기대
- **가설/설계 노트**:
  - MemoEditor의 inPlace cleanup은 store.updateMemoBody로 디스크 저장됨. 그 직전 body snapshot을 캡처해서 글로벌 `pushUndo({undo: () => store.updateMemoBody(prev), redo: () => store.updateMemoBody(after)})` 형태로 등록 가능
  - **주의**: textarea native undo는 **편집 중인 React state 내** undo만 처리. 정리 도구가 트리거하는 일괄 변경은 native undo에 안 잡힘 — 그래서 글로벌 stack 합류가 정확
  - 현재 인프라(`useUndoStack`)에 통합하면 토스트 피드백("되돌렸어요 — 마크다운으로 정리")까지 자동으로
- **우선순위**: 中
- **다음 액션**: MemoEditor의 cleanup tool 호출처 (`runCleanupTool` 등)에 `pushUndo` 추가. inPlace 모드 한정. local-undo 클로저는 그대로 두되 (빠른 1-회 되돌리기) 같이 stack에도 push.

---

## ⚪ Deferred (다음 라운드 또는 더 후)

### #D-1. Card drag/move + Space reorder를 undo 범위에
- 현재 미등록 (`refactor` round에서 명시적 제외).
- 이유: index 추적 + cross-space 복원 + arrayMove 역연산이 복잡. 잘못 등록하면 데이터 손상.
- 설계 노트: drag start 시점의 sourceSpace.items 배열 snapshot + 각 분기에서 push. cross-space는 source/target 양쪽 snapshot. 별도 helper `pushItemMoveUndo(activeId, sourceSpace, targetSpaceId)` 추출.

### #D-2. Settings 변경 undo
- live-preview 패턴 (슬라이더 매 tick 마다 save) 때문에 stack 폭주 위험.
- 설계 노트: 슬라이더 onChangeCommitted (drag end) 시점에만 push. 또는 debounce 1초 후 커밋 push.

### #D-3. App.tsx 큰 분리 (refactor roadmap Round 3)
- 4400+줄, forward-decl ref 5개. drag-drop / launch / tutorial wiring / global shortcuts 도메인별 훅 추출.

### #D-4. Settings SSOT (refactor roadmap Round 2)
- main이 settings 소유, renderer는 IPC subscribe. mirror 4-way → 1-way.

### #D-5. Tutorial trigger callee-fires (refactor roadmap Round 4)
- store action들이 변경 시 events.emit, tutorialTriggers는 subscriber로.

### #D-6. Lag 진단 (sync 작업 후)
- 사용자 호소 "앱 전환 / show 시 lag 정점". `[show-path]` debug log 추가됨 (Round 1). 다음 빌드부터 main.log 확인.

---

## ✅ Closed (cleanup pending — 다음 사이클에 제거)

(none yet)
