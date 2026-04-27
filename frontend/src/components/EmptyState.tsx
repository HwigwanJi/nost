import { type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * EmptyState — invitation screen when the user has zero spaces in the active
 * preset, or hits a search with zero hits. Replaces the previous "icon + one
 * line" state with an illustrated, action-oriented panel.
 *
 * Two variants:
 *   - kind='no-spaces'  : pristine preset, primary call-to-action
 *   - kind='no-results' : search returned nothing
 *
 * Design notes:
 *   - The illustration is an inline SVG (no external image asset, no font
 *     dependency, ~1.5KB) so it renders instantly even when the preset is
 *     empty on first paint.
 *   - Two parallel CTAs in `no-spaces`: 템플릿으로 시작 (primary) and 빈 스페이스
 *     (secondary). Templates is the bigger conversion lever — empty space
 *     stays as a fallback for users who want to build from scratch.
 *   - Tutorial trigger uses the existing `nost:start-tour` CustomEvent so
 *     this component stays decoupled from TourOverlay's internals.
 */

interface Props {
  kind: 'no-spaces' | 'no-results';
  query?: string;
  presetLabel?: string;
  onAddBlank: () => void;
  onOpenTemplates: () => void;
}

export function EmptyState({ kind, query, presetLabel, onAddBlank, onOpenTemplates }: Props) {
  if (kind === 'no-results') {
    return (
      <div style={wrap}>
        <SearchOffIllustration />
        <p style={head}>'{query}' 결과 없음</p>
        <p style={sub}>다른 단어로 시도하거나, 슬래시 명령(/?)을 확인해보세요.</p>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <WorkspaceIllustration />
      <p style={head}>
        {presetLabel ? `${presetLabel} — 비어있어요` : '스페이스가 없어요'}
      </p>
      <p style={sub}>
        프리셋은 카드들의 묶음이에요.<br />
        템플릿으로 시작하면 5초 만에 익숙한 구성을 가져올 수 있어요.
      </p>

      <div style={ctaRow}>
        <button onClick={onOpenTemplates} style={primaryBtn}>
          <Icon name="auto_awesome" size={14} />
          템플릿으로 시작
        </button>
        <button onClick={onAddBlank} style={secondaryBtn}>
          <Icon name="add" size={14} />
          빈 스페이스
        </button>
      </div>

      <button
        onClick={() => window.dispatchEvent(new CustomEvent('nost:start-tour', { detail: {} }))}
        style={tertiaryBtn}
      >
        <Icon name="school" size={11} />
        nost가 처음이세요? 1분 투어 보기
      </button>
    </div>
  );
}

// ── Illustration (inline SVG) ──────────────────────────────────────
//
// Hand-tuned simple workspace metaphor: three stacked cards with a faint
// accent ring. Uses var(--accent) so it follows the user's chosen theme
// color. Mirrors the actual app's card grid aesthetic at glance, so the
// illustration FEELS like nost rather than a generic "empty box" stock SVG.
function WorkspaceIllustration() {
  return (
    <svg width="148" height="120" viewBox="0 0 148 120" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="nost-empty-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      {/* Soft accent halo */}
      <circle cx="74" cy="62" r="48" fill="url(#nost-empty-grad)" />
      {/* Back card (faded, offset) */}
      <rect x="40" y="32" width="68" height="44" rx="8"
            fill="var(--surface)" stroke="var(--border-rgba)" strokeWidth="1"
            transform="rotate(-6 74 54)" opacity="0.6" />
      {/* Middle card */}
      <rect x="36" y="40" width="76" height="48" rx="9"
            fill="var(--surface)" stroke="var(--border-rgba)" strokeWidth="1.2"
            transform="rotate(2 74 64)" opacity="0.85" />
      {/* Front card */}
      <rect x="32" y="50" width="84" height="52" rx="10"
            fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.5" />
      {/* Front card content lines */}
      <rect x="42" y="60"  width="40" height="6" rx="3" fill="var(--accent)" opacity="0.55" />
      <rect x="42" y="72"  width="64" height="4" rx="2" fill="var(--text-dim)" opacity="0.32" />
      <rect x="42" y="82"  width="48" height="4" rx="2" fill="var(--text-dim)" opacity="0.22" />
      {/* Sparkle */}
      <path d="M122 22 L124 28 L130 30 L124 32 L122 38 L120 32 L114 30 L120 28 Z"
            fill="var(--accent)" opacity="0.7" />
    </svg>
  );
}

function SearchOffIllustration() {
  return (
    <svg width="120" height="92" viewBox="0 0 120 92" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="nost-search-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="var(--text-dim)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--text-dim)" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="44" r="34" fill="url(#nost-search-grad)" />
      <circle cx="54" cy="40" r="18" fill="none" stroke="var(--text-dim)" strokeWidth="2" opacity="0.7" />
      <line x1="68" y1="52" x2="82" y2="68" stroke="var(--text-dim)" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      <line x1="46" y1="32" x2="62" y2="48" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <line x1="62" y1="32" x2="46" y2="48" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Inline styles (kept colocated; no external CSS coupling) ────────
const wrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '54px 20px 40px',
  gap: 8,
  textAlign: 'center',
};
const head: CSSProperties = {
  marginTop: 14,
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-color)',
  letterSpacing: '-0.01em',
};
const sub: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.65,
  color: 'var(--text-dim)',
  maxWidth: 320,
};
const ctaRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 16,
};
const primaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px',
  background: 'var(--accent)', color: '#fff',
  border: 'none', borderRadius: 8,
  fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
  cursor: 'pointer',
  letterSpacing: '-0.01em',
  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.22)',
};
const secondaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px',
  background: 'var(--surface)', color: 'var(--text-color)',
  border: '1px solid var(--border-rgba)', borderRadius: 8,
  fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
  cursor: 'pointer',
};
const tertiaryBtn: CSSProperties = {
  marginTop: 16,
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 10px',
  background: 'transparent', color: 'var(--text-dim)',
  border: 'none', borderRadius: 6,
  fontSize: 11, fontFamily: 'inherit',
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};
