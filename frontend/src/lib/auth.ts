/**
 * Auth state machine — external store, mirrors the tutorial pattern
 * (useSyncExternalStore subscribers, no React context needed).
 *
 * Lifecycle:
 *   idle    — boot before hydration completes
 *   signed-out — no session
 *   authing — signIn() in flight (browser open, awaiting callback)
 *   signed-in — session established
 *   error   — last attempt failed (kept until next signIn / dismiss)
 *
 * Sign-in flow (OAuth):
 *   1. signIn(provider) → supabase.auth.signInWithOAuth + electron
 *      opens system browser to the provider URL.
 *   2. User authorises → provider redirects to Supabase callback →
 *      Supabase 302s to nost://auth-callback#access_token=…
 *   3. main.js deep-link handler forwards URL via 'auth:deep-link'
 *      IPC. consumeDeepLink parses the fragment + calls
 *      supabase.auth.exchangeCodeForSession or setSession.
 *   4. supabase-js fires onAuthStateChange → our subscriber updates
 *      external store → useAuth re-renders.
 */

import { useSyncExternalStore } from 'react';
import type { Session, User, Provider } from '@supabase/supabase-js';
import { supabase, hydrateSession, isSupabaseConfigured } from './supabase';
import { electronAPI } from '../electronBridge';

export type AuthStatus = 'idle' | 'signed-out' | 'authing' | 'signed-in' | 'error';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  errorMessage: string | null;
  configured: boolean;
}

const INITIAL: AuthState = {
  status: 'idle',
  user: null,
  session: null,
  errorMessage: null,
  configured: isSupabaseConfigured,
};

let snapshot: AuthState = INITIAL;
const listeners = new Set<() => void>();

function setState(updater: (prev: AuthState) => AuthState) {
  const next = updater(snapshot);
  if (next === snapshot) return;
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): AuthState { return snapshot; }

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ── Lifecycle ────────────────────────────────────────────────────

let bootstrapped = false;

/** Called once near app mount. Hydrates from safeStorage, subscribes
 *  to supabase auth changes, and consumes any pending deep link that
 *  arrived before the renderer was ready. */
export async function bootstrapAuth(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  if (!isSupabaseConfigured || !supabase) {
    setState(prev => ({ ...prev, status: 'signed-out', configured: false }));
    return;
  }

  // Hard deadline: AppShell renders <BootSplash /> while status==='idle',
  // which means App (and therefore useAppData / dismissLoadingScreen)
  // is gated behind us reaching a non-idle state. If hydrateSession or
  // getSession ever hang (offline, IPC bridge slow, electron-store
  // wedged) the user stares at the dark #ql-loading overlay forever.
  // Force a fallback transition after 3 s so the app shell always
  // mounts; auth can finish in the background and flip status later
  // via onAuthStateChange.
  let bailedOut = false;
  const bailoutTimer = setTimeout(() => {
    bailedOut = true;
    console.warn('[auth] bootstrap exceeded 3 s — falling back to signed-out so the app shell can mount');
    setState(prev => prev.status === 'idle'
      ? { ...prev, status: 'signed-out' }
      : prev);
  }, 3000);

  try {
    await hydrateSession();

    // Subscribe to supabase-js's own auth state changes — single source
    // of truth for what session is active.
    supabase.auth.onAuthStateChange((_event, session) => {
      setState(prev => ({
        ...prev,
        status: session ? 'signed-in' : 'signed-out',
        user: session?.user ?? null,
        session: session ?? null,
        errorMessage: null,
      }));
    });

    // Initial getSession (after hydrate populates memCache)
    const { data: { session } } = await supabase.auth.getSession();
    if (!bailedOut) {
      setState(prev => ({
        ...prev,
        status: session ? 'signed-in' : 'signed-out',
        user: session?.user ?? null,
        session: session ?? null,
      }));
    } else if (session) {
      // Bail-out fired but we eventually got a session — promote.
      setState(prev => ({
        ...prev,
        status: 'signed-in',
        user: session.user,
        session,
      }));
    }

    // Wire renderer-side deep-link handler. Both the live event (subsequent
    // OAuth callbacks) and the consume-pending API (any callback that
    // landed before this listener was attached) feed the same handler.
    electronAPI.onAuthDeepLink(handleDeepLink);
    const pending = await electronAPI.authConsumePendingDeepLink();
    if (pending) handleDeepLink(pending);
  } finally {
    clearTimeout(bailoutTimer);
  }
}

async function handleDeepLink(url: string): Promise<void> {
  if (!supabase) return;
  try {
    // PKCE flow: callback contains ?code=…  → exchange for session
    const u = new URL(url);
    const code = u.searchParams.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return;
    }
    // Implicit flow: callback contains #access_token=…&refresh_token=…
    const hash = url.split('#')[1] ?? '';
    const params = new URLSearchParams(hash);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      return;
    }
    // Error in callback?
    const errorDesc = u.searchParams.get('error_description') ?? params.get('error_description');
    if (errorDesc) throw new Error(errorDesc);
  } catch (err) {
    setState(prev => ({
      ...prev,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    }));
  }
}

// ── Actions ──────────────────────────────────────────────────────

export async function signIn(provider: Provider): Promise<void> {
  if (!supabase) {
    setState(prev => ({ ...prev, status: 'error', errorMessage: 'Supabase가 설정되지 않았어요. .env 확인.' }));
    return;
  }
  setState(prev => ({ ...prev, status: 'authing', errorMessage: null }));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: 'nost://auth-callback',
      // skipBrowserRedirect lets supabase-js return the URL instead of
      // navigating the (non-existent) browser-window.location. We hand
      // it to the OS via Electron shell.openExternal.
      skipBrowserRedirect: true,
    },
  });
  if (error) {
    setState(prev => ({ ...prev, status: 'error', errorMessage: error.message }));
    return;
  }
  if (data?.url) {
    await electronAPI.authOpenOAuthUrl(data.url);
  }
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
  // onAuthStateChange will fire signed-out and our subscriber updates
  // state. Belt-and-suspenders: clear safeStorage too.
  await electronAPI.authSetSession(null);
}

/** Dismiss an error without retrying. */
export function clearAuthError(): void {
  setState(prev => prev.errorMessage ? { ...prev, errorMessage: null, status: prev.session ? 'signed-in' : 'signed-out' } : prev);
}
