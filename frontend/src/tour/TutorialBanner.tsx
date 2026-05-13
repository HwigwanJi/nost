import type { CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * Persistent banner at the top of the window while the tutorial sandbox
 * is active. Two reasons it has to be visible the whole time:
 *
 *   1. The user is looking at FAKE data. Without an obvious cue they may
 *      think their real cards are gone (the previous experimental flow
 *      that wiped state without warning is precisely why the user asked
 *      for this safety net).
 *   2. The "End / restore" button has to be one click away — if the
 *      sandbox somehow gets stuck (locked tour overlay, etc.), the user
 *      needs an unconditional exit. Hence the dedicated 종료 button.
 *
 * No close-on-click logic on the banner itself — exit only happens via
 * 종료 button or the tour completing/aborting normally.
 */

interface Props {
  backupPath?: string;
  onOpenBackupFolder: () => void;
  onExit: () => void;
}

export function TutorialBanner({ backupPath, onOpenBackupFolder, onExit }: Props) {
  const wrap: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9990,                      // below tour spotlight (9997+) so it
                                       // doesn't cover the popover during a
                                       // step targeting the page top
    padding: '6px 14px',
    background: 'linear-gradient(90deg, rgba(99,102,241,0.96), rgba(168,85,247,0.94))',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    backdropFilter: 'blur(6px)',
  };

  const linkBtn: CSSProperties = {
    background: 'rgba(255,255,255,0.18)',
    border: '1px solid rgba(255,255,255,0.28)',
    color: '#fff',
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 10.5,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  const exitBtn: CSSProperties = {
    ...linkBtn,
    marginLeft: 'auto',
    background: 'rgba(0,0,0,0.25)',
    borderColor: 'rgba(255,255,255,0.18)',
  };

  return (
    <div style={wrap} role="status" aria-live="polite">
      <Icon name="school" size={14} color="#fff" />
      <span>튜토리얼 모드 — 여기서 만든 건 저장되지 않습니다</span>
      {backupPath && (
        <button
          style={linkBtn}
          onClick={onOpenBackupFolder}
          title={`기존 데이터는 자동으로 백업됐습니다:\n${backupPath}`}
        >
          백업 위치 열기
        </button>
      )}
      <button style={exitBtn} onClick={onExit}>튜토리얼 종료</button>
    </div>
  );
}
