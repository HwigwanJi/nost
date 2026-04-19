import { useEffect, useRef } from 'react';
import { electronAPI } from '../electronBridge';

/**
 * Right-click drag to move the Electron window.
 * Cards capture right-click for reordering, so [data-card] elements are excluded.
 */
export function useWindowDrag() {
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null);

  useEffect(() => {
    const onMouseDown = async (e: MouseEvent) => {
      if (e.button !== 2) return;
      if ((e.target as HTMLElement).closest('[data-card]')) return;
      e.preventDefault();
      const [wx, wy] = await electronAPI.getWindowPosition();
      dragRef.current = { startX: e.screenX, startY: e.screenY, winX: wx, winY: wy };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.screenX - dragRef.current.startX;
      const dy = e.screenY - dragRef.current.startY;
      // Ignore sub-pixel tremor: prevents the window from creeping (and
      // occasionally hitting an Aero Snap zone that resizes it) while the
      // user is just holding the right button still.
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      electronAPI.moveWindow(
        Math.round(dragRef.current.winX + dx),
        Math.round(dragRef.current.winY + dy),
      );
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) dragRef.current = null;
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);
}
