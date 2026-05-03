/**
 * RecommendPanel — inline 3-column smart recommendations.
 *
 * v2 redesign — addresses two problems with v1:
 *   (1) The 320 px fixed-width side panel didn't match nost's main
 *       grid width and felt "싼티" — the user explicitly flagged this.
 *   (2) The engine inside duplicated `getOpenWindows()` work that
 *       ScanDialog and useGhostCards were also doing, with subtly
 *       divergent categorisation. Cursor showed up here as "app" but
 *       elsewhere as "program."
 *
 * v2 differentiator (vs ScanDialog):
 *   ScanDialog is a centred modal that takes over the screen.
 *   RecommendPanel is INLINE — slides in below the title bar, takes
 *   the full content width, and lets the user keep seeing context
 *   (sidebar, search, even other notifications). Same engine, same
 *   data, different surface.
 *
 * Layout (full-width, fixed height ~280 px, slides in from top):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 💡 추천 — 지금 열려있는 항목       [↻ 새로고침]   [✕]          │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ 🪟 앱 (5)         📁 폴더 (3)         🌐 문서 (8)              │
 *   │ ┌────────┐       ┌────────┐         ┌────────┐                │
 *   │ │ Cursor │       │Downloads│        │ChatGPT │                │
 *   │ └────────┘       └────────┘         └────────┘                │
 *   │ ┌────────┐       ┌────────┐         ┌────────┐                │
 *   │ │ Notion │       │Project │         │GitHub  │                │
 *   │ └────────┘       └────────┘         └────────┘                │
 *   │ ...               ...                ...                     │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Plus: high-relevance items also appear as ghost cards in spaces
 * (managed by useGhostCards, kicked off independently when the panel
 * opens — see App.tsx wiring).
 *
 * Click model:
 *   - Card click → opens space picker → adds to selected space
 *   - The space picker is a tiny inline popover under the card so the
 *     user doesn't have to leave the panel to commit
 *
 * ESC: closes the panel via the global escape stack.
 */

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { LauncherItem, Space, WindowEntry, ChromeTab } from '../types';
import { electronAPI } from '../electronBridge';
import { scanCurrentEnvironment, type ScanResult } from '../lib/scanEngine';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface RecommendPanelProps {
  open: boolean;
  spaces: Space[];
  onClose: () => void;
  onAddItems: (spaceId: string, items: Omit<LauncherItem, 'id'>[]) => void;
}

interface PendingAdd {
  /** Anchor element for positioning the space-picker popover. */
  anchorRect: DOMRect;
  item: Omit<LauncherItem, 'id'>;
}

export function RecommendPanel({ open, spaces, onClose, onAddItems }: RecommendPanelProps) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingAdd | null>(null);
  // Resolved icons for app entries — populated lazily after the
  // initial scan render so the panel paints fast and decorates after.
  const [appIcons, setAppIcons] = useState<Record<string, string>>({});

  useEscapeKey(() => {
    if (pending) { setPending(null); return; }
    onClose();
  }, open);

  // Filter out values already in any space — same dedup rule as
  // ScanDialog (so a recommendation never re-suggests something the
  // user already has).
  const existingValues = useMemo(() => {
    const set = new Set<string>();
    for (const s of spaces) for (const it of s.items) set.add(it.value.toLowerCase());
    return set;
  }, [spaces]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await scanCurrentEnvironment();
    // Local filter for "already in a space" — done here rather than
    // in the engine because the engine doesn't know about spaces.
    const apps = r.apps.filter(w => w.ExePath && !existingValues.has(w.ExePath.toLowerCase()));
    const folders = r.folders.filter(w => w.FolderPath && !existingValues.has(w.FolderPath.toLowerCase()));
    const documents = r.documents.filter(t => t.url && !existingValues.has(t.url.toLowerCase()));
    setScan({ apps, folders, documents, recentItems: r.recentItems });
    setLoading(false);
  }, [existingValues]);

  useEffect(() => {
    if (!open) {
      setScan(null);
      setPending(null);
      return;
    }
    void refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lazy icon resolution for app entries (parity with ScanDialog).
  // Skip while loading or no scan yet; only fetch icons not yet in
  // the map, so a re-scan reuses cached resolutions.
  useEffect(() => {
    if (!open || !scan?.apps?.length) return;
    let cancelled = false;
    (async () => {
      const need = scan.apps.filter(a => a.ExePath && !appIcons[a.ExePath]);
      const pairs = await Promise.all(
        need.map(async w => ({
          path: w.ExePath!,
          icon: await electronAPI.getFileIcon(w.ExePath!),
        }))
      );
      if (cancelled) return;
      const next = { ...appIcons };
      for (const p of pairs) if (p.icon) next[p.path] = p.icon;
      setAppIcons(next);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scan?.apps]);

  if (!open) return null;

  const total = (scan?.apps.length ?? 0) + (scan?.folders.length ?? 0) + (scan?.documents.length ?? 0);

  return (
    <>
      {/* Inline animation keyframes — scoped, runs once on mount. */}
      <style>{`
        @keyframes recommendPanelIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        data-tour-id="recommend-panel"
        style={{
          // Inline flex item — sits as a sibling above the spaces grid
          // and PUSHES the grid down by its own height instead of
          // overlaying it. Earlier the panel was position:absolute and
          // the user couldn't see whichever spaces were behind it.
          // Same visual silhouette, just no z-index trick.
          flexShrink: 0,
          height: 280,
          background: 'var(--bg-rgba)',
          borderBottom: '1px solid var(--border-rgba)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
          animation: 'recommendPanelIn 0.18s cubic-bezier(0.34, 1.4, 0.64, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderBottom: '1px solid var(--border-rgba)',
            flexShrink: 0,
          }}
        >
          <Icon name="lightbulb" size={15} color="var(--accent)" />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-color)' }}>스마트 추천</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {loading ? '스캔 중…' : `현재 열려있는 항목 ${total}개`}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => void refresh()}
            disabled={loading}
            title="다시 스캔"
            style={iconBtnStyle}
          >
            <Icon name="refresh" size={14} style={loading ? { animation: 'spin 0.9s linear infinite' } : undefined} />
          </button>
          <button onClick={onClose} title="닫기 (Esc)" style={iconBtnStyle}>
            <Icon name="close" size={14} />
          </button>
        </div>

        {/* Body — 3-column grid */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 1,
            background: 'var(--border-rgba)',
            overflow: 'hidden',
          }}
        >
          <Column
            icon="apps"
            label="앱"
            count={scan?.apps.length ?? 0}
            empty={!loading && scan?.apps.length === 0}
            loading={loading}
          >
            {scan?.apps.map((w, i) => (
              <RecommendCard
                key={`${w.ExePath ?? w.MainWindowTitle}-${i}`}
                title={w.MainWindowTitle || w.ProcessName}
                subtitle={w.ProcessName}
                imageIconUrl={w.ExePath ? appIcons[w.ExePath] : undefined}
                fallbackIcon="apps"
                onClick={(rect) => setPending({
                  anchorRect: rect,
                  item: makeAppItem(w, w.ExePath ? appIcons[w.ExePath] : undefined),
                })}
              />
            ))}
          </Column>

          <Column
            icon="folder_open"
            label="폴더"
            count={scan?.folders.length ?? 0}
            empty={!loading && scan?.folders.length === 0}
            loading={loading}
          >
            {scan?.folders.map((w, i) => (
              <RecommendCard
                key={`${w.FolderPath ?? w.MainWindowTitle}-${i}`}
                title={w.MainWindowTitle || (w.FolderPath?.split('\\').pop() ?? '')}
                subtitle={w.FolderPath}
                fallbackIcon="folder_open"
                onClick={(rect) => setPending({
                  anchorRect: rect,
                  item: makeFolderItem(w),
                })}
              />
            ))}
          </Column>

          <Column
            icon="description"
            label="문서"
            count={scan?.documents.length ?? 0}
            empty={!loading && scan?.documents.length === 0}
            loading={loading}
          >
            {scan?.documents.map((t) => (
              <RecommendCard
                key={t.id}
                title={t.title || t.url}
                subtitle={hostnameOf(t.url)}
                imageIconUrl={t.favIconUrl}
                fallbackIcon="public"
                onClick={(rect) => setPending({
                  anchorRect: rect,
                  item: makeUrlItem(t),
                })}
              />
            ))}
          </Column>
        </div>

        {/* Space-picker popover (commits a single item to the chosen space) */}
        {pending && (
          <SpacePicker
            spaces={spaces}
            anchor={pending.anchorRect}
            onPick={(spaceId) => {
              onAddItems(spaceId, [pending.item]);
              setPending(null);
              // Locally remove the just-added item so the slot
              // disappears immediately — re-scan would also remove
              // it (existingValues filter), but waiting for the round
              // trip feels laggy.
              setScan(prev => prev ? {
                ...prev,
                apps: prev.apps.filter(a => a.ExePath !== pending.item.value && a.MainWindowTitle !== pending.item.value),
                folders: prev.folders.filter(f => f.FolderPath !== pending.item.value),
                documents: prev.documents.filter(d => d.url !== pending.item.value),
                recentItems: prev.recentItems,
              } : prev);
            }}
            onClose={() => setPending(null)}
          />
        )}
      </div>
    </>
  );
}

/* ── Column ───────────────────────────────────────────────────── */
function Column({
  icon, label, count, empty, loading, children,
}: {
  icon: string;
  label: string;
  count: number;
  empty: boolean;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-rgba)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-rgba)',
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={12} color="var(--text-muted)" />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{label}</span>
        {count > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>· {count}</span>
        )}
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minHeight: 0,
        }}
      >
        {loading && (
          <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
            <Icon name="sync" size={14} className="animate-spin" /> 스캔 중...
          </div>
        )}
        {!loading && empty && (
          <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
            열려있는 {label} 없음
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ── Recommend card — single row in a column ──────────────────── */
function RecommendCard({
  title, subtitle, imageIconUrl, fallbackIcon, onClick,
}: {
  title: string;
  subtitle?: string;
  imageIconUrl?: string;
  fallbackIcon: string;
  onClick: (rect: DOMRect) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

  return (
    <button
      ref={ref}
      onClick={() => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) onClick(rect);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        background: 'var(--surface)',
        border: '1px solid var(--border-rgba)',
        borderRadius: 7,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'background 0.12s, border-color 0.12s',
        minWidth: 0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.borderColor = 'var(--border-focus)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--surface)';
        e.currentTarget.style.borderColor = 'var(--border-rgba)';
      }}
      title={subtitle ? `${title}\n${subtitle}` : title}
    >
      <span
        style={{
          flexShrink: 0,
          width: 18, height: 18,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 4,
          background: 'var(--surface-hover)',
        }}
      >
        {imageIconUrl && !imageFailed ? (
          <img
            src={imageIconUrl}
            alt=""
            style={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 2 }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Icon name={fallbackIcon} size={11} color="var(--text-muted)" />
        )}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-color)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
    </button>
  );
}

/* ── Space picker — tiny popover under the clicked card ─────── */
function SpacePicker({
  spaces, anchor, onPick, onClose,
}: {
  spaces: Space[];
  anchor: DOMRect;
  onPick: (spaceId: string) => void;
  onClose: () => void;
}) {
  // Position right below the anchored card, clamped to viewport.
  const top = Math.min(window.innerHeight - 220, anchor.bottom + 4);
  const left = Math.min(window.innerWidth - 220, anchor.left);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99,
        }}
      />
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          left, top,
          width: 200,
          maxHeight: 240,
          overflowY: 'auto',
          background: 'var(--bg-rgba)',
          border: '1px solid var(--border-rgba)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          zIndex: 100,
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-dim)', padding: '4px 8px 6px', letterSpacing: '0.05em' }}>
          어느 스페이스에 추가할까요?
        </div>
        {spaces.map(s => (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 8px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: 5,
              fontFamily: 'inherit',
              fontSize: 11,
              color: 'var(--text-color)',
              textAlign: 'left',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {s.color && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */
function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function makeAppItem(w: WindowEntry, iconUrl?: string): Omit<LauncherItem, 'id'> {
  return {
    title: w.MainWindowTitle || w.ProcessName,
    value: w.ExePath || w.MainWindowTitle,
    type: 'app',
    iconType: iconUrl ? 'image' : 'material',
    icon: iconUrl ?? 'apps',
    exePath: w.ExePath,
  };
}

function makeFolderItem(w: WindowEntry): Omit<LauncherItem, 'id'> {
  return {
    title: w.MainWindowTitle || (w.FolderPath?.split('\\').pop() ?? ''),
    value: w.FolderPath || w.MainWindowTitle,
    type: 'folder',
    iconType: 'material',
    icon: 'folder_open',
  };
}

function makeUrlItem(t: ChromeTab): Omit<LauncherItem, 'id'> {
  return {
    title: t.title || t.url,
    value: t.url,
    type: 'url',
    iconType: t.favIconUrl ? 'image' : 'material',
    icon: t.favIconUrl ?? 'public',
  };
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  width: 26, height: 26,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  transition: 'background 0.12s, color 0.12s',
  fontFamily: 'inherit',
};
