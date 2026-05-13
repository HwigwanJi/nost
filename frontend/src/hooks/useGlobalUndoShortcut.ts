/**
 * Wire Ctrl+Z (Cmd+Z on macOS) and Ctrl+Shift+Z (or Ctrl+Y) to the
 * app-level undo stack. The handler is context-aware: when the
 * focused element is an editable text surface (input, textarea,
 * contenteditable), we don't preventDefault — the browser/OS
 * handles its own native undo for typing within that field. App
 * undo only kicks in when focus is on a non-editable surface
 * (cards, sidebar, the body, etc.).
 *
 * This matches the user expectation expressed in the grilling
 * session: "Ctrl+Z가 input/textarea 안일 때는 Native에 양보".
 *
 * Mounted once at the AppShell level. Multiple mounts are safe
 * but redundant.
 */

import { useEffect } from 'react';
import { performUndo, performRedo } from './useUndoStack';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useGlobalUndoShortcut(opts?: {
  onUndo?: (description: string) => void;
  onRedo?: (description: string) => void;
  onNothingToUndo?: () => void;
  onNothingToRedo?: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const cmdOrCtrl = e.ctrlKey || e.metaKey;
      if (!cmdOrCtrl) return;

      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
      if (!isUndo && !isRedo) return;

      // Yield to native undo when the user is typing in an editable
      // surface. The browser's text-history is what they expect there.
      if (isEditableTarget(e.target)) return;

      e.preventDefault();
      if (isUndo) {
        const entry = performUndo();
        if (entry) opts?.onUndo?.(entry.description);
        else opts?.onNothingToUndo?.();
      } else {
        const entry = performRedo();
        if (entry) opts?.onRedo?.(entry.description);
        else opts?.onNothingToRedo?.();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // opts changes between renders are fine — closure reads .current via fresh prop each event
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
