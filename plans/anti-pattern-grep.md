# Anti-pattern Grep Recipes — 자동 점검 명령어 모음

> 코드 베이스에 반복적으로 새어 들어오는 anti-pattern들을 grep 1줄로 잡아내기.
> 작성: 2026-05-14. CI 자동화 전 단계 — 수동 실행. 추후 `scripts/check-ssot.ps1` 로 묶일 후보.
>
> **사용법**: PR / 큰 변경 후 본 문서를 위에서 아래로 훑으며 각 grep 명령을 실행. 결과가 empty 이면 ✅, 매치가 있으면 검토 후 fix or 정당화.

---

## §1. CSS / 디자인 시스템

### 1.1 `var(--accent)` fallback 사용 (금지)

`var(--accent, #6366f1)` 형태 — 사용자 강조색 무력화됨.

```bash
grep -rEn 'var\(--(accent|accent-dim)[ ]*,' frontend/src
```

**Expected**: empty
**위반 시**: 해당 라인에서 fallback 제거. CSS 변수가 항상 정의되어 있다고 신뢰.

### 1.2 인라인 색 (hex hardcode)

`#xxxxxx` 직접 사용 — `widgets/widgetTokens.ts` 우회.

```bash
# 명확히 hex 색만 (디자인 토큰이 아닌 raw)
grep -rEn "color:[ ]*'#[0-9a-fA-F]{6}'" frontend/src/components
grep -rEn "background:[ ]*'#[0-9a-fA-F]{6}'" frontend/src/components
```

**Expected**: empty 또는 `var(--accent)` 변수 정의 위치 만
**예외**: NodePanel/DeckPanel 같이 카테고리 색 (DECK_COLOR = '#f97316') 은 SSOT 화된 const — OK

### 1.3 다이얼로그 푸터 좌우 padding 부족 (사용자 반복 피드백)

`padding: 'Npx 0'` 또는 `'Npx 4px'` / `'Npx 8px'` (의도된 icon-only 버튼 제외).

```bash
# 좌우 0px 검출
grep -rEn "padding:[ ]*'[0-9]+px[ ]+0'" frontend/src/components
# 좌우 4px 이하 검출
grep -rEn "padding:[ ]*'[0-9]+px[ ]+[1-4]px'" frontend/src/components
```

**Expected**: empty (또는 icon-only / 작은 토글 한정)
**Fix**: 좌우 ≥ 14px. shadcn `<Button>` 사용 또는 인라인 시 `'Npx 14px'` 이상.

---

## §2. 한국어 어휘 (UI Vocabulary)

### 2.1 금지어 ("발사" 등)

```bash
grep -rn '발사\|짧게 :\|길게 :' frontend/src
```

**Expected**: empty (또는 주석 안)
**Fix**: `plans/ui-vocabulary.md` §2 표 따라 표준 동사로 교체.

### 2.2 비격식 종결 ("해주세요" / "해요" 단정 표현)

```bash
grep -rEn "해주세요|해주십시오" frontend/src
```

**Expected**: minimal — body 텍스트만 OK, label / 버튼 텍스트엔 X
**Fix**: 명사형 또는 동사형 ("저장" / "닫기")

### 2.3 영어 잔재 (UI 라벨)

```bash
# Title 속성에 영어
grep -rEn "title='[A-Z]" frontend/src/components | grep -v "'Ctrl\|'Alt\|'Shift\|'Enter\|'ESC\|'Tab\|'Cmd"
```

**Expected**: 단축키 표기 (`Ctrl+Z`, `Alt+4`) 만
**Fix**: 한국어 동사로 (`plans/ui-vocabulary.md` §2)

---

## §3. SSOT 위반

### 3.1 컴포넌트 내부 mode 체크 (ad-hoc)

`if (activeMode !== 'normal') return;` 같은 패턴 — `canPerform()` SSOT 우회.

```bash
grep -rEn "if[ ]*\([ ]*activeMode[ ]*!==" frontend/src/components
grep -rEn "if[ ]*\([ ]*activeMode[ ]*===" frontend/src/components
```

**Expected**: empty (대신 `conflictPolicy.ts::canPerform()` 사용)
**Fix**: `plans/conflict-avoidance-policy.md` §5 패턴으로 마이그레이션
**예외**: `App.tsx` 내부 mode-aware 렌더 로직 (예: clean 모드 시 추가 UI) 은 OK — "render branching" 과 "trigger blocking" 구분

### 3.2 `setZoomFactor` 직접 호출 (윈도우 크기 SSOT 우회)

```bash
grep -rn 'setZoomFactor' main.js frontend/src preload.js
```

**Expected**: `did-finish-load` 의 강제 1.0 리셋 한 줄만 (`main.js`)
**Fix**: 크기는 `windowSizePct` 만 사용

### 3.3 컴포넌트마다 `keydown` 직접 (escapeStack 우회)

```bash
# escapeStack 우회 의심
grep -rn "addEventListener('keydown'" frontend/src/components frontend/src/widgets
grep -rn "addEventListener(\"keydown\"" frontend/src/components frontend/src/widgets
```

**Expected**: ItemDialog의 글로벌 keydown (Ctrl+Enter 등) 한 곳만 정당 — 나머지는 `pushEscape` 사용
**Fix**: `plans/escape-stack-audit.md` 참조

### 3.4 IPC 핸들러 누락 (4-file 룰)

새 IPC `'foo-bar'` 가 main.js 에만 있고 preload 또는 electronBridge 에 누락된 경우:

```bash
# main.js에 등록된 채널 목록
grep -E "ipcMain\.handle\(|ipcMain\.on\(" main.js | grep -oE "'[a-z-]+'" | sort -u > /tmp/main-channels.txt

# preload.js에 노출된 채널
grep -oE "ipcRenderer\.(invoke|send|on)\('[a-z-]+'" preload.js | grep -oE "'[a-z-]+'" | sort -u > /tmp/preload-channels.txt

# main에만 있고 preload엔 없는 채널
comm -23 /tmp/main-channels.txt /tmp/preload-channels.txt
```

**Expected**: empty 또는 main-내부 전용 (rare)
**Fix**: `plans/checklists.md` §2 참조 — preload.js + electronBridge.ts 동기화

### 3.5 `localStorage` 직접 사용 (4-way mirror 안티패턴)

```bash
grep -rn "localStorage\." frontend/src | grep -v "ssot-index\|migrateData\|comment"
```

**Expected**: useAppData migrate / hydration 한정. 그 외 컴포넌트가 localStorage 직접 읽기/쓰기 금지.
**Fix**: `useAppData` 통과 (electron-store SSOT)

---

## §4. TypeScript / 코드 위생

### 4.1 `any` 남용

```bash
grep -rEn ":\s*any[\s,;)\}]" frontend/src --include="*.tsx" --include="*.ts"
```

**Expected**: 의도된 escape (dnd-kit `listeners` / sensor options) 만
**Fix**: 가능한 unknown / 구체 타입으로 narrow

### 4.2 `@ts-ignore` / `@ts-expect-error`

```bash
grep -rEn '@ts-(ignore|expect-error|nocheck)' frontend/src
```

**Expected**: empty 또는 주석으로 정당화 명시
**Fix**: 진짜 root cause 해결

### 4.3 `console.log` 잔재 (production 빌드에 leak)

```bash
grep -rEn "console\.(log|debug)\(" frontend/src --include="*.tsx" --include="*.ts" | grep -v "createLogger\|logger\|log\.debug"
```

**Expected**: empty 또는 `createLogger()` 통과한 호출만
**Fix**: `lib/logger.ts::createLogger('Module')` 사용 (production 자동 트리쉐이킹)

---

## §5. 자동 업데이트 / 배포

### 5.1 `package.json::version` 과 latest.yml 일치

배포 후 검증:

```bash
PKG_VERSION=$(cat package.json | python -c "import json,sys; print(json.load(sys.stdin)['version'])")
YML_VERSION=$(curl -s "https://api.github.com/repos/HwigwanJi/nost/releases/latest" | python -c "import json,sys; r=json.load(sys.stdin); print(r['tag_name'].lstrip('v'))")
echo "package.json: $PKG_VERSION"
echo "GitHub latest: $YML_VERSION"
test "$PKG_VERSION" = "$YML_VERSION" && echo "✅ match" || echo "❌ mismatch"
```

### 5.2 Asset 파일명 하이픈 사용

```bash
# release/ 내 공백 포함 파일 (release-runbook §5 에서 변환되어야)
ls "release/" 2>&1 | grep " "
```

**Expected** (배포 직전): nost 시리즈 .exe 파일 — 빌드 산출물 자체는 공백 OK
**검증**: GitHub release 페이지 asset 이름은 하이픈

### 5.3 `frontend/package.json` 에 version 잔재

```bash
cat frontend/package.json | grep version
```

**Expected**: 없음 또는 `"version": "0.0.0"` (vite 가 root 에서 주입)
**Fix**: 절대 root version 과 sync 시도 X

---

## §6. PowerShell / DPI

### 6.1 좌표 직접 곱셈 (DPI SSOT 위반)

PS 안에 `scaleFactor` 곱한 좌표 — `_Position.ps1` 우회 의심:

```bash
grep -rEn 'scaleFactor[ ]*\*|\*[ ]*scaleFactor' ps-scripts main.js
```

**Expected**: minimal (정당한 use case 만)
**Fix**: 모든 좌표는 `_Position.ps1::Get-NativeWorkArea` + `Move-WindowToRect` 통과

### 6.2 인라인 PS 스크립트 (보안)

PS 스크립트 문자열 인터폴레이션 (injection 위험):

```bash
grep -rEn 'exec\(.*\$\{|exec\(`' main.js
```

**Expected**: empty
**Fix**: 인자는 환경변수로 (`env: { QL_FOO: value }`)

---

## §7. React / 성능

### 7.1 inline ref callback (dnd-kit 호환성)

매 렌더 새 함수 → setNodeRef(null) ↔ setNodeRef(node) 사이클로 drag 죽임:

```bash
grep -rEn 'ref=\{node =>' frontend/src/components
grep -rEn 'ref=\{\(node\) =>' frontend/src/components
```

**Expected**: empty 또는 `useCallback` 으로 메모이제이션됨
**Fix**: 
```tsx
const combinedRef = useCallback((node) => { setNodeRef(node); elRef.current = node; }, [setNodeRef]);
```

### 7.2 useEffect 빈 deps + state 사용 (stale closure)

```bash
# 휴리스틱 검출 (false positive 많음 — 수동 검토)
grep -rEnB2 "useEffect\(\(\) =>" frontend/src | grep -B2 ", \[\]\)"
```

**Expected**: refs 통한 latest 접근 패턴 사용 (`latestRef.current`)
**Fix**: useEffect 안에서 state 직접 참조 시 deps 추가 또는 ref 사용

---

## §8. 종합 점검 워크플로우

큰 변경 후 한 번에 돌리기:

```bash
#!/bin/bash
# scripts/check-ssot.sh (미래 자동화)
set -e
cd "$(dirname "$0")/.."

echo "=== §1.1 var(--accent) fallback ==="
grep -rEn 'var\(--(accent|accent-dim)[ ]*,' frontend/src && echo "❌ FOUND" || echo "✅"

echo "=== §1.3 button padding 0 ==="
grep -rEn "padding:[ ]*'[0-9]+px[ ]+0'" frontend/src/components && echo "❌" || echo "✅"

echo "=== §2.1 금지어 ==="
grep -rn '발사\|짧게 :\|길게 :' frontend/src && echo "❌" || echo "✅"

echo "=== §3.1 ad-hoc mode check ==="
grep -rEn "if[ ]*\([ ]*activeMode[ ]*!==" frontend/src/components && echo "❌" || echo "✅"

echo "=== §3.4 IPC sync ==="
grep -E "ipcMain\.handle\(|ipcMain\.on\(" main.js | grep -oE "'[a-z-]+'" | sort -u > /tmp/main-channels.txt
grep -oE "ipcRenderer\.(invoke|send|on)\('[a-z-]+'" preload.js | grep -oE "'[a-z-]+'" | sort -u > /tmp/preload-channels.txt
DIFF=$(comm -23 /tmp/main-channels.txt /tmp/preload-channels.txt)
[ -z "$DIFF" ] && echo "✅" || { echo "❌ missing in preload:"; echo "$DIFF"; }

echo "=== §5.3 frontend version leak ==="
grep version frontend/package.json && echo "❌" || echo "✅"

echo "=== §7.1 inline ref callback ==="
grep -rEn 'ref=\{node =>' frontend/src/components && echo "⚠ check useCallback" || echo "✅"

echo ""
echo "Done."
```

**저장 위치 제안**: `scripts/check-ssot.sh` 또는 `.husky/pre-commit` (자동화 시)

---

## §9. False positive 메모

다음 매치는 위반 아님 — grep 결과에 나와도 무시:

1. **`var(--accent)` 정의** in `index.css` — fallback 없이 정의된 곳은 OK
2. **`#xxxxxx` in const** — `DECK_COLOR = '#f97316'` 같이 SSOT화된 카테고리 색
3. **`localStorage` in `migrateData`** — fallback 디스크 SSOT (electron-store 미설치 환경)
4. **`any` in dnd-kit listeners** — 라이브러리 내부 타입 escape, 의도됨
5. **`@ts-expect-error` with comment** — 정당화 주석 있으면 OK

---

## §10. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-14 | 초안 — v1.3.34 작업 중 발견한 9개 패턴 카탈로그화 |
