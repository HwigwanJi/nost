import type { ToastAction, ToastItem } from '../hooks/useToastQueue';

interface ToastOverlayProps {
  toasts: ToastItem[];
  onPause:   (id: number) => void;
  onResume:  (id: number) => void;
  onDismiss: (id?: number) => void;
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      flexShrink: 0,
      width: 13,
      height: 13,
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff',
      borderRadius: '50%',
      animation: 'toastSpin 0.7s linear infinite',
    }} />
  );
}

function ToastBubble({ item, onPause, onResume, onDismiss }: {
  item: ToastItem;
  onPause:   () => void;
  onResume:  () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      style={{
        background: 'var(--accent)',
        color: '#fff',
        padding: '7px 12px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 500,
        pointerEvents: 'all',
        boxShadow: '0 4px 20px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.12)',
        animation: 'toastFadeInUp 0.18s ease-out',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        maxWidth: 360,
        minWidth: 0,
        width: 'max-content',
        flexShrink: 0,
      }}
    >
      {item.spinner && <Spinner />}

      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
        {item.msg}
      </span>

      {item.persistent && !item.spinner && (
        <kbd style={{
          padding: '2px 6px',
          background: 'rgba(255,255,255,0.22)',
          border: '1px solid rgba(255,255,255,0.35)',
          borderRadius: 5,
          fontSize: 10,
          fontWeight: 700,
          fontFamily: 'inherit',
          letterSpacing: '0.03em',
          color: '#fff',
          flexShrink: 0,
          cursor: 'default',
        }}>
          ESC
        </kbd>
      )}

      {item.actions && item.actions.length > 0 && (
        <>
          {item.actions.map((action: ToastAction, i) => (
            <button
              key={i}
              onClick={action.onClick}
              style={{
                padding: '4px 8px',
                background: action.danger ? '#ef4444' : 'rgba(255,255,255,0.22)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 6,
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontFamily: 'inherit',
                fontWeight: 600,
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 11 }}>{action.icon}</span>
              {action.label}
            </button>
          ))}
          <button
            onClick={onDismiss}
            style={{
              padding: '4px 5px',
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#fff',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 11 }}>close</span>
          </button>
        </>
      )}
    </div>
  );
}

export function ToastOverlay({ toasts, onPause, onResume, onDismiss }: ToastOverlayProps) {
  if (toasts.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes toastSpin { to { transform: rotate(360deg); } }
        @keyframes toastFadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>

      {/*
        Flex column-reverse: items laid out bottom-to-top.
        oldest item (index 0) → rendered at bottom, newest → top.
        Container anchored at bottom: 20px, centered horizontally.
        Height is content-driven → no fixed-size math, no overlap.
      */}
      <div style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column-reverse',
        alignItems: 'center',
        gap: 8,
      }}>
        {toasts.map(item => (
          <ToastBubble
            key={item.id}
            item={item}
            onPause={() => onPause(item.id)}
            onResume={() => onResume(item.id)}
            onDismiss={() => onDismiss(item.id)}
          />
        ))}
      </div>
    </>
  );
}
