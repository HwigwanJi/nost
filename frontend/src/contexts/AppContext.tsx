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
  /** When set, node mode is editing this existing NodeGroup (B mode).
   *  Null = building a new group (A mode) or not in node mode at all.
   *  ItemCard reads this to swap the click intent + display the
   *  "edit-existing" subset of visual signals (group-name halo, etc.). */
  editingNodeGroupId: string | null;
  deckItems: string[];
  decks: Deck[];
  deckAnchorItemIds: Set<string>;
  inactiveWindowIds: Set<string>;
  monitorCount: number;
  /** Full monitor descriptors — bounds + primary flag — used by the
   *  proportional MonitorPicker to render the user's actual layout.
   *  monitorCount remains for cheap "do I have multiple monitors?"
   *  checks; this is for spatial rendering. */
  monitors: Array<{ index: number; id: number; isPrimary: boolean; bounds: { x: number; y: number; width: number; height: number } }>;
  allItems: LauncherItem[];
  monitorDirections: Record<number, string> | undefined;
  closeAfter: boolean;
  /** v1.3.50 — 카드 4방향 액션 팝업 제스처 ('hold' | 'ctrl-click' | 'double-click'). */
  cardActionGesture: 'hold' | 'ctrl-click' | 'double-click';
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
  /** Clean-mode action: delete every unpinned/non-container item in a space. */
  onCleanSpace: (spaceId: string) => void;
  /** v1.3.48 — Clean-mode action on a single card click. Deletes that
   *  specific card with undo. Skipped if pinned / container (matches
   *  batch clean's pin-respect rule). User expectation: clean mode +
   *  card click = surgical delete, not no-op (which was the prior
   *  behaviour and confused users). */
  onCleanModeClick: (spaceId: string, itemId: string) => void;
  /**
   * Surface an actionable notification when a feature reaches for the
   * browser extension but the bridge is offline. Calm-by-default policy
   * (v1.3.33): the persistent "extension disconnected" alert was removed
   * because Chrome's service worker sleeps whenever the browser isn't
   * focused, producing constant false alarms. Features that genuinely
   * depend on the extension (smart scan, browser-tab card launch) call
   * this AT THE POINT they fail. dedupKey is shared so repeated misses
   * don't pile up bell rows.
   */
  notifyExtensionRequiredAtUseSite: (feature: string) => void;
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
