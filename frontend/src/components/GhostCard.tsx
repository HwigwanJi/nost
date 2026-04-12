import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { GhostItem } from '../hooks/useGhostCards';

const TYPE_ICONS: Record<string, string> = {
  folder: 'folder',
  app: 'apps',
  url: 'language',
  document: 'description',
  browser: 'language',
  window: 'web_asset',
};

interface GhostCardProps {
  ghost: GhostItem;
  onAccept: () => void;
  onDismiss: () => void;
}

export function GhostCard({ ghost, onAccept, onDismiss }: GhostCardProps) {
  const [hover, setHover] = useState(false);

  const displayTitle = ghost.title.length > 20
    ? ghost.title.slice(0, 19) + '...'
    : ghost.title;

  return (
    <div
      onClick={onAccept}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 82,
        padding: 12,
        borderRadius: 12,
        border: '1.5px dashed',
        borderColor: hover ? 'var(--accent)' : 'var(--accent-dim)',
        background: hover ? 'var(--accent-dim)' : 'var(--surface)',
        opacity: hover ? 0.9 : 0.55,
        transform: hover ? 'scale(1.0)' : 'scale(0.97)',
        cursor: 'pointer',
        transition: 'all 0.15s ease-out',
        userSelect: 'none',
      }}
      title={`${ghost.value}\n클릭하여 추가`}
    >
      {/* Dismiss button (hover only) */}
      {hover && (
        <button
          onClick={e => { e.stopPropagation(); onDismiss(); }}
          style={{
            position: 'absolute', top: 3, right: 3,
            width: 16, height: 16, borderRadius: '50%',
            background: 'var(--accent-dim)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
          }}
        >
          <Icon name="close" size={10} color="var(--accent)" />
        </button>
      )}

      {/* Icon */}
      <Icon name={TYPE_ICONS[ghost.displayType] || TYPE_ICONS[ghost.type] || 'add'} size={28} color="var(--accent)" style={{ opacity: 0.6 }} />

      {/* Title */}
      <span style={{
        fontSize: 11.5, textAlign: 'center', lineHeight: 1.3,
        color: 'var(--text-muted)', width: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>
        {displayTitle}
      </span>

      {/* Source tag */}
      <span style={{
        position: 'absolute', bottom: 3, left: 5,
        fontSize: 8, color: 'var(--accent)', background: 'var(--accent-dim)',
        padding: '0px 4px', borderRadius: 3,
      }}>
        {ghost.source === 'open' ? '열림' : '최근'}
      </span>

      {/* Add hint */}
      {hover && (
        <span style={{
          position: 'absolute', bottom: 3, right: 5,
          fontSize: 8, color: 'var(--accent)', fontWeight: 600,
        }}>
          + 추가
        </span>
      )}
    </div>
  );
}
