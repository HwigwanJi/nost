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
      // Detect signed-out → signed-in transition so we can fire a
      // one-time "로그인됐어요" toast on the next App render. We use
      // sessionStorage rather than dispatching an event because the
      // App component (toast emitter) may not be mounted yet — the
      // AppShell flips from SignInScreen to App in the same render.
      // sessionStorage survives that flip and the App effect picks
      // up the flag, then clears it.
      const wasSignedOut = snapshot.status !== 'signed-in';
      if (session && wasSignedOut) {
        try {
          const label = session.user?.email
            ?? (session.user?.user_metadata?.full_name as string | undefined)
            ?? '계정';
          sessionStorage.setItem('nost:auth-toast', `signed-in:${label}`);
        } catch { /* sessionStorage disabled — silently skip */ }
      }
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

// v1.3.49 — 마지막으로 교환을 시도한 code. PKCE code 는 single-use 라
// 같은 code 를 두 번 exchange 하면 두 번째가 "invalid request / code not
// found" 로 실패. 중복 delivery (loopback + consume-pending 동시, 또는
// 연타) 를 가드. 성공/실패 무관 한 code 는 한 번만 시도.
let lastExchangedCode: string | null = null;

async function handleDeepLink(url: string): Promise<void> {
  if (!supabase) return;
  try {
    // PKCE flow: callback contains ?code=…  → exchange for session
    const u = new URL(url);
    const code = u.searchParams.get('code');
    if (code) {
      // v1.3.49 — 중복 교환 방어. 같은 code 가 두 번 들어오면 두 번째는
      // 이미 소비됐으므로 무시 (에러로 status 를 망치지 않음).
      if (code === lastExchangedCode) {
        console.warn('[auth] duplicate code delivery ignored');
        return;
      }
      lastExchangedCode = code;
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        // v1.3.49 — 정확한 supabase 에러를 main.log 에 남김. 이전엔
        // setState(error) 만 하고 로그를 안 남겨 원인 진단 불가였음.
        console.error('[auth] exchangeCodeForSession failed:', error.message, '(code:', error.code ?? 'n/a', 'status:', error.status ?? 'n/a', ')');
        throw error;
      }
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auth] handleDeepLink failed:', msg);
    setState(prev => ({
      ...prev,
      status: 'error',
      errorMessage: msg,
    }));
  }
}

// ── Actions ──────────────────────────────────────────────────────

export async function signIn(provider: Provider): Promise<void> {
  if (!supabase) {
    setState(prev => ({ ...prev, status: 'error', errorMessage: 'Supabase가 설정되지 않았어요. .env 확인.' }));
    return;
  }
  // v1.3.49 — 새 로그인 시도는 깨끗한 상태에서. 직전 실패의 dedup 가드를
  // 풀어 같은 브라우저 세션이 같은 code 를 다시 줘도 (드묾) 교환 시도 가능.
  lastExchangedCode = null;
  setState(prev => ({ ...prev, status: 'authing', errorMessage: null }));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // Loopback HTTP callback — Supabase redirects here after the
      // provider consent, and main.js's ext-server picks it up at
      // 127.0.0.1:14502/auth/callback. The previous `nost://` custom
      // scheme spawned a fresh electron.exe on every Windows handoff
      // (single-instance race), and left the user staring at a blank
      // supabase.co tab. The loopback path stays in one process and
      // lets us respond with a proper "로그인 완료" HTML page.
      // The Supabase project's "Redirect URLs" allow-list must include
      // this URL — see `plans/auth-status.md` §3.2.
      redirectTo: 'http://127.0.0.1:14502/auth/callback',
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

/**
 * Inject auth state from outside (used by satellite renderers).
 *
 * Background: each Electron satellite window (SettingsDialog etc.) runs
 * in its own renderer process, so its auth.ts module-singleton starts at
 * INITIAL and never hydrates — bootstrapAuth runs only in the main
 * window. Without this hook the satellite's `useAuth()` always returns
 * 'idle'/'signed-out' even when the user is signed in.
 *
 * Pattern: main renderer (App.tsx) watches its auth state and pushes
 * `{ status, user, configured }` through main process IPC; the
 * satellite's main.tsx receives the push and calls this to mirror
 * state into its local module. The satellite never talks to Supabase
 * directly — main is the SSOT, satellite is read-only view.
 */
export function applyExternalAuthState(s: {
  status: AuthStatus;
  user: User | null;
  configured: boolean;
}): void {
  setState(prev => ({
    ...prev,
    status: s.status,
    user: s.user,
    configured: s.configured,
    // session / errorMessage are main-only — leave undefined here so
    // satellite code that depends on them (rare) falls back to null.
    session: null,
    errorMessage: null,
  }));
}

/** Dismiss an error without retrying. */
export function clearAuthError(): void {
  setState(prev => prev.errorMessage ? { ...prev, errorMessage: null, status: prev.session ? 'signed-in' : 'signed-out' } : prev);
}
