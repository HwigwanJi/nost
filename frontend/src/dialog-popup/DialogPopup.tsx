/**
 * Save-As dialog companion popup.
 *
 * Three-level nav surface in one strip:
 *   - Preset switch (1·2·3) on the right — change which preset's spaces
 *     are visible. Doesn't mutate the global active preset; this is a
 *     popup-local view filter so the user can browse "their other
 *     workspace" mid-save without disrupting their main app context.
 *   - Level 1 — chips for each space that contains at least one folder
 *     card, plus a leading "시스템" pseudo-space (다운로드/바탕화면/문서).
 *   - Level 2 — chips for the folder cards inside the selected space.
 *
 * Click a folder chip → main runs jump-to-dialog-folder.ps1 (clipboard
 * paste, Unicode-safe, NumLock-safe via direct keybd_event). The popup
 * stays open and returns to Level 1 so the user can chain saves to
 * different folders without reopening the dialog popup.
 *
 * The popup window itself is created/destroyed/positioned by main.js
 * based on dialog detection polling — the user closing the file dialog
 * makes the popup auto-vanish; the ✕ button only hides for the current
 * dialog session.
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

interface PresetSummary {
  id: '1' | '2' | '3';
  label: string;
  spaces: SpaceSummary[];
}

export interface DialogPopupState {
  systemFolders: FolderRef[];
  presets: PresetSummary[];
  activePresetId?: '1' | '2' | '3';
  dialogTitle?: string;
}

interface Api {
  onState:      (cb: (s: DialogPopupState) => void) => () => void;
  requestState: () => void;
  jumpTo:       (folderPath: string) => void;
  dismiss:      () => void;
}
const api = (window as unknown as { dialogPopup: Api }).dialogPopup;

// Inline-style palette (no Tailwind in this entry).
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
};

function isLight(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function DialogPopup() {
  const [state, setState] = useState<DialogPopupState | null>(null);
  // Which preset's spaces are currently shown. Defaults to whatever main says
  // is "active"; user can flip to another preset via the 1·2·3 buttons.
  const [viewPresetId, setViewPresetId] = useState<'1' | '2' | '3' | null>(null);
  // null → Level 1 (space chips); otherwise Level 2 for the picked space.id
  // (or '__system__' for the pseudo-space).
  const [drillSpaceId, setDrillSpaceId] = useState<string | null>(null);
  const [light, setLight] = useState(isLight());

  useEffect(() => {
    const off = api.onState(s => {
      setState(s);
      // Initialise viewPresetId on the FIRST state push only — afterwards
      // we keep whatever the user chose, so subsequent state refreshes
      // (e.g. data updates) don't yank them back to the active preset.
      setViewPresetId(prev => prev ?? s.activePresetId ?? '1');
    });
    api.requestState();
    return off;
  }, []);

  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: light)');
    const fn = () => setLight(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);

  // ESC: drill → root, root → dismiss.
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
    // Return to Level 1 instead of closing — the user said dismissing
    // after one click was wasteful when they want to save multiple files
    // to different folders in succession. The popup will close on its own
    // when main detects the file dialog has gone away.
    setDrillSpaceId(null);
  }, []);

  if (!state) return null;

  const viewPreset = state.presets.find(p => p.id === viewPresetId)
    ?? state.presets.find(p => p.id === state.activePresetId)
    ?? state.presets[0];
  const visibleSpaces = viewPreset?.spaces ?? [];

  const drillSpace = drillSpaceId
    ? (drillSpaceId === '__system__'
        ? { id: '__system__', name: '시스템', icon: 'desktop_windows', color: undefined as string | undefined, folders: state.systemFolders }
        : visibleSpaces.find(s => s.id === drillSpaceId))
    : null;

  // Theme.
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
        padding: '0 8px',
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
              {visibleSpaces.filter(s => s.folders.length > 0).map(s => (
                <Chip
                  key={s.id}
                  label={`${s.name} ${s.folders.length}`}
                  icon={s.icon || 'folder'}
                  tint={s.color}
                  muted={muted} text={text} border={border}
                  onClick={() => setDrillSpaceId(s.id)}
                />
              ))}
              {visibleSpaces.filter(s => s.folders.length > 0).length === 0 && state.systemFolders.length === 0 && (
                <span style={{ fontSize: 10, color: muted, padding: '0 8px' }}>
                  이 프리셋엔 등록된 폴더 카드가 없습니다.
                </span>
              )}
            </>
        }
      </div>

      {/* Preset switcher 1·2·3 — always visible, no Tab key needed.
          Showing all three even when the user has only used one is OK —
          the segmented control is small enough to be ambient noise. */}
      {state.presets.length > 1 && (
        <>
          <div style={{ width: 1, alignSelf: 'stretch', background: border, margin: '0 2px' }} />
          <div style={{ display: 'flex', gap: 1, padding: 1, background: border, borderRadius: 6, flexShrink: 0 }}>
            {state.presets.map(p => {
              const isActive = p.id === viewPresetId;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setViewPresetId(p.id);
                    setDrillSpaceId(null);  // reset to L1 when switching preset
                  }}
                  title={p.label}
                  style={{
                    width: 22, height: 22,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: isActive ? bg : 'transparent',
                    border: 'none',
                    borderRadius: 5,
                    color: isActive ? text : muted,
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    transition: 'background 120ms ease',
                  }}
                >
                  {p.id}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Close (this dialog only — popup reattaches to the next dialog) */}
      <button
        onClick={() => api.dismiss()}
        title="이 다이얼로그에서 닫기"
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
      style={chipStyle(border, text, muted, false)}
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
