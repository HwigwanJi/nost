import { useState } from 'react';
import type { AppMode } from '../types';

interface SidebarProps {
  activeMode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

export function Sidebar({ activeMode, onModeChange }: SidebarProps) {
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
      {/* ── Guest / Account area ──────────────────── */}
      <div
        style={{
          padding: expanded ? '12px 12px 8px' : '12px 0 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          borderBottom: '1px solid var(--border-rgba)',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--border-rgba)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 16, color: 'var(--text-muted)' }}>
            person
          </span>
        </div>
        {expanded && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 500 }}>
            Guest
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
        <span
          className="material-symbols-rounded"
          style={{
            fontSize: 14,
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          chevron_right
        </span>
        {expanded && (
          <span style={{ fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap' }}>접기</span>
        )}
      </button>
    </div>
  );
}

/* ── Sidebar button ────────────────────────────────────────── */
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
        background: active ? accentColor + '20' : 'transparent',
        color: active ? accentColor : 'var(--text-muted)',
        transition: 'all 0.15s',
        position: 'relative',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.background = 'var(--surface-hover)';
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: 17, flexShrink: 0 }}>
        {icon}
      </span>
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
