import { Icon } from '@/components/ui/Icon';

type ClipboardType = 'url' | 'app' | 'folder' | 'hex' | 'text';

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
  // For hex, the leading colour swatch IS the icon — we override
  // `icon` to a generic palette glyph but the renderer paints the
  // suggestion itself with the captured colour (see HexSwatch
  // branch below) so the user can preview before adding.
  hex:    { icon: 'palette',     color: 'var(--accent)',         desc: '컬러 코드가 복사되어 있어요' },
  text:   { icon: 'content_paste', color: 'var(--text-muted)',   desc: '텍스트가 복사되어 있어요' },
};

export function ClipboardSuggestion({ type, value, label, onAdd, onDismiss }: ClipboardSuggestionProps) {
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
      {/* Hex preview — small colour square instead of an icon, so
          the user can see the actual captured colour before deciding
          to add. Other clipboard types use their type icon. */}
      {type === 'hex' ? (
        <span style={{
          width: 14, height: 14, borderRadius: 4,
          background: value,
          border: '1px solid var(--border-rgba)',
          flexShrink: 0,
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        }} />
      ) : (
        <Icon name={meta.icon} size={13} color={meta.color} style={{ flexShrink: 0 }} />
      )}
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
