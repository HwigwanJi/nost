# Free / Pro 정책 — Single Source of Truth

> 작성: 2026-05-16 (v1.3.42 + Free/Pro 조정 시점)
> 이 문서는 "어떤 기능이 Free, 어떤 게 Pro?" 의 단일 진실. 새 한도 / 새 게이트 추가 시 여기 먼저 갱신하고 → `types.ts FREE_LIMITS` + `useEntitlement.ts` + `PaywallModal.tsx` 까지 일관되게 반영.

---

## 1. 한도 / 게이트 표 (정본)

### 1.1 수량 한도 (client-side gate)

| 자원 | Free | Pro | 가드 함수 | UI 잠금 표시 |
|---|---|---|---|---|
| **프리셋** | **2** (id=1, 2) | 3 (id=3 추가) | `entitlement.canUsePreset(id)` | 탭 3 🔒 + dimmed ([`PresetToggle`](../frontend/src/components/PresetToggle.tsx)) |
| **스페이스** | **4** / preset | ∞ | `quotaChecks.space()` | 헤더 +스페이스 버튼: near→accent, full→🔒 |
| **카드** | **40** / preset (총합) | ∞ | `quotaChecks.card()` | 각 스페이스 +추가 split-button: near→accent, full→🔒 + dashed border accent |
| **노드** | 1 / preset | ∞ | `quotaChecks.node()` | (시각 표시 없음 — 클릭 시 paywall) |
| **덱** | 1 / preset | ∞ | `quotaChecks.deck()` | (시각 표시 없음) |
| **플로팅 뱃지** | **2** | ∞ | `quotaChecks.floatingBadge()` | (시각 표시 없음) |
| **위젯 카드** | **2** / preset | ∞ | `quotaChecks.widget()` | (시각 표시 없음) |
| **컨테이너 슬롯** | ❌ | ✅ | `quotaChecks.container()` | (시각 표시 없음) |

### 1.2 메모 Pro 기능 (client-side gate)

| 기능 | Free | Pro | 가드 | UI 표시 |
|---|---|---|---|---|
| **마크다운 미리보기** (Ctrl+M, 눈 아이콘) | ❌ | ✅ | `entitlement.canUseMemoMarkdownEditor()` | 자물쇠 헤더 버튼, Ctrl+M no-op + paywall |
| **마크다운 정리 도구** (markdownify / format / bullets / compact / plain) | ✅ | ✅ | `entitlement.canUseMemoMarkdownCleanup()` | (열림) — 2026-05-16 Free 전환 |
| **메모 .md 저장** | ❌ (.txt 만) | ✅ | `entitlement.canUseMemoMdExport()` | 저장 팔레트 .md 옵션: 🔒 + PRO 뱃지 + opacity 60%. 슬롯 활성도 .md 일 때 🔒 |
| **메모 ↔ 폴더 자동 sync** (Obsidian Vault 호환) | ❌ | ✅ | `entitlement.canUseMemoFolderSync()` | (실제 sync 로직 미구현 — 게이트만 깔림) |

### 1.3 서버 의존 Pro (server-side gate — 크랙 불가)

| 기능 | Free | Pro | 게이팅 방식 |
|---|---|---|---|
| **클라우드 동기화** | ❌ | ✅ | Supabase RLS (Row Level Security) — JWT 검증 없으면 row fetch 자체 차단 |
| **클라우드 백업** | ❌ | ✅ | RLS 동일 |
| **디바이스 한도** | 1 | ∞ | server-side device count check (앞으로) |
| **우선 지원** | ❌ | ✅ | (서비스 영역, 코드 게이트 없음) |

---

## 2. 핵심 코드 위치

```
frontend/src/types.ts
  ├ FREE_LIMITS              ← 한도 숫자 SSOT
  └ License / LicenseTier    ← 라이선스 데이터 타입

frontend/src/hooks/useEntitlement.ts
  ├ Entitlement (interface)  ← 가드 함수 시그너처
  ├ PRO_LIMITS               ← Pro 한도 (대부분 Infinity / true)
  ├ resolveTier()            ← 라이선스 → tier 결정 (active/trial/expired/canceled)
  └ BETA_FORCE_PRO           ← 긴급 롤백 스위치 (현재 false)

frontend/src/components/PaywallModal.tsx
  ├ PaywallReason (11 종)    ← 잠금 사유별 카피
  └ HEADLINE                  ← 카피 SSOT (한도 숫자 일치 필요)

frontend/src/App.tsx
  └ quotaChecks (line ~710)  ← 각 mutation 진입점에서 호출. paywall 자동 오픈
```

---

## 3. 새 게이트 추가 체크리스트

새 자원 추가 (예: "위젯 X 개 제한") 시:

1. **`types.ts FREE_LIMITS`** — 새 키 추가 (false / number / Infinity)
2. **`useEntitlement.ts`**:
   - `Entitlement.limits` 인터페이스에 키 추가
   - `PRO_LIMITS` 에 Pro 값 (보통 Infinity / true)
   - `Entitlement` 가드 함수 시그너처 + 구현 추가 (예: `canAddX(n)` 또는 `canUseX()`)
3. **`App.tsx quotaChecks`** — wrapper 추가 (paywall 자동 오픈):
   ```ts
   x: () => {
     if (entitlement.canX(currentCount)) return true;
     openPaywall('x-limit');
     return false;
   },
   ```
4. **`PaywallModal.tsx`**:
   - `PaywallReason` union 에 `'x-limit'` 추가
   - `HEADLINE` 에 카피 추가 (icon + title + body)
5. **mutation 호출 site** — `if (!quotaChecks.x()) return;` 가드 추가
6. **(선택) UI 시각 표시** — 한도 도달 시 버튼에 🔒 + dimmed
7. **이 문서 §1 표** — 새 행 추가

---

## 4. 다운그레이드 UX 정책

**Pro → Free 전환 (구독 만료/해지)**:
- 데이터 **삭제하지 않음** — 한도 초과 자원은 그대로 유지
- 새로 추가 시도만 paywall 로 차단 (read-only 효과)
- **`App.tsx prevTierRef` useEffect** 가 같은 세션 내 tier 전환 감지 → 한 번만 토스트:
  - "Pro 결제 기간이 끝났어요 / 체험 만료 / 구독 해지" 사유 분기
  - "기존 카드는 그대로 살아있습니다" 안심 카피
  - [업그레이드] 액션 → `openPaywall('generic')`
- 첫 boot (prev=undefined) 에는 토스트 안 뜸 — 시끄러움 방지

**프리셋 잠긴 경우** (3 에 데이터 있는 Pro 가 Free 가 됐을 때):
- 프리셋 3 탭 자물쇠로 잠김. 데이터는 그대로 (`useAppData` 에 살아있음)
- 클릭하면 paywall — 데이터 조회 불가, 단 삭제도 안 됨
- Pro 재구독 시 자동 복원

---

## 5. 결정 로그

| 일자 | 변경 | 이유 |
|---|---|---|
| 2026-05-15 | 초안 — 카드 16, 프리셋 1, 뱃지 1, 위젯 1, 메모 마크다운 풀-Pro | 첫 Free/Pro 라인. `BETA_FORCE_PRO` flip |
| 2026-05-16 | **카드 16→40, 프리셋 1→2, 뱃지 1→2, 위젯 1→2** | 너그러운 Free 로 일상 사용 가능. 결제 압박은 클라우드 sync 와 정밀 기능으로 |
| 2026-05-16 | **메모 정리도구 → Free** | 텍스트 변환 도구는 미리보기 없이도 단독 유용. preview 만 Pro 유지 |

---

## 6. 아직 안 한 것 (구현 대기)

- **Pro 결제 인프라** — Supabase Function (license verify endpoint) + Stripe / Toss webhook
- **License 발급 / 검증 흐름** — JWT 서명 (RSA), 디바이스 fingerprint 활성화, offline grace (7일)
- **PaywallModal "Pro로 업그레이드" 클릭** — 현재 `window.dispatchEvent('nost:start-checkout')` 만 fire. 실제 결제 페이지 없음
- **무료 체험 (trial) 자동 발급** — `newTrialLicense()` 함수만 있고 호출처 없음 (첫 Pro 게이트 hit 시 자동 시작 예정)
- **튜토리얼 Pro 뱃지** — quest 들에 Pro 표시 + Free 사용자 "구경하기" 모드
- **메모 폴더 자동 sync 실제 구현** (게이트만 있음, 실제 sync 로직 미작성)

---

## 7. 긴급 롤백 스위치

문제 발생 시 (예: 결제 outage, license server 다운) **`useEntitlement.ts` 의 `BETA_FORCE_PRO`** 한 줄을 `true` 로 flip → 즉시 모든 사용자 Pro. 다음 release 로 회복 시까지 일시 조치.

원래 `BETA_FORCE_PRO = true` 였던 베타 시기 (v1.3.x 초기) 에 사용되던 메커니즘 그대로 재사용.
