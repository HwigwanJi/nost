/**
 * Supabase client — single instance for the whole renderer.
 *
 * Auth tokens live in OS-encrypted storage (Electron safeStorage)
 * via IPC. We hand supabase-js a custom storage adapter that maps
 * its localStorage-style get/set/remove calls to that IPC. This
 * means tokens never touch localStorage / window globals / dev tools
 * — even with nodeIntegration off, an XSS would have nothing to read.
 *
 * Env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (anon key is public
 * by design; server-side Row Level Security is what protects data).
 * If env is empty (e.g. fresh checkout, no .env), client is exported
 * as `null` and consumers must guard. SignInScreen renders a config
 * notice in that case.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { electronAPI } from '../electronBridge';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

/** supabase-js storage adapter that proxies to safeStorage IPC.
 *  supabase-js calls these synchronously in some paths but the IPC
 *  is async — we resolve the get path by caching every key in memory
 *  after `hydrateSession` runs at boot. Set persists EVERY key (not
 *  just the session) so that PKCE code-verifiers and any other side
 *  keys survive a fresh-instance handoff during the OAuth round-trip
 *  — Windows dev-mode `nost://` callbacks can spawn a new electron.exe
 *  whose renderer memory is born empty, and the verifier MUST be
 *  available when exchangeCodeForSession asks for it. */
let memCache: Record<string, string | null> = {};

const safeStorageAdapter = {
  getItem: (key: string): string | null => {
    return memCache[key] ?? null;
  },
  setItem: (key: string, value: string): void => {
    memCache[key] = value;
    // Persist every key (PKCE verifier, session token, anything supabase
    // decides to add later). The session also goes through the legacy
    // dedicated IPC for back-compat with installs that pre-date the kv
    // store; both writes are idempotent.
    electronAPI.authKvSet(key, value).catch(() => undefined);
    if (key.endsWith('-auth-token')) {
      try {
        const session = JSON.parse(value);
        electronAPI.authSetSession(session);
      } catch { /* not JSON, ignore */ }
    }
  },
  removeItem: (key: string): void => {
    delete memCache[key];
    electronAPI.authKvSet(key, null).catch(() => undefined);
    if (key.endsWith('-auth-token')) {
      electronAPI.authSetSession(null);
    }
  },
};

/** Hydrate memCache from safeStorage at module init so supabase-js's
 *  initial getSession call AND a post-callback exchangeCodeForSession
 *  call both see the persisted state. Awaited by the AuthProvider
 *  before the app renders sign-in/signed-in branches. */
export async function hydrateSession(): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    // Pull every persisted auth key into memCache. This is what lets
    // PKCE survive an OAuth callback that lands on a fresh Electron
    // instance — the verifier was written to safeStorage by the first
    // instance and we restore it here before exchangeCodeForSession runs.
    const kv = await electronAPI.authKvList();
    for (const [k, v] of Object.entries(kv)) {
      if (typeof v === 'string') memCache[k] = v;
    }
    // Back-compat: legacy installs only wrote the session under the
    // dedicated IPC, not the generic kv store. Fall back to that if
    // the kv hydrate didn't pick up the canonical session key.
    const canonicalKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
    if (!memCache[canonicalKey]) {
      const session = await electronAPI.authGetSession();
      if (session) memCache[canonicalKey] = JSON.stringify(session);
    }
  } catch (err) {
    console.warn('[supabase] hydrateSession failed', err);
  }
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: safeStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false, // we handle the deep-link ourselves
        flowType: 'pkce',
      },
    })
  : null;
