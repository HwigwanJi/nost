/**
 * useEscapeKey — register an ESC handler with the global stack.
 *
 * Wrapper around `pushEscape` that handles React's effect lifecycle
 * for you. Pass `active=false` to keep the handler dormant (e.g. while
 * a popover is closed) — much cleaner than conditionally calling the
 * underlying push/unsubscribe yourself.
 *
 * The handler ref is kept current via a ref so the registered closure
 * always sees the latest props/state without the parent having to
 * memoize. Same pattern as `useEventCallback`.
 */

import { useEffect, useRef } from 'react';
import { pushEscape } from '../lib/escapeStack';

export function useEscapeKey(handler: () => void, active = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    return pushEscape(() => handlerRef.current());
  }, [active]);
}
