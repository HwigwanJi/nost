/**
 * ItemWizardSatellite — runs the existing <ItemWizard> in a standalone
 * BrowserWindow. Covers BOTH inline call sites (mode='quick' for
 * clipboard auto-detect quickadd, mode='manual' for the full picker).
 * The `mode` arrives in the state push so a single satellite entry can
 * render either flavor.
 */

import { useEffect, useState } from 'react';
import { ItemWizard } from '../components/ItemWizard';
import type { LauncherItem, Space } from '../types';

export interface ItemWizardSatelliteState {
  mode: 'quick' | 'manual';
  spaces: Space[];
  defaultSpaceId: string;
  docExtensions?: string[];
  accentColor?: string;
}

type Action =
  | { kind: 'close' }
  | { kind: 'save'; spaceId: string; item: Omit<LauncherItem, 'id'> }
  | { kind: 'save-as-memo'; spaceId: string; body: string };

interface Api {
  onState: (cb: (s: ItemWizardSatelliteState) => void) => () => void;
  requestState: () => void;
  action: (payload: Action) => void;
}

const api = (window as unknown as { itemWizard: Api }).itemWizard;

export function ItemWizardSatellite() {
  const [state, setState] = useState<ItemWizardSatelliteState | null>(null);

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

  // ESC safety net (when click lands on transparent window background)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && t?.tagName !== 'INPUT' && t?.tagName !== 'TEXTAREA') {
        api.action({ kind: 'close' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!state) return null;

  // Key forces internal-state reset when mode flips (rare — main reuses
  // the satellite for either flavor, but the wizard's phase machine
  // needs to restart).
  const dialogKey = `${state.mode}:${state.defaultSpaceId}`;

  return (
    <ItemWizard
      key={dialogKey}
      open={true}
      mode={state.mode}
      spaces={state.spaces}
      defaultSpaceId={state.defaultSpaceId}
      docExtensions={state.docExtensions}
      onClose={() => api.action({ kind: 'close' })}
      onSave={(spaceId, item) => api.action({ kind: 'save', spaceId, item })}
      onSaveAsMemo={(spaceId, body) => api.action({ kind: 'save-as-memo', spaceId, body })}
    />
  );
}
