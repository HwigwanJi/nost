import { useEffect, useState } from 'react';
import { BatchDropDialog, type PendingDrop } from '../components/BatchDropDialog';
import { useSatelliteTheme } from '../lib/satelliteTheme';
import type { LauncherItem, Space } from '../types';

export interface BatchDropDialogSatelliteState {
  items: PendingDrop[];
  spaces: Space[];
  defaultSpaceId: string;
  accentColor?: string;
  theme?: 'light' | 'dark';
}

type Action =
  | { kind: 'close' }
  | { kind: 'confirm'; spaceId: string; items: Omit<LauncherItem, 'id'>[] };

interface Api {
  onState: (cb: (s: BatchDropDialogSatelliteState) => void) => () => void;
  requestState: () => void;
  action: (p: Action) => void;
}

const api = (window as unknown as { batchDropDialog: Api }).batchDropDialog;

export function BatchDropDialogSatellite() {
  const [state, setState] = useState<BatchDropDialogSatelliteState | null>(null);

  useEffect(() => {
    const off = api.onState(setState);
    api.requestState();
    return off;
  }, []);

  useSatelliteTheme(state);

  if (!state) return null;

  return (
    <BatchDropDialog
      open={true}
      items={state.items}
      spaces={state.spaces}
      defaultSpaceId={state.defaultSpaceId}
      onClose={() => api.action({ kind: 'close' })}
      onConfirm={(spaceId, items) => api.action({ kind: 'confirm', spaceId, items })}
    />
  );
}
