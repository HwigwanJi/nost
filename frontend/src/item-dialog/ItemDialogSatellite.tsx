/**
 * ItemDialogSatellite — runs the existing <ItemDialog> component inside
 * a standalone BrowserWindow so it can extend beyond the main nost
 * window's bounds (pair-split / narrow-window users were getting the
 * dialog clipped). See plans/satellite-dialogs.md.
 *
 * State flow (one direction in, actions out):
 *   main.js ─push─▶ `item-dialog-state` ─▶ this component
 *   this component ─send─▶ `item-dialog-action` ─▶ main forwards to
 *     mainWindow renderer (App.tsx) which runs the existing handlers
 *     (handleSaveItem, handleRequestAdvanced, handlePickOnScreen, …).
 *
 * The satellite does NOT own application state — it's a thin UI shell.
 * `editItem`, `spaces`, `presets`, settings etc. all arrive via state
 * pushes and submit answers flow back as action payloads.
 */

import { useEffect, useState } from 'react';
import { ItemDialog } from '../components/ItemDialog';
import type { LauncherItem, Space } from '../types';

interface PresetSummary {
  id: '1' | '2' | '3';
  label?: string;
  spaces: Space[];
}

export interface ItemDialogSatelliteState {
  /** The card being edited (or partial prefill). Use the same key
   *  semantics as the main App's <ItemDialog key={...}> so the
   *  satellite re-mounts on change. */
  editItem: LauncherItem | null;
  spaces: Space[];
  defaultSpaceId?: string;
  monitorCount?: number;
  allowedTypes?: Array<LauncherItem['type']>;
  docExtensions?: readonly string[];
  presets?: PresetSummary[];
  currentPresetId?: '1' | '2' | '3';
  startAdvanced?: boolean;
  /** Theme — applied as CSS variables on :root so the dialog matches
   *  the user's main-app accent. */
  accentColor?: string;
}

type Action =
  | { kind: 'close' }
  | { kind: 'save'; spaceId: string; item: Omit<LauncherItem, 'id'> | LauncherItem; targetPresetId?: '1' | '2' | '3' }
  | { kind: 'request-advanced'; spaceId: string }
  | { kind: 'pick-on-screen'; item: Omit<LauncherItem, 'id'> }
  | { kind: 'toast'; msg: string; opts?: { duration?: number } };

interface Api {
  onState: (cb: (s: ItemDialogSatelliteState) => void) => () => void;
  requestState: () => void;
  action: (payload: Action) => void;
}

const api = (window as unknown as { itemDialog: Api }).itemDialog;

export function ItemDialogSatellite() {
  const [state, setState] = useState<ItemDialogSatelliteState | null>(null);

  useEffect(() => {
    const off = api.onState(setState);
    api.requestState();
    return off;
  }, []);

  // Apply accent color to :root so the same CSS variables (--accent,
  // --accent-dim) the dialog reads are present in this satellite window.
  // Mirrors the App.tsx effect at App.tsx:1862.
  useEffect(() => {
    const accent = state?.accentColor || '#6366f1';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-dim', accent + '33');
  }, [state?.accentColor]);

  // ESC outside any focused input → close. ItemDialog's own Radix
  // Dialog wires ESC, but if the user clicks the empty backdrop area
  // (transparent window background) the dialog wouldn't see it. This
  // handler is a safety net.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        api.action({ kind: 'close' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!state) return null;

  // Mirror the inline-render's `key` semantics so ItemDialog's internal
  // form/phase state resets when the satellite is reused for a different
  // card (single-instance satellite — same window, new payload).
  const editKey =
    (state.editItem && 'id' in state.editItem && (state.editItem as { id?: string }).id)
      ? `edit-${(state.editItem as { id: string }).id}`
      : state.editItem
        ? `prefill-${String((state.editItem as { value?: string }).value ?? '')}`
        : 'none';
  const dialogKey = editKey + (state.startAdvanced ? ':adv' : '');

  // `editItem` may be null (new card) or a partial prefill (drag-drop /
  // scan). ItemDialog tolerates both via its existing prefill logic.
  return (
    <ItemDialog
      key={dialogKey}
      open={true}
      onClose={() => api.action({ kind: 'close' })}
      spaces={state.spaces}
      editItem={state.editItem}
      defaultSpaceId={state.defaultSpaceId}
      monitorCount={state.monitorCount}
      allowedTypes={state.allowedTypes}
      docExtensions={state.docExtensions}
      presets={state.presets}
      currentPresetId={state.currentPresetId}
      startAdvanced={state.startAdvanced}
      onSave={(spaceId, item, targetPresetId) =>
        api.action({ kind: 'save', spaceId, item, targetPresetId })
      }
      onRequestAdvanced={(spaceId) =>
        api.action({ kind: 'request-advanced', spaceId })
      }
      onPickOnScreen={(item) =>
        api.action({ kind: 'pick-on-screen', item })
      }
      showToast={(msg, opts) =>
        api.action({ kind: 'toast', msg, opts: opts ? { duration: opts.duration } : undefined })
      }
    />
  );
}
