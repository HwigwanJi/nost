import { useCallback, useEffect, useState, useRef } from 'react';
import type { AppSettings } from '../types';
import { MEMO_TTL_DAYS_MIN, MEMO_TTL_DAYS_MAX, DEFAULT_MEMO_SETTINGS } from '../types';
import { Icon } from '@/components/ui/Icon';
import { electronAPI } from '../electronBridge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { AccordionPanel } from '../tutorial';
import { ExtensionInstallWizard } from './ExtensionInstallWizard';
import { DEFAULT_DOCUMENT_EXTENSIONS } from '../lib/documentExtensions';
import { useBusyMark } from '../lib/userBusy';
import { TOURS } from '../tour/tours';

type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'dev-mode' | 'error';
type Tab = 'general' | 'monitor' | 'docs' | 'extension' | 'memo' | 'tutorial' | 'data';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'general',   label: '일반',     icon: 'tune' },
  { id: 'monitor',   label: '모니터',   icon: 'desktop_windows' },
  { id: 'docs',      label: '문서',     icon: 'description' },
  { id: 'extension', label: '확장',     icon: 'extension' },
  { id: 'memo',      label: '메모',     icon: 'sticky_note_2' },
  { id: 'tutorial',  label: '튜토리얼', icon: 'school' },
  { id: 'data',      label: '데이터',   icon: 'save' },
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
  downloadProgress?: number | null;
  initialTab?: Tab;
  /** Optional — invoked when the user picks a quest from the
   *  튜토리얼 tab. App routes through TutorialProvider.start. */
  onStartTutorial?: (quest: import('../tutorial').Quest) => void;
  // ── Memo (사라지는 메모) ────────────────────────────────────────
  /** Open the trash dialog (memos are stored in the data tree, but the
   *  trash UI lives at App-level; we call up to surface it). */
  onOpenMemoTrash?: () => void;
  /** Bulk +ttl across every active memo. Returns count touched. */
  onExtendAllMemos?: () => number;
  /** Empty the trash hard. Returns count purged. */
  onEmptyMemoTrash?: () => number;
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
      <Icon name={icon} size={14} color="var(--text-muted)" />
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
          <Icon name={icon} size={14} color="var(--text-muted)" />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-color)' }}>{title}</span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45, paddingLeft: 20 }}>{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// ── Memo (사라지는 메모) — small pickers ─────────────────────────
const TTL_PRESETS: number[] = [1, 3, 7, 14, 30];

function MemoTtlPicker({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  const [customMode, setCustomMode] = useState(!TTL_PRESETS.includes(value));
  const [customStr, setCustomStr] = useState(String(value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TTL_PRESETS.map(d => {
          const active = !customMode && value === d;
          return (
            <button
              key={d}
              onClick={() => { setCustomMode(false); onChange(d); }}
              style={{
                padding: '6px 12px',
                borderRadius: 7,
                background: active ? 'var(--accent-dim)' : 'var(--surface)',
                color: active ? 'var(--accent)' : 'var(--text-color)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border-rgba)'}`,
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {d}일
            </button>
          );
        })}
        <button
          onClick={() => { setCustomMode(true); }}
          style={{
            padding: '6px 12px',
            borderRadius: 7,
            background: customMode ? 'var(--accent-dim)' : 'var(--surface)',
            color: customMode ? 'var(--accent)' : 'var(--text-color)',
            border: `1px solid ${customMode ? 'var(--accent)' : 'var(--border-rgba)'}`,
            fontSize: 12,
            fontWeight: customMode ? 600 : 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          직접 입력
        </button>
      </div>
      {customMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Input
            type="number"
            value={customStr}
            min={MEMO_TTL_DAYS_MIN}
            max={MEMO_TTL_DAYS_MAX}
            onChange={e => setCustomStr(e.target.value)}
            onBlur={() => {
              const n = Math.max(MEMO_TTL_DAYS_MIN, Math.min(MEMO_TTL_DAYS_MAX, Math.round(Number(customStr) || 7)));
              setCustomStr(String(n));
              onChange(n);
            }}
            style={{ width: 70, fontSize: 12 }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            일 (1~90)
          </span>
        </div>
      )}
    </div>
  );
}

function MemoTrashRetentionPicker({ value, onChange }: { value: 24 | 72 | 168; onChange: (h: 24 | 72 | 168) => void }) {
  const opts: Array<{ h: 24 | 72 | 168; label: string }> = [
    { h: 24,  label: '24시간' },
    { h: 72,  label: '3일' },
    { h: 168, label: '7일' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {opts.map(o => {
        const active = value === o.h;
        return (
          <button
            key={o.h}
            onClick={() => onChange(o.h)}
            style={{
              padding: '6px 12px',
              borderRadius: 7,
              background: active ? 'var(--accent-dim)' : 'var(--surface)',
              color: active ? 'var(--accent)' : 'var(--text-color)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border-rgba)'}`,
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {o.label}
          </button>
        );
      })}
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

export function SettingsDialog({ open, onClose, settings, onSave, updateDownloaded, downloadProgress, initialTab, onStartTutorial, onOpenMemoTrash, onExtendAllMemos, onEmptyMemoTrash }: SettingsDialogProps) {
  useBusyMark('modal:settings', open);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general');
  const [form, setForm] = useState<AppSettings>({ ...settings });
  // Snapshot of settings at the moment this dialog opened — used for
  // dirty detection and the rollback path. Captured once on open;
  // form mutations apply LIVE via onSave (modern UX: see immediate
  // result while sliding/toggling), and we revert to this snapshot
  // when the user picks "적용 안 함" on the close confirm.
  const originalRef = useRef<AppSettings>({ ...settings });
  // 3-button close confirm modal — only appears when the user attempts
  // to close (Esc / outside-click / 취소 button) AND the live form
  // diverges from originalRef. The Save button bypasses this entirely
  // (its whole purpose is "I want this to stick").
  const [pendingClose, setPendingClose] = useState(false);
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
      // Take a fresh snapshot of "what the user will rollback to" at
      // the moment the dialog opens. Subsequent live-preview writes
      // mutate `settings` upstream, but originalRef stays pinned to
      // this moment.
      originalRef.current = { ...settings };
      setForm({ ...settings });
      setTab(initialTab ?? 'general');
      setPendingClose(false);
      electronAPI.getMonitors().then(ms => setMonitors(ms as MonitorInfo[]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) checkExtStatus();
  }, [open, checkExtStatus]);

  // Live-preview write. Setting locally + propagating upstream on the
  // same render keeps the form controls "controlled" while letting
  // every other surface in the app reflect the change immediately
  // (theme flip, opacity, badge size, etc). The previous "click 저장
  // to apply" model felt dated — modern apps preview-on-edit and
  // confirm-on-close.
  //
  // Implementation note: rather than wrapping every existing
  // `setForm(...)` callsite, we use a useEffect-based reflector below
  // that fires onSave whenever the form diverges from the upstream
  // settings. That keeps the existing call sites untouched while
  // guaranteeing live preview from a single point of truth.
  const f = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  // Reflector — runs whenever form changes. Equality check via
  // JSON.stringify is fine: the settings blob is small (< 1 KB) and
  // this runs at most a few times per second under heavy slider use.
  // Skip while the dialog is closed (we just store-loaded the form
  // from `settings`, no need to immediately echo it back).
  useEffect(() => {
    if (!open) return;
    const formStr = JSON.stringify(form);
    if (formStr === JSON.stringify(settings)) return;
    onSave(form);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, open]);

  // Dirty detection — same JSON-string approach but compared against
  // `originalRef` (the open-time snapshot), not `settings` (which is
  // already kept up to date by the live reflector above).
  const isDirty = useCallback(
    () => JSON.stringify(form) !== JSON.stringify(originalRef.current),
    [form],
  );

  /** Close path. Branches:
   *  - No changes → close immediately (no nag).
   *  - Changes pending → 3-button confirm. */
  const handleCloseAttempt = useCallback(() => {
    if (isDirty()) {
      setPendingClose(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  // Confirm modal actions:
  //   - 저장 (Apply): live writes are already applied; just close. Tell main about
  //     floating-orb config so the orb window can spawn/respawn with new settings.
  //   - 적용 안 함 (Discard): rollback to originalRef via onSave, then close.
  //   - 취소 (Cancel): just dismiss the modal — settings dialog stays open.
  const confirmKeep = useCallback(() => {
    setPendingClose(false);
    electronAPI.notifyFloatingSettingsChanged();
    onClose();
  }, [onClose]);

  const confirmDiscard = useCallback(() => {
    onSave(originalRef.current);
    setPendingClose(false);
    onClose();
  }, [onSave, onClose]);

  const confirmCancel = useCallback(() => {
    setPendingClose(false);
  }, []);

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
    <Dialog open={open} onOpenChange={v => { if (!v) handleCloseAttempt(); }}>
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
            <Icon name="settings" size={17} color="var(--text-muted)" />
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
                  <Icon name={t.icon} size={16} style={{ flexShrink: 0 }} />
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
                          <Icon name={mode === 'light' ? 'light_mode' : 'dark_mode'} size={13} />
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

                {/* ── Floating button (Phase 1 MVP) ────────────────── */}
                <Section>
                  <SwitchRow
                    icon="adjust"
                    title="플로팅 버튼"
                    description="화면 위에 떠 있는 작은 버튼을 항상 표시합니다. 클릭하면 단축키 없이도 nost를 토글할 수 있습니다."
                    checked={!!form.floatingButton?.enabled}
                    onCheckedChange={v => f('floatingButton', {
                      enabled: v,
                      idleOpacity: form.floatingButton?.idleOpacity ?? 0.65,
                      size: form.floatingButton?.size ?? 48,
                      hideOnFullscreen: form.floatingButton?.hideOnFullscreen ?? true,
                      position: form.floatingButton?.position,
                    })}
                  />

                  {form.floatingButton?.enabled && (() => {
                    // Migrate legacy 'small' / 'normal' string values to numbers
                    // so the slider has a real value to bind to.
                    const rawSize = form.floatingButton?.size;
                    const sizePx =
                      typeof rawSize === 'number' ? rawSize :
                      rawSize === 'small' ? 40 : 48;
                    return (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-rgba)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {/* Size — continuous slider, 28..72px (icon hits 64px Material grid budget at the top end) */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>크기</span>
                          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-color)', background: 'var(--border-rgba)', padding: '2px 8px', borderRadius: 5 }}>
                            {sizePx}px
                          </span>
                        </div>
                        <Slider
                          value={[sizePx]}
                          min={28} max={72} step={2}
                          onValueChange={val => {
                            const v = Array.isArray(val) ? (val as number[])[0] : (val as number);
                            f('floatingButton', { ...form.floatingButton!, size: v });
                          }}
                          className="w-full"
                        />
                        <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.4 }}>
                          작게 28 · 보통 48 · 크게 64. 변경은 즉시 반영됩니다.
                        </p>
                      </div>

                      {/* Idle opacity */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>비활성 상태 투명도</span>
                          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-color)', background: 'var(--border-rgba)', padding: '2px 8px', borderRadius: 5 }}>
                            {Math.round((form.floatingButton?.idleOpacity ?? 0.65) * 100)}%
                          </span>
                        </div>
                        <Slider
                          value={[form.floatingButton?.idleOpacity ?? 0.65]}
                          min={0.3} max={1} step={0.05}
                          onValueChange={val => {
                            const v = Array.isArray(val) ? (val as number[])[0] : (val as number);
                            f('floatingButton', { ...form.floatingButton!, idleOpacity: v });
                          }}
                          className="w-full"
                        />
                        <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.4 }}>
                          버튼 위로 마우스를 올리면 항상 100%가 됩니다.
                        </p>
                      </div>
                    </div>
                    );
                  })()}
                </Section>

                {/* ── Floating badge size (global) ──────────────────
                   Distinct from the "플로팅 버튼" section above: this
                   slider scales the small SPACE/NODE/DECK chips that the
                   user pins on monitor edges (rendered by the badges
                   overlay BrowserWindow), NOT the main FAB orb. The two
                   share a 28..72 px range so users with muscle memory
                   from one slider read the other intuitively. Changes
                   are live — see main.js `store-save` which diffs
                   badgeSize and re-pushes to every overlay. */}
                <Section>
                  <SectionLabel icon="bubble_chart" text="플로팅 뱃지" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
                    화면 가장자리에 핀한 스페이스 / 노드 / 덱 뱃지의 크기를 조절합니다.
                  </p>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>크기</span>
                      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-color)', background: 'var(--border-rgba)', padding: '2px 8px', borderRadius: 5 }}>
                        {form.badgeSize ?? 46}px
                      </span>
                    </div>
                    <Slider
                      value={[form.badgeSize ?? 46]}
                      min={28} max={72} step={2}
                      onValueChange={val => {
                        const v = Array.isArray(val) ? (val as number[])[0] : (val as number);
                        setForm(prev => ({ ...prev, badgeSize: v }));
                      }}
                      className="w-full"
                    />
                    <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.4 }}>
                      작게 28 · 보통 46 · 크게 64. 모든 뱃지에 동일하게 적용됩니다.
                    </p>
                  </div>
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

                {/* ── Tutorials replay ──
                   Re-run any of the spotlight tours from the start. We close
                   the dialog first and defer the dispatch by a tick so the
                   modal's busy mark clears before TourOverlay's listener
                   evaluates `whenIdle` — otherwise the tour would queue
                   itself behind our own settings dialog. */}
                <Section>
                  <SectionLabel icon="school" text="튜토리얼 다시 보기" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                    각 기능별 안내를 다시 볼 수 있어요.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {TOURS.map(t => (
                      <button
                        key={t.id}
                        onClick={() => {
                          onClose();
                          // small defer so the dialog finishes unmounting and
                          // releases its busy mark before the tour starts.
                          setTimeout(() => {
                            window.dispatchEvent(
                              new CustomEvent('nost:start-tour', { detail: { tourId: t.id } }),
                            );
                          }, 250);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '9px 12px', borderRadius: 8,
                          background: 'var(--bg-rgba)',
                          border: '1px solid var(--border-rgba)',
                          color: 'var(--text-color)', fontSize: 12, fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-rgba)'; }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Icon name="play_circle" size={14} color="var(--accent)" />
                          {t.title}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                          {t.steps.length}단계
                        </span>
                      </button>
                    ))}
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
                    <Icon name={identifying ? 'hourglass_empty' : 'monitor'} size={15} />
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
                      <Icon name="desktop_windows" size={28} style={{ display: 'block', marginBottom: 6 }} />
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
                                <Icon name={opt ? opt.icon : 'keyboard_arrow_down'} size={13} style={{
                                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                                  pointerEvents: 'none',
                                  color: currentKey ? 'rgba(255,255,255,0.7)' : 'var(--text-dim)',
                                }} />
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
                        <Icon name="close" size={11} color="var(--text-dim)" />
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
                      <Icon name="refresh" size={13} style={{ animation: extStatusLoading ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 12px',
                    background: extStatus === 'connected' ? 'rgba(34,197,94,0.1)' : extStatus === 'disconnected' ? 'rgba(239,68,68,0.08)' : 'var(--bg-rgba)',
                    border: `1px solid ${extStatus === 'connected' ? 'rgba(34,197,94,0.3)' : extStatus === 'disconnected' ? 'rgba(239,68,68,0.2)' : 'var(--border-rgba)'}`,
                    borderRadius: 8,
                  }}>
                    <Icon name={extStatus === 'connected' ? 'check_circle' : extStatus === 'disconnected' ? 'cancel' : 'help'} size={16} color={extStatus === 'connected' ? '#22c55e' : extStatus === 'disconnected' ? '#ef4444' : 'var(--text-dim)'} />
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
                  <SectionLabel icon="extension" text="브라우저 확장 설치" />
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
                        Chrome 웹 스토어에서 한 번에 설치할 수 있습니다. 탭 스캔과 타일 분할이 활성화됩니다.
                      </p>
                      <AccentBtn onClick={() => setShowExtWizard(true)}>
                        <Icon name="extension" size={15} />
                        확장 설치하기
                      </AccentBtn>
                    </>
                  )}
                </Section>
              </>}

              {/* ══ 데이터 ══════════════════════════════════════════ */}
              {/* ══ 메모 (사라지는 메모) ════════════════════════════ */}
              {tab === 'memo' && <>
                <Section>
                  <SectionLabel icon="schedule" text="새 메모 기본 수명" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                    새로 만드는 메모가 이 기간 뒤 휴지통으로 갑니다. 기존
                    메모와 핀 고정한 메모는 영향 없음.
                  </p>
                  <MemoTtlPicker
                    value={(form.memo ?? DEFAULT_MEMO_SETTINGS).defaultTtlDays}
                    onChange={(days) => setForm(f => ({
                      ...f,
                      memo: { ...(f.memo ?? DEFAULT_MEMO_SETTINGS), defaultTtlDays: days },
                    }))}
                  />
                </Section>

                <Section>
                  <SectionLabel icon="delete" text="휴지통" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                    만료된 메모는 휴지통에 보관됐다가, 아래 시간이 지나면
                    영구 삭제됩니다.
                  </p>
                  <MemoTrashRetentionPicker
                    value={(form.memo ?? DEFAULT_MEMO_SETTINGS).trashRetentionHours}
                    onChange={(h) => setForm(f => ({
                      ...f,
                      memo: { ...(f.memo ?? DEFAULT_MEMO_SETTINGS), trashRetentionHours: h },
                    }))}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <GhostBtn onClick={() => onOpenMemoTrash?.()}>
                      <Icon name="folder_open" size={14} />
                      휴지통 보기
                    </GhostBtn>
                    <GhostBtn onClick={() => {
                      if (!onEmptyMemoTrash) return;
                      const n = onEmptyMemoTrash();
                      setBackupStatus(n > 0 ? `${n}개 메모를 영구 삭제했어요` : '휴지통이 이미 비어있어요');
                      setTimeout(() => setBackupStatus(null), 4000);
                    }}>
                      <Icon name="delete_forever" size={14} />
                      비우기
                    </GhostBtn>
                  </div>
                </Section>

                <Section>
                  <SectionLabel icon="folder" text="메모 내보내기 폴더" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                    메모를 txt 파일로 내보낼 때 저장될 폴더입니다. 비워
                    두면 기본 폴더(<code style={{ fontSize: 10, opacity: 0.85 }}>%APPDATA%/nost/memos/</code>)에 저장됩니다.
                  </p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input
                      value={(form.memo ?? DEFAULT_MEMO_SETTINGS).exportFolder ?? ''}
                      placeholder="기본 폴더 사용"
                      onChange={e => setForm(f => ({
                        ...f,
                        memo: { ...(f.memo ?? DEFAULT_MEMO_SETTINGS), exportFolder: e.target.value || undefined },
                      }))}
                      style={{ flex: 1, fontSize: 11 }}
                    />
                    <GhostBtn
                      onClick={async () => {
                        const folder = await electronAPI.pickFolder();
                        if (folder) {
                          setForm(f => ({
                            ...f,
                            memo: { ...(f.memo ?? DEFAULT_MEMO_SETTINGS), exportFolder: folder },
                          }));
                        }
                      }}
                      style={{ width: 'auto', flexShrink: 0, padding: '7px 12px' }}
                    >
                      <Icon name="folder_open" size={14} />
                      찾기
                    </GhostBtn>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <GhostBtn onClick={() => electronAPI.openMemoFolder((form.memo ?? DEFAULT_MEMO_SETTINGS).exportFolder)}>
                      <Icon name="open_in_new" size={14} />
                      폴더 열기
                    </GhostBtn>
                  </div>
                </Section>

                <Section>
                  <SectionLabel icon="restart_alt" text="일괄 정리" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                    여행 다녀와서 한 번씩 쓰는 비상 버튼. 모든 활성 메모의
                    수명을 기본 일수만큼 다시 채웁니다 (핀, 휴지통 제외).
                  </p>
                  <GhostBtn onClick={() => {
                    if (!onExtendAllMemos) return;
                    const n = onExtendAllMemos();
                    setBackupStatus(n > 0 ? `${n}개 메모의 수명을 다시 채웠어요` : '활성 메모가 없어요');
                    setTimeout(() => setBackupStatus(null), 4000);
                  }}>
                    <Icon name="schedule" size={14} />
                    모든 메모 +수명
                  </GhostBtn>
                  {backupStatus && (
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>{backupStatus}</p>
                  )}
                </Section>
              </>}

              {tab === 'tutorial' && <>
                <Section>
                  <SectionLabel icon="school" text="튜토리얼" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                    퀘스트를 진행하며 nost를 익히세요. 완주할 때마다 무료 일수가 적립됩니다.
                  </p>
                  <AccordionPanel onStartQuest={(q) => {
                    // Hand off to TutorialProvider via the prop
                    // App threaded down. Closes settings so the
                    // ScanLoader → QuestRunner flow gets the screen.
                    onStartTutorial?.(q);
                    onClose();
                  }} />
                </Section>
              </>}

              {tab === 'data' && <>
                <Section>
                  <SectionLabel icon="system_update" text="앱 업데이트" />
                  {currentVersion && (
                    <p style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>현재 버전: v{currentVersion}</p>
                  )}
                  {updateDownloaded ? (
                    <AccentBtn onClick={() => electronAPI.installUpdate()} style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}>
                      <Icon name="restart_alt" size={15} />
                      {newVersion ? `v${newVersion} 설치 — 재시작` : '재시작 후 업데이트 설치'}
                    </AccentBtn>
                  ) : downloadProgress != null ? (
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                        <span>다운로드 중{newVersion ? ` v${newVersion}` : ''}...</span>
                        <span>{downloadProgress}%</span>
                      </div>
                      <div style={{ width: '100%', height: 4, background: 'var(--border-rgba)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${downloadProgress}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.4s ease' }} />
                      </div>
                    </div>
                  ) : (
                    <GhostBtn onClick={handleCheckUpdate} disabled={updateStatus === 'checking'}
                      style={{ opacity: updateStatus === 'checking' ? 0.6 : 1, width: '100%' }}>
                      <Icon name={updateStatus === 'up-to-date' ? 'check_circle' : updateStatus === 'error' ? 'error' : 'refresh'} size={15} />
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
                        <Icon name={btn.icon} size={15} />
                        {btn.label}
                      </GhostBtn>
                    ))}
                  </div>
                  {backupStatus && (
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>{backupStatus}</p>
                  )}
                </Section>

                <Section>
                  <SectionLabel icon="bug_report" text="진단 / 로그" />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <GhostBtn onClick={() => electronAPI.openLogsFolder()}>
                      <Icon name="folder_open" size={15} />
                      로그 폴더 열기
                    </GhostBtn>
                  </div>
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, textAlign: 'center' }}>
                    문제 발생 시 main.log를 공유해주세요.
                  </p>
                </Section>
              </>}

            </div>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        {/* The Save button now means "I've decided these stay" — no actual
            write happens here because every change has already streamed
            upstream via the live-preview reflector. The 취소 button
            triggers handleCloseAttempt, which presents the 3-button
            confirm modal IF (and only if) form differs from openTime
            snapshot. That gives modern UX (immediate preview) without
            losing the "rollback" safety net users expect.  */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
          padding: '12px 20px',
          borderTop: '1px solid var(--border-rgba)',
          flexShrink: 0,
        }}>
          {isDirty() && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)', marginRight: 'auto' }}>
              변경사항이 즉시 적용되고 있어요
            </span>
          )}
          <Button variant="ghost" onClick={handleCloseAttempt}>취소</Button>
          <Button onClick={() => {
            // Live writes already happened. Just notify the orb (it
            // refreshes on a different signal than `setOpacity`/etc.)
            // and close.
            electronAPI.notifyFloatingSettingsChanged();
            onClose();
          }}>저장</Button>
        </div>

        {/* ── Close-confirm modal ─────────────────────────────────
            Shown only when the user attempts to close (not Save) and
            the form differs from the open-time snapshot. Three
            actions match the OS-standard "save / discard / cancel"
            pattern — same one used by macOS System Settings, VSCode,
            Figma, etc.   */}
        {pendingClose && (
          <div
            // Backdrop. Opaque enough to focus attention on the modal
            // but not as dark as a hard system modal — settings is a
            // friendly surface, not a destructive operation gate.
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={confirmCancel}
          >
            <div
              role="dialog"
              aria-label="설정 저장 확인"
              onClick={e => e.stopPropagation()}
              style={{
                width: 'min(380px, 90%)',
                background: 'var(--surface)',
                border: '1px solid var(--border-rgba)',
                borderRadius: 14,
                padding: '20px 20px 16px',
                boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-color)', marginBottom: 8 }}>
                변경사항을 어떻게 할까요?
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 16 }}>
                지금까지의 변경은 이미 적용되어 있어요. 그대로 유지할까요,
                아니면 처음 상태로 되돌릴까요?
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={confirmCancel}>취소</Button>
                <Button variant="ghost" onClick={confirmDiscard}>적용 안 함</Button>
                <Button onClick={confirmKeep}>저장</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
