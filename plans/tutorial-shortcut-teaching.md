# 튜토리얼 단축키 교육 — 기획

## Context

현재 nost 튜토리얼의 단축키 취급은 **2급 시민**:
- `basics.search.focus` — body에서 `/` 한 줄 언급
- `basics.presets.switch-2` — Tab 키는 **fallbackHint** (15초 무반응 후에만 노출)
- `cards.clipboard.copy-url` — `Ctrl+C` 텍스트 언급
- 그 외 ⌘/Ctrl+Enter, Arrow keys, Esc, Alt+4 글로벌 호출 — 튜토리얼에 없음

문제 케이스: 사용자가 직접 지목한 **프리셋 Tab 키**. 프리셋 전환은 Tab이 더 빠른 1급 진입점인데, 튜토리얼은 1·2·3 클릭만 가르치고 Tab은 fallback으로 묻혀 있음. 시각적으로 "어떤 키를 누르라"는 신호가 없음.

목표: 단축키를 1급 시민으로 끌어올림. 시각 패턴 + 스키마 + 어디에 어떻게 끼워넣을지 결정.

---

## §1. nost의 단축키 surface (전수)

| 키 | 동작 | 구현 위치 | 현재 튜토리얼 |
|---|---|---|---|
| **Alt+4** (default, 사용자 변경 가능) | nost 호출/숨김 | main.js:618 globalShortcut | 없음 (system.shortcut-toggle 신규 예정) |
| **Tab** | 활성 프리셋 다음 (1→2→3→1) | App.tsx:1671 | fallbackHint만 |
| **`/`** | 검색창 포커스 + 슬래시 명령 모드 | search input + handleSearchKeyDown | basics.search 본문 텍스트 |
| **Esc** | 다이얼로그 닫기 / 튜토리얼 일시정지 / 추천 패널 닫기 | useEscapeKey 훅 + QuestRunner | 없음 |
| **Ctrl/⌘+Enter** | 카드 다이얼로그에서 어느 페이즈에서나 즉시 저장 | ItemDialog.tsx:751 | 본문에 한 줄 언급 (cards.dialog) |
| **←/→** | 카드 다이얼로그 페이즈 이동 | ItemDialog.tsx:752 | 없음 |
| **Enter** | 다이얼로그 last phase 저장 / 입력 commit | ItemDialog.tsx:746 | 없음 |
| **Ctrl+S** | 메모 TTL 갱신 / 저장 | MemoEditor | 없음 |
| **Ctrl+M** | 메모 미리보기 토글 | MemoEditor | 없음 |
| **Ctrl+C** | 클립보드 복사 (외부 동작) | OS | gesture: keyboard만 |
| 사용자 정의 노드 그룹 단축키 | 노드 그룹 동시 실행 | 사용자 할당 | advanced.nodegroup body 언급 |

**1급 후보** (튜토리얼에 강조해야): Alt+4, Tab, `/`, Esc, Ctrl+Enter
**2급** (안전망/생산성 향상): ←/→, Ctrl+S, Ctrl+M, Ctrl+C
**3급** (사용자 정의): 노드 그룹 단축키, 글로벌 호출 변경

---

## §2. 시각 패턴 — 3가지

### Pattern A — Shortcut-first (단축키가 주, 클릭은 보조)

**언제**: 동일 동작에 키와 버튼 둘 다 있는데 키가 더 빠른 경우 (Tab, `/`, Esc).

**렌더**:
- Gesture badge: `'keyboard'`
- 새 **key-cap chip** (popover 헤더 영역에 gesture 옆): `[ Tab ]` 모양 styled <kbd>
- Spotlight: 버튼 등가물 (preset-toggle, search-input)에 그대로 (선택사항)
- Body: "Tab 키를 누르거나 X를 클릭"

```
┌─────────────────────────────────────┐
│ [⌨ 키보드] [ Tab ]         3 / 5    │
├─────────────────────────────────────┤
│  프리셋 전환                         │
│  Tab 키를 누르거나 1·2·3 토글에서    │
│  다른 숫자를 클릭해보세요.           │
└─────────────────────────────────────┘
```

### Pattern B — Shortcut-secondary hint (클릭이 주, 단축키는 팁)

**언제**: 클릭이 자연스러운 진입점인데 파워유저용 단축키도 있는 경우 (⌘+Enter 저장, Ctrl+S TTL 갱신).

**렌더**:
- 기존 step 그대로 (gesture: 'left-click', spotlight: 버튼)
- popover body 아래 작은 한 줄: `💡 빠른 길: [ Ctrl ] + [ Enter ]`
- 절대 step을 분리하지 않음 — 인지 부담 추가 X

### Pattern C — Shortcut-only (DOM 타겟 없음)

**언제**: 글로벌 단축키 (Alt+4 호출/숨김), Esc 일시정지.

**렌더**:
- Spotlight 없음 (full-dim 상태)
- popover 한가운데 큰 key-cap chip
- Body: "Alt + 4를 눌러보세요. nost가 사라졌다가 다시 떠요."

```
┌─────────────────────────────────────┐
│ [⌨ 키보드]                  2 / 4    │
├─────────────────────────────────────┤
│  nost 호출하기                       │
│                                      │
│       [ Alt ] + [ 4 ]                │
│                                      │
│  지금 이 키를 누르면 nost가 사라     │
│  졌다가, 다시 누르면 같은 자리에     │
│  돌아와요.                           │
└─────────────────────────────────────┘
```

---

## §3. 스키마 변경 (최소)

`QuestStep`에 1개 옵션 필드 추가:

```ts
interface QuestStep {
  ...existing
  /** Keyboard shortcut(s) for this step's action. Rendered as
   *  styled key caps in the popover. Single combo as string[],
   *  or array of alternative combos for "either-or".
   *  Examples:
   *    ['Tab']               → single key
   *    ['Ctrl', 'Enter']     → combo
   *    [['Ctrl','C'], ['⌘','C']]  → mac/win alternatives
   */
  shortcut?: string[] | string[][];
}
```

Pattern A/C: 모두 이 필드로 trigger.
Pattern B: 같은 필드 + 새 boolean `shortcutAsHint?: boolean` (작게 렌더). **OR** 그냥 fallbackHint를 styled `<kbd>` markdown으로 처리하고 새 필드는 안 추가.

→ **결정 필요**: Pattern B를 같은 필드의 placement variant로 할지, fallbackHint 활용으로 할지.

---

## §4. QuestRunner 렌더링 변경

`QuestRunner.tsx` popover header 영역 (line 246~):

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
  {step.gesture && <GestureBadge kind={step.gesture} />}
  {step.shortcut && <ShortcutChips combo={step.shortcut} />}
</div>
```

`<ShortcutChips>`: `<kbd>` 스타일 (theme accent border, monospace, 28px height). Pattern C용 `large` variant — 아래 본문 위에 큰 사이즈로.

CSS:
```css
.kbd {
  display: inline-flex; align-items: center;
  padding: 2px 8px; min-width: 24px; height: 22px;
  border-radius: 4px;
  border: 1px solid var(--border-rgba);
  border-bottom: 2px solid var(--border-rgba);
  background: var(--surface);
  color: var(--text-color);
  font: 600 11px ui-monospace, monospace;
}
```

조합은 `+` separator로 시각적으로 분리.

---

## §5. 기존 흐름과의 자연스러운 배치

각 quest별 적용안 (Pattern 라벨 + 변경):

### basics
- **basics.search.focus** — Pattern A. shortcut: `['/']`. body 변경: "검색창을 클릭하거나 키보드 `/`를 누르면 입력 모드".
- **basics.presets.switch-2** — Pattern A. shortcut: `['Tab']`. title: "프리셋 전환 — Tab 또는 1·2·3 클릭". body: "Tab을 한 번 누르거나 상단 토글의 다른 숫자를 클릭". gesture: `'keyboard'` (Tab을 1급으로 격상). spotlight: `'preset-toggle'` 유지.
- **basics.presets.switch-back** — 같은 패턴, "다시 1번으로" → "Tab을 한 번 더 (또는 1 클릭)".

### cards
- **cards.clipboard.copy-url** — 이미 gesture keyboard. shortcut: `['Ctrl', 'C']` 추가 (외부 동작이라 큰 의미는 없지만 시각 일관성).
- **cards.memo.copy** — 같음.
- **cards.dialog** — 새 step 추가? 아니면 기존 phase-flow에 Pattern B로 ⌘+Enter 힌트 추가. **권장: 후자** (step 늘리지 않음).

### system (신규 카테고리)
- **system.shortcut-toggle** — Pattern C. shortcut: `['Alt', '4']` (default). spotlight 없음. step 시퀀스: intro → "지금 눌러보세요" (advance: 사용자가 키를 눌러 창이 hide→show 일어나면 자동 — 새 이벤트 `app-toggled` 필요할 수 있음) → wrap.
- **system.shortcut-custom** — Pattern A 변형. 설정 화면의 단축키 input을 spotlight, shortcut chip은 현재 설정값 표시. 첫 step에서 "그대로 두기" 분기.

### 안 건드릴 것
- 추천 패널 Esc 닫기, 메모 Ctrl+S/Ctrl+M, ←/→ phase 이동 — 발견 가능성 OK + 우선순위 낮음. v2 보강 항목.

---

## §6. 자동전진과 단축키

핵심 호환성 체크:

| 단축키 | trigger 이벤트 | OK? |
|---|---|---|
| Tab → preset switch | `preset-switched` (이미 있음, App.tsx:1673에서 fire) | ✓ |
| `/` → search focus | `search-focused` (이미 있음, focus 이벤트로 fire) | ✓ |
| Ctrl+Enter → save | `item-added` (저장 시 fire) | ✓ |
| Alt+4 → toggle nost | **새 이벤트 필요** `app-toggled` (main.js의 toggleMainWindow에서 IPC로 send) | 추가 필요 |
| Ctrl+C (외부) | 게이트웨이 배너 떴을 때 → 다음 step에서 자연 전진 | ✓ |
| Esc → pause tutorial | QuestRunner의 ESC 핸들러가 onPause | ✓ (자동전진 무관) |

**system.shortcut-toggle을 만들려면** main process에서 호출/숨김 시 webContents.send로 'app-toggled' 보내고, frontend에서 트리거로 변환.

---

## §7. 작업 순서 (제안)

1. `<ShortcutChips>` + CSS 추가 + 스키마에 `shortcut` 필드 (1 commit)
2. QuestRunner 렌더링 분기 (Pattern A/C) (1 commit)
3. basics.search / basics.presets 두 개 quest 적용 + 검증 (1 commit)
4. cards.clipboard / cards.memo (1 commit)
5. (system 카테고리 신규 시) `app-toggled` 이벤트 + system.shortcut-toggle 신규 quest (별도 PR — system 카테고리 전체 작업의 일부)

---

## §8. 결정 필요

- **D1**: Pattern B (단축키 보조 힌트) — 같은 `shortcut` 필드의 placement variant vs fallbackHint 활용? **권장: variant** (`shortcutAsHint?: boolean`) — 의미가 fallbackHint와 다름 (fallbackHint = 막혔을 때, shortcut = 항상 가능한 더 빠른 길)
- **D2**: shortcut 필드를 `string[] | string[][]` 둘 다 받게 할지, mac/win 분기는 OS 감지로 자동 처리할지? **권장: 자동** — `['Ctrl', 'C']`만 받고 mac에서는 ⌘로 자동 변환 (Electron의 process.platform).
- **D3**: system.shortcut-toggle을 이번 round에 같이 만들지, 단축키 시각 인프라만 먼저 깔지? **권장: 인프라만 먼저**, system 카테고리는 별도 PR.
- **D4**: Pattern C (큰 가운데 chip) 채택 여부 — Pattern A로도 충분할지? **권장: A만 우선**, C는 system 카테고리 들어갈 때 재논의.

---

## §9. 명시적 비-목표

- 단축키 cheat sheet UI (전체 단축키 목록 화면) — 다른 surface 작업
- 사용자 단축키 충돌 검사 — system.shortcut-custom 작업 시
- platform-specific 키 (Linux 등) — Windows/Mac만 우선
