# nost — Master Guide

> **새 세션 시작 시 이 파일 하나만 먼저 읽으면 즉시 작업 착수 가능하도록 설계.**
> 마지막 갱신: 2026-05-14 (v1.3.34 출시 — auth Phase 1 코드 정착 + 브랜드 마크 + Phase 2 골격)

---

## 1. 30초 컨텍스트

**nost** — Windows용 Electron 런처. 자주 쓰는 앱·URL·폴더·문서·메모를 카드로 모아 단축키로 즉시 호출.

| 항목 | 값 |
|---|---|
| 경로 | `D:\01_개인\06. launcher\` |
| 절대 건드리지 말 것 | `C:\Users\User\.gemini\antigravity\scratch\quick-launcher` (구 스냅샷) |
| GitHub | `HwigwanJi/nost` (public, electron-updater) |
| 현재 출시 버전 | **v1.3.36** (자동 업데이트 대상) |
| 미커밋 작업 | (없음 — v1.3.34 출시 후 차기 Phase 2 sync 본격 구현이 다음 라운드) |
| 스택 | Electron 41 · React 19 · TS · Vite 8 · Tailwind 4 · @dnd-kit · @base-ui/react |
| 영속화 | `electron-store` (primary) + `localStorage` (fallback) |
| 자동 업데이트 | GitHub Releases (`latest.yml`) — public repo, 토큰 불필요 |

---

## 2. 절대 금기 사항 (Don't break these)

### 2.1 DPI 처리 (가장 위험)
- **Electron 은 모니터 번호만 PS 에 전달**. 좌표 변환 금지.
- PS 가 `.NET System.Windows.Forms.Screen` 으로 Windows 에서 직접 workArea 조회.
- 모든 창 배치는 `_Position.ps1::Move-WindowToRect` 한 곳을 거친다.
- **이 규칙을 어기면**: 혼합 DPI 멀티모니터에서 창이 엉뚱한 곳에 떨어지거나, Claude/Office 같은 DPI-aware 앱 창이 ×1.25 로 늘어남.
- 자세히: `plans/ssot-index.md` §A.7 (scanEngine 도 같은 규칙 — koffi/PS 직접 호출 금지)

### 2.2 SSOT 5개 (런타임 데이터)
| # | 영역 | 단일 소스 | 위반 시 |
|---|---|---|---|
| 1 | 윈도우 크기 | `windowSizePct` (25..100) — `setBounds` | `setZoomFactor` 사용 → flicker + 글자 흐려짐 |
| 2 | 카드 데이터 | `electron-store` (Round 2에서 정착 예정) | 4-way mirror → 어긋남 |
| 3 | Launch | `useLaunchPipeline` / `launch-or-focus-app.ps1` | 일부 카드 타입만 작동하는 버그 |
| 4 | 충돌 회피 | `canPerform(action, ctx)` ← `plans/conflict-avoidance-policy.md` | 모드 중 silent 가로채기 |
| 5 | 모니터 정보 | `lib/scanEngine.ts` 만 사용 | koffi/PS 흩어진 호출 → DPI 회귀 |

### 2.3 디자인 시스템 (var(--…) 규칙)
- **`var(--accent)` 에 fallback 값 절대 금지** — `var(--accent, #6366f1)` ❌. 사용자 강조색 무력화됨.
- 인라인 색/사이즈 금지 — `widgets/widgetTokens.ts` 통과.
- 시스테믹 폰트 토큰: `FS = { header: 13, primary: 12, body: 11, meta: 10, micro: 9 }` (SettingsDialog 정의)
- **다이얼로그 푸터 버튼 padding 룰**:
  - shadcn `<Button>`: 기본 `px-4` (16px) — OK
  - 인라인 styled: **좌우 ≥ 14px 필수**. `padding: 'Npx 0'` 또는 `'Npx 8px'` 절대 금지.
  - 사용자 피드백 핫스팟 → 새 버튼 추가 시 반드시 점검.

### 2.4 자동 업데이트 (파일명 규칙)
- `latest.yml` 의 파일명 = GitHub asset 파일명 **정확 일치**.
- electron-builder 출력은 공백 포함 (`nost Setup 1.3.33.exe`) → 업로드 전 **하이픈으로 변환** (`nost-Setup-1.3.33.exe`).
- 자세히: walkthrough §3 (자동 업데이트)

### 2.5 절대 임의 git push / 배포 금지
- **사용자 명시적 허락 없이는** `git push` / Release 발행 X.
- 커밋은 ASK 후. 빌드 + asset 준비 까지는 OK.
- 토큰 비용 + 거버넌스 이유.

---

## 3. 문서 인덱스 — 어떤 순서로 읽을 것인가

### 3.1 30분 안에 모두 파악 (필수)

| # | 파일 | 무엇 |
|---|---|---|
| 1 | **MASTER.md** (이 파일) | 30초 컨텍스트 + 금기 + 인덱스 |
| 2 | [**walkthrough_v2.md**](walkthrough_v2.md) | 전체 워크스루 — 디렉토리/타입/IPC/타일링 파이프라인. 정본. |
| 3 | [**plans/ssot-index.md**](plans/ssot-index.md) | 코드/문서 SSOT 인벤토리 — 어떤 값/규칙을 바꿀 때 또 어디 미러가 있는지 확인. |
| 4 | [**plans/checklists.md**](plans/checklists.md) | 자주 하는 5개 작업 (카드 타입 / IPC / 모달 / 설정 / 알림) 체크리스트 |
| 5 | [**guide.md**](guide.md) | 사용자 매뉴얼 (앱 사용법). 시야 맞추기. |

### 3.2 자주 하는 작업별 절차 (체크리스트 우선 ⭐)

| 작업 | 먼저 읽을 파일 |
|---|---|
| **새 카드 타입 추가** | [`plans/checklists.md`](plans/checklists.md) §1 (8+5개 파일 동시 수정) |
| **새 IPC 추가** | [`plans/checklists.md`](plans/checklists.md) §2 (4-file 패턴) |
| **새 모달/wizard 추가** | [`plans/checklists.md`](plans/checklists.md) §3 + [`plans/conflict-avoidance-policy.md`](plans/conflict-avoidance-policy.md) + [`plans/escape-stack-audit.md`](plans/escape-stack-audit.md) |
| **새 AppSettings 필드** | [`plans/checklists.md`](plans/checklists.md) §4 |
| **새 알림 카테고리** | [`plans/checklists.md`](plans/checklists.md) §5 |
| **릴리스 / 배포** | [`plans/release-runbook.md`](plans/release-runbook.md) (8단계 종합, ⚠ 사용자 허락 필수) |
| **빌드/실행 에러** | [`plans/troubleshooting.md`](plans/troubleshooting.md) |
| **UI 문구 작성** | [`plans/ui-vocabulary.md`](plans/ui-vocabulary.md) §2 동사 통일표 |
| **코드 anti-pattern 점검** | [`plans/anti-pattern-grep.md`](plans/anti-pattern-grep.md) |

### 3.3 작업 영역별 깊이 읽기 (필요 시)

| 작업 영역 | 먼저 읽을 파일 |
|---|---|
| autoHide / alwaysOnTop 동작 변경 | [`plans/focus-state-audit.md`](plans/focus-state-audit.md) |
| ESC 키 동작 | [`plans/escape-stack-audit.md`](plans/escape-stack-audit.md) |
| 모드 충돌 (pin/node/deck/clean) | [`plans/conflict-avoidance-policy.md`](plans/conflict-avoidance-policy.md) |
| 인증 / 로그인 / 동기 | [`plans/auth-status.md`](plans/auth-status.md) → [`plans/sync-and-auth.md`](plans/sync-and-auth.md) |
| 튜토리얼 작업 (5개 문서 순서) | **(1) tutorial-system-v2** (전체 구조) → **(2) tutorial-goals** (학습 목표) → **(3) tutorial-writing-style** (어투) → **(4) tutorial-coherence-audit** (정합성 감사 — 자동 생성) → **(5) tutorial-shortcut-teaching** (특정 챕터) |
| 메모 기능 | [`plans/memo-feature-v1.md`](plans/memo-feature-v1.md) |
| 컬러피커 / 위젯 | [`plans/color-picker-plan.md`](plans/color-picker-plan.md) |
| 문서 코호트 (doc 분류) | [`plans/checklists.md`](plans/checklists.md) §1 + [`plans/ssot-index.md`](plans/ssot-index.md) §A.10 |
| 큰 리팩토링 | [`plans/refactor-roadmap.md`](plans/refactor-roadmap.md) (4-Round 계획) |
| 진행 중 작은 이슈 | [`plans/backlog.md`](plans/backlog.md) |

### 3.3 사용자 / 외부 제출용 (코드 안 건드림)

| 파일 | 용도 |
|---|---|
| `guide.md` | 앱 내장 사용 설명서 (Help 메뉴) |
| `PRIVACY.md` | Chrome Web Store / Whale Store 개인정보 처리방침 |
| `chrome-extension/STORE_LISTING.md` | Chrome 확장 스토어 listing 텍스트 |

---

## 4. 새 세션 진입 워크플로우

```
1. MASTER.md (이 파일) 읽기                    ← 30초
2. walkthrough_v2.md §10 (현재 WIP) 확인       ← 1분
3. git status --short 로 미커밋 변경 확인       ← 10초
4. 사용자 요청 들어오면:
   a. 영역 매핑 (§3.2 표 참고)
   b. 해당 plan 파일 1개 읽기
   c. 작업 착수 — 단, §2 금기사항 위배 여부 항상 self-check
5. 빌드 / 커밋 / 배포는 사용자 허락 후만 (§2.5)
```

---

## 5. 자주 쓰는 명령어 사전

### 빌드 / 실행
```bash
# 디렉토리 이동 (한글 경로 + 공백 → 큰따옴표 필수)
cd "D:\01_개인\06. launcher"

# 프론트엔드 프로덕션 빌드
cd frontend && npm run build

# 개발 모드 (Vite + Electron)
cd frontend && npm run dev          # 터미널 1
cd .. && npm start                  # 터미널 2

# 인스톨러 빌드 (release/ 에 출력)
npx electron-builder                # 약 30초

# 충돌 시
taskkill /f /im electron.exe
```

### 배포 (사용자 허락 후만)
```bash
# 1. version bump (package.json)
# 2. git commit + push
# 3. npx electron-builder
# 4. asset 을 하이픈 이름으로 복사 → /c/Temp/nost_v1_3_XX/
# 5. gh CLI 로 release 생성:
gh auth status                      # 로그인 확인 (한 번만)
gh release create vX.X.X --repo HwigwanJi/nost --title "vX.X.X" --notes-file NOTES.md
gh release upload  vX.X.X --repo HwigwanJi/nost asset1.exe asset2.yml ...
```

### Git
```bash
# repo 의 마지막 태그 / 미릴리스 커밋 확인
git describe --tags --abbrev=0
git log --oneline $(git describe --tags --abbrev=0)..HEAD

# safe.directory 등록 (한 번만, 한글 경로 때문)
git config --global --add safe.directory 'D:/01_개인/06. launcher'
```

### 테스트
```bash
cd frontend
npm test                     # vitest 단발 실행
npm test -- --watch          # watch mode
```
- 현재 테스트 커버리지: `lib/typePlausibility.test.ts` 1개 (미흡, 늘려야 함)
- 새 SSOT/feature 추가 시 vitest 파일 함께 추가 권장

### Anti-pattern 점검
```bash
# 큰 변경 후 한 번에 점검
# 자세히: plans/anti-pattern-grep.md §8 (종합 점검 워크플로우)
grep -rEn 'var\(--(accent|accent-dim)[ ]*,' frontend/src   # fallback 잔재
grep -rn '발사\|짧게 :\|길게 :' frontend/src                # 캐주얼 어휘
grep -rEn "padding:[ ]*'[0-9]+px[ ]+0'" frontend/src/components  # 좌우 0 padding
```

---

## 6. 검증 시나리오 (회귀 점검)

코드 수정 후 반드시 돌려야 하는 시나리오:

1. **DPI**: 노트북(고DPI) + 외부 모니터(저DPI) 환경에서 노드 launch → 양쪽 모니터 모두 정확한 위치
2. **autoHide**: 설정 다이얼로그 열고 alt-tab → 다이얼로그 살아있음 (`plans/focus-state-audit.md` §6)
3. **자동 업데이트**: 부팅 후 stale "설치 준비 완료" 알림 자동 dismiss
4. **충돌 회피**: pin 모드에서 카드 길게 누름 → shake + 토스트 (`plans/conflict-avoidance-policy.md` §7)
5. **튜토리얼 nudge**: daily nudge fire 시 토스트 + 알림센터 둘 다 표시 + `[튜토리얼]` 뱃지
6. **확장**: Chrome 비포커스 상태에서 alt-tab → "확장 끊김" 알림 안 뜸 (calm-by-default)
7. **문서 카드**: `.docx` 파일 드래그앤드롭 → `type: 'doc'` 으로 저장, 아이콘 = `description`

---

## 7. 도움이 필요한 사람을 위한 한 줄 매핑

| "X 가 안 돼요" | 먼저 의심할 곳 |
|---|---|
| 카드 클릭해도 앱 안 떠요 | `plans/ssot-index.md` §A.8 launch SSOT |
| 다이얼로그가 alt-tab 후 사라져요 | `plans/focus-state-audit.md` Issue 1 (useBusyMark ↔ suppressAutoHide 연결) |
| ESC 가 엉뚱한 걸 닫아요 | `plans/escape-stack-audit.md` |
| 모드 중에 단축키가 silent 가로채요 | `plans/conflict-avoidance-policy.md` |
| 멀티모니터에서 창이 엉뚱한 곳에 떨어져요 | DPI § 2.1 (PS 직접 조회) |
| 자동 업데이트가 404 | `latest.yml` 파일명 일치 여부 (§ 2.4) |
| 로그인이 안 돼요 | `plans/auth-status.md` §3 (외부 console 작업) |
| 튜토리얼이 토스트만 뜨고 알림센터엔 없어요 | walkthrough_v2 §10 작업 #5 (NudgeToast addNotification 미러) |

---

## 8. 한 줄로 답 못 할 때 — 깊이 들어가는 진입점

| 질문 | 진입점 |
|---|---|
| 이 IPC 핸들러 뭐 함? | `walkthrough_v2.md` §8 IPC 카탈로그 |
| 이 카드 타입 추가하려면? | `walkthrough_v2.md` §4 LauncherItem + `plans/ssot-index.md` §A.10 typePlausibility |
| 배지 시스템 어떻게 동작? | `walkthrough_v2.md` §6.3 |
| 노드/덱 실행 파이프라인? | `walkthrough_v2.md` §7.4 (Tiling pipeline) |
| 새 SSOT 추가하려면? | `plans/ssot-index.md` 헤더 (갱신 규칙) + §D 체크리스트 |

---

## 9. 변경 이력 (이 파일의)

| 날짜 | 변경 |
|---|---|
| 2026-05-14 | 초안 — v1.3.33 시점, v1.3.34 미커밋 작업 진행 중. plans/{checklists, release-runbook, ui-vocabulary, troubleshooting, anti-pattern-grep}.md 5개 신규 추가 + 인덱스화. |

> 이 파일을 갱신할 일이 생기면: §1 컨텍스트 (현재 버전), §2.x 금기 (새 SSOT 추가 시), §3.1/§3.2 인덱스 (새 plan 추가/이름변경 시), §5 명령어 (배포 절차 변경 시).

---

## 10. 세션 종료 시 의무 (간단 체크리스트)

새 작업 마치고 대화 종료 전 다음 항목 갱신:

- [ ] **walkthrough_v2.md §10 WIP** — 이번 세션 변경분 추가 / 완료된 건 §11 해결됨 으로 이동
- [ ] 새 SSOT 만들었으면 **plans/ssot-index.md** 적절한 섹션 추가
- [ ] 새 plan 파일 만들었으면 **MASTER.md §3.2/3.3** 인덱스 추가
- [ ] 새 anti-pattern 발견했으면 **plans/anti-pattern-grep.md** grep 명령 추가
- [ ] 코드 위치 (`file:line`) 인용된 SSOT 가 옮겨졌으면 라인 번호 갱신
- [ ] 사용자 명시 허락 없이 git push / Release 발행 X (§2.5 절대 룰)
