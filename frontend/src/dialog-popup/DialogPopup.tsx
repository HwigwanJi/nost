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
import { useCallback, useEffect, useState, useRef } from 'react';

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
  /** v2 — pushed from main so the satellite can match the app's theme +
   *  accent (it can't run App.tsx, which injects these on the main window). */
  theme?: 'light' | 'dark';
  accentColor?: string;
  /** v2 — single context-aware suggested destination, or null. */
  recommendation?: {
    path: string;
    title: string;
    color?: string | null;
    reason: string;
  } | null;
}

interface Api {
  onState:      (cb: (s: DialogPopupState) => void) => () => void;
  requestState: () => void;
  jumpTo:       (folderPath: string) => void;
  dismiss:      () => void;
  /** Toggle mouse capture as the pointer enters/leaves interactive
   *  regions. The popup window is taller than the visible chip strip
   *  (so the dropdown menu has room to open without dynamic resize) —
   *  the transparent extra area must be click-through, hence this
   *  toggle. */
  setCapture:   (capture: boolean) => void;
}
const api = (window as unknown as { dialogPopup: Api }).dialogPopup;

// Design-system tokens (defined in tokens.css, light/dark via `.dark` on
// documentElement). No hardcoded palette — colors are var(--*); the accent
// is injected at runtime from the pushed `accentColor`. See tokens.css.
const T = {
  bg:     'var(--bg-rgba)',
  border: 'var(--border-rgba)',
  text:   'var(--text-color)',
  muted:  'var(--text-muted)',
  accent: 'var(--accent)',
  hover:  'var(--surface-hover)',
  surface:'var(--surface)',
};

export function DialogPopup() {
  const [state, setState] = useState<DialogPopupState | null>(null);
  // Which preset's spaces are currently shown. Defaults to whatever main says
  // is "active"; user can flip to another preset via the 1·2·3 buttons.
  const [viewPresetId, setViewPresetId] = useState<'1' | '2' | '3' | null>(null);
  // null → Level 1 (space chips); otherwise Level 2 for the picked space.id.
  const [drillSpaceId, setDrillSpaceId] = useState<string | null>(null);
  // Folder-id whose jumpTo IPC is in flight. The PS clipboard-paste
  // routine takes a beat (~300-800ms on first invocation per session
  // because it warms up SendInput), and without any visual cue the
  // user assumed the click didn't register and clicked again. The
  // chip shows a spinner while this is set; cleared by a short timer
  // since jumpTo is fire-and-forget and we don't get a real done IPC.
  const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);
  // Pellet collapse. Starts EXPANDED so the rail is immediately visible +
  // usable when a dialog appears, then auto-collapses to a small pellet
  // after a beat unless the user hovers it. Hover re-expands. One timer,
  // cleared on unmount — no animation-queue race (오답노트 C).
  const [expanded, setExpanded] = useState(true);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    collapseTimer.current = setTimeout(() => setExpanded(false), 3000);
    return () => { if (collapseTimer.current) clearTimeout(collapseTimer.current); };
  }, []);

  useEffect(() => {
    const off = api.onState(s => {
      setState(s);
      // Initialise viewPresetId on the FIRST state push only — afterwards
      // we keep whatever the user chose, so subsequent state refreshes
      // (e.g. data updates) don't yank them back to the active preset.
      setViewPresetId(prev => prev ?? s.activePresetId ?? '1');
      // Apply theme + accent to documentElement — mirrors App.tsx, but the
      // values arrive via IPC since this satellite doesn't run App.tsx.
      const root = document.documentElement;
      if (s.theme === 'light') root.classList.remove('dark');
      else root.classList.add('dark');
      if (s.accentColor) {
        root.style.setProperty('--accent', s.accentColor);
        root.style.setProperty('--accent-dim', s.accentColor + '33');
      }
    });
    api.requestState();
    return off;
  }, []);

  // Mouse-capture toggling + pellet expand. The window is rail-sized but the
  // collapsed pellet only fills a corner; empty regions are transparent +
  // setIgnoreMouseEvents(true, forward) by main. This forwarded-move handler
  // (the proven path — it's how dropdown capture has always worked, and it
  // fires even while click-through) flips capture ON over interactive regions
  // AND expands the rail when the pointer is over the pellet/rail. Collapse is
  // driven by the wrapper's onMouseLeave (real event, fires once capture is on
  // = expanded), so we never need React onMouseEnter (which wouldn't fire
  // while click-through).
  useEffect(() => {
    let captured = false;
    const onMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const want = !!target?.closest('[data-popup-interactive]');
      if (want !== captured) {
        captured = want;
        api.setCapture(want);
      }
      if (want) {
        if (collapseTimer.current) clearTimeout(collapseTimer.current);
        setExpanded(true);
      }
    };
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
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

  const onClickFolder = useCallback((folderId: string, path: string) => {
    setPendingFolderId(folderId);
    api.jumpTo(path);
    // Hold the spinner long enough that the user sees feedback even on
    // the fastest path (SendInput warmed up). 700 ms is roughly the
    // 95th-percentile end-to-end latency we measured, after which the
    // dialog's address bar has visibly changed anyway.
    setTimeout(() => setPendingFolderId(null), 700);
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

  const drillSpace = drillSpaceId ? visibleSpaces.find(s => s.id === drillSpaceId) : null;

  // Theme — colors are design-system tokens (auto light/dark via `.dark`
  // on documentElement, set from the pushed theme). `light` is derived from
  // the same pushed theme, used only for the tint-alpha math below.
  const light = state.theme === 'light';
  const accentHex = state.accentColor || '#6366f1';
  const bg     = T.bg;
  const border = T.border;
  const text   = T.text;
  const muted  = T.muted;

  // L2 (drill into a space): subtle background tint so the user can
  // tell at a glance "I'm inside <space name>", not just from the back
  // button label. Uses the drilled space's colour at low opacity layered
  // over the base bg; system pseudo-space falls back to the accent.
  const stripTint = drillSpace
    ? (drillSpace.color ? hexToRgba(drillSpace.color, light ? 0.10 : 0.18) : hexToRgba(accentHex, light ? 0.08 : 0.16))
    : null;
  const stripBorder = drillSpace
    ? (drillSpace.color ? hexToRgba(drillSpace.color, light ? 0.28 : 0.36) : hexToRgba(accentHex, light ? 0.24 : 0.32))
    : border;

  // Folder count across the visible preset's spaces — shown on the pellet.
  const totalFolders = visibleSpaces.reduce((n, s) => n + s.folders.length, 0);

  return (
    <>
      <style>{`
        @keyframes nost-dpopup-spin { to { transform: rotate(360deg); } }
      `}</style>
    {/* Full-bleed transparent canvas; the rail/pellet position themselves
        within it. Empty regions stay click-through (main keeps the window
        ignore-mouse + forward). onMouseLeave collapses — it fires reliably
        once the rail is expanded (capture on). */}
    <div
      onMouseLeave={() => setExpanded(false)}
      style={{ position: 'absolute', inset: 0 } as React.CSSProperties}
    >
      {/* Both layers are always mounted; `expanded` cross-fades + scales
          between them (transform-origin = pellet corner) so the rail
          smoothly grows out of the pellet. Only the active layer is
          pointer-interactive. No floating popovers escape the rail (the
          preset switcher expands INLINE), so nothing clips against the
          window bounds — 오답노트: 쉘 벗어나는 요소 클리핑. */}

      {/* ── Collapsed pellet ───────────────────────────────────────── */}
      <button
        data-popup-interactive
        onClick={() => { if (collapseTimer.current) clearTimeout(collapseTimer.current); setExpanded(true); }}
        title={state.dialogTitle ? `저장 위치 — ${state.dialogTitle}` : '저장 위치'}
        style={{
          // Inset a touch from the window corner so the pellet's border +
          // (next to the dialog) reads as intentional breathing room.
          position: 'absolute', top: 6, left: 6,
          width: 40, height: 40, borderRadius: 11,
          background: bg, border: `1px solid ${border}`, color: text,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', boxShadow: '0 6px 18px rgba(0, 0, 0, 0.28)',
          WebkitAppRegion: 'no-drag',
          transformOrigin: 'top left',
          opacity: expanded ? 0 : 1,
          transform: expanded ? 'scale(0.6)' : 'scale(1)',
          pointerEvents: expanded ? 'none' : 'auto',
          transition: 'opacity 140ms ease, transform 200ms cubic-bezier(0.16,1,0.3,1)',
        } as React.CSSProperties}
      >
        <span className="ms-rounded" style={{ fontSize: 19, color: T.accent }}>folder_open</span>
        {totalFolders > 0 && (
          // Badge sits INSIDE the pellet (no negative offset) so it can't
          // clip against the window bounds. 오답노트: 쉘 벗어나는 요소 클리핑.
          <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15, padding: '0 3px', borderRadius: 8, background: T.accent, color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, border: `1.5px solid ${bg}` }}>{totalFolders}</span>
        )}
      </button>

      {/* ── Expanded rail (docked to the dialog edge) ──────────────── */}
      <div
        data-popup-interactive
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          background: stripTint
            ? `linear-gradient(${stripTint}, ${stripTint}), ${bg}`
            : bg,
          // Crisp border (fully visible) instead of a drop shadow — the rail
          // fills the window edge-to-edge, so any shadow would clip against
          // the bounds and read as cut-off. The border + dialog contrast
          // give enough separation for a docked panel.
          border: `1px solid ${stripBorder}`,
          borderRadius: 12,
          color: text,
          // Nothing floats outside the rail anymore (inline preset switch),
          // so clip to the rounded box; the body scrolls internally.
          overflow: 'hidden',
          transformOrigin: 'top left',
          opacity: expanded ? 1 : 0,
          transform: expanded ? 'scale(1)' : 'scale(0.7)',
          pointerEvents: expanded ? 'auto' : 'none',
          transition: 'opacity 160ms ease, transform 220ms cubic-bezier(0.16,1,0.3,1), background 180ms ease, border-color 180ms ease',
        } as React.CSSProperties}
      >
        {/* Header: context (dialog title) + close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
          <span className="ms-rounded" style={{ fontSize: 15, color: T.accent, flexShrink: 0 }}>folder_open</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.02em', color: muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {state.dialogTitle ? truncateMiddle(state.dialogTitle, 20) : '저장 위치'}
          </span>
          <button
            onClick={() => api.dismiss()}
            title="이 다이얼로그에서 닫기"
            style={{ ...chipStyle(border, text, muted, true), padding: 0, width: 24, height: 24, justifyContent: 'center', flexShrink: 0 }}
          >
            <span className="ms-rounded" style={{ fontSize: 14 }}>close</span>
          </button>
        </div>

        {/* Sub-header: back button (drilled) or preset switcher (root) */}
        {drillSpace ? (
          <button
            onClick={() => setDrillSpaceId(null)}
            title="뒤로"
            style={{ ...chipStyle(border, text, muted, true), margin: '6px 8px 0', justifyContent: 'flex-start', gap: 6 }}
          >
            <span className="ms-rounded" style={{ fontSize: 15 }}>arrow_back</span>
            <span style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{drillSpace.name}</span>
          </button>
        ) : (state.presets.length > 1 && (
          <div style={{ padding: '6px 8px 0', flexShrink: 0 }}>
            <PresetDropdown
              presets={state.presets}
              activeId={state.activePresetId}
              viewId={viewPresetId}
              text={text}
              muted={muted}
              border={border}
              onPick={(id) => { setViewPresetId(id); setDrillSpaceId(null); }}
            />
          </div>
        ))}

        {/* Context recommendation — "이 앱·이 파일이면 이 폴더". Only at root
            (not while drilled). Accent-tinted, the single emphasized element.
            Hidden when main couldn't pick one (no fake suggestion). */}
        {!drillSpace && state.recommendation && (
          <button
            onClick={() => onClickFolder('__rec__', state.recommendation!.path)}
            title={state.recommendation.path}
            style={{
              margin: '8px 8px 0', flexShrink: 0,
              display: 'flex', flexDirection: 'column', gap: 3,
              padding: '7px 9px', textAlign: 'left',
              background: hexToRgba(accentHex, light ? 0.10 : 0.16),
              border: `1px solid ${hexToRgba(accentHex, light ? 0.30 : 0.42)}`,
              borderRadius: 9, color: text, cursor: 'pointer',
              fontFamily: 'inherit', WebkitAppRegion: 'no-drag',
              transition: 'background 120ms ease',
            } as React.CSSProperties}
            onMouseEnter={e => { e.currentTarget.style.background = hexToRgba(accentHex, light ? 0.16 : 0.24); }}
            onMouseLeave={e => { e.currentTarget.style.background = hexToRgba(accentHex, light ? 0.10 : 0.16); }}
          >
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em', color: muted }}>
              추천 · {state.recommendation.reason}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              {pendingFolderId === '__rec__' ? (
                <span aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid currentColor', borderTopColor: 'transparent', opacity: 0.7, animation: 'nost-dpopup-spin 700ms linear infinite', flexShrink: 0 }} />
              ) : (
                <span className="ms-rounded" style={{ fontSize: 13, color: T.accent, flexShrink: 0 }}>folder</span>
              )}
              <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {state.recommendation.title}
              </span>
            </span>
          </button>
        )}

        {/* Body — vertical chip list (scrolls internally when tall) */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {drillSpace
            ? (drillSpace.folders.length > 0
                ? drillSpace.folders.map(f => (
                    <Chip
                      key={f.id}
                      block
                      label={f.title}
                      icon="folder"
                      tint={drillSpace.color}
                      muted={muted} text={text} border={border}
                      loading={pendingFolderId === f.id}
                      onClick={() => onClickFolder(f.id, f.path)}
                    />
                  ))
                : <span style={emptyHintStyle(muted, border)}>이 스페이스엔 폴더 카드가 없습니다.</span>)
            : (visibleSpaces.length > 0
                ? visibleSpaces.map(s => (
                    <Chip
                      key={s.id}
                      block
                      label={s.name}
                      icon={s.icon || 'folder'}
                      tint={s.color}
                      muted={muted} text={text} border={border}
                      count={s.folders.length}
                      onClick={() => setDrillSpaceId(s.id)}
                    />
                  ))
                : <span style={emptyHintStyle(muted, border)}>이 프리셋엔 등록된 스페이스가 없습니다.</span>)}
        </div>
      </div>
    </div>
    </>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

function chipStyle(border: string, text: string, muted: string, ghost: boolean, block = false): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    padding: '0 10px',
    flexShrink: 0,
    // Vertical-rail rows fill the width and left-align; horizontal chips
    // stay inline pills.
    ...(block ? { width: '100%', justifyContent: 'flex-start' as const } : null),
    background: 'transparent',
    border: ghost ? '1px solid transparent' : `1px solid ${border}`,
    borderRadius: 7,
    color: ghost ? muted : text,
    fontSize: 11,
    fontFamily: 'inherit',
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    // Opt out of the strip's native drag — buttons / chips must
    // receive their own click instead of moving the window.
    WebkitAppRegion: 'no-drag',
    transition: 'background 120ms ease, border-color 120ms ease',
  } as React.CSSProperties;
}

function Chip({ label, icon, onClick, tint, muted, text, border, count, loading, block }: {
  label: string;
  icon: string;
  onClick: () => void;
  tint?: string;
  muted: string;
  text: string;
  border: string;
  /** Full-width left-aligned row (vertical rail) vs inline pill. */
  block?: boolean;
  /** When set, appended as a small circular badge after the label.
   *  Replaces the earlier ugly inline "이스포츠 2" syntax with a clean
   *  count pill that mirrors the badge-count UI used elsewhere in the
   *  app. Renders even when 0 so the user can tell at a glance "this
   *  space is empty" without drilling in. */
  count?: number;
  /** Folder chip only: render a spinner in place of the icon to signal
   *  that jumpTo is in flight. The PS clipboard-paste latency on a
   *  cold session is enough to make users double-click otherwise. */
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.background = tint ? hexToRgba(tint, 0.12) : T.hover;
        e.currentTarget.style.borderColor = tint ? hexToRgba(tint, 0.4) : border;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = border;
      }}
      style={chipStyle(border, text, muted, false, block)}
    >
      {loading ? (
        <span
          aria-hidden
          style={{
            width: 12, height: 12, borderRadius: '50%',
            border: '1.5px solid currentColor',
            borderTopColor: 'transparent',
            opacity: 0.7,
            animation: 'nost-dpopup-spin 700ms linear infinite',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      ) : (
        <span className="ms-rounded" style={{ fontSize: 13, color: tint || T.accent, opacity: 0.9, flexShrink: 0 }}>{icon}</span>
      )}
      {/* Block rows: label grows + ellipsis, count pinned right. */}
      <span style={block ? { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' } : undefined}>{label}</span>
      {count !== undefined && (
        <span
          aria-label={`${count}개`}
          style={{
            minWidth: 16,
            height: 16,
            padding: '0 5px',
            borderRadius: 8,
            background: tint ? hexToRgba(tint, 0.22) : T.surface,
            color: tint || muted,
            fontSize: 10,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            flexShrink: 0,
            ...(block ? { marginLeft: 'auto' } : null),
            // Disabled-look when zero so the user can spot empty spaces
            // without reading the digit.
            opacity: count === 0 ? 0.45 : 1,
          }}
        >{count}</span>
      )}
    </button>
  );
}

function emptyHintStyle(muted: string, border: string): React.CSSProperties {
  return {
    fontSize: 11,
    color: muted,
    padding: '0 12px',
    whiteSpace: 'nowrap',
    border: `1px dashed ${border}`,
    borderRadius: 7,
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    fontStyle: 'italic',
    flexShrink: 0,
  };
}

/**
 * Self-contained preset switcher. In the v2 vertical rail it lives in the
 * sub-header (full width) and expands INLINE (pushes the chip list down)
 * rather than floating an absolute menu — so it can never clip against the
 * rail/window bounds (오답노트: 쉘 벗어나는 요소 클리핑).
 */
function PresetDropdown({ presets, activeId, viewId, text, muted, border, onPick }: {
  presets: PresetSummary[];
  activeId?: '1' | '2' | '3';
  viewId: '1' | '2' | '3' | null;
  text: string;
  muted: string;
  border: string;
  onPick: (id: '1' | '2' | '3') => void;
}) {
  const [open, setOpen] = useState(false);
  const current = presets.find(p => p.id === viewId) ?? presets[0];

  // ESC closes the inline list (outside-click handled by the rail collapse).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div data-preset-dropdown>
      <button
        onClick={() => setOpen(o => !o)}
        title="프리셋 전환"
        style={{
          ...chipStyle(border, text, muted, false, true),
          background: open ? T.hover : 'transparent',
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 600, color: muted, flexShrink: 0 }}>P{current?.id ?? '?'}</span>
        <span style={{ fontSize: 11, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{current?.label ?? '프리셋'}</span>
        <span className="ms-rounded" style={{ fontSize: 13, color: muted, flexShrink: 0 }}>
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div
          style={{
            // Inline (in-flow) — pushes the body down, never floats out.
            marginTop: 4,
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            background: T.surface,
            border: `1px solid ${border}`,
            borderRadius: 8,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {presets.map(p => {
            const isPicked = p.id === viewId;
            const isGlobalActive = p.id === activeId;
            return (
              <button
                key={p.id}
                onClick={() => { onPick(p.id); setOpen(false); }}
                onMouseEnter={e => { e.currentTarget.style.background = T.hover; }}
                onMouseLeave={e => { e.currentTarget.style.background = isPicked ? T.surface : 'transparent'; }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  background: isPicked ? T.surface : 'transparent',
                  border: 'none',
                  borderRadius: 5,
                  color: text,
                  fontSize: 11,
                  WebkitAppRegion: 'no-drag',
                  fontFamily: 'inherit',
                  fontWeight: isPicked ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 120ms ease',
                } as React.CSSProperties}
              >
                <span style={{ fontSize: 9, fontWeight: 700, color: muted, fontFamily: 'monospace' }}>P{p.id}</span>
                <span style={{ flex: 1 }}>{p.label}</span>
                {isGlobalActive && (
                  <span title="현재 활성 프리셋" style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                )}
                {isPicked && (
                  <span className="ms-rounded" style={{ fontSize: 13 }}>check</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
