import { createContext, useContext } from 'react';
import type { LauncherItem, AppMode, NodeGroup, Deck } from '../types';
import type { ToastAction } from '../hooks/useToastQueue';

export type ShowToast = (
  msg: string,
  options?: {
    actions?: ToastAction[];
    duration?: number;
    persistent?: boolean;
    spinner?: boolean;
    immediate?: boolean;
  }
) => void;

export interface AppState {
  activeMode: AppMode;
  nodeGroups: NodeGroup[];
  nodeBuilding: string[];
  deckItems: string[];
  decks: Deck[];
  deckAnchorItemIds: Set<string>;
  inactiveWindowIds: Set<string>;
  monitorCount: number;
  allItems: LauncherItem[];
  monitorDirections: Record<number, string> | undefined;
  closeAfter: boolean;
  searchQuery: string;
  justAddedItemIds: Set<string>;
}

export interface AppActions {
  showToast: ShowToast;
  launchAndPosition: (item: LauncherItem, closeAfter: boolean, monitor?: number) => Promise<void>;
  openMonitorSettings: () => void;
  onPinModeClick: (itemId: string) => void;
  onNodeModeClick: (itemId: string) => void;
  onNodeGroupLaunch: (groupId: string) => void;
  onDeckModeClick: (itemId: string) => void;
  onDeckGroupLaunch: (itemId: string) => void;
  onWindowInactiveClick: (item: LauncherItem) => void;
}

const AppStateCtx = createContext<AppState | null>(null);
const AppActionsCtx = createContext<AppActions | null>(null);

export const AppStateProvider = AppStateCtx.Provider;
export const AppActionsProvider = AppActionsCtx.Provider;

export function useAppState(): AppState {
  const ctx = useContext(AppStateCtx);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}

export function useAppActions(): AppActions {
  const ctx = useContext(AppActionsCtx);
  if (!ctx) throw new Error('useAppActions must be used within AppActionsProvider');
  return ctx;
}
