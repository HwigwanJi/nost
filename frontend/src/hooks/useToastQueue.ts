import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastAction = {
  label: string;
  icon: string;
  onClick: () => void;
  danger?: boolean;
};

type ToastQueueItem = {
  msg: string;
  actions?: ToastAction[];
  duration?: number;
  persistent?: boolean;
};

export type ToastState = {
  msg: string;
  id: number;
  actions?: ToastAction[];
  persistent?: boolean;
} | null;

export function useToastQueue() {
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastQueueRef = useRef<ToastQueueItem[]>([]);
  const toastActiveRef = useRef(false);
  const advanceQueueRef = useRef<(() => void) | null>(null);

  const clearToastTimer = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const advanceQueue = useCallback(() => {
    if (toastQueueRef.current.length === 0) {
      toastActiveRef.current = false;
      setToast(null);
      return;
    }

    const { msg, actions, duration, persistent } = toastQueueRef.current.shift()!;
    setToast({ msg, id: Date.now(), actions, persistent });

    if (persistent) {
      // Never auto-dismiss persistent toasts — wait for explicit dismissToast()
      return;
    }
    const nextDuration = duration ?? (actions?.length ? 5000 : 900);
    toastTimerRef.current = setTimeout(() => advanceQueueRef.current?.(), nextDuration);
  }, []);

  useEffect(() => {
    advanceQueueRef.current = advanceQueue;
  }, [advanceQueue]);

  const showToast = useCallback((
    msg: string,
    options?: { actions?: ToastAction[]; duration?: number; persistent?: boolean }
  ) => {
    toastQueueRef.current.push({
      msg,
      actions: options?.actions,
      duration: options?.duration,
      persistent: options?.persistent,
    });

    if (!toastActiveRef.current) {
      toastActiveRef.current = true;
      clearToastTimer();
      advanceQueueRef.current?.();
    }
  }, [clearToastTimer]);

  const dismissToast = useCallback(() => {
    clearToastTimer();
    setToast(null);

    if (toastQueueRef.current.length > 0) {
      advanceQueueRef.current?.();
    } else {
      toastActiveRef.current = false;
    }
  }, [clearToastTimer]);

  const pauseToast = useCallback(() => {
    clearToastTimer();
  }, [clearToastTimer]);

  const resumeToast = useCallback((duration = 3000) => {
    clearToastTimer();
    if (!toast) return;
    if (toast.persistent) return; // don't resume-dismiss persistent toasts
    toastTimerRef.current = setTimeout(dismissToast, duration);
  }, [clearToastTimer, dismissToast, toast]);

  useEffect(() => () => clearToastTimer(), [clearToastTimer]);

  return {
    toast,
    showToast,
    dismissToast,
    pauseToast,
    resumeToast,
  };
}
