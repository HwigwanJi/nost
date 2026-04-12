import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { electronAPI } from '../electronBridge';
import type { LauncherItem } from '../types';

interface DialogContextBarProps {
  allItems: LauncherItem[];
}

interface DetectedDialog {
  isDialog: boolean;
  title?: string;
  className?: string;
}

const SYSTEM_FOLDERS = [
  { label: '다운로드', path: '', icon: 'download', envKey: 'USERPROFILE', subPath: 'Downloads' },
  { label: '바탕화면', path: '', icon: 'desktop_windows', envKey: 'USERPROFILE', subPath: 'Desktop' },
  { label: '문서', path: '', icon: 'description', envKey: 'USERPROFILE', subPath: 'Documents' },
];

export function DialogContextBar({ allItems }: DialogContextBarProps) {
  const [dialogDetected, setDialogDetected] = useState(false);
  const [dialogTitle, setDialogTitle] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for file dialogs every 2 seconds
  useEffect(() => {
    const check = async () => {
      try {
        const result: DetectedDialog = await electronAPI.detectDialog();
        if (result.isDialog) {
          setDialogDetected(true);
          setDialogTitle(result.title || '');
        } else {
          setDialogDetected(false);
        }
      } catch {
        setDialogDetected(false);
      }
    };
    check();
    pollRef.current = setInterval(check, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const jumpTo = useCallback((folderPath: string) => {
    electronAPI.jumpToDialogFolder(folderPath);
  }, []);

  if (!dialogDetected) return null;

  // Build folder buttons: system folders + user's registered folders
  const userFolders = allItems
    .filter(i => i.type === 'folder' && i.value)
    .slice(0, 5)
    .map(i => ({
      label: i.title || i.value.split('\\').pop() || i.value,
      path: i.value,
      icon: 'folder',
    }));

  const home = electronAPI.getUserHome();
  const systemPaths = home ? SYSTEM_FOLDERS.map(sf => ({
    ...sf,
    path: `${home}\\${sf.subPath}`,
  })) : [];

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: 'var(--surface)', borderTop: '1px solid var(--border-rgba)',
      padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8,
      zIndex: 200, boxShadow: '0 -2px 12px rgba(0,0,0,0.1)',
    }}>
      <Icon name="folder_open" size={16} color="#f59e0b" />
      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginRight: 4 }}>
        {dialogTitle ? `${dialogTitle.slice(0, 20)}` : '저장 위치'}
      </span>

      <div style={{ display: 'flex', gap: 4, flex: 1, overflowX: 'auto' }}>
        {systemPaths.map(f => (
          <FolderButton key={f.path} label={f.label} icon={f.icon} onClick={() => jumpTo(f.path)} />
        ))}
        {userFolders.length > 0 && <div style={{ width: 1, background: 'var(--border-rgba)', margin: '0 4px', flexShrink: 0 }} />}
        {userFolders.map(f => (
          <FolderButton key={f.path} label={f.label} icon={f.icon} onClick={() => jumpTo(f.path)} />
        ))}
      </div>
    </div>
  );
}

function FolderButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: 6,
        border: '1px solid var(--border-rgba)', background: 'var(--surface)',
        color: 'var(--text)', fontSize: 11, cursor: 'pointer',
        whiteSpace: 'nowrap', fontFamily: 'inherit',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}
