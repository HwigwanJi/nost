import { useCallback, useRef } from 'react';
import { electronAPI } from '../electronBridge';
import type { LauncherItem } from '../types';

// ── Polling constants ──────────────────────────────────────
const POLL_INTERVAL = 400;   // ms between polls
const MAX_WAIT     = 15000;  // 15s timeout
const SETTLE_DELAY = 200;    // ms after window found, before positioning
const SLOW_NOTICE  = 2500;   // ms before upgrading spinner to "시간이 소요될 수 있습니다"

type ShowToast = (
  msg: string,
  options?: {
    duration?: number;
    persistent?: boolean;
    spinner?: boolean;
    immediate?: boolean;
  }
) => void;

interface LaunchPipelineOptions {
  showToast: ShowToast;
  dismissToast: () => void;
}

/** Types that support monitor positioning */
const POSITIONABLE_TYPES = new Set(['app', 'window', 'folder', 'url', 'browser']);

/**
 * Unified launch-and-position pipeline.
 *
 * Handles all card types. For positionable types (app, window, folder, url, browser)
 * with a target monitor, uses polling to detect the window, then positions it.
 * Reports progress via toast messages with spinner animation.
 */
export function useLaunchPipeline({ showToast, dismissToast }: LaunchPipelineOptions) {
  // Guard against overlapping pipeline runs
  const runningRef = useRef(false);

  /**
   * Launch an item and optionally position it on a monitor.
   *
   * @param item        The launcher item to execute
   * @param closeAfter  Whether to hide the launcher after launch
   * @param monitor     Target monitor (1-indexed). Overrides item.monitor if provided.
   *                    0 or undefined = no positioning.
   */
  const launchAndPosition = useCallback(async (
    item: LauncherItem,
    closeAfter: boolean,
    monitor?: number,
  ): Promise<void> => {
    const targetMonitor = monitor ?? item.monitor;
    const needsPositioning = POSITIONABLE_TYPES.has(item.type)
                              && !!targetMonitor && targetMonitor > 0;

    // ── text: clipboard copy ─────────────────────────────────
    if (item.type === 'text') {
      electronAPI.copyText(item.value, closeAfter);
      showToast(`"${item.title}" 복사됨`, { duration: 1800 });
      return;
    }

    // ── cmd: fire-and-forget shell command ───────────────────
    if (item.type === 'cmd') {
      electronAPI.runCmd(item.value, closeAfter);
      showToast(`"${item.title}"`, { duration: 1800 });
      return;
    }

    // ── url / browser: open browser (+ optional positioning) ──
    if (item.type === 'url' || item.type === 'browser') {
      electronAPI.openUrl(item.value, needsPositioning ? false : closeAfter);
      if (!needsPositioning) {
        showToast(`"${item.title}"`, { duration: 1800 });
        return;
      }
      // Fall through to positioning pipeline below
    }

    // ── folder: open explorer (+ optional positioning) ───────
    if (item.type === 'folder') {
      electronAPI.openPath(item.value, needsPositioning ? false : closeAfter);
      if (!needsPositioning) {
        showToast(`"${item.title}"`, { duration: 1800 });
        return;
      }
      // Fall through to positioning pipeline below
    }

    // ── Positioning pipeline (app, window, folder, url, browser) ──

    // Prevent overlapping pipeline runs
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      // ── window type: focus first ──────────────────────────────
      if (item.type === 'window') {
        showToast('확인 중...', { spinner: true, immediate: true });
        const r = await electronAPI.focusWindow(
          item.value,
          needsPositioning ? false : closeAfter,
        );

        if (!r.success) {
          showToast(`"${item.title}" 창을 찾을 수 없음`, { immediate: true, duration: 2500 });
          return;
        }

        if (!needsPositioning) {
          showToast(`"${item.title}"`, { immediate: true, duration: 1800 });
          return;
        }

        // Window found → position it
        showToast('창 위치 조정 중...', { spinner: true, immediate: true });
        const posResult = await electronAPI.maximizeWindow({
          item: { type: item.type, value: item.value, title: item.title },
          monitor: targetMonitor,
        });

        showToast(posResult.success ? '완료' : '창 위치 조정 실패', {
          immediate: true,
          duration: posResult.success ? 3000 : 2500,
        });

        if (closeAfter) electronAPI.hideApp();
        return;
      }

      // ── app type: launch or focus ─────────────────────────────
      if (item.type === 'app') {
        showToast('확인 중...', { spinner: true, immediate: true });

        const r = await electronAPI.launchOrFocusApp(
          item.value,
          needsPositioning ? false : closeAfter,
          undefined, // don't pass monitor to main.js — we handle positioning ourselves
        );

        if (!r.success) {
          // Trim the PS diagnostic so it fits a toast but stays actionable.
          // Full detail is in the main-process log.
          const raw = r.error ?? '알 수 없는 오류';
          const short = raw.split(/[|\n]/)[0].trim().slice(0, 80);
          showToast(`"${item.title}" 실행 실패: ${short}`, { immediate: true, duration: 4000 });
          return;
        }

        if (r.action === 'focused') {
          // App already running — window exists immediately
          if (!needsPositioning) {
            showToast(`"${item.title}"`, { immediate: true, duration: 1800 });
            return;
          }

          showToast('창 위치 조정 중...', { spinner: true, immediate: true });
          const posResult = await electronAPI.maximizeWindow({
            item: { type: item.type, value: item.value, title: item.title },
            monitor: targetMonitor,
          });

          showToast(posResult.success ? '완료' : '창 위치 조정 실패', {
            immediate: true,
            duration: posResult.success ? 3000 : 2500,
          });

          if (closeAfter) electronAPI.hideApp();
          return;
        }

        // action === 'launched' — app just started, fall through to polling
        if (!needsPositioning) {
          // App/document launches are often slow (Adobe, Office, IDEs).
          // No polling on this branch, so tell the user up-front instead of
          // leaving a silent toast that vanishes before the window appears.
          showToast(`"${item.title}" 여는 중 — 시간이 소요될 수 있습니다`, {
            immediate: true, duration: 3500,
          });
          return;
        }

        // Fall through to polling below
      }

      // ── Polling phase (app launched, folder opened, url/browser opened) ──
      showToast('띄우는 중...', { spinner: true, immediate: true });

      const startTime = Date.now();
      let windowFound = false;
      let slowNoticeShown = false;

      while (Date.now() - startTime < MAX_WAIT) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        const results = await electronAPI.checkItemsForTile([
          { type: item.type, value: item.value, title: item.title },
        ]);
        if (results[0]?.alive) {
          windowFound = true;
          break;
        }
        // Upgrade the spinner after SLOW_NOTICE ms so the user knows the
        // launch is still in progress (Adobe, Office docs, Premiere, etc.
        // routinely take 5–10s on first open).
        if (!slowNoticeShown && Date.now() - startTime >= SLOW_NOTICE) {
          slowNoticeShown = true;
          showToast(`"${item.title}" 여는 중 — 시간이 소요될 수 있습니다`, {
            spinner: true, immediate: true,
          });
        }
      }

      if (!windowFound) {
        showToast(`"${item.title}" ${MAX_WAIT / 1000}초 대기 후 창을 찾지 못했습니다`, {
          immediate: true,
          duration: 4000,
        });
        return;
      }

      // ── Position on monitor ──────────────────────────────────
      showToast('창 위치 조정 중...', { spinner: true, immediate: true });

      // Small settle delay — let the window finish its initial render/layout
      await new Promise(resolve => setTimeout(resolve, SETTLE_DELAY));

      const posResult = await electronAPI.maximizeWindow({
        item: { type: item.type, value: item.value, title: item.title },
        monitor: targetMonitor,
      });

      showToast(posResult.success ? '완료' : '창 위치 조정 실패', {
        immediate: true,
        duration: posResult.success ? 3000 : 2500,
      });

      if (closeAfter) electronAPI.hideApp();
    } finally {
      runningRef.current = false;
    }
  }, [showToast, dismissToast]);

  return { launchAndPosition };
}
