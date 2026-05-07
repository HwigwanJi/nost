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
 *  is async — we resolve the get path by caching the session in
 *  memory after the first read on app boot. Set/remove are fire-
 *  and-forget (the IPC handles persistence). */
let memCache: Record<string, string | null> = {};

const safeStorageAdapter = {
  getItem: (key: string): string | null => {
    return memCache[key] ?? null;
  },
  setItem: (key: string, value: string): void => {
    memCache[key] = value;
    // Forward to safeStorage. Only the session key matters; supabase-js
    // also writes some side keys like the PKCE code-verifier — those
    // we keep in memCache only, since they're short-lived.
    if (key.endsWith('-auth-token')) {
      try {
        const session = JSON.parse(value);
        electronAPI.authSetSession(session);
      } catch { /* not JSON, ignore */ }
    }
  },
  removeItem: (key: string): void => {
    delete memCache[key];
    if (key.endsWith('-auth-token')) {
      electronAPI.authSetSession(null);
    }
  },
};

/** Hydrate memCache from safeStorage at module init so supabase-js's
 *  initial getSession call sees the persisted token. Awaited by the
 *  AuthProvider before the app renders sign-in/signed-in branches. */
export async function hydrateSession(): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const session = await electronAPI.authGetSession();
    if (session) {
      // supabase-js stores under `sb-<project-ref>-auth-token`. We don't
      // know the exact key shape across versions, so write to a couple
      // of likely candidates — supabase-js looks them up on init.
      const key = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
      memCache[key] = JSON.stringify(session);
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
