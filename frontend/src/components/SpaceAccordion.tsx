import { useState, useRef, useEffect, useMemo } from 'react';
import type { Space, LauncherItem, AppMode, NodeGroup } from '../types';
import { ItemCard } from './ItemCard';
import {
  SortableContext,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface SpaceAccordionProps {
  space: Space;
  dragHandle?: React.ReactNode;           // ⠿ handle passed from App (SortableSpace)
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetColor: (color: string) => void;
  onSetIcon: (icon: string) => void;
  onEditItem: (item: LauncherItem) => void;
  onDeleteItem: (itemId: string) => void;
  onIncrementClick: (itemId: string) => void;
  onSortByUsage: () => void;
  onTogglePin: (itemId: string) => void;
  onQuickAdd: () => void;
  onAddItem: () => void;
  onScanItem: () => void;
  onToggleCollapse: () => void;
  closeAfter: boolean;
  defaultOpen?: boolean;
  searchQuery?: string;
  // Mode-related props
  activeMode?: AppMode;
  nodeGroups?: NodeGroup[];
  nodeBuilding?: string[];
  onPinModeClick?: (itemId: string) => void;
  onNodeModeClick?: (itemId: string) => void;
  onNodeGroupLaunch?: (groupId: string) => void;
  deckItems?: string[];
  deckAnchorItemIds?: Set<string>;   // IDs of saved deck anchor cards (for normal-mode click)
  onDeckModeClick?: (itemId: string) => void;
  onDeckGroupLaunch?: (itemId: string) => void;
  // Inactive window props
  inactiveWindowIds?: Set<string>;
  onWindowInactiveClick?: (item: LauncherItem) => void;
  // Monitor
  monitorCount?: number;
  onSetMonitor?: (itemId: string, monitor: number | undefined) => void;
  // Container
  allItems?: import('../types').LauncherItem[];
  onConvertToContainer?: (itemId: string) => void;
  onConvertFromContainer?: (itemId: string) => void;
  onEditSlots?: (itemId: string, dir?: string) => void;
  onShowToast?: (msg: string) => void;
  onLaunchAndPosition?: (item: LauncherItem, closeAfter: boolean, monitor?: number) => Promise<void>;
  monitorDirections?: Record<number, string>;
  onOpenMonitorSettings?: () => void;
}

const SPACE_COLORS = [
  '#6366f1','#0ea5e9','#22c55e','#f59e0b',
  '#ef4444','#a855f7','#ec4899','#14b8a6',
];

const SPACE_EMOJIS = ['🚀','💼','🎮','📁','🎵','📚','🔧','💡','🌐','⭐','🏠','🎯','📝','🔑','💻'];

export function SpaceAccordion({
  space,
  dragHandle,
  onRename,
  onDelete,
  onDuplicate,
  onSetColor,
  onSetIcon,
  onEditItem,
  onDeleteItem,
  onIncrementClick,
  onSortByUsage,
  onTogglePin,
  onQuickAdd,
  onAddItem,
  onScanItem,
  onToggleCollapse,
  closeAfter,
  defaultOpen = true,
  searchQuery = '',
  activeMode = 'normal',
  nodeGroups = [],
  nodeBuilding = [],
  onPinModeClick,
  onNodeModeClick,
  onNodeGroupLaunch,
  deckItems: _deckItems = [],
  deckAnchorItemIds,
  onDeckModeClick,
  onDeckGroupLaunch,
  inactiveWindowIds,
  onWindowInactiveClick,
  monitorCount = 1,
  onSetMonitor,
  allItems = [],
  onConvertToContainer,
  onConvertFromContainer,
  onEditSlots,
  onShowToast,
  onLaunchAndPosition,
  monitorDirections,
  onOpenMonitorSettings,
}: SpaceAccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(space.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build map: itemId → [nodeIdx1, nodeIdx2, ...] (1-based, multiple groups possible)
  const nodeBadgeMap = useMemo(() => {
    const map = new Map<string, number[]>();
    nodeGroups.forEach((g, i) => {
      g.itemIds.forEach(id => {
        const arr = map.get(id) ?? [];
        arr.push(i + 1);
        map.set(id, arr);
      });
    });
    return map;
  }, [nodeGroups]);

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  // Make the grid droppable for cross-space dragging
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop-space-${space.id}` });

  const headerBg = space.color ? space.color + '18' : 'var(--surface)';

  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-200"
      style={{
        border: `1px solid ${space.color ? space.color + '55' : 'var(--border-rgba)'}`,
      }}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 select-none group"
        style={{ background: headerBg, minHeight: 40 }}
      >
        {/* Drag grip (passed from SortableSpace wrapper) */}
        {dragHandle && (
          <span style={{ color: 'var(--text-dim)', flexShrink: 0, lineHeight: 1 }}>
            {dragHandle}
          </span>
        )}

        {/* Chevron */}
        <button
          onClick={() => { if (!isRenaming) { setIsOpen(o => !o); onToggleCollapse(); } }}
          className="flex items-center justify-center w-5 h-5 rounded transition-colors flex-shrink-0"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
        >
          <span
            className="material-symbols-rounded transition-transform duration-200"
            style={{ fontSize: 16, transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            chevron_right
          </span>
        </button>

        {/* Space icon (emoji) or color dot */}
        {space.icon ? (
          <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{space.icon}</span>
        ) : space.color ? (
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: space.color }}
          />
        ) : null}

        {/* Space name */}
        {isRenaming ? (
          <input
            ref={inputRef}
            value={draft}
            onClick={e => e.stopPropagation()}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { onRename(draft); setIsRenaming(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onRename(draft); setIsRenaming(false); }
              if (e.key === 'Escape') { setDraft(space.name); setIsRenaming(false); }
            }}
            className="flex-1 bg-transparent font-semibold text-[13px] outline-none border-b"
            style={{ color: 'var(--text-color)', borderColor: 'var(--border-focus)' }}
          />
        ) : (
          <span
            className="flex-1 font-semibold text-[13px] truncate cursor-default"
            style={{ color: 'var(--text-color)' }}
            onDoubleClick={e => { e.stopPropagation(); setIsRenaming(true); }}
          >
            {space.name}
          </span>
        )}

        {/* Item count badge (when collapsed or searching) */}
        {(!isOpen || searchQuery) && space.items.length > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--text-dim)',
              background: 'var(--border-rgba)',
              borderRadius: 10,
              padding: '1px 6px',
              flexShrink: 0,
              minWidth: 20,
              textAlign: 'center',
            }}
          >
            {space.items.length}
          </span>
        )}

        {/* ── Right action buttons (visible on hover) ── */}
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={e => e.stopPropagation()}
        >
          {/* Sort */}
          <ActionBtn icon="sort" title="정렬" onClick={onSortByUsage} />

          {/* More */}
          <DropdownMenu>
            <DropdownMenuTrigger className="action-icon-btn" title="더 보기" style={{ width: 26, height: 26, borderRadius: 6 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>more_horiz</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4}>
              <DropdownMenuItem onClick={() => setIsRenaming(true)}>
                <span className="material-symbols-rounded text-sm">edit</span>이름 변경
              </DropdownMenuItem>
              {/* Emoji picker inline */}
              <div style={{ padding: '6px 8px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>아이콘</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 180 }}>
                  {SPACE_EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => onSetIcon(space.icon === emoji ? '' : emoji)}
                      style={{
                        fontSize: 14,
                        width: 26, height: 26,
                        borderRadius: 4,
                        border: 'none',
                        cursor: 'pointer',
                        background: space.icon === emoji ? 'var(--surface-hover)' : 'transparent',
                        outline: space.icon === emoji ? `2px solid var(--border-focus)` : 'none',
                      }}
                    >{emoji}</button>
                  ))}
                </div>
              </div>

              {/* Color picker inline */}
              <div style={{ padding: '6px 8px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>색상</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {SPACE_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => onSetColor(c)}
                      style={{
                        width: 18, height: 18, borderRadius: '50%',
                        background: c, border: 'none', cursor: 'pointer',
                        outline: space.color === c ? `2px solid ${c}` : 'none',
                        outlineOffset: 2,
                      }}
                    />
                  ))}
                  <button
                    onClick={() => onSetColor('')}
                    style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'var(--surface)', border: '1px solid var(--border-rgba)',
                      cursor: 'pointer', fontSize: 9, color: 'var(--text-dim)',
                    }}
                    title="색상 제거"
                  >✕</button>
                </div>
              </div>
              <DropdownMenuItem onClick={onDuplicate}>
                <span className="material-symbols-rounded text-sm">content_copy</span>스페이스 복제
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <span className="material-symbols-rounded text-sm">delete</span>스페이스 삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Items grid ──────────────────────────────────── */}
      <div
        style={{
          maxHeight: isOpen ? 2000 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.28s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div
          ref={setDropRef}
          style={{
            padding: '10px 10px 12px',
            background: isOver ? 'var(--surface)' : 'transparent',
            transition: 'background 0.15s',
            minHeight: 56,
          }}
        >
          <SortableContext items={space.items.filter(i => !i.hiddenInSpace).map(i => i.id)} strategy={rectSortingStrategy}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
                gap: 8,
              }}
            >
              {space.items.filter(i => !i.hiddenInSpace).map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  space={space}
                  closeAfter={closeAfter}
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                  onClickCountIncrement={() => onIncrementClick(item.id)}
                  pinned={(space.pinnedIds ?? []).includes(item.id)}
                  onTogglePin={() => onTogglePin(item.id)}
                  searchQuery={searchQuery}
                  activeMode={activeMode}
                  isNodeLinked={nodeGroups.some(g => g.itemIds.includes(item.id))}
                  isNodeAnchor={nodeBuilding.includes(item.id)}
                  isDeckAnchor={deckAnchorItemIds?.has(item.id) ?? false}
                  nodeBadges={nodeBadgeMap.get(item.id)}
                  onPinModeClick={() => onPinModeClick?.(item.id)}
                  onNodeModeClick={() => onNodeModeClick?.(item.id)}
                  onDeckModeClick={() => onDeckModeClick?.(item.id)}
                  onNodeGroupLaunch={() => {
                    const group = nodeGroups.find(g => g.itemIds.includes(item.id));
                    if (group) onNodeGroupLaunch?.(group.id);
                  }}
                  onDeckGroupLaunch={() => onDeckGroupLaunch?.(item.id)}
                  isInactive={inactiveWindowIds?.has(item.id) ?? false}
                  onInactiveClick={() => onWindowInactiveClick?.(item)}
                  monitorCount={monitorCount}
                  onSetMonitor={onSetMonitor ? (m) => onSetMonitor(item.id, m) : undefined}
                  allItems={allItems}
                  onConvertToContainer={onConvertToContainer ? () => onConvertToContainer(item.id) : undefined}
                  onConvertFromContainer={onConvertFromContainer ? () => onConvertFromContainer(item.id) : undefined}
                  onEditSlots={onEditSlots ? (dir) => onEditSlots(item.id, dir) : undefined}
                  onShowToast={onShowToast}
                  onLaunchAndPosition={onLaunchAndPosition}
                  monitorDirections={monitorDirections}
                  onOpenMonitorSettings={onOpenMonitorSettings}
                />
              ))}

              {/* Add / Scan split button */}
              <div
                className="flex rounded-xl overflow-hidden"
                style={{
                  border: '1.5px dashed var(--border-rgba)',
                  minHeight: 72,
                }}
              >
                <button
                  onClick={onQuickAdd}
                  className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors text-[11px] cursor-pointer"
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>add</span>
                  추가
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="flex items-center justify-center transition-colors cursor-pointer"
                    style={{
                      width: 24,
                      background: 'transparent',
                      border: 'none',
                      borderLeft: '1.5px dashed var(--border-rgba)',
                      color: 'var(--text-dim)',
                    }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: 14 }}>expand_more</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4}>
                    <DropdownMenuItem onClick={onQuickAdd}>빠른추가</DropdownMenuItem>
                    <DropdownMenuItem onClick={onAddItem}>직접입력</DropdownMenuItem>
                    <DropdownMenuItem onClick={onScanItem}>스마트스캔</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </SortableContext>
        </div>
      </div>
    </div>
  );
}

/* Small reusable action icon button */
function ActionBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      className="action-icon-btn"
      title={title}
      onClick={onClick}
    >
      <span className="material-symbols-rounded" style={{ fontSize: 15 }}>{icon}</span>
    </button>
  );
}
