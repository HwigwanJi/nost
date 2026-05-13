# nost Bridge — Chrome 웹 스토어 게시 가이드

> **목적**: 이 문서를 따라가면 처음 게시까지 약 1시간(스크린샷 촬영 포함), 심사 통과까지 1–7일 안에 끝납니다.
> 마지막 업데이트: 2026-04-27

---

## 0. TL;DR — 한눈에 보는 흐름

```
[1] 개발자 계정 등록 ($5 1회)        ← 사용자가 직접 (10분)
        ↓
[2] PRIVACY.md를 공개 URL에 호스팅    ← 사용자가 직접 (5분, GitHub Pages 추천)
        ↓
[3] 스크린샷·프로모션 이미지 만들기   ← 사용자가 직접 (20–40분)
        ↓
[4] zip 만들기                       ← 스크립트 한 줄 (1분)
        ↓
[5] 대시보드에서 업로드 + 스토어 등록정보 입력 (이 문서의 §6 복붙)
        ↓
[6] "검토 제출"
        ↓
[7] 1–7일 후 승인 (or 거부 → §8 참고)
```

---

## 1. 개발자 계정 등록 ($5)

1. https://chrome.google.com/webstore/devconsole 접속
2. Google 계정으로 로그인
3. **계정 등록비 $5 USD 1회 결제** (영구, 환불 불가)
4. 본인 인증 (전화번호) 후 대시보드 접속

> **유의**: 이 계정으로 게시한 확장은 모두 본인 명의로 공개됩니다. 이름/이메일이 스토어에 노출됨.

---

## 2. PRIVACY.md 공개 호스팅 (필수)

Chrome 웹 스토어는 개인정보 처리방침 **공개 URL**을 요구합니다. 우리 [PRIVACY.md](../PRIVACY.md)를 그대로 쓰면 됩니다.

### 가장 쉬운 방법 — GitHub raw URL

이미 저장소가 public이면 즉시 사용 가능:
```
https://raw.githubusercontent.com/HwigwanJi/nost/main/PRIVACY.md
```

raw URL은 plain text라 스토어에는 받아들여지지만 보기엔 별로 안 좋음. 더 나은 방법:

### 추천 — GitHub Pages

1. 저장소 Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)`
2. 저장 후 1–2분 대기
3. URL: `https://hwigwanji.github.io/nost/PRIVACY` (또는 `/PRIVACY.md`)

> ❗ Pages가 켜진 뒤 PRIVACY.md를 stack-trace 없이 읽히는지 브라우저에서 직접 확인하세요. 스토어는 URL을 자동 검증합니다.

### 대안 — Gist

1. https://gist.github.com 에 PRIVACY.md 내용 그대로 붙여넣고 public으로 저장
2. 가공 없이 사용

---

## 3. 시각 자산 준비

### 필수

| 자산 | 픽셀 | 형식 | 위치/생성 방법 | 업로드 방식 |
|------|------|------|--------------|------------|
| **Toolbar 아이콘** (zip 안) | 16, 48, 128 | PNG | ✅ `chrome-extension/icons/icon{16,48,128}.png` (이미 nost 브랜드 로고) | **zip에 자동 포함** |
| **스토어 등록정보 아이콘** | 128×128 (96 + 16px 패딩) | PNG | ✅ `chrome-extension/store-assets/store-icon-128.png` | **대시보드에서 별도 업로드** |
| **작은 프로모 타일** | 440×280 | PNG/JPEG | 직접 제작 (피그마/Canva) | 대시보드에서 업로드 |
| **스크린샷** | 1280×800 (또는 640×400) | PNG/JPEG | 직접 캡처, 1–5장 | 대시보드에서 업로드 |

> **Toolbar vs 등록정보 아이콘의 차이**:
> - **Toolbar 아이콘** (zip): 풀-블리드 — 브라우저 툴바의 작은 영역에서 식별성을 높이려고 가장자리까지 채움
> - **등록정보 아이콘** (별도): 96×96 아트 + 16px 투명 패딩 — 스토어 갤러리 페이지에서 다른 확장들과 나란히 놓일 때 시각적 호흡을 줌
> - 둘 다 nost "n" 브랜드 로고로 통일됨 (이전 placeholder 로켓 → 브랜드 로고로 교체 완료)
>
> **재생성**: 마스터 로고를 바꾸면 `chrome-extension/generate-store-icon.ps1`을 다시 실행해 등록정보 아이콘을 갱신하고, toolbar 아이콘은 `assets/icon-{16,48,128}.png`를 `chrome-extension/icons/`로 다시 복사.

### 선택

| 자산 | 픽셀 | 비고 |
|------|------|------|
| 마키 프로모 | 1400×560 | Featured/Marquee 영역에 들어가려면 필요 |

### 스크린샷 추천 구성 (5장 채우기)

1. **nost 데스크톱 앱** 메인 화면 — 카드 그리드 + 사이드바 (브랜드 인지)
2. **확장 팝업** — `🚀 nost Bridge / 서버 연결: 연결됨 / 전송 중인 탭: 12개` (확장 자체)
3. **탭 검색·포커스** — 데스크톱 앱에서 카드 클릭 → Chrome 탭 활성화되는 데모 (사용 가치)
4. **분할 배치** — 노드 그룹 실행으로 두 탭이 좌우 분할되는 화면 (고유 기능)
5. **로컬 전용 통신** — 팝업 + "127.0.0.1" 주석 오버레이 (안전성 강조)

캡처는 `Win+Shift+S`로 1280×800 영역 잡으면 됨. 또는 nost 자체 창 크기를 설정에서 1280px로 맞춰 띄우고 풀 캡처.

### 작은 프로모 타일 (440×280)

레이아웃 권장:
```
┌──────────────────────────────────┐
│  [nost 로고]   nost Bridge       │
│                                  │
│  브라우저 탭을 데스크톱 런처로    │
│  로컬 루프백 · 외부 전송 없음     │
└──────────────────────────────────┘
```

피그마/Canva에서 빠르게 제작. nost의 accent 컬러(보라 계열) 활용.

---

## 4. zip 만들기

```powershell
cd "D:\01_개인\06. launcher\chrome-extension"
.\create-store-zip.ps1
```

결과: `D:\01_개인\06. launcher\release\nost-bridge-store-1.0.0.zip`

이 zip에는 `manifest.json`, `background.js`, `popup.html/js`, `icons/16,48,128.png`, `_locales/{en,ko}/messages.json`만 들어 있고, dev 전용 파일(`create-icons.js`, `generate-icons.js`, `icon.svg`, 이 스크립트 자체)은 제외됩니다.

---

## 5. 대시보드에 업로드

1. https://chrome.google.com/webstore/devconsole 로그인
2. 우상단 **"새 항목"** 클릭
3. 위 zip 파일 업로드 → 자동 검증 → 등록정보 화면으로 이동

---

## 6. 스토어 등록정보 — 그대로 복사해서 붙여넣기

### 6.1 항목 정보

**언어**: 한국어 (기본) + 영어 추가

#### 한국어 등록정보

**이름**: `nost Bridge`

**요약 (132자 이내, 검색 노출용)**:
```
nost 데스크톱 런처와 브라우저 탭을 로컬 루프백으로 연동. 탭 검색·포커스·분할 배치 지원. 외부 전송 없음.
```

**자세한 설명 (16,000자 이내, 마크다운 일부 지원)**:
```
nost Bridge는 Windows용 데스크톱 런처 「nost」와 Chrome/Whale 브라우저 탭을 연결하는 보조 확장입니다.

━━━ 무엇을 하나요 ━━━

• 현재 열린 모든 탭의 제목·URL을 nost 런처에 실시간 동기화
• nost 런처에서 탭 검색 후 클릭 한 번으로 해당 탭으로 포커스
• 노드 그룹/덱 실행 시 여러 탭을 좌우/상하로 자동 분할 배치
• 별도 창으로 분리(detach) 또는 새 창으로 열기 동작 지원

━━━ 데이터 처리 — 100% 로컬 ━━━

• 모든 통신은 사용자 본인 컴퓨터의 127.0.0.1:14502(루프백)으로만 발생
• 외부 서버, 클라우드, 분석 도구 일절 사용 안 함
• 수집·저장하는 사용자 데이터 없음
• 자세한 사항: 개인정보처리방침 참고

━━━ 권한 사용 이유 ━━━

• tabs / activeTab — 탭 제목·URL을 nost 런처에 보내고, 런처에서 클릭한 탭을 활성화하기 위함
• 호스트 권한 (127.0.0.1:14502) — nost 데스크톱 앱이 듣는 로컬 포트로만 한정. 외부 도메인과 통신하지 않음

━━━ 사전 요구사항 ━━━

이 확장은 nost 데스크톱 앱이 같은 컴퓨터에서 실행 중일 때만 동작합니다. 데스크톱 앱이 없으면 팝업에 "연결 안됨"으로 표시되며 다른 영향은 없습니다.

nost 데스크톱 앱: https://github.com/HwigwanJi/nost
```

#### 영어 등록정보

**Name**: `nost Bridge`

**Summary**:
```
Bridge browser tabs to the nost desktop launcher over local loopback. Search, focus, and tile tabs from your launcher. No external network.
```

**Detailed description**:
```
nost Bridge connects Chromium browsers to the nost desktop launcher (Windows) on the same machine.

━━━ What it does ━━━

• Mirrors title and URL of all open tabs to nost in real time
• One-click focus from the launcher's tab search
• Auto-tiles multiple tabs side-by-side when launching a node group or deck from nost
• Supports detach-to-window and open-in-new-window actions

━━━ Data — 100% local ━━━

• All traffic stays on your machine's loopback interface (127.0.0.1:14502)
• No external servers, no analytics, no telemetry
• No personal data collected, stored, or transmitted
• See the privacy policy for full details

━━━ Permissions ━━━

• tabs / activeTab — to read tab title and URL for the launcher and to focus a tab when you click it in nost
• Host permission for 127.0.0.1:14502 — strictly the local port the nost desktop app listens on

━━━ Requirements ━━━

This extension requires the nost desktop app running on the same machine. Without it, the popup will show "Disconnected" — no other effect.

nost desktop app: https://github.com/HwigwanJi/nost
```

### 6.2 카테고리

- **기본 카테고리**: `생산성 (Productivity)`
- **언어**: 한국어, 영어

### 6.3 그래픽 자산 — 대시보드 업로드 항목

좌측 메뉴 **"스토어 등록정보"** 탭에서 다음 항목을 채웁니다:

| 항목 | 파일 (절대 경로) | 필수 |
|------|------------------|------|
| **스토어 아이콘** (128×128) | `D:\01_개인\06. launcher\chrome-extension\store-assets\store-icon-128.png` | ✅ |
| **작은 프로모 타일** (440×280) | 직접 제작 후 업로드 | ✅ |
| **스크린샷** (1280×800) | §3 가이드대로 5장 캡처 후 업로드 | ✅ (최소 1장) |
| **마키 프로모** (1400×560) | 선택 — Featured 영역 노출되려면 필요 | ❌ |

> ⚠️ **Toolbar 아이콘은 여기서 업로드하지 않습니다.** zip 안에 이미 들어 있어서 manifest의 `icons` / `action.default_icon` 필드가 자동으로 지정합니다. 대시보드에 별도 업로드란이 없습니다.

### 6.4 개인정보 보호 사항 ⚠️ 거부 사유 1순위

**단일 목적 (Single purpose)** 입력란:
```
브라우저 탭의 제목과 URL을 같은 컴퓨터에서 실행 중인 nost 데스크톱 런처에 전달하고, 런처의 명령으로 탭을 포커스·분할 배치하는 단일 기능.
```

**권한 정당화** — Google이 자동으로 묻는 항목들:

| 권한 | 정당화 텍스트 |
|------|--------------|
| `tabs` | 사용자가 nost 런처에서 탭을 검색·포커스할 수 있도록, 모든 탭의 제목과 URL을 로컬 데스크톱 앱에 동기화하기 위해 필요합니다. 런처 클릭 시 해당 탭을 활성화하기 위해 chrome.tabs.update가 필요합니다. |
| `activeTab` | tabs와 함께 현재 활성 탭의 정보를 안정적으로 읽기 위함입니다. |
| `host_permissions` (`http://127.0.0.1:14502/*`) | nost 데스크톱 앱이 같은 컴퓨터에서 듣고 있는 로컬 루프백 주소입니다. SSE를 통한 단방향 명령 수신과 탭 정보 POST를 위함이며, 다른 어떠한 호스트와도 통신하지 않습니다. |
| **원격 코드 사용** | **사용 안 함**. 모든 코드는 패키지에 포함된 정적 JavaScript이며, eval 또는 외부 스크립트 로드를 사용하지 않습니다. |
| **사용자 데이터** | 사용자 데이터를 수집·전송·저장하지 않습니다. 모든 데이터는 사용자 본인 컴퓨터의 루프백을 벗어나지 않습니다. |

**개인정보처리방침 URL**: §2에서 만든 URL 붙여넣기

### 6.5 배포

- **공개 범위**: `공개 (Public)` — 모든 사용자
- **지역**: 모든 지역
- **연령 등급**: `전체 이용가`
- **지연 게시**: 첫 게시는 **체크 해제** (승인 즉시 공개). 자신 있으면 둘 중 어느 쪽이든 OK.

---

## 7. 제출 전 최종 체크리스트

게시 버튼 누르기 전에 한 줄씩 확인:

- [ ] 개발자 계정 등록 + $5 결제 완료
- [ ] PRIVACY.md 공개 URL 살아있는지 브라우저에서 확인
- [ ] manifest.json `version`이 1.0.0 (또는 그 이상이고 이전 게시보다 큰 값)
- [ ] zip 안에 `manifest.json`이 **루트**에 있음 (폴더 안 아님) — `create-store-zip.ps1`이 보장
- [ ] zip에 dev 파일(`create-icons.js`, `generate-icons.js`, `icon.svg`, README, .git 등) 미포함 — 스크립트가 자동 제외
- [ ] 아이콘 128×128 PNG 들어 있음 — 스크립트가 검증
- [ ] 스크린샷 최소 1장 (1280×800) 준비됨
- [ ] 작은 프로모 타일 440×280 준비됨
- [ ] 한/영 등록정보 텍스트 §6에서 복사-붙여넣기 완료
- [ ] 권한 정당화 4개 모두 §6.4에서 복사-붙여넣기 완료
- [ ] "원격 코드 사용 안 함" 라디오 선택 확인
- [ ] 단일 목적 텍스트 입력 확인
- [ ] 카테고리: 생산성

---

## 8. 흔한 거부 사유 + 예방

심사가 거부되어도 수정 후 재제출 가능. 자주 떨어지는 케이스 미리 대응:

### 8.1 "권한이 단일 목적과 일치하지 않음"

→ §6.4의 정당화 텍스트가 **각 권한별로 한 문장 이상**이어야 함. "필요해서 사용함" 같은 짧은 답변 금지.

### 8.2 "개인정보처리방침 URL 접근 불가"

→ 익명 탭으로 URL 열어보기. GitHub Pages는 첫 배포 후 5분 정도 404일 수 있음. 5–10분 기다린 후 재제출.

### 8.3 "사용자가 확장만 설치해도 가치를 얻을 수 있어야 함"

→ 우리 확장은 데스크톱 앱이 있어야 의미가 있음. **자세한 설명에서 "사전 요구사항" 섹션을 명확히 노출**해두면 거의 통과. 추가 안전장치로 popup.html에서 데스크톱 앱이 없을 때 다운로드 안내 링크를 보여주는 것을 고려해볼 수 있음(현재는 "연결 안됨"만 표시).

### 8.4 "tabs 권한이 과도함"

→ 우리는 검색·포커스를 위해 모든 탭의 메타데이터가 필요함. **목적**을 명확히 적으면 통과. 만약 거부되면 `tabs` → `activeTab`만 사용하는 모드를 추가하는 옵션 고려.

### 8.5 "코드 난독화 / minify"

→ 우리 코드는 평문 ES6. 영향 없음. 만약 향후 webpack 등으로 빌드한다면 **소스맵 동봉**이 필수.

### 8.6 "원격 코드 로드"

→ 우리는 fetch로 데이터(JSON)만 받음, 코드 실행 없음. 정당화 시 "동적 코드 실행 없음, JSON 데이터만 수신"이라고 적시.

---

## 9. 게시 후 — 업데이트 방법

새 버전 출시 흐름:
1. `manifest.json`의 `version`을 **이전보다 큰 값**으로 변경 (예: 1.0.0 → 1.0.1)
2. `create-store-zip.ps1` 다시 실행
3. 대시보드 → 해당 항목 → **"패키지 업로드"**
4. 변경 내역 메모 입력 후 **"검토 제출"**
5. 다시 1–7일 심사. 보통 첫 게시보다 빠름.

> 마이너 버그 수정도 항상 새 버전 번호. 같은 버전 재업로드는 불가.

---

## 10. 데스크톱 앱과의 연계 — 완료 (2026-04)

배포 승인 후 (스토어 ID: `fjehpjoninofepdoiakibjaokakihilo`) nost 데스크톱 앱에 다음 작업 완료:

- [x] [ExtensionInstallWizard.tsx](../frontend/src/components/ExtensionInstallWizard.tsx)에 **"Chrome 웹 스토어에서 설치"** 버튼을 메인 액션으로 추가. 기존 개발자 모드 (Load unpacked) 안내는 "수동 설치 (개발자용)" 디스클로저로 강등.
- [x] 설정 → 확장 탭에서 위저드를 임베드해서 사용. (위저드 자체가 스토어 진입점이라 별도 링크 불필요)
- [x] [main.js](../main.js)에 새 IPC `open-extension-store` 추가 — `shell.openExternal('https://chromewebstore.google.com/detail/nost-bridge/fjehpjoninofepdoiakibjaokakihilo')` 호출.
- [x] `preload.js` / `electronBridge.ts`에 `openExtensionStore()` 노출.

설치 흐름 (사용자 관점):
1. 설정 → 확장 → **"확장 설치하기"** 클릭
2. 위저드 첫 화면에서 **"Chrome 웹 스토어에서 설치"** 클릭
3. 동시에 두 가지가 일어남:
   - 백그라운드: HKCU 레지스트리에 ExternalExtensions 항목 작성 → Chrome이 다음 실행 시 1-클릭 활성화 알림
   - 포그라운드: 기본 브라우저에서 스토어 페이지 열림 → "Chrome에 추가" 클릭으로도 설치 가능
4. 위저드의 **"연결 확인"** 클릭 → 성공 메시지

테스트는 정식 스토어에 게시된 확장으로 진행. ID 변경 시 `main.js`의
`NOST_BRIDGE_EXTENSION_ID` 상수만 갈아끼우면 됨 (`open-extension-store`,
`register-extension-external` 두 핸들러가 동일 상수 참조).

---

## 부록 A. 공식 문서 링크

- 게시 절차: https://developer.chrome.com/docs/webstore/publish?hl=ko
- 게시 전 준비: https://developer.chrome.com/docs/webstore/prepare?hl=ko
- 이미지 스펙: https://developer.chrome.com/docs/webstore/images?hl=ko
- 프로그램 정책: https://developer.chrome.com/docs/webstore/program-policies?hl=ko
- 콘텐츠 등급: https://developer.chrome.com/docs/webstore/rating?hl=ko
- 업데이트: https://developer.chrome.com/docs/webstore/update?hl=ko
- 개발자 대시보드: https://chrome.google.com/webstore/devconsole
