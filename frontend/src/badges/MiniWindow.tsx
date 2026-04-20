import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { BadgeData, BadgeItem } from './Badge';

/**
 * MiniWindow — the popover that appears when the user clicks a floating badge.
 *
 * Design intent:
 *  - ONLY shows the ref's items (space items / node items / deck items). No
 *    search bar, no clipboard suggestion, no settings — the point of the
 *    mini-window is a laser-focused mini-launcher for that one ref.
 *  - Positioned anchored to the badge's screen coord. Auto-flips to the
 *    opposite side when it would spill past the virtual-desktop bounds.
 *  - Closes on outside click, Escape, item launch, or badge re-click (toggle).
 *
 * The window lives INSIDE the single badge-overlay BrowserWindow (not a new
 * OS window) so the RAM cost stays flat regardless of how many badges are
 * pinned. The parent (BadgeOverlay) is responsible for telling the overlay's
 * click-through layer to capture events — MiniWindow itself just needs
 * `data-badge` on its root so the existing hover-to-capture logic keeps the
 * window interactive.
 */

const WIDTH = 240;
const ITEM_ROW = 34;
const MAX_ROWS = 9;

// Material-symbol names for LauncherItem types — mirrors NodePanel/ItemCard
// so cold-read users see the same iconography.
const TYPE_ICON: Record<BadgeItem['type'], string> = {
  url:     'language',
  folder:  'folder_open',
  app:     'apps',
  window:  'web_asset',
  browser: 'public',
  text:    'content_copy',
  cmd:     'terminal',
};

interface MiniWindowApi {
  launchItem:   (refType: BadgeData['refType'], refId: string, itemId: string) => void;
  launchRef:    (refType: BadgeData['refType'], refId: string) => void;
  close:        () => void;
}

interface Props {
  badge: BadgeData;
  originX: number;                // overlay BrowserWindow's screen-x origin
  originY: number;
  overlayWidth: number;           // for auto-flip when popover would overflow
  overlayHeight: number;
  api: MiniWindowApi;
}

function hexToRgba(hex: string, alpha: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m) return `rgba(99, 102, 241, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function MiniWindow({
  badge, originX, originY, overlayWidth, overlayHeight, api,
}: Props) {
  const color = badge.color ?? '#6366f1';
  const items = badge.items ?? [];
  const rowCount = Math.min(items.length, MAX_ROWS);
  // Height = header(36) + rows(ITEM_ROW*n) + bottom-pad(8) + optional "launch all" row(32)
  const hasLaunchAll = badge.refType === 'node' || badge.refType === 'deck';
  const height = 36 + rowCount * ITEM_ROW + 8 + (hasLaunchAll ? 32 : 0);

  // Anchor to the right of the badge; auto-flip left if that would overflow.
  // Similarly flip vertically (open upward) when popping down would overflow.
  const BADGE_R = 23; // half of 46
  const anchorCx = badge.x - originX + BADGE_R;
  const anchorCy = badge.y - originY + BADGE_R;

  const GAP = 12;
  // Preferred: right + slightly below the badge centre (top-aligned with badge top)
  let left = anchorCx + BADGE_R + GAP;
  let top  = anchorCy - BADGE_R;
  if (left + WIDTH > overlayWidth - 8) {
    // Not enough room to the right — flip to the left.
    left = anchorCx - BADGE_R - GAP - WIDTH;
  }
  if (top + height > overlayHeight - 8) {
    top = Math.max(8, anchorCy + BADGE_R - height);
  }
  if (top < 8) top = 8;
  if (left < 8) left = 8;

  // ── Focus trap + keyboard handling ────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);

  // Outside click → close. Handled via mousedown on window; the hover-capture
  // logic in BadgeOverlay guarantees the overlay window is click-capturing
  // whenever the pointer is over MiniWindow (data-badge keeps it active).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      const inside = rootRef.current.contains(e.target as Node);
      // Also treat clicks on the originating badge as "not outside" — that
      // click is handled by Badge itself (toggle close).
      const onOwnBadge = (e.target as HTMLElement | null)
        ?.closest?.(`[data-badge="${badge.id}"]`);
      if (!inside && !onOwnBadge) api.close();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [api, badge.id]);

  // ── Styles ─────────────────────────────────────────────
  const panel: CSSProperties = {
    position: 'absolute',
    left, top,
    width: WIDTH,
    maxHeight: height,
    borderRadius: 14,
    background: 'rgba(17, 17, 34, 0.88)',
    backdropFilter: 'blur(22px) saturate(160%)',
    border: `1px solid ${hexToRgba(color, 0.45)}`,
    boxShadow: `0 16px 40px rgba(0,0,0,0.5), 0 0 0 1px ${hexToRgba(color, 0.18)}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    // data-badge keeps the overlay in capture mode while the cursor is here.
    animation: 'nost-mini-in 180ms cubic-bezier(0.22, 1, 0.36, 1)',
  };

  const header: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px 6px 12px',
    borderBottom: `1px solid ${hexToRgba(color, 0.16)}`,
    flexShrink: 0,
  };

  const titleText: CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: 600,
    color: '#f3f4f6',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    letterSpacing: '-0.01em',
  };

  const closeBtn: CSSProperties = {
    width: 20, height: 20,
    borderRadius: 5,
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.55)',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14,
    lineHeight: 1,
    flexShrink: 0,
  };

  const list: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0',
  };

  const row = (hover: boolean, hasColor: boolean, c: string): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 10px 0 12px',
    height: ITEM_ROW,
    cursor: 'pointer',
    background: hover ? hexToRgba(c || color, 0.18) : 'transparent',
    borderLeft: hasColor ? `2px solid ${c}` : '2px solid transparent',
    transition: 'background 80ms ease',
  });

  const rowIcon: CSSProperties = {
    width: 18, height: 18,
    flexShrink: 0,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: '"Material Symbols Rounded", "Material Symbols Outlined"',
    fontSize: 16,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const rowText: CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontSize: 11.5,
    color: '#e5e7eb',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const launchAllRow: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 32,
    borderTop: `1px solid ${hexToRgba(color, 0.16)}`,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    color: color,
    background: hexToRgba(color, 0.10),
    flexShrink: 0,
  };

  const emptyHint: CSSProperties = {
    padding: '14px 12px',
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 1.5,
  };

  const [hoverId, setHoverId] = useState<string | null>(null);

  return (
    <>
      <style>{`
        @keyframes nost-mini-in {
          from { opacity: 0; transform: translateY(-6px) scale(0.96); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
      <div
        ref={rootRef}
        data-badge={badge.id}
        style={panel}
        // onContextMenu inside mini should NOT propagate up to the overlay's
        // right-click handler (which would open the badge context menu).
        onContextMenu={e => e.stopPropagation()}
      >
        <div style={header}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0,
          }} />
          <span style={titleText}>{badge.label}</span>
          <button
            style={closeBtn}
            onClick={api.close}
            title="닫기 (Esc)"
          >×</button>
        </div>

        {items.length === 0 ? (
          <div style={emptyHint}>
            {badge.refType === 'space'
              ? '이 스페이스에 카드가 없습니다'
              : '이 묶음에 항목이 없습니다'}
          </div>
        ) : (
          <div style={list}>
            {items.map(it => {
              const c = it.color ?? color;
              const iconGlyph = it.iconType === 'image' && it.icon
                ? null  // will render as <img>
                : (it.icon || TYPE_ICON[it.type]);
              return (
                <div
                  key={it.id}
                  style={row(hoverId === it.id, !!it.color, c)}
                  onMouseEnter={() => setHoverId(it.id)}
                  onMouseLeave={() => setHoverId(prev => prev === it.id ? null : prev)}
                  onClick={() => {
                    api.launchItem(badge.refType, badge.refId, it.id);
                    api.close();
                  }}
                  title={it.title}
                >
                  {it.iconType === 'image' && it.icon ? (
                    <img
                      src={it.icon}
                      alt=""
                      style={{
                        width: 18, height: 18, borderRadius: 4, objectFit: 'cover', flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span style={rowIcon}>{iconGlyph}</span>
                  )}
                  <span style={rowText}>{it.title}</span>
                  {it.pinned && (
                    <span style={{
                      fontSize: 9, color: hexToRgba(c, 0.9),
                      fontFamily: '"Material Symbols Rounded"',
                    }}>keep</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hasLaunchAll && items.length > 0 && (
          <div
            style={launchAllRow}
            onClick={() => {
              api.launchRef(badge.refType, badge.refId);
              api.close();
            }}
            title={badge.refType === 'node' ? '묶음 실행' : '순차 실행'}
          >
            <span style={{ fontFamily: '"Material Symbols Rounded"', fontSize: 13 }}>
              {badge.refType === 'node' ? 'hub' : 'play_arrow'}
            </span>
            {badge.refType === 'node' ? '묶음 실행' : '순차 실행'}
          </div>
        )}
      </div>
    </>
  );
}
