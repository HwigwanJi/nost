/**
 * AppShell — auth gate around the main App.
 *
 * Bootstraps the auth state machine on mount, then either:
 *   - shows a brief loader while we hydrate the persisted session
 *   - shows SignInScreen if the user is signed-out and hasn't yet
 *     dismissed the screen ("나중에 로그인" → sessionStorage flag)
 *   - shows the regular App otherwise
 *
 * Phase 1 keeps sign-in OPTIONAL — the user can use nost without a
 * Supabase session entirely. Phase 2+ may force it for sync features.
 */

import { useEffect, useState } from 'react';
import App from './App';
import { SignInScreen } from './components/SignInScreen';
import { bootstrapAuth, useAuth } from './lib/auth';

const SKIP_KEY = 'nost.auth.skipForSession';

export default function AppShell() {
  const auth = useAuth();
  const [skipped, setSkipped] = useState(() => sessionStorage.getItem(SKIP_KEY) === '1');

  useEffect(() => {
    bootstrapAuth();
  }, []);

  // Hydrating — render nothing for a beat to avoid a sign-in flash on
  // every app open when the user actually has a persisted session.
  if (auth.status === 'idle') return <BootSplash />;

  if (auth.status === 'signed-in') return <App />;

  if (skipped) return <App />;

  return (
    <SignInScreen
      onSkip={() => {
        sessionStorage.setItem(SKIP_KEY, '1');
        setSkipped(true);
      }}
    />
  );
}

function BootSplash() {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-rgba)',
    }}>
      <div style={{
        width: 24, height: 24,
        border: '2px solid var(--border-rgba)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'bootSpin 0.7s linear infinite',
      }} />
      <style>{`@keyframes bootSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
