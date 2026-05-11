/**
 * Conflict Avoidance Policy — SSOT for "can the user perform this
 * action right now?"
 *
 * Background — see `plans/conflict-avoidance-policy.md`. The principle:
 *   "지금 사용자가 하고 있는 행동과 충돌될 수 있는 행동은 금지한다."
 * Industry term: modal interaction discipline / mode integrity /
 * task focus protection. The "ding" Windows plays when you click
 * outside a modal dialog is `system modal feedback`.
 *
 * Why centralize: before this file, every trigger had its own
 * `if (activeMode !== 'normal') return;` style check. Each one was
 * a separate place to forget when adding a new mode / modal — which
 * is exactly how the "hold-press worked during pin mode" bug shipped.
 * Every trigger calls `canPerform(action, ctx)` and respects the
 * verdict. Adding a new mode = add one row to the §3 matrix and one
 * branch here.
 *
 * What this DOESN'T do:
 *   - Render feedback. Callers receive a BlockReason and decide
 *     whether to shake / toast / log. The helper `applyBlock()` in
 *     `lib/conflictFeedback.ts` is the recommended path; callers
 *     that want custom feedback can ignore it.
 *   - Read state. The PolicyContext is passed in by the caller — we
 *     don't reach into React state from a pure module. `userBusy`
 *     and `tutorialPhase` ARE read from their own SSOT singletons
 *     because they're already module-level globals.
 */

import { isUserBusy, busyKeys } from './userBusy';

/** Every action a trigger might want to perform. Keep this enum
 *  exhaustive — new triggers MUST register here so the matrix can't
 *  silently grow lanes that bypass the policy. */
export type ActionId =
  | 'card.launch'
  | 'card.hold-press'
  | 'card.drag'
  | 'card.edit'
  | 'card.delete'
  | 'tool.activate-pin'
  | 'tool.activate-node'
  | 'tool.activate-deck'
  | 'tool.activate-clean'
  | 'cmd.open'
  | 'settings.open'
  | 'slash.execute'
  | 'memo.open-editor'
  | 'preset.cycle'
  | 'undo'
  | 'redo';

export type BlockCategory =
  | 'tool'      // pin / node / deck / clean — actively editing with a tool
  | 'node-edit' // mid build/edit of a node group
  | 'deck-build'// mid build of a deck
  | 'memo'      // memo editor open
  | 'modal'     // ItemDialog / SettingsDialog / Wizard / Paywall
  | 'overlay'   // tile review overlay
  | 'cmd'       // slash / command bar
  | 'tutorial'; // tutorial step gating the user's attention

export interface BlockReason {
  /** Korean toast-ready 1-liner. The action handler decides whether
   *  to display this — most callers should via `applyBlock()`. */
  message: string;
  /** Coarse-grained label for telemetry / debug. */
  category: BlockCategory;
}

export interface PolicyContext {
  activeMode: 'normal' | 'pin' | 'node' | 'deck' | 'clean';
  nodeEditMode: boolean;
  deckBuilding: boolean;
  editingMemoId: string | null;
  /** App-level dialog enum. base-ui Dialogs are tracked via the
   *  `userBusy` registry instead — `useBusyMark` wires both. */
  dialog: 'none' | 'item' | 'settings' | (string & {});
  tileOverlayGroup: string | null;
  cmdOpen: boolean;
  /** True while a tutorial quest runner is on screen. We deliberately
   *  pass this in rather than read from `tutorial/state` here, because
   *  the gating logic for tutorial is non-trivial and lives in the
   *  tutorial module — too much complexity for this central function
   *  to absorb. Callers that want tutorial gating do it after this
   *  check. We just record the broad state for telemetry. */
  tutorialActive?: boolean;
}

/** Map of which actions a given mode allows past the block. Anything
 *  NOT in this set gets blocked when the mode is active. The action
 *  IDs here are the SAME strings as `ActionId` — keep in sync. */
const MODE_ALLOWLIST: Record<string, ReadonlySet<ActionId>> = {
  // Tool modes — only their respective "tool action" passes. The tool
  // action is dispatched via `card.launch` because that's what the
  // card click handler fires; `App.tsx` then branches by activeMode
  // (handlePinModeClick / handleNodeModeClick / etc).
  'tool:pin':   new Set<ActionId>(['card.launch']),
  'tool:node':  new Set<ActionId>(['card.launch']),
  'tool:deck':  new Set<ActionId>(['card.launch']),
  'tool:clean': new Set<ActionId>(['card.launch']),

  // Node/deck-build sub-modes: same — only the tool action passes.
  'node-edit': new Set<ActionId>(['card.launch']),
  'deck-build': new Set<ActionId>(['card.launch']),

  // Memo editor: nothing else passes; the editor handles its own input.
  'memo': new Set<ActionId>([]),

  // Tile overlay review: nothing else. ESC dismisses (handled outside).
  'overlay': new Set<ActionId>([]),

  // App-level dialog open (ItemDialog / SettingsDialog): nothing else.
  // The dialog's own input doesn't route through canPerform.
  'modal': new Set<ActionId>([]),

  // Command bar open: only its own input. ESC handled outside.
  'cmd': new Set<ActionId>(['cmd.open']),
};

/**
 * Decide whether `action` is allowed under the current `ctx`.
 * Returns `true` when permitted, or a `BlockReason` when blocked.
 * Priority (narrowest mode first):
 *   memo → overlay → modal (dialog or userBusy) → cmd →
 *   node-edit → deck-build → tool
 */
export function canPerform(action: ActionId, ctx: PolicyContext): true | BlockReason {
  if (ctx.editingMemoId) {
    return gate(action, 'memo', '메모 편집 중입니다 — 메모를 먼저 닫아주세요.', 'memo');
  }
  if (ctx.tileOverlayGroup) {
    return gate(action, 'overlay', '결과 화면을 먼저 닫아주세요.', 'overlay');
  }
  if (ctx.dialog && ctx.dialog !== 'none') {
    return gate(action, 'modal', '다이얼로그를 먼저 닫아주세요.', 'modal');
  }
  if (isUserBusy()) {
    // userBusy is keyed by 'modal:*' / 'busy:*'. Surface the first
    // key in the toast so the user knows WHICH modal is blocking.
    const keys = busyKeys();
    const hint = keys[0]?.replace(/^modal:|^busy:/, '') ?? '';
    return gate(
      action, 'modal',
      hint ? `${hint} 창을 먼저 닫아주세요.` : '열려있는 창을 먼저 닫아주세요.',
      'modal',
    );
  }
  if (ctx.cmdOpen) {
    return gate(action, 'cmd', '명령 입력 중입니다 — Esc 로 나가세요.', 'cmd');
  }
  if (ctx.nodeEditMode) {
    return gate(action, 'node-edit', '노드 편집 중입니다 — 완료 또는 Esc 로 나가세요.', 'node-edit');
  }
  if (ctx.deckBuilding) {
    return gate(action, 'deck-build', '덱 만드는 중입니다 — 완료 또는 Esc 로 나가세요.', 'deck-build');
  }
  if (ctx.activeMode !== 'normal') {
    const koMode = { pin: '핀', node: '노드', deck: '덱', clean: '정리' }[ctx.activeMode] ?? ctx.activeMode;
    return gate(action, `tool:${ctx.activeMode}`, `${koMode} 모드 중입니다 — Esc 로 나가세요.`, 'tool');
  }
  return true;
}

function gate(action: ActionId, modeKey: string, message: string, category: BlockCategory): true | BlockReason {
  const allowed = MODE_ALLOWLIST[modeKey];
  if (allowed && allowed.has(action)) return true;
  return { message, category };
}

/** Convenience predicate when the caller only cares about "yes/no". */
export function isAllowed(action: ActionId, ctx: PolicyContext): boolean {
  return canPerform(action, ctx) === true;
}
