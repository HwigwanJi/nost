import { electronAPI } from '../electronBridge';

// Thin wrapper so renderer code writes to both the DevTools console (for
// immediate dev feedback) and the main-process log file (for post-mortem on
// user machines). Prefer this over raw console.log/warn/error.
//
// Production debug suppression:
//   `import.meta.env.DEV` is Vite's compile-time flag — true under
//   `vite dev`, false under `vite build`. The `DEBUG_ENABLED` constant
//   below resolves to `false` in production, so the `if (level ===
//   'debug' && !DEBUG_ENABLED) return` guard short-circuits before
//   touching IPC. Rollup further dead-strips the constant comparison,
//   so production debug() calls become essentially no-ops with zero
//   disk-write side effect.
//
//   Why this matters: the per-render debug logs in App.tsx and
//   useAppData.ts each fired electronAPI.log → main-process IPC →
//   electron-log disk write. With ~7k renders per session that was
//   ~7k synchronous disk writes per session dominating idle CPU.

type Level = 'debug' | 'info' | 'warn' | 'error';

// Build-time constant — eliminates debug paths in production.
const DEBUG_ENABLED = !!import.meta.env.DEV;

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  if (level === 'debug' && !DEBUG_ENABLED) return;

  const line = `[${scope}] ${msg}`;
  if (level === 'error')      console.error(line, extra ?? '');
  else if (level === 'warn')  console.warn(line, extra ?? '');
  else if (level === 'debug') console.debug(line, extra ?? '');
  else                        console.info(line, extra ?? '');
  try {
    electronAPI.log(level, line, extra);
  } catch {
    /* dev mode / preload missing */
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit('debug', scope, msg, extra),
    info:  (msg: string, extra?: unknown) => emit('info',  scope, msg, extra),
    warn:  (msg: string, extra?: unknown) => emit('warn',  scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit('error', scope, msg, extra),
  };
}
