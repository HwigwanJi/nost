# Satellite Dialogs — 별도 BrowserWindow 다이얼로그 아키텍처

> nost 메인 윈도우보다 넓을 수 있는 다이얼로그를 인라인 Radix Dialog가 아닌 별도 BrowserWindow로 띄운다. 사용자 정책 결정 (2026-05-18).

## 왜

`dialog.tsx`의 `DIALOG_SIZE` SSOT + `minWidth: 320` floor (v1.3.35/36)는 콘텐츠 cramping은 막지만 **클리핑** 자체는 해결 못 한다. Chromium은 BrowserWindow 바깥을 그릴 수 없어서, 페어-스플릿/멀티태스킹으로 nost가 좁을 때 다이얼로그가 메인 윈도우 가장자리에서 잘린다.

같은 패턴을 dialog-popup (저장 다이얼로그 컴패니언, v1.3.43+)에서 이미 검증함 — frameless transparent BrowserWindow + 모니터 anchor + IPC bridge. 그걸 일반화하여 카드 편집·설정류 다이얼로그에도 적용.

## 범위

**우선순위 (이주 순서)**:

1. **ItemDialog** (카드 추가/수정) — 580px width, 사용자 직접 반복 사용. 이주 1순위
2. **ItemWizard** (5단계 빠른 추가) — 400-440px, ItemDialog와 구조 유사
3. **SettingsDialog** (환경설정) — 4 groups × 2-3 sub-tabs, 가장 넓음
4. **DocCohortDialog** — 문서 코호트 편집
5. **나머지**: ContainerSlotPicker, BatchDropDialog, ExtensionInstallWizard, NodePanel
6. **인라인 유지**: PaywallModal (작은 confirm-style), 단순 alert/confirm류

## 아키텍처

### main.js — 공용 헬퍼

```js
// satellite-dialog.js (또는 main.js 내 함수)
function createSatelliteDialog(name, {
  width, height,
  preload,        // e.g. preload-item-dialog.js
  htmlFile,       // e.g. item-dialog.html
  initialPayload, // 첫 mount시 push할 state
  anchorMode,     // 'mainCenter' | 'monitor1_6' | 'cursor'
}) {
  // BrowserWindow 생성 (frameless, transparent, alwaysOnTop:false,
  //   hasShadow:false, focusable:true — 다이얼로그는 입력 받아야 함)
  // 위치: anchorMode에 따라 결정
  // session: per-dialog memory partition (캐시 격리)
  // ready-to-show → push initial state, then show
  // window.on('closed') → cleanup
  return win;
}
```

**모니터 anchor**: dialog-popup과 동일하게 `screen.getDisplayMatching(mainWindow.getBounds())` 으로 메인이 있는 모니터의 workArea 중앙에 위치. 클램프로 화면 밖 방지.

**한 화면에 1개**: 같은 name의 satellite가 이미 떠 있으면 기존 인스턴스에 새 payload만 push (re-mount X). 사용자가 카드 A 편집 중 카드 B로 빠르게 전환하는 케이스 커버.

### 메인 ↔ satellite IPC 컨벤션

| 채널 | 방향 | 페이로드 | 시점 |
|---|---|---|---|
| `${name}-open` | renderer → main | `{ payload }` | 사용자가 다이얼로그 열기 트리거 (예: ItemCard edit 클릭) |
| `${name}-state` | main → satellite | `{ payload, theme, settings, ... }` | satellite 생성 직후 + 메인측 변경 시 push |
| `${name}-request-state` | satellite → main | none | satellite mount 완료 시 (race-fix) |
| `${name}-action` | satellite → main | `{ kind: 'save' \| 'close' \| custom, data }` | 버튼 클릭 등 |
| (자동) `${name}-closed` | main → renderer | none | satellite 종료 시 메인 renderer가 후처리 (예: 카드 리스트 새로고침) |

### preload

dialog-popup의 `preload-dialog-popup.js`와 동일한 패턴. `contextBridge.exposeInMainWorld` 로 satellite 전용 API 노출. ipcRenderer 직접 노출 금지.

### Vite multi-entry

`frontend/vite.config.ts`에 새 entry 추가:
- `item-dialog.html` + `src/item-dialog/main.tsx` (Phase 1)
- 추후 `settings-dialog.html`, `doc-cohort-dialog.html` 등

각 entry는 자기 React root만 마운트. 메인 앱 번들(`main.tsx`)과 코드 공유는 Vite 청크 분할에 맡김 — 공통 컴포넌트 (Button, TextInput, Icon 등)는 자연스럽게 shared chunk로 들어간다.

### state sync 전략

satellite는 **본인 화면에 필요한 최소 state만** 받는다:
- ItemDialog satellite: `{ item, spaces, presets, settings: { accentColor, documentExtensions, ... } }` — 카드 카탈로그/뱃지/플로팅 등은 받지 않음
- form submit 시 전체 form 객체를 `${name}-action: 'save'` 로 메인에 push → 메인이 기존 mutator(IPC + store.set)로 적용

광범위 글로벌 state (Zustand 등)을 만들지 않고, **payload-in / action-out** 단방향 흐름으로 단순화.

### escape stack

satellite 내부 ESC는 자기 close만 트리거. 메인의 escape stack과는 BrowserWindow가 분리돼서 자연 격리됨. 메인 stack 관리 코드 안 건드려도 됨.

### theme / accent color

satellite mount시 state push에 `accentColor`, `theme: 'light' | 'dark'` 포함. satellite 진입점이 CSS 변수 (`--accent`, `--surface`, ...) 를 본인 :root에 적용. 메인의 CSS 변수 설정 로직 재사용.

## 마이그레이션 단계 (ItemDialog 기준)

### Phase 1: 인프라
- [ ] `main.js` — `createSatelliteDialog(name, opts)` 헬퍼 (or 인라인 createItemDialogWindow)
- [ ] `preload-item-dialog.js` — itemDialog API 노출
- [ ] `frontend/item-dialog.html` + `frontend/src/item-dialog/main.tsx` entry
- [ ] `vite.config.ts` rollupOptions.input에 추가

### Phase 2: satellite 렌더러
- [ ] `frontend/src/item-dialog/ItemDialogApp.tsx` — 기존 `components/ItemDialog.tsx`를 satellite 컨텍스트에서 마운트 가능하도록 추출/래핑
- [ ] state push 수신 → 로컬 useState로 거울. form mutation은 로컬에서.
- [ ] save 액션 → `api.action({ kind: 'save', form })` → main → mainWindow IPC로 forward → App.tsx의 기존 save handler가 처리
- [ ] close 액션 → satellite window destroy

### Phase 3: 트리거 교체
- [ ] `ItemCard.tsx` — `onEdit(item)` 호출부를 `window.electronAPI.openItemDialog(item)` 로 교체 (preload 측에 API 추가)
- [ ] `App.tsx` — 인라인 `<ItemDialog>` 렌더 제거. 단, `item-dialog-action` 리스너로 save 받기

### Phase 4: 검증
- [ ] 좁은 nost (페어-스플릿)에서 다이얼로그 클리핑 없음
- [ ] 멀티 모니터에서 메인 모니터에 위치
- [ ] form 데이터 왕복 (open → edit → save → 카드 갱신)
- [ ] favicon / icon picker / screen pick 등 기존 기능 정상
- [ ] ESC 닫기 / 외부 클릭 처리 / focus 트랩

### Phase 5: 다음 다이얼로그
- [ ] ItemWizard 동일 패턴 (구조 거의 같음 → 인프라 재사용)
- [ ] 이후 SettingsDialog…

## 트레이드오프 / 리스크

- **창 전환 비용**: BrowserWindow 생성/소멸은 ~100-200ms. 빈번한 열닫기에 노출 — 처음 열 때 살짝 느려질 수 있음. mitigation: 본 BrowserWindow를 destroy 대신 hide/show로 재사용 (메모리 trade-off)
- **번들 중복**: satellite entry마다 React + 공유 모듈 일부 중복 가능. Vite의 자동 chunk 분할로 최소화되지만 0은 아님
- **theme/settings sync 누락 위험**: 메인측 변경이 satellite에 즉시 반영되어야 할 케이스 (예: 사용자가 다이얼로그 열어둔 채 OS 다크모드 토글) — satellite mount 후에도 메인이 state push를 보내는 watcher 필요
- **focus return**: 다이얼로그 닫을 때 메인 nost로 포커스 되돌리기 — Windows에서 `mainWindow.focus()` 명시 호출 필요할 수도

## 참고 — dialog-popup (이미 구현된 satellite 패턴)

[main.js:1517-1740](main.js) + [preload-dialog-popup.js](preload-dialog-popup.js) + [frontend/src/dialog-popup/DialogPopup.tsx](frontend/src/dialog-popup/DialogPopup.tsx) — 저장 다이얼로그 컴패니언. 본 작업의 reference 구현. 차이점:
- 다이얼로그-popup은 alwaysOnTop + click-through. ItemDialog satellite는 보통의 focusable 윈도우
- 다이얼로그-popup은 모니터-anchor + drag-to-move. ItemDialog satellite는 메인 윈도우 중앙 anchor만 (드래그 없음 — 일반 다이얼로그 UX)
