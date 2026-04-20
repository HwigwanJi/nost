import { useState, useRef, useEffect, type CSSProperties } from 'react';
import type { Preset, PresetId } from '../types';
import { Icon } from '@/components/ui/Icon';

/**
 * Preset toggle — 3 compact pills ('1' / '2' / '3') that switch the active
 * preset. Each preset owns its own spaces, nodes, decks, and floating badges,
 * so clicking a pill swaps the entire workspace view. Double-click a pill to
 * rename (label persists to AppData.presets[id].label).
 *
 * Design:
 *  - Lives between the logo and the search bar. Steals ~80px of horizontal
 *    space from the search; the search still absorbs remaining flex.
 *  - Uses the app's accent token for the active state so themed builds keep
 *    a unified primary color.
 *  - 'data-tour-id="preset-toggle"' marks this as a tour anchor so the
 *    tutorial spotlight can target it without a fragile selector.
 */

interface Props {
  presets: Preset[];
  activeId: PresetId;
  onSelect: (id: PresetId) => void;
  onRename: (id: PresetId, label: string) => void;
}

export function PresetToggle({ presets, activeId, onSelect, onRename }: Props) {
  // When user double-clicks a pill we swap it for an inline input.
  const [renamingId, setRenamingId] = useState<PresetId | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  const wrap: CSSProperties = {
    display: 'flex',
    gap: 2,
    padding: 2,
    background: 'var(--surface)',
    border: '1px solid var(--border-rgba)',
    borderRadius: 7,
    flexShrink: 0,
    height: 26,
    alignItems: 'center',
    WebkitAppRegion: 'no-drag',
  } as CSSProperties;

  const pill = (active: boolean): CSSProperties => ({
    minWidth: 22,
    height: 20,
    padding: '0 7px',
    border: 'none',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-dim)',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'inherit',
    borderRadius: 5,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    transition: 'background 0.12s, color 0.12s',
  });

  const commitRename = (id: PresetId) => {
    onRename(id, draft);
    setRenamingId(null);
    setDraft('');
  };

  return (
    <div style={wrap} data-tour-id="preset-toggle" title="프리셋 — 1/2/3번으로 완전히 독립된 작업 공간">
      {presets.map(p => {
        const isActive = p.id === activeId;
        const isRenaming = renamingId === p.id;
        // Show only the id inline; the label is exposed on hover + in
        // rename mode. Keeps the pill compact in the tight title bar.
        return (
          <button
            key={p.id}
            onClick={() => { if (!isRenaming) onSelect(p.id); }}
            onDoubleClick={() => { setRenamingId(p.id); setDraft(p.label); }}
            style={pill(isActive)}
            title={`${p.label} (더블클릭하여 이름 변경)`}
            onMouseEnter={e => { if (!isActive && !isRenaming) e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={e => { if (!isActive && !isRenaming) e.currentTarget.style.background = 'transparent'; }}
          >
            {isRenaming ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename(p.id);
                  else if (e.key === 'Escape') { setRenamingId(null); setDraft(''); }
                  e.stopPropagation();
                }}
                onBlur={() => commitRename(p.id)}
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
                style={{
                  width: 70,
                  height: 16,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '0 4px',
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 3,
                  color: '#fff',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
                maxLength={12}
              />
            ) : (
              <>
                <span>{p.id}</span>
                {isActive && (
                  <Icon name="circle" size={6} color="rgba(255,255,255,0.85)" style={{ marginLeft: -1 }} />
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
