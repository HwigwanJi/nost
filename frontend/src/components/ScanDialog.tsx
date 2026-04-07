import { useCallback, useEffect, useState } from 'react';
import type { WindowEntry, ChromeTab } from '../types';
import { electronAPI } from '../electronBridge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExtensionInstallWizard } from './ExtensionInstallWizard';

interface ScanResult {
  browsers: ChromeTab[];
  folders: WindowEntry[];
  programs: WindowEntry[];
}

interface SelectExtra {
  exePath?: string;
  iconType?: 'material' | 'image';
  icon?: string;
}

interface ScanDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (type: string, title: string, value: string, extra?: SelectExtra) => void;
}

const CAT = {
  browser: { label: '브라우저 탭', icon: 'public' },
  folder: { label: '탐색기 폴더', icon: 'folder_open' },
  window: { label: '실행 중인 프로그램', icon: 'window' },
} as const;

function ScanCard({
  icon,
  imageIconUrl,
  title,
  subtitle,
  onClick,
}: {
  icon: string;
  imageIconUrl?: string;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '10px 8px',
        minHeight: 84,
        borderRadius: 8,
        border: '1px solid var(--border-rgba)',
        background: 'var(--surface)',
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'background 0.12s, border-color 0.12s',
        width: '100%',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.borderColor = 'var(--border-focus)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--surface)';
        e.currentTarget.style.borderColor = 'var(--border-rgba)';
      }}
    >
      {imageIconUrl && !imageFailed ? (
        <img
          src={imageIconUrl}
          alt=""
          style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 4 }}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="material-symbols-rounded" style={{ fontSize: 22, color: 'var(--text-muted)' }}>
          {icon}
        </span>
      )}

      <span
        style={{
          fontSize: 11,
          color: 'var(--text-color)',
          fontWeight: 500,
          lineHeight: 1.3,
          wordBreak: 'break-all',
          maxWidth: '100%',
        }}
      >
        {title.length > 40 ? `${title.slice(0, 38)}...` : title}
      </span>

      {subtitle && (
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-dim)',
            wordBreak: 'break-all',
            maxWidth: '100%',
          }}
        >
          {subtitle.length > 40 ? `${subtitle.slice(0, 38)}...` : subtitle}
        </span>
      )}
    </button>
  );
}

function CategoryHeader({ label, icon }: { label: string; icon: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, marginTop: 4 }}>
      <span className="material-symbols-rounded" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
        {icon}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ProgramScanCard({
  entry,
  imageIconUrl,
  onSelectWindow,
  onSelectApp,
}: {
  entry: WindowEntry;
  imageIconUrl?: string;
  onSelectWindow: (exePath?: string) => void;
  onSelectApp: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = entry.MainWindowTitle;
  const hasExe = !!entry.ExePath;
  const exeName = hasExe ? entry.ExePath!.split('\\').pop() || entry.ProcessName : entry.ProcessName;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        border: '1px solid var(--border-rgba)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '10px 10px 8px', textAlign: 'center' }}>
        {imageIconUrl && !imageFailed ? (
          <img
            src={imageIconUrl}
            alt=""
            style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 4, display: 'block', margin: '0 auto 4px' }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span
            className="material-symbols-rounded"
            style={{ fontSize: 22, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}
          >
            window
          </span>
        )}

        <div style={{ height: 29, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-color)',
              fontWeight: 500,
              lineHeight: 1.3,
              wordBreak: 'break-all',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textAlign: 'center',
            }}
          >
            {title.length > 36 ? `${title.slice(0, 34)}...` : title}
          </span>
        </div>

        {hasExe && (
          <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 2 }}>
            {exeName}
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: hasExe ? '1fr 1fr' : '1fr',
          borderTop: '1px solid var(--border-rgba)',
        }}
      >
        <button
          onClick={() => onSelectWindow(entry.ExePath)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            padding: '7px 4px',
            background: 'transparent',
            border: 'none',
            borderRight: hasExe ? '1px solid var(--border-rgba)' : 'none',
            color: 'var(--text-muted)',
            fontSize: 10,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--surface-hover)';
            e.currentTarget.style.color = 'var(--text-color)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
          title="현재 창 제목으로 등록 (해당 창이 이미 열려 있을 때 추천)"
        >
          <span className="material-symbols-rounded" style={{ fontSize: 13 }}>pip_exit</span>
          창 전환
        </button>

        {hasExe && (
          <button
            onClick={onSelectApp}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              padding: '7px 4px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--surface-hover)';
              e.currentTarget.style.color = 'var(--text-color)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
            title="프로그램 실행 경로로 등록 (창이 닫혀 있어도 실행 가능)"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 13 }}>apps</span>
            프로그램
          </button>
        )}
      </div>
    </div>
  );
}


export function ScanDialog({ open, onClose, onSelect }: ScanDialogProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [programIconMap, setProgramIconMap] = useState<Record<string, string>>({});

  const refreshScan = useCallback(async () => {
    setLoading(true);
    const payload = await electronAPI.getOpenWindows();
    const browsers = payload.browserTabs ?? [];
    const all = payload.windows ?? [];
    const folders = all.filter(w => w.ProcessName.toLowerCase() === 'explorer');
    const programs = all.filter(w => w.ProcessName.toLowerCase() !== 'explorer');
    setResult({ browsers, folders, programs });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setProgramIconMap({});
    void refreshScan();
  }, [open, refreshScan]);

  useEffect(() => {
    if (!open || !result?.programs?.length) return;
    let cancelled = false;

    (async () => {
      const entries = result.programs.filter(p => !!p.ExePath);
      const pairs = await Promise.all(
        entries.map(async p => {
          const key = `${p.ExePath}::${p.MainWindowTitle}`;
          const icon = await electronAPI.getFileIcon(p.ExePath!);
          return { key, icon };
        })
      );

      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const pair of pairs) {
        if (pair.icon) next[pair.key] = pair.icon;
      }
      setProgramIconMap(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, result?.programs]);


  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent
        style={{
          width: 520,
          maxWidth: '92vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <DialogHeader
          style={{
            padding: '16px 18px 12px',
            borderBottom: '1px solid var(--border-rgba)',
            flexShrink: 0,
          }}
        >
          <DialogTitle
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text-color)',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16, color: 'var(--text-muted)' }}>
              radar
            </span>
            스마트 스캔
          </DialogTitle>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            현재 열려 있는 창/탭을 클릭해서 스페이스에 빠르게 추가하세요.
          </p>
        </DialogHeader>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 18px' }}>
          {loading && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '56px 0',
                gap: 12,
              }}
            >
              <span className="material-symbols-rounded animate-spin" style={{ fontSize: 36, color: 'var(--text-dim)' }}>
                sync
              </span>
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>스캔 중...</p>
            </div>
          )}

          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {result.browsers.length > 0 ? (
                <section>
                  <CategoryHeader {...CAT.browser} />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                      gap: 8,
                    }}
                  >
                    {result.browsers.map(tab => (
                      <ScanCard
                        key={tab.id}
                        icon="public"
                        imageIconUrl={tab.favIconUrl}
                        title={tab.title}
                        subtitle={tab.url}
                        onClick={() =>
                          onSelect(
                            'browser',
                            tab.title,
                            tab.url,
                            tab.favIconUrl ? { iconType: 'image', icon: tab.favIconUrl } : undefined
                          )
                        }
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <section
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border-rgba)',
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <ExtensionInstallWizard onSuccess={() => void refreshScan()} />
                </section>
              )}

              {result.folders.length > 0 && (
                <section>
                  <CategoryHeader {...CAT.folder} />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                      gap: 8,
                    }}
                  >
                    {result.folders.map((w, i) => (
                      <ScanCard
                        key={i}
                        icon="folder_open"
                        title={w.MainWindowTitle}
                        subtitle={w.FolderPath}
                        onClick={() => onSelect('folder', w.MainWindowTitle, w.FolderPath || w.MainWindowTitle)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {result.programs.length > 0 && (
                <section>
                  <CategoryHeader {...CAT.window} />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                      gap: 8,
                    }}
                  >
                    {result.programs.map((w, i) => (
                      <ProgramScanCard
                        key={i}
                        entry={w}
                        imageIconUrl={w.ExePath ? programIconMap[`${w.ExePath}::${w.MainWindowTitle}`] : undefined}
                        onSelectWindow={exePath => onSelect('window', w.MainWindowTitle, w.MainWindowTitle, { exePath })}
                        onSelectApp={() => {
                          const icon = w.ExePath ? programIconMap[`${w.ExePath}::${w.MainWindowTitle}`] : undefined;
                          onSelect('app', w.ProcessName, w.ExePath || w.MainWindowTitle, icon ? { iconType: 'image', icon } : undefined);
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
