import { useEffect, useState } from 'react';
import { ContainerSlotPicker, type PendingRemoval, type PendingNewItem } from '../components/ContainerSlotPicker';
import { useSatelliteTheme } from '../lib/satelliteTheme';
import type { LauncherItem, Space, ContainerSlots } from '../types';

export interface ContainerSlotPickerSatelliteState {
  containerItem: LauncherItem;
  containerSpaceId: string;
  defaultDir?: string;
  allSpaces: Space[];
  accentColor?: string;
  theme?: 'light' | 'dark';
}

type Action =
  | { kind: 'close' }
  | { kind: 'save'; slots: ContainerSlots; removals: PendingRemoval[]; newItems: PendingNewItem[] };

interface Api {
  onState: (cb: (s: ContainerSlotPickerSatelliteState) => void) => () => void;
  requestState: () => void;
  action: (p: Action) => void;
}

const api = (window as unknown as { containerSlotPicker: Api }).containerSlotPicker;

export function ContainerSlotPickerSatellite() {
  const [state, setState] = useState<ContainerSlotPickerSatelliteState | null>(null);

  useEffect(() => {
    const off = api.onState(setState);
    api.requestState();
    return off;
  }, []);

  useSatelliteTheme(state);

  if (!state) return null;

  return (
    <ContainerSlotPicker
      open={true}
      onClose={() => api.action({ kind: 'close' })}
      containerItem={state.containerItem}
      containerSpaceId={state.containerSpaceId}
      defaultDir={state.defaultDir}
      allSpaces={state.allSpaces}
      onSave={(slots, removals, newItems) => api.action({ kind: 'save', slots, removals, newItems })}
    />
  );
}
