import type { ToastAction, ToastState } from '../hooks/useToastQueue';

interface ToastOverlayProps {
  toast: ToastState;
  onPause: () => void;
  onResume: () => void;
  onDismiss: () => void;
}

export function ToastOverlay({ toast, onPause, onResume, onDismiss }: ToastOverlayProps) {
  if (!toast) return null;

  const isPersistent = toast.persistent;
  const bg = isPersistent ? 'var(--accent)' : 'var(--text-color)';
  const fg = '#fff';

  return (
    <div
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        background: bg,
        color: fg,
        padding: '7px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 500,
        zIndex: 9999,
        pointerEvents: 'all',
        boxShadow: isPersistent
          ? '0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1)'
          : '0 4px 16px rgba(0,0,0,0.2)',
        animation: 'fadeInUp 0.2s ease-out',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 360,
        minWidth: 0,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
        {toast.msg}
      </span>

      {/* ESC badge for persistent toasts */}
      {isPersistent && (
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

      {toast.actions && toast.actions.length > 0 && (
        <>
          {toast.actions.map((action: ToastAction, i) => (
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
