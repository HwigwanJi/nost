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
import type { AppSettings } from '../types';

export interface SettingsDialogSatelliteState {
  settings: AppSettings;
  updateDownloaded?: boolean;
  downloadProgress?: number | null;
  initialTab?: string;
  accentColor?: string;
}

type Action =
  | { kind: 'close' }
  | { kind: 'save'; settings: AppSettings }
  | { kind: 'start-tutorial'; quest: unknown }
  | { kind: 'open-memo-trash' }
  | { kind: 'extend-all-memos' }
  | { kind: 'empty-memo-trash' };

interface Api {
  onState: (cb: (s: SettingsDialogSatelliteState) => void) => () => void;
  requestState: () => void;
  action: (payload: Action) => void;
}

const api = (window as unknown as { settingsDialog: Api }).settingsDialog;

export function SettingsDialogSatellite() {
  const [state, setState] = useState<SettingsDialogSatelliteState | null>(null);

  useEffect(() => {
    const off = api.onState(setState);
    api.requestState();
    return off;
  }, []);

  useEffect(() => {
    const accent = state?.accentColor || '#6366f1';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-dim', accent + '33');
  }, [state?.accentColor]);

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
