/**
 * Save-As dialog companion popup.
 *
 * Two-level nav:
 *   Level 1 — chips for each space that contains at least one folder card,
 *             plus a leading "시스템" pseudo-space (다운로드/바탕화면/문서).
 *   Level 2 — chips for the folder cards inside the selected space.
 *
 * Click a folder chip → main runs jump-to-dialog-folder.ps1 (clipboard
 * paste, Unicode-safe), the popup closes itself.
 *
 * The popup window itself is created/destroyed/positioned by main.js based
 * on dialog detection polling — this component just renders the data it's
 * fed via the `dialogPopup` IPC bridge.
 */
import { useCallback, useEffect, useState } from 'react';

interface FolderRef {
  id: string;
  title: string;
  path: string;
}

interface SpaceSummary {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  folders: FolderRef[];
}

export interface DialogPopupState {
  spaces: SpaceSummary[];
  /** Pseudo-space "system" rendered first in Level 1. */
  systemFolders: FolderRef[];
  dialogTitle?: string;
}

interface Api {
  onState:      (cb: (s: DialogPopupState) => void) => () => void;
  requestState: () => void;
  jumpTo:       (folderPath: string) => void;
  dismiss:      () => void;
}
const api = (window as unknown as { dialogPopup: Api }).dialogPopup;

// Keep classNames out — we run without Tailwind. Inline styles only.
const C = {
  bg:        'rgba(20, 20, 26, 0.96)',
  bgLight:   'rgba(255, 255, 255, 0.96)',
  border:    'rgba(255, 255, 255, 0.08)',
  borderL:   'rgba(0, 0, 0, 0.08)',
  text:      'rgba(255, 255, 255, 0.92)',
  textL:     'rgba(0, 0, 0, 0.85)',
  muted:     'rgba(255, 255, 255, 0.5)',
  mutedL:    'rgba(0, 0, 0, 0.5)',
  accent:    '#6366f1',
  accentDim: 'rgba(99, 102, 241, 0.18)',
};

function isLight(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function DialogPopup() {
  const [state, setState] = useState<DialogPopupState | null>(null);
  // Level: null = Level 1 (space chips), or a space.id for Level 2.
  const [drillSpaceId, setDrillSpaceId] = useState<string | null>(null);
  const [light, setLight] = useState(isLight());

  useEffect(() => {
    const off = api.onState(s => setState(s));
    api.requestState();
    return off;
  }, []);

  // Track OS theme — main can resize the popup but we don't know if the
  // OS theme flips while it's open, so listen for the change.
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: light)');
    const fn = () => setLight(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);

  // ESC: Level 2 → Level 1; Level 1 → dismiss.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drillSpaceId) setDrillSpaceId(null);
        else api.dismiss();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [drillSpaceId]);

  const onClickFolder = useCallback((path: string) => {
    api.jumpTo(path);
    // Close immediately — main will also auto-destroy when the dialog goes
    // away, but a snappy close on click feels like commitment.
    api.dismiss();
  }, []);

  if (!state) return null;

  const drillSpace = drillSpaceId
    ? (drillSpaceId === '__system__'
        ? { id: '__system__', name: '시스템', icon: 'desktop_windows', color: undefined, folders: state.systemFolders }
        : state.spaces.find(s => s.id === drillSpaceId))
    : null;

  // Apply theme.
  const bg     = light ? C.bgLight : C.bg;
  const border = light ? C.borderL : C.border;
  const text   = light ? C.textL   : C.text;
  const muted  = light ? C.mutedL  : C.muted;

  return (
    <div
      style={{
        margin: '0 8px',
        flex: 1,
        height: 38,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        boxShadow: '0 4px 18px rgba(0, 0, 0, 0.18)',
        backdropFilter: 'blur(20px) saturate(160%)',
        color: text,
        overflow: 'hidden',
      }}
    >
      {/* Left section: brand + back/title */}
      {drillSpace ? (
        <button
          onClick={() => setDrillSpaceId(null)}
          title="뒤로"
          style={chipStyle(border, text, muted, false)}
        >
          <span className="ms-rounded" style={{ fontSize: 14 }}>arrow_back</span>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{drillSpace.name}</span>
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 4, color: muted }}>
          <span className="ms-rounded" style={{ fontSize: 14, color: C.accent }}>folder_open</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.02em' }}>
            {state.dialogTitle ? truncateMiddle(state.dialogTitle, 22) : '저장 위치'}
          </span>
        </div>
      )}

      <div style={{ width: 1, alignSelf: 'stretch', background: border, margin: '0 2px' }} />

      {/* Scrollable chip row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {drillSpace
          ? drillSpace.folders.map(f => (
              <Chip key={f.id} label={f.title} icon="folder" tint={drillSpace.color} muted={muted} text={text} border={border} onClick={() => onClickFolder(f.path)} />
            ))
          : <>
              {state.systemFolders.length > 0 && (
                <Chip
                  label={`시스템 ${state.systemFolders.length}`}
                  icon="desktop_windows"
                  muted={muted} text={text} border={border}
                  onClick={() => setDrillSpaceId('__system__')}
                />
              )}
              {state.spaces.filter(s => s.folders.length > 0).map(s => (
                <Chip
                  key={s.id}
                  label={`${s.name} ${s.folders.length}`}
                  icon={s.icon || 'folder'}
                  tint={s.color}
                  muted={muted} text={text} border={border}
                  onClick={() => setDrillSpaceId(s.id)}
                />
              ))}
            </>
        }
      </div>

      {/* Close */}
      <button
        onClick={() => api.dismiss()}
        title="닫기"
        style={{
          ...chipStyle(border, text, muted, true),
          padding: '0 6px',
          width: 26,
          justifyContent: 'center',
        }}
      >
        <span className="ms-rounded" style={{ fontSize: 14 }}>close</span>
      </button>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

function chipStyle(border: string, text: string, muted: string, ghost: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    padding: '0 10px',
    flexShrink: 0,
    background: 'transparent',
    border: ghost ? '1px solid transparent' : `1px solid ${border}`,
    borderRadius: 7,
    color: ghost ? muted : text,
    fontSize: 11,
    fontFamily: 'inherit',
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 120ms ease, border-color 120ms ease',
  };
}

function Chip({ label, icon, onClick, tint, muted, text, border }: {
  label: string;
  icon: string;
  onClick: () => void;
  tint?: string;
  muted: string;
  text: string;
  border: string;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.background = tint ? hexToRgba(tint, 0.12) : 'rgba(255, 255, 255, 0.06)';
        e.currentTarget.style.borderColor = tint ? hexToRgba(tint, 0.4) : border;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = border;
      }}
      style={{
        ...chipStyle(border, text, muted, false),
        // Subtle accent dot ahead of tinted spaces — gives quick visual key
        // when many chips are visible.
      }}
    >
      <span className="ms-rounded" style={{ fontSize: 13, color: tint || C.accent, opacity: 0.9 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m) return `rgba(99, 102, 241, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function truncateMiddle(s: string, max: number) {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + '…' + s.slice(-half);
}
