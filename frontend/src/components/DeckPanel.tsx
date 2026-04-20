import { useState, useEffect, useRef } from 'react';
import type { Deck, LauncherItem } from '../types';
import { Icon } from '@/components/ui/Icon';

interface DeckPanelProps {
  decks: Deck[];
  allItems: LauncherItem[];
  monitorCount?: number;
  deckBuilding: boolean;
  deckItems: string[];        // IDs selected so far
  onStartBuild: () => void;
  onCancelBuild: () => void;
  onRemoveFromBuilding: (itemId: string) => void;
  onSaveDeck: (name: string) => void;
  onLaunchDeck: (deckId: string) => void;
  onDeleteDeck: (deckId: string) => void;
  onUpdateDeck: (deckId: string, patch: Partial<Pick<Deck, 'name' | 'itemIds' | 'monitor'>>) => void;
}

function getItemIcon(type: LauncherItem['type']) {
  const map: Record<string, string> = {
    url: 'language', folder: 'folder_open', app: 'apps',
    window: 'web_asset', browser: 'public', text: 'content_copy', cmd: 'terminal',
  };
  return map[type] ?? 'link';
}

export function DeckPanel({
  decks, allItems, monitorCount = 1,
  deckBuilding, deckItems,
  onStartBuild, onCancelBuild, onRemoveFromBuilding, onSaveDeck, onLaunchDeck, onDeleteDeck, onUpdateDeck,
}: DeckPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [editName, setEditName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const panelWidth = expanded ? 188 : 36;

  useEffect(() => {
    if (deckBuilding) setEditName('');
  }, [deckBuilding]);

  useEffect(() => {
    if (deckBuilding && deckItems.length >= 2 && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [deckBuilding, deckItems.length]);

  const handleSave = () => {
    if (deckItems.length < 1) return;
    onSaveDeck(editName.trim() || `덱 ${decks.length + 1}`);
    setEditName('');
  };

  const buildingItems = deckItems.map(id => allItems.find(i => i.id === id)).filter(Boolean) as LauncherItem[];

  return (
    <div style={{
      width: panelWidth, minWidth: panelWidth,
      display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--border-rgba)',
      background: 'var(--surface)',
      transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1), min-width 0.2s cubic-bezier(0.4,0,0.2,1)',
      overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: expanded ? '10px 10px 8px' : '10px 0 8px', borderBottom: '1px solid var(--border-rgba)', justifyContent: expanded ? 'space-between' : 'center', flexShrink: 0 }}>
        {expanded && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="stacks" size={14} color="#f97316" />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-color)', whiteSpace: 'nowrap' }}>Deck</span>
          </div>
        )}
        <button onClick={() => setExpanded(e => !e)} style={{ display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', cursor:'pointer', color:'var(--text-dim)', padding:2, borderRadius:4, transition:'color 0.15s' }} onMouseEnter={e => (e.currentTarget.style.color='var(--text-muted)')} onMouseLeave={e => (e.currentTarget.style.color='var(--text-dim)')} title={expanded ? '패널 접기' : 'Deck 패널 열기'}>
          <Icon name="chevron_right" size={14} style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }} />
        </button>
      </div>

      {/* Collapsed */}
      {!expanded && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0' }}>
          {decks.map((d, i) => (
            <button key={d.id} onClick={() => onLaunchDeck(d.id)} title={d.name} style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-hover)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#f97316' }}>{i + 1}</button>
          ))}
          <button onClick={onStartBuild} title="덱 추가" style={{ width: 24, height: 24, borderRadius: 6, background: 'transparent', border: '1px dashed var(--border-rgba)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
            <Icon name="add" size={13} />
          </button>
        </div>
      )}

      {/* Expanded */}
      {expanded && (
        <>
          <div style={{ padding: '5px 10px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 500 }}>{decks.length}개 저장됨</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
            {decks.length === 0 && !deckBuilding && (
              <div style={{ padding: '24px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Icon name="stacks" size={28} color="var(--text-dim)" style={{ opacity: 0.5 }} />
                <p style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>아래 버튼을 눌러<br />덱을 만들어보세요</p>
              </div>
            )}

            {decks.map(deck => {
              const items = deck.itemIds.map(id => allItems.find(i => i.id === id)).filter(Boolean) as LauncherItem[];
              return (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  items={items}
                  monitorCount={monitorCount}
                  onLaunch={() => onLaunchDeck(deck.id)}
                  onDelete={() => onDeleteDeck(deck.id)}
                  onUpdateDeck={onUpdateDeck}
                />
              );
            })}

            {/* Building UI */}
            {deckBuilding && (
              <div style={{ margin: '6px 8px', padding: '10px', background: 'rgba(249,115,22,0.08)', border: '1px solid #f97316', borderRadius: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#f97316', marginBottom: 8 }}>편집 중 ({deckItems.length}개)</div>
                {buildingItems.length === 0 && (
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>왼쪽에서 카드를 클릭하세요<br /><span style={{ opacity: 0.6 }}>(클립보드 제외)</span></p>
                )}
                {buildingItems.map((item, i) => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: i < buildingItems.length - 1 ? '1px solid var(--border-rgba)' : 'none' }}>
                    <span style={{ fontSize: 10, color: '#f97316', fontWeight: 700, minWidth: 12 }}>{i + 1}</span>
                    <Icon name={getItemIcon(item.type)} size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-color)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    <button onClick={() => onRemoveFromBuilding(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)', lineHeight: 1 }}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
                {deckItems.length >= 1 && (
                  <div style={{ marginTop: 10 }}>
                    <input
                      ref={nameInputRef}
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancelBuild(); }}
                      placeholder={`덱 ${decks.length + 1}`}
                      style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-focus)', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: 'var(--text-color)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      <button onClick={handleSave} style={{ flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 600, background: '#f97316', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>저장 (Enter)</button>
                      <button onClick={onCancelBuild} style={{ padding: '5px 8px', fontSize: 10, background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border-rgba)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {!deckBuilding && (
            <div style={{ padding: '8px', flexShrink: 0, borderTop: '1px solid var(--border-rgba)' }}>
              <button
                onClick={onStartBuild}
                style={{ width: '100%', padding: '7px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'transparent', border: '1.5px dashed var(--border-rgba)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, fontFamily: 'inherit', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-rgba)'; e.currentTarget.style.color = 'var(--text-dim)'; }}
              >
                <Icon name="add" size={15} />
                덱 추가
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Deck card ──────────────────────────────────────────────── */
function DeckCard({ deck, items, monitorCount, onLaunch, onDelete, onUpdateDeck }: {
  deck: Deck; items: LauncherItem[]; monitorCount: number;
  onLaunch: () => void; onDelete: () => void;
  onUpdateDeck: (deckId: string, patch: Partial<Pick<Deck, 'name' | 'itemIds' | 'monitor'>>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  return (
    <div
      onClick={!editing ? onLaunch : undefined}
      style={{ margin: '4px 6px', borderRadius: 10, border: `1px solid ${editing ? '#f97316' : 'var(--border-rgba)'}`, background: editing ? 'rgba(249,115,22,0.06)' : 'var(--surface)', transition: 'all 0.15s', overflow: 'hidden', cursor: editing ? 'default' : 'pointer' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px 6px', gap: 6 }}>
        <Icon name="stacks" size={13} color="#f97316" style={{ flexShrink: 0 }} />
        {renaming ? (
          <input autoFocus value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onUpdateDeck(deck.id, { name: renameDraft }); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
            onBlur={e => {
              const next = e.relatedTarget as HTMLElement | null;
              if (next?.closest('[data-rename-done]')) return;
              onUpdateDeck(deck.id, { name: renameDraft });
              setRenaming(false);
            }}
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1, minWidth: 0,
              background: 'var(--bg-rgba)',
              border: '1px solid #f97316',
              outline: 'none',
              borderRadius: 6,
              fontSize: 12, fontWeight: 600,
              color: 'var(--text-color)',
              fontFamily: 'inherit',
              padding: '5px 8px',
              height: 26,
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <span onDoubleClick={e => { e.stopPropagation(); setRenameDraft(deck.name); setRenaming(true); }} style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deck.name}</span>
        )}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {(editing || renaming) ? (
            <button
              data-rename-done
              onMouseDown={e => e.preventDefault()}
              onClick={() => { if (renaming) { onUpdateDeck(deck.id, { name: renameDraft }); setRenaming(false); } setEditing(false); }}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 700,
                background: '#f97316', color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'inherit', height: 26, lineHeight: 1,
              }}>완료</button>
          ) : (
            <>
              <button onClick={e => { e.stopPropagation(); setEditing(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--text-dim)', borderRadius: 5 }} title="편집">
                <Icon name="edit" size={13} />
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--text-dim)', borderRadius: 5 }} title="삭제">
                <Icon name="delete" size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Item list */}
      <div style={{ padding: '0 8px 4px' }} onClick={e => { if (editing) e.stopPropagation(); }}>
        {items.map((item, i) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: editing ? '4px 6px' : '2px 4px', borderRadius: editing ? 6 : 0, background: editing ? 'var(--surface)' : 'transparent', border: editing ? '1px solid var(--border-rgba)' : 'none', marginBottom: editing ? 3 : 0 }}>
            <span style={{ fontSize: 9, color: 'var(--text-dim)', minWidth: 10 }}>{i + 1}</span>
            <Icon name={getItemIcon(item.type)} size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{item.title}</span>
          </div>
        ))}
      </div>

      {/* Monitor selector — edit mode */}
      {editing && (
        <div style={{ padding: '4px 6px 7px', display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
          <span style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 500, flexShrink: 0 }}>모니터</span>
          <div style={{ display: 'flex', gap: 3 }}>
            <button onClick={() => onUpdateDeck(deck.id, { monitor: undefined })} style={{ width: 20, height: 20, borderRadius: 5, fontSize: 8, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', background: deck.monitor === undefined ? '#f97316' : 'var(--surface)', border: `1px solid ${deck.monitor === undefined ? '#f97316' : 'var(--border-rgba)'}`, color: deck.monitor === undefined ? '#fff' : 'var(--text-dim)' }} title="자동">C</button>
            {Array.from({ length: Math.min(monitorCount, 3) }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => onUpdateDeck(deck.id, { monitor: n })} style={{ width: 20, height: 20, borderRadius: 5, fontSize: 8, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', background: deck.monitor === n ? '#f97316' : 'var(--surface)', border: `1px solid ${deck.monitor === n ? '#f97316' : 'var(--border-rgba)'}`, color: deck.monitor === n ? '#fff' : 'var(--text-dim)' }} title={`모니터 ${n}`}>{n}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
