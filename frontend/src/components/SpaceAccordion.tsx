import { useState, useRef, useEffect, useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { Space, LauncherItem } from '../types';
import { ItemCard } from './ItemCard';
import { GhostCard } from './GhostCard';
import { useAppState, useAppActions } from '../contexts/AppContext';
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
  // Whole-header drag activator (dnd-kit). Spread listeners+attributes on the header
  // and pin setActivatorNodeRef to it so any pointerdown on the header can initiate
  // a space reorder drag. Child buttons (chevron, action icons, rename input) stop
  // propagation so they keep working as clicks.
  // `any` typing to stay compatible with dnd-kit's SyntheticListenerMap / DraggableAttributes
  // without importing those internal types here.
  headerDragActivator?: {
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    listeners: any;
    attributes: any;
  };
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetColor: (color: string) => void;
  /**
   * Move this space (with its items) to another preset. Caller
   * provides the list of accessible target presets so we can render
   * one menu item per option. When omitted (single-preset world or
   * no other presets accessible), the move section is hidden.
   */
  movePresets?: Array<{ id: '1' | '2' | '3'; label: string }>;
  onMoveToPreset?: (targetId: '1' | '2' | '3') => void;
  onSetIcon: (icon: string) => void;
  onEditItem: (item: LauncherItem) => void;
  onDeleteItem: (itemId: string) => void;
  onIncrementClick: (itemId: string) => void;
  onSortByUsage: () => void;
  onTogglePin: (itemId: string) => void;
  onQuickAdd: () => void;
  onAddItem: () => void;
  onScanItem: () => void;
  /** Add a widget card (media, future kinds). Optional — caller may
   *  omit when widgets aren't relevant for that space context. */
  onAddWidget?: () => void;
  /** Add a colour-swatch widget. Opens a colour picker inline (or
   *  uses the clipboard hex if present); see App.tsx handler. */
  onAddColorSwatch?: () => void;
  onToggleCollapse: () => void;
  onFloatOut?: () => void;
  isFloating?: boolean;
  defaultOpen?: boolean;
  // Monitor (per-space override)
  onSetMonitor?: (itemId: string, monitor: number | undefined) => void;
  // Container
  onConvertToContainer?: (itemId: string) => void;
  onConvertFromContainer?: (itemId: string) => void;
  onEditSlots?: (itemId: string, dir?: string) => void;
  // Ghost recommendations
  ghostItems?: import('../hooks/useGhostCards').GhostItem[];
  onGhostAccept?: (ghost: import('../hooks/useGhostCards').GhostItem) => void;
  onGhostDismiss?: (value: string) => void;
  // File Explorer drag-and-drop
  fileDragActive?: boolean;     // any file drag in progress anywhere → show as droppable
  fileDragTarget?: boolean;     // this specific space is the current target
  onFileDragEnter?: () => void;
  onFileDragLeave?: () => void;
}

const SPACE_COLORS = [
  '#6366f1','#0ea5e9','#22c55e','#f59e0b',
  '#ef4444','#a855f7','#ec4899','#14b8a6',
];

// Monotone Material Symbols only — replaces the old colored-emoji picker. We keep
// the `icon` field as a Material Symbol name; legacy emoji values still render
// (rendered as text for backwards compat) but users can only pick Material Symbols now.
const SPACE_ICONS = [
  'rocket_launch', 'work', 'sports_esports', 'folder', 'library_music',
  'menu_book', 'build', 'lightbulb', 'language', 'star',
  'home', 'flag', 'edit_note', 'key', 'terminal',
];
// Characters outside the BMP are almost certainly legacy emoji — render as text.
const isEmojiIcon = (s: string) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s);

export function SpaceAccordion({
  space,
  headerDragActivator,
  onRename,
  onDelete,
  onDuplicate,
  onSetColor,
  movePresets,
  onMoveToPreset,
  onSetIcon,
  onEditItem,
  onDeleteItem,
  onIncrementClick,
  onSortByUsage,
  onTogglePin,
  onQuickAdd,
  onAddItem,
  onScanItem,
  onAddWidget,
  onAddColorSwatch,
  onToggleCollapse,
  onFloatOut,
  isFloating = false,
  defaultOpen = true,
  onSetMonitor,
  onConvertToContainer,
  onConvertFromContainer,
  onEditSlots,
  ghostItems,
  onGhostAccept,
  onGhostDismiss,
  fileDragActive,
  fileDragTarget,
  onFileDragEnter,
  onFileDragLeave,
}: SpaceAccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(space.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const { searchQuery, activeMode } = useAppState();
  const { onCleanSpace } = useAppActions();
  // Pin state is tracked via space.pinnedIds, not item.pinned — the clean
  // tool must count against the same source of truth that pin-mode writes to,
  // otherwise the header badge claims items are deletable when they aren't.
  const pinIdSet = useMemo(() => new Set(space.pinnedIds ?? []), [space.pinnedIds]);
  const unpinnedCount = space.items.filter(i => !pinIdSet.has(i.id) && !i.isContainer).length;

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  // Make the grid droppable for cross-space dragging
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop-space-${space.id}` });

  const headerBg = space.color ? space.color + '18' : 'var(--surface)';

  // File-drag visuals: dashed border on any drag, solid accent + glow when THIS space is the target
  const baseBorderColor = space.color ? space.color + '55' : 'var(--border-rgba)';
  const fileDragBorder = fileDragTarget
    ? '2px solid var(--accent)'
    : fileDragActive
      ? '1.5px dashed var(--accent-dim)'
      : `1px solid ${baseBorderColor}`;

  return (
    <div
      className="rounded-xl overflow-hidden"
      onDragEnter={(e) => {
        // Only react to file drags from File Explorer or URI drags from a browser
        const hasFiles = Array.from(e.dataTransfer.types).some(t => t === 'Files' || t === 'text/uri-list');
        if (!hasFiles) return;
        onFileDragEnter?.();
      }}
      onDragLeave={(e) => {
        // Guard against bubbling from child → only fire when truly leaving this accordion
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        onFileDragLeave?.();
      }}
      style={{
        height: '100%',
        border: fileDragBorder,
        boxShadow: fileDragTarget ? '0 0 0 4px var(--accent-dim)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
        transform: fileDragTarget ? 'scale(1.01)' : 'scale(1)',
      }}
    >
      {/* ── Header ─────────────────────────────────────── */}
      {/* The outer header carries the .space-accordion-header class (hover effect +
          used by sensors to differentiate space headers from item cards) but does
          NOT receive the dnd-kit listeners itself. Only the inner "title" region
          (icon + name + count badge) is the drag activator — that way chevron and
          action buttons remain pure click targets without needing stopPropagation
          gymnastics, and the cursor affordance is obvious only where drag works. */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 select-none group space-accordion-header"
        style={{
          background: headerBg,
          minHeight: 40,
          cursor: 'default',
          transition: 'background 0.12s',
        }}
      >
        {/* Chevron */}
        <button
          onClick={() => { if (!isRenaming) { setIsOpen(o => !o); onToggleCollapse(); } }}
          className="flex items-center justify-center w-5 h-5 rounded transition-colors flex-shrink-0"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
        >
          <Icon name="chevron_right" size={16} className="transition-transform duration-200" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
        </button>

        {/* Drag activator: spans icon + name + count. This is the ONLY region that
            holds dnd-kit listeners, so pointerdown reliably initiates space drag
            from here without conflicting with chevron / action-button clicks. */}
        <div
          ref={headerDragActivator?.setActivatorNodeRef}
          {...(headerDragActivator?.listeners ?? {})}
          {...(headerDragActivator?.attributes ?? {})}
          className="flex items-center gap-2 flex-1 min-w-0"
          style={{ touchAction: 'none', cursor: isRenaming ? 'text' : 'grab' }}
          onDoubleClick={e => { e.stopPropagation(); setIsRenaming(true); }}
        >
          {/* Space icon (Material Symbol; legacy emoji rendered as text) or color dot */}
          {space.icon ? (
            isEmojiIcon(space.icon)
              ? <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{space.icon}</span>
              : <Icon name={space.icon} size={14} color={space.color ?? 'var(--text-muted)'} />
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
              onPointerDown={e => e.stopPropagation()}
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
              className="flex-1 font-semibold text-[13px] truncate"
              style={{ color: 'var(--text-color)' }}
            >
              {space.name}
            </span>
          )}
        </div>

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

        {/* ── Clean-mode action (only visible in clean mode) ───
            Replaces the standard hover menu entirely so the tool's primary
            action dominates the header visually. Always visible (not
            hover-gated) because clean mode is deliberately disruptive. */}
        {activeMode === 'clean' && (
          <div
            className="flex items-center gap-1 flex-shrink-0"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
            style={{ marginRight: 8 }}
          >
            <button
              onClick={() => onCleanSpace(space.id)}
              disabled={unpinnedCount === 0}
              title={unpinnedCount === 0 ? '삭제할 카드 없음' : `${unpinnedCount}개 카드 삭제`}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                background: unpinnedCount === 0 ? 'var(--border-rgba)' : 'var(--color-destructive)',
                color: unpinnedCount === 0 ? 'var(--text-dim)' : 'var(--color-destructive-foreground)',
                fontSize: 11,
                fontWeight: 600,
                cursor: unpinnedCount === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Icon name="delete_sweep" size={13} />
              청소 ({unpinnedCount})
            </button>
          </div>
        )}

        {/* ── Right action buttons (visible on hover) ──
            Hidden in clean mode — the clean button above takes over the
            header, and other actions should stay out of the way. */}
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={activeMode === 'clean' ? { display: 'none' } : undefined}
          data-mode-dim="true"
        >
          {/* Sort */}
          <ActionBtn icon="sort" title="정렬" onClick={onSortByUsage} />

          {/* Float out as badge — pins this space as a draggable floating badge
              outside the main window. Already-floating spaces don't show this
              (prevents duplicate pins). */}
          {onFloatOut && !isFloating && (
            <ActionBtn
              icon="open_in_new"
              title="플로팅 뱃지로 분리"
              onClick={onFloatOut}
            />
          )}

          {/* More */}
          <DropdownMenu>
            <DropdownMenuTrigger className="action-icon-btn" title="더 보기" style={{ width: 26, height: 26, borderRadius: 6 }}>
              <Icon name="more_horiz" size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4}>
              <DropdownMenuItem onClick={() => setIsRenaming(true)}>
                <Icon name="edit" className="text-sm" />이름 변경
              </DropdownMenuItem>
              {/* Icon picker (Material Symbols) */}
              <div style={{ padding: '6px 8px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>아이콘</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 180 }}>
                  {SPACE_ICONS.map(iconName => {
                    const selected = space.icon === iconName;
                    return (
                      <button
                        key={iconName}
                        title={iconName}
                        onClick={() => onSetIcon(selected ? '' : iconName)}
                        style={{
                          width: 26, height: 26,
                          borderRadius: 4,
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: selected ? 'var(--surface-hover)' : 'transparent',
                          outline: selected ? '2px solid var(--border-focus)' : 'none',
                        }}
                      >
                        <Icon name={iconName} size={16} color={selected ? 'var(--text-color)' : 'var(--text-muted)'} />
                      </button>
                    );
                  })}
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
                <Icon name="content_copy" className="text-sm" />스페이스 복제
              </DropdownMenuItem>

              {/* "Move to preset" — one item per accessible target.
                  Caller already filters out the current preset and any
                  Pro-locked ones, so we just render whatever we got.
                  Hidden entirely when there's nothing to move to (e.g.
                  free tier where only preset 1 exists). */}
              {movePresets && movePresets.length > 0 && onMoveToPreset && (
                <>
                  <DropdownMenuSeparator />
                  {movePresets.map(p => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => onMoveToPreset(p.id)}
                    >
                      <Icon name="swap_horiz" className="text-sm" />
                      프리셋 {p.id}
                      {p.label !== `프리셋 ${p.id}` && (
                        <span style={{ marginLeft: 4, color: 'var(--text-muted)', fontSize: 11 }}>
                          ({p.label})
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)' }}>이동</span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Icon name="delete" className="text-sm" />스페이스 삭제
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
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                  onClickCountIncrement={() => onIncrementClick(item.id)}
                  pinned={(space.pinnedIds ?? []).includes(item.id)}
                  onTogglePin={() => onTogglePin(item.id)}
                  onSetMonitor={onSetMonitor ? (m) => onSetMonitor(item.id, m) : undefined}
                  onConvertToContainer={onConvertToContainer ? () => onConvertToContainer(item.id) : undefined}
                  onConvertFromContainer={onConvertFromContainer ? () => onConvertFromContainer(item.id) : undefined}
                  onEditSlots={onEditSlots ? (dir) => onEditSlots(item.id, dir) : undefined}
                />
              ))}

              {/* Ghost recommendation cards */}
              {ghostItems?.map(ghost => (
                <GhostCard
                  key={`ghost-${ghost.value}`}
                  ghost={ghost}
                  onAccept={() => onGhostAccept?.(ghost)}
                  onDismiss={() => onGhostDismiss?.(ghost.value)}
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
                  data-tour-id="add-card-button"
                  onClick={onQuickAdd}
                  className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors text-[11px] cursor-pointer"
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Icon name="add" size={18} />
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
                    <Icon name="expand_more" size={14} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4}>
                    <DropdownMenuItem onClick={onQuickAdd}>빠른추가</DropdownMenuItem>
                    <DropdownMenuItem onClick={onAddItem}>직접입력</DropdownMenuItem>
                    <DropdownMenuItem onClick={onScanItem}>스마트스캔</DropdownMenuItem>
                    {onAddWidget && (
                      <DropdownMenuItem onClick={onAddWidget}>위젯</DropdownMenuItem>
                    )}
                    {onAddColorSwatch && (
                      <DropdownMenuItem onClick={onAddColorSwatch}>컬러</DropdownMenuItem>
                    )}
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
      <Icon name={icon} size={15} />
    </button>
  );
}
