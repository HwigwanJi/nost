import { useState, useEffect, useRef } from 'react';
import type { NodeGroup, Deck, LauncherItem } from '../types';
import { Icon } from '@/components/ui/Icon';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const DECK_COLOR = '#f97316';

interface NodePanelProps {
  draggingItemId?: string | null;
  // ── Node ──────────────────────────────────────────────────
  nodeGroups: NodeGroup[];
  monitorCount?: number;
  nodeEditMode: boolean;
  nodeBuilding: string[];
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onRemoveFromBuilding: (itemId: string) => void;
  onSaveGroup: (name: string) => void;
  onLaunchGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onReorderGroupItems: (groupId: string, itemIds: string[]) => void;
  onUpdateGroup: (groupId: string, patch: Partial<Pick<NodeGroup, 'name' | 'itemIds' | 'monitor'>>) => void;
  // ── Deck ──────────────────────────────────────────────────
  decks: Deck[];
  deckBuilding: boolean;
  deckItems: string[];
  onStartDeckBuild: () => void;
  onCancelDeckBuild: () => void;
  onRemoveFromDeckBuilding: (itemId: string) => void;
  onSaveDeck: (name: string) => void;
  onLaunchDeck: (deckId: string) => void;
  onDeleteDeck: (deckId: string) => void;
  onUpdateDeck: (deckId: string, patch: Partial<Pick<Deck, 'name' | 'itemIds' | 'monitor'>>) => void;
  // ── Common ─────────────────────────────────────────────────
  allItems: LauncherItem[];
}

function getItemIcon(type: LauncherItem['type']) {
  const map: Record<string, string> = {
    url: 'language', folder: 'folder_open', app: 'apps',
    window: 'web_asset', browser: 'public', text: 'content_copy', cmd: 'terminal',
  };
  return map[type] ?? 'link';
}

export function NodePanel({
  draggingItemId,
  nodeGroups, allItems, monitorCount = 1,
  nodeEditMode, nodeBuilding,
  onStartEdit, onCancelEdit, onRemoveFromBuilding, onSaveGroup, onLaunchGroup,
  onDeleteGroup, onRenameGroup, onReorderGroupItems, onUpdateGroup,
  decks, deckBuilding, deckItems,
  onStartDeckBuild, onCancelDeckBuild, onRemoveFromDeckBuilding,
  onSaveDeck, onLaunchDeck, onDeleteDeck, onUpdateDeck,
}: NodePanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState<'all' | 'node' | 'deck'>('all');

  // Node state
  const [nodeEditName, setNodeEditName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const nodeNameRef = useRef<HTMLInputElement>(null);

  // Deck state
  const [deckEditName, setDeckEditName] = useState('');
  const deckNameRef = useRef<HTMLInputElement>(null);

  const panelWidth = expanded ? 208 : 36;

  // Auto-switch filter on mode change so building UI is visible
  useEffect(() => { if (nodeEditMode) setFilter('node'); }, [nodeEditMode]);
  useEffect(() => { if (deckBuilding) setFilter('deck'); }, [deckBuilding]);

  // Auto-focus name input
  useEffect(() => {
    if (nodeEditMode && nodeBuilding.length >= 2) nodeNameRef.current?.focus();
  }, [nodeEditMode, nodeBuilding.length]);
  useEffect(() => {
    if (deckBuilding && deckItems.length >= 1) deckNameRef.current?.focus();
  }, [deckBuilding, deckItems.length]);

  // Reset name inputs on edit start
  useEffect(() => { if (nodeEditMode) setNodeEditName(''); }, [nodeEditMode]);
  useEffect(() => { if (deckBuilding) setDeckEditName(''); }, [deckBuilding]);

  const handleSaveNode = () => {
    if (nodeBuilding.length < 2) return;
    onSaveGroup(nodeEditName.trim() || `노드 ${nodeGroups.length + 1}`);
    setNodeEditName('');
  };
  const handleSaveDeck = () => {
    if (deckItems.length < 1) return;
    onSaveDeck(deckEditName.trim() || `덱 ${decks.length + 1}`);
    setDeckEditName('');
  };

  const nodeBuildingItems = nodeBuilding.map(id => allItems.find(i => i.id === id)).filter(Boolean) as LauncherItem[];
  const deckBuildingItems = deckItems.map(id => allItems.find(i => i.id === id)).filter(Boolean) as LauncherItem[];

  return (
    <div style={{
      width: panelWidth, minWidth: panelWidth,
      display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--border-rgba)',
      background: 'var(--surface)',
      transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1), min-width 0.2s cubic-bezier(0.4,0,0.2,1)',
      overflow: 'hidden', flexShrink: 0, position: 'relative',
    }}>

      {/* ── Header ─────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: expanded ? '10px 6px 10px 10px' : '10px 0',
        borderBottom: '1px solid var(--border-rgba)',
        justifyContent: expanded ? 'space-between' : 'center',
        flexShrink: 0,
      }}>
        {expanded && (
          <>
            <Icon name="grid_view" size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-color)', flex: 1, whiteSpace: 'nowrap' }}>Table</span>
            {/* Filter pills */}
            {(['all', 'node', 'deck'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '2px 6px', fontSize: 9, fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                background: filter === f ? (f === 'deck' ? DECK_COLOR : 'var(--accent)') : 'transparent',
                border: `1px solid ${filter === f ? (f === 'deck' ? DECK_COLOR : 'var(--accent)') : 'var(--border-rgba)'}`,
                color: filter === f ? '#fff' : 'var(--text-dim)',
                transition: 'all 0.12s',
              }}>
                {f === 'all' ? '전체' : f === 'node' ? `노드${nodeGroups.length > 0 ? ` ${nodeGroups.length}` : ''}` : `덱${decks.length > 0 ? ` ${decks.length}` : ''}`}
              </button>
            ))}
          </>
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-dim)', padding: '2px 2px', borderRadius: 4,
            transition: 'color 0.15s', flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          title={expanded ? '패널 접기' : '패널 열기'}
        >
          <Icon name="chevron_right" size={14} style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }} />
        </button>
      </div>

      {/* ── Collapsed: icon strip ──────────────────── */}
      {!expanded && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '8px 0', overflowY: 'auto' }}>
          {/* Node icons */}
          {nodeGroups.map((g, i) => (
            <button key={g.id} onClick={() => onLaunchGroup(g.id)} title={g.name}
              style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-hover)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>
              {i + 1}
            </button>
          ))}
          {!nodeEditMode && !deckBuilding && (
            <button onClick={onStartEdit} title="노드 추가"
              style={{ width: 24, height: 24, borderRadius: 6, background: 'transparent', border: '1px dashed var(--border-rgba)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
              <Icon name="hub" size={12} />
            </button>
          )}
          {/* Separator */}
          {(nodeGroups.length > 0 || decks.length > 0) && (
            <div style={{ width: 16, height: 1, background: 'var(--border-rgba)', margin: '2px 0' }} />
          )}
          {/* Deck icons */}
          {decks.map((d, i) => (
            <button key={d.id} onClick={() => onLaunchDeck(d.id)} title={d.name}
              style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-hover)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: DECK_COLOR }}>
              {i + 1}
            </button>
          ))}
          {!nodeEditMode && !deckBuilding && (
            <button onClick={onStartDeckBuild} title="덱 추가"
              style={{ width: 24, height: 24, borderRadius: 6, background: 'transparent', border: '1px dashed var(--border-rgba)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
              <Icon name="stacks" size={12} />
            </button>
          )}
        </div>
      )}

      {/* ── Expanded: unified list ─────────────────── */}
      {expanded && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>

            {/* Empty state */}
            {nodeGroups.length === 0 && decks.length === 0 && !nodeEditMode && !deckBuilding && (
              <div style={{ padding: '28px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Icon name="hub" size={28} color="var(--text-dim)" style={{ opacity: 0.4 }} />
                <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>아래 버튼으로<br />노드 또는 덱을 만들어보세요</p>
              </div>
            )}

            {/* ── Node groups ──────────────────────── */}
            {(filter === 'all' || filter === 'node') && nodeGroups.map(group => {
              const items = group.itemIds.map(id => allItems.find(i => i.id === id)).filter(Boolean) as LauncherItem[];
              return (
                <NodeGroupCard
                  key={group.id}
                  group={group} items={items} allItems={allItems} monitorCount={monitorCount}
                  isRenaming={renamingId === group.id} renameDraft={renameDraft}
                  draggingItemId={draggingItemId}
                  onLaunch={() => onLaunchGroup(group.id)}
                  onDelete={() => onDeleteGroup(group.id)}
                  onStartRename={() => { setRenamingId(group.id); setRenameDraft(group.name); }}
                  onRenameDraftChange={setRenameDraft}
                  onRenameConfirm={() => { onRenameGroup(group.id, renameDraft); setRenamingId(null); }}
                  onRenameCancel={() => setRenamingId(null)}
                  onReorderItems={itemIds => onReorderGroupItems(group.id, itemIds)}
                  onSetMonitor={monitor => onUpdateGroup(group.id, { monitor })}
                />
              );
            })}

            {/* Node building UI */}
            {(filter === 'all' || filter === 'node') && nodeEditMode && (
              <NodeDropZone id="drop-node-building" draggingItemId={draggingItemId}>
              <div style={{ margin: '6px 8px', padding: '10px', background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>노드 편집 중 ({nodeBuilding.length}/3)</div>
                {nodeBuildingItems.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>왼쪽에서 카드를 클릭하세요</p>}
                {nodeBuildingItems.map((item, i) => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: i < nodeBuildingItems.length - 1 ? '1px solid var(--border-rgba)' : 'none' }}>
                    <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, minWidth: 12 }}>{i + 1}</span>
                    <Icon name={getItemIcon(item.type)} size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-color)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    <button onClick={() => onRemoveFromBuilding(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)', lineHeight: 1 }}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
                {nodeBuilding.length >= 2 && (
                  <div style={{ marginTop: 10 }}>
                    <input ref={nodeNameRef} value={nodeEditName} onChange={e => setNodeEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveNode(); if (e.key === 'Escape') onCancelEdit(); }}
                      placeholder={`노드 ${nodeGroups.length + 1}`}
                      style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-focus)', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: 'var(--text-color)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      <button onClick={handleSaveNode} style={{ flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>저장 (Enter)</button>
                      <button onClick={onCancelEdit} style={{ padding: '5px 8px', fontSize: 10, background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border-rgba)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
                    </div>
                  </div>
                )}
              </div>
              </NodeDropZone>
            )}

            {/* Separator between node and deck when showing all */}
            {filter === 'all' && nodeGroups.length > 0 && decks.length > 0 && (
              <div style={{ height: 1, background: 'var(--border-rgba)', margin: '4px 10px' }} />
            )}

            {/* ── Decks ────────────────────────────── */}
            {(filter === 'all' || filter === 'deck') && decks.map(deck => {
              const items = deck.itemIds.map(id => allItems.find(i => i.id === id)).filter(Boolean) as LauncherItem[];
              return (
                <DeckCard
                  key={deck.id}
                  deck={deck} items={items} monitorCount={monitorCount}
                  draggingItemId={draggingItemId}
                  onLaunch={() => onLaunchDeck(deck.id)}
                  onDelete={() => onDeleteDeck(deck.id)}
                  onUpdateDeck={onUpdateDeck}
                />
              );
            })}

            {/* Deck building UI */}
            {(filter === 'all' || filter === 'deck') && deckBuilding && (
              <DeckDropZone id="drop-deck-building" draggingItemId={draggingItemId}>
              <div style={{ margin: '6px 8px', padding: '10px', background: 'rgba(249,115,22,0.08)', border: `1px solid ${DECK_COLOR}`, borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: DECK_COLOR, marginBottom: 8 }}>
                  덱 편집 중 ({deckItems.length}개)
                </div>
                {deckBuildingItems.length === 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>왼쪽에서 카드를 클릭하세요</p>
                )}
                {deckBuildingItems.map((item, i) => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: i < deckBuildingItems.length - 1 ? '1px solid var(--border-rgba)' : 'none' }}>
                    <span style={{ fontSize: 10, color: DECK_COLOR, fontWeight: 700, minWidth: 12 }}>{i + 1}</span>
                    <Icon name={getItemIcon(item.type)} size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-color)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    <button onClick={() => onRemoveFromDeckBuilding(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)', lineHeight: 1 }}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
                {deckItems.length >= 1 && (
                  <div style={{ marginTop: 10 }}>
                    <input
                      ref={deckNameRef}
                      value={deckEditName}
                      onChange={e => setDeckEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveDeck(); if (e.key === 'Escape') onCancelDeckBuild(); }}
                      placeholder={`덱 ${decks.length + 1}`}
                      style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-focus)', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: 'var(--text-color)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      <button onClick={handleSaveDeck} style={{ flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 600, background: DECK_COLOR, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>저장 (Enter)</button>
                      <button onClick={onCancelDeckBuild} style={{ padding: '5px 8px', fontSize: 10, background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border-rgba)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
                    </div>
                  </div>
                )}
              </div>
              </DeckDropZone>
            )}
          </div>

          {/* ── Bottom add buttons ────────────────── */}
          {!nodeEditMode && !deckBuilding && (
            <div style={{ padding: '6px 8px 8px', flexShrink: 0, borderTop: '1px solid var(--border-rgba)', display: 'flex', gap: 5 }}>
              {(filter === 'all' || filter === 'node') && (
                <button onClick={onStartEdit}
                  style={{ flex: 1, padding: '6px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'transparent', border: '1.5px dashed var(--border-rgba)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 10, fontFamily: 'inherit', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-rgba)'; e.currentTarget.style.color = 'var(--text-dim)'; }}>
                  <Icon name="hub" size={13} />
                  {filter === 'node' || filter === 'all' ? '노드' : ''}
                </button>
              )}
              {(filter === 'all' || filter === 'deck') && (
                <button onClick={onStartDeckBuild}
                  style={{ flex: 1, padding: '6px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'transparent', border: '1.5px dashed var(--border-rgba)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 10, fontFamily: 'inherit', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = DECK_COLOR; e.currentTarget.style.color = DECK_COLOR; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-rgba)'; e.currentTarget.style.color = 'var(--text-dim)'; }}>
                  <Icon name="stacks" size={13} />
                  {filter === 'deck' || filter === 'all' ? '덱' : ''}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Sortable item row inside NodeGroupCard ─────────────────── */
function SortableNodeItem({ item, index, editing, onRemove }: {
  item: LauncherItem; index: number; editing: boolean; onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.35 : 1,
        display: 'flex', alignItems: 'center', gap: 5,
        padding: editing ? '4px 6px' : '2px 4px',
        borderRadius: editing ? 6 : 0,
        // Elevation: elevated background + shadow when in edit mode
        background: editing ? 'var(--bg-rgba)' : 'transparent',
        border: editing ? '1px solid var(--border-focus)' : 'none',
        boxShadow: editing && !isDragging ? '0 2px 6px rgba(0,0,0,0.13)' : 'none',
        marginBottom: editing ? 4 : 0,
        position: 'relative',
        zIndex: isDragging ? 10 : 1,
        animation: editing ? 'nodeItemIn 0.18s cubic-bezier(0.22,1,0.36,1)' : 'none',
      }}
    >
      {editing && (
        <span {...attributes} {...listeners} className="material-symbols-rounded"
          style={{ fontSize: 12, color: 'var(--accent)', cursor: 'grab', flexShrink: 0, touchAction: 'none', lineHeight: 1, opacity: 0.7 }}
          title="드래그하여 순서 변경">
          drag_indicator
        </span>
      )}
      <span style={{ fontSize: 9, color: 'var(--text-dim)', minWidth: 10 }}>{index + 1}</span>
      <Icon name={getItemIcon(item.type)} size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: 'var(--text-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{item.title}</span>
      {/* Delete button — top-right corner in edit mode */}
      {editing && onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          title="항목 제거"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 2px', color: 'var(--text-dim)', lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--destructive)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  );
}

/* ── Individual node group card ─────────────────────────────── */
function NodeGroupCard({
  group, items, allItems, monitorCount, isRenaming, renameDraft,
  draggingItemId,
  onLaunch, onDelete, onStartRename, onRenameDraftChange,
  onRenameConfirm, onRenameCancel, onReorderItems, onSetMonitor,
}: {
  group: NodeGroup; items: LauncherItem[]; allItems: LauncherItem[]; monitorCount: number;
  isRenaming: boolean; renameDraft: string;
  draggingItemId?: string | null;
  onLaunch: () => void; onDelete: () => void; onStartRename: () => void;
  onRenameDraftChange: (v: string) => void; onRenameConfirm: () => void;
  onRenameCancel: () => void; onReorderItems: (itemIds: string[]) => void;
  onSetMonitor: (monitor: number | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [showMonitorPicker, setShowMonitorPicker] = useState(false);

  // dnd-kit droppable — registers with App-level DndContext (absorbs right-click dragged cards)
  const { isOver: isDndOver, setNodeRef: setDropRef } = useDroppable({
    id: `drop-node-group-${group.id}`,
    disabled: !draggingItemId || group.itemIds.length >= 3 || group.itemIds.includes(draggingItemId ?? ''),
  });
  const isAbsorbing = !!draggingItemId && isDndOver;
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Auto-start rename as soon as editing opens
  useEffect(() => {
    if (editing) onStartRename();
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex(i => i.id === active.id);
    const newIndex = items.findIndex(i => i.id === over.id);
    onReorderItems(arrayMove(items, oldIndex, newIndex).map(i => i.id));
  };

  // Items not already in this group (for picker)
  const pickerItems = allItems
    .filter(i => !group.itemIds.includes(i.id) && !i.hiddenInSpace)
    .filter(i => !pickerQuery.trim() || i.title.toLowerCase().includes(pickerQuery.toLowerCase()));

  const handleAddItem = (itemId: string) => {
    onReorderItems([...group.itemIds, itemId]);
    setPickerQuery('');
    setShowPicker(false);
  };

  const handleRemoveItem = (itemId: string) => {
    onReorderItems(group.itemIds.filter(id => id !== itemId));
  };

  const openPicker = () => {
    setShowPicker(true);
    setPickerQuery('');
    setTimeout(() => pickerInputRef.current?.focus(), 50);
  };

  // HTML5 drag-to-add handlers (accept cards dragged from main area)
  const handleDragOver = (e: React.DragEvent) => {
    if (!editing) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if ((e.currentTarget as Node).contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!editing) return;
    const itemId = e.dataTransfer.getData('itemId') || e.dataTransfer.getData('text/plain');
    if (itemId && !group.itemIds.includes(itemId)) handleAddItem(itemId);
  };

  return (
    <div
      ref={setDropRef}
      onClick={!editing && !isRenaming ? onLaunch : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        margin: '4px 6px', borderRadius: 10,
        border: `1px solid ${isAbsorbing ? 'var(--accent)' : isDragOver ? 'var(--accent)' : editing ? 'var(--accent)' : 'var(--border-rgba)'}`,
        background: isAbsorbing ? 'var(--accent-dim)' : isDragOver ? 'var(--accent-dim)' : editing ? 'var(--accent-dim)' : 'var(--surface)',
        boxShadow: isAbsorbing ? '0 0 0 2px var(--accent), 0 4px 18px rgba(99,102,241,0.28)' : 'none',
        outline: isDragOver ? '2px dashed var(--accent)' : 'none',
        outlineOffset: -3,
        transform: isAbsorbing ? 'scale(1.015)' : 'none',
        transition: 'all 0.15s', overflow: 'hidden', cursor: editing ? 'default' : 'pointer', position: 'relative',
      }}
    >
      {/* Absorption overlay — shows when a card is dragged over */}
      {isAbsorbing && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'var(--accent-dim)', borderRadius: 10,
          pointerEvents: 'none',
        }}>
          <Icon name="add_circle" size={20} color="var(--accent)" />
          <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, marginTop: 3 }}>노드에 추가</span>
        </div>
      )}
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px 5px', gap: 4 }}>
        <Icon name="hub" size={12} color="var(--accent)" style={{ flexShrink: 0 }} />
        {isRenaming ? (
          <input autoFocus value={renameDraft} onChange={e => onRenameDraftChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onRenameConfirm(); if (e.key === 'Escape') onRenameCancel(); }}
            onBlur={onRenameConfirm} onClick={e => e.stopPropagation()}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: '1px solid var(--border-focus)', borderRadius: 3, fontSize: 12, fontWeight: 600, color: 'var(--text-color)', fontFamily: 'inherit', padding: '1px 4px' }}
          />
        ) : (
          <span onDoubleClick={e => { e.stopPropagation(); onStartRename(); }}
            style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {group.name}
          </span>
        )}
        <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
          {editing ? (
            <button onClick={() => { if (isRenaming) onRenameConfirm(); setEditing(false); setShowPicker(false); }}
              style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>
              완료
            </button>
          ) : (
            <>
              <button onClick={e => { e.stopPropagation(); setEditing(true); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-dim)', borderRadius: 4 }} title="편집">
                <Icon name="edit" size={11} />
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete(); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-dim)', borderRadius: 4 }} title="삭제">
                <Icon name="delete" size={11} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Monitor badge — always visible, click to pick */}
      <div style={{ padding: '1px 8px 5px', position: 'relative' }} onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setShowMonitorPicker(p => !p)}
          title="모니터 설정"
          style={{
            fontSize: 8, fontWeight: 700, padding: '1px 5px 1px 4px', borderRadius: 3,
            background: group.monitor ? 'var(--accent)' : 'var(--border-rgba)',
            color: group.monitor ? '#fff' : 'var(--text-dim)',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            opacity: group.monitor ? 0.85 : 0.45,
            display: 'inline-flex', alignItems: 'center', gap: 2,
            transition: 'opacity 0.12s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = group.monitor ? '0.85' : '0.45')}
        >
          {group.monitor ? `M${group.monitor}` : 'Auto'}
          <Icon name={showMonitorPicker ? 'expand_more' : 'expand_less'} size={8} style={{ lineHeight: 1 }} />
        </button>
        {showMonitorPicker && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% - 1px)', left: 6,
            background: 'var(--bg-rgba)', border: '1px solid var(--border-rgba)',
            borderRadius: 8, padding: '5px 6px',
            display: 'flex', alignItems: 'center', gap: 4,
            boxShadow: '0 -4px 16px rgba(0,0,0,0.13)',
            zIndex: 20, backdropFilter: 'blur(10px)',
          }}>
            <span style={{ fontSize: 8, color: 'var(--text-dim)', fontWeight: 500 }}>모니터</span>
            {[undefined, ...Array.from({ length: Math.min(monitorCount, 3) }, (_, i) => i + 1)].map(n => (
              <button key={n ?? 'auto'}
                onClick={() => { onSetMonitor(n); setShowMonitorPicker(false); }}
                style={{
                  width: 22, height: 22, borderRadius: 5, fontSize: 9, fontWeight: 800,
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: group.monitor === n ? 'var(--accent)' : 'var(--surface)',
                  border: `1.5px solid ${group.monitor === n ? 'var(--accent)' : 'var(--border-rgba)'}`,
                  color: group.monitor === n ? '#fff' : 'var(--text-dim)',
                }}>
                {n === undefined ? 'C' : n}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sortable item list */}
      <div style={{ padding: editing ? '0 6px 4px' : '0 8px 4px' }} onClick={e => { if (editing) e.stopPropagation(); }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {items.map((item, i) => (
              <SortableNodeItem
                key={item.id} item={item} index={i} editing={editing}
                onRemove={editing ? () => handleRemoveItem(item.id) : undefined}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Edit mode: add item + monitor */}
      {editing && (
        <div onClick={e => e.stopPropagation()}>
          {/* ── Card picker ─────────────────────── */}
          {showPicker ? (
            <div style={{ margin: '0 6px 6px', border: '1px solid var(--border-focus)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px', borderBottom: '1px solid var(--border-rgba)', gap: 4 }}>
                <Icon name="search" size={12} color="var(--text-dim)" />
                <input
                  ref={pickerInputRef}
                  value={pickerQuery}
                  onChange={e => setPickerQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setShowPicker(false); setPickerQuery(''); } if (e.key === 'Enter' && pickerItems.length > 0) handleAddItem(pickerItems[0].id); }}
                  placeholder="카드 검색..."
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 10, color: 'var(--text-color)', fontFamily: 'inherit' }}
                />
                <button onClick={() => { setShowPicker(false); setPickerQuery(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)', lineHeight: 1 }}>
                  <Icon name="close" size={12} />
                </button>
              </div>
              <div style={{ maxHeight: 110, overflowY: 'auto' }}>
                {pickerItems.length === 0 && (
                  <div style={{ padding: '8px 10px', fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>
                    {pickerQuery ? '검색 결과 없음' : '추가할 카드 없음'}
                  </div>
                )}
                {pickerItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleAddItem(item.id)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'background 0.08s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <Icon name={getItemIcon(item.type)} size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ margin: '0 6px 5px' }}>
              <button
                onClick={openPicker}
                style={{ width: '100%', padding: '4px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'transparent', border: '1px dashed var(--border-rgba)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 10, fontFamily: 'inherit', transition: 'all 0.12s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-rgba)'; e.currentTarget.style.color = 'var(--text-dim)'; }}
              >
                <Icon name="add" size={12} />
                카드 추가
              </button>
            </div>
          )}


        </div>
      )}
    </div>
  );
}

/* ── Deck card ──────────────────────────────────────────────── */
function DeckCard({ deck, items, monitorCount, draggingItemId, onLaunch, onDelete, onUpdateDeck }: {
  deck: Deck; items: LauncherItem[]; monitorCount: number;
  draggingItemId?: string | null;
  onLaunch: () => void; onDelete: () => void;
  onUpdateDeck: (deckId: string, patch: Partial<Pick<Deck, 'name' | 'itemIds' | 'monitor'>>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [showMonitorPicker, setShowMonitorPicker] = useState(false);

  // dnd-kit droppable — absorbs right-click dragged cards into this deck
  const { isOver: isDndOver, setNodeRef: setDropRef } = useDroppable({
    id: `drop-deck-${deck.id}`,
    disabled: !draggingItemId || deck.itemIds.includes(draggingItemId ?? ''),
  });
  const isAbsorbing = !!draggingItemId && isDndOver;

  // Auto-start rename as soon as editing opens
  useEffect(() => {
    if (editing) { setRenameDraft(deck.name); setRenaming(true); }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={setDropRef}
      onClick={!editing ? onLaunch : undefined}
      style={{
        margin: '4px 6px', borderRadius: 10,
        border: `1px solid ${isAbsorbing ? DECK_COLOR : editing ? DECK_COLOR : 'var(--border-rgba)'}`,
        background: isAbsorbing ? 'rgba(249,115,22,0.12)' : editing ? 'rgba(249,115,22,0.06)' : 'var(--surface)',
        boxShadow: isAbsorbing ? `0 0 0 2px ${DECK_COLOR}, 0 4px 18px rgba(249,115,22,0.28)` : 'none',
        transform: isAbsorbing ? 'scale(1.015)' : 'none',
        transition: 'all 0.15s', overflow: 'hidden', cursor: editing ? 'default' : 'pointer',
        position: 'relative',
      }}
    >
      {/* Absorption overlay */}
      {isAbsorbing && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(249,115,22,0.1)', borderRadius: 10,
          pointerEvents: 'none',
        }}>
          <Icon name="add_circle" size={20} color={DECK_COLOR} />
          <span style={{ fontSize: 9, color: DECK_COLOR, fontWeight: 700, marginTop: 3 }}>덱에 추가</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px 5px', gap: 4 }}>
        <Icon name="stacks" size={12} color={DECK_COLOR} style={{ flexShrink: 0 }} />
        {renaming ? (
          <input autoFocus value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onUpdateDeck(deck.id, { name: renameDraft }); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
            onBlur={() => { onUpdateDeck(deck.id, { name: renameDraft }); setRenaming(false); }}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: '1px solid var(--border-focus)', borderRadius: 3, fontSize: 12, fontWeight: 600, color: 'var(--text-color)', fontFamily: 'inherit', padding: '1px 4px' }}
          />
        ) : (
          <span onDoubleClick={e => { e.stopPropagation(); setRenameDraft(deck.name); setRenaming(true); }}
            style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deck.name}
          </span>
        )}
        <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
          {editing ? (
            <button onClick={() => { if (renaming) { onUpdateDeck(deck.id, { name: renameDraft }); setRenaming(false); } setEditing(false); }} style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700, background: DECK_COLOR, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>완료</button>
          ) : (
            <>
              <button onClick={e => { e.stopPropagation(); setEditing(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-dim)', borderRadius: 4 }} title="편집">
                <Icon name="edit" size={11} />
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-dim)', borderRadius: 4 }} title="삭제">
                <Icon name="delete" size={11} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Monitor badge — always visible, click to pick */}
      <div style={{ padding: '1px 8px 5px', position: 'relative' }} onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setShowMonitorPicker(p => !p)}
          title="모니터 설정"
          style={{
            fontSize: 8, fontWeight: 700, padding: '1px 5px 1px 4px', borderRadius: 3,
            background: deck.monitor ? DECK_COLOR : 'var(--border-rgba)',
            color: deck.monitor ? '#fff' : 'var(--text-dim)',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            opacity: deck.monitor ? 0.85 : 0.45,
            display: 'inline-flex', alignItems: 'center', gap: 2,
            transition: 'opacity 0.12s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = deck.monitor ? '0.85' : '0.45')}
        >
          {deck.monitor ? `M${deck.monitor}` : 'Auto'}
          <Icon name={showMonitorPicker ? 'expand_more' : 'expand_less'} size={8} style={{ lineHeight: 1 }} />
        </button>
        {showMonitorPicker && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% - 1px)', left: 6,
            background: 'var(--bg-rgba)', border: '1px solid var(--border-rgba)',
            borderRadius: 8, padding: '5px 6px',
            display: 'flex', alignItems: 'center', gap: 4,
            boxShadow: '0 -4px 16px rgba(0,0,0,0.13)',
            zIndex: 20, backdropFilter: 'blur(10px)',
          }}>
            <span style={{ fontSize: 8, color: 'var(--text-dim)', fontWeight: 500 }}>모니터</span>
            {[undefined, ...Array.from({ length: Math.min(monitorCount, 3) }, (_, i) => i + 1)].map(n => (
              <button key={n ?? 'auto'}
                onClick={() => { onUpdateDeck(deck.id, { monitor: n }); setShowMonitorPicker(false); }}
                style={{
                  width: 22, height: 22, borderRadius: 5, fontSize: 9, fontWeight: 800,
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: deck.monitor === n ? DECK_COLOR : 'var(--surface)',
                  border: `1.5px solid ${deck.monitor === n ? DECK_COLOR : 'var(--border-rgba)'}`,
                  color: deck.monitor === n ? '#fff' : 'var(--text-dim)',
                }}>
                {n === undefined ? 'C' : n}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '0 8px 4px' }} onClick={e => { if (editing) e.stopPropagation(); }}>
        {items.map((item, i) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: editing ? '4px 6px' : '2px 4px', borderRadius: editing ? 6 : 0, background: editing ? 'var(--surface)' : 'transparent', border: editing ? '1px solid var(--border-rgba)' : 'none', marginBottom: editing ? 3 : 0 }}>
            <span style={{ fontSize: 9, color: 'var(--text-dim)', minWidth: 10 }}>{i + 1}</span>
            <Icon name={getItemIcon(item.type)} size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{item.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Droppable zone for right-click drag into node/deck building ─── */
function NodeDropZone({ id, draggingItemId, children }: { id: string; draggingItemId?: string | null; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const showHighlight = !!draggingItemId && isOver;
  return (
    <div ref={setNodeRef} style={{
      transition: 'box-shadow 0.15s, transform 0.15s',
      boxShadow: showHighlight ? '0 0 0 2px var(--accent), 0 4px 16px rgba(99,102,241,0.25)' : 'none',
      borderRadius: 12,
      transform: showHighlight ? 'scale(1.01)' : 'none',
    }}>
      {children}
    </div>
  );
}

function DeckDropZone({ id, draggingItemId, children }: { id: string; draggingItemId?: string | null; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const showHighlight = !!draggingItemId && isOver;
  return (
    <div ref={setNodeRef} style={{
      transition: 'box-shadow 0.15s, transform 0.15s',
      boxShadow: showHighlight ? `0 0 0 2px ${DECK_COLOR}, 0 4px 16px rgba(249,115,22,0.25)` : 'none',
      borderRadius: 12,
      transform: showHighlight ? 'scale(1.01)' : 'none',
    }}>
      {children}
    </div>
  );
}
