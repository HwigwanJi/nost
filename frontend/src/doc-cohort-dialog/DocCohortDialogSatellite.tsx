import { useEffect, useState } from 'react';
import { DocCohortDialog } from '../components/DocCohortDialog';
import { useSatelliteTheme } from '../lib/satelliteTheme';
import type { LauncherItem, TokenPreset } from '../types';

export interface DocCohortDialogSatelliteState {
  item: LauncherItem;
  enabledPresets: TokenPreset[];
  labelOrder: string[];
  accentColor?: string;
  theme?: 'light' | 'dark';
}

type Action =
  | { kind: 'close' }
  | { kind: 'commit'; next: { value: string; pattern: string; tokenType: TokenPreset; directory: string } };

interface Api {
  onState: (cb: (s: DocCohortDialogSatelliteState) => void) => () => void;
  requestState: () => void;
  action: (p: Action) => void;
}

const api = (window as unknown as { docCohortDialog: Api }).docCohortDialog;

export function DocCohortDialogSatellite() {
  const [state, setState] = useState<DocCohortDialogSatelliteState | null>(null);

  useEffect(() => {
    const off = api.onState(setState);
    api.requestState();
    return off;
  }, []);

  useSatelliteTheme(state);

  if (!state) return null;

  return (
    <DocCohortDialog
      open={true}
      item={state.item}
      enabledPresets={state.enabledPresets}
      labelOrder={state.labelOrder}
      onCommit={(next) => api.action({ kind: 'commit', next })}
      onClose={() => api.action({ kind: 'close' })}
    />
  );
}
