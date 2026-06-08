# Perf Probe — 성능 진단 시스템

> 작성: 2026-05-15 (v1.3.39 도입), v1.3.42 hotfix 진단 시 결정적이었음
> nost 의 성능 문제는 거의 항상 IPC 폭주 / 무한 렌더 / store 폭주 중 하나. 이 진단 시스템이 즉시 식별해줌.

---

## 1. 무엇을 측정하나 (10초 윈도우)

`%APPDATA%/nost/logs/main.log` 에 10초마다 4 카테고리 한 줄씩:

### 1.1 `[perf] ipc(10s):` — IPC 채널별 호출 횟수
```
[perf] ipc(10s): analyze-clipboard×7(0ms) get-resource-stats×5(1ms)
                 perf:renderer-report×1(0ms) get-extension-bridge-status×1(0ms)
```
- 채널명 × 호출수 (평균 처리 ms)
- 상위 12개만 표시
- main.js 에서 `ipcMain.handle` / `ipcMain.on` 자동 wrap 으로 측정

### 1.2 `[perf] store-set(10s):` — electron-store 쓰기
```
[perf] store-set(10s): total=4 kb=387.4 appData×4
```
- 총 쓰기 횟수 + 누적 KB + 가장 많이 쓴 키
- `store.set` proxy 로 측정

### 1.3 `[perf] timers(10s):` — 백그라운드 tick
```
[perf] timers(10s): dialog-poll×17 ext-warmup×0
```
- 알려진 setInterval ticks (dialog-poll, ext-warmup, orb-drag)
- 600ms 폴 → 약 16~17 회/10s 정상

### 1.4 `[perf] render(10s):` — React 리렌더 횟수
```
[perf] render(10s): ItemCard×482 SpaceAccordion×24 MemoCard×91 StatusBar×5 App×6
```
- 컴포넌트별 렌더 횟수 (상위 12개)
- 인스트루먼트된 컴포넌트: `App`, `ItemCard`, `MemoCard`, `SpaceAccordion`, `StatusBar`
- renderer 의 `bumpRender(name)` → 10초마다 IPC `perf:renderer-report` 로 main 에 푸시

---

## 2. 정상치 (idle 기준 — 사용자 안 만지는 동안)

```
[perf] ipc(10s):
  analyze-clipboard×6~8   ← 1.5초 폴
  get-resource-stats×5    ← 2초 폴 (StatusBar CPU/메모리)
  perf:renderer-report×1
  get-extension-bridge-status×1

[perf] timers(10s):
  dialog-poll×16~17

[perf] render(10s):
  StatusBar×5             ← get-resource-stats 응답마다 1회
  (App / ItemCard / 기타 = 0 또는 안 보임)

[perf] store-set: (없음 — idle 시 disk write 안 일어남)
```

---

## 3. 비정상 신호 — 즉시 의심

| 신호 | 의심 | 진단법 |
|---|---|---|
| `store-save × 20+` (10s) | save 폭주 / 무한 루프 | useAppData.save 호출처 트레이스 |
| `set-opacity / set-auto-hide / setWindowOpenAt / updateShortcut` 동시 폭주 (15+/10s) | **`updateSettings` 무한 호출** ← v1.3.42 의 원인 | 호출처 + idempotency 가드 확인 |
| `App × 20+` (10s) | App 전체 리렌더 폭주 | 부모 state update 트레이스 |
| `ItemCard × 1000+` (10s) | 카드 React.memo 동작 안 함 | comparator 또는 prop ref stability 확인 |
| `analyze-clipboard × 50+` (10s) | 1.5초 폴이 폴 cycle 어김 = useEffect 다중 인스턴스 | App 마운트/언마운트 루프 의심 |
| `dialog-poll × 50+` (10s) | 600ms 폴 다중 인스턴스 | setInterval 중복 호출 의심 |
| `store-set: kb=4000+` (10s) | 4MB+ 디스크 쓰기 = 심각 | 큰 객체 (appData ~100KB) 가 자주 저장됨 |

---

## 4. 실제 진단 사례

### v1.3.42 hotfix — 창 크기 조정 시 렌더러 크래시

증상: 사용자 "창 크기 조정하면 오류창 뜨고 창 크기 조정 안 됨"

main.log 의 [perf] 라인:
```
[perf] ipc(10s): set-opacity×25 set-auto-hide×25 set-window-open-at×25
                 update-shortcut×25 set-window-size-pct×18 store-save×26
[perf] store-set(10s): total=44 kb=4554.6 appData×44
[perf] render(10s): ItemCard×769 MemoCard×250 ... App×53
```

**진단**: 5개 settings IPC 가 동시에 25회씩 = `updateSettings` 가 10초에 25번 호출. 4.5MB 디스크 쓰기. App 53번 렌더. 명백한 무한 루프.

**원인 추정**: StatusBar `<Slider value={[sizePct]}>` 가 base-ui slider 라 array reference 변경 (매 렌더 새 배열) 에 onValueChange 발사. → `commit` → `store.updateSettings` → 5개 IPC + save → setRawData → 재렌더 → 슬라이더 또 발사 → 무한.

**해결**: `useAppData.updateSettings` 를 idempotent 로. 각 IPC 가 해당 필드 실제 변경 시에만 발사. settings JSON 동일 시 save 자체 skip. 동일 값으로 100번 호출되어도 IPC 0, save 0 → 루프 차단.

이 fix 의 핵심은 perf-probe 없이는 못 잡았을 거 — 사용자가 "크래시났다" 만 알려줬을 때 어디서 폭주하는지 즉시 보여줌.

---

## 5. perf 끄기

운영 부담 우려 시 (실제론 미미 — 카운터 증분당 ~80ns):

`main.js` 의 perf 블록 (line ~62~) 의 `setInterval(() => {...}, PERF_FLUSH_MS)` 한 줄 주석 처리.

또는 환경변수로 게이트하려면 위 `PERF_FLUSH_MS = 10000;` 자리에 `const PERF_ENABLED = process.env.NOST_PERF !== '0';` 추가 + `setInterval` 안에 `if (!PERF_ENABLED) return;`.

---

## 6. 호출 방법 (개발자)

### 추가 컴포넌트 인스트루먼트
```ts
import { bumpRender } from '../lib/perf';

function MyHotComponent() {
  bumpRender('MyHotComponent');  // ← render 함수 최상단
  // ...
}
```

### 임의 카운터 (effect fire, callback 등)
```ts
import { bumpCounter } from '../lib/perf';

useEffect(() => {
  bumpCounter('my-effect-fire');
  // ...
}, [deps]);
```

### main 측 timer 카운터
```js
setInterval(() => {
  perfBumpTimer('my-poll');  // ← 함수 첫 줄
  // ...
}, 600);
```

---

## 7. 로그 수집

사용자가 버그 보고할 때 요청:

```powershell
Get-Content "$env:APPDATA\nost\logs\main.log" `
  | Select-String "\[perf\]" `
  | Select-Object -Last 40
```

40 줄이면 10 분치 = idle 베이스라인 + 사용자 action 시점 비교 충분.

---

## 8. 관련 파일

- 측정 인프라: `main.js` (perf 블록 line ~62~) + `frontend/src/lib/perf.ts`
- IPC: `perf:renderer-report` (renderer → main, 10초마다)
- 호출처:
  - `App.tsx` — `bumpRender('App')` + `startPerfFlush()` (mount)
  - `ItemCard.tsx` / `MemoCard.tsx` / `SpaceAccordion.tsx` / `StatusBar.tsx` — `bumpRender(...)`
  - `main.js` — `tickDialogPoll`, `ext-warmup`, `orb-drag` 에 `perfBumpTimer(...)`
