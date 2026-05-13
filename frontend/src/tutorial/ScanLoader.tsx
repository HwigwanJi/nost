/**
 * ScanLoader — pre-quest preparation surface.
 *
 * Shown for ~1.0–1.5 s right after the user picks a quest, before
 * the runner takes over. Two purposes:
 *   1. Run the quest's provision step (potentially async — could
 *      add a sandbox space, create a placeholder memo, etc.) without
 *      blocking the UI thread on a hidden promise.
 *   2. Give the user a visible "스캔 → 보충" beat so the experience
 *      reads as deliberate ceremony, not a sudden modal jolt.
 *
 * Self-contained: no hooks into App state. Caller passes the
 * quest + AppData and gets a `onReady(provisionResult)` callback
 * when it's safe to mount the runner.
 */

import { useEffect, useState } from 'react';
import type { AppData } from '../types';
import type { Quest, ProvisionResult } from './types';
import { runProvisioning } from './provisioner';
import { Icon } from '@/components/ui/Icon';

interface Props {
  quest: Quest;
  data: AppData;
  onReady: (result: ProvisionResult) => void;
  onCancel: () => void;
}

const MIN_VISIBLE_MS = 1000;
const MAX_VISIBLE_MS = 2500;

interface ScanRow {
  label: string;
  state: 'pending' | 'done';
}

export function ScanLoader({ quest, data, onReady, onCancel }: Props) {
  // Surface a small checklist: "기존 항목 확인" → "보충 항목 추가".
  // The actual provisioning is one async call; we just choreograph
  // the visible beats so the loading feels intentional.
  const [rows, setRows] = useState<ScanRow[]>([
    { label: '현재 데이터 확인 중', state: 'pending' },
    { label: '튜토리얼 준비 중',     state: 'pending' },
  ]);
  const [note, setNote] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const run = async () => {
      // Beat 1
      await sleep(280);
      if (cancelled) return;
      setRows(r => updateRow(r, 0, 'done'));

      // Provision (real work)
      const result = await runProvisioning(quest, data);
      if (cancelled) return;
      if (result.note) setNote(result.note);

      // Beat 2 — wait for min visible elapsed
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_VISIBLE_MS) {
        await sleep(MIN_VISIBLE_MS - elapsed);
        if (cancelled) return;
      }
      setRows(r => updateRow(r, 1, 'done'));

      // Brief pause so the second checkmark registers visually.
      await sleep(280);
      if (cancelled) return;
      onReady(result);
    };

    void run();

    // Hard timeout — if provision hangs, bail to onCancel.
    const killer = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      onCancel();
    }, MAX_VISIBLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(killer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(6px)',
      animation: 'scanLoaderIn 0.18s ease',
    }}>
      <style>{`
        @keyframes scanLoaderIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes scanLoaderPulse {
          0%, 100% { opacity: 0.4 } 50% { opacity: 1 }
        }
      `}</style>
      <div style={{
        width: 360, padding: '20px 22px',
        borderRadius: 14,
        background: 'var(--bg-rgba)',
        border: '1px solid var(--border-rgba)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.32)',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="school" size={18} color="var(--accent)" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>튜토리얼 준비</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-color)' }}>{quest.title}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              {r.state === 'done'
                ? <Icon name="check_circle" size={14} color="var(--accent)" />
                : <Icon name="more_horiz" size={14} color="var(--text-dim)" style={{ animation: 'scanLoaderPulse 1.1s ease-in-out infinite' }} />}
              <span style={{ color: r.state === 'done' ? 'var(--text-color)' : 'var(--text-muted)' }}>
                {r.label}
              </span>
            </div>
          ))}
          {note && (
            <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.5 }}>
              ※ {note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
function updateRow(rows: ScanRow[], idx: number, state: ScanRow['state']): ScanRow[] {
  return rows.map((r, i) => i === idx ? { ...r, state } : r);
}
