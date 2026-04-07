import type { LauncherItem } from '../types';

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
          <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
            {item.type === 'folder' ? 'folder_open' : item.type === 'app' ? 'apps' : item.type === 'url' || item.type === 'browser' ? 'language' : 'window'}
          </span>
          {item.title}
          <span className="material-symbols-rounded" style={{ fontSize: 13, color: 'var(--text-dim)' }}>fullscreen</span>
        </button>
      ))}
      <button
        className="node-tile-btn"
        onClick={onDismiss}
        style={{ color: 'var(--text-dim)' }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: 14 }}>close</span>
      </button>
    </div>
  );
}
