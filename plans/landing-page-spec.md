# nost 랜딩 페이지 — 디자인 사양서

> 작성: 2026-05-15. 이 문서는 nost 랜딩 페이지 (`/site` 폴더) 의 IA·카피·디자인 결정을 한 곳에 정리한 핸드오프 문서다. 코드 작성자나 디자이너가 이 한 장만 읽으면 맥락을 다 잡을 수 있도록 설계.

---

## 0. 코드베이스 위치

```
D:\01_개인\06. launcher\
├── frontend/          ← Electron 런처 앱 본체 (React + Vite)
├── main.js            ← Electron main process
├── plans/             ← 설계 문서들 (이 파일 포함)
├── site/              ← 🎯 랜딩 페이지 (Next.js 15 + Tailwind 4)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx        ← 홈
│   │   ├── learn/page.tsx  ← Learn 페이지
│   │   └── globals.css
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── Hero.tsx
│   │   ├── PillarsSection.tsx
│   │   └── demos/
│   │       ├── MediaWidgetDemo.tsx  ← P5 Tabs 의 미디어 위젯
│   │       └── MemoEditDemo.tsx     ← P3 Memo 의 메모 카드
│   ├── lib/pillars.ts       ← 5 Pillar 데이터
│   ├── package.json
│   ├── tailwind.config.ts (Tailwind 4 — @theme in globals.css)
│   └── tsconfig.json
└── ...
```

**실행**:
```bash
cd "D:/01_개인/06. launcher/site"
npm install --legacy-peer-deps   # React 19 / Next 15 peer-dep 우회
npm run dev                      # → http://localhost:3300
```

GitHub: `HwigwanJi/nost` (public). 현재 릴리스 v1.3.40.

---

## 1. 브랜드 정체성

| 항목 | 값 | 비고 |
|---|---|---|
| 제품명 | **nost** | 유지 — Antol 같은 리네이밍은 후순위 |
| 카테고리 | **작업 런처** (또는 "작업 캔버스") | 한 번 "캔버스" 로 갔다가 "런처" 로 회귀. P1 Hook 에서는 "런처" 사용 |
| 태그라인 | **모든 11초를, 1초로.** | Hero h1 — 이전의 "11번이 1번으로" 보다 강함 ("모든" = all, "초" = visceral time) |
| 보조 카피 공식 | **"OO하는 11초를 1초로."** | Pillar 마다 동사 OO 바꿈 |
| 색 | `#6366f1` (indigo-500) | nost 앱의 `var(--accent)` 와 동일. brand-50 ~ 900 스케일 정의됨 |
| 폰트 | Pretendard Variable | 앱과 동일 |
| 디자인 톤 | ReactFlow / Linear 스타일 | 풀-와이드 + 시원시원 + 좌-텍스트 우-데모 |

---

## 2. 정보 아키텍처

### Hero
- **헤드라인**: "모든 11초를, 1초로." (gradient on 첫 줄)
- **서브 카피**: "앱을 찾고, 창을 배치하고, 메모를 꺼내고, 탭을 더듬는 매일의 시간. nost 가 카드 한 장으로 줄여줍니다."
- **CTA**: `[무료로 시작]` (accent) + `[Learn →]` (ghost)
- **데모**: 실제 nost 메인 윈도우 mockup (frameless, 스페이스 accordion × 3, 카드 그리드)

### Pillar 5개 (순서 = 이게 본 IA)

#### 1. 앱을 찾는 11초.
- **Hook**: 단축키 하나로 여는 작업 런처
- **Copy**: 앱 이름을 떠올리고, 독을 훑고, 검색창을 여는 시간. / 자주 쓰는 앱과 링크를 카드로 모아, 단축키 하나로 바로 꺼냅니다.
- **CTA**: 단축키 직접 만져보기
- **Demo**: (다음 라운드) 가짜 키 입력 → 런처 열림 → "Figma" / "Cursor" / "Notion" 카드 선택 → 실행 시뮬레이션
- **Accordion**:
  - 글로벌 단축키 — 어떤 화면에서든 nost 를 바로 호출
  - 플로팅 Orb — 화면 한쪽에 작게, 필요할 때만 펼침
  - 슬래시 커맨드 — 앱·링크·파일·메모를 한 줄로 검색·실행
  - 자주 쓰는 카드 우선 표시 — 많이 쓴 카드가 자연스럽게 위로

#### 2. 창을 배치하는 11초.
- **Hook**: 앱 여러 개를 한 번에 열고 배치하기
- **Copy**: Cursor 는 왼쪽, 브라우저는 오른쪽, 디스코드는 보조 모니터에. / 매일 반복하는 그 배치를, nost 가 한 번에 처리합니다.
- **CTA**: 노드 빌더 열기
- **Demo**: (다음 라운드, **가장 큰 차별점**) 좌측 카드 3개 → 우측 3-모니터 SVG → 카드 끌어다 두면 거기 배치 → "실행" 누르면 splash 애니메이션
- **Accordion**:
  - 동시 실행 — 2~3개 카드를 분할 화면으로 한 번에
  - 모니터별 위치 기억 — 어느 화면 어디에, nost 가 외움
  - DPI-safe 타일링 — 노트북 + 외부 모니터 해상도 섞여도 안 망가짐
  - Deck — 정해진 순서대로 자동 실행 (시작 의식)
  - Sequence — 한 번만 묶음 실행 후 버리는 카드 줄

#### 3. 메모를 관리하는 11초.
- **Hook**: 작업 옆에 붙는 빠른 메모
- **Copy**: Notion 까지는 무겁고, 메모장은 잃어버리는 그 잡생각. / 작업 카드 옆에 메모 카드를 붙여, 며칠 뒤엔 스스로 사라지게 합니다.
- **CTA**: 메모 카드 만져보기
- **Demo**: ✅ **구현됨** — 본문 직접 편집 + TTL 슬라이더 (3/7/30일) + "시간 흐르기" 5초 시뮬레이션 + 핀 토글
  - 파일: `site/components/demos/MemoEditDemo.tsx`
- **Accordion**:
  - 빠른 메모 — Enter 두 번이면 카드. 본문 첫 줄이 자동으로 제목
  - 핀 고정 — 중요한 메모는 핀으로 자동 만료 보호
  - 자동 만료 — TTL 지나면 색 흐려지다 사라짐
  - 카드 옆 메모 — 작업 카드 옆에 같은 그리드로 붙여 컨텍스트 보존
  - 마크다운 — 헤더·리스트·코드블록. 스와이프로 마크다운/플레인 복사 분기

#### 4. 복사 붙여넣기하는 11초.
- **Hook**: 자주 쓰는 문장을 저장해두는 클립보드 카드
- **Copy**: "감사합니다. 검토 후 답변드리겠습니다." "/explain this code" / 자주 쓰는 문장을 카드로 저장해, 한 번의 클릭으로 클립보드에 올립니다.
- **CTA**: 클립보드 카드 만져보기
- **Demo**: (다음 라운드) 카드 그리드 — 클릭하면 "Copied!" 토스트 + 실제 clipboard.writeText
- **Accordion**:
  - 클립보드 카드 — 텍스트 한 덩이를 카드로. 클릭하면 클립보드에 복사
  - 프롬프트 저장 — ChatGPT/Claude 에 매번 적던 프롬프트를 카드로
  - 임시 텍스트 — 복사 후 잠깐 보관할 때 (이메일 초안, 회의 요약)
  - 자동 만료 — 임시 카드는 TTL 지나면 사라짐
  - 최근 복사 항목 — 방금 복사한 텍스트가 위로

#### 5. 숨겨진 탭을 찾는 11초.
- **Hook**: 열린 탭을 카드처럼 찾고 제어하기
- **Copy**: 어디서 소리가 나는지 찾으려 30개 탭을 뒤지는 시간. / 열려 있는 탭을 nost 카드 그리드에서 한눈에 찾고, 그 자리에서 제어합니다.
- **CTA**: 미디어 위젯 만져보기
- **Demo**: ✅ **구현됨** — 가상 트랙 (카더가든 / BTS / 유재하) + 재생/일시정지 / 트랙 이동 / scrubber. 실제 rAF 애니메이션.
  - 파일: `site/components/demos/MediaWidgetDemo.tsx`
- **Accordion**:
  - 열린 탭 스캔 — Chrome 확장이 모든 탭을 실시간으로 nost 에
  - 소리 나는 탭 찾기 — 음악·영상 재생 중인 탭만 필터
  - 탭 카드 저장 — 자주 가는 탭을 카드로 못 박아두면 단축키로 포커스
  - 미디어 컨트롤 — 재생/일시정지/다음곡을 nost 카드에서
  - 고스트 카드 — 열려 있는데 카드로 등록 안 된 앱·창 자동 추천

### 의도적으로 뺀 것
- ~~Pillar: Context (프리셋)~~ — Pro 후순위
- ~~Pillar: Continuity (PC 간 동기화)~~ — Phase 2 미완, 마케팅 카드 아님
- ~~Pillar: Power (확장 도구 일반)~~ — Tabs 로 흡수

---

## 3. 페이지 구조

### Home (`/`)
```
┌─────────────────────────────────────────────────────────┐
│ Header (sticky, full-width, blur)                       │
│   nost · Learn · GitHub · [다운로드]                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Hero (좌 텍스트 / 우 데모, 풀-와이드)                       │
│   ─ [pill] 단축키로 호출하는 작업 캔버스 · Windows           │
│   ─ "모든 11초를, / 1초로." (gradient)                   │
│   ─ 서브 카피                                            │
│   ─ [무료로 시작]  [Learn →]                              │
│                                  ┌────────────────┐    │
│                                  │  nost 메인창    │    │
│                                  │  mockup        │    │
│                                  └────────────────┘    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Pillars Section                                        │
│   "6가지 약속 / 매일 빼앗기던 11초들."                       │
│                                                         │
│   P1 [text] [demo placeholder]                          │
│   P2 [demo placeholder] [text]   ← reverse              │
│   P3 [text] [MemoEditDemo ✅]                             │
│   P4 [demo placeholder] [text]   ← reverse              │
│   P5 [text] [MediaWidgetDemo ✅]                          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Download CTA (큰 박스, accent 그라데이션)                  │
│   "오늘부터 11초를 1초로."                                  │
│   [Windows 설치 .exe]  [Learn 으로 →]                    │
├─────────────────────────────────────────────────────────┤
│  Footer (4-column links)                                │
└─────────────────────────────────────────────────────────┘
```

### Learn (`/learn`)
- 기본 개념 카드 6개 (카드/스페이스/노드/덱/프리셋/플로팅뱃지)
- Pillar 깊이 읽기 링크 5개 (홈으로 anchor)
- 단축키 표 (Alt+Space / `/` / Ctrl+Z / Ctrl+Enter / Esc)
- GitHub walkthrough_v2.md 링크

### 메뉴 (MVP)
- Home / Learn / GitHub / Download
- 미래: Showcase, Examples, Blog, Pricing — 다음 라운드

---

## 4. 디자인 시스템

### 컬러 토큰 (`site/app/globals.css`)
```css
@theme {
  --color-brand-500: #6366f1;    /* nost accent */
  --color-brand-400: #818cf8;    /* gradient end (lighter) */
  --color-brand-50:  #eef2ff;    /* accent-dim */
  /* full scale 50~900 정의됨 */
}

:root {
  --bg:        #ffffff;
  --bg-soft:   #fafafa;
  --bg-elev:   #ffffff;
  --fg:        #0a0a0a;
  --fg-muted:  #525252;
  --fg-dim:    #a3a3a3;
  --border:    #e5e5e5;
  --accent:    #6366f1;
}
```

다크모드 자동 (`prefers-color-scheme: dark`).

### Container 정책
- **전역 max-width**: `max-w-[1400px]` + `px-6 sm:px-10 lg:px-16`
- ReactFlow 처럼 풀-와이드, 시원시원
- 좌/우 패딩: 모바일 24px → 데스크탑 64px

### 카드 토큰 (앱 본체와 동일, `frontend/src/widgets/widgetTokens.ts` SSOT)
```ts
WIDGET = {
  cardHeight:   82,       // 모든 카드는 정확히 82px
  cardRadius:   12,       // rounded-xl
  primaryRadius: 8,       // 카드 안의 아이콘 박스 (rounded-lg)
  insideHeight: 38,       // 위젯 inside 카드 높이
  bottomRowHeight: 30,    // T-split footer
  statusDotSize: 5,
}
```
랜딩 mockup 데모는 **이 숫자를 그대로 따른다.** 사용자가 랜딩에서 본 카드 모양 = 다운로드 후 화면에서 보는 카드 모양 1:1.

### 타이포
- 헤드라인: `clamp(3rem, 8vw, 6rem)` font-weight 700
- 섹션 헤딩: `text-4xl md:text-5xl` font-weight 700
- 본문: `text-[15px] md:text-[17px]` line-height 1.625
- Mono: `ui-monospace`

### 시그너처 모티프
- **Dot-grid 배경** (ReactFlow): `radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)` 24px 격자
- **Soft accent glow**: hero 데모 뒤에 radial-gradient accent → transparent, 50% blur, -inset-8

---

## 5. 현재 구현 상태

### 완료 ✅
- 스캐폴드 (Next.js 15 + Tailwind 4 + framer-motion + TS)
- Header / Footer
- Hero (좌-텍스트 + 우-mockup, 풀-와이드)
- Hero mockup: frameless 윈도우 + 3 스페이스 accordion + 카드 그리드
- 5 Pillar 구조 (좌-텍스트 + 우-데모, 좌우 교차)
- Pillar 4-층 카피 (Hook → Promise → Body → Accordion)
- Pillar 별 CTA 버튼
- MemoEditDemo (P3) — interactive ✅
- MediaWidgetDemo (P5) — interactive ✅
- Learn 페이지 (기본 개념 + Pillar 링크 + 단축키 표)
- 다운로드 CTA 박스
- TypeScript 통과, 콘솔 에러 0, 양쪽 페이지 200 OK
- 다크 모드 자동 (CSS `prefers-color-scheme`)

### 미완 ⏳
- **Hero mockup 의 진짜 interactive 버전** (실제 nost 컴포넌트 import + stub 핸들러)
- **P1 Speed 데모**: 가짜 단축키 입력 → 런처 열림 → 카드 선택 → 실행
- **P2 Layout 데모** ⭐: 노드 빌더 + 3-모니터 SVG 시뮬레이션 (가장 큰 차별점, 가장 공들여야)
- **P4 Clipboard 데모**: 카드 클릭 → 실제 clipboard.writeText + toast
- 모바일 반응형 최종 점검
- 이미지/스크린샷 자산 (현재 mockup 만)
- 도메인 + Vercel 배포

### 의도적 backlog (다다음 라운드)
- Pricing 페이지 (Free / Pro)
- FAQ 섹션
- Blog
- Showcase (사용자 케이스)
- 영어 i18n
- 다크모드 토글 (현재는 OS 따라감)

---

## 6. 핵심 의사결정 로그

| 일자 | 결정 | 이유 |
|---|---|---|
| 2026-05-15 | 카테고리는 **B (Outcome-grouping)** — shadcn 처럼 atom-reference 아님 | nost = 워크플로우 도구 |
| 2026-05-15 | 태그라인 = **"모든 11초를, 1초로."** | "11to1" 공식 채택, "모든" 으로 확장 |
| 2026-05-15 | 제품명 = **nost 유지**. Antol 리네이밍 보류 | 데이터 폴더 마이그레이션 비용 |
| 2026-05-15 | Pillar 수 = **5개** (이전 6 → 5) | Context/Continuity 제외, Tabs 신설 |
| 2026-05-15 | 페이지 레이아웃 = **ReactFlow 스타일** (풀-와이드, 좌-텍스트 우-데모, 교차) | 시원시원함 |
| 2026-05-15 | Pillar 마다 **interactive demo + CTA + accordion** | "처음부터 기능 폭격하지 마라" 사용자 가이드 |
| 2026-05-15 | 랜딩 카드 mockup = **앱 WIDGET 토큰 그대로** | 다운로드 전후 동일 시각 경험 |

---

## 7. 톤 & 보이스 규칙

- **존댓말 / 평어 혼용 가능** — 짧은 hook 은 평서형 ("작업 옆에 붙는 빠른 메모"), 긴 body 는 "…합니다" 정중체
- **금지어**: ~~"발사"~~ ~~"짧게 :"~~ ~~"길게 :"~~ (앱 본체와 동일 규칙, `plans/ui-vocabulary.md` 참조)
- **동사 통일**: 같은 액션엔 같은 동사 ("실행한다" 만, "열기/돌린다" 혼용 X)
- **숫자 강조**: 정량 클레임 ("11초") 은 작은따옴표 안 씀, 본문 그대로 강조
- **이모지**: Hero 와 Pillar pill 에만. 본문에는 안 씀

---

## 8. 다음 핸드오프를 받는 사람에게

1. **먼저**: `npm install --legacy-peer-deps` → `npm run dev` 로 직접 띄워보세요. 글로 보는 것보다 한 번 굴려보는 게 빠릅니다.
2. **카피 변경 시**: `site/lib/pillars.ts` 한 파일 — 5 Pillar 전부 여기서 데이터 주도.
3. **신규 demo 추가 시**: `site/components/demos/PNNNDemo.tsx` 새 파일 → `PillarsSection.tsx` 의 `PillarDemo()` switch 에 매핑 한 줄 추가.
4. **시각 토큰 변경 시**: `site/app/globals.css` 의 `:root` 와 `@theme` 블록. 앱 본체와 일관성 깨지면 위 §4 의 SSOT 규칙 위반 — 양쪽 같이 갱신.
5. **모르면**: `plans/ssot-index.md`, `plans/checklists.md`, `walkthrough_v2.md` 가 본체 앱의 컨텍스트. 랜딩과 본체는 시각 토큰만 공유, 코드는 분리.

---

## 9. 알려진 미해결

- Hero `<h1>` 의 line-break 가 좁은 viewport 에서 "모든 11초를, 1초로." 한 줄이 깨질 수 있음 — 의도된 디자인이지만 모바일에서 검증 필요
- `[direction:rtl]` 트릭으로 좌/우 교차 — 일부 폰트의 number rendering 이미 RTL-safe 검증함
- `MemoEditDemo` 의 rAF 루프가 Fast Refresh 와 충돌해 preview 도구가 가끔 멈춤. 실제 브라우저에선 정상.
- Tailwind 4 는 beta. stable 나오면 버전 고정 필요.
