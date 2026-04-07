import { useCallback, useRef, useState } from 'react';

export type ToastAction = {
  label: string;
  icon: string;
  onClick: () => void;
  danger?: boolean;
};

export type ToastItem = {
  id: number;
  msg: string;
  actions?: ToastAction[];
  persistent?: boolean;
  spinner?: boolean;
  /** internal: timestamp for ordering */
  createdAt: number;
};

export type ToastState = ToastItem | null; // kept for ToastOverlay compat

export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Map from toast id → dismiss timer
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // For pipeline: track the "current spinner" id so immediate replaces it
  const spinnerIdRef = useRef<number | null>(null);

  const clearTimer = useCallback((id: number) => {
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
  }, []);

  const removeToast = useCallback((id: number) => {
    clearTimer(id);
    setToasts(prev => prev.filter(t => t.id !== id));
    if (spinnerIdRef.current === id) spinnerIdRef.current = null;
  }, [clearTimer]);

  const scheduleRemove = useCallback((id: number, duration: number) => {
    clearTimer(id);
    const t = setTimeout(() => removeToast(id), duration);
    timersRef.current.set(id, t);
  }, [clearTimer, removeToast]);

  const showToast = useCallback((
    msg: string,
    options?: {
      actions?: ToastAction[];
      duration?: number;
      persistent?: boolean;
      spinner?: boolean;
      /**
       * When true: replaces the current spinner toast (pipeline progress updates).
       * If there is no active spinner toast, adds a new toast normally.
       */
      immediate?: boolean;
    }
  ) => {
    const isPersistent = options?.persistent;
    const isSpinner    = options?.spinner;
    const isImmediate  = options?.immediate;
    const defaultDur   = options?.actions?.length ? 5000 : 1800;
    const duration     = options?.duration ?? defaultDur;

    const id = Date.now() + Math.random(); // unique

    if (isImmediate && spinnerIdRef.current !== null) {
      // Replace existing spinner toast in-place (pipeline step update)
      const prevId = spinnerIdRef.current;
      clearTimer(prevId);
      const newItem: ToastItem = { id, msg, actions: options?.actions, persistent: isPersistent, spinner: isSpinner, createdAt: Date.now() };
      setToasts(prev => prev.map(t => t.id === prevId ? newItem : t));
      if (isSpinner || isPersistent) {
        spinnerIdRef.current = id;
      } else {
        spinnerIdRef.current = null;
        scheduleRemove(id, duration);
      }
      return;
    }

    // Normal: push new toast
    const newItem: ToastItem = { id, msg, actions: options?.actions, persistent: isPersistent, spinner: isSpinner, createdAt: Date.now() };
    setToasts(prev => [...prev, newItem]);

    if (isSpinner || isPersistent) {
      spinnerIdRef.current = id;
    } else {
      scheduleRemove(id, duration);
    }
  }, [clearTimer, scheduleRemove]);

  const dismissToast = useCallback((id?: number) => {
    if (id !== undefined) {
      removeToast(id);
    } else if (spinnerIdRef.current !== null) {
      removeToast(spinnerIdRef.current);
    } else {
      // dismiss the newest toast
      setToasts(prev => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        clearTimer(last.id);
        return prev.slice(0, -1);
      });
    }
  }, [removeToast, clearTimer]);

  // Pause/resume for hover (operates on the last non-spinner toast)
  const pauseToast = useCallback((id?: number) => {
    if (id !== undefined) clearTimer(id);
  }, [clearTimer]);

  const resumeToast = useCallback((id?: number, duration = 3000) => {
    const target = id ?? (() => {
      // find latest non-persistent, non-spinner toast
      const candidates = toasts.filter(t => !t.persistent && !t.spinner);
      return candidates[candidates.length - 1]?.id;
    })();
    if (target === undefined) return;
    const t = toasts.find(t => t.id === target);
    if (!t || t.persistent || t.spinner) return;
    scheduleRemove(target, duration);
  }, [clearTimer, scheduleRemove, toasts]);

  // Legacy compat: single ToastState (last item, or null)
  const toast: ToastState = toasts.length > 0 ? toasts[toasts.length - 1] : null;

  return {
    toast,    // legacy single-toast compat
    toasts,   // full stack for ToastOverlay
    showToast,
    dismissToast,
    pauseToast,
    resumeToast,
  };
}
