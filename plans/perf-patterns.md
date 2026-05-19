# Perf 기본 체급 — Electron + React 런처용 패턴 가이드

> 이 프로젝트 반복 발생하는 perf 문제와 그 해법. 새 코드 작성 전 한 번 훑기.
> 작성: 2026-05-19 (v1.3.47, 클립보드 이미지 폴링 124ms/tick 사건 계기).

이 앱은 **상시 백그라운드 폴링**이 많아서 (clipboard 1.5s, dialog detect 600ms, badge sync, resource stats 2s, ext-warmup 1.5s) 각 폴 1tick의 비용이 누적된다. 100ms × 60tick/min = 분당 6초 CPU. 사용자가 "버벅임"으로 체감.

---

## 핵심 원칙 (priority)

| # | 원칙 | 위반 시 증상 |
|---|---|---|
| 1 | **계산 결과 = 입력 시그니처로 캐시** | 같은 입력에 매번 풀-디코드 → "갑자기 느려짐" |
| 2 | **하이프리 입력은 throttle / debounce** | 슬라이더, 드래그, 폴링 → 누적 IPC 폭주 |
| 3 | **lazy — 보일 때만 계산** | 위에서 안 보이는 카드들도 풀-리렌더 |
| 4 | **document.hidden 가드** | 백그라운드에서 폴링 지속 → 배터리 / CPU 낭비 |
| 5 | **재인코딩 회피 — 원시 byteLength 사용** | toPNG / toJSON / JSON.stringify 큰 객체 hot path |
| 6 | **functional setState** | 같은 tick 동시 mutation → race + stale write |
| 7 | **bumpRender 로 hot component 찾기** | "느린데 어디가 느린지 모름" |

---

## §1. 폴링 hot path 패턴

### 1.1 시그니처 캐시 (Recommended for clipboard / file watch)

```js
let _cache = null;
function expensiveAnalyze(input) {
  const sig = makeSignature(input);  // cheap key: hash / length / formats
  if (_cache && _cache.sig === sig) return _cache.payload;
  const payload = doExpensiveWork(input);
  _cache = { sig, payload };
  return payload;
}
```

**규칙**:
- `makeSignature` 자체가 비싸면 안 됨. `availableFormats().join('|')` / `readText().length` / `mtime+size` 등 미세
- 캐시 무효화 트리거 명시 — clipboard write 후 / file write 후 / 사용자 dismiss 후
- 캐시 키 일관 — 같은 입력에 다른 키 만들면 효과 0

**적용 사례**:
- `main.js::analyze-clipboard` → 텍스트 hash (v1.3.40)
- `main.js::analyze-clipboard` 이미지 → formats + text length (v1.3.47, ~120ms → ~2ms)
- `main.js::analyze-clipboard` file-drop → `formats.some(== 'CF_HDROP')` cheap probe + formats-key 캐시. 외부 PowerShell spawn (~800ms) 을 클립보드 변화 시 1회로 압축. negative outcome ("이건 image file 아님") 도 캐싱해서 비이미지 파일 복사 시 재spawn 방지 (v1.3.47, 폴당 826ms → ~0ms)

### 1.2 document.hidden 가드

```ts
const intervalId = setInterval(() => {
  if (document.hidden) return;  // 백그라운드면 skip
  void check();
}, 1500);
```

**적용 사례**: clipboard 폴링, StatusBar getResourceStats, App.tsx 의 favicon 자동 fetch.

### 1.3 폴링 간격 동적 조정

high-freq 폴이 사용자에게 영향 큰 시점에만 빠르게:
- launcher hidden → 폴 중단
- launcher visible BUT no recent input → 폴 간격 ×2 (1.5s → 3s)
- launcher focused + 최근 입력 있음 → 정상

명시 폴 트리거 (사용자 키 입력 / window focus) 이 더 좋으면 폴 자체 제거.

---

## §2. 인코딩 비용 회피

### 2.1 큰 binary 의 size 만 알고 싶을 때

```js
// ❌ 비싼 재인코딩
const buf = img.toPNG();         // ~120 ms for 1920×1080
return { byteSize: buf.length };

// ✅ raw bitmap byteLength (실제 PNG 크기와는 다르지만 추세 비교용)
const bitmap = img.getBitmap();  // ~1 ms — view onto existing memory
return { byteSize: bitmap.length };
```

PNG 정확한 크기가 정말 필요하면 사용자 확인 직후에 1회만 재인코딩.

### 2.2 JSON.stringify hot path

```ts
// ❌ 매 render
const formStr = JSON.stringify(form);  // ~3 ms × 60Hz = 180ms/s

// ✅ 변화 추적용 ref + 명시적 dirty flag
const dirtyRef = useRef(false);
useEffect(() => { dirtyRef.current = true; }, [form]);
```

해당 SSOT 가 정말 stringify 가 필요하면 (electron-store save 등) shallow equality 먼저 검사 후 stringify.

### 2.3 image src 는 file:// 만 (data URL 회피)

큰 base64 data URL 은 텍스트로 ~33% inflate + DOM 에 박히면 메모리 부담. 가능하면 `<img src="file://...">` 로 disk 직접 참조.

**적용 사례**: ItemCard 의 image type 카드 — file:// 직접 (v1.3.46)

---

## §3. React render hot path

### 3.1 bumpRender 로 측정

```ts
import { bumpRender } from '../lib/perf';
export function MyComponent() {
  bumpRender('MyComponent');
  // ...
}
```

10초마다 `[perf] render(10s): MyComponent×N` 가 main.log 에 찍힘. N 이 100 이상 / 사용자 액션과 무관하게 누적 → React.memo + custom comparator 검토.

### 3.2 React.memo 깨지는 흔한 원인

- 부모가 매 render `() => ...` 새 익명 함수 prop 전달 → 자식 memo 무효
- 부모가 `{...{a, b}}` 매 render 새 객체 → 동일
- 해결: 부모에서 `useCallback` / `useMemo` 로 안정화, 자식에 custom comparator (콜백 ref 무시)

**적용 사례**: ItemCard / MemoCard / SpaceAccordion 의 v1.3.40 라운드 — 1회 render 에 카드 41개 다 따라가던 패턴 fix.

### 3.3 list virtualisation

수백 카드 / 메모 시각화 시 react-window 또는 manual viewport culling. nost 의 카드 그리드는 아직 가상화 안 함 — 200+ 카드 부터 검토 필요.

---

## §4. IPC 비용

### 4.1 send vs invoke

- `send` (no return) — fire-and-forget. 빠름. 토글 / 로그 / 통지.
- `invoke` (await) — round-trip. RTT 비용. 결과가 필요한 경우만.

### 4.2 빈번한 send 는 batch

```ts
// ❌ 매 keystroke
input.onChange = (e) => electronAPI.updateShortcut(e.target.value);

// ✅ debounce
const debouncedUpdate = useDebouncedCallback(electronAPI.updateShortcut, 250);
input.onChange = (e) => debouncedUpdate(e.target.value);
```

### 4.3 perf log 로 IPC top-N 보기

main.log 에 10초마다 `[perf] ipc(10s): analyze-clipboard×8(45ms) get-resource-stats×5(1ms) ...` 출력. 합산 ms 가 큰 채널이 hot. 캐시 / 간격 조정 / 제거 검토.

---

## §5. 메모리 누수 흔한 자리

1. **이벤트 리스너 cleanup 누락** — useEffect 의 return 에 removeEventListener
2. **WebContents.send 의 listener** — preload 의 `ipcRenderer.on` 도 unsubscribe 반환
3. **Closed BrowserWindow** — destroy() 호출 후 null 처리 (이미 패턴화됨)
4. **인터벌 / 타임아웃** — clearInterval / clearTimeout
5. **요소 ref** — DOM 이 unmount 됐는데 ref.current 유지 → element 자체는 GC 됨, 단 ref.current 가 large data 면 누수

---

## §6. 빌드 / 번들 크기

- main 번들 1MB 이하 유지 (현재 ~480KB)
- satellite 별 청크 분리 — 각 satellite mount 시 lazy 로드 됨 (v1.3.44 satellite 마이그 부수 효과)
- 5MB Material Symbols 폰트는 async import (main.tsx 패턴 그대로)

---

## §7. profile 워크플로우

1. 사용자 보고: "X 가 느림"
2. main.log 마지막 50줄 확인 — `[perf] ipc / render / store-set` 합산이 큰 항목 찾기
3. 의심 채널 / 컴포넌트에 임시 `console.time/Endin` 또는 `log.debug` 박기
4. 해당 hot path 가 폴인지 (cache), 재인코딩인지 (회피), render 누적인지 (memo) 판단
5. 캐시 키 / 게이트 / memo 적용 → 다시 측정 → log 에서 변화 확인

---

## 체크리스트 (새 코드 작성 시)

- [ ] 새 setInterval / setTimeout — clearXxx in cleanup?
- [ ] 새 ipcMain.handle — 결과가 시그니처-캐시 가능한가? 캐시 무효화 트리거는?
- [ ] 새 폴 — document.hidden 가드? 사용자 이벤트로 대체 가능?
- [ ] 새 useEffect dep 에 `data` / 큰 객체 — useCallback / useMemo / functional setState?
- [ ] 새 image / binary 처리 — toPNG / toJSON 등 풀 재인코딩 회피?
- [ ] 새 컴포넌트 렌더 — bumpRender 박아두면 hot 발견 쉬움
- [ ] 새 IPC send — 빈번하면 debounce?
