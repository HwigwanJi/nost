# Color Picker 개선 플랜

> 증상 (v1.3.30): 컬러 피커 발사 시 검은 화면만 뜸 + 어느 모니터가 캡처되는지 모름.

---

## §1. 진단 — 검은 화면 원인 후보

`main.js` `eyedropper-pick` IPC → `desktopCapturer.getSources({ types: ['screen'], thumbnailSize })` → `src.thumbnail.toDataURL()` → picker.html 의 `<img>` 에 표시.

검은 화면이 뜨는 메커니즘은 셋 중 하나:

### A. `desktopCapturer` 가 blank thumbnail 반환 (가장 유력)
- Windows HDR 활성 환경에서 자주 발생. desktopCapturer 는 SDR 텍스처를 못 뽑아 black frame 반환.
- DRM 보호 콘텐츠 (Netflix/Prime/Spotify Web) 가 foreground 면 그 영역만 black.
- GPU 가속 꺼진 (`--disable-gpu`) Electron → 어떤 thumbnail 도 못 뽑음.
- Electron 41 의 알려진 회귀 — multi-display 환경 + 일부 GPU driver 에서 primary 가 아닌 source 가 blank.

### B. `display_id` 매칭 실패
- Windows 에서 `s.display_id === ''` 가 종종 옴. 기존 코드는 첫 번째 source 로 fallback → 잘못된 모니터 캡처 → 사용자가 "내 모니터 아닌데?" 로 인지.
- 사용자 launcher 가 secondary 모니터에 있는데 primary 캡처 → 시각적으로 black 처럼 보일 수 있음 (e.g. primary 가 잠금 화면).

### C. picker 창 자체 black
- `<canvas id="shot">` 로 그리는데 `img.onload` 가 안 불려서 빈 캔버스. 토스트 없이 그냥 검정.
- DPR 계산 오류로 ctx.drawImage 가 viewport 밖에 그려짐.

---

## §2. 이미 적용한 quick-fix (v1.3.31 예정)

| 변경 | 효과 |
|---|---|
| **커서 모니터 캡처** — `getDisplayNearestPoint(getCursorScreenPoint())` 으로 target display 결정 | "내가 보는 모니터" 와 캡처가 일치 |
| **source 매칭 강화** — display_id → display index → first source 3단 fallback | display_id="" 케이스에서도 올바른 source 선택 가능성 ↑ |
| **`isEmpty()` + size 체크** — 빈 thumbnail 감지 시 즉시 abort + `capture-blank` reason 반환 | 검은 화면 대신 사용자에게 실패 명확화 (다음 단계: 토스트로 노출) |
| **풍부한 로그** — display info, sources 목록, thumb size, isEmpty 모두 main.log 에 INFO | 사용자에게 로그 한 줄 받으면 root cause 즉시 분기 |
| **모니터 라벨 badge** — 멀티 모니터일 때 picker 좌상단에 "1 / 주 모니터" 표시 | "어느 모니터?" 의문 해소 |

---

## §3. 다음 단계 — Phase 별 개선

### Phase 1 — Blank 감지 시 사용자 알림 (즉시)
- `capture-blank` reason 받았을 때 렌더러에서 토스트:
  - "화면 캡처가 비어있어 색을 뽑을 수 없습니다. HDR 끄거나 보호된 콘텐츠를 닫고 다시 시도해주세요."
- 동시에 fallback 옵션 노출:
  - "HSL 슬라이더로 입력하기" → 기존 헥스 입력 폼 모달
  - "다른 모니터 시도" → 다음 모니터로 재시도

### Phase 2 — 멀티 모니터 picker (소~중)
현재: cursor monitor 한 곳만 캡처해서 picker 띄움. 사용자가 마우스 움직여서 다른 모니터로 가도 따라가지 않음.

개선:
- `getAllDisplays()` 전체 캡처, 각 display 마다 picker 창 spawn
- 각 창에 모니터 번호 badge (이미 만든 monitor identification 카드 스타일 재사용)
- 첫 캡처 실패한 모니터는 picker 창 skip + 사용자에게 "모니터 N 캡처 실패" hint
- ESC / 클릭 결과는 어느 창에서 발사돼도 동일한 promise 로 모임

장점: 모니터 사이 마우스 이동 자유. 어디서든 색 뽑힘.
비용: 메모리 N × 풀스크린 screenshot (4K × 3대 ≈ 200MB peak). 짧은 lifetime 이라 수용 가능. 캡처 후 즉시 다른 source GC 검토.

### Phase 3 — 캡처 실패 hardening (중)
desktopCapturer 가 blank 일 때:
1. **Retry once** — 200ms 후 재시도 (driver hiccup 일 수 있음)
2. **Source type 'window' 시도** — `types: ['screen', 'window']` 로 fallback
3. **In-renderer EyeDropper API** — Chromium 의 `window.EyeDropper().open()` 으로 launcher 내부 픽셀만이라도 뽑게. user message: "전체 화면 캡처가 안 돼 nost 창 안에서만 색을 뽑습니다"
4. **HSL 슬라이더 모달** — 완전 실패 시 최후 수단

### Phase 4 — 진단 페이지 (장기)
설정 → 색 피커 진단 버튼:
- 캡처 시도 → 결과 dataURL 의 첫 10×10 픽셀 평균값 표시 + isEmpty 결과
- HDR 활성 여부 (`screen.getPrimaryDisplay().colorSpace` 등)
- GPU 가속 상태 (`app.getGPUFeatureStatus()`)
- 추천 조치 출력 ("HDR 끄기", "GPU 가속 켜기", "다른 디스플레이 시도")

---

## §4. 우선순위 권장

| Phase | 효과 | 비용 | 추천 |
|---|---|---|---|
| §2 quick-fix (적용 완료) | 모니터 명확화 + 진단 로그 | 작음 | ✓ |
| Phase 1 (사용자 알림) | 검은 화면 = 실패 인지 | 작음 | **즉시** |
| Phase 2 (멀티 모니터) | UX 본질 개선 | 중 | v1.3.32 후보 |
| Phase 3 (hardening) | 신뢰성 | 중 | v1.3.32+ |
| Phase 4 (진단 페이지) | 지원 비용 ↓ | 작음 | 여유 시 |

---

## §5. 사용자에게 즉시 안내할 워크어라운드

검은 화면 발생 시 확인 순서:
1. **Windows 디스플레이 설정 → HDR 끄기** (가장 흔한 원인)
2. **보호 콘텐츠 닫기** — Netflix / Prime Video / Spotify Web 등 DRM 페이지 닫고 재시도
3. **GPU 가속 확인** — Windows 설정 → 디스플레이 → 그래픽 → nost.exe 가 "고성능" 으로 잡혀있는지
4. **로그 보기** — 설정 → 로그 파일 → `[picker]` 라인 확인. `isEmpty=true` 면 캡처 자체가 실패.

---

## §6. SSOT 영향

`color-picker` 자체는 위젯/카드 동작 SSOT 와 별개 surface. `plans/ssot-index.md` 갱신 필요 없음 (단일 IPC `eyedropper-pick` 이미 SSOT).
