#!/usr/bin/env node
/**
 * Tutorial coherence audit — auto-fillable rows.
 *
 * Reads frontend/src/tutorial/quests/*.ts as text, extracts each
 * Quest's metadata + steps, and prints a markdown audit table per
 * quest. Determinable checks (C1/C4/C5, B5) are filled by code;
 * qualitative checks (C2/C3/C6, B1-B4) are left blank with `?`
 * for the human reviewer to fill in `plans/tutorial-coherence-audit.md`.
 *
 * See plans/tutorial-goals.md (§2) for the per-quest goal SSOT and
 * `<bubbly-mapping-rainbow>` plan for the C1-C6 / B1-B5 criteria
 * definitions.
 *
 * Usage:
 *   node scripts/audit-quests.mjs                  # all quests
 *   node scripts/audit-quests.mjs basics           # category filter
 *   node scripts/audit-quests.mjs basics.cards     # single quest
 *   node scripts/audit-quests.mjs --json           # machine-readable
 *
 * Limitation: regex-based extraction. If the quest files change
 * shape (multi-line bodies, nested template literals, etc.) the
 * extractor may break — it errs on the side of skipping rather
 * than misreporting.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTS_DIR = join(__dirname, '..', 'frontend', 'src', 'tutorial', 'quests');

// ─── Goals SSOT (mirror of plans/tutorial-goals.md §2) ──────────
// Kept here so the audit table can show the goal next to each quest
// without re-parsing markdown. Keep in sync manually.
const QUEST_GOALS = {
  'basics.spaces':       '헤더의 + 아이콘으로 스페이스를 추가하고 이름을 바꿀 수 있다',
  'basics.cards':        '+ 추가 다이얼로그로 URL 카드를 만들고 클릭 한 번으로 실행할 수 있다',
  'basics.presets':      '상단 1·2·3 토글로 독립된 작업환경 사이를 전환할 수 있다',
  'basics.search':       '`/` 또는 검색창에 카드 이름을 입력해 즉시 실행할 수 있다',
  'cards.scan':          '사이드바 전구 → 추천 패널에서 현재 열린 앱·탭을 카드로 추가할 수 있다',
  'cards.clipboard':     'URL/경로/hex를 복사한 뒤 게이트웨이 배너 버튼으로 카드를 만들 수 있다',
  'cards.memo':          'GPT/Notion 답변을 복사한 뒤 게이트웨이의 "메모로" 버튼으로 마크다운 메모를 만들 수 있다',
  'cards.dragdrop':      'Explorer/브라우저에서 파일·URL을 nost 위로 끌어 카드를 만들 수 있다',
  'cards.dialog':        '+ 추가 다이얼로그의 3-페이즈(유형→값→위치)를 알고 화면 픽 모드를 활용할 수 있다',
  'layout.cardmove':     '카드를 우클릭 드래그로 다른 위치/스페이스로 옮길 수 있다',
  'layout.spacereorder': '스페이스 헤더를 좌클릭 드래그로 위·아래로 옮길 수 있다',
  'layout.tile':         '사이드바 노드 모드에서 카드 2-3개를 묶어 노드 그룹을 만들 수 있다',
  'advanced.floating':   '카드 우클릭 → "플로팅으로"로 화면 상주 뱃지를 만들 수 있다',
  'advanced.nodegroup':  '노드 그룹에 단축키를 할당해 묶인 카드들을 동시에 실행할 수 있다',
  'advanced.preset':     '카드 다이얼로그의 프리셋 칩으로 카드를 다른 프리셋으로 이동할 수 있다 (Pro)',
  'widgets.music':       '음악 위젯 카드로 재생/일시정지·트랙 이동·볼륨을 조작할 수 있다',
  'widgets.color':       '컬러 위젯 카드 클릭으로 hex를 복사하고 swipe로 보색·유사색을 복사할 수 있다',
  'widgets.memo':        '메모 위젯 + 에디터의 정리 도구 팔레트로 마크다운을 정리할 수 있다',
};

// ─── Extraction (regex) ─────────────────────────────────────────

function listQuestFiles() {
  return readdirSync(QUESTS_DIR)
    .filter(f => f.endsWith('.ts'))
    .map(f => join(QUESTS_DIR, f));
}

/**
 * Find each `const NAME: Quest = { ... };` block and return its
 * inner body as text. Brace-counting because object literals in
 * the body include nested `{}`.
 */
function extractQuestBlocks(src) {
  const blocks = [];
  const startRe = /const\s+\w+\s*:\s*Quest\s*=\s*\{/g;
  let m;
  while ((m = startRe.exec(src)) !== null) {
    const open = m.index + m[0].length - 1; // position of `{`
    const end = matchBrace(src, open);
    if (end < 0) continue;
    blocks.push(src.slice(open + 1, end));
  }
  return blocks;
}

/** Given index of `{`, return index of matching `}`. -1 if none.
 *  Honours single/double/template strings + line comments. */
function matchBrace(src, start) {
  let depth = 0;
  let i = start;
  let str = null; // null | "'" | '"' | '`'
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) { str = null; }
    } else {
      if (c === '/' && next === '/') {
        const nl = src.indexOf('\n', i);
        i = nl < 0 ? src.length : nl;
        continue;
      }
      if (c === '/' && next === '*') {
        const close = src.indexOf('*/', i + 2);
        i = close < 0 ? src.length : close + 1;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') str = c;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    i++;
  }
  return -1;
}

/** Pull a top-level scalar field's raw text from a quest body. */
function field(body, name) {
  // matches: <name>: '...' OR "..." OR `...`
  const re = new RegExp(`(?:^|\\s|,)${name}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`, 'm');
  const m = re.exec(body);
  return m ? m[2] : null;
}

/** Pull steps array — find `steps: [ ... ]` and split by top-level
 *  step object boundaries. */
function extractSteps(body) {
  const idx = body.search(/steps\s*:\s*\[/);
  if (idx < 0) return [];
  const open = body.indexOf('[', idx);
  const close = matchBracket(body, open);
  if (close < 0) return [];
  const arr = body.slice(open + 1, close);

  // Split into individual step object bodies.
  const stepBodies = [];
  let i = 0;
  while (i < arr.length) {
    // skip whitespace + comma
    while (i < arr.length && /[\s,]/.test(arr[i])) i++;
    if (i >= arr.length) break;
    if (arr[i] !== '{') break;
    const end = matchBrace(arr, i);
    if (end < 0) break;
    stepBodies.push(arr.slice(i + 1, end));
    i = end + 1;
  }

  return stepBodies.map(parseStep);
}

function matchBracket(src, start) {
  let depth = 0;
  let i = start;
  let str = null;
  while (i < src.length) {
    const c = src[i];
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) str = null;
    } else {
      if (c === "'" || c === '"' || c === '`') str = c;
      else if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) return i;
      }
    }
    i++;
  }
  return -1;
}

function parseStep(body) {
  const id = field(body, 'id');
  const title = field(body, 'title');
  const text = field(body, 'body');
  const gesture = field(body, 'gesture');
  const fallbackHint = field(body, 'fallbackHint');

  // spotlight: string OR ['a', 'b']
  let spotlight = field(body, 'spotlight');
  if (!spotlight) {
    const arrMatch = /spotlight\s*:\s*\[([^\]]*)\]/.exec(body);
    if (arrMatch) {
      spotlight = arrMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean);
    }
  }

  // advance.kind
  const advanceKindMatch = /advance\s*:\s*\{[^}]*?kind\s*:\s*['"`]([^'"`]+)['"`]/.exec(body);
  const advanceKind = advanceKindMatch ? advanceKindMatch[1] : null;

  // shortcut presence
  const hasShortcut = /\bshortcut\s*:\s*\[/.test(body);

  return {
    id,
    title,
    body: text,
    spotlight,
    gesture: gesture || null,
    advanceKind,
    hasFallbackHint: fallbackHint != null,
    hasShortcut,
  };
}

function parseQuest(blockBody) {
  const id = field(blockBody, 'id');
  const category = field(blockBody, 'category');
  const title = field(blockBody, 'title');
  const summary = field(blockBody, 'summary');
  // prereqs: ['a', 'b']  (may be empty)
  const prereqMatch = /prereqs\s*:\s*\[([^\]]*)\]/.exec(blockBody);
  const prereqs = prereqMatch
    ? prereqMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean)
    : [];
  const steps = extractSteps(blockBody);
  return { id, category, title, summary, prereqs, steps };
}

// ─── Determinable checks ────────────────────────────────────────

/** C1 (partial): if step has gesture (= action step) but advance is
 *  next-button, the body is asking for a gesture but the runner
 *  waits for the user to click "다음" — confusing. Flag. */
function checkC1(step) {
  if (!step.gesture) return null;            // not an action step
  if (step.advanceKind === 'next-button') return false;
  return true;
}

/** C4: action steps (gesture present) should advance via event /
 *  expects / click-target, NOT next-button or auto-advance. */
function checkC4(step) {
  if (!step.gesture) return null;
  const ok = ['event', 'expects', 'click-target'].includes(step.advanceKind);
  return ok;
}

/** C5: action step should have fallbackHint. observation/wrap steps
 *  (no gesture, kind = next-button or auto-advance) don't need one. */
function checkC5(step) {
  if (!step.gesture) return null;
  return step.hasFallbackHint;
}

const Q = (v) => v == null ? '?' : (v ? '✓' : '✗');

// ─── Output ─────────────────────────────────────────────────────

function renderMarkdown(quests) {
  const lines = [];
  lines.push('# 튜토리얼 정합성 감사 — 자동 생성 표');
  lines.push('');
  lines.push('> `scripts/audit-quests.mjs` 출력. C1/C4/C5는 코드가 결정,');
  lines.push('> C2/C3/C6/B1-B4는 사람이 채울 빈칸(`?`).');
  lines.push('> 갱신 시 `node scripts/audit-quests.mjs > plans/tutorial-coherence-audit.md` 권장.');
  lines.push('');

  for (const q of quests) {
    const goal = QUEST_GOALS[q.id] || '(SSOT 미정)';
    lines.push(`## \`${q.id}\` — ${q.title}`);
    lines.push('');
    lines.push(`**목표**: ${goal}`);
    lines.push('');
    lines.push(`**현재 summary**: ${q.summary}`);
    lines.push('');
    lines.push(`**prereqs**: ${q.prereqs.length ? q.prereqs.join(', ') : '(없음)'}`);
    lines.push('');
    lines.push('### Quest-level (B-checks)');
    lines.push('| 항목 | 결과 | 비고 |');
    lines.push('|---|---|---|');
    lines.push('| B1 1문장 목표 | ? | (SSOT의 목표가 그대로 1문장이면 ✓) |');
    lines.push('| B2 title/summary가 목표 표현 | ? | 현재 title="' + q.title + '" / summary="' + q.summary + '" |');
    lines.push('| B3 method 적정성 | ? | 가르치는 길이 가장 자연스러운가 |');
    lines.push('| B4 단위 적정성 | ? | step 수=' + q.steps.length + ' |');
    lines.push('| B5 prereqs 실재 | ' + (q.prereqs.every(p => QUEST_GOALS[p]) ? '✓' : '✗') + ' | ' + (q.prereqs.length ? q.prereqs.join(', ') : '(없음)') + ' |');
    lines.push('');
    lines.push('### Step-level (C-checks)');
    lines.push('| step | gesture | advance | C1 triplet | C2 HOW only | C3 spotlight | C4 advance fit | C5 fallback | C6 기여도 |');
    lines.push('|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|');
    for (const s of q.steps) {
      const c1 = checkC1(s);
      const c4 = checkC4(s);
      const c5 = checkC5(s);
      lines.push(
        `| ${s.id} | ${s.gesture ?? '—'} | ${s.advanceKind ?? '?'} | ${Q(c1)} | ? | ? | ${Q(c4)} | ${Q(c5)} | ? |`
      );
    }
    lines.push('');
    // Auto-flagged issues
    const issues = [];
    for (const s of q.steps) {
      if (checkC1(s) === false) issues.push(`${s.id}: 제스처(${s.gesture})는 있는데 advance=next-button — 사용자가 동작해도 다음으로 안 넘어감`);
      if (checkC4(s) === false) issues.push(`${s.id}: action step인데 advance=${s.advanceKind} (event/expects/click-target 권장)`);
      if (checkC5(s) === false) issues.push(`${s.id}: action step에 fallbackHint 없음`);
    }
    if (issues.length) {
      lines.push('**자동 검출 이슈**:');
      for (const it of issues) lines.push(`- ${it}`);
      lines.push('');
    } else {
      lines.push('**자동 검출 이슈**: 없음');
      lines.push('');
    }
    lines.push('**판정**: PASS / 부분수정 / 재설계  ← 사람이 채움');
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const filter = args.find(a => !a.startsWith('--'));

const allQuests = [];
for (const f of listQuestFiles()) {
  const src = readFileSync(f, 'utf8');
  const blocks = extractQuestBlocks(src);
  for (const b of blocks) allQuests.push(parseQuest(b));
}

const filtered = filter
  ? allQuests.filter(q => q.id === filter || q.category === filter)
  : allQuests;

if (wantJson) {
  process.stdout.write(JSON.stringify(filtered, null, 2));
} else {
  process.stdout.write(renderMarkdown(filtered));
}
