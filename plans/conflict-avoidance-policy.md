# Conflict Avoidance Policy — Modal Interaction Discipline

> "지금 사용자가 하고 있는 행동과 충돌될 수 있는 행동은 금지한다."
>
> UX 용어: **modal interaction discipline** / **mode integrity** / **task focus protection**.
> 차단 시 가청/가시 피드백: **system modal feedback** (Windows 의 그 "딩~").
>
> 이 문서는 SSOT. 새 trigger 추가 시 이 매트릭스 확인 + 갱신. 매트릭스 빠지면 사용자가 "내 작업 망쳤어" 로 인지하는 버그가 생긴다.

---

## §1. 원칙 (Why)

1. **사용자의 현재 task 가 최우선** — 새 trigger 는 절대로 진행 중 task 를 무음 silent 으로 가로채지 않음.
2. **차단 시 silent 금지** — 모든 차단은 visible/audible feedback 동반. "왜 안 되지?" 의문 0 초.
3. **차단 결정은 한 곳에서** — 컴포넌트마다 `if (mode !== ...)` 흩어지면 새 mode/modal 추가 시 매번 누락. `canPerform(action)` 한 함수로 게이트.
4. **저장 actions 는 무조건 통과** — 사용자가 명시적으로 "취소"/"저장"/"닫기" 누른 것은 어떤 mode 든 통과해야 한다 (mode 자체를 빠져나오는 행위라).

---

## §2. State 정의 (SSOT)

런타임 상태 = 7 종. 모두 이미 코드에 존재 (정책은 묶기만 함).

| State | 위치 | 시맨틱 |
|---|---|---|
| `activeMode` | `App.tsx` (pin / node / deck / clean / normal) | 왼쪽 도구 모드 |
| `nodeEditMode` / `deckBuilding` | `useNodeDeckMode` | 그룹 빌드 중 |
| `editingMemoId` | `App.tsx` | 메모 에디터 열림 |
| `dialog` ('item' / 'settings' / 'none') | `App.tsx` | 메인 다이얼로그 |
| `tileOverlayGroup` | `App.tsx` | 타일 오버레이 표시 중 |
| `cmdOpen` | `App.tsx` | 슬래시 / 커맨드바 |
| `userBusy` (`useBusyMark`) | `lib/userBusy.ts` | base-ui Dialog / Wizard / Paywall — 외부 모달 SSOT |
| `tutorialPhase` | `tutorial/state.ts` | 튜토리얼 활성 |

**규칙**: 새 modal/wizard/tool 추가 시 위 8 종 중 하나에 매핑. 새 종류 만들 거면 이 문서에 먼저 추가하고 매트릭스 갱신.

---

## §3. 충돌 매트릭스 (What blocks What)

행 = 현재 상태, 열 = 시도 액션. ✗ = 금지, ✓ = 허용, ⚠ = 조건부.

| ↓ 현재 \ 시도 → | 카드 click launch | hold-press 팝업 | 도구 활성화 (pin/node/deck/clean) | drag-drop 카드 | 슬래시 / 커맨드바 | 설정 열기 | ESC = hide app |
|---|---|---|---|---|---|---|---|
| **activeMode='pin'** | tool action ✓ | ✗ | 다른 도구 ✗ | ✗ | ✗ | ✗ | mode 탈출 (ESC = normal) |
| **activeMode='node'/'deck'** | tool action ✓ | ✗ | 다른 도구 ✗ | ✗ | ✗ | ✗ | mode 탈출 |
| **activeMode='clean'** | tool action ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | mode 탈출 |
| **nodeEditMode** | edit toggle ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | save/cancel |
| **editingMemoId** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | close editor |
| **dialog !== 'none'** | ⚠ (다이얼로그 내부만) | ✗ | ✗ | ✗ | ✗ | ✗ | close dialog |
| **tileOverlayGroup** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | dismiss overlay |
| **cmdOpen** | ✗ | ✗ | ✗ | ✗ | input ✓ | ✗ | close cmd |
| **userBusy (busy:* )** | ✗ | ✗ | ✗ | ✗ | ✗ | 이미 열림 | close modal |
| **tutorialPhase ≠ idle** | ⚠ tutorial gate | ✗ | ⚠ tutorial gate | ⚠ | ✗ | ✗ | pause |

### 핵심 차단 룰 (단순화)

1. `activeMode !== 'normal'` 또는 `nodeEditMode` 또는 `deckBuilding` ⇒ **tool-exclusive** — 도구 진행 액션 외 전부 차단.
2. `editingMemoId !== null` ⇒ **memo-exclusive** — 메모 입력 외 차단.
3. `dialog !== 'none'` 또는 `userBusy()` ⇒ **modal-exclusive** — modal 내부 입력만 허용.
4. `tileOverlayGroup` ⇒ **review-exclusive** — overlay dismiss 만.
5. `cmdOpen` ⇒ **cmd-exclusive** — cmd input + ESC + Enter 만.
6. `tutorialPhase !== 'idle'` ⇒ **tutorial-gated** — 튜토리얼이 명시 허용한 액션만.

### 통과 룰 (위 모든 차단 우회)

- ESC, 닫기 X, 저장/취소 버튼 — 모드를 빠져나오는 액션
- 사용자 명시 단축키로 mainWindow 토글 (Alt+4) — OS-level
- 토스트 dismiss

---

## §4. 차단 시 피드백 (system modal feedback)

차단됐을 때 **반드시** 사용자에게 알린다. 무음 차단은 "버튼이 망가졌나?" 로 오해를 유발.

**2 단계** (사용자 결정 — cursor 변경은 과도하다고 판단):

| 단계 | 동작 | 사용처 |
|---|---|---|
| **(a) 가시 micro-shake** | 차단된 요소를 80ms 동안 ±2px 좌우 흔들기 (CSS shake keyframe) | 카드, 버튼 — 클릭한 요소 자체에 시각 반응 |
| **(b) 토스트** | "지금은 X 모드입니다. Esc 로 나가세요." 1.5s | 단축키 / 슬래시 / 글로벌 액션 — 클릭 대상이 없는 trigger |

---

## §5. 코드 프레임워크 — `canPerform()` SSOT

### API 제안

```ts
// frontend/src/lib/conflictPolicy.ts (신설)
export type ActionId =
  | 'card.launch'
  | 'card.hold-press'
  | 'card.drag'
  | 'card.edit'
  | 'card.delete'
  | 'tool.activate-pin'
  | 'tool.activate-node'
  | 'tool.activate-deck'
  | 'tool.activate-clean'
  | 'cmd.open'
  | 'settings.open'
  | 'slash.execute'
  | 'memo.open-editor'
  | 'undo'
  | 'redo';

export interface BlockReason {
  /** 1-line, 한국어, 토스트에 그대로 띄울 수 있는 텍스트 */
  message: string;
  /** machine-readable 차단 카테고리 (telemetry / 차단 횟수 카운트용) */
  category: 'tool' | 'modal' | 'memo' | 'tutorial' | 'overlay' | 'cmd';
}

export interface PolicyContext {
  activeMode: 'normal' | 'pin' | 'node' | 'deck' | 'clean';
  nodeEditMode: boolean;
  deckBuilding: boolean;
  editingMemoId: string | null;
  dialog: 'none' | 'item' | 'settings';
  tileOverlayGroup: string | null;
  cmdOpen: boolean;
  // userBusy + tutorialPhase 는 module-level singleton 으로 읽음
}

export function canPerform(action: ActionId, ctx: PolicyContext): true | BlockReason;
```

### 사용 패턴

```ts
// 카드 hold-press 발사 직전:
const verdict = canPerform('card.hold-press', getPolicyContext());
if (verdict !== true) {
  shake(cardRef.current);
  showToast(verdict.message, { duration: 1500 });
  return;
}
// ... 기존 로직
```

### 결정 트리 (canPerform 내부)

```ts
// 우선순위 = 위 §3 표의 행 순서 (좁은 mode 부터)
if (ctx.editingMemoId)         return memoBlock(action);
if (ctx.tileOverlayGroup)      return overlayBlock(action);
if (ctx.dialog !== 'none')     return dialogBlock(action);
if (isUserBusy())              return busyBlock(action);
if (ctx.cmdOpen)               return cmdBlock(action);
if (ctx.nodeEditMode)          return nodeEditBlock(action);
if (ctx.deckBuilding)          return deckBuildBlock(action);
if (ctx.activeMode !== 'normal') return toolBlock(action, ctx.activeMode);
if (tutorialActive())          return tutorialGate(action);
return true;
```

각 `*Block(action)` 함수는 그 mode 에서 **명시적으로 허용되는** action 리스트를 가지고, 그 외엔 BlockReason 반환.

### 점진적 적용 순서

1. `lib/conflictPolicy.ts` 신설 + 기본 함수 구현
2. 흩어진 ad-hoc 체크 단계적으로 마이그레이션:
   - `ItemCard.tsx:handlePointerDown` 의 `if (activeMode !== 'normal') return;` → `canPerform('card.hold-press', ctx)`
   - `App.tsx:handlePinModeClick` 등 도구 활성화 진입 직전
   - `App.tsx` 단축키 / Tab / ESC 핸들러
   - 카드 우클릭 메뉴 (편집 / 삭제 / 복제)
3. shake util 추가 + 적용
4. 새 mode/modal 추가 시 §3 매트릭스 한 줄 추가 + canPerform 분기 한 줄 추가가 **유일한 의무**.

---

## §6. SSOT 인덱스 영향

`plans/ssot-index.md` 에 새 섹션 추가 예정:
- **A.15 Conflict avoidance policy** — `frontend/src/lib/conflictPolicy.ts` + 본 plan 파일.
- 룰: "새 trigger 추가 시 canPerform 통과 의무. ad-hoc state 체크 금지."

---

## §7. 사용자 인지 검증 시나리오

수정 후 다음 시나리오에서 사용자가 "내 의도와 다르네" 느낌 0:

- [ ] pin 모드 중 카드 길게 누름 → 차단 + shake + 토스트
- [ ] node 빌드 중 다른 노드 헤더 click → 차단 + shake
- [ ] 설정 열어둔 채 단축키 Alt+1 (preset 전환) → 차단 + 토스트
- [ ] 튜토리얼 중 슬래시 입력 → 차단 + "튜토리얼 진행 중입니다" 토스트
- [ ] 타일 오버레이 표시 중 카드 click → 차단 + overlay 만 dismiss 됨
- [ ] 메모 에디터 열고 다른 카드 click → 차단 (에디터 먼저 닫아야)
- [ ] 그러나 ESC / X 버튼 / 글로벌 토글 단축키 → 모드 무관 항상 통과
