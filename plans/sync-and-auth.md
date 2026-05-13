# 로그인 + 다중 디바이스 동기화 — 기획

## §0. Context

**문제**: nost는 PC1·PC2 노트북·집·회사 등 사용자가 여러 디바이스를 오가며 쓰는 도구. 현재는 각 디바이스가 완전 독립 — PC1에서 만든 카드는 PC2에서 처음부터 다시 만들어야 함. 사용자 정착의 큰 벽.

**목표**: "한 계정으로 어느 PC에서든 같은 카드/스페이스/메모를 본다" — 단, **PC마다 본질적으로 다른 것**(폴더 경로, 모니터 좌표, 단축키)은 강제로 같게 만들지 않는다.

**부산물**: 빌링 인프라 한 번에 깔림 (현재 BETA_FORCE_PRO로 가짜 Pro 상태 — 실제 결제 시작 시 Auth가 prerequisite).

**핵심 결정 4건** (이번 세션에서 합의):
1. **Auth**: OAuth (Google + GitHub)
2. **Backend**: Supabase (Auth + Postgres + Realtime + Storage)
3. **경로 충돌**: 4-cohort 군분리 (sync vs 자동해석 vs PC-local vs 디바이스 settings)
4. **충돌 정책**: Last-Write-Wins per-field + generation 카운터

---

## §1. Auth — OAuth via Supabase

### 1.1 Provider
- **Google** (필수, 가장 보편)
- **GitHub** (개발자 사용자 비중 높음)
- 이메일/비번은 의도적으로 **제외** — 비번 분실 회복 / 봇 가입 / 이메일 검증 부담. OAuth로만 시작.

### 1.2 흐름
```
사용자 → "Google로 로그인" 버튼 클릭
  → Electron이 system browser로 https://<project>.supabase.co/auth/v1/authorize?provider=google&redirect_to=nost://auth-callback 열기
  → Google OAuth 동의 → Supabase가 redirect_to로 콜백
  → nost://auth-callback?access_token=...&refresh_token=... (Custom URL Scheme)
  → main.js가 nost:// 프로토콜 핸들러로 받아 토큰 추출
  → safeStorage(Electron OS-encrypted) 로 토큰 영구 저장
  → mainWindow에 'auth:signed-in' IPC 송출, 렌더러 세션 시작
```

### 1.3 토큰 저장
- **safeStorage** (Electron 내장, OS 키체인 백킹) — DPAPI(Win) / Keychain(macOS)
- electron-store나 localStorage에 평문 저장 **금지**
- refresh_token만 영구, access_token은 만료 시 갱신

### 1.4 세션 상태
- `tutorialState`처럼 외부 store + useSyncExternalStore 패턴
- `{ user: { id, email, providerName, avatarUrl } | null, status: 'idle' | 'authing' | 'signed-in' | 'error' }`

### 1.5 Sign-out
- safeStorage 토큰 삭제
- 로컬 데이터는 남겨둠 (재로그인 시 자동 머지) OR 옵션 "이 PC에서 데이터 삭제"

---

## §2. Backend — Supabase 스키마

### 2.1 왜 Supabase
- Auth + Postgres + Realtime + Storage 한 번에. 서버 운영 0.
- 무료 티어 — 50MB DB / 1GB Storage / 2GB egress / 500MB bandwidth → MVP 충분
- Realtime로 "다른 PC에서 카드 추가 시 즉시 반영" 자연스러움
- RLS(Row Level Security)로 사용자별 데이터 격리 → 백엔드 코드 거의 0줄

### 2.2 테이블 설계

```sql
-- Auth는 supabase의 auth.users 테이블 자동 생성

-- 디바이스 등록부 (사용자별 등록된 PC들)
CREATE TABLE devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,           -- "사무실 데스크탑" 같은 사용자 이름
  hostname    text,                    -- OS hostname (자동)
  platform    text,                    -- 'win32' / 'darwin' / 'linux'
  last_seen_at timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now()
);

-- 메인 동기화 묶음. AppData 전체를 한 row가 아니라 entity별로 쪼개야 conflict 단위가 합리적
-- 하지만 첫 단계에선 단순화: appData 전체를 1 row JSON으로 저장 + per-field LWW는 클라가 처리
CREATE TABLE app_data_snapshots (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data         jsonb NOT NULL,        -- 전체 AppData
  generation   bigint NOT NULL DEFAULT 1,  -- 동기 충돌 검출용
  updated_at   timestamptz DEFAULT now(),
  updated_by_device uuid REFERENCES devices(id)
);

-- 메모 본문은 별도 (사이즈 큼 + 검색 용이)
CREATE TABLE memos (
  id           text PRIMARY KEY,        -- LauncherItem.id (메모 카드의 id)
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  body         text NOT NULL,
  generation   bigint NOT NULL DEFAULT 1,
  updated_at   timestamptz DEFAULT now(),
  updated_by_device uuid REFERENCES devices(id),
  expires_at   timestamptz              -- 메모 TTL 만료 시점
);

-- 카드 단위 sync (대안 단계에서 검토 — MVP는 snapshot으로 통일)
-- 이걸로 가면 카드별 LWW가 자연스럽지만 row 수 폭증

-- 디바이스별 경로 매핑 캐시 (Cohort B 자동 해석 결과)
CREATE TABLE device_path_cache (
  device_id    uuid REFERENCES devices(id) ON DELETE CASCADE,
  card_id      text NOT NULL,           -- LauncherItem.id
  resolved_path text NOT NULL,
  resolved_at  timestamptz DEFAULT now(),
  PRIMARY KEY (device_id, card_id)
);
```

### 2.3 RLS 정책 (예시)
```sql
ALTER TABLE app_data_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users access own snapshot"
  ON app_data_snapshots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- 같은 패턴을 모든 테이블에
```

### 2.4 Storage (메모 첨부 / 미래 확장)
- 현재 메모는 .txt 파일 — 스키마의 `memos.body`로 옮김 (작은 텍스트는 DB가 효율적)
- 미래: 이미지/첨부 → Supabase Storage 버킷

---

## §3. 4-Cohort 동기화 정책 (확정)

| Cohort | 종류 | 동기화 | 이유 |
|---|---|---|---|
| **A — Always sync** | url, browser, text, memo, widget(music/color), spaces/presets/node groups/decks 구조, 튜토리얼 진행, dismissals | 그대로 sync (LWW per-field) | 경로 의존 없음, 모든 PC에서 동일 의미 |
| **B — Sync 메타, 경로 자동 해석** | app(.exe/.lnk), window(창 포커스), cmd | 카드 메타(이름·아이콘·카테고리)는 sync. 경로는 디바이스별 자체 해석 + cache | 사용자 의도(이 앱)는 portable, 경로는 PC마다 다름 |
| **C — PC-local 전용** | folder, 임의 파일(.pdf/.docx/.xlsx 등 비-앱) | sync 안 함. 디바이스별 카드 풀 | 본질적으로 PC 종속, 강제 sync 시 깨짐 |
| **D — 디바이스 settings** | windowBounds, floatingButton.position, floatingBadges xy, monitorDirections, shortcut, autoLaunch, autoHide, badgeSize, autoUpdate 상태, lastDailyNudgeYmd | sync 안 함 | PC별로 다른 게 맞음 (모니터/키 충돌) |

### 3.1 Cohort B 자동 매칭 알고리즘

```
resolvePath(card) {
  if (cached_path exists in device_path_cache and file exists)
    return cached_path

  // 1. Store apps: AUMID 그대로 (windows store id는 디바이스 무관)
  if (card.aumid) try AUMID resolve → cache + return

  // 2. exe basename + 잘 알려진 위치 검색
  const basename = path.basename(card.value)  // "Cursor.exe"
  for searchDir of [
    'C:\Program Files',
    'C:\Program Files (x86)',
    process.env.LOCALAPPDATA + '\Programs',
    process.env.APPDATA,
  ] {
    const found = recursiveSearch(searchDir, basename, maxDepth=4)
    if (found) → cache + return
  }

  // 3. Start Menu shortcut 검색 (.lnk)
  for shortcutDir of [Start Menu user / common dirs] {
    if (lnk with target ending basename exists) → cache + return
  }

  // 4. PATH 환경변수 (CLI류)
  const inPath = which(basename)
  if (inPath) → cache + return

  // 실패 → null. UI는 카드 회색 + "이 PC엔 없어요" 토스트, 우클릭 "수동 매핑" 가능
  return null
}
```

**캐시 규칙**: 매핑 성공 시 device_path_cache에 저장. 다음 번엔 즉시 resolve. 사용자가 앱 재설치/이동했을 때를 대비해 launch 시점에 file existence 확인, 없으면 invalidate 후 재검색.

### 3.2 Cohort C UX

- 카드 우상단 작은 뱃지: 🖥️ "이 PC만"
- Space accordion 헤더에 PC-local 카드 카운트 표시: "12 카드 (3 이 PC만)"
- 첫 sync 후 1회 토스트: "💡 폴더·문서 카드는 이 PC에서만 보여요. 다른 PC에서 같은 폴더를 쓰려면 OneDrive 같은 클라우드 폴더를 추천."
- 디바이스 전환 시 PC-local 카드는 "안 보임" — 이게 의도된 동작이라고 명확히 알림

### 3.3 Cohort 결정 로직

새 카드 생성 시 cohort 자동 분류:
- type='url' → A
- type='memo' → A
- type='widget' → A
- type='app' → B
- type='window' → B
- type='cmd' → B
- type='folder' → C
- type='file' (드래그드롭한 비-앱 파일) → C
- type='text' → A (클립보드 카피니까 portable)

사용자가 한 번 만든 카드의 cohort는 **불변**. C → A로 끌어올리는 옵션 없음 (모델 단순성 우선).

### 3.4 Settings sync 대상 vs 제외

**Sync (Cohort A 일부)**:
- theme, accentColor, opacity, closeAfterOpen
- defaultTtlDays (메모), trashRetentionHours
- documentExtensions
- license cache (subscription 상태는 서버 진실, cache는 sync로 빠르게 반영)

**Per-device (Cohort D)**:
- shortcut (다른 앱과의 키 충돌은 PC마다 다름)
- monitorDirections (모니터 개수·배치가 다름)
- floatingButton.{enabled, idleOpacity, size, hideOnFullscreen, position}
- badgeSize, autoLaunch, autoHide, autoUpdate

설정 화면에서 sync vs per-device를 시각적으로 구분 (작은 ☁️ vs 🖥️ 아이콘).

---

## §4. Sync 엔진 — LWW per-field + generation

### 4.1 데이터 단위
첫 단계 (MVP): **AppData 전체를 1 snapshot row**로. 클라가 변경 시 generation을 inc + 전체 push.

미래 (스케일 시): **entity별 row** (cards/spaces/presets/etc 각각). 충돌 단위 작아짐.

### 4.2 LWW 알고리즘

```
push(localData, localGeneration) {
  const row = SELECT * FROM app_data_snapshots WHERE user_id = me

  if (row.generation > localGeneration) {
    // 서버가 더 최신 — pull 먼저
    return { conflict: true, serverData: row.data, serverGeneration: row.generation }
  }

  // local이 최신 또는 동일 — push
  UPDATE app_data_snapshots SET
    data = localData,
    generation = localGeneration + 1,
    updated_at = now(),
    updated_by_device = me_device
    WHERE user_id = me AND generation = localGeneration  -- 낙관적 잠금

  if (rowsAffected = 0) → 다른 디바이스가 끼어듦, conflict
  return { ok: true, newGeneration: localGeneration + 1 }
}

pull() {
  const row = SELECT * FROM app_data_snapshots WHERE user_id = me
  if (row.generation > localGeneration) {
    // 머지 — per-field LWW
    const merged = mergePerField(localData, row.data)
    saveLocal(merged, row.generation)
  }
}

mergePerField(local, server) {
  // 각 entity (card, space, etc)에 lastModifiedAt 타임스탬프 필요
  // entity id로 매칭 후 lastModifiedAt 늦은 쪽 채택
  // 추가 entity는 둘 다 보존 (union)
  // 삭제 entity는 tombstone 필요 (별도 deletedAt 필드 + N일 후 hard delete)
}
```

### 4.3 트리거 시점
- **즉시**: 카드 추가/삭제, 스페이스 변경 같은 의도적 행동 → debounce 1초 후 push
- **주기적**: 5분마다 idle pull (Realtime이 잘 잡아주면 fallback일 뿐)
- **Realtime**: Supabase Realtime 채널 구독 — 다른 디바이스의 update 즉시 인지 → pull 트리거
- **App boot**: 시작 직후 pull → 로컬과 머지

### 4.4 Tombstone (삭제 처리)
- 삭제 시 entity를 즉시 지우지 않고 `deletedAt` 마킹
- sync 시 tombstone도 보냄 → 다른 디바이스 동일 entity 삭제
- 30일 후 hard delete (DB cleanup)

### 4.5 Offline
- 오프라인이면 push 큐에 쌓임 (localStorage)
- 온라인 복귀 시 큐 flush → conflict 발생하면 LWW 머지

---

## §5. Privacy / Security

### 5.1 토큰
- safeStorage (OS-backed 암호화)
- 절대 console / 로그 / 텔레메트리에 노출 금지

### 5.2 데이터 암호화
- **MVP**: TLS 전송 + Supabase 디스크 암호화로 충분 (server-trusted)
- **v2 검토**: 클라이언트 사이드 E2EE (libsodium 등) — 비번 분실하면 데이터도 잃는 trade-off, 옵션화

### 5.3 Multi-device 제한
- **Free**: 1 device (현재 PC만 sync)
- **Pro**: 무제한 device
- 디바이스 등록 추적은 `devices` 테이블, 한도 초과 시 신규 등록 거부 + "기존 디바이스 해제" 안내
- 강제 sign-out: Pro 만료 시 모든 디바이스 sync 중단 (로컬 데이터는 유지)

### 5.4 GDPR / 계정 삭제
- 설정 → 계정 → "내 데이터 모두 삭제" 버튼
- 클릭 시 confirm 2회 → Supabase에서 user 행 ON DELETE CASCADE로 모든 데이터 제거

---

## §6. Pro / Free 게이팅

### 6.1 Sync는 Pro 기능
이유: 클라우드 비용 + 강력한 upgrade lever. 무료로 풀면 monetization 어려움.

| 기능 | Free | Pro |
|---|---|---|
| 단일 디바이스 사용 | ✓ | ✓ |
| 다중 디바이스 sync | ✗ | ✓ |
| 메모 클라우드 백업 | ✗ | ✓ |
| 디바이스 N개 등록 | 1 | 무제한 |
| 카드 수 한도 | 50? | 무제한 |
| 노드 그룹 한도 | 1 | 무제한 |

(현재 useEntitlement에 quota 함수들 있으므로 통합 자연스러움)

### 6.2 Free 사용자도 로그인 가능
- 로그인 자체는 Free (계정 식별만)
- sync 시도 시 PaywallModal 표시
- Free에서도 클라우드 백업 1개 슬롯 정도는 허용 검토 (분실 보장 차원)

---

## §7. 마이그레이션 — 기존 사용자

현재 BETA_FORCE_PRO 시기에 모인 사용자들:
1. 첫 로그인 시 로컬 appData를 그대로 push (서버 빈 상태이므로 무조건 LOCAL이 진실)
2. 메모 .txt 파일들도 일괄 업로드 → memos 테이블
3. exportFolder 설정은 sync 대상에서 제외 (디바이스 경로)
4. 기존 데이터에 `lastModifiedAt` 없으니 일괄 `now()` 적용
5. 사용자에게 "데이터가 안전하게 백업되었어요" 토스트

---

## §8. 실패 모드

| 시나리오 | 동작 |
|---|---|
| 서버 다운 | 로컬은 정상 동작. 큐에 쌓고 재시도. UI 한쪽에 작은 "🔄 sync 일시 중단" 인디케이터 |
| 토큰 만료 | refresh_token으로 silent renew. 실패 시 재로그인 요청 토스트 |
| 디바이스 한도 초과 (Free→Pro 다운그레이드 시) | "디바이스가 너무 많아요. 어느 디바이스를 해제할까요?" 모달 |
| 동시 편집 충돌 (LWW) | per-field 자동 머지. user는 알아채지 못함이 보통 (편집 시점이 정확히 동시인 경우는 극히 드묾). 단, "최근 변경 이력" 페이지 (v2) |
| 네트워크 느림 | optimistic UI — 즉시 로컬 반영 + 백그라운드 sync |
| 앱 path 자동 매칭 실패 | 카드 회색 + 우클릭 "수동 매핑". 매핑 후 캐시 |

---

## §9. UI/UX 추가 surface

### 9.1 신규 화면
1. **Sign-in 화면** (앱 첫 실행 / 로그아웃 후) — Google/GitHub 버튼 2개
2. **Account 패널** (설정 새 탭) — 프로필, sync 상태, 디바이스 목록, 로그아웃, 계정 삭제
3. **Device 관리 모달** — 등록된 디바이스 list, 각 행에 "여기서 해제" 버튼
4. **Sync 상태 인디케이터** — 헤더에 작은 아이콘: ☁️ (sync OK) / 🔄 (진행 중) / ⚠️ (오프라인/오류)

### 9.2 카드 단위 시각 표시
- Cohort A/B 카드: 별도 표시 없음 (기본)
- Cohort B 카드 미해결 (이 PC에 앱 없음): 회색 처리 + 좌상단 ⚠️
- Cohort C 카드: 우상단 🖥️ "이 PC만" 뱃지

### 9.3 첫 sync 직후 안내
- "PC1에서 만든 카드 N개를 가져왔어요. 폴더·문서 카드는 PC별이라 안 보일 수 있어요."

---

## §10. Critical files (변경 대상)

새로 만들 것:
- `frontend/src/lib/auth/` (signIn/signOut/session 관리)
- `frontend/src/lib/sync/` (push/pull/merge/realtime)
- `frontend/src/lib/pathResolver/` (Cohort B 자동 매칭)
- `frontend/src/components/SignInScreen.tsx`
- `frontend/src/components/AccountPanel.tsx` (SettingsDialog 새 탭)
- `frontend/src/components/DeviceManagerModal.tsx`
- `frontend/src/contexts/AuthContext.tsx`
- `main.js` — `nost://` protocol handler 등록, safeStorage 토큰 IPC, OAuth window opener
- `preload.js` — auth 관련 IPC 노출

수정할 것:
- `frontend/src/types.ts` — License 확장, Device 타입 추가, lastModifiedAt 필드 entities에 추가
- `frontend/src/hooks/useAppData.ts` — save() 시 sync 트리거 hook
- `frontend/src/hooks/useEntitlement.ts` — 실제 license verification 연결
- `frontend/src/components/SettingsDialog.tsx` — 계정 탭 + sync 토글
- `frontend/src/components/PaywallModal.tsx` — 실제 결제 링크 연결
- `frontend/src/components/ItemCard.tsx` — Cohort B 미해결 회색 + Cohort C 뱃지

---

## §11. Phasing — 4단계

### Phase 1 — Auth 기반 (2주)
- Supabase 프로젝트 셋업 (Auth 설정, 빈 스키마)
- `nost://` protocol handler + OAuth flow
- Sign-in/Sign-out UI + session 상태
- Account 패널 (프로필 표시, 로그아웃만)
- **검증**: 로그인 → 프로필 표시 → 재시작 후 세션 유지 → 로그아웃

### Phase 2 — 기본 sync (3주)
- app_data_snapshots 테이블 + RLS
- push/pull + LWW per-field 머지
- Realtime 채널 구독
- 마이그레이션 (기존 로컬 → 첫 push)
- **Cohort A만** 우선 동기화 (url/memo/text/widget/structure)
- **검증**: PC1에서 카드 추가 → PC2에 즉시 반영. PC2에서 수정 → PC1에 즉시 반영. 오프라인 → 온라인 복귀 시 머지

### Phase 3 — Cohort B (path resolver) (2주)
- 자동 매칭 알고리즘 + device_path_cache
- 미해결 카드 회색 UI + 수동 매핑 우클릭 메뉴
- **검증**: PC1에서 Cursor 카드 추가 → PC2(다른 install path)에서 자동 해결. PC2에 미설치 시 회색 + 안내

### Phase 4 — Cohort C 분리 + Pro 게이팅 (2주)
- folder/file 카드를 PC-local로 분리 (sync 제외)
- 🖥️ 뱃지 + 첫 sync 안내 토스트
- PaywallModal 실제 결제 연결
- 디바이스 한도 enforcement
- **검증**: Free 1 device 한도, Pro 무제한. 결제 → 즉시 sync 활성화

총 ~9주 (1인 fulltime 기준).

---

## §12. 의도적 비-목표

- 클라이언트 사이드 E2EE (v2)
- 카드 변경 이력 / 시간여행 (v2)
- 디바이스 간 직접 P2P sync (Supabase 의존성 제거)
- 모바일 앱 (별도 product line)
- 이메일/비번 로그인
- SSO (기업용)
- 팀 공유 / 워크스페이스 (별도 product, 가격대 다름)

---

## §13. 결정 요약 (cheat sheet)

- Auth = OAuth (Google + GitHub)
- Backend = Supabase (Auth + Postgres + Realtime + Storage)
- Conflict = LWW per-field + generation
- Path = 4-cohort (A always sync / B sync 메타+자동해석 / C PC-local 전용 / D device-only settings)
- 같은 카드 PC별 다른 경로 = 지원 안 함 (모델 단순성)
- Sync = Pro feature (Free는 1 device까지만)
- Token storage = safeStorage
- Encryption = MVP는 TLS만, E2EE는 v2

---

## §14. Open questions (구현 전 추가 결정 필요)

1. **Pro 가격 / 결제 모델** — Stripe? 아니면 한국 결제(토스/카카오페이)? 월/연/평생?
2. **Free 디바이스 1개의 의미** — 첫 등록 디바이스 fix? 아니면 매번 1개만 활성?
3. **Cohort C 이전 — 기존 폴더 카드는 어떻게 처리** — 기존 사용자가 PC1에서만 쓰던 폴더 카드들을 첫 sync 시 어떻게 분류? (자동 cohort C로 강등 + 안내) → **[2026-05-14 결정] 자동 cohort C 로 강등 + 첫 sync 시 "이 카드들은 이 PC 에만 보관됩니다" 토스트 1회. 사용자가 명시적으로 sync 원하면 우클릭으로 cohort A 승격 가능 (단 다른 PC 에선 미해결 회색 카드로 보임).**
4. **Realtime 폴백** — Supabase 무료 티어 동시연결 한도 도달 시 polling으로?
5. **언어 / 지역화** — 영어 UI도 동시 출시 vs 한국 우선
6. **분석 / 텔레메트리** — 익명 사용 패턴 수집 여부 (opt-in 권장)

1·2·4·5·6 은 Phase 1 검증 끝나고 Phase 2 시작 전 확정 필요.

---

## §15. Sync 범위 — 카드 타입별 분류 (2026-05-14 사용자 합의)

§13 의 4-cohort 정책을 카드 타입에 매핑한 최종 표. Phase 2 구현 시 이 표대로 분기.

| 카드 타입 | Cohort | Sync? | 비고 |
|---|---|---|---|
| `url` | A | ✅ | URL 그대로 보내면 어디서나 동일하게 작동 |
| `memo` | A | ✅ | body·TTL·trashedAt 까지 함께 sync (Supabase `memos` 테이블 별도) |
| `widget` | A | ✅ | media-control / color-swatch 둘 다. 옵션도 함께 |
| `text` | A | ✅ | 짧은 스니펫 — sync 자연스러움 |
| `browser` | A | ✅ | URL 기반 — sync OK |
| `app` | C | ❌ | exe 경로가 PC 마다 다름. PC-local 전용 |
| `folder` | C | ❌ | 파일시스템 경로 — PC-local |
| `doc` | C | ❌ | 문서 절대경로 — PC-local. 단 doc cohort 패턴 자체(`AppSettings.docCohort`)는 Cohort D 로 sync |
| `window` | C | ❌ | 창 제목 + exePath 모두 PC 의존 |
| `cmd` | C | ❌ | 명령어가 PC 환경 의존 (PATH·설치 도구) |

**메타데이터** (모든 타입 공통, Cohort A 와 함께 sync):
- 카드 위치 (어느 space 의 몇 번째 슬롯, 색·아이콘 오버라이드)
- pinned / hiddenInSpace
- container slots 구조 (slot 자리에 들어간 카드 id 들)
- node / deck 묶음 (itemIds 배열)
- floatingBadges (refType + refId)
- preset 구조 (label · spaces 배열)

**Cohort D (디바이스별 설정, 절대 sync 안 함)**:
- shortcut · autoLaunch · autoHide · windowSizePct · windowOpenAt · floatingButton · monitorDirections · badgeSize

**Cohort D-but-shared (디바이스별인데 default 는 sync — 사용자가 명시 변경 시만 분기)**:
- theme · accentColor · documentExtensions · docCohort · memo 설정

**License** 은 Cohort 외 — 서버 verify 가 SSOT.
