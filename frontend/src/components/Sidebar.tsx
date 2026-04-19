import { useState } from 'react';
import type { AppMode } from '../types';
import { Icon } from '@/components/ui/Icon';
import { NostLogo } from '@/components/ui/NostLogo';

interface SidebarProps {
  activeMode: AppMode;
  onModeChange: (mode: AppMode) => void;
  recommendOpen?: boolean;
  onRecommendClick?: () => void;
}

export function Sidebar({ activeMode, onModeChange, recommendOpen, onRecommendClick }: SidebarProps) {
  const [expanded, setExpanded] = useState(false);

  const sidebarWidth = expanded ? 160 : 44;

  return (
    <div
      className="sidebar"
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border-rgba)',
        background: 'var(--surface)',
        transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1), min-width 0.2s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* ── App identity ──────────────────────────── */}
      <div
        style={{
          padding: '10px 0',
          paddingLeft: expanded ? 12 : 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: expanded ? 'flex-start' : 'center',
          gap: 8,
          borderBottom: '1px solid var(--border-rgba)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: 'var(--accent-dim)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <NostLogo size={14} color="var(--accent)" />
        </div>
        {expanded && (
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-color)', whiteSpace: 'nowrap', letterSpacing: '-0.03em' }}>
            nost
          </span>
        )}
      </div>

      {/* ── Mode buttons ────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '8px 6px',
        }}
      >
        <SidebarButton
          icon="push_pin"
          label="고정 모드"
          active={activeMode === 'pin'}
          expanded={expanded}
          onClick={() => onModeChange(activeMode === 'pin' ? 'normal' : 'pin')}
          accentColor="#f59e0b"
        />
        <SidebarButton
          icon="hub"
          label="노드 편집"
          active={activeMode === 'node'}
          expanded={expanded}
          onClick={() => onModeChange(activeMode === 'node' ? 'normal' : 'node')}
          accentColor="#6366f1"
        />
        <SidebarButton
          icon="stacks"
          label="덱 편집"
          active={activeMode === 'deck'}
          expanded={expanded}
          onClick={() => onModeChange(activeMode === 'deck' ? 'normal' : 'deck')}
          accentColor="#f97316"
        />

        <div style={{ height: 1, background: 'var(--border-rgba)', margin: '4px 6px' }} />

        <SidebarButton
          icon="lightbulb"
          label="추천"
          active={!!recommendOpen}
          expanded={expanded}
          onClick={() => onRecommendClick?.()}
          accentColor="var(--accent)"
        />
      </div>

      {/* ── Expand / Collapse toggle ─────────────── */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '10px 0',
          borderTop: '1px solid var(--border-rgba)',
          background: 'transparent',
          border: 'none',
          borderTopStyle: 'solid',
          borderTopWidth: 1,
          borderTopColor: 'var(--border-rgba)',
          cursor: 'pointer',
          color: 'var(--text-dim)',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
        title={expanded ? '사이드바 접기' : '사이드바 펼치기'}
      >
        <Icon name="chevron_right" size={14} style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        {expanded && (
          <span style={{ fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap' }}>접기</span>
        )}
      </button>
    </div>
  );
}

/* ── Sidebar button ────────────────────────────────────────── */
// Adobe-inspired design: inactive state uses neutral (text-dim) color for
// every tool — accent color is only revealed on active state via a 2px left
// rail + soft 8% bg tint. This gives visual calm when scanning the toolbar.
function SidebarButton({
  icon,
  label,
  active,
  expanded,
  onClick,
  accentColor,
  badge,
}: {
  icon: string;
  label: string;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
  accentColor: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={!expanded ? label : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: expanded ? '8px 10px' : '8px 0',
        justifyContent: expanded ? 'flex-start' : 'center',
        borderRadius: 8,
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        background: active ? accentColor + '14' : 'transparent', /* 8% tint */
        color: active ? accentColor : 'var(--text-dim)',
        transition: 'background 0.15s, color 0.15s',
        position: 'relative',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = 'var(--surface-hover)';
          e.currentTarget.style.color = 'var(--text-muted)';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-dim)';
        }
      }}
    >
      {/* Left accent rail — Adobe CC-style active indicator */}
      {active && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 2,
            borderRadius: 1,
            background: accentColor,
          }}
        />
      )}
      <Icon name={icon} size={17} style={{ flexShrink: 0 }} />
      {expanded && label}
      {badge && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: expanded ? 8 : 4,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: accentColor,
          }}
        />
      )}
    </button>
  );
}
