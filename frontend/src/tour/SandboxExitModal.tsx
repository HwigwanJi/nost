import type { CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * Shown when a sandboxed tutorial ends (completes or user clicks the 종료
 * button). Three exits:
 *
 *   - 폐기  : drop the sandbox, restore the snapshot. The default — user
 *             came to learn, not to start over.
 *   - 가져가기: merge any new spaces/badges from the sandbox into the real
 *             data. For users who actually built something useful while
 *             practicing.
 *   - 백업 열기: open the auto-backup folder in case anything looks off.
 *
 * Why a custom modal rather than reusing PaywallModal/etc: we want the
 * choice to feel like part of the tutorial flow, not a system dialog.
 */

interface Props {
  open: boolean;
  newSpacesCount: number;       // how many spaces the user built that didn't exist before
  newBadgesCount: number;
  backupPath?: string;
  onDiscard: () => void;
  onMerge: () => void;
  onOpenBackupFolder: () => void;
}

export function SandboxExitModal({
  open, newSpacesCount, newBadgesCount, backupPath, onDiscard, onMerge, onOpenBackupFolder,
}: Props) {
  if (!open) return null;
  const hasNew = newSpacesCount > 0 || newBadgesCount > 0;

  const backdrop: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9995,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  };
  const panel: CSSProperties = {
    width: 380, maxWidth: '90vw',
    background: 'var(--surface)',
    border: '1px solid var(--border-rgba)',
    borderRadius: 14,
    padding: '20px 22px',
    color: 'var(--text-color)',
    boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
    fontFamily: 'inherit',
  };

  const accentBtn: CSSProperties = {
    flex: 1, padding: '9px 12px', fontSize: 12, fontWeight: 700,
    background: 'var(--accent)', color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
  };
  const ghostBtn: CSSProperties = {
    flex: 1, padding: '9px 12px', fontSize: 12, fontWeight: 600,
    background: 'transparent', color: 'var(--text-color)',
    border: '1px solid var(--border-rgba)', borderRadius: 8,
    cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div style={backdrop}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Icon name="school" size={16} color="var(--accent)" />
          <span style={{ fontSize: 13, fontWeight: 700 }}>튜토리얼 종료</span>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 14 }}>
          {hasNew ? (
            <>
              이번 튜토리얼에서{' '}
              {newSpacesCount > 0 && <strong style={{ color: 'var(--text-color)' }}>스페이스 {newSpacesCount}개</strong>}
              {newSpacesCount > 0 && newBadgesCount > 0 && ' · '}
              {newBadgesCount > 0 && <strong style={{ color: 'var(--text-color)' }}>플로팅 뱃지 {newBadgesCount}개</strong>}
              {' '}를 새로 만드셨네요. 이걸 실제 데이터로 가져갈까요?
            </>
          ) : (
            '튜토리얼은 가짜 데이터로 진행됐습니다. 원래 사용하던 카드와 설정을 그대로 복원합니다.'
          )}
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: hasNew ? 10 : 0 }}>
          {hasNew && (
            <button style={accentBtn} onClick={onMerge}>가져가기</button>
          )}
          <button style={hasNew ? ghostBtn : accentBtn} onClick={onDiscard}>
            {hasNew ? '폐기하고 원래대로' : '확인'}
          </button>
        </div>

        {backupPath && (
          <button
            onClick={onOpenBackupFolder}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-dim)',
              fontSize: 10.5, cursor: 'pointer', padding: 4, marginTop: 4,
              fontFamily: 'inherit', textDecoration: 'underline',
            }}
            title={backupPath}
          >
            만약을 위한 자동 백업 위치 열기
          </button>
        )}
      </div>
    </div>
  );
}
