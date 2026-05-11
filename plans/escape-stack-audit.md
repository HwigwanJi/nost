# Escape Stack 전수 감사 — "추가 창 떴는데 ESC가 앱을 닫는" 버그

> 보고된 증상: 모달/팝업/리네임 등 부가 창이 떠 있을 때 ESC를 누르면 그 창만 닫혀야 하는데, 종종 **앱 전체가 hide** 되어 버린다.
>
> 결론 먼저: **escape stack은 SSOT로 설계됐지만 코드의 절반 이상이 우회**한다. + **App.tsx 글로벌 핸들러의 마지막 fallback(`hideApp`)에 가드가 없다.** 둘이 합쳐져서 발생.

---

## §1. 동작 원리 (현재)

`frontend/src/lib/escapeStack.ts` — 모듈 싱글톤 LIFO 스택.

`App.tsx:1685~1739` 글로벌 ESC 핸들러 우선순위:
1. `runTopEscape()` — 스택 최상단이 있으면 그것만 실행 후 종료
2. CommandBar 닫기
3. node-edit / deck-build / pin mode 빠져나가기
4. 타일 오버레이 닫기
5. `dialog !== 'none'` 이면 dialog 닫기
6. **`electronAPI.hideApp()`** ← 가드 없음

리스너는 `window.addEventListener('keydown', ...)` (bubble phase, no capture).

핵심 가정: "오버레이가 떴으면 그 컴포넌트가 ESC를 잡아서 글로벌까지 안 흘러가게 한다."
실제: 거의 안 지켜진다.

---

## §2. 컴포넌트별 전수 결과 — ESC 가 어떻게 처리되나

| 컴포넌트 | 위치 | 방식 | 글로벌까지 흘러가나? | 판정 |
|---|---|---|---|---|
| MemoEditor | `MemoEditor.tsx:254` + `:271` | `useEscapeKey` ✓ + textarea 로컬 onKeyDown | 스택이 처리 → 글로벌 short-circuit | ✓ OK |
| RecommendPanel | `RecommendPanel.tsx:74` | `useEscapeKey` ✓ | 스택이 처리 | ✓ OK |
| MemoTrashDialog | `MemoTrashDialog.tsx:52` | `useEscapeKey` ✓ | 스택이 처리 | ✓ OK |
| NotificationBell | `NotificationBell.tsx:49` | `useEscapeKey` ✓ | 스택이 처리 | ✓ OK |
| **SettingsDialog** | `SettingsDialog.tsx:505` | base-ui `<Dialog>` 자체 ESC + `useBusyMark` | base-ui가 stopPropagation 한다고 **가정**, 글로벌엔 가드 없음 | ⚠ 의심 (§4 참조) |
| **ItemDialog** | `ItemDialog.tsx:793,832` | base-ui `<Dialog>` + `useBusyMark` | 〃 | ⚠ 의심 |
| **ItemWizard** | `ItemWizard.tsx:355,454,533` | base-ui `<Dialog>` + `useBusyMark` | 〃 | ⚠ 의심 |
| **ScanDialog** | `ScanDialog.tsx:332` | base-ui `<Dialog>` (busy mark 없음) | 〃 | ⚠ 의심 |
| **CompletionModal** (튜토리얼) | `CompletionModal.tsx:83` | base-ui `<Dialog>` (busy mark 없음) | 〃 | ⚠ 의심 |
| **WelcomeWizard / ImportWizard** | `WelcomeWizard.tsx:45`, `ImportWizard.tsx:58` | base-ui `<Dialog>` + `useBusyMark` | 〃 | ⚠ 의심 |
| **PaywallModal** | `PaywallModal.tsx:54` | window keydown **capture** + `e.stopPropagation()` | capture에서 멈춤 | ✓ OK |
| **TourOverlay** | `TourOverlay.tsx:209` | window keydown **capture** + `e.stopPropagation()` | capture에서 멈춤 | ✓ OK (글로벌 안 갔지만 스택 무시는 디자인 위반) |
| **QuestRunner** (튜토리얼) | `QuestRunner.tsx:177` | document keydown **capture** + `preventDefault()` 만 | **stopPropagation 없음** → 글로벌까지 도달 | ✗ **BUG** |
| **CommandBar** | `CommandBar.tsx:359` | input 로컬 onKeyDown | React stopPropagation 없음. 단, App.tsx 우선순위 0이 cmdOpen 잡음 | ⚠ 우연히 OK |
| **DialogPopup** (별도 창) | `DialogPopup.tsx:136,429` | 자기 창. 별도 BrowserWindow | 무관 | ✓ OK |
| **MiniWindow** (배지) | `MiniWindow.tsx:95` | 자기 창. 별도 BrowserWindow | 무관 | ✓ OK |
| **ItemCard hold-popup** | `ItemCard.tsx:279` | document keydown (capture 여부 미확인) | hold 동작 중에만, 글로벌에 흘러가도 priority 1~5 미해당 → hideApp | ⚠ 의심 |
| **App.tsx 슬래시/검색** | `App.tsx:3127,3149` | input 로컬 onKeyDown + `e.stopPropagation()` | React stopPropagation이 root 컨테이너 위(window)로 전파 막음 | ✓ OK |
| **App.tsx 스크린피커** | `App.tsx:2275` | window keydown (no capture, no stop) + cancelScreenPicker | 핸들러는 짧고 cancel 후 unmount, 글로벌 핸들러도 같은 ESC에서 fire 가능 | ⚠ 의심 |
| **인라인 리네임 inputs** | NodePanel `:290 :351 :559 :711 :816`, DeckPanel `:143 :196`, SpaceAccordion `:267`, PresetToggle `:102` | input 로컬 onKeyDown, **stopPropagation 호출 안 함** (PresetToggle만 호출) | React 합성에서 stopPropagation 없음 → 글로벌 핸들러 fire | ✗ **BUG** (대다수) |

---

## §3. 핵심 버그 패턴 두 가지

### 3.1 BUG-A: 인라인 input ESC가 앱을 hide
**증상**: 스페이스/노드/덱/프리셋 이름 변경 input에서 ESC 누르면 → 이름 취소 + 앱 숨김 (둘 다 fire).

**원인**: React synthetic `onKeyDown` 에서 `e.stopPropagation()` 안 호출. React 17+에서 React는 root 컨테이너에 delegated 리스너를 단다. stopPropagation 호출하면 root 위(document, window)로 안 올라가지만, **호출 안 하면** window keydown 리스너가 정상 fire → App.tsx 글로벌 핸들러 → priority 5 `electronAPI.hideApp()`.

**해당 위치**:
- `NodePanel.tsx:290, 351, 559, 711, 816`
- `DeckPanel.tsx:143, 196`
- `SpaceAccordion.tsx:267`
- `PresetToggle.tsx:103` ← 여기는 `e.stopPropagation()` 있음, 단 ESC 케이스 외 위치라 동작은 됨

### 3.2 BUG-B: 튜토리얼 진행 중 ESC가 앱을 hide
**증상**: QuestRunner 가 활성일 때 ESC → tour pause 됨 + 앱 숨김.

**원인**: `QuestRunner.tsx:177` 에서 `document.addEventListener('keydown', onKey, true)` (capture) 로 잡고 `e.preventDefault()` 만 호출. **`stopPropagation()` 호출 안 함.** capture 에서 잡았어도 propagation 안 멈추면 bubble 단계에서 window 리스너가 또 fire.

### 3.3 BUG-C(잠재): base-ui Dialog 가 stopPropagation 안 하면 모든 Dialog가 BUG-A 와 동일
**증상**: SettingsDialog/ItemDialog/ItemWizard/ScanDialog/CompletionModal/WelcomeWizard/ImportWizard 중 하나 떠 있을 때 ESC → 닫힘 + 앱 숨김.

**원인 가설**: base-ui `<Dialog>` 의 내부 ESC 핸들러가 close 만 부르고 native event 의 propagation 을 안 멈출 가능성. App.tsx 글로벌 핸들러의 priority 5 가 무방비 fallback 이라, dialog 가 close 됐든 아니든 closure 가 stale 인 첫 fire 에서 hideApp 까지 도달할 수 있음.

**확신도**: 중. 사용자가 "중간중간" 겪는다는 게 이 케이스에 부합. base-ui의 정확한 ESC 동작은 코드만으로는 확정 안 됨 — 런타임 검증 필요.

### 3.4 (서브) ItemCard hold-popup, 스크린피커
- ItemCard hold-popup: hold 시 ESC → close. 이 상태는 글로벌 핸들러 priority 1~5 어디에도 안 걸림 → hide 가능.
- 스크린피커: 같은 이유.

---

## §4. 진짜 원인 — 두 개의 구조적 결함

1. **글로벌 핸들러 마지막 fallback `hideApp` 에 가드 없음.** "어떤 modal/오버레이도 안 떠 있을 때만 hideApp" 이 안 지켜짐. `isUserBusy()` 라는 SSOT 가 이미 있는데 (`App.tsx:1763` Tab 핸들러는 사용 중), ESC 핸들러는 안 씀.
2. **escape stack 채택률이 50% 미만.** `useEscapeKey` 사용은 4 컴포넌트뿐 (MemoEditor, RecommendPanel, MemoTrashDialog, NotificationBell). 나머지는 다 ad-hoc — base-ui 의존 / window-capture+stopPropagation / 로컬 input handler. SSOT 를 만들었으면 컴파일 타임/리뷰 타임에 강제해야 하는데 안 됨.

---

## §5. 수정 방안 (난이도 오름차순)

### Fix 1 — 글로벌 ESC 마지막 fallback 에 `isUserBusy()` 가드 (가장 안전, 효과 큼)
`App.tsx:1733~1734`:
```ts
// Priority 5: hide app — but only if absolutely nothing is busy.
if (isUserBusy()) return;       // ← 추가
electronAPI.hideApp();
```
기대 효과: BUG-C 한 방에 차단. 모든 useBusyMark 모달이 자동 보호.

### Fix 2 — 인라인 rename input 들 stopPropagation 추가 (BUG-A)
모든 rename onKeyDown 끝에 `e.stopPropagation()` 추가. 8군데. 또는 공통 `<RenameInput>` 컴포넌트로 묶기.

### Fix 3 — QuestRunner ESC 핸들러에 stopPropagation 추가 (BUG-B)
`QuestRunner.tsx:177` 에 `e.stopPropagation()` 추가.
+ 더 나아가서 `pushEscape` 로 옮겨 escape stack 에 합류시키면 일관성 ↑.

### Fix 4 — base-ui Dialog 들 escape stack 합류 (BUG-C 정공법)
`DialogContent` 가 mount 시 `pushEscape(() => onOpenChange(false))` 등록 + base-ui 의 자체 ESC 비활성화. 또는 wrapper 만들어서 일괄 처리. 가장 깔끔하지만 일이 많음.

### Fix 5 — TourOverlay 도 escape stack 합류 (디자인 정합성)
현재는 capture+stop 으로 우연히 안전한데, 스택 안 거치면 메모 에디터가 ESC 처리 우선권을 못 가져감. 메모 위에 tour 가 떴을 때 ESC 가 메모를 닫을지 tour 를 닫을지 결정이 무작위. 스택으로 옮기면 LIFO 로 자연스럽게 해결.

---

## §6. 권장 순서

1. **Fix 1 즉시 적용** — 한 줄. BUG-C 와 BUG-A 의 hideApp 부작용 즉시 해결.
2. **Fix 2** — rename input 8군데 stopPropagation 추가. 사용자가 의도한 "ESC = 이름 취소" 만 발생.
3. **Fix 3** — QuestRunner stopPropagation.
4. (여유 있으면) Fix 4·5 — escape stack 채택률 끌어올리기, lint 룰로 강제.

---

## §7. 검증 시나리오 (수정 후)

- [ ] 설정 다이얼로그 열고 ESC → 설정만 닫힘, 앱 그대로
- [ ] 카드 추가/편집 다이얼로그 열고 ESC → 다이얼로그만 닫힘
- [ ] 스페이스/노드/덱 이름 변경 input 활성 시 ESC → 이름 변경만 취소
- [ ] 튜토리얼 활성 중 ESC → tour pause 만, 앱 그대로
- [ ] CompletionModal 떴을 때 ESC → 모달만 닫힘
- [ ] PaywallModal 떴을 때 ESC → 모달만 닫힘
- [ ] 메모 에디터 열고 ESC → 메모만 닫힘 (회귀 테스트)
- [ ] 아무 modal 도 없을 때 ESC → 앱 hide (정상 동작 유지)
- [ ] node-edit 모드 진입 후 ESC → 모드 빠져나옴 (회귀)
- [ ] tile overlay 표시 중 ESC → 오버레이 닫힘 (회귀)
