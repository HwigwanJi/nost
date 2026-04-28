import { useEffect, useState } from 'react';
import { electronAPI, type MediaState } from '../electronBridge';

/**
 * useMediaState — single-subscription hook that returns the current
 * SMTC snapshot and re-renders on every push.
 *
 * Why a hook instead of a global Context: only widget cards care
 * about media state, and they're rare (≤1 free / unbounded Pro).
 * Each instance registers its own ipcRenderer listener — the cost is
 * trivial vs. the complexity of plumbing a provider for what is
 * effectively three short fields.
 *
 * The IPC bridge already returns an unsubscribe function from
 * `onMediaState`, so re-mounts don't pile up listeners (same lesson
 * we learned in v1.3.2 with the badge-launch handlers).
 *
 * On mount we also pull the current state via the handle, so a fresh
 * widget paints with real data immediately instead of flashing empty
 * for one event tick.
 */
export function useMediaState(): MediaState {
  const [state, setState] = useState<MediaState>({ supported: true, session: null });

  useEffect(() => {
    let alive = true;
    electronAPI.getMediaState().then(s => { if (alive) setState(s); });
    const off = electronAPI.onMediaState(s => setState(s));
    return () => { alive = false; off(); };
  }, []);

  return state;
}
