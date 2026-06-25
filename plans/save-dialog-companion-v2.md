# 저장 다이얼로그 컴패니언 v2 — Dock + 컨텍스트 추천 + 타이핑 점프

> 상태: **기획 확정 (2026-06-25)**. 사용자 선택 = A+B+C 풀 비전 + 접힘 펠릿.
> 선행: 현 v1 구현은 `main.js` (tickDialogPoll/positionDialogPopup/createDialogPopupWindow)
> + `electron/foreground-window.js` (감지) + `frontend/src/dialog-popup/DialogPopup.tsx` (렌더).

---

## 1. 배경 / 진단

OS 파일 저장·열기 다이얼로그가 뜨면 nost가 도우미 바를 띄워, 저장된 폴더 카드로
**원클릭 경로 점프**(PS clipboard-paste)를 제공한다. 기능 자체는 유효하나 **형태가 문제**:

- **근본 원인 — 다이얼로그 앵커를 버림.** v1.3.43에서 팝업을 다이얼로그 rect에서
  떼어내고 "모니터 5/6 높이 · 가로 중앙 · 880px 고정"으로 바꿈
  (`defaultPopupPosition`, `DIALOG_POPUP_WIDTH = 880`). 그 결과 다이얼로그는 화면
  중앙, 도우미 바는 하단 허공 → "긴 바가 통제되지 않는 공간에 떠 있다"는 위화감.
  **nost는 매 틱 `detected.rect`(다이얼로그 물리 좌표)를 이미 알고 있다** — 앵커
  수식만 버린 것이지 데이터가 없는 게 아니다. 이게 핵심 단서.
- 폭 880 고정이라 화면을 과하게 점유. 항상 풀 노출.

> **별개 이슈(분리 처리)**: "언제부턴가 안 뜸". v1.3.49에서 브라우저 클래스
> title-net 차단(`NON_DIALOG_CLASS_RE`) / Acrobat 자체 다이얼로그 감지 회귀
> 가능성. **재설계와 섞지 말고 재현 1건 잡아 따로 픽스.** (§7)

## 2. 리서치 — 장르 두 업계 표준

| 제품 | 형태 | 핵심 원리 |
|---|---|---|
| **Default Folder X** (macOS, 20년 표준) | 다이얼로그 **오른쪽 edge 세로 레일** | 즐겨찾기·최근·계층 메뉴를 다이얼로그에 **물리적으로 붙여 같이 이동** |
| **Listary** Quick Switch (Windows) | 다이얼로그 **하단 슬림 바** | 별(즐겨찾기)·시계(최근) + **타이핑 즉시 점프** + "현재 상황 자동 추천" |

- 출처: Default Folder X User's Guide (stclairsoft.com), Listary Quick Switch Docs (help.listary.com).
- **공통 결론: 증강 UI는 허공에 띄우지 않는다. 다이얼로그에 붙여 그 일부처럼 보이게 한다.**
  Listary는 거기에 "상황 추천 + 키보드 점프"를 더해 클릭을 0에 수렴시킨다.

## 3. nost의 차별 자산

Default Folder X·Listary의 폴더는 **평면 즐겨찾기**다. nost의 폴더는
**스페이스로 의미 분류된 카드 그래프** + **전경 앱/파일명 컨텍스트**를 안다.
→ "favorites 목록"이 아니라 **"이 앱·이 파일이면 이 폴더"** 수준의 추천이 가능.

## 4. 설계

### A. Dock-to-edge (형태) — P1

880px 모니터 고정 → **다이얼로그 오른쪽 edge에 붙는 슬림 세로 레일**.

- 위치 수식: `dialogLastRect` 기준 `x = rect.right`, `y = rect.top`,
  `height = rect.height`. 오른쪽이 화면 밖이면 `x = rect.left - railW` (왼쪽 플립).
- 다이얼로그 이동 추적: `positionDialogPopup`이 이미 매 틱 호출됨. 단,
  현재 `monitorKey` 메모이즈로 "같은 모니터면 setBounds 스킵"하는데(드래그
  안 싸우려고), **dock 모드에선 rect가 바뀌면 따라가야** 하므로 메모이즈 키를
  `monitorKey` → `rect 서명(round(x,y,w,h))`로 교체. rect 안 바뀌면 스킵(불필요한
  setBounds 방지)은 유지.
- DPI: rect는 물리픽셀(GetWindowRect). 기존대로 `getDisplayMatching(rect)` →
  매칭 display의 scaleFactor로 DIP 환산해 setBounds. **[[feedback_dpi_positioning]]
  — Electron 창이므로 PS 환산 금지, Electron screen API가 SSOT.**

### B. 컨텍스트 추천 (맞물림) — P2

레일 최상단 **한 줄 추천 카드**. 단서 3종으로 1순위 폴더를 고른다:

1. **전경 앱** — `detected`에 이미 클래스/타이틀 있음. (Acrobat/HWP/Office 등)
2. **파일명** — 다이얼로그 타이틀 또는 파일명 필드. 키워드를 폴더 카드 제목과 매칭.
3. **저장 이력** — `{앱 or 확장자 → 마지막 저장 폴더}` 학습 테이블 (신규, §5).

- 점수: 이력 최근성 > 파일명 키워드 매칭 > 앱-스페이스 연관. 1개만 노출(과하지 않게).
- 클릭 = 기존 `onClickFolder(id, path)` 재사용(경로 paste). **추가 백엔드 0.**
- 미스 시 추천 카드 숨김(빈 추천을 우기지 않음).

### C. 타이핑 점프 (Listary 모델) — P3

레일에 포커스 없이도 글자 입력 → 폴더 카드 필터 → Enter = 경로 paste.

- **주의(가장 무거움)**: 팝업 창은 현재 `focusable: false` +
  `setIgnoreMouseEvents(true, forward)`. 타이핑 받으려면 입력 시점에만 포커스를
  가져와야 하는데 — **다이얼로그 포커스를 뺏으면 안 됨**(저장 흐름 깨짐).
  → 전역 키훅 대신 **레일의 작은 검색 핀을 클릭/단축키로 명시 활성화**했을 때만
  입력 모드. IME(한글) 조합 완료(`compositionend`) 후 필터. autoHide 가드 점검.
- 매칭은 기존 폴더 카드 title/path 필터. Enter = `onClickFolder`.

### 펠릿 (footprint) — A와 함께 P1

평소엔 edge에 **작은 nost 펠릿(로고 + 폴더 개수)**, 호버/포커스 시 레일 펼침.

- 접힘: ~28×28 펠릿. 펼침: 세로 레일(폭 ~180). CSS width/opacity 트랜지션.
- 창은 펼친 크기로 만들고 내부에서 접힘/펼침을 렌더링(setBounds 토글 금지 —
  깜빡임·click-through 재계산 회피). click-through 캡처 토글은 기존 패턴 재사용.
- **[[feedback_mistake_patterns]] C(애니메이션 큐)**: 펼침/접힘 빠른 반복 시 큐
  꼬임 주의 — transitionend 기반 단일 상태 머신으로.

### 비주얼 디자인 (시안 확정 2026-06-25)

수평 바 → **세로 레일**. 현 `DialogPopup` 다크 글래스/칩 시각 언어를 재배치만 한다.

- 구성(위→아래): ① 헤더(`folder_open` 액센트 + 다이얼로그 타이틀 + drag grip)
  ② **추천 카드**(액센트 tint, 유일한 강조) ③ 즐겨찾기 섹션 칩 ④ 최근 저장 섹션 칩
  ⑤ 스페이스 칩 ⑥ 하단 검색 핀(C 진입점, `↵ 점프`).
- 액센트는 **추천 카드 + 펠릿 배지에만**. 나머지 중립 칩 → 시선이 추천에 먼저.
- 스페이스 칩 색 점 = **사용자 데이터(per-space color)**, 색 토큰이 아님(예외 명시).
- **금지: 번개(bolt)/반짝이(sparkles) 류 장식 아이콘.** 브랜드 표식은 `NostLogo`
  컴포넌트 또는 무표식. ms-rounded 아이콘만(`folder_open`/`star`/`schedule`/`search`).
  → [[feedback_design_system]], 신규 [[feedback_no_bolt_icon]].

### 색 토큰화 (하드코딩 0 — 필수 선행)

**현 위반**: dialog-popup 위성(`frontend/src/dialog-popup/index.tsx`)은 폰트만 import,
`index.css`(토큰)를 **안 불러옴** → 원작자가 `DialogPopup.tsx` `C` 객체에 색을
하드코딩(`rgba(20,20,26,0.96)`, `#6366f1` …). 디자인 SSOT 위반.

- **수정**: `index.css`의 `:root`/`.dark` 토큰 블록을 `tokens.css`로 추출 →
  모든 위성 엔트리(dialog-popup/image-viewer/…)가 import. (index.css 통째 import는
  body reset/글로벌 스타일이 투명 click-through 위성을 깨뜨릴 수 있어 지양.)
- `C` 상수 제거 → `var(--surface)`/`var(--border-rgba)`/`var(--text-color)`/
  `var(--text-muted)`/`var(--accent)` 로 치환. 라이트/다크는 토큰이 자동 처리
  (현 `isLight()` 수동 분기 제거 가능).
- **하드코딩 hex/rgba 리터럴 0개**가 완료 기준. `hexToRgba(space.color, …)` 만 예외
  (스페이스 색은 데이터).

### 가변 창 robustness (안 깨짐 — 필수)

다이얼로그는 크기·위치가 제각각. 레일은 다음을 항상 만족:

- **폭**: 고정(~210 DIP). 다이얼로그 폭과 무관 → 좁은 창에도 안전.
- **높이**: `clamp(MIN, dialogHeight, MAX)`. 매우 짧은 창(작은 "열기")이면 레일
  자체 min 높이 유지(찌그러뜨리지 않음). 매우 긴 창이면 cap + **본문 내부 스크롤**
  (헤더·추천·검색 핀은 고정, 칩 영역만 `overflow-y:auto`).
- **세로 위치**: 다이얼로그 top 정렬. 레일 하단이 workArea 밖이면 위로 shift-in.
- **가로 위치**: 우측(`x=rect.right`) 우선. `rect.right + railW > workArea.right`면
  좌측 flip(`x=rect.left-railW`). 둘 다 안 되면(풀폭 창) 우측 edge 안쪽 오버레이.
- **DPI/멀티모니터**: `getDisplayMatching(rect)` → Electron screen SSOT로 DIP 환산.
  [[feedback_dpi_positioning]].

## 5. 데이터 소스 / 신규 상태

- **저장 이력 학습 테이블** (신규): `store`에 `dialogSaveHistory: { [appOrExt]: { folderId, path, at } }`.
  사용자가 추천/폴더 클릭으로 점프 → 그 폴더를 해당 앱·확장자 키에 기록(LWW식 at 갱신).
  메모리+store, 상한 N(예: 50엔트리) 링버퍼. **무거운 인덱싱 금지** —
  [[feedback_design_system]]/perf-patterns 기조(캐시 최소).
- 폴더 카드 목록: 이미 IPC로 push 중(`pushDialogPopupState`). 추가 노출 없음.

## 6. 구현 매핑 (파일별)

| 영역 | 파일 | 변경 |
|---|---|---|
| 위치(dock 앵커) | `main.js` `positionDialogPopup`/상수 | 880 고정 → rect.right edge, rect-서명 메모이즈 |
| 창 크기/형태 | `main.js` `createDialogPopupWindow` | 레일 치수, 펠릿 고려 |
| 추천 단서 전달 | `main.js` tickDialogPoll → `pushDialogPopupState` | detected(app/title) + 추천 결과 주입 |
| 이력 학습 | `main.js` (점프 IPC 핸들러) | onClickFolder 점프 시 dialogSaveHistory 기록 |
| 렌더(레일/펠릿/추천/검색) | `frontend/src/dialog-popup/DialogPopup.tsx` | 세로 레일 + 펠릿 접힘 + 추천 카드 + 검색핀. `C` 상수 → 토큰 |
| 토큰 주입 | `frontend/src/index.css` → `tokens.css` 추출, `dialog-popup/index.tsx` import | `var(--*)` 닿게. 하드코딩 색 제거 선행 |
| 브리지 | `electron/preload-dialog-popup.js` | 신규 state 필드. **[[feedback_mistake_patterns]] E(sandbox preload) 점검** |

## 7. 미해결 — "안 뜸" 회귀 (분리 트랙)

재설계 전/병행으로 **재현 1건**: Acrobat "다른 이름으로 저장"에서
`foregroundWindow.detect()` 로그 확인. `className`이 #32770인지, title-net이
`isBrowserClass`로 막혔는지. 막혔다면 §원인은 v1.3.49 NON_DIALOG_CLASS_RE
오적용. **재설계 PR과 커밋 분리.**

## 8. 오답노트 가드 (착수 시 1분 self-check)

- **B (closure-over-IPC)**: 레일 핸들러가 stale 폴더 목록 캡처 안 하게 — 최신 state 참조.
- **E (sandbox preload)**: 새 IPC 필드 preload-dialog-popup.js에 실제 노출했는지.
- **G (silent gate)**: 추천 미스/이력 없음일 때 조용히 사라지되, 레일 본체(폴더 칩)는 항상.
- **DPI**: dock 좌표는 Electron screen SSOT. PS 환산 금지.
- **autoHide/focus**: C(타이핑)에서 다이얼로그 포커스 절대 탈취 금지. `plans/focus-state-audit.md` 준수.

## 9. Phasing

- **P1** — Dock-to-edge 레일 + 펠릿 접힘. (앵커 수식 교체 + 렌더 재배치. 체감 최대)
- **P2** — 컨텍스트 추천 한 줄 + 저장 이력 학습.
- **P3** — 타이핑 점프(포커스/IME 신중).
- 각 P 독립 출시 가능. P1만으로 "통제감" 문제는 끝남.
