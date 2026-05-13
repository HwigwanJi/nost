/**
 * SignInScreen — pre-session gate.
 *
 * Rendered in place of the main app when status === 'signed-out' (or
 * 'authing' / 'error'). Two OAuth buttons + a friendly intro. Stays
 * minimal — sync is opt-in for now (Phase 2 lights it up); Phase 1
 * just needs the user to land on a stable signed-in state so we can
 * verify the OAuth + persistence loop works.
 *
 * If Supabase isn't configured (no .env), shows a config notice
 * instead of broken sign-in buttons.
 */

import { Icon } from '@/components/ui/Icon';
import { NostLogo } from '@/components/ui/NostLogo';
import { signIn, clearAuthError, useAuth } from '../lib/auth';

interface Props {
  /** Allow the user to use nost without signing in. Phase 1 always
   *  wants this on (sign-in is optional). Phase 2+ may force it for
   *  Pro tiers.  */
  onSkip?: () => void;
}

export function SignInScreen({ onSkip }: Props) {
  const auth = useAuth();
  const isAuthing = auth.status === 'authing';

  if (!auth.configured) {
    return (
      <Shell>
        <Header />
        <div style={messageBoxStyle}>
          <Icon name="warning" size={20} color="var(--accent)" />
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Supabase가 설정되지 않았어요</p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              <code style={codeStyle}>frontend/.env</code>에 <code style={codeStyle}>VITE_SUPABASE_URL</code>과
              {' '}<code style={codeStyle}>VITE_SUPABASE_ANON_KEY</code>를 채워주세요. Supabase 대시보드 →
              {' '}Project Settings → API에서 복사할 수 있어요.
            </p>
          </div>
        </div>
        {onSkip && <SkipButton onSkip={onSkip} label="설정 없이 계속 사용" />}
      </Shell>
    );
  }

  return (
    <Shell>
      <Header />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        <ProviderButton
          icon="login"
          label="Google로 계속하기"
          onClick={() => signIn('google')}
          disabled={isAuthing}
        />
        <ProviderButton
          icon="code"
          label="GitHub으로 계속하기"
          onClick={() => signIn('github')}
          disabled={isAuthing}
        />
      </div>
      {isAuthing && (
        <p style={subtleStyle}>
          브라우저에서 인증을 완료해주세요. nost는 잠시 후 자동으로 이어서 진행해요.
        </p>
      )}
      {auth.errorMessage && (
        <div style={errorBoxStyle}>
          <Icon name="error" size={14} color="var(--destructive, #ef4444)" />
          <span style={{ flex: 1, fontSize: 11, color: 'var(--destructive, #ef4444)', lineHeight: 1.5 }}>
            {auth.errorMessage}
          </span>
          <button type="button" onClick={clearAuthError} style={dismissBtnStyle} title="닫기">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      {onSkip && !isAuthing && (
        <SkipButton onSkip={onSkip} label="다음에 로그인" />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      background: 'var(--bg-rgba)',
    }}>
      <div style={{
        width: 360, maxWidth: '92%',
        display: 'flex', flexDirection: 'column', gap: 14,
        padding: 28,
        borderRadius: 14,
        background: 'var(--surface)',
        border: '1px solid var(--border-rgba)',
      }}>
        {children}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <NostLogo size={36} color="var(--accent)" />
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-color)' }}>nost</h1>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          로그인하면 카드와 메모를 다른 PC에서도 이어서 쓸 수 있어요.
        </p>
      </div>
    </div>
  );
}

function ProviderButton({ icon, label, onClick, disabled }: {
  icon: string; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: 40, padding: '0 14px',
        borderRadius: 8,
        border: '1px solid var(--border-rgba)',
        background: 'var(--bg-rgba)',
        color: 'var(--text-color)',
        fontSize: 13, fontWeight: 600,
        fontFamily: 'inherit',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-rgba)'; }}
    >
      <Icon name={icon} size={16} color="var(--text-muted)" />
      {label}
    </button>
  );
}

function SkipButton({ onSkip, label }: { onSkip: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      style={{
        marginTop: 6,
        height: 28, padding: '0 12px',
        borderRadius: 6,
        background: 'transparent',
        border: 'none',
        color: 'var(--text-dim)',
        fontSize: 11, fontFamily: 'inherit',
        cursor: 'pointer',
        alignSelf: 'center',
      }}
    >
      {label}
    </button>
  );
}

const messageBoxStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10,
  padding: 12,
  borderRadius: 8,
  background: 'var(--accent-dim)',
  border: '1px solid var(--accent)',
};

const errorBoxStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--destructive, #ef4444) 12%, transparent)',
  border: '1px solid var(--destructive, #ef4444)',
};

const subtleStyle: React.CSSProperties = {
  margin: 0, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.55,
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  padding: '1px 5px',
  borderRadius: 3,
  background: 'var(--bg-rgba)',
  border: '1px solid var(--border-rgba)',
};

const dismissBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 18, height: 18, padding: 0,
  borderRadius: 4,
  border: 'none', background: 'transparent',
  color: 'var(--destructive, #ef4444)',
  cursor: 'pointer',
};
