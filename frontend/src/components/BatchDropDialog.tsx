import { useState, useEffect, useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LauncherItem, Space } from '../types';

// ── Types ──────────────────────────────────────────────────────────

export interface PendingDrop {
  tempId: string;
  title: string;
  type: LauncherItem['type'];
  value: string;           // the inferred path or URL (not editable)
  checked: boolean;        // user can uncheck to exclude from the batch
}

interface BatchDropDialogProps {
  open: boolean;
  items: PendingDrop[];
  spaces: Space[];
  defaultSpaceId: string;
  onClose: () => void;
  onConfirm: (spaceId: string, items: Omit<LauncherItem, 'id'>[]) => void;
}

// ── Type chip metadata ─────────────────────────────────────────────

const TYPE_META: Record<LauncherItem['type'], { icon: string; label: string; color: string }> = {
  url:     { icon: 'language',     label: 'URL',     color: '#3b82f6' },
  app:     { icon: 'apps',         label: '앱',      color: '#8b5cf6' },
  folder:  { icon: 'folder_open',  label: '폴더',    color: '#f59e0b' },
  text:    { icon: 'content_paste',label: '텍스트',  color: '#6366f1' },
  cmd:     { icon: 'terminal',     label: '명령어',  color: '#64748b' },
  window:  { icon: 'window',       label: '창',      color: '#10b981' },
  browser: { icon: 'tab',          label: '탭',      color: '#06b6d4' },
  // Widgets aren't drop-creatable (added via "+ 위젯" UI), but the
  // record needs all union members. Color follows the accent family.
  widget:  { icon: 'widgets',      label: '위젯',    color: '#a855f7' },
};

// Types shown in the per-item dropdown (leaves out window/browser which are not droppable)
const EDITABLE_TYPES: LauncherItem['type'][] = ['app', 'folder', 'url', 'text', 'cmd'];

// ── Main ───────────────────────────────────────────────────────────

export function BatchDropDialog({
  open,
  items: initialItems,
  spaces,
  defaultSpaceId,
  onClose,
  onConfirm,
}: BatchDropDialogProps) {
  const [items, setItems] = useState<PendingDrop[]>(initialItems);
  const [spaceId, setSpaceId] = useState(defaultSpaceId);

  // Reset state whenever the dialog opens with a new batch
  useEffect(() => {
    if (!open) return;
    setItems(initialItems);
    setSpaceId(defaultSpaceId);
  }, [open, initialItems, defaultSpaceId]);

  const checkedItems = useMemo(() => items.filter(i => i.checked), [items]);
  const selectedSpace = spaces.find(s => s.id === spaceId);
  const allChecked    = items.length > 0 && items.every(i => i.checked);

  const toggleAll = () => {
    const next = !allChecked;
    setItems(prev => prev.map(i => ({ ...i, checked: next })));
  };

  const patchItem = (tempId: string, patch: Partial<PendingDrop>) => {
    setItems(prev => prev.map(i => (i.tempId === tempId ? { ...i, ...patch } : i)));
  };

  const handleConfirm = () => {
    if (!spaceId || checkedItems.length === 0) return;
    const payload: Omit<LauncherItem, 'id'>[] = checkedItems.map(i => ({
      title: i.title.trim() || i.value,
      type:  i.type,
      value: i.value,
    }));
    onConfirm(spaceId, payload);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent style={{ width: 480, maxWidth: '95vw', padding: 0, overflow: 'hidden' }}>
        {/* ── Header ────────────────────────────────── */}
        <DialogHeader style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--border-rgba)' }}>
          <DialogTitle style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="file_download" size={16} color="var(--accent)" />
            {initialItems.length}개 항목 추가
          </DialogTitle>
        </DialogHeader>

        {/* ── Target space picker ──────────────────── */}
        <div style={{ padding: '12px 18px 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            대상 스페이스
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                borderRadius: 7,
                border: '1px solid var(--border-rgba)',
                background: 'var(--surface)',
                color: 'var(--text-color)',
                fontSize: 12,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {selectedSpace?.icon && <span style={{ fontSize: 13 }}>{selectedSpace.icon}</span>}
                {selectedSpace?.color && !selectedSpace.icon && (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: selectedSpace.color }} />
                )}
                {selectedSpace?.name ?? '선택'}
              </span>
              <Icon name="expand_more" size={14} color="var(--text-dim)" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" style={{ minWidth: 220 }}>
              {spaces.map(sp => (
                <DropdownMenuItem key={sp.id} onClick={() => setSpaceId(sp.id)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    {sp.icon
                      ? <span style={{ fontSize: 13 }}>{sp.icon}</span>
                      : sp.color
                        ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: sp.color }} />
                        : <span style={{ width: 8 }} />}
                    <span style={{ flex: 1 }}>{sp.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{sp.items.length}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── Select all toggle ────────────────────── */}
        <div style={{ padding: '6px 18px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={toggleAll}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '3px 7px',
              borderRadius: 5, border: 'none', background: 'transparent',
              color: 'var(--text-dim)', fontSize: 10, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Icon name={allChecked ? 'check_box' : 'check_box_outline_blank'} size={14} color="var(--text-dim)" />
            {allChecked ? '모두 해제' : '모두 선택'}
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>· {checkedItems.length} / {items.length} 선택됨</span>
        </div>

        {/* ── Item list ─────────────────────────────── */}
        <div style={{ padding: '8px 10px 10px', maxHeight: 320, overflowY: 'auto' }}>
          {items.map(item => (
            <BatchRow
              key={item.tempId}
              item={item}
              onToggle={() => patchItem(item.tempId, { checked: !item.checked })}
              onRename={(title) => patchItem(item.tempId, { title })}
              onRetype={(type) => patchItem(item.tempId, { type })}
            />
          ))}
        </div>

        {/* ── Footer ────────────────────────────────── */}
        <div style={{ padding: '12px 18px 14px', borderTop: '1px solid var(--border-rgba)', display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 9,
              border: '1px solid var(--border-rgba)', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 12, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={checkedItems.length === 0}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
              background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: checkedItems.length === 0 ? 'default' : 'pointer',
              opacity: checkedItems.length === 0 ? 0.5 : 1,
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Icon name="add_circle" size={14} color="#fff" />
            {checkedItems.length}개 추가
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Single row ──────────────────────────────────────────────── */

function BatchRow({
  item, onToggle, onRename, onRetype,
}: {
  item: PendingDrop;
  onToggle: () => void;
  onRename: (title: string) => void;
  onRetype: (type: LauncherItem['type']) => void;
}) {
  const meta = TYPE_META[item.type] ?? TYPE_META.app;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 8px',
        borderRadius: 7,
        background: item.checked ? 'var(--surface)' : 'transparent',
        opacity: item.checked ? 1 : 0.55,
        transition: 'opacity 0.12s, background 0.12s',
      }}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 4, border: 'none',
          background: 'transparent', cursor: 'pointer', flexShrink: 0,
        }}
      >
        <Icon
          name={item.checked ? 'check_box' : 'check_box_outline_blank'}
          size={17}
          color={item.checked ? 'var(--accent)' : 'var(--text-dim)'}
        />
      </button>

      {/* Type icon chip */}
      <div
        style={{
          width: 26, height: 26, borderRadius: 6, flexShrink: 0,
          background: `${meta.color}1a`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name={meta.icon} size={14} color={meta.color} />
      </div>

      {/* Editable title */}
      <input
        value={item.title}
        onChange={e => onRename(e.target.value)}
        disabled={!item.checked}
        style={{
          flex: 1, minWidth: 0,
          padding: '4px 6px', borderRadius: 5,
          border: '1px solid transparent',
          background: 'transparent',
          color: 'var(--text-color)', fontSize: 12,
          fontFamily: 'inherit', outline: 'none',
          transition: 'border-color 0.12s, background 0.12s',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--border-focus)'; e.currentTarget.style.background = 'var(--bg-rgba)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        title={item.value}
      />

      {/* Type dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!item.checked}
          style={{
            display: 'flex', alignItems: 'center', gap: 3,
            padding: '3px 7px', borderRadius: 5,
            border: '1px solid var(--border-rgba)',
            background: 'var(--bg-rgba)',
            color: meta.color, fontSize: 10, fontWeight: 600,
            cursor: 'pointer', flexShrink: 0,
            fontFamily: 'inherit',
          }}
        >
          {meta.label}
          <Icon name="expand_more" size={11} color="var(--text-dim)" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {EDITABLE_TYPES.map(t => {
            const m = TYPE_META[t];
            return (
              <DropdownMenuItem key={t} onClick={() => onRetype(t)}>
                <Icon name={m.icon} size={13} color={m.color} />
                {m.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
