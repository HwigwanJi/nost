import { Icon } from '@/components/ui/Icon';

type ClipboardType = 'url' | 'app' | 'folder';

interface ClipboardSuggestionProps {
  type: ClipboardType;
  value: string;
  label: string;
  onAdd: () => void;
  onDismiss: () => void;
}

const TYPE_META: Record<ClipboardType, { icon: string; color: string; desc: string }> = {
  url:    { icon: 'link',        color: 'var(--accent)',         desc: 'URL이 복사되어 있어요' },
  app:    { icon: 'apps',        color: '#22c55e',               desc: '앱 경로가 복사되어 있어요' },
  folder: { icon: 'folder_open', color: '#f59e0b',               desc: '폴더 경로가 복사되어 있어요' },
};

export function ClipboardSuggestion({ type, value: _value, label, onAdd, onDismiss }: ClipboardSuggestionProps) {
  const meta = TYPE_META[type];
  return (
    <div style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 10px 6px 12px',
      borderBottom: '1px solid var(--border-rgba)',
      background: 'var(--surface)',
      animation: 'slideDown 0.2s ease',
    }}>
      <style>{`@keyframes slideDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }`}</style>
      <Icon name={meta.icon} size={13} color={meta.color} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{meta.desc} — </span>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--text-color)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 160,
          display: 'inline-block',
          verticalAlign: 'bottom',
        }}>{label}</span>
      </div>
      <button
        onClick={onAdd}
        style={{
          padding: '2px 8px',
          borderRadius: 5,
          border: `1px solid ${meta.color}`,
          background: 'transparent',
          color: meta.color,
          fontSize: 10,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          flexShrink: 0,
        }}
      >
        추가
      </button>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
          alignItems: 'center',
          opacity: 0.5,
          flexShrink: 0,
        }}
        title="닫기"
      >
        <Icon name="close" size={13} color="var(--text-muted)" />
      </button>
    </div>
  );
}
