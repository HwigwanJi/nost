# Favicon 캐싱 연구노트

> 작성일: 2026-04-27 (§0 추가)
> 관련 파일: [ItemDialog.tsx](frontend/src/components/ItemDialog.tsx), [ItemWizard.tsx](frontend/src/components/ItemWizard.tsx), [main.js](main.js)
> 컨텍스트: 워크스루는 [walkthrough_v2.md](walkthrough_v2.md) §5 참고

---

## 0. 🚨 현재 favicon이 작동하지 않는 진짜 이유 (CSP)

> **이게 사용자가 보고한 "favicon 작동 안함" 버그의 근본 원인.** 캐싱 작업 들어가기 전에 반드시 인지해야 함.

### 발견 위치

[main.js:2383-2390](main.js)의 `session.defaultSession.webRequest.onHeadersReceived`가 모든 렌더러 응답에 다음 CSP를 강제 주입:

```
img-src 'self' data: https://www.google.com;
```

### 5개 favicon 후보 중 1개만 통과

[ItemDialog.tsx:81-96](frontend/src/components/ItemDialog.tsx)의 `faviconCandidates()`가 시도하는 5개 후보 vs 위 CSP:

| # | 후보 | 통과? |
|---|------|-------|
| 1 | `${origin}/apple-touch-icon.png` | ❌ |
| 2 | `${origin}/apple-touch-icon-precomposed.png` | ❌ |
| 3 | `https://www.google.com/s2/favicons?domain=...&sz=256` | ✅ **유일** |
| 4 | `${origin}/favicon.ico` | ❌ |
| 5 | `https://icons.duckduckgo.com/ip3/...` | ❌ |

→ 실제로는 **Google favicon 서비스 단일 의존**. Fallback 체인은 코드만 존재할 뿐 동작하지 않음.

### 왜 깨지는가 (실패 시나리오)

1. **Google s2가 해당 도메인 모름** → 회색 1×1 placeholder 반환. `tryLoadImage`의 `<img>.onload`는 1×1에도 발화하므로 "성공"으로 잘못 판정 → **카드에 빈/회색 사각형 저장**
2. **사내망/방화벽/일부 ISP가 google.com/s2 차단**
3. **Google이 `sz=256` 무시하고 16~32px만 반환** (실측 사례 다수)
4. 저장된 favicon이 원격 URL 문자열 → 매 렌더마다 Google에 재요청. Google 일시 다운/네트워크 변경 시 즉시 깨짐

### 해결 옵션

**A. 빠른 패치 (CSP 완화)** — 5분, 즉시 동작 회복하지만 캐싱 X

```javascript
// main.js:2387
"img-src 'self' data: https:; " +   // 'https://www.google.com' → 'https:'
```

`https:` 스킴 와일드카드로 5개 후보 모두 통과. 단점:
- 로컬 캐싱 안됨 (사용자 원본 요구 미충족)
- 보안 표면적 미세 증가 (XSS 진입점 없는 런처 앱이라 실질 위험 낮음)

**B. 본 해결 (Option A — data URL 다운로드, §3 참고)** — 권장

- main process가 `net.fetch`로 favicon 다운로드 → base64 변환 → data URL 반환
- **CSP의 `data:` 는 이미 허용되어 있으므로 CSP 수정 불필요**
- main process는 CSP 영향 받지 않음 → 5개 후보 모두 시도 가능
- 한 번 다운로드 → 영구 저장 = 사용자 요구(캐싱) 정확히 충족
- 1×1 placeholder는 nativeImage.getSize()로 감지해서 거부 가능 (현재 폴링은 못함)

### 권장 경로

1. **B 직행**: §3~§5의 단계대로 `download-favicon` IPC + `useFavicon` 훅 구현. CSP 손대지 않음.
2. **A 임시 적용 → B 작업**: B 작업 중에도 favicon 보고 싶다면 A를 한 줄 패치로 먼저 적용. B 완성 후 CSP는 다시 좁힐 수 있음 (`https:` → `'self' data:`로 복귀).

### 부수 발견: 1×1 placeholder가 "성공"으로 판정되는 버그

[ItemDialog.tsx:98-106](frontend/src/components/ItemDialog.tsx)의 `tryLoadImage`는 단순히 `<img>.onload`만 검사 → 1×1 회색 픽셀도 통과. Google s2가 도메인을 모를 때 이 placeholder를 받으므로, **CSP를 풀어도 빈 사각형 카드가 생성될 수 있음.** B 옵션은 main process에서 `nativeImage.getSize()`로 거부 가능.

```javascript
const img = nativeImage.createFromBuffer(buf);
const { width, height } = img.getSize();
if (width <= 4 || height <= 4) continue;  // placeholder 거부
```

---

## 1. 문제 정의

### 현재 동작

URL 카드 추가 시 [ItemDialog.tsx:81-196](frontend/src/components/ItemDialog.tsx)의 favicon 자동 페치 로직:

```typescript
// 후보 5개 순차 시도
faviconCandidates(url) → [
  `${origin}/apple-touch-icon.png`,
  `${origin}/apple-touch-icon-precomposed.png`,
  `https://www.google.com/s2/favicons?domain=${domain}&sz=256`,
  `${origin}/favicon.ico`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
]

// 첫 성공한 후보를 그대로 저장
form.icon = candidate;        // <- 원격 URL 문자열
form.iconType = 'image';
```

저장 후 [ItemCard.tsx](frontend/src/components/ItemCard.tsx)는 `<img src={item.icon}>`로 직접 렌더.

### 문제점

| # | 문제 | 영향 |
|---|------|------|
| 1 | **원격 URL을 매번 fetch** | 네트워크 의존성, 로딩 지연 |
| 2 | **로컬 캐시 없음** (브라우저 HTTP 캐시만) | 브라우저 캐시 만료/제거 시 재-fetch |
| 3 | **서버 다운/이동 시 영구 손실** | google.com/s2 또는 origin이 바뀌면 아이콘 사라짐 |
| 4 | **오프라인에서 깨짐** | 비행기 모드 등에서 카드 아이콘 안 보임 |
| 5 | **프라이버시 누출** | 매 렌더마다 google/duckduckgo에 도메인 정보 전송 |
| 6 | **배포된 앱에서 GFW/방화벽 영향** | 한국에서 google.com/s2는 보통 OK지만 일부 환경 차단 |

### 비교: 앱 아이콘은 이미 영구 캐시됨

[main.js:1477-1500](main.js)의 `get-file-icon` IPC 핸들러는 `app.getFileIcon(filePath, {size:'large'})` → `.toDataURL()` 변환 후 반환. 결과는 `iconType='image'` + `icon = 'data:image/png;base64,...'`로 저장 → **재시작 후, 오프라인에서, 원본 파일 삭제 후에도 아이콘 표시됨**.

→ favicon도 **같은 패턴(data URL)** 이나 **로컬 파일 캐시** 둘 중 하나로 통일하면 해결.

---

## 2. 해결 옵션 비교

### Option A: data URL 인라인 (앱 아이콘과 동일 패턴)

**방법**: main.js에 새 IPC `download-favicon-data-url` 추가. 첫 fetch 시 결과를 base64로 변환 → `item.icon`에 data URL 저장.

```javascript
// main.js
ipcMain.handle('download-favicon-data-url', async (_, candidates) => {
  for (const url of candidates) {
    try {
      const res = await net.fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 || buf.length > 200_000) continue;  // sanity
      const mime = res.headers.get('content-type') || 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {}
  }
  return null;
});
```

**장점**:
- 앱 아이콘과 일관된 저장 형태 (`data:` prefix)
- 별도 캐시 디렉토리 관리 불필요
- 백업 .nost 파일에 자체 포함 (이식성 100%)
- 렌더에서 추가 IPC 호출 없음 (이미 data URL)

**단점**:
- electron-store / .nost 파일 크기 증가 (favicon 평균 4~30KB × N개 = 누적)
- 64×64 라스터로 다운샘플링하면 ~3-5KB로 줄일 수 있음 (canvas)
- 카드 200개면 1~2MB 정도 — 문제 안 됨

### Option B: 로컬 파일 캐시 (`userData/icons/{hash}.png`)

**방법**: main.js에 IPC 추가. 첫 fetch 시 `app.getPath('userData')/icons/{sha1(domain)}.png`로 저장 → `item.icon`에 로컬 절대 경로 저장. 렌더는 `file://` URL.

```javascript
const ICON_DIR = path.join(app.getPath('userData'), 'icons');
fs.mkdirSync(ICON_DIR, { recursive: true });

ipcMain.handle('download-favicon-file', async (_, { candidates, domain }) => {
  const hash = crypto.createHash('sha1').update(domain).digest('hex');
  const target = path.join(ICON_DIR, `${hash}.png`);
  if (fs.existsSync(target)) return target;  // 이미 있음

  for (const url of candidates) {
    try {
      const res = await net.fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // (선택) sharp 또는 nativeImage로 리사이즈
      const img = nativeImage.createFromBuffer(buf).resize({ width: 64 });
      fs.writeFileSync(target, img.toPNG());
      return target;
    } catch {}
  }
  return null;
});
```

**장점**:
- electron-store 크기 안정
- 도메인별로 1개 파일 → 같은 도메인 카드 여러 개 시 dedup
- 디스크에 분리되어 디버깅/수동 교체 쉬움

**단점**:
- 백업 `.nost` 파일과 분리됨 → 가져오기 시 아이콘 손실 (해결: zip 형태로 export 시 icons도 같이 패킹)
- 파일 권한/경로 문제 가능성 (`file://` 로딩 + ASAR/Windows 경로)
- 캐시 GC 필요 (삭제된 카드의 고아 파일)
- 보안: `<img src="file:///">` 허용 설정 (webSecurity / CSP) 필요

### Option C: 하이브리드 (원격 URL + 백그라운드 캐시)

**방법**: 현재처럼 원격 URL 저장. 동시에 첫 로드 시 백그라운드 fetch → data URL을 별도 필드 `iconCache`에 저장. 렌더 우선순위: `iconCache` ?? `icon`.

```typescript
interface LauncherItem {
  // ...
  icon?: string;          // 기존: data URL OR remote URL OR material name
  iconCache?: string;     // NEW: 항상 data URL (로컬 캐시)
}
```

**장점**:
- 점진 마이그레이션 가능 (기존 데이터 깨지지 않음)
- 캐시 미스 시 원격 fallback (강건성)
- 백그라운드 갱신 가능 (사이트 리브랜딩 대응)

**단점**:
- 두 필드 동시 관리 복잡
- 결국 data URL 저장 → A와 동일한 디스크 비용
- 마이그레이션 로직 필요

### Option D: 원격 URL 유지 + Service Worker / 캐시 API

**방법**: BrowserWindow의 `session.defaultSession`에 캐시 강제 설정. 또는 `protocol.registerHttpProtocol`로 favicon만 별도 캐시 정책.

**장점**:
- 코드 변경 최소
- 표준 HTTP 캐시 메커니즘 활용

**단점**:
- Electron HTTP 캐시는 사용자가 cache 클리어하면 사라짐
- "한번 가져오면 영구"라는 사용자 요구사항을 만족 못함
- 캐시 정책 엔진 만지는 건 부수효과 큼

### Option E: 원격 URL 유지 + Cache-Control override

기각. (오프라인/서버 다운 문제 해결 불가)

---

## 3. 추천: **Option A (data URL)** ★

**근거**:
1. **앱 아이콘과 일관성**: [main.js:1497-1498](main.js)의 `app.getFileIcon().toDataURL()` 패턴을 그대로 반영 → 코드 컨벤션 통일
2. **백업/이식성**: .nost export에 자체 포함, 다른 머신에서도 그대로 동작
3. **단순성**: 새 필드/마이그레이션 불필요, 렌더 로직 변경 0
4. **디스크 비용 무시 가능**: 64×64 PNG ~3KB × 100 카드 = 300KB
5. **현재 ItemDialog의 image crop 흐름과 동일 형태**로 저장됨 ([ItemDialog.tsx:282-291](frontend/src/components/ItemDialog.tsx))

### 구현 스케치

#### 1) main.js — 새 IPC 핸들러

```javascript
// main.js (get-file-icon 근처에 추가)
ipcMain.handle('download-favicon', async (_, candidateUrls) => {
  if (!Array.isArray(candidateUrls) || candidateUrls.length === 0) return null;

  for (const url of candidateUrls) {
    try {
      const res = await net.fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) continue;  // 너무 작으면 1px placeholder 가능성

      // nativeImage로 64x64 정규화 (선택, 디스크 절약)
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) continue;
      const resized = img.getSize().width > 128
        ? img.resize({ width: 128, quality: 'best' })
        : img;
      return resized.toDataURL();   // data:image/png;base64,...
    } catch (e) {
      log.warn('[favicon] fetch failed', url, e.message);
    }
  }
  return null;
});
```

#### 2) preload.js — API 노출

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  // ...기존
  downloadFavicon: (candidates) => ipcRenderer.invoke('download-favicon', candidates),
});
```

#### 3) electronBridge.ts — 타입 추가

```typescript
export interface ElectronAPI {
  // ...
  downloadFavicon: (candidates: string[]) => Promise<string | null>;
}
```

#### 4) 공유 훅 추출 — `frontend/src/hooks/useFavicon.ts`

ItemDialog와 ItemWizard에 중복된 로직을 훅으로 통일:

```typescript
import { useEffect } from 'react';
import { electronAPI } from '../electronBridge';

export function faviconCandidates(inputUrl: string): string[] {
  try {
    const u = new URL(inputUrl);
    return [
      `${u.origin}/apple-touch-icon.png`,
      `${u.origin}/apple-touch-icon-precomposed.png`,
      `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=256`,
      `${u.origin}/favicon.ico`,
      `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`,
    ];
  } catch { return []; }
}

/**
 * URL 입력 시 favicon을 가져와 data URL로 변환.
 * 첫 성공 시 onResolved(dataUrl) 호출. 실패 시 onResolved(null).
 */
export function useFaviconAutoFetch(opts: {
  url: string | null;
  enabled: boolean;
  onResolved: (dataUrl: string | null) => void;
}) {
  const { url, enabled, onResolved } = opts;
  useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;
    (async () => {
      const candidates = faviconCandidates(url);
      const dataUrl = await electronAPI.downloadFavicon(candidates);
      if (!cancelled) onResolved(dataUrl);
    })();
    return () => { cancelled = true; };
  }, [url, enabled, onResolved]);
}
```

#### 5) ItemDialog / ItemWizard 적용

기존 `tryLoadImage` 폴링 + `form.icon = remoteUrl` 흐름 제거. 대신:

```typescript
useFaviconAutoFetch({
  url: ensureHttpUrl(form.value),
  enabled: !manualIconRef.current && (form.type === 'url' || form.type === 'browser'),
  onResolved: (dataUrl) => {
    if (dataUrl) {
      setForm(prev => ({ ...prev, iconType: 'image', icon: dataUrl }));
      setAutoFavicon(true);
    } else {
      setForm(prev => ({ ...prev, iconType: 'material', icon: 'public' }));
      setAutoFavicon(false);
    }
  },
});
```

#### 6) 마이그레이션 (선택)

기존 카드의 `icon`이 `https?:` URL이면 다음 호출 시점에 백그라운드로 변환:

```typescript
// useAppData.ts 또는 App.tsx
useEffect(() => {
  const stale = spaces
    .flatMap(s => s.items)
    .filter(i => i.iconType === 'image' && i.icon?.startsWith('http'));
  
  for (const item of stale) {
    electronAPI.downloadFavicon(faviconCandidates(item.value))
      .then(dataUrl => {
        if (dataUrl) updateItem(item.id, { icon: dataUrl });
      });
  }
}, []);  // 앱 시작 시 1회
```

---

## 4. 추가 고려사항

### 4.1 큰 favicon 차단

크기 sanity check (`buf.length > 200_000` reject) — SVG 또는 거대한 PNG 방어.

### 4.2 1×1 placeholder 감지

google.com/s2는 도메인이 없을 때 1×1 회색 픽셀을 반환. nativeImage.getSize()로 검증:

```javascript
const { width, height } = img.getSize();
if (width <= 4 || height <= 4) continue;
```

### 4.3 테마 다크/라이트 자동 전환

일부 사이트(GitHub 등)가 dark/light favicon을 분리 제공 (`<link rel="icon" media="(prefers-color-scheme: dark)">`).
→ 현재 처리 안 됨. 후속 과제.

### 4.4 동시성 / 폭주 방지

마이그레이션 시 100개 URL 동시 fetch는 부담. `p-limit` 또는 단순 sequential 처리로 동시 5개 제한 권장.

### 4.5 갱신 정책

사이트 리브랜딩 시 캐시된 아이콘이 stale. 옵션:
- **수동만**: 사용자가 카드 편집 → "아이콘 새로고침" 버튼
- **TTL 기반**: 30일 후 백그라운드 갱신
- **수동 + 명시적 stale 표시 없음** (현재 추천 — 단순)

### 4.6 ItemDialog와 ItemWizard 중복 제거

[ItemDialog.tsx:81-106](frontend/src/components/ItemDialog.tsx)와 ItemWizard에 동일한 `faviconCandidates` / `tryLoadImage`가 중복. 위 5번 단계의 `useFavicon` 훅 추출이 이 부담도 같이 해결.

---

## 5. 작업 단계 (실행 순서)

1. ☐ `main.js`에 `download-favicon` IPC 핸들러 추가 + log
2. ☐ `preload.js` + `electronBridge.ts`에 `downloadFavicon` 노출
3. ☐ `frontend/src/hooks/useFavicon.ts` 새 파일 — `faviconCandidates`, `useFaviconAutoFetch`
4. ☐ ItemDialog 적용 — 기존 `faviconCandidates`/`tryLoadImage` 제거, 훅 사용
5. ☐ ItemWizard 적용 — 동일
6. ☐ 사이즈 sanity check 추가 (1×1, 200KB+ 차단)
7. ☐ (선택) 마이그레이션: 앱 시작 시 `http(s):`로 시작하는 기존 icon을 data URL로 변환
8. ☐ 테스트: 오프라인 모드 / 사이트 다운 시뮬레이션 / 백업-복원 시 아이콘 보존 확인

---

## 6. 결정 보류 / 추후 결정

- [ ] 마이그레이션 자동 vs 수동? (한번 결정 후 일괄 vs 카드 편집 시점에)
- [ ] dark/light 자동 favicon 지원 여부
- [ ] 백업 .nost 파일 크기 우려 시 별도 압축 (현재 JSON으로 보임 → gzip 옵션)
- [ ] Container 카드의 슬롯 아이템들도 동일 정책으로 처리? (현재 슬롯 아이템도 LauncherItem이라 자동 적용됨)

---

## 7. 참고 코드 위치

| 항목 | 위치 |
|------|------|
| 현재 favicon 후보 함수 (ItemDialog) | [ItemDialog.tsx:81-96](frontend/src/components/ItemDialog.tsx) |
| 현재 favicon 후보 함수 (ItemWizard) | [ItemWizard.tsx:119-127](frontend/src/components/ItemWizard.tsx) |
| 자동 페치 useEffect | [ItemDialog.tsx:159-196](frontend/src/components/ItemDialog.tsx) |
| 수동 페치 버튼 핸들러 | [ItemDialog.tsx:220-233](frontend/src/components/ItemDialog.tsx) |
| Image crop → data URL (참고 패턴) | [ItemDialog.tsx:278-293](frontend/src/components/ItemDialog.tsx) |
| 앱 아이콘 → data URL (참고 패턴) | [main.js:1477-1500](main.js) |
| 렌더 (ItemCard) | [ItemCard.tsx](frontend/src/components/ItemCard.tsx) — `<img src={item.icon}>` |
