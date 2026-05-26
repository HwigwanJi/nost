/**
 * SettingsDialogSatellite — Settings runs in its own BrowserWindow so
 * it isn't clipped by the launcher's pair-split rectangle. The host
 * SettingsDialog component is reused as-is; we mirror the inline
 * call-site's props via state push + action IPC. See
 * plans/satellite-dialogs.md.
 *
 * Limitation note: onSave fires LIVE during slider drags (~60Hz). Each
 * fire becomes one IPC to main → main renderer → store.updateSettings.
 * Payload is a small AppSettings object so throughput is fine, but
 * means the live preview updates with one round-trip extra latency
 * vs. the inline version. Acceptable for v1.3.44; revisit if jank.
 */

import { useEffect, useState } from 'react';
import { SettingsDialog } from '../components/SettingsDialog';
import { useSatelliteTheme } from '../lib/satelliteTheme';
import { applyExternalAuthState } from '../lib/auth';
import type { AppSettings } from '../types';
import type { User } from '@supabase/supabase-js';

export interface SettingsDialogSatelliteState {
  settings: AppSettings;
  updateDownloaded?: boolean;
  downloadProgress?: number | null;
  initialTab?: string;
  accentColor?: string;
  theme?: 'light' | 'dark';
  // v1.3.48 — Main-renderer auth state piggy-backed onto the state push.
  // Required so AccountTab can show the signed-in profile instead of the
  // sign-in CTA. Without this, the satellite's auth.ts module-singleton
  // stays at INITIAL and the panel never reflects the live session.
  auth?: {
    status: 'idle' | 'signed-out' | 'authing' | 'signed-in' | 'error';
    user: User | null;
    configured: boolean;
  };
}

type Action =
  | { kind: 'close' }
  | { kind: 'save'; settings: AppSettings }
  | { kind: 'start-tutorial'; quest: unknown }
  | { kind: 'open-memo-trash' }
  | { kind: 'extend-all-memos' }
  | { kind: 'empty-memo-trash' }
  // v1.3.48 — Routed to App.tsx::handleSignOut. Satellite cannot call
  // supabase.auth.signOut() directly because its own supabase client
  // never received a session.
  | { kind: 'signout' };

interface Api {
  onState: (cb: (s: SettingsDialogSatelliteState) => void) => () => void;
  requestState: () => void;
  action: (payload: Action) => void;
}

const api = (window as unknown as { settingsDialog: Api }).settingsDialog;

export function SettingsDialogSatellite() {
  const [state, setState] = useState<SettingsDialogSatelliteState | null>(null);

  useEffect(() => {
    const off = api.onState((s) => {
      setState(s);
      // v1.3.48 — Mirror main's auth state into this satellite's local
      // auth.ts singleton so useAuth() inside AccountTab returns the
      // correct signed-in/out shape. main publishes on every change.
      if (s.auth) {
        applyExternalAuthState({
          status: s.auth.status,
          user: s.auth.user,
          configured: s.auth.configured,
        });
      }
    });
    api.requestState();
    return off;
  }, []);

  useSatelliteTheme(state);

  if (!state) return null;

  return (
    <SettingsDialog
      open={true}
      onClose={() => api.action({ kind: 'close' })}
      settings={state.settings}
      onSave={(s) => api.action({ kind: 'save', settings: s })}
      updateDownloaded={state.updateDownloaded}
      downloadProgress={state.downloadProgress}
      initialTab={state.initialTab as never}
      onStartTutorial={(q) => api.action({ kind: 'start-tutorial', quest: q as unknown })}
      onOpenMemoTrash={() => api.action({ kind: 'open-memo-trash' })}
      // SettingsDialog displays the returned count in a toast — across
      // IPC we lose that synchronous return value. Return 0 so the UI
      // doesn't claim a misleading nonzero count; main app handles the
      // user-visible toast separately if needed.
      onExtendAllMemos={() => { api.action({ kind: 'extend-all-memos' }); return 0; }}
      onEmptyMemoTrash={() => { api.action({ kind: 'empty-memo-trash' }); return 0; }}
    />
  );
}
