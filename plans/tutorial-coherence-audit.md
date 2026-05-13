# 튜토리얼 정합성 감사 — 자동 생성 표

> `scripts/audit-quests.mjs` 출력. C1/C4/C5는 코드가 결정,
> C2/C3/C6/B1-B4는 사람이 채울 빈칸(`?`).
> 갱신 시 `node scripts/audit-quests.mjs > plans/tutorial-coherence-audit.md` 권장.

## `layout.cardmove` — 카드 이동하기

**목표**: 카드를 우클릭 드래그로 다른 위치/스페이스로 옮길 수 있다

**현재 summary**: 우클릭으로 카드를 잡아 다른 자리로

**prereqs**: basics.cards

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="카드 이동하기" / summary="우클릭으로 카드를 잡아 다른 자리로" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=3 |
| B5 prereqs 실재 | ✓ | basics.cards |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| try | right-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**: 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `layout.spacereorder` — 스페이스 순서 바꾸기

**목표**: 스페이스 헤더를 좌클릭 드래그로 위·아래로 옮길 수 있다

**현재 summary**: 스페이스 헤더 좌클릭 드래그로 위·아래 이동

**prereqs**: basics.spaces

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="스페이스 순서 바꾸기" / summary="스페이스 헤더 좌클릭 드래그로 위·아래 이동" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=3 |
| B5 prereqs 실재 | ✓ | basics.spaces |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| try | left-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**: 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `layout.tile` — 타일링 알아보기

**목표**: 사이드바 노드 모드에서 카드 2-3개를 묶어 노드 그룹을 만들 수 있다

**현재 summary**: 여러 카드를 한 번에 정렬해서 실행

**prereqs**: basics.cards

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="타일링 알아보기" / summary="여러 카드를 한 번에 정렬해서 실행" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=5 |
| B5 prereqs 실재 | ✓ | basics.cards |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| sidebar-node | left-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| pick-cards | left-click | event | ✓ | ? | ? | ✓ | ✗ | ? |
| launch | — | next-button | ? | ? | ? | ? | ? | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- pick-cards: action step에 fallbackHint 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `advanced.floating` — 플로팅 뱃지 만들기

**목표**: 카드 우클릭 → "플로팅으로"로 화면 상주 뱃지를 만들 수 있다

**현재 summary**: 카드를 nost 밖으로 — 화면 어디든 떠있는 뱃지로

**prereqs**: basics.cards

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="플로팅 뱃지 만들기" / summary="카드를 nost 밖으로 — 화면 어디든 떠있는 뱃지로" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=4 |
| B5 prereqs 실재 | ✓ | basics.cards |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| try | right-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| observe | — | next-button | ? | ? | ? | ? | ? | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**: 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `advanced.nodegroup` — 노드 그룹 (한 키 다중 실행)

**목표**: 노드 그룹에 단축키를 할당해 묶인 카드들을 동시에 실행할 수 있다

**현재 summary**: 여러 카드를 묶어 단축키 한 번에 실행

**prereqs**: layout.tile

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="노드 그룹 (한 키 다중 실행)" / summary="여러 카드를 묶어 단축키 한 번에 실행" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=5 |
| B5 prereqs 실재 | ✓ | layout.tile |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| enter-mode | left-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| select | left-click | event | ✓ | ? | ? | ✓ | ✗ | ? |
| launch | — | next-button | ? | ? | ? | ? | ? | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- select: action step에 fallbackHint 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `advanced.preset` — 카드를 다른 프리셋으로

**목표**: 카드 다이얼로그의 프리셋 칩으로 카드를 다른 프리셋으로 이동할 수 있다 (Pro)

**현재 summary**: 카드 다이얼로그의 프리셋 토글로 cross-preset 이동

**prereqs**: basics.presets

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="카드를 다른 프리셋으로" / summary="카드 다이얼로그의 프리셋 토글로 cross-preset 이동" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=5 |
| B5 prereqs 실재 | ✓ | basics.presets |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| open-edit | right-click | event | ✓ | ? | ? | ✓ | ✗ | ? |
| phase-3 | — | next-button | ? | ? | ? | ? | ? | ? |
| pick-other | left-click | next-button | ✗ | ? | ? | ✗ | ✗ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- open-edit: action step에 fallbackHint 없음
- pick-other: 제스처(left-click)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- pick-other: action step인데 advance=next-button (event/expects/click-target 권장)
- pick-other: action step에 fallbackHint 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `widgets.music` — 음악 위젯

**목표**: 음악 위젯 카드로 재생/일시정지·트랙 이동·볼륨을 조작할 수 있다

**현재 summary**: swipe로 트랙 이동, 슬라이더로 볼륨

**prereqs**: basics.cards

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="음악 위젯" / summary="swipe로 트랙 이동, 슬라이더로 볼륨" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=6 |
| B5 prereqs 실재 | ✓ | basics.cards |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| add | left-click | expects | ✓ | ? | ? | ✓ | ✓ | ? |
| play | left-click | next-button | ✗ | ? | ? | ✗ | ✗ | ? |
| swipe | swipe | next-button | ✗ | ? | ? | ✗ | ✗ | ? |
| volume | drag | next-button | ✗ | ? | ? | ✗ | ✗ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- play: 제스처(left-click)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- play: action step인데 advance=next-button (event/expects/click-target 권장)
- play: action step에 fallbackHint 없음
- swipe: 제스처(swipe)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- swipe: action step인데 advance=next-button (event/expects/click-target 권장)
- swipe: action step에 fallbackHint 없음
- volume: 제스처(drag)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- volume: action step인데 advance=next-button (event/expects/click-target 권장)
- volume: action step에 fallbackHint 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `widgets.color` — 컬러 코드 위젯

**목표**: 컬러 위젯 카드 클릭으로 hex를 복사하고 swipe로 보색·유사색을 복사할 수 있다

**현재 summary**: 디자인 작업의 팔레트를 카드로

**prereqs**: cards.clipboard

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="컬러 코드 위젯" / summary="디자인 작업의 팔레트를 카드로" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=5 |
| B5 prereqs 실재 | ✓ | cards.clipboard |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| add | left-click | expects | ✓ | ? | ? | ✓ | ✓ | ? |
| tap | left-click | next-button | ✗ | ? | ? | ✗ | ✗ | ? |
| swipe-actions | swipe | next-button | ✗ | ? | ? | ✗ | ✗ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- tap: 제스처(left-click)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- tap: action step인데 advance=next-button (event/expects/click-target 권장)
- tap: action step에 fallbackHint 없음
- swipe-actions: 제스처(swipe)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- swipe-actions: action step인데 advance=next-button (event/expects/click-target 권장)
- swipe-actions: action step에 fallbackHint 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `widgets.memo` — 메모 위젯 + 정리 도구

**목표**: 메모 위젯 + 에디터의 정리 도구 팔레트로 마크다운을 정리할 수 있다

**현재 summary**: 에디터의 정리 도구 팔레트 활용하기

**prereqs**: basics.cards

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="메모 위젯 + 정리 도구" / summary="에디터의 정리 도구 팔레트 활용하기" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=5 |
| B5 prereqs 실재 | ✓ | basics.cards |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| add | left-click | event | ✓ | ? | ? | ✓ | ✗ | ? |
| open-editor | left-click | event | ✓ | ? | ? | ✓ | ✗ | ? |
| cleanup | left-click | next-button | ✗ | ? | ? | ✗ | ✗ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- add: action step에 fallbackHint 없음
- open-editor: action step에 fallbackHint 없음
- cleanup: 제스처(left-click)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- cleanup: action step인데 advance=next-button (event/expects/click-target 권장)
- cleanup: action step에 fallbackHint 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `basics.spaces` — 스페이스란?

**목표**: 헤더의 + 아이콘으로 스페이스를 추가하고 이름을 바꿀 수 있다

**현재 summary**: 카드를 모으는 단위 — 만들고, 이름 짓고, 정리

**prereqs**: (없음)

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="스페이스란?" / summary="카드를 모으는 단위 — 만들고, 이름 짓고, 정리" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=4 |
| B5 prereqs 실재 | ✓ | (없음) |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| add | left-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| rename | left-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**: 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `basics.cards` — 카드란?

**목표**: + 추가 다이얼로그로 URL 카드를 만들고 클릭 한 번으로 실행할 수 있다

**현재 summary**: URL · 앱 · 폴더 — 클릭 한 번에 작업 시작

**prereqs**: basics.spaces

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="카드란?" / summary="URL · 앱 · 폴더 — 클릭 한 번에 작업 시작" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=4 |
| B5 prereqs 실재 | ✓ | basics.spaces |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| add-url | left-click | expects | ✓ | ? | ? | ✓ | ✓ | ? |
| click-card | left-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**: 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `basics.presets` — 프리셋이란?

**목표**: 상단 1·2·3 토글로 독립된 작업환경 사이를 전환할 수 있다

**현재 summary**: 1·2·3 토글 — 통째로 다른 작업환경

**prereqs**: basics.spaces

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="프리셋이란?" / summary="1·2·3 토글 — 통째로 다른 작업환경" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=4 |
| B5 prereqs 실재 | ✓ | basics.spaces |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| switch-2 | keyboard | event | ✓ | ? | ? | ✓ | ✗ | ? |
| switch-back | keyboard | event | ✓ | ? | ? | ✓ | ✗ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- switch-2: action step에 fallbackHint 없음
- switch-back: action step에 fallbackHint 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `basics.search` — 빠른 검색이란?

**목표**: `/` 또는 검색창에 카드 이름을 입력해 즉시 실행할 수 있다

**현재 summary**: `/`로 모든 카드 즉시 찾기

**prereqs**: (없음)

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="빠른 검색이란?" / summary="`/`로 모든 카드 즉시 찾기" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=4 |
| B5 prereqs 실재 | ✓ | (없음) |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| focus | keyboard | event | ✓ | ? | ? | ✓ | ✗ | ? |
| try | keyboard | next-button | ✗ | ? | ? | ✗ | ✗ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- focus: action step에 fallbackHint 없음
- try: 제스처(keyboard)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- try: action step인데 advance=next-button (event/expects/click-target 권장)
- try: action step에 fallbackHint 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `cards.scan` — 스마트 스캔

**목표**: 사이드바 전구 → 추천 패널에서 현재 열린 앱·탭을 카드로 추가할 수 있다

**현재 summary**: 지금 열려있는 앱·폴더·탭을 한 번에 카드로

**prereqs**: basics.cards

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="스마트 스캔" / summary="지금 열려있는 앱·폴더·탭을 한 번에 카드로" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=4 |
| B5 prereqs 실재 | ✓ | basics.cards |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| open-panel | left-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| pick | — | expects | ? | ? | ? | ? | ? | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**: 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `cards.clipboard` — 클립보드로 빠른 추가

**목표**: URL/경로/hex를 복사한 뒤 게이트웨이 배너 버튼으로 카드를 만들 수 있다

**현재 summary**: 복사만 하면 게이트웨이가 권유

**prereqs**: basics.cards

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="클립보드로 빠른 추가" / summary="복사만 하면 게이트웨이가 권유" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=4 |
| B5 prereqs 실재 | ✓ | basics.cards |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| copy-url | keyboard | next-button | ✗ | ? | ? | ✗ | ✓ | ? |
| commit | left-click | expects | ✓ | ? | ? | ✓ | ✓ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- copy-url: 제스처(keyboard)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- copy-url: action step인데 advance=next-button (event/expects/click-target 권장)

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `cards.memo` — 메모도 카드처럼

**목표**: GPT/Notion 답변을 복사한 뒤 게이트웨이의 "메모로" 버튼으로 마크다운 메모를 만들 수 있다

**현재 summary**: GPT/Notion 답변을 메모로 — 마크다운 자동 복원

**prereqs**: cards.clipboard

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="메모도 카드처럼" / summary="GPT/Notion 답변을 메모로 — 마크다운 자동 복원" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=4 |
| B5 prereqs 실재 | ✓ | cards.clipboard |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| copy | keyboard | next-button | ✗ | ? | ? | ✗ | ✓ | ? |
| memo-action | left-click | event | ✓ | ? | ? | ✓ | ✓ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- copy: 제스처(keyboard)는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감
- copy: action step인데 advance=next-button (event/expects/click-target 권장)

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `cards.dragdrop` — 드래그 앤 드롭

**목표**: Explorer/브라우저에서 파일·URL을 nost 위로 끌어 카드를 만들 수 있다

**현재 summary**: Explorer에서 파일을 끌어다 놓기

**prereqs**: basics.cards

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="드래그 앤 드롭" / summary="Explorer에서 파일을 끌어다 놓기" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=3 |
| B5 prereqs 실재 | ✓ | basics.cards |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| try | drag | expects | ✓ | ? | ? | ✓ | ✓ | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**: 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---

## `cards.dialog` — 카드 다이얼로그 깊게

**목표**: + 추가 다이얼로그의 3-페이즈(유형→값→위치)를 알고 화면 픽 모드를 활용할 수 있다

**현재 summary**: 3-페이즈 흐름 + 화면에서 직접 고르기

**prereqs**: basics.cards

### Quest-level (B-checks)
| 항목 | 결과 | 비고 |
|---|---|---|
| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |
| B2 title/summary가 목표 표현 | ? | 현재 title="카드 다이얼로그 깊게" / summary="3-페이즈 흐름 + 화면에서 직접 고르기" |
| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |
| B4 단위 적정성 | ? | step 수=5 |
| B5 prereqs 실재 | ✓ | basics.cards |

### Step-level (C-checks)
| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| intro | — | next-button | ? | ? | ? | ? | ? | ? |
| open | left-click | event | ✓ | ? | ? | ✓ | ✗ | ? |
| phase-flow | — | next-button | ? | ? | ? | ? | ? | ? |
| screen-pick | — | next-button | ? | ? | ? | ? | ? | ? |
| wrap | — | auto-advance | ? | ? | ? | ? | ? | ? |

**자동 검출 이슈**:
- open: action step에 fallbackHint 없음

**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움

---
