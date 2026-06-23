# 캡처 기능 — 설계 (v1.3.52+)

> 캡처 → 확인 모달 → 스페이스 지정 → 이미지 카드 등록. + 캡처 배지.
> 작성: 2026-06-23. 사용자 의도: "캡처→확인→카드 등록→스페이스 지정→짜잔".

## §0. 결론 — 안 헤비함 (80% 조립)

기존 빌딩블록 재사용:
- **전체 화면 그랩**: `desktopCapturer.getSources({types:['screen'], thumbnailSize: 물리해상도})` — 컬러피커(`pick-color-from-screen`)가 이미 사용. 런처 hide → grab → restore 패턴 존재 (main.js ~5340).
- **활성 창 bounds**: `electron/foreground-window.js::detect()` → `{ rect:{x,y,width,height}, hwnd, title }`.
- **오버레이 창**: `picker.html` + `preload-picker.js` + `picker-result` IPC + 전체화면 transparent BrowserWindow (color eyedropper). 영역 드래그가 그대로 미러.
- **이미지 → 카드**: v1.3.46 image 타입 + `userData/images/{uuid}.png` 저장 (`save-clipboard-image` 패턴) + Cohort C.
- **크롭**: image-viewer 의 canvas 영역 추출 로직.
- **스페이스 지정**: `screenPicker` ("화면에서 고르기") 패턴 — 그리드 스페이스 글로우 + 클릭.
- **카드 등록 애니메이션**: `cardEnter` keyframe + `markItemsAsNew`. (유행하는 "비행 안착" 류는 MVP 제외 — 사용자 결정.)

## §1. 캡처 모드 4종

| 단축키 | 모드 | 동작 | 비고 |
|---|---|---|---|
| Alt+1 | 직접 지정 | 전체그랩 freeze 오버레이 → 드래그로 사각 영역 → 크롭 | picker 오버레이 미러 |
| Alt+2 | 영역 선택 | 윈도우 hover 하이라이트 → 클릭 = 그 창 영역 | 윈도우 rect 열거 필요 — 직접지정과 합쳐 1차엔 드래그로, 윈도우-스냅은 후속 |
| Alt+3 | 활성 창 | foreground window rect 즉시 크롭 | detect().rect, 오버레이 없음 |
| Alt+4 | 전체 화면 | 현재(또는 커서) 모니터 전체 즉시 | desktopCapturer 그대로 |

**Alt+3 = 활성 창 통째** (사용자 결정 — 스크롤 웹페이지 캡처는 런처에서 불가).

## §2. 흐름

```
[캡처 트리거] (메뉴 Alt+1~4 / 캡처 배지 클릭)
  → 런처 hide (자기 자신 안 찍히게)
  → desktopCapturer 전체 그랩 (물리 해상도)
  → 모드별:
       Alt+4: 모니터 전체
       Alt+3: foreground rect 크롭
       Alt+1/2: 오버레이 띄워 영역 드래그 → 크롭
  → 런처 restore
  → [확인 모달] (사용자 결정: 확인 단계 거침)
       미리보기 + (선택) 크롭 재조정 — image-viewer 크롭 재사용
       [취소] [카드로 등록]
  → 카드로 등록 → 스페이스 지정 (screenPicker 글로우)
  → 클릭한 스페이스에 image 카드 추가 (cardEnter 애니메이션)
  → 짜잔
```

## §3. 캡처 배지 — 앱 미실행 시 launch

- 플로팅 배지에 새 종류 `capture` 추가 (기존 refType: space|node|deck → +capture).
- 배지는 별도 always-on-top 창이라 메인 앱 hidden 이어도 클릭 가능.
- 배지 클릭 → 캡처 그랩 (메인 윈도우 불필요) → 확인 모달 (satellite, 메인 독립).
- **"카드로 등록" 누르는 시점에 메인 앱이 hidden 이면**: 등록 = 스페이스 지정 필요 → 메인 윈도우 show 후 screenPicker 진입. (캡처/확인까지는 메인 없이, 등록 시 메인 소환.)

## §4. IPC (4-file: main.js + preload.js + electronBridge.ts + 호출처)

- `capture-screen` (mode, opts) → { ok, dataUrl | path, width, height } : 모드별 그랩.
  - 'full' (모니터), 'window' (foreground rect), 'region' (오버레이 좌표 크롭).
- region 모드: 별도 capture-overlay 창 (picker 미러) → `capture-region-result` (rect) → main 이 크롭.
- `save-capture-image` (dataUrl) → userData/images/{uuid}.png path (save-clipboard-image 재사용 가능).

## §5. UI surface

- 캡처 메뉴: 사이드바 "캡처" 도구 버튼 → 4모드 드롭다운. **Alt+1~4 는
  전역 단축키 아님 — 메뉴 열렸을 때만 동작하는 in-menu accelerator**
  (전역으로 하면 Alt+4 = 앱 토글 기본 단축키와 충돌. 레퍼런스 캡처툴도
  드롭다운 안 라벨). dropdown onKeyDown 으로 1~4 가로채기 (빠른추가
  메뉴의 1/2/3 패턴 재사용).
- 확인 모달: image-viewer satellite 변형 OR 신규 capture-confirm satellite. 크롭 로직 공유.

## §6. Phasing (안전 슬라이스)

1. **P1**: capture-screen IPC (full + window) + 확인 모달 + 스페이스 지정 + 카드. 전역 단축키 Alt+3/4. (end-to-end 수직 슬라이스)
2. **P2**: region 오버레이 (Alt+1 직접지정 드래그). picker 미러.
3. **P3**: 캡처 배지 + 앱 미실행 launch.
4. **P4**: Alt+2 영역선택 윈도우-스냅 (윈도우 rect 열거) — 가장 무거움, 마지막.
5. **(보류)**: 비행 안착 애니메이션 (cardEnter 로 충분 — 사용자 결정).

## §7. 충돌/정합 주의 (오답노트)

- **L 폴링**: 캡처는 이벤트 기반 (단축키/배지 클릭). 폴링 없음.
- **이미지 SSOT**: 캡처 결과는 image 카드 = Cohort C (userData/images). cohort.ts / imageExtensions 그대로.
- **functional setState**: 카드 추가는 store.addItem (이미 functional).
- **canPerform**: 캡처 트리거도 conflict 정책 통과? 캡처는 메인 모달과 독립(별도 그랩)이라 모드 중에도 허용할지 판단 — 1차엔 normal 모드에서만.
- **DPI**: desktopCapturer 는 물리 해상도. 크롭 좌표는 오버레이(DIP) → 물리 변환 필요 (scaleFactor). picker 가 이미 처리하는 패턴 참조.
