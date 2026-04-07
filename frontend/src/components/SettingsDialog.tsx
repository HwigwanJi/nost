import { useCallback, useEffect, useState, useRef } from 'react';
import type { AppSettings } from '../types';
import { electronAPI } from '../electronBridge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ExtensionInstallWizard } from './ExtensionInstallWizard';
import { DEFAULT_DOCUMENT_EXTENSIONS } from '../lib/documentExtensions';

type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'dev-mode' | 'error';
type Tab = 'general' | 'monitor' | 'docs' | 'extension' | 'data';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'general',   label: '일반',   icon: 'tune' },
  { id: 'monitor',   label: '모니터', icon: 'desktop_windows' },
  { id: 'docs',      label: '문서',   icon: 'description' },
  { id: 'extension', label: '확장',   icon: 'extension' },
  { id: 'data',      label: '데이터', icon: 'save' },
];

interface MonitorInfo {
  index: number;
  id: number;
  isPrimary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
  updateDownloaded?: boolean;
  initialTab?: Tab;
}

// ── Small building blocks ────────────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 10,
      background: 'var(--surface)',
      border: '1px solid var(--border-rgba)',
    }}>
      {children}
    </div>
  );
}

function SectionLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      <span className="material-symbols-rounded" style={{ fontSize: 14, color: 'var(--text-muted)' }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-color)' }}>{text}</span>
    </div>
  );
}

function SwitchRow({ icon, title, description, checked, onCheckedChange }: {
  icon: string; title: string; description: string;
  checked: boolean; onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 14, color: 'var(--text-muted)' }}>{icon}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-color)' }}>{title}</span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45, paddingLeft: 20 }}>{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function AccentBtn({ style: s = {}, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.3)',
        background: 'var(--accent-dim)',
        color: 'var(--accent)', fontSize: 12, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', width: '100%',
        ...s,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function GhostBtn({ style: s = {}, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '8px 0', background: 'var(--bg-rgba)', border: '1px solid var(--border-rgba)',
        borderRadius: 8, color: 'var(--text-color)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
        ...s,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function SettingsDialog({ open, onClose, settings, onSave, updateDownloaded, initialTab }: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general');
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [newVersion, setNewVersion] = useState<string>('');
  const [showExtWizard, setShowExtWizard] = useState(false);
  const [extInput, setExtInput] = useState('');
  const extInputRef = useRef<HTMLInputElement>(null);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [identifying, setIdentifying] = useState(false);
  const [extStatus, setExtStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [extStatusLoading, setExtStatusLoading] = useState(false);

  const checkExtStatus = useCallback(async () => {
    setExtStatusLoading(true);
    try {
      const s = await electronAPI.getExtensionBridgeStatus();
      setExtStatus(s?.connected ? 'connected' : 'disconnected');
    } catch {
      setExtStatus('disconnected');
    } finally {
      setExtStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setForm({ ...settings });
      setTab(initialTab ?? 'general');
      electronAPI.getMonitors().then(ms => setMonitors(ms as MonitorInfo[]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) checkExtStatus();
  }, [open, checkExtStatus]);

  const f = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const docExts = form.documentExtensions && form.documentExtensions.length > 0
    ? form.documentExtensions
    : DEFAULT_DOCUMENT_EXTENSIONS;

  const handleExport = async () => {
    const res = await electronAPI.exportData();
    setBackupStatus(res.success ? '백업 완료' : '취소됨');
    setTimeout(() => setBackupStatus(null), 2500);
  };

  const handleImport = async () => {
    const res = await electronAPI.importData();
    if (res.success) {
      setBackupStatus('복원 완료, 앱을 다시 시작하면 적용됩니다');
      setTimeout(() => { setBackupStatus(null); onClose(); }, 2500);
    } else {
      setBackupStatus(res.reason === 'invalid-format' ? '잘못된 파일 형식' : '취소됨');
      setTimeout(() => setBackupStatus(null), 2500);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    const res = await electronAPI.checkForUpdates();
    if (res.version) setCurrentVersion(res.version);
    if (res.newVersion) setNewVersion(res.newVersion);
    setUpdateStatus(res.status as UpdateStatus);
  };

  const handleIdentify = async () => {
    setIdentifying(true);
    await electronAPI.identifyMonitors();
    setIdentifying(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent
        style={{
          width: 680,
          maxWidth: '95vw',
          height: 560,
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* ── Title bar ─────────────────────────────────────────── */}
        <DialogHeader style={{ padding: '16px 20px 14px', borderBottom: '1px solid var(--border-rgba)', flexShrink: 0 }}>
          <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 17, color: 'var(--text-muted)' }}>settings</span>
            환경설정
          </DialogTitle>
        </DialogHeader>

        {/* ── Body: left nav + right content ────────────────────── */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

          {/* Left sidebar nav */}
          <nav style={{
            width: 148,
            flexShrink: 0,
            borderRight: '1px solid var(--border-rgba)',
            padding: '10px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            overflowY: 'auto',
          }}>
            {TABS.map(t => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    textAlign: 'left',
                    width: '100%',
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface)'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 16, flexShrink: 0 }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </nav>

          {/* Right content panel */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', scrollbarWidth: 'none' } as React.CSSProperties}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* ══ 일반 ═══════════════════════════════════════════ */}
              {tab === 'general' && <>
                <Section>
                  <SectionLabel icon="palette" text="테마 모드" />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>라이트/다크 테마를 선택합니다.</p>
                    <div style={{ display: 'flex', background: 'var(--border-rgba)', borderRadius: 8, padding: 3, gap: 2, flexShrink: 0 }}>
                      {(['light', 'dark'] as const).map(mode => (
                        <button key={mode} onClick={() => f('theme', mode)} style={{
                          display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px',
                          fontSize: 11, fontWeight: form.theme === mode ? 700 : 400, borderRadius: 6,
                          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                          background: form.theme === mode ? 'var(--bg-rgba)' : 'transparent',
                          color: form.theme === mode ? 'var(--text-color)' : 'var(--text-muted)',
                          boxShadow: form.theme === mode ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                          transition: 'all 0.15s',
                        }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 13 }}>{mode === 'light' ? 'light_mode' : 'dark_mode'}</span>
                          {mode === 'light' ? 'Light' : 'Dark'}
                        </button>
                      ))}
                    </div>
                  </div>
                </Section>

                <Section>
                  <SectionLabel icon="opacity" text="배경 투명도" />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>앱 배경 투명도를 조절합니다.</p>
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-color)', background: 'var(--border-rgba)', padding: '2px 8px', borderRadius: 5 }}>
                      {Math.round(form.opacity * 100)}%
                    </span>
                  </div>
                  <Slider value={[form.opacity]} min={0.1} max={1} step={0.01}
                    onValueChange={val => f('opacity', Array.isArray(val) ? (val as number[])[0] : (val as number))}
                    className="w-full" />
                </Section>

                <Section>
                  <SwitchRow icon="start" title="Windows 시작 시 자동 실행"
                    description="Windows 로그인 시 nost를 자동 실행합니다."
                    checked={!!form.autoLaunch} onCheckedChange={v => f('autoLaunch', v)} />
                </Section>

                <Section>
                  <SwitchRow icon="blur_on" title="포커스 잃으면 자동 숨기기"
                    description="앱 바깥을 클릭하면 창을 자동으로 숨깁니다."
                    checked={!!form.autoHide} onCheckedChange={v => f('autoHide', v)} />
                </Section>

                <Section>
                  <SwitchRow icon="hide_source" title="실행 후 창 닫기"
                    description="항목 실행 후 앱 창을 자동으로 숨깁니다."
                    checked={!!form.closeAfterOpen} onCheckedChange={v => f('closeAfterOpen', v)} />
                </Section>

                <Section>
                  <SectionLabel icon="keyboard" text="전역 단축키" />
                  <Input value={form.shortcut} onChange={e => f('shortcut', e.target.value)}
                    placeholder="예: Alt+Space" className="font-mono text-sm" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>단축키 변경 후 저장하면 즉시 반영됩니다.</p>
                </Section>

                <Section>
                  <SectionLabel icon="palette" text="강조색 (Accent)" />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {['#6366f1','#0ea5e9','#22c55e','#f59e0b','#ef4444','#a855f7','#ec4899','#14b8a6','#f97316','#64748b'].map(c => (
                      <button key={c} onClick={() => f('accentColor', c)} style={{
                        width: 24, height: 24, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                        outline: (form.accentColor || '#6366f1') === c ? `3px solid ${c}` : '2px solid transparent',
                        outlineOffset: 2, transition: 'outline 0.1s',
                      }} />
                    ))}
                    <input type="color" value={form.accentColor || '#6366f1'}
                      onChange={e => f('accentColor', e.target.value)} title="직접 선택"
                      style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--border-rgba)', cursor: 'pointer', padding: 0, background: 'none' }} />
                  </div>
                </Section>
              </>}

              {/* ══ 모니터 ══════════════════════════════════════════ */}
              {tab === 'monitor' && <>
                <Section>
                  <SectionLabel icon="visibility" text="모니터 번호 확인" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                    각 모니터에 번호 오버레이를 2.5초간 표시합니다. 어느 모니터가 몇 번인지 확인하세요.
                  </p>
                  <AccentBtn onClick={handleIdentify} disabled={identifying} style={{ opacity: identifying ? 0.6 : 1 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                      {identifying ? 'hourglass_empty' : 'monitor'}
                    </span>
                    {identifying ? '표시 중...' : '모니터 번호 표시'}
                  </AccentBtn>
                </Section>

                <Section>
                  <SectionLabel icon="list" text="감지된 모니터" />
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.5 }}>
                    각 모니터에 WASD·C 키를 할당하세요. 같은 키는 중복 지정할 수 없습니다.
                  </p>
                  {monitors.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-dim)', fontSize: 12 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 28, display: 'block', marginBottom: 6 }}>desktop_windows</span>
                      불러오는 중...
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {monitors.map(m => {
                        type DirKey = 'w' | 'a' | 's' | 'd' | 'c';
                        const KEY_OPTIONS: { key: DirKey; label: string; icon: string }[] = [
                          { key: 'w', label: '위 (W)', icon: 'arrow_upward' },
                          { key: 'a', label: '왼쪽 (A)', icon: 'arrow_back' },
                          { key: 's', label: '아래 (S)', icon: 'arrow_downward' },
                          { key: 'd', label: '오른쪽 (D)', icon: 'arrow_forward' },
                          { key: 'c', label: '현재 (C)', icon: 'my_location' },
                        ];
                        const currentKey = form.monitorDirections?.[m.index] as DirKey | undefined;

                        const assignKey = (key: DirKey | 'none') => {
                          const next: Record<number, DirKey> = { ...(form.monitorDirections ?? {}) as Record<number, DirKey> };
                          // Clear any monitor that currently has this key (conflict prevention)
                          if (key !== 'none') {
                            Object.keys(next).forEach(k => {
                              if (next[Number(k)] === key && Number(k) !== m.index) delete next[Number(k)];
                            });
                            next[m.index] = key;
                          } else {
                            delete next[m.index];
                          }
                          f('monitorDirections', next);
                        };

                        const opt = KEY_OPTIONS.find(o => o.key === currentKey);

                        return (
                          <div key={m.id} style={{
                            padding: '10px 12px', borderRadius: 8,
                            background: 'var(--bg-rgba)',
                            border: `1px solid ${m.isPrimary ? 'var(--accent)' : 'var(--border-rgba)'}`,
                            boxShadow: m.isPrimary ? '0 0 0 1px rgba(99,102,241,0.08)' : 'none',
                          }}>
                            {/* Top row: badge + info + dropdown */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{
                                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                                background: m.isPrimary ? 'var(--accent)' : 'var(--surface)',
                                border: m.isPrimary ? 'none' : '1px solid var(--border-rgba)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 14, fontWeight: 800,
                                color: m.isPrimary ? '#fff' : 'var(--text-muted)',
                              }}>
                                {m.index}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-color)' }}>모니터 {m.index}</span>
                                  {m.isPrimary && (
                                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'var(--accent)', color: '#fff', fontWeight: 700 }}>주 모니터</span>
                                  )}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text-dim)', display: 'flex', gap: 6 }}>
                                  <span>{m.workArea.width} × {m.workArea.height}</span>
                                  <span>·</span>
                                  <span>배율 {m.scaleFactor}×</span>
                                  <span>·</span>
                                  <span>({m.bounds.x}, {m.bounds.y})</span>
                                </div>
                              </div>
                              {/* Key dropdown */}
                              <div style={{ position: 'relative', flexShrink: 0 }}>
                                <select
                                  value={currentKey ?? 'none'}
                                  onChange={e => assignKey(e.target.value as DirKey | 'none')}
                                  style={{
                                    appearance: 'none',
                                    padding: '5px 28px 5px 8px',
                                    fontSize: 11, fontWeight: 600,
                                    background: currentKey ? 'var(--accent)' : 'var(--surface)',
                                    color: currentKey ? '#fff' : 'var(--text-dim)',
                                    border: `1px solid ${currentKey ? 'var(--accent)' : 'var(--border-rgba)'}`,
                                    borderRadius: 7,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    minWidth: 110,
                                    outline: 'none',
                                  }}
                                >
                                  <option value="none">키 없음</option>
                                  {KEY_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                                </select>
                                <span className="material-symbols-rounded" style={{
                                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                                  fontSize: 13, pointerEvents: 'none',
                                  color: currentKey ? 'rgba(255,255,255,0.7)' : 'var(--text-dim)',
                                }}>
                                  {opt ? opt.icon : 'keyboard_arrow_down'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.5 }}>
                    카드를 꾹 누르고 <strong>↓ 아래</strong> 방향으로 드래그하면 실행 모니터를 선택할 수 있습니다.<br/>
                    위에서 키를 지정한 뒤 해당 키를 누르면 열린 창이 그 방향 모니터로 이동합니다.
                  </p>
                </Section>
              </>}

              {/* ══ 문서 ════════════════════════════════════════════ */}
              {tab === 'docs' && <>
                <Section>
                  <SectionLabel icon="description" text="문서 확장자 관리" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                    이 확장자를 가진 파일은 '문서' 타입으로 인식됩니다. 태그를 클릭해 제거하거나 추가하세요.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                    {docExts.map(ext => (
                      <button key={ext} onClick={() => f('documentExtensions', docExts.filter(e => e !== ext))}
                        title={`${ext} 제거`} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          padding: '3px 8px', background: 'var(--surface)',
                          border: '1px solid var(--border-rgba)', borderRadius: 99,
                          fontSize: 11, fontWeight: 500, color: 'var(--text-color)',
                          cursor: 'pointer', fontFamily: 'monospace',
                        }}>
                        .{ext}
                        <span className="material-symbols-rounded" style={{ fontSize: 11, color: 'var(--text-dim)' }}>close</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      ref={extInputRef} value={extInput}
                      onChange={e => setExtInput(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const val = extInput.trim();
                          if (val && !docExts.includes(val)) f('documentExtensions', [...docExts, val]);
                          setExtInput('');
                        }
                      }}
                      placeholder="확장자 추가 (예: hwp, Enter로 추가)"
                      style={{
                        flex: 1, background: 'var(--bg-rgba)', border: '1px solid var(--border-rgba)',
                        borderRadius: 7, padding: '6px 10px', fontSize: 11,
                        color: 'var(--text-color)', fontFamily: 'monospace', outline: 'none',
                      }}
                      onFocus={e => (e.target.style.borderColor = 'var(--border-focus)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--border-rgba)')}
                    />
                    <button onClick={() => {
                      const val = extInput.trim();
                      if (val && !docExts.includes(val)) f('documentExtensions', [...docExts, val]);
                      setExtInput(''); extInputRef.current?.focus();
                    }} style={{
                      padding: '6px 13px', background: 'var(--accent)', border: 'none',
                      borderRadius: 7, color: '#fff', fontSize: 11, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>추가</button>
                    <button onClick={() => f('documentExtensions', [...DEFAULT_DOCUMENT_EXTENSIONS])}
                      title="기본값으로 초기화" style={{
                        padding: '6px 10px', background: 'var(--bg-rgba)', border: '1px solid var(--border-rgba)',
                        borderRadius: 7, color: 'var(--text-dim)', fontSize: 11,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}>초기화</button>
                  </div>
                </Section>
              </>}

              {/* ══ 확장 ════════════════════════════════════════════ */}
              {tab === 'extension' && <>
                {/* Connection status */}
                <Section>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <SectionLabel icon="cable" text="연결 상태" />
                    <button
                      onClick={checkExtStatus}
                      disabled={extStatusLoading}
                      title="새로고침"
                      style={{
                        padding: '4px 6px', background: 'transparent',
                        border: '1px solid var(--border-rgba)', borderRadius: 6,
                        cursor: extStatusLoading ? 'default' : 'pointer',
                        color: 'var(--text-dim)', fontSize: 11, fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', gap: 3,
                        opacity: extStatusLoading ? 0.5 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <span className="material-symbols-rounded" style={{
                        fontSize: 13,
                        animation: extStatusLoading ? 'spin 1s linear infinite' : 'none',
                      }}>refresh</span>
                    </button>
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 12px',
                    background: extStatus === 'connected' ? 'rgba(34,197,94,0.1)' : extStatus === 'disconnected' ? 'rgba(239,68,68,0.08)' : 'var(--bg-rgba)',
                    border: `1px solid ${extStatus === 'connected' ? 'rgba(34,197,94,0.3)' : extStatus === 'disconnected' ? 'rgba(239,68,68,0.2)' : 'var(--border-rgba)'}`,
                    borderRadius: 8,
                  }}>
                    <span className="material-symbols-rounded" style={{
                      fontSize: 16,
                      color: extStatus === 'connected' ? '#22c55e' : extStatus === 'disconnected' ? '#ef4444' : 'var(--text-dim)',
                    }}>
                      {extStatus === 'connected' ? 'check_circle' : extStatus === 'disconnected' ? 'cancel' : 'help'}
                    </span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-color)' }}>
                        {extStatus === 'connected' ? '브라우저 확장 연결됨' : extStatus === 'disconnected' ? '확장 프로그램 미연결' : '상태 확인 중...'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {extStatus === 'connected' ? '탭 스캔 및 타일 분할 사용 가능' : extStatus === 'disconnected' ? 'Chrome / Whale 브라우저에 확장이 필요합니다' : ''}
                      </div>
                    </div>
                  </div>
                </Section>

                <Section>
                  <SectionLabel icon="extension" text="브라우저 확장 설치 도우미" />
                  {showExtWizard ? (
                    <div style={{ marginTop: 4 }}>
                      <ExtensionInstallWizard onSuccess={() => { setTimeout(() => setShowExtWizard(false), 1800); checkExtStatus(); }} />
                      <button onClick={() => setShowExtWizard(false)} style={{
                        marginTop: 10, width: '100%', padding: '7px 0',
                        background: 'transparent', border: '1px solid var(--border-rgba)',
                        borderRadius: 8, color: 'var(--text-dim)', fontSize: 11,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}>닫기</button>
                    </div>
                  ) : (
                    <>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                        Chrome / Whale에서 탭 스캔과 타일 분할을 사용하려면 확장 프로그램이 필요합니다.
                      </p>
                      <AccentBtn onClick={() => setShowExtWizard(true)}>
                        <span className="material-symbols-rounded" style={{ fontSize: 15 }}>extension</span>
                        단계별 설치 도우미 열기
                      </AccentBtn>
                    </>
                  )}
                </Section>
              </>}

              {/* ══ 데이터 ══════════════════════════════════════════ */}
              {tab === 'data' && <>
                <Section>
                  <SectionLabel icon="system_update" text="앱 업데이트" />
                  {currentVersion && (
                    <p style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>현재 버전: v{currentVersion}</p>
                  )}
                  {(updateDownloaded || updateStatus === 'update-available') ? (
                    <AccentBtn onClick={() => electronAPI.installUpdate()} style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 15 }}>restart_alt</span>
                      {newVersion ? `v${newVersion} 설치 — 재시작` : '재시작 후 업데이트 설치'}
                    </AccentBtn>
                  ) : (
                    <GhostBtn onClick={handleCheckUpdate} disabled={updateStatus === 'checking'}
                      style={{ opacity: updateStatus === 'checking' ? 0.6 : 1, width: '100%' }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                        {updateStatus === 'up-to-date' ? 'check_circle' : updateStatus === 'error' ? 'error' : 'refresh'}
                      </span>
                      {updateStatus === 'checking' ? '확인 중...'
                        : updateStatus === 'up-to-date' ? '최신 버전입니다'
                        : updateStatus === 'dev-mode' ? '개발 모드'
                        : updateStatus === 'error' ? '확인 실패 — 재시도'
                        : '업데이트 확인'}
                    </GhostBtn>
                  )}
                </Section>

                <Section>
                  <SectionLabel icon="save" text="데이터 백업 / 복원" />
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[
                      { label: '백업 내보내기', icon: 'upload', fn: handleExport },
                      { label: '백업 가져오기', icon: 'download', fn: handleImport },
                    ].map(btn => (
                      <GhostBtn key={btn.label} onClick={btn.fn}>
                        <span className="material-symbols-rounded" style={{ fontSize: 15 }}>{btn.icon}</span>
                        {btn.label}
                      </GhostBtn>
                    ))}
                  </div>
                  {backupStatus && (
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>{backupStatus}</p>
                  )}
                </Section>
              </>}

            </div>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 20px',
          borderTop: '1px solid var(--border-rgba)',
          flexShrink: 0,
        }}>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button onClick={() => { onSave(form); onClose(); }}>저장</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
