import { useCallback, useEffect, useRef, useState } from 'react';

export function useTileOverlay() {
  const [tileOverlayGroup, setTileOverlayGroup] = useState<string | null>(null);
  const [tileOverlayLeaving, setTileOverlayLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOverlayTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismissTileOverlay = useCallback(() => {
    setTileOverlayLeaving(true);
    clearOverlayTimer();
    setTimeout(() => {
      setTileOverlayGroup(null);
      setTileOverlayLeaving(false);
    }, 220);
  }, [clearOverlayTimer]);

  const showTileOverlay = useCallback((groupId: string) => {
    clearOverlayTimer();
    setTileOverlayLeaving(false);
    setTileOverlayGroup(groupId);
  }, [clearOverlayTimer]);

  useEffect(() => {
    clearOverlayTimer();

    if (tileOverlayGroup) {
      timerRef.current = setTimeout(dismissTileOverlay, 10000);
    }

    return clearOverlayTimer;
  }, [clearOverlayTimer, dismissTileOverlay, tileOverlayGroup]);

  return {
    tileOverlayGroup,
    tileOverlayLeaving,
    showTileOverlay,
    dismissTileOverlay,
  };
}
