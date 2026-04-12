import { useState, useEffect, useCallback, useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { electronAPI } from '../electronBridge';
import type { LauncherItem, Space } from '../types';

interface RecommendItem {
  title: string;
  value: string;
  type: 'folder' | 'app' | 'url';
  source: 'open' | 'recent';
}

interface RecommendPanelProps {
  open: boolean;
  spaces: Space[];
  onClose: () => void;
  onAddItems: (spaceId: string, items: Omit<LauncherItem, 'id'>[]) => void;
}

export function RecommendPanel({ open, spaces, onClose, onAddItems }: RecommendPanelProps) {
  const [items, setItems] = useState<RecommendItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [targetSpaceId, setTargetSpaceId] = useState('');

  // All existing values for dedup
  const existingValues = useMemo(() => {
    const set = new Set<string>();
    for (const s of spaces) {
      for (const it of s.items) set.add(it.value.toLowerCase());
    }
    return set;
  }, [spaces]);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const [openResult, recentResult] = await Promise.all([
        electronAPI.getOpenWindows(),
        electronAPI.getRecentItems(),
      ]);

      const candidates: RecommendItem[] = [];
      const seen = new Set<string>();
      const add = (item: RecommendItem) => {
        const key = item.value.toLowerCase();
        if (seen.has(key) || existingValues.has(key)) return;
        seen.add(key);
        candidates.push(item);
      };

      // Open Explorer windows → folder recommendations
      for (const w of openResult.windows) {
        if (w.FolderPath) {
          add({ title: w.MainWindowTitle || w.FolderPath.split('\\').pop() || w.FolderPath, value: w.FolderPath, type: 'folder', source: 'open' });
        } else if (w.ExePath) {
          add({ title: w.MainWindowTitle || w.ProcessName || '', value: w.ExePath, type: 'app', source: 'open' });
        }
      }

      // Open browser tabs → URL recommendations
      for (const tab of openResult.browserTabs) {
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
          add({ title: tab.title || tab.url, value: tab.url, type: 'url', source: 'open' });
        }
      }

      // Recent items → folder/app recommendations
      for (const r of recentResult) {
        add({ title: r.title, value: r.value, type: r.type, source: 'recent' });
      }

      setItems(candidates);
      setChecked(new Set(candidates.map(c => c.value)));
    } catch { /* silent */ }
    setLoading(false);
  }, [existingValues]);

  useEffect(() => {
    if (open) {
      scan();
      if (!targetSpaceId && spaces.length > 0) setTargetSpaceId(spaces[0].id);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (value: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const toggleAll = (type: string) => {
    const group = items.filter(i => i.type === type);
    const allChecked = group.every(i => checked.has(i.value));
    setChecked(prev => {
      const next = new Set(prev);
      for (const i of group) { if (allChecked) next.delete(i.value); else next.add(i.value); }
      return next;
    });
  };

  const handleAdd = () => {
    if (!targetSpaceId || checked.size === 0) return;
    const toAdd = items.filter(i => checked.has(i.value)).map(i => ({
      title: i.title,
      value: i.value,
      type: i.type as LauncherItem['type'],
    }));
    onAddItems(targetSpaceId, toAdd);
    // Remove added items from list
    setItems(prev => prev.filter(i => !checked.has(i.value)));
    setChecked(new Set());
  };

  if (!open) return null;

  const folders = items.filter(i => i.type === 'folder');
  const apps = items.filter(i => i.type === 'app');
  const urls = items.filter(i => i.type === 'url');

  return (
    <div style={{
      position: 'absolute', left: 44, top: 0, bottom: 0, width: 320,
      background: 'var(--surface)', borderRight: '1px solid var(--border-rgba)',
      display: 'flex', flexDirection: 'column', zIndex: 100,
      boxShadow: '4px 0 16px rgba(0,0,0,0.15)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderBottom: '1px solid var(--border-rgba)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="lightbulb" size={16} color="var(--accent)" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>추천 항목</span>
          {!loading && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{items.length}개 발견</span>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={scan} disabled={loading} title="새로고침" style={iconBtnStyle}>
            <Icon name="refresh" size={15} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
          </button>
          <button onClick={onClose} title="닫기" style={iconBtnStyle}>
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)', fontSize: 12 }}>
            <Icon name="hourglass_empty" size={24} style={{ display: 'block', margin: '0 auto 8px', animation: 'spin 1.5s linear infinite' }} />
            스캔 중...
          </div>
        )}
        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)', fontSize: 12 }}>
            새로 추가할 항목이 없습니다
          </div>
        )}
        {!loading && folders.length > 0 && <Section icon="folder" label="폴더" items={folders} checked={checked} onToggle={toggle} onToggleAll={() => toggleAll('folder')} />}
        {!loading && apps.length > 0 && <Section icon="apps" label="앱" items={apps} checked={checked} onToggle={toggle} onToggleAll={() => toggleAll('app')} />}
        {!loading && urls.length > 0 && <Section icon="language" label="사이트" items={urls} checked={checked} onToggle={toggle} onToggleAll={() => toggleAll('url')} />}
      </div>

      {/* Footer */}
      {!loading && items.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', borderTop: '1px solid var(--border-rgba)',
        }}>
          <select
            value={targetSpaceId}
            onChange={e => setTargetSpaceId(e.target.value)}
            style={{
              flex: 1, height: 30, borderRadius: 6, border: '1px solid var(--border-rgba)',
              background: 'var(--surface)', color: 'var(--text)', fontSize: 11,
              padding: '0 8px', fontFamily: 'inherit',
            }}
          >
            {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            onClick={handleAdd}
            disabled={checked.size === 0}
            style={{
              height: 30, padding: '0 14px', borderRadius: 6, border: 'none',
              background: checked.size > 0 ? 'var(--accent)' : 'var(--border-rgba)',
              color: '#fff', fontSize: 11, fontWeight: 600, cursor: checked.size > 0 ? 'pointer' : 'default',
              fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            {checked.size}개 추가
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Section ──────────────────────────────────────────── */
function Section({ icon, label, items, checked, onToggle, onToggleAll }: {
  icon: string; label: string; items: RecommendItem[];
  checked: Set<string>; onToggle: (v: string) => void; onToggleAll: () => void;
}) {
  const allChecked = items.every(i => checked.has(i.value));
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        onClick={onToggleAll}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <Icon name={icon} size={14} color="var(--text-dim)" />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', flex: 1 }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{items.length}개</span>
        <Icon name={allChecked ? 'check_box' : 'check_box_outline_blank'} size={14} color={allChecked ? 'var(--accent)' : 'var(--text-dim)'} />
      </div>
      {items.map(item => (
        <RecommendRow key={item.value} item={item} checked={checked.has(item.value)} onToggle={() => onToggle(item.value)} />
      ))}
    </div>
  );
}

/* ── Row ──────────────────────────────────────────── */
function RecommendRow({ item, checked, onToggle }: { item: RecommendItem; checked: boolean; onToggle: () => void }) {
  const displayValue = item.type === 'url'
    ? (() => { try { return new URL(item.value).hostname; } catch { return item.value; } })()
    : item.value.length > 40 ? '...' + item.value.slice(-38) : item.value;

  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px 5px 28px',
        cursor: 'pointer', borderRadius: 4, transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon
        name={checked ? 'check_box' : 'check_box_outline_blank'}
        size={15}
        color={checked ? 'var(--accent)' : 'var(--text-dim)'}
        style={{ flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayValue}
        </div>
      </div>
      {item.source === 'open' && (
        <span style={{ fontSize: 9, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>열림</span>
      )}
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-dim)', padding: 4, borderRadius: 4, display: 'flex',
};
