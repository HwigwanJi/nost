import { generateId } from '../lib/utils';
import type { Space } from '../types';

/**
 * Starter templates for the onboarding wizard.
 *
 * A template is a *seed* applied to the active preset — it pushes spaces +
 * cards into `data.spaces`. We deliberately don't ship items pre-launched
 * for things like Slack URLs (which 404 without the user's own workspace);
 * every link is one a typical Korean user can hit unauthenticated.
 *
 * Adding a new template = push an entry into TEMPLATES. Every space gets
 * its `id` minted at apply time so re-applying or sharing doesn't collide
 * with existing spaces.
 */

export type TemplateId = 'developer' | 'designer' | 'student' | 'general' | 'blank';

export interface Template {
  id: TemplateId;
  label: string;            // 사용자에게 보일 한국어 이름
  emoji: string;            // 카드 미리보기에 들어갈 가벼운 아이콘
  tagline: string;          // 한 줄 설명
  /**
   * Build fresh Space[] every call (so ids are unique per apply). Returning
   * a function instead of a frozen object lets `applyTemplate` re-mint
   * everything without deep-cloning a constant.
   */
  build: () => Space[];
}

// ── Helpers ──────────────────────────────────────────────────────────
function url(title: string, value: string, color?: string): import('../types').LauncherItem {
  return {
    id: generateId(), type: 'url', title, value,
    color, clickCount: 0, pinned: false,
  };
}

function space(name: string, color: string, icon: string, items: import('../types').LauncherItem[]): Space {
  return {
    id: generateId(),
    name,
    color,
    icon,
    items,
    sortMode: 'custom',
    pinnedIds: [],
  };
}

// ── Templates ────────────────────────────────────────────────────────

const developer: Template = {
  id: 'developer',
  label: '개발자',
  emoji: '👨‍💻',
  tagline: 'Github · 스택오버플로우 · 문서',
  build: () => [
    space('개발', '#22c55e', 'code', [
      url('GitHub',         'https://github.com'),
      url('GitLab',         'https://gitlab.com'),
      url('Stack Overflow', 'https://stackoverflow.com'),
      url('npm',            'https://www.npmjs.com'),
      url('MDN',            'https://developer.mozilla.org'),
      url('CanIUse',        'https://caniuse.com'),
    ]),
    space('AI 도구', '#a855f7', 'auto_awesome', [
      url('ChatGPT',        'https://chat.openai.com'),
      url('Claude',         'https://claude.ai'),
      url('Cursor 문서',    'https://docs.cursor.com'),
      url('Hugging Face',   'https://huggingface.co'),
    ]),
    space('자료', '#f59e0b', 'menu_book', [
      url('Google',         'https://www.google.com'),
      url('DevDocs',        'https://devdocs.io'),
      url('Regex101',       'https://regex101.com'),
      url('Excalidraw',     'https://excalidraw.com'),
    ]),
  ],
};

const designer: Template = {
  id: 'designer',
  label: '디자이너',
  emoji: '🎨',
  tagline: 'Figma · 무드보드 · 폰트·컬러 도구',
  build: () => [
    space('툴', '#ec4899', 'design_services', [
      url('Figma',          'https://www.figma.com'),
      url('Sketch Cloud',   'https://www.sketch.com/c/'),
      url('Whimsical',      'https://whimsical.com'),
      url('Excalidraw',     'https://excalidraw.com'),
    ]),
    space('레퍼런스', '#0ea5e9', 'lightbulb', [
      url('Behance',        'https://www.behance.net'),
      url('Dribbble',       'https://dribbble.com'),
      url('Pinterest',      'https://www.pinterest.com'),
      url('Awwwards',       'https://www.awwwards.com'),
      url('Mobbin',         'https://mobbin.com'),
    ]),
    space('폰트·컬러', '#a855f7', 'palette', [
      url('Google Fonts',   'https://fonts.google.com'),
      url('Coolors',        'https://coolors.co'),
      url('Realtime Colors','https://realtimecolors.com'),
      url('산돌구름',       'https://sandollcloud.com'),
      url('눈누',           'https://noonnu.cc'),
    ]),
  ],
};

const student: Template = {
  id: 'student',
  label: '학생',
  emoji: '📚',
  tagline: '강의 · 학교 시스템 · 공부 도구',
  build: () => [
    space('학교', '#6366f1', 'school', [
      url('LMS / 이클래스',  'https://eclass.example.ac.kr'),
      url('포털',            'https://portal.example.ac.kr'),
      url('도서관',          'https://library.example.ac.kr'),
    ]),
    space('공부', '#22c55e', 'menu_book', [
      url('노션',            'https://www.notion.so'),
      url('퀴즐렛',          'https://quizlet.com'),
      url('인프런',          'https://www.inflearn.com'),
      url('칸 아카데미',     'https://ko.khanacademy.org'),
      url('네이버 사전',     'https://dict.naver.com'),
    ]),
    space('생활', '#f59e0b', 'coffee', [
      url('네이버',          'https://www.naver.com'),
      url('유튜브',          'https://www.youtube.com'),
      url('쿠팡',            'https://www.coupang.com'),
      url('카카오톡 PC',     'https://www.kakaocorp.com/page/service/service/KakaoTalk'),
    ]),
  ],
};

const general: Template = {
  id: 'general',
  label: '일반',
  emoji: '🌳',
  tagline: '일상 · 메일 · 쇼핑 · 미디어',
  build: () => [
    space('자주 가는 곳', '#0ea5e9', 'star', [
      url('네이버',          'https://www.naver.com'),
      url('구글',            'https://www.google.com'),
      url('지메일',          'https://mail.google.com'),
      url('네이버 메일',     'https://mail.naver.com'),
      url('유튜브',          'https://www.youtube.com'),
    ]),
    space('쇼핑·생활', '#f59e0b', 'shopping_bag', [
      url('쿠팡',            'https://www.coupang.com'),
      url('11번가',          'https://www.11st.co.kr'),
      url('당근',            'https://www.daangn.com'),
      url('배달의민족',      'https://www.baemin.com'),
    ]),
    space('미디어', '#ec4899', 'movie', [
      url('넷플릭스',        'https://www.netflix.com'),
      url('티빙',            'https://www.tving.com'),
      url('웨이브',          'https://www.wavve.com'),
      url('네이버 웹툰',     'https://comic.naver.com'),
    ]),
  ],
};

/** "빈 시작" — preserves a single empty space the user can fill themselves.
 *  Kept as a template so the UI flow is uniform: every choice goes through
 *  applyTemplate(). */
const blank: Template = {
  id: 'blank',
  label: '빈 시작',
  emoji: '📭',
  tagline: '직접 처음부터 만들기',
  build: () => [
    space('새 스페이스', '#6366f1', '', []),
  ],
};

export const TEMPLATES: Template[] = [developer, designer, student, general, blank];

export function findTemplate(id: TemplateId): Template | undefined {
  return TEMPLATES.find(t => t.id === id);
}
