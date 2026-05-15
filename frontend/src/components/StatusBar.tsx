/**
 * StatusBar — slim persistent strip at the bottom of the main column.
 *
 * Layout (PowerPoint-inspired):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ CPU 12% · RAM 245 MB · 5p   …   −  ─●─────  +   75%  ⊕ │
 *   └──────────────────────────────────────────────────────────────┘
 *      ↑ resource monitor (left)         ↑ zoom slider (right)
 *
 * Resources poll `electronAPI.getResourceStats` every 2 s. The
 * polling is paused via `document.hidden` so a hidden launcher
 * window doesn't churn IPC for invisible numbers.
 *
 * Zoom mirrors the dialog version (settings → 창 크기) but lives
 * in the bottom strip for one-click access — same slider semantics
 * (continuous 33%~400%), same persistence path (settings.windowZoom
 * via parent's onZoomChange callback). Click the % label to open a
 * preset menu.
 */

import { useEffect, useRef, useState } from 'react';
import { electronAPI } from '../electronBridge';
import {
  WINDOW_SIZE_PCT_MIN, WINDOW_SIZE_PCT_MAX, WINDOW_SIZE_PCT_PRESETS, DEFAULT_WINDOW_SIZE_PCT,
} from '../types';
import { Slider } from '@/components/ui/slider';
import { Icon } from '@/components/ui/Icon';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useAuth, signOut } from '../lib/auth';
import { bumpRender } from '../lib/perf';

interface Props {
  /** Launcher size as % of work area (25..100). Same SSOT as
   *  `/N` slash commands and the settings dialog. */
  sizePct: number;
  onSizePctChange: (p: number) => void;
}

const POLL_INTERVAL_MS = 2000;

export function StatusBar({ sizePct, onSizePctChange }: Props) {
  bumpRender('StatusBar');
  const auth = useAuth();
  const [stats, setStats] = useState<{
    cpuPct: number; memMB: number; procs: number;
    cores: number; perProc: Array<{ type: string; cpuPct: number; memMB: number }>;
  }>({
    cpuPct: 0, memMB: 0, procs: 0, cores: 1, perProc: [],
  });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      // Skip work when the launcher is hidden — we're polling for a
      // status bar nobody can see. Resumes immediately when shown.
      if (document.hidden) return;
      try {
        const next = await electronAPI.getResourceStats();
        if (!cancelled) setStats(next);
      } catch { /* main not ready / ipc dropped — keep last value */ }
    };
    tick(); // immediate first read so the bar isn't blank for 2 s
    pollTimer.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const commit = (p: number) => {
    const clamped = Math.max(WINDOW_SIZE_PCT_MIN, Math.min(WINDOW_SIZE_PCT_MAX, Math.round(p)));
    onSizePctChange(clamped);
  };

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid var(--border-rgba)',
        background: 'var(--surface)',
        padding: '4px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontSize: 10,
        color: 'var(--text-dim)',
        userSelect: 'none',
        height: 28,
      }}
    >
      {/* ── Auth indicator (far left) ────────────────────────────── */}
      {/* Mirrors VS Code's bottom-bar account chip + Slack's
          workspace-bottom user pill. Three states:
              signed-in  → email/name + ●  (click to open menu)
              signed-out → "게스트"        (click to open sign-in)
              authing    → spinner-styled "연결 중..."
          We keep this surface minimal because the SettingsDialog →
          계정 tab still owns full account management; this is just
          a glanceable indicator + quick sign-out. */}
      <AuthChip auth={auth} />
      <span style={{ color: 'var(--text-dim)', opacity: 0.4 }}>·</span>

      {/* ── Resource monitor ─────────────────────────────────────── */}
      {/* CPU% is normalised to total system CPU (0..100) so it's
          directly comparable to Task Manager. The per-process
          breakdown is exposed via the `title` tooltip — hover to
          see who's eating what (renderer/main/gpu/utility). */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
          color: 'var(--text-muted)',
        }}
        title={
          `시스템 CPU의 ${stats.cpuPct.toFixed(1)}% · ${stats.memMB} MB RAM · ${stats.procs}개 프로세스 (${stats.cores} 코어 PC)\n\n` +
          stats.perProc.map(p => `  ${p.type.padEnd(12, ' ')} ${p.cpuPct.toFixed(1).padStart(5, ' ')}%   ${p.memMB} MB`).join('\n')
        }
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="memory" size={11} color="var(--text-dim)" />
          <span>CPU {stats.cpuPct.toFixed(0)}%</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="storage" size={11} color="var(--text-dim)" />
          <span>{stats.memMB} MB</span>
        </span>
        <span style={{ color: 'var(--text-dim)' }}>·</span>
        <span>{stats.procs}p</span>
      </div>

      {/* spacer */}
      <div style={{ flex: 1 }} />

      {/* ── Window-size controls (right) — PowerPoint-style ───────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => commit(sizePct - 5)} title="5% 축소" style={zoomBtnStyle}>−</button>
        <div style={{ width: 100 }}>
          <Slider
            value={[sizePct]}
            min={WINDOW_SIZE_PCT_MIN}
            max={WINDOW_SIZE_PCT_MAX}
            step={1}
            onValueChange={(v) => commit(Array.isArray(v) ? (v as number[])[0] : (v as number))}
          />
        </div>
        <button onClick={() => commit(sizePct + 5)} title="5% 확대" style={zoomBtnStyle}>+</button>

        {/* Click % label → preset dropdown — same SSOT as `/N` slash. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            title="창 크기 프리셋"
            style={{
              fontFamily: 'monospace',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
              fontSize: 10,
              color: 'var(--text-color)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              minWidth: 36,
              textAlign: 'right',
              padding: '2px 4px',
              borderRadius: 4,
            }}
          >
            {Math.round(sizePct)}%
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6}>
            {WINDOW_SIZE_PCT_PRESETS.map(p => {
              const active = Math.round(sizePct) === p;
              return (
                <DropdownMenuItem
                  key={p}
                  onClick={() => commit(p)}
                  style={{
                    fontFamily: 'monospace',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    color: active ? 'var(--accent)' : 'var(--text-color)',
                    background: active ? 'var(--accent-dim)' : undefined,
                  }}
                >
                  {p}%{p === DEFAULT_WINDOW_SIZE_PCT ? '  (전체)' : ''}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  width: 20, height: 20,
  borderRadius: 4,
  border: '1px solid var(--border-rgba)',
  background: 'var(--surface)',
  color: 'var(--text-color)',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

/**
 * AuthChip — compact account state indicator for the bottom-left
 * corner of the StatusBar.
 *
 * Visual states (matched to AuthStatus from lib/auth.ts):
 *   - 'idle'       : invisible (we'd rather skip the chip than flash
 *                    "게스트" then "이메일" in <100 ms during boot)
 *   - 'signed-out' : "게스트" + person_off icon. Hint that there's
 *                    something to do here without screaming.
 *   - 'authing'    : "연결 중..." with a slow pulse, no menu.
 *   - 'signed-in'  : user email (truncated to ~18 chars) + 🟢 dot.
 *                    Dropdown opens with sign-out + a placeholder
 *                    for future account ops (sync status, plan, etc).
 *   - 'error'      : "로그인 오류" in red, click to open settings.
 *
 * The interactive surface is the chip itself — for signed-in users,
 * a DropdownMenu wraps it; for signed-out, clicking opens the
 * SettingsDialog at the 계정 tab (delegated to a custom event so
 * StatusBar doesn't take a hard dependency on the dialog state).
 */
function AuthChip({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const status = auth.status;

  // Hide while the auth state machine is still hydrating to avoid
  // flashing "게스트" for one frame on every cold start.
  if (status === 'idle') {
    return <span style={{ minWidth: 60, opacity: 0 }}>—</span>;
  }

  const baseChip: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontFamily: 'inherit',
    fontWeight: 500,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'background 0.12s, color 0.12s',
  };

  if (status === 'signed-out') {
    return (
      <button
        title="로그인 — 다른 PC에서도 카드와 메모를 이어서 쓸 수 있어요"
        onClick={() => window.dispatchEvent(new CustomEvent('nost:open-settings', { detail: { tab: 'account' } }))}
        style={baseChip}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--border-rgba)'; e.currentTarget.style.color = 'var(--text-color)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent';        e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        <Icon name="person_off" size={11} color="var(--text-dim)" />
        <span>게스트</span>
      </button>
    );
  }

  if (status === 'authing') {
    return (
      <span style={{ ...baseChip, cursor: 'default' }}>
        <Icon name="autorenew" size={11} color="var(--text-dim)" />
        <span>연결 중...</span>
      </span>
    );
  }

  if (status === 'error') {
    return (
      <button
        title={auth.errorMessage ?? '로그인 오류'}
        onClick={() => window.dispatchEvent(new CustomEvent('nost:open-settings', { detail: { tab: 'account' } }))}
        style={{ ...baseChip, color: '#f87171' }}
      >
        <Icon name="error" size={11} color="#f87171" />
        <span>로그인 오류</span>
      </button>
    );
  }

  // signed-in: show truncated email + active dot, dropdown for ops
  const email = auth.user?.email ?? '계정';
  const display = email.length > 18 ? email.slice(0, 16) + '…' : email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={email}
        style={{ ...baseChip, color: 'var(--text-color)' }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#10b981', flexShrink: 0,
        }} />
        <span>{display}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6}>
        <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('nost:open-settings', { detail: { tab: 'account' } }))}>
          <Icon name="manage_accounts" size={13} className="mr-1" />
          계정 관리
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => signOut().catch(() => undefined)}>
          <Icon name="logout" size={13} className="mr-1" />
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
