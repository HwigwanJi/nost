# 로그인 — 현재 상태 + 남은 작업

> SSOT for Phase 1 진행 상태. 작업 진행 시마다 §3, §4 체크박스 갱신.
> 전체 설계는 [`plans/sync-and-auth.md`](./sync-and-auth.md) §1·§11 참조.

---

## §1. 한 줄 요약

**코드 깔림 ✅ / Provider 셋업 ✅ / E2E 검증 🟡 (production installer 검증 대기)**

UI·IPC·토큰 저장·세션 관리·CSP allowlist·PKCE verifier 영속화 모두 들어감.
Supabase Google provider + Redirect URL 등록 끝. 마지막 단계는 production
installer (`nost Setup 1.3.34.exe`) 로 깔아서 E2E 통과 확인.

### 2026-05-14 작업 정리
- **브랜드 마크**: SignInScreen / SettingsDialog 의 Google/GitHub 아이콘이 공식 4색 G / Invertocat 로 (`ui/BrandLogo.tsx`)
- **CSP**: `main.js` 의 connect-src / img-src 에 `*.supabase.co` + OAuth 아바타 도메인 추가
- **PKCE 영속화**: `auth:kv-get/set/list` IPC 4-file 패턴. supabase-js storage adapter 가 모든 키를 safeStorage 에 영속화 → 인스턴스 분리에도 verifier 보존
- **인스턴스 race 우회**: production installer 로 가야 protocol handler 가 `nost.exe` 단일 경로로 등록되어 single-instance lock 정상. dev mode 에서는 새 electron.exe spawn 으로 race 발생 (기진단됨)

---

## §2. 현재 상태 (2026-05-07 기준)

### ✅ 들어간 것

| 항목 | 위치 | 검증 |
|---|---|---|
| Supabase 클라이언트 (URL + anon key) | `frontend/.env`, `frontend/src/lib/supabase.ts` | 빌드에 포함됨 |
| `useAuth()` 훅 + 외부 store | `frontend/src/lib/auth.ts` | TS 타입 OK |
| `bootstrapAuth()` (3초 timeout 포함) | `frontend/src/lib/auth.ts` | 모듈 로드 OK |
| `signIn(provider)` / `signOut()` | `frontend/src/lib/auth.ts` | OAuth provider 미설정이라 호출 시 401 예상 |
| `<SignInScreen />` (Google·GitHub 버튼) | `frontend/src/components/SignInScreen.tsx` | 화면 정상 노출 (게스트 분기) |
| `<AccountTab />` 설정 → 계정 패널 | `frontend/src/components/SettingsDialog.tsx:345+` | 빈 상태 + signed-in 상태 모두 그려짐 |
| `<AppShell />` auth 게이트 + 부트 dismiss | `frontend/src/AppShell.tsx` | idle → signed-out 전환 OK (3s timeout) |
| `<AuthChip />` status bar 좌측 | `frontend/src/components/StatusBar.tsx` | 게스트 / 연결 중 / 이메일 / 오류 상태 분기 |
| `nost://` protocol handler 등록 | `main.js` `app.setAsDefaultProtocolClient('nost', ...)` | 실제 콜백 수신은 **미검증** |
| Auth deep-link IPC | `main.js` `auth:deep-link` 송신, `electronAPI.onAuthDeepLink()` 수신 | provider 셋업 후 검증 필요 |
| `auth:get-session` / `auth:set-session` IPC | `preload.js`, `main.js` | safeStorage 기반, 동작 OK |
| `safeStorage`(DPAPI) 토큰 저장 | `main.js` | 첫 호출 시 OK 확인 |
| `nost:open-settings` 이벤트 라우터 (status bar → 계정 탭) | `App.tsx` | 동작 OK |

### ✗ 안 된 것

| 항목 | 비고 |
|---|---|
| **Supabase Authentication → Providers → Google: 활성화** | 대시보드 작업 |
| **Supabase Authentication → Providers → GitHub: 활성화** (선택) | 대시보드 작업 |
| **Supabase Authentication → URL Configuration → Redirect URLs**: `nost://auth-callback` 추가 | 대시보드 작업 |
| **Google Cloud Console → OAuth 2.0 Client ID** 발급 + Supabase에 Client ID/Secret 입력 | Google 측 + Supabase 측 |
| **GitHub → Developer settings → OAuth Apps** 등록 (선택) | github.com 측 |
| **첫 로그인 E2E** (브라우저 동의 → `nost://` 콜백 → 토큰 추출 → 세션 시작) | 위 셋업 후 |
| **재시작 후 세션 유지** | E2E 검증의 일부 |
| **로그아웃 → 토큰 삭제 + UI 게스트 복귀** | E2E 검증의 일부 |

---

## §3. 사용자(=너) 측 셋업 체크리스트

> 코드는 안 건드려도 됨. 모두 외부 콘솔 작업.

### 3.1 Google Cloud Console (필수)

- [ ] https://console.cloud.google.com 접속
- [ ] 새 프로젝트 생성 (또는 기존 사용)
- [ ] **APIs & Services → OAuth consent screen** 설정
  - User Type: External
  - App name: `nost`
  - User support email: 본인
  - Developer contact: 본인
  - Scopes: `email`, `profile`, `openid` (기본)
  - Test users: 본인 Gmail 주소 등록 (publishing 안 한 상태에선 test user만 로그인 가능)
- [ ] **APIs & Services → Credentials → Create Credentials → OAuth client ID**
  - Application type: **Web application**
  - Name: `nost-supabase`
  - **Authorized redirect URIs**: `https://hjlcgfjzitnizniycdgt.supabase.co/auth/v1/callback`
  - 생성 → **Client ID + Client Secret** 복사 (다음 단계에서 사용)

### 3.2 Supabase 대시보드 (필수)

- [ ] https://supabase.com/dashboard/project/hjlcgfjzitnizniycdgt 접속
- [ ] **Authentication → Providers → Google**
  - Enable: ON
  - Client ID: §3.1에서 복사한 값
  - Client Secret: §3.1에서 복사한 값
  - Save
- [ ] **Authentication → URL Configuration**
  - **Redirect URLs (Allow list)** 에 다음 **두 줄** 추가:
    - `http://127.0.0.1:14502/auth/callback` — v1.3.36+ 의 기본 loopback callback. 새 electron 인스턴스 spawn 없이 내장 HTTP 서버가 받음 + 사용자에게 "로그인 완료" HTML 페이지 표시
    - `nost://auth-callback` — 옛 protocol handler 경로. v1.3.35 이하 사용자 호환 + 만일 loopback 이 막힌 환경 fallback
  - **Site URL**은 `http://127.0.0.1:14502/auth/callback` 또는 적당한 값 (사용 안 하지만 비워두면 일부 흐름에서 문제)

### 3.3 GitHub (선택 — SignInScreen에 GitHub 버튼이 있어서 활성화하면 그게 작동)

- [ ] https://github.com/settings/developers → **OAuth Apps → New OAuth App**
  - Application name: `nost`
  - Homepage URL: `https://github.com/HwigwanJi/nost` (아무거나)
  - **Authorization callback URL**: `https://hjlcgfjzitnizniycdgt.supabase.co/auth/v1/callback`
  - 등록 → Client ID + Client Secret 복사
- [ ] Supabase → Authentication → Providers → GitHub
  - Enable: ON
  - Client ID / Client Secret 입력 → Save

---

## §4. E2E 검증 시나리오 (셋업 후)

§3 완료되면 이 순서대로 검증. 각 단계 **실패 시 §5 트러블슈팅** 참고.

- [ ] **A. 첫 로그인 (Google)**
  - [ ] nost 실행 → SignInScreen이 떠야 함 (게스트)
  - [ ] "Google로 계속" 클릭 → 시스템 기본 브라우저가 열리고 Google 동의 화면 표시
  - [ ] Google 계정 선택 + 동의
  - [ ] 브라우저가 `nost://auth-callback?...` 로 리다이렉트 시도
  - [ ] Windows가 "이 링크를 nost로 열까요?" 묻거나 자동으로 nost가 받음
  - [ ] nost 창이 SignInScreen → App 으로 전환 (signed-in)
  - [ ] StatusBar 좌측의 AuthChip이 `🟢 이메일` 표시
  - [ ] 설정 → 계정 탭에서 프로필 (이름·아바타·provider·이메일) 표시
- [ ] **B. 재시작 후 세션 유지**
  - [ ] nost 완전 종료 (트레이까지 quit)
  - [ ] nost 재실행
  - [ ] SignInScreen이 **뜨지 않고** 바로 App으로 진입 (또는 BootSplash → App)
  - [ ] StatusBar AuthChip 그대로 signed-in
- [ ] **C. 로그아웃**
  - [ ] StatusBar AuthChip 클릭 → "로그아웃"
  - [ ] (또는 설정 → 계정 → 로그아웃)
  - [ ] AuthChip이 `게스트` 로 즉시 변환
  - [ ] App은 그대로 보임 (skipped 세션 플래그가 살아있어서 SignInScreen으로 안 빠짐)
  - [ ] nost 재시작 → 게스트 / SignInScreen 흐름 (sessionStorage 초기화됨)
- [ ] **D. GitHub 분기** (3.3 셋업한 경우)
  - [ ] A 시나리오 반복하되 "GitHub으로 계속" 사용
- [ ] **E. 오류 처리**
  - [ ] 인터넷 끊은 상태에서 "Google로 계속" → 적절한 오류 메시지 표시 (AuthChip이 빨강 + 설정에서 errorMessage 노출)
  - [ ] 동의 화면에서 거절 → SignInScreen 그대로 머묾 (오류 메시지 표시)

---

## §5. 트러블슈팅 — 흔한 실패 모드

### 5.1 브라우저는 열렸는데 콜백이 nost로 안 돌아옴 (브라우저에 "사이트에 연결할 수 없음" 표시)

원인: `nost://` protocol handler가 OS에 등록 안 됨.

**확인**:
```powershell
reg query "HKCR\nost"
```
응답에 `URL Protocol` 키가 있어야 함.

**해결**:
- 패키지 빌드(installer): `electron-builder`가 자동 등록. 안 됐으면 installer 재실행.
- 개발모드(`npm start`): `app.setAsDefaultProtocolClient('nost', process.execPath, [path.resolve(process.argv[1])])` 라인이 main.js에 있음. 그래도 안 되면:
  ```powershell
  reg add "HKCR\nost" /ve /d "URL:nost protocol" /f
  reg add "HKCR\nost" /v "URL Protocol" /d "" /f
  reg add "HKCR\nost\shell\open\command" /ve /d "\"D:\\path\\to\\electron.exe\" \"D:\\path\\to\\main.js\" \"%1\"" /f
  ```

### 5.2 콜백은 도는데 nost가 토큰을 못 받음

원인: deep-link IPC가 끊어짐.

**확인**:
- `main.log` 에서 `[auth] deep-link received` 같은 라인 검색 (실제 로그 메시지명은 코드 확인)
- `app.on('open-url')` (macOS) 또는 `app.on('second-instance')` (Windows) 가 인자를 잘 파싱하는지

**해결**:
- main.js의 deep-link 파서가 `nost://auth-callback#access_token=...&refresh_token=...` 형식을 잘 split하는지 확인
- 첫 실행 시 `app.requestSingleInstanceLock()` 안 했으면 nost 두 번째 인스턴스가 뜨고 deep-link가 거기로 갈 수 있음 → 첫 인스턴스로 forward 필요

### 5.3 토큰은 받았는데 useAuth 상태가 안 바뀜

원인: `supabase.auth.setSession()` 가 못 불리거나, IPC가 렌더러로 전달 안 됨.

**확인**:
- 렌더러 콘솔에 `[auth] onAuthStateChange` 로그가 떴는지
- `auth:set-session` IPC가 main에서 fired됐는지

### 5.4 Provider not enabled (400) — Supabase

원인: §3.2 안 함.

**해결**: Supabase 대시보드에서 Google/GitHub provider Enable 다시 확인.

### 5.5 redirect_uri_mismatch (400) — Google

원인: Google Cloud Console에 등록한 redirect URI와 Supabase가 보내는 URI가 다름.

**해결**: §3.1 의 redirect URI를 정확히 `https://hjlcgfjzitnizniycdgt.supabase.co/auth/v1/callback` 로 (트레일링 슬래시 없음, https 필수, 프로젝트 ID 정확).

### 5.6 nost가 인증 후에도 SignInScreen에 머묾

원인: Custom URL Scheme `nost://` 가 등록은 됐지만 Windows가 다른 앱을 default로 잡고 있음.

**해결**: 첫 콜백 시 Windows가 묻는 "어떤 앱으로 열까요?" 다이얼로그에서 nost 선택 + "항상 사용" 체크.

---

## §6. Phase 1 완료 기준

세 줄 모두 만족하면 Phase 1 ✅, Phase 2(sync) 시작 가능:

1. §4의 A·B·C 시나리오 통과
2. 로그아웃 후 재로그인 시 세션 정상 복구
3. 인터넷 끊긴 상태에서 SignIn 시도 → 명확한 오류 메시지

---

## §7. Phase 2 진입 전 결정해야 할 Open Questions

[`plans/sync-and-auth.md`](./sync-and-auth.md) §14 그대로:

1. Pro 가격 / 결제 모델
2. Free 디바이스 1개의 의미
3. Cohort C 이전 — 기존 폴더 카드 처리
4. Realtime 폴백
5. 영어 / 한국 우선
6. 텔레메트리 opt-in

이 6개는 sync 코드 짜기 전에 합의 필요.
