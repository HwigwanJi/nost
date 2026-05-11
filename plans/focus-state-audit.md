# 창 활성화 / Auto-hide / Always-on-top SSOT 점검

> "포커스 잃으면 꺼지는 옵션", "맨 위에 떠 있는 동작", "닫혔으면 안 되는데 닫혀버리는" 류 증상의 진단.
>
> 결론 먼저: **메인 SSOT 두 개(`cachedAutoHide`, `suppressAutoHideSources`)와 단일 funnel(`tryDismissWindow`) 자체는 잘 설계돼 있음.** 다만 **funnel 우회 경로가 3개**(useLaunchPipeline 직접 hideApp, 명시적 ESC/X, 토글) 있고, **렌더러의 `useBusyMark` SSOT 와 main 의 `suppressAutoHide` SSOT 가 연결돼 있지 않다.** 이 두 가지가 "왜 지금 닫히지?" 증상의 주범.

---

## §1. SSOT 목록 (현재 상태)

### A. `autoHide` 설정값 — "포커스 잃으면 닫음" 토글
| 항목 | 위치 | 비고 |
|---|---|---|
| 디스크 SSOT | `electron-store` `appData.settings.autoHide` | 사용자 토글 |
| Main 핫캐시 | `main.js:80` `cachedAutoHide` | blur 핸들러 빠르게 읽기용 |
| 캐시 초기화 | `main.js:2019` (createMainWindow 안) | 부트 직후 디스크에서 1회 |
| 캐시 갱신 | `main.js:2425` `set-auto-hide` IPC | 렌더러 settings 저장 시마다 |
| 캐시 푸시 | `useAppData.ts:1233` | `electronAPI.setAutoHide` |
| 사용처 | `tryDismissWindow` blur 분기만 | `main.js:101` |
| 노출 UI | `SettingsDialog.tsx:633` 토글 | |

✓ 단일 출처, 단일 사용처. 미러 없음.

### B. `suppressAutoHideSources` — 임시 override Set
| 항목 | 위치 | 비고 |
|---|---|---|
| Main SSOT | `main.js:75` `Set<string>` | 런타임 only, 디스크 미저장 |
| 추가/제거 | `main.js:2421` `set-suppress-autohide` IPC | source 키 단위 |
| 현재 등록 source | `'clean-mode'` (App.tsx:1658), `'tutorial'` (TutorialProvider.tsx:77) | 2개 |
| 사용처 | `tryDismissWindow` 모든 분기 첫 줄 | size>0 이면 skip |
| 시맨틱 | "size>0 이면 자동 hide 전부 차단" | reference-counted-by-name |

✓ 디자인 OK. ⚠ 누수 가능성 (§3 issue 7).

### C. `tryDismissWindow(reason, opts)` — 자동 hide funnel
| 항목 | 위치 | 비고 |
|---|---|---|
| 정의 | `main.js:95` | 모든 자동 hide 의 SSOT |
| 호출자 | `mainWindow.on('blur')` (`:2049`), `maybeCloseAfter` (`:117`) | 둘만 |
| reasons | `'blur'`, `'close-after'` | 확장 가능 |
| 가드 순서 | suppression → reason별 조건 → delayed fire | 깔끔 |

✓ 단일 funnel. 명시적 hide(사용자 의도)는 의도적으로 우회 — 문서화됨 (`main.js:89-91`).

### D. 명시적 user-intent hide
- `'hide-app'` IPC (`main.js:2324`) → `mainWindow.hide()` 직접
- `toggleMainWindow()` (`main.js:885`) — 글로벌 단축키 / 트레이 / orb
- 모두 funnel **우회** (사용자 의도가 정책보다 우선)

### E. Always-on-top z-order
| 창 | level | 재assert 시점 |
|---|---|---|
| mainWindow | screen-saver (`:1930`) | `reassertTopAfterLaunch` (모든 launch IPC 후 250ms), `toggleMainWindow` 테일 (orb 만) |
| floatingWindow (orb) | screen-saver (`:1142`) | toggleMainWindow 테일 |
| dialogPopupWin | screen-saver (`:1308`) | 생성 시 |
| 배지 overlays | screen-saver (`:1663`), `reviveBadgeOverlays` (`:1775`) | powerMonitor / focus / 60s 타이머 |
| picker | screen-saver (`:3818`) | 생성 시 |

✓ 일관됨. screen-saver level 채택 이유: Windows SetForegroundWindow 가 'floating' level 을 demote 시키는 것을 방어.

---

## §2. Hide 가 발생하는 모든 경로

| # | 트리거 | 경로 | funnel? | suppression? | autoHide 설정? |
|---|---|---|---|---|---|
| 1 | 다른 창으로 포커스 이동 | `mainWindow.on('blur')` → `tryDismissWindow('blur')` | ✓ | ✓ | ✓ (off 이면 skip) |
| 2 | 카드 launch closeAfter=true (server) | `maybeCloseAfter` → `tryDismissWindow('close-after')` | ✓ | ✓ | – (closeAfter 자체가 의도) |
| 3 | 카드 launch closeAfter=true (client) | `useLaunchPipeline.ts:138, 179, 248` → `electronAPI.hideApp()` | **✗ 우회** | **✗ 무시** | – |
| 4 | ESC 마지막 fallback | `App.tsx:1742` → `electronAPI.hideApp()` | **✗ 우회** | – (Fix 1 에서 isUserBusy 가드) | – |
| 5 | StatusBar 닫기 버튼 | `electronAPI.hideApp()` | **✗ 우회** | ✗ | – |
| 6 | 글로벌 단축키 (Alt+4) | `toggleMainWindow()` | **✗ 우회** | ✗ | – |
| 7 | 트레이 클릭 | `tray.on('click')` → `toggleMainWindow()` | **✗ 우회** | ✗ | – |
| 8 | orb 클릭 | `floating-toggle-main` IPC → `toggleMainWindow()` | **✗ 우회** | ✗ | – |

#1·#2 는 정책에 묶임. #4~#8 은 명시적 user-intent — 우회가 의도적. **문제는 #3.**

---

## §3. 발견된 문제

### Issue 1 — `useBusyMark` (frontend) 와 `suppressAutoHide` (main) 가 연결 안 됨 ★
**증상**: 설정 다이얼로그 / ItemDialog / 위자드 / 페이월 등을 열어둔 채로 다른 앱 alt-tab → autoHide=ON 이면 런처가 hide → 다이얼로그도 같이 사라짐. 돌아오면 다이얼로그 state는 살아있어도 사용자에겐 "내가 뭐 만지고 있었는데 사라졌다" 로 체감.

**원인**: `useBusyMark` 는 ESC fallback / Tab 순환 차단용으로만 쓰임. main 의 `suppressAutoHideSources` 에 자동 등록되지 않음. clean-mode / tutorial 만 명시적으로 등록.

**수정안**:
- (작은) `useBusyMark` 훅이 mount 시 `setSuppressAutoHide(true, 'busy:<key>')` 도 같이 호출하도록 변경. 모든 modal 자동 보호.
- (또는) `userBusy.ts` 의 `setBusy` 함수 안에서 main 으로 IPC 송신.

### Issue 2 — `useLaunchPipeline` 의 `hideApp()` 직접 호출 ★
**증상**: 카드 closeAfter 동작이 이중 경로. 한 경로는 funnel 통과, 한 경로는 우회. clean-mode 진입 후 closeAfter 카드 실행하면 main 의 `maybeCloseAfter` 는 suppression 으로 스킵되지만, 렌더러의 `electronAPI.hideApp()` 가 강제로 hide.

**원인**: 카드 maximizeWindow 후 닫는 로직이 main.js launch IPC handler (`maybeCloseAfter`) 와 useLaunchPipeline 양쪽에 중복.

**수정안**:
- useLaunchPipeline 에서 `electronAPI.hideApp()` 직접 호출 제거. main 의 `maybeCloseAfter` 가 이미 같은 의도로 동작.
- 또는 funnel 이 있는 IPC `'request-close-after'` 신설해서 그쪽으로 라우팅.

### Issue 3 — Suppression source 누수 가능성
**증상**: 렌더러 crash / hot-reload / unexpected unmount 시 `set-suppress-autohide(false, source)` cleanup IPC 가 안 가면 source 가 main 의 Set 에 영구 잔류. 결과: autoHide 가 영구 무력화. 사용자는 "왜 안 닫히지?" 만 느낌.

**원인**: main 이 렌더러 수명을 추적하지 않음.

**수정안**: `mainWindow.webContents` 의 `'destroyed'` / `'render-process-gone'` 이벤트에서 `suppressAutoHideSources.clear()`.

### Issue 4 — Blur 가 외부 다이얼로그 / PS 창에 의해 fire
**증상**: 카드 launch → PS 가 외부 창 활성화 → main blur → autoHide=ON 이면 launch 도중에 런처 hide. `reassertTopAfterLaunch` 가 250ms 후 z-order 만 다시 올리지만 이미 hide 된 후엔 보이지 않음.

**원인**: 정책상 의도된 동작 (포커스 잃으면 닫음). 단, "방금 카드 클릭 → 그 카드 창이 떠서 blur" 는 사용자가 "내가 닫은 게 아닌데" 로 느낄 여지.

**수정안 (선택)**:
- `tryDismissWindow('blur')` 에 짧은 grace period (300ms) 도입: 직전 launch IPC 가 발사된 직후라면 첫 blur 한 번 무시.
- 또는 launch handler 가 fire 후 잠깐 `setSuppressAutoHide(true, 'launch-grace')` 등록 후 500ms 뒤 해제.

### Issue 5 — `cachedAutoHide` 부트 시점 race
**증상**: 매우 드뭄. boot 직후 첫 blur 가 cache 초기화(`:2019`) 보다 먼저 fire 한 적이 있으면 false 로 읽음.
**현재**: `cachedAutoHide = !!store.get(...)` 는 createMainWindow 안에서 BrowserWindow 생성 직후 실행 → blur 이벤트 등록보다 먼저 → race 없음. ✓

---

## §4. 권장 수정 (난이도 오름차순)

### Fix 1 — `useBusyMark` 가 `setSuppressAutoHide` 도 호출하도록 (Issue 1)
`frontend/src/lib/userBusy.ts` 의 `useBusyMark` 또는 `setBusy` 안에 `electronAPI.setSuppressAutoHide(active, 'busy:<key>')` 추가. 한 군데 수정으로 모든 모달 자동 보호.

### Fix 2 — Suppression cleanup on renderer crash (Issue 3)
main.js 의 `createMainWindow` 안:
```js
mainWindow.webContents.on('render-process-gone', () => suppressAutoHideSources.clear());
mainWindow.webContents.on('destroyed', () => suppressAutoHideSources.clear());
```

### Fix 3 — useLaunchPipeline 의 `hideApp()` 직접 호출 제거 (Issue 2)
3 군데 (`useLaunchPipeline.ts:138, 179, 248`) 의 `if (closeAfter) electronAPI.hideApp()` 라인 제거. main.js handler 의 `maybeCloseAfter` 가 이미 같은 동작.
- 검증 필요: closeAfter 동작이 main 측에서만 fire 해도 사용자 체감에 차이 없는지 (timing 약간 다를 수 있음).

### Fix 4 — Launch grace period (Issue 4, 선택)
launch IPC handler 들의 시작점에서 `setSuppressAutoHide(true, 'launch-grace')` + 500ms 뒤 해제. PS 가 만드는 일시적 blur 무시.

### Fix 5 — `userBusy` SSOT 통합 문서화
`plans/ssot-index.md` A.6 (escapeStack 옆)에 `userBusy` 항목 추가, "useBusyMark 가 ESC fallback + Tab 차단 + suppressAutoHide 세 가지를 동시에 좌우" 명시.

---

## §5. 권장 순서

1. **Fix 1** (가장 효과 큼) — modal/wizard alt-tab 사라짐 즉시 해결.
2. **Fix 2** (방어 한 줄) — 누수 차단.
3. **Fix 3** (정합성) — 이중 hide 경로 제거.
4. (선택) Fix 4 / Fix 5.

---

## §6. 검증 시나리오 (수정 후)

- [ ] autoHide=ON 상태에서 설정 다이얼로그 열고 alt-tab → 런처+다이얼로그 살아있음
- [ ] autoHide=ON 상태에서 ItemDialog (카드 추가/편집) 열고 alt-tab → 살아있음
- [ ] autoHide=ON 상태에서 다이얼로그 닫고 alt-tab → 정상 hide
- [ ] 튜토리얼 진행 중 alt-tab → 런처 살아있음 (기존 동작 유지, 회귀 없음)
- [ ] 클린 모드 진입 후 alt-tab (삭제 다이얼로그 OS-level) → 런처 살아있음 (기존 동작 유지)
- [ ] closeAfter=true 카드 클릭 → 런처 닫힘 (한 번만, 깜빡임 없음)
- [ ] closeAfter=false 카드 클릭 후 외부 창 활성화 + autoHide=ON → 외부 창 떴으니 런처 닫힘 (정책상 정상)
- [ ] 글로벌 단축키 / 트레이 / orb 토글 정상 동작 (회귀 없음)
- [ ] DevTools 강제 종료 후 재시작 → suppressAutoHideSources 깨끗 (autoHide 정상 동작)
