import { electronAPI } from '../electronBridge';

// Thin wrapper so renderer code writes to both the DevTools console (for
// immediate dev feedback) and the main-process log file (for post-mortem on
// user machines). Prefer this over raw console.log/warn/error.

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
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
