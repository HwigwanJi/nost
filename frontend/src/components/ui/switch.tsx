"use client"

// Custom Switch — pure CSS, no Base UI dependency
// Fixes thumb overflowing the track on the right side.

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

function Switch({ checked, onCheckedChange, disabled = false }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--accent, #6366f1)' : 'rgba(120,120,130,0.3)',
        transition: 'background 0.18s',
        flexShrink: 0,
        padding: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          transition: 'left 0.18s',
          pointerEvents: 'none',
        }}
      />
    </button>
  );
}

export { Switch };
