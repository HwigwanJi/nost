/**
 * AppShell — auth gate around the main App.
 *
 * Bootstraps the auth state machine on mount, then either:
 *   - shows a brief loader while we hydrate the persisted session
 *   - shows SignInScreen if the user is signed-out and hasn't yet
 *     dismissed the screen ("나중에 로그인" → sessionStorage flag)
 *   - shows the regular App otherwise
 *
 * Phase 1 keeps sign-in OPTIONAL — the user can use nost without a
 * Supabase session entirely. Phase 2+ may force it for sync features.
 */

import { useEffect, useState } from 'react';
import App from './App';
import { SignInScreen } from './components/SignInScreen';
import { bootstrapAuth, useAuth } from './lib/auth';
import { electronAPI } from './electronBridge';

const SKIP_KEY = 'nost.auth.skipForSession';

// Boot-gate timing.
//   MIN: minimum visible time. Even on a fast machine where every
//   gate (fonts / store / rAF) resolves in 200 ms, the overlay stays
//   on screen until MIN elapses. Set deliberately long so the user
//   has time to read at least 2-3 status messages and feel the app
//   "preparing itself" — Adobe / Office / Premiere all do the same.
//   MAX: hard ceiling. If any gate is genuinely stuck (slow font
//   parse, hung promise, etc.), dismiss anyway so the launcher
//   doesn't hold the user hostage past this. Keep MAX > MIN by a
//   wide margin so a slow first-launch (Defender + GPU cache build)
//   isn't capped at MIN — it gets to use all the breathing room it
//   actually needs, up to MAX.
const MIN_OVERLAY_MS = 5000;
const MAX_OVERLAY_MS = 15000;
// Captured once at module load so the timer is anchored to "renderer
// script start", not "first render commit" (which can vary by 150 ms+
// depending on hydration cost).
const overlayStartedAt = Date.now();

const setBootStatus = (text: string) => {
  (window as { __bootStatus?: (s: string) => void }).__bootStatus?.(text);
};

/**
 * Tear down the pre-React `#ql-loading` overlay defined in
 * frontend/index.html. Hoisted out of useAppData so it fires for the
 * sign-out branch too — useAppData only runs inside <App />, which
 * never mounts when AppShell decides to render <SignInScreen />.
 * Without this hoist, signed-out users (or anyone whose Supabase
 * env isn't configured at build time) see the dark loading overlay
 * indefinitely because nothing inside the SignIn branch knows to
 * dismiss it. Idempotent — safe to call multiple times.
 */
function dismissBootOverlay() {
  const el = document.getElementById('ql-loading');
  if (!el || el.classList.contains('fade-out')) return;
  // Tell main the renderer reached an interactive state so the 8 s
  // boot-stuck force-error path doesn't fire on legitimate sign-out
  // landings. Safe to call before useAppData runs.
  try { electronAPI.signalReady?.(); } catch { /* preload missing in dev */ }
  el.classList.add('fade-out');
  setTimeout(() => { try { el.remove(); } catch { /* already gone */ } }, 280);
}

/** Fire the dismiss after MIN_OVERLAY_MS has elapsed since the
 *  overlay first appeared. If we're already past that threshold,
 *  dismisses immediately (the timer is one-shot, not a delay-add). */
function dismissAfterMinElapsed() {
  const elapsed = Date.now() - overlayStartedAt;
  const wait = Math.max(0, MIN_OVERLAY_MS - elapsed);
  if (wait === 0) {
    dismissBootOverlay();
  } else {
    setTimeout(dismissBootOverlay, wait);
  }
}

export default function AppShell() {
  const auth = useAuth();
  const [skipped, setSkipped] = useState(() => sessionStorage.getItem(SKIP_KEY) === '1');

  useEffect(() => {
    bootstrapAuth();
  }, []);

  // Boot gate. Runs once when auth first leaves 'idle'. Collects the
  // set of promises we want to actually finish before showing the
  // app, races them against a hard ceiling, then dismisses the
  // overlay (still respecting MIN_OVERLAY_MS).
  //
  // The gate set is chosen by which branch we'll render:
  //   - App branch (signed-in OR skipped):
  //       fonts.ready + storeLoad + (next animation frame so the
  //       first paint of the app happens *before* dismiss, avoiding
  //       the "blank flash" on dismiss).
  //   - SignInScreen branch (signed-out + !skipped):
  //       fonts.ready only — there's no app data to load.
  //
  // ext-warmup is intentionally NOT a gate: with no extension
  // installed it never resolves, and the user shouldn't be punished
  // for not having Chrome's nost-bridge. It runs in the background
  // and surfaces its own breadcrumbs ("브라우저 확장 확인 중...")
  // until either it finishes or the ceiling dismisses us.
  useEffect(() => {
    if (auth.status === 'idle') return;
    const willMountApp = auth.status === 'signed-in' || skipped;

    setBootStatus(willMountApp ? '데이터 불러오는 중...' : '로그인 화면 준비 중...');

    // Rotating "tip" stream while we wait. Without this, the overlay
    // text sits on the same string for several seconds whenever
    // nothing in main/renderer happens to push a granular update —
    // making the wait feel longer than it is. Cycle every 1.6 s
    // through gentle nudges that match what the app is actually doing.
    // The rotator is paused/cancelled the moment a more specific
    // status arrives (main IPC, store-ready, fonts-ready) — see
    // `__bootStatus` swap-fade in boot-recovery.js for the visual
    // continuity.
    const TIPS = willMountApp ? [
      '데이터 불러오는 중...',
      '카드와 스페이스 정리 중...',
      '글꼴 준비 중...',
      '화면 그리는 중...',
      '곧 준비됩니다...',
    ] : [
      '로그인 화면 준비 중...',
      '인증 상태 확인 중...',
      '글꼴 준비 중...',
      '화면 그리는 중...',
      '곧 준비됩니다...',
    ];
    let tipIdx = 0;
    const tipTimer = setInterval(() => {
      tipIdx = (tipIdx + 1) % TIPS.length;
      setBootStatus(TIPS[tipIdx]);
    }, 1600);

    const gates: Promise<void>[] = [];

    // Material Symbols + Pretendard are the heavy dependency. Fonts
    // not being ready when the overlay dismisses is the #1 cause of
    // "icon-square-of-doom" flashes. document.fonts.ready resolves
    // when every @font-face is loaded OR rejected (so a network
    // failure won't deadlock us). Material Symbols specifically is
    // dynamic-imported in main.tsx (off the CSS critical path), so
    // its registration arrives a tick after script start — fonts.ready
    // still waits for it.
    gates.push(document.fonts.ready.then(() => {
      setBootStatus('글꼴 준비 완료');
    }).catch(() => undefined));

    // Store load: only relevant when App will actually mount.
    if (willMountApp) {
      gates.push(new Promise<void>(resolve => {
        const onReady = () => { setBootStatus('데이터 로드 완료'); resolve(); };
        window.addEventListener('nost:store-ready', onReady, { once: true });
      }));
    }

    // First paint guard: defer one rAF so React has actually committed
    // the App / SignInScreen tree before we dismiss the overlay. Cheap
    // (~16 ms) and removes the brief blank flash.
    gates.push(new Promise<void>(resolve => requestAnimationFrame(() => resolve())));

    // Race the full gate set against the hard ceiling.
    const ceiling = new Promise<void>(resolve => {
      const remaining = Math.max(0, MAX_OVERLAY_MS - (Date.now() - overlayStartedAt));
      setTimeout(resolve, remaining);
    });

    Promise.race([Promise.all(gates), ceiling]).then(() => {
      clearInterval(tipTimer);
      setBootStatus('준비 완료');
      dismissAfterMinElapsed();
    });

    // Belt-and-suspenders: even if the race never resolves (it always
    // does — both paths terminate), make sure the rotator stops on
    // unmount so it can't tick after the component is gone.
    return () => clearInterval(tipTimer);
  }, [auth.status, skipped]);

  // Hydrating — render nothing for a beat to avoid a sign-in flash on
  // every app open when the user actually has a persisted session.
  if (auth.status === 'idle') return <BootSplash />;

  if (auth.status === 'signed-in') return <App />;

  if (skipped) return <App />;

  return (
    <SignInScreen
      onSkip={() => {
        sessionStorage.setItem(SKIP_KEY, '1');
        setSkipped(true);
      }}
    />
  );
}

function BootSplash() {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-rgba)',
    }}>
      <div style={{
        width: 24, height: 24,
        border: '2px solid var(--border-rgba)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'bootSpin 0.7s linear infinite',
      }} />
      <style>{`@keyframes bootSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
