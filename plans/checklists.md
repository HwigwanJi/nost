# 자주 하는 작업 — 체크리스트

> 신입이 가장 자주 부딪칠 4개 작업의 SSOT 절차. 단계별로 정확한 파일 위치 + 누락 시 증상 명시. 새 작업 종류가 반복적으로 나오면 여기에 추가한다.
>
> 작성: 2026-05-14. 갱신 규칙: 코드 위치가 바뀌면 본 파일 라인 번호도 같이 갱신 (`plans/ssot-index.md` 와 동일 정책).

---

## §1. 새 `LauncherItem.type` 추가 체크리스트

> v1.3.34에서 `'doc'` 추가하면서 발견한 7+α 파일 패턴 + v1.3.37 에서 추가 발견한 2개. 빠뜨리면 "클립보드에선 인식되는데 파일 드롭에선 안 되네" 류 silent failure.

### 필수 수정 (10개)

| # | 파일 | 무엇 | 빠뜨리면 |
|---|---|---|---|
| 1 | `frontend/src/types.ts` `LauncherItem.type` union | 새 리터럴 추가 | 컴파일 실패 (좋음 — 발견됨) |
| 2 | `frontend/src/App.tsx::inferItemFromPath` | 파일 드래그앤드롭 분류 (메인 SSOT) | 파일 드롭이 잘못된 타입으로 저장 |
| 3 | `main.js` `analyze-clipboard` IPC | 클립보드 분류 (path 분기의 `classifyFile`) | 클립보드 prefill이 잘못된 타입 |
| 4 | `frontend/src/lib/documentExtensions.ts::detectClipboardType` | 텍스트 기반 분류 | ContainerSlotPicker / ItemWizard 분류 누락 |
| 5 | `frontend/src/components/ItemWizard.tsx::handleSave` | doc → app 매핑 같은 collapse 없는지 확인 | 저장 시점에 타입 손실 |
| 6 | `frontend/src/components/ContainerSlotPicker.tsx::fillFromClipboard` | 컨테이너 슬롯 추가 시 매핑 | 슬롯 picker에서 새 타입 안 보임 |
| 7 | `frontend/src/components/ItemDialog.tsx` auto-prefill `useEffect` | 클립보드 → ItemDialog 매핑 (`r.type === 'X' ? 'X' :`) | 다이얼로그가 type 인식 못함 |
| 8 | `frontend/src/components/BatchDropDialog.tsx::TYPE_META` Record | 멀티 파일 드롭 시 chip 메타데이터 | TS error (`Record<LauncherItem['type'], ...>` 누락 멤버) |
| 9 | `frontend/src/App.tsx::handleFileDrop` **URL/text 폴백 분기** | `files[]` 비고 text/uri-list 로만 들어온 path (OneDrive virtual 등) | path 들어오면 `inferItemFromPath` 거치지 않고 `'folder'` 하드코딩 → .pptx 가 folder 로 (v1.3.36 회귀, v1.3.37 fix) |
| 10 | `frontend/src/App.tsx::handleCmd` **`cmd.kind === 'clipboard'` 분기** | `/c` 슬래시 명령어로 클립보드 path 저장 | #9 와 동일 패턴 — `'folder'` 하드코딩 (v1.3.37 fix) |

### 렌더 + 동작 (5개)

| # | 파일 | 무엇 |
|---|---|---|
| 9 | `frontend/src/components/ItemCard.tsx::getTypeIcon` | 기본 아이콘 (Material symbol 이름) |
| 10 | `frontend/src/components/ItemCard.tsx::CardHoverHint::shortVerb` | 호버 시 클릭 동작 설명 ("문서 열기" 등). [어휘 사전](./ui-vocabulary.md) 따라야 함 |
| 11 | `frontend/src/components/ItemDialog.tsx::TYPE_OPTIONS` 배열 | type picker phase에 보일지 결정 + 라벨/힌트 |
| 12 | `frontend/src/hooks/useLaunchPipeline.ts` 실행 분기 | 같은 OS 동작이면 기존 분기 (`item.type === 'app' \|\| item.type === 'doc'`) 에 추가, 다르면 신규 분기 |
| 13 | `frontend/src/hooks/useAppData.ts::migrateData` | 기존 사용자 데이터 reclassify 룰 (v1.3.34 `maybeReclassifyAsDoc` 패턴) |

### 검증 시나리오

- [ ] 파일 드래그앤드롭 → 새 타입으로 저장됨
- [ ] 클립보드에 해당 형식 텍스트 → 게이트웨이 배너에 "X 카드로" 버튼
- [ ] ItemDialog 직접 입력에서 타입 칩 선택 가능
- [ ] 카드 호버 시 정확한 동사 표시
- [ ] 클릭 시 정상 실행 + closeAfter 동작
- [ ] 기존 `'app'` 카드 중 새 타입 조건 일치하는 것 자동 reclassify (재시작 후 확인)

### 참고
- 패턴 예시 (v1.3.34 `'doc'`): `git log --oneline 2026-05-14..` 또는 본 세션의 doc cohort 작업

---

## §2. 새 IPC 추가 체크리스트

> 대화 내내 반복적으로 나온 패턴. 4-file 동시 수정 필요. 한 군데라도 빠지면 dev mode에서 silent failure 또는 production에서 `electronAPI is undefined`.

### 필수 수정 (4개)

| # | 파일 | 무엇 | 빠뜨리면 |
|---|---|---|---|
| 1 | `main.js` | `ipcMain.handle('channel-name', async (_e, ...args) => {...})` 핸들러 등록 | renderer가 호출 시 timeout |
| 2 | `preload.js` | `contextBridge` 노출 객체에 `channelName: (...args) => ipcRenderer.invoke('channel-name', ...args)` | renderer에서 `electronAPI.channelName is not a function` |
| 3 | `frontend/src/electronBridge.ts` 타입 인터페이스 | `channelName: (...args) => Promise<ReturnType>` 시그니처 | TS error |
| 4 | `frontend/src/electronBridge.ts` dev-mode `noopApi` fallback | `channelName: async () => <fallback value>` | dev 모드 (Vite 단독)에서 undefined 호출 |

### 채널 명명 규칙

- 동사-목적 형식: `analyze-clipboard`, `list-doc-cohort`, `launch-or-focus-app`
- 케밥 케이스 (renderer 측 JS는 카멜케이스 자동 매핑)
- 보내기만 (no response): `on()` + `send()` 페어 (e.g. `'hide-app'`)
- invoke (round-trip): `handle()` + `invoke()` 페어 (e.g. `'analyze-clipboard'`)

### 보안 / 안전 룰

- 파일 시스템 접근하는 핸들러는 **path safety** 검증:
  - `^[A-Za-z]:\\` 또는 `^\\\\` (UNC) 만 허용
  - `..` traversal 거부
  - 예시: `main.js::list-doc-cohort` 핸들러
- 사용자 입력 PS 스크립트로 넘길 때는 **환경변수** 사용. 명령행 인자 인터폴레이션 금지 (injection)

### 검증 시나리오

- [ ] dev 모드 (`npm run dev` + electron 안 켠 상태) — `noopApi` 로 fallback OK
- [ ] electron dev — 실제 핸들러 호출 OK
- [ ] 빌드된 installer — `console.log` 로 결과 확인

### 참고

- 패턴 예시: v1.3.34 `listDocCohort` 추가 (main.js + preload.js + electronBridge.ts 3-file 동시 수정)

---

## §3. 새 모달 / Wizard 추가 체크리스트

> 모달은 4종 SSOT 시스템과 모두 상호작용. 한 곳 누락하면 ESC가 엉뚱한 걸 닫거나 / alt-tab 시 다이얼로그 사라지거나 / 모드 중 silent 가로채기 발생.

### 필수 등록 (4개 SSOT)

| # | SSOT | 호출 | 무엇 |
|---|---|---|---|
| 1 | `userBusy` | `useBusyMark('modal:my-modal', open)` 훅 | base-ui Dialog/Wizard/Paywall 자동 추적. ESC 우선순위 + Tab 차단 + suppressAutoHide 동시 활성화 |
| 2 | `escapeStack` | `Dialog` 컴포넌트 자체에서 자동 (이미 `dialog.tsx`에 wired) | LIFO 스택 — 모달끼리 nested일 때도 올바른 순서로 닫힘 |
| 3 | `conflictPolicy` 매트릭스 | `plans/conflict-avoidance-policy.md` §3 표에 한 줄 추가 | 새 모달 상태가 다른 액션을 어떻게 차단하는지 명시 |
| 4 | (자동) `suppressAutoHide` | `useBusyMark`가 자동 처리 (v1.3.34에서 Fix 1 적용 시) | alt-tab해도 모달이 사라지지 않음 |

### Dialog 구조 표준

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useBusyMark } from '../lib/userBusy';

export function MyModal({ open, onClose, ... }: Props) {
  useBusyMark('modal:my-modal', open);  // ← #1 등록
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent style={{ width: 440, padding: 0, overflow: 'hidden' }}>
        <DialogHeader style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-rgba)' }}>
          <DialogTitle>...</DialogTitle>
        </DialogHeader>
        <div style={{ padding: '14px 20px 20px' }}>...</div>
        <DialogFooter style={{ padding: '12px 20px' }}>
          {/* 좌우 padding 14px+ 필수 — plans/anti-pattern-grep.md */}
          <Button onClick={onClose}>취소</Button>
          <Button onClick={handleSave}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 안 해야 할 것 (Anti-patterns)

- ❌ 컴포넌트 내부에서 `keydown` 리스너로 ESC 처리 → `escapeStack` 우회
- ❌ `if (activeMode !== 'normal') return;` 같은 ad-hoc 모드 체크 → `canPerform()` SSOT 우회
- ❌ `padding: '5px 0'` 또는 `'9px 0'` 같은 좌우 0px 버튼
- ❌ 인라인 색/사이즈 → `widgets/widgetTokens.ts` 토큰 사용
- ❌ `var(--accent, #6366f1)` fallback → fallback 절대 금지

### 검증 시나리오

- [ ] 모달 열고 alt-tab → 모달 + 런처 살아있음 (autoHide=ON 상태)
- [ ] 모달 열고 ESC → 모달만 닫힘 (앱 hide 안 됨)
- [ ] 다른 모달 위에 nested 열고 ESC → 안쪽 먼저 닫힘
- [ ] 모달 열려있는 동안 단축키 Alt+1 (preset 전환) → 차단됨
- [ ] 모달 닫고 ESC 다시 → 정상 (앱 hide 또는 다음 escape 핸들러)

### 참고

- 패턴 예시: `frontend/src/components/DocCohortDialog.tsx` (v1.3.34 신규)
- ESC 정책: [`plans/escape-stack-audit.md`](./escape-stack-audit.md)
- 충돌 정책: [`plans/conflict-avoidance-policy.md`](./conflict-avoidance-policy.md)
- focus 정책: [`plans/focus-state-audit.md`](./focus-state-audit.md)

---

## §4. 새 `AppSettings` 필드 추가 체크리스트

> ssot-index A.3에서 "현재 미정착" 상태로 표시된 영역 — 그래도 작업은 일어남. 4-file 동시 수정 + migration.

### 필수 수정 (4개 + 사용처)

| # | 파일 | 무엇 | 빠뜨리면 |
|---|---|---|---|
| 1 | `frontend/src/types.ts::AppSettings` 인터페이스 | 새 필드 추가 (`docCohort?: DocCohortSettings;` 같이) | TS error |
| 2 | `frontend/src/types.ts::DEFAULT_*` constant | 기본값 export | 부팅 시 undefined |
| 3 | `frontend/src/hooks/useAppData.ts::migrateData` settings defaults 블록 | `newField: parsed.settings.newField ?? DEFAULT_VALUE` | 기존 사용자 부팅 시 필드 없어서 crash |
| 4 | `frontend/src/components/SettingsDialog.tsx` 어느 탭에 UI 노출 | 4개 그룹 × 2-3 서브탭 중 적절한 곳 | 사용자가 못 바꿈 |

### 추가 고려 (선택)

| # | 파일 | 무엇 |
|---|---|---|
| 5 | `main.js` 캐시 (필요 시) | `cachedFoo = !!store.get('appData.settings.foo')` — main 측에서 hot path로 자주 읽으면 (예: `cachedAutoHide`) |
| 6 | IPC `set-foo` 신설 (캐시 갱신용) | renderer가 settings 저장 시 main 캐시도 같이 갱신 |
| 7 | `preload.js` + `electronBridge.ts` setter | 위 IPC 노출 |

### 명명 규칙

- 카멜케이스: `documentExtensions`, `extensionEverConnected`, `windowOpenAt`
- `Boolean` 은 동사 ("enabled / hideOnFullscreen / closeAfterOpen")
- `enum-like string` 은 `'a' | 'b'` union (`'cursor' | 'last'`)
- Optional `?:` 만 사용 — undefined 가 "기본값 사용"

### 마이그레이션 패턴

```ts
// migrateData 안에서:
parsed.settings = {
  ...parsed.settings,
  // existing fields...
  newField: parsed.settings.newField ?? DEFAULT_NEW_FIELD,
};
```

### 검증 시나리오

- [ ] 신규 설치 — DEFAULT_* 값으로 부팅
- [ ] 기존 사용자 (구버전 store 보유) — undefined → DEFAULT 자동 충전
- [ ] 설정 변경 후 재시작 — 값 유지
- [ ] 변경 즉시 반영 (live preview) 인지 / 저장 시 반영인지 정책 명시 (SettingsDialog의 `live writes` 패턴 vs `save button`)

### 참고

- 패턴 예시 (v1.3.34): `extensionEverConnected` (boolean latch) + `docCohort: DocCohortSettings` (nested)
- 관련 SSOT: `plans/ssot-index.md` §A.3 (settings 디스크 SSOT 정착은 refactor Round 2 작업)

---

## §5. 새 알림 (`AppNotification`) 카테고리 추가 체크리스트

> v1.3.33에서 알림 SSOT 통합 후 자주 등장.

### 필수 수정 (2~3개)

| # | 파일 | 무엇 |
|---|---|---|
| 1 | `frontend/src/types.ts::NotificationKind` union (기존 카테고리 추가 시) OR `NotificationAction::intent` union | 새 의도 (e.g. `'open-billing'`) |
| 2 | `frontend/src/App.tsx::handleNotificationAction` switch | 해당 intent의 디스패치 (어떤 action 실행할지) |
| 3 | `frontend/src/components/NotificationPanel.tsx::deriveCategory` | 새 카테고리 뱃지 매핑 (intent 또는 dedupKey 패턴 기반) |

### 알림 발행 패턴

```ts
store.addNotification({
  kind: 'tip',                                 // 또는 'update' / 'system' / 'discovery' / 'billing'
  title: '[카테고리] 한 줄 헤드라인',         // deriveCategory가 [카테고리] 자동 prefix 처리
  body: '두 줄 이내 추가 설명',
  action: {                                    // 선택 — action 클릭 시 디스패치
    label: '시작', icon: 'play_arrow',
    intent: 'open-tour', payload: 'questId',
  },
  dedupKey: 'tutorial-event-nudge-{questId}',  // 같은 알림 반복 발행 방지 (필수)
});
```

### 검증 시나리오

- [ ] 알림 발행 → 종 뱃지 + 패널에 표시
- [ ] 카테고리 뱃지 (e.g. `[튜토리얼]`) 표시
- [ ] 액션 버튼 클릭 → 해당 intent 정상 디스패치
- [ ] 같은 dedupKey 재발행 → 중복 row 안 만들어짐 (createdAt만 refresh)
- [ ] 부팅 시 stale 알림 자동 청소 (update 카테고리는 `__APP_VERSION__` 비교)

### 참고

- 패턴 예시: v1.3.33 튜토리얼 nudge 3종 mirror (`tutorial-daily-nudge-*`, `tutorial-resume-*`, `tutorial-event-nudge-*`)
