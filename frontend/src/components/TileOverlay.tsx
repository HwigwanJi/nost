import type { LauncherItem } from '../types';
import { Icon } from '@/components/ui/Icon';

interface TileOverlayProps {
  items: LauncherItem[];
  leaving: boolean;
  onDismiss: () => void;
  onMaximize: (itemId: string) => void;
}

export function TileOverlay({ items, leaving, onDismiss, onMaximize }: TileOverlayProps) {
  if (items.length === 0) return null;

  return (
    <div className={`node-tile-overlay${leaving ? ' leaving' : ''}`}>
      {items.map(item => (
        <button
          key={item.id}
          className="node-tile-btn"
          onClick={() => onMaximize(item.id)}
        >
          <Icon name={item.type === 'folder' ? 'folder_open' : item.type === 'app' ? 'apps' : item.type === 'url' || item.type === 'browser' ? 'language' : 'window'} size={15} />
          {item.title}
          <Icon name="fullscreen" size={13} color="var(--text-dim)" />
        </button>
      ))}
      <button
        className="node-tile-btn"
        onClick={onDismiss}
        style={{ color: 'var(--text-dim)' }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
