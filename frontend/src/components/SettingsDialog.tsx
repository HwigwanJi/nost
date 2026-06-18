import { useCallback, useEffect, useState, useRef } from 'react';
import type { AppSettings } from '../types';
import {
  MEMO_TTL_DAYS_MIN, MEMO_TTL_DAYS_MAX, DEFAULT_MEMO_SETTINGS,
} from '../types';
import { Icon } from '@/components/ui/Icon';
import { GoogleLogo, GitHubLogo } from '@/components/ui/BrandLogo';
import { electronAPI } from '../electronBridge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useAuth, signIn, signOut } from '../lib/auth';
import { useSyncState, syncFull, registerThisDevice } from '../lib/sync';
import { listDevices, deleteDevice, getDeviceIdentity, type DeviceRow } from '../lib/sync/device';
import { AccordionPanel } from '../tutorial';
import { ExtensionInstallWizard } from './ExtensionInstallWizard';
import { DEFAULT_DOCUMENT_EXTENSIONS } from '../lib/documentExtensions';
import type { TokenPreset } from '../types';
import { DEFAULT_DOC_COHORT_SETTINGS, DEFAULT_DOC_LABEL_ORDER } from '../types';
import { useBusyMark } from '../lib/userBusy';
import { TOURS } from '../tour/tours';

type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'dev-mode' | 'error';

// v1.3.34: settings reorg per Option C.
// 8 flat tabs collapsed into 4 semantic groups × 2-3 sub-tabs each.
// `general` is dropped — its sections fanned out into appearance / behavior
// / surfaces. `tutorial` consolidates the duplicated "다시 보기" surface
// that used to live both in its own tab and inside 일반.
// Legacy tab ids ('general', 'monitor') are still accepted in `initialTab`
// for back-compat with deep links — they remap on entry (see remapTab below).
type Tab =
  | 'account' | 'data'                                  // 나의 nost
  | 'appearance' | 'behavior' | 'surfaces'              // 작업 환경
  | 'memo' | 'docs'                                     // 콘텐츠 규칙
  | 'tutorial' | 'extension';                           // 도움

interface TabGroup {
  /** Sidebar header text — non-clickable. */
  label: string;
  tabs: { id: Tab; label: string; icon: string }[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    label: '나의 nost',
    tabs: [
      { id: 'account', label: '계정',   icon: 'account_circle' },
      { id: 'data',    label: '데이터', icon: 'save' },
    ],
  },
  {
    label: '작업 환경',
    tabs: [
      { id: 'appearance', label: '테마 및 색상',     icon: 'palette' },
      { id: 'behavior',   label: '동작',             icon: 'tune' },
      { id: 'surfaces',   label: '플로팅 및 모니터', icon: 'desktop_windows' },
    ],
  },
  {
    label: '콘텐츠 규칙',
    tabs: [
      { id: 'memo', label: '메모', icon: 'sticky_note_2' },
      { id: 'docs', label: '문서', icon: 'description' },
    ],
  },
  {
    label: '도움',
    tabs: [
      { id: 'tutorial',  label: '튜토리얼', icon: 'school' },
      { id: 'extension', label: '확장',     icon: 'extension' },
    ],
  },
];

// Back-compat mapping: deep links from earlier versions used 'general' and
// 'monitor'. Redirect to the natural new home so existing callers (orb
// right-click → settings, notification action payload, etc.) keep working
// without an update.
function remapLegacyTab(id: string | undefined): Tab {
  switch (id) {
    case 'general': return 'appearance';
    case 'monitor': return 'surfaces';
    case 'appearance':
    case 'behavior':
    case 'surfaces':
    case 'docs':
    case 'extension':
    case 'memo':
    case 'tutorial':
    case 'data':
    case 'account':
      return id;
    default:        return 'appearance';
  }
}

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
  /** Accepts both new (v1.3.34+) Tab ids and legacy 'general' / 'monitor'
   *  aliases — remapLegacyTab() funnels old ids to their new homes when
   *  the state is initialised. */
  initialTab?: Tab | 'general' | 'monitor';
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
  /** v1.3.49 — 메인 렌더러가 인증된 supabase 로 조회한 기기 목록 + sync
   *  상태. satellite 의 supabase 는 세션이 없어 직접 못 가져옴 → 메인이
   *  push. 이게 있으면 SyncDevicesSection 은 직접 supabase 호출 대신 이
   *  데이터로 렌더하고 mutation 은 settings-dialog action 으로 라우팅. */
  syncDevices?: SyncDevicesPushed | null;
}

export interface SyncDevicesPushed {
  devices: DeviceRow[];
  currentDeviceTag: string | null;
  lastSyncedAt: number | null;
  generation: number;
  errorMessage?: string | null;
}

// ── Settings design tokens (v1.3.34 polish) ─────────────────────────
//
// Centralised font + spacing scale so every tab/section/row reads with
// the same visual rhythm. shadcn-style hierarchy:
//   header   — section title (clickable, with chevron when collapsible)
//   primary  — main control text / row title
//   detail   — secondary description below the row title
//   meta     — captions, helper text under sliders, "Xpx" badges
//
// Resist inlining font-size literals elsewhere in this file — if a
// surface needs a one-off size, add a token here first.
const FS = {
  header:  13,   // SectionLabel header
  primary: 12,   // row titles, button labels
  body:    11,   // description / paragraph
  meta:    10,   // hint, "300px" caption
  micro:    9,   // tag chips, count badges
} as const;

// ── Section — accordion-style row (v1.3.34) ────────────────────────
//
// Replaces the old "rounded gray box per section" layout (the user
// flagged it as visually heavy). Now: a flat stack with hairline
// dividers and a clickable header that toggles a collapse panel.
// Same vibe as shadcn's `<Accordion>` but without the wrapper-per-tab
// boilerplate — callers stay simple, just `<Section title="..." icon="...">`.
//
// `defaultOpen` (default true) preserves discoverability — every
// setting is visible on tab entry; users can fold the noisy ones away
// without losing the affordance.
function Section({
  title, icon, children, defaultOpen = true, collapsible = true,
}: {
  title?: string;
  icon?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Some sections have no obvious title (e.g. single-row settings) — pass
   *  `collapsible={false}` to render content only, no header. */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasHeader = collapsible && !!title;
  return (
    <div style={{
      padding: '4px 0',
      borderBottom: '1px solid var(--border-rgba)',
    }}>
      {hasHeader && (
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '10px 4px',
            background: 'transparent',
            border: 'none', borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            color: 'var(--text-color)',
            transition: 'background 0.12s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {icon && <Icon name={icon} size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
          <span style={{ flex: 1, fontSize: FS.header, fontWeight: 600 }}>{title}</span>
          <Icon
            name="expand_more"
            size={16}
            color="var(--text-dim)"
            style={{
              flexShrink: 0,
              transition: 'transform 0.18s cubic-bezier(0.4,0,0.2,1)',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </button>
      )}
      <div
        style={{
          maxHeight: hasHeader && !open ? 0 : undefined,
          opacity: hasHeader && !open ? 0 : 1,
          overflow: hasHeader && !open ? 'hidden' : 'visible',
          padding: hasHeader ? (open ? '6px 4px 14px' : '0 4px') : '12px 4px',
          transition: 'max-height 0.22s ease, opacity 0.18s ease, padding 0.22s ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Legacy SectionLabel — still used by older sections that haven't been
// migrated to Section title+icon props. Renders as an inline header
// (no chevron) so the visual register matches the new collapsible
// header tokens. Once every call site moves to the prop form this can
// be deleted.
function SectionLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      <Icon name={icon} size={14} color="var(--text-muted)" />
      <span style={{ fontSize: FS.header, fontWeight: 600, color: 'var(--text-color)' }}>{text}</span>
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

function AccountTab({ syncDevices }: { syncDevices?: SyncDevicesPushed | null }) {
  const auth = useAuth();
  if (!auth.configured) {
    return (
      <Section>
        <SectionLabel icon="warning" text="Supabase 미설정" />
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          로그인을 사용하려면 <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, padding: '1px 4px', borderRadius: 3, background: 'var(--surface)' }}>frontend/.env</code>에
          {' '}<code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, padding: '1px 4px', borderRadius: 3, background: 'var(--surface)' }}>VITE_SUPABASE_URL</code>과
          {' '}<code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, padding: '1px 4px', borderRadius: 3, background: 'var(--surface)' }}>VITE_SUPABASE_ANON_KEY</code>를
          {' '}설정한 뒤 nost를 다시 시작해주세요.
        </p>
      </Section>
    );
  }
  if (auth.status === 'signed-in' && auth.user) {
    const u = auth.user;
    const name = (u.user_metadata?.full_name as string | undefined) ?? (u.user_metadata?.name as string | undefined) ?? u.email ?? '사용자';
    const avatar = (u.user_metadata?.avatar_url as string | undefined) ?? null;
    return (
      <>
        <Section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {avatar ? (
              <img src={avatar} alt="" referrerPolicy="no-referrer"
                style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--border-rgba)' }} />
            ) : (
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="person" size={22} color="var(--accent)" />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-color)' }}>{name}</div>
              {u.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</div>}
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                {(u.app_metadata?.provider as string | undefined) ?? 'oauth'} · 로그인됨
              </div>
            </div>
          </div>
        </Section>
        <SyncDevicesSection userId={u.id} pushed={syncDevices ?? null} />
        <Section>
          <SectionLabel icon="logout" text="로그아웃" />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              이 PC에서 로그아웃합니다. 로컬 카드·메모는 그대로 유지돼요.
            </p>
            <GhostBtn onClick={() => {
              // v1.3.48 — In the settings satellite the supabase instance
              // has no session (auth lives in the main renderer), so a
              // local signOut() does nothing. Route through main via the
              // existing satellite-action IPC; App.tsx calls the real
              // signOut() and the new state propagates back via
              // sync-auth-state. Inline render keeps the direct path.
              const sat = (window as { settingsDialog?: { action: (a: { kind: string }) => void } }).settingsDialog;
              if (sat) sat.action({ kind: 'signout' });
              else signOut();
            }}>로그아웃</GhostBtn>
          </div>
        </Section>
      </>
    );
  }
  // signed-out / authing / error
  const isAuthing = auth.status === 'authing';
  return (
    <>
      <Section>
        <SectionLabel icon="login" text="로그인" />
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 10 }}>
          로그인하면 다른 PC에서도 같은 카드와 메모를 이어서 쓸 수 있어요. (동기화는 다음 단계에 활성화)
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <AccentBtn onClick={() => signIn('google')} disabled={isAuthing} style={{ flex: 1 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: 3, background: '#fff', padding: 1 }}>
              <GoogleLogo size={12} />
            </span>
            Google로 계속
          </AccentBtn>
          <GhostBtn onClick={() => signIn('github')} disabled={isAuthing} style={{ flex: 1 }}>
            <GitHubLogo size={14} /> GitHub으로 계속
          </GhostBtn>
        </div>
        {isAuthing && (
          <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>
            브라우저에서 인증을 완료해주세요. nost는 잠시 후 자동으로 이어집니다.
          </p>
        )}
        {auth.errorMessage && (
          <p style={{ fontSize: 10, color: 'var(--destructive, #ef4444)', marginTop: 8, lineHeight: 1.5 }}>
            {auth.errorMessage}
          </p>
        )}
      </Section>
    </>
  );
}

function SyncDevicesSection({ userId, pushed }: { userId: string; pushed?: SyncDevicesPushed | null }) {
  const sync = useSyncState();
  // v1.3.49 — satellite 모드: pushed 가 있으면 메인이 인증된 supabase 로
  // 조회/등록/삭제하고 그 결과를 push. satellite 의 supabase 는 세션이
  // 없어 직접 못 함 (이전엔 "로그인 필요" / 빈 목록 버그). 모든 mutation 은
  // settings-dialog action 으로 라우팅. pushed 가 없으면 (inline/dev) 기존
  // 직접 호출 경로 유지.
  const satMode = !!pushed;
  const sat = (window as { settingsDialog?: { action: (a: unknown) => void } }).settingsDialog;

  const [localDevices, setLocalDevices] = useState<DeviceRow[] | null>(null);
  const [localTag, setLocalTag] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (satMode) { sat?.action({ kind: 'sync-refresh-devices' }); return; }
    const [rows, identity] = await Promise.all([
      listDevices(userId),
      getDeviceIdentity().catch(() => null),
    ]);
    setLocalDevices(rows);
    setLocalTag(identity?.deviceId ?? null);
  }, [satMode, sat, userId]);

  // satellite 모드 첫 mount 에 목록 1회 요청 (App 도 settings 열릴 때 push
  // 하지만, 이미 열려있는 채로 계정 탭 진입 시 보강).
  useEffect(() => { if (satMode) sat?.action({ kind: 'sync-refresh-devices' }); }, [satMode, sat]);
  useEffect(() => { if (!satMode) void refresh(); }, [satMode, refresh, sync.lastSyncedAt, sync.deviceRowId]);

  const onDelete = useCallback(async (rowId: string) => {
    if (satMode) { setBusyId(rowId); sat?.action({ kind: 'sync-delete-device', rowId }); return; }
    setBusyId(rowId);
    setLocalError(null);
    const r = await deleteDevice(rowId);
    setBusyId(null);
    if (!r.ok) { setLocalError(r.message ?? '삭제 실패'); return; }
    await refresh();
  }, [satMode, sat, refresh]);

  const onAddDevice = useCallback(async () => {
    if (satMode) { sat?.action({ kind: 'sync-register-device' }); return; }
    setLocalError(null);
    const r = await registerThisDevice();
    if (!r.ok) setLocalError(r.message ?? '등록 실패');
    await refresh();
  }, [satMode, sat, refresh]);

  const onSync = useCallback(async () => {
    setLocalError(null);
    if (satMode) { sat?.action({ kind: 'sync-preview' }); return; }
    const r = await syncFull();
    if (!r.ok && r.message && r.message !== 'conflict') setLocalError(r.message);
  }, [satMode, sat]);

  // 표시 데이터 — satellite 모드면 pushed, 아니면 local.
  const devices: DeviceRow[] | null = satMode ? (pushed!.devices ?? []) : localDevices;
  const currentTag = satMode ? pushed!.currentDeviceTag : localTag;
  const errorMsg = satMode ? (pushed!.errorMessage ?? null) : localError;
  const lastSyncedAt = satMode ? pushed!.lastSyncedAt : sync.lastSyncedAt;
  const generation = satMode ? pushed!.generation : sync.generation;

  const syncing = sync.phase === 'syncing';
  const ago = lastSyncedAt ? formatRelativeShort(Date.now() - lastSyncedAt) : null;
  const thisDeviceRegistered = (devices ?? []).some(d => d.deviceTag === currentTag);
  // satMode 에서 등록 직후 busyId 를 다음 push 가 도착하면 해제 (목록 갱신).
  useEffect(() => { if (satMode) setBusyId(null); }, [satMode, pushed]);

  return (
    <Section>
      <SectionLabel icon="cloud_sync" text="동기화" />
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <GhostBtn
          onClick={onAddDevice}
          disabled={syncing || thisDeviceRegistered}
          style={{ flex: 1 }}
          title={thisDeviceRegistered ? '이미 등록된 기기' : ''}
        >
          <Icon name="add_to_queue" size={14} />
          현재 기기 추가
        </GhostBtn>
        <AccentBtn onClick={onSync} disabled={syncing} style={{ flex: 1 }}>
          <Icon name={syncing ? 'sync' : 'cloud_sync'} size={14} />
          {syncing ? '동기화 중...' : '동기화하기'}
        </AccentBtn>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: 12 }}>
        {ago
          ? <>마지막 동기화 <strong style={{ color: 'var(--text-muted)' }}>{ago} 전</strong> · gen {generation}</>
          : '아직 동기화되지 않았어요. 누르면 서버에 없는 항목은 받아오고, 내 최신 상태를 올립니다.'}
      </div>

      {/* Device list */}
      {devices === null ? (
        <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.55 }}>불러오는 중...</p>
      ) : devices.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          등록된 기기가 없어요. <strong>현재 기기 추가</strong>를 눌러 이 PC 를 먼저 등록해주세요.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {devices.map(d => {
            const isCurrent = !!currentTag && d.deviceTag === currentTag;
            const displayName = (d.hostname || d.name.replace(/\s*\[[^\]]+\]\s*$/, '')) || '기기';
            const last = formatRelativeShort(Date.now() - new Date(d.lastSeenAt).getTime());
            const platLabel = d.platform === 'win32' ? 'Windows' : d.platform === 'darwin' ? 'macOS' : d.platform === 'linux' ? 'Linux' : (d.platform ?? 'PC');
            return (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                background: isCurrent ? 'var(--accent-dim)' : 'var(--bg-rgba)',
                border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border-rgba)'}`,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-color)' }}>
                    <Icon name={d.platform === 'darwin' ? 'laptop_mac' : d.platform === 'linux' ? 'computer' : 'desktop_windows'} size={14} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
                    {isCurrent && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--accent)' }}>이 PC</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                    {platLabel} · 마지막 활동 {last} 전
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { void onDelete(d.id); }}
                  disabled={busyId === d.id || syncing}
                  title="이 기기 해제"
                  style={{
                    flex: 'none',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, padding: 0,
                    borderRadius: 6,
                    background: 'transparent',
                    border: '1px solid var(--border-rgba)',
                    color: 'var(--text-muted)',
                    cursor: (busyId === d.id || syncing) ? 'default' : 'pointer',
                    opacity: (busyId === d.id || syncing) ? 0.4 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  <Icon name={busyId === d.id ? 'sync' : 'delete'} size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {(errorMsg || sync.errorMessage) && (
        <p style={{ fontSize: 10, color: 'var(--destructive, #ef4444)', marginTop: 8, lineHeight: 1.5, wordBreak: 'break-word' }}>
          {errorMsg ?? sync.errorMessage}
        </p>
      )}
    </Section>
  );
}


function formatRelativeShort(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5)   return '방금';
  if (s < 60)  return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}시간`;
  return `${Math.floor(h / 24)}일`;
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

// ── Doc cohort token rules widgets ─────────────────────────────────────
//
// Two small editors hosted by the 문서 tab:
//   - TokenPresetList   ON/OFF + drag-reorder for the 11 supported presets
//   - LabelOrderEditor  drag-reorder + add/remove for the label hierarchy
//                        (consumed by 'label' and 'label-rev' presets)
//
// Drag uses plain HTML5 DnD here (no @dnd-kit) because the row count is
// tiny and we don't share any drop-target semantics with the cards/spaces
// grid. Keeping it standalone avoids polluting the card DnD context.

const TOKEN_PRESET_META: Record<TokenPreset, { label: string; example: string }> = {
  numeric:            { label: '버전 번호',         example: '_v3' },
  semver:             { label: '세마버',           example: '1.2.3' },
  'date-yymmdd':      { label: '날짜 (YYMMDD)',    example: '240513' },
  'date-yyyymmdd':    { label: '날짜 (YYYYMMDD)',  example: '20240513' },
  'date-iso':         { label: '날짜 (ISO)',       example: '2024-05-13' },
  'date-dotted':      { label: '날짜 (점)',         example: '2024.05.13' },
  label:              { label: '라벨',              example: 'draft → final' },
  'date-yyyymmdd_re': { label: '날짜 + 개정',       example: '20260513_RE4' },
  'date-iso_v':       { label: '날짜 + 버전',       example: '2024-05-13_v2' },
  'semver-build':     { label: '세마버 + 빌드',     example: '1.2.3-build42' },
  'label-rev':        { label: '라벨 + 개정',       example: 'final_rev2' },
  mtime:              { label: '파일 수정 시각',    example: '(이름 토큰 없음)' },
};

const ALL_PRESETS: TokenPreset[] = [
  'date-yyyymmdd_re', 'date-iso_v', 'semver-build', 'label-rev',
  'semver', 'date-yyyymmdd', 'date-yymmdd', 'date-iso', 'date-dotted',
  'numeric', 'label',
  'mtime',
];

function TokenPresetList({ enabled, onChange }: {
  enabled: TokenPreset[];
  onChange: (next: TokenPreset[]) => void;
}) {
  // Render every preset in its current ordering: enabled ones first
  // (in their saved order), disabled ones below in canonical order.
  const enabledSet = new Set(enabled);
  const disabled = ALL_PRESETS.filter(p => !enabledSet.has(p));
  const dragIdxRef = useRef<number | null>(null);

  const toggle = (p: TokenPreset, on: boolean) => {
    if (on && !enabledSet.has(p)) onChange([...enabled, p]);
    else if (!on && enabledSet.has(p)) onChange(enabled.filter(x => x !== p));
  };

  const moveTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const next = enabled.slice();
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {enabled.map((preset, idx) => {
        const meta = TOKEN_PRESET_META[preset];
        return (
          <div
            key={preset}
            draggable
            onDragStart={() => { dragIdxRef.current = idx; }}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); if (dragIdxRef.current != null) moveTo(dragIdxRef.current, idx); dragIdxRef.current = null; }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 7,
              background: 'var(--bg-rgba)',
              border: '1px solid var(--border-rgba)',
              cursor: 'grab',
            }}
          >
            <Icon name="drag_indicator" size={13} color="var(--text-dim)" />
            <Switch checked={true} onCheckedChange={v => toggle(preset, v)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-color)' }}>{meta.label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', marginTop: 1 }}>{meta.example}</div>
            </div>
          </div>
        );
      })}
      {disabled.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border-rgba)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>비활성</div>
          {disabled.map(preset => {
            const meta = TOKEN_PRESET_META[preset];
            return (
              <div key={preset} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 10px', borderRadius: 7,
                opacity: 0.55,
              }}>
                <Icon name="drag_indicator" size={13} color="var(--text-dim)" style={{ visibility: 'hidden' }} />
                <Switch checked={false} onCheckedChange={v => toggle(preset, v)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', marginTop: 1 }}>{meta.example}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LabelOrderEditor({ order, onChange }: {
  order: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const dragIdxRef = useRef<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const next = order.slice();
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    onChange(next);
  };

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {order.map((label, idx) => (
          <div
            key={label}
            draggable
            onDragStart={() => { dragIdxRef.current = idx; }}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); if (dragIdxRef.current != null) move(dragIdxRef.current, idx); dragIdxRef.current = null; }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 8px',
              background: 'var(--surface)',
              border: '1px solid var(--border-rgba)',
              borderRadius: 99,
              fontSize: 11, fontFamily: 'monospace',
              color: 'var(--text-color)',
              cursor: 'grab',
            }}
          >
            <Icon name="drag_indicator" size={11} color="var(--text-dim)" />
            {label}
            <button
              onClick={() => onChange(order.filter(l => l !== label))}
              title={`${label} 제거`}
              style={{
                display: 'inline-flex', background: 'none', border: 'none',
                cursor: 'pointer', padding: 0, marginLeft: 2,
              }}
            >
              <Icon name="close" size={10} color="var(--text-dim)" />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const v = draft.trim();
              if (v && !order.includes(v)) onChange([...order, v]);
              setDraft('');
            }
          }}
          placeholder="라벨 추가 (예: hotfix, Enter)"
          style={{
            flex: 1, background: 'var(--bg-rgba)', border: '1px solid var(--border-rgba)',
            borderRadius: 7, padding: '5px 10px', fontSize: 11,
            color: 'var(--text-color)', fontFamily: 'monospace', outline: 'none',
          }}
        />
      </div>
    </>
  );
}

/**
 * ShortcutCapture — modern key-capture input for the global shortcut
 * setting. Click → "키 입력 대기…" mode → press any combo (modifiers +
 * key) → automatically captures and emits as an Electron accelerator
 * string ("Alt+Space", "Ctrl+Shift+F1"). Esc cancels, "지우기" clears
 * to empty (which disables the global shortcut on the main side).
 *
 * Replaces the old `<Input>` where users had to TYPE the accelerator
 * string by hand — error-prone and felt dated.
 */
function ShortcutCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  const [draftDisplay, setDraftDisplay] = useState<string | null>(null);

  // Display string for a current keydown event. Returns null when the
  // event is modifier-only (user is still pressing modifiers, hasn't
  // committed yet) so we can show "Ctrl+…" preview without finalising.
  const formatKey = (e: KeyboardEvent): { accel: string | null; preview: string } => {
    const parts: string[] = [];
    if (e.ctrlKey)  parts.push('Ctrl');
    if (e.altKey)   parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey)  parts.push('Meta');
    const key = e.key;
    // Modifier-only keystroke → no commit yet, show preview only.
    if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') {
      return { accel: null, preview: parts.join('+') + '+…' };
    }
    // Normalise the key name into an Electron accelerator token.
    let token: string;
    if (key === ' ') token = 'Space';
    else if (key.length === 1) token = key.toUpperCase();
    else token = key; // 'Enter', 'Tab', 'F1', 'ArrowUp', etc.
    const full = [...parts, token].join('+');
    return { accel: full, preview: full };
  };

  useEffect(() => {
    if (!capturing) return;
    // v1.3.46: pause the launcher's own global shortcut while we
    // capture — otherwise pressing the current binding (e.g. Alt+4)
    // OR a popular alternate (Alt+Space) just toggles the launcher
    // instead of getting recorded here. resume restores on commit
    // or cancel (cleanup runs on every capturing→false transition).
    electronAPI.pauseGlobalShortcut();
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(false);
        setDraftDisplay(null);
        return;
      }
      const { accel, preview } = formatKey(e);
      setDraftDisplay(preview);
      if (accel) {
        // Commit on the first non-modifier press.
        onChange(accel);
        setCapturing(false);
        setDraftDisplay(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      electronAPI.resumeGlobalShortcut();
    };
  }, [capturing, onChange]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        onClick={() => { setCapturing(true); setDraftDisplay(null); }}
        onBlur={() => { setCapturing(false); setDraftDisplay(null); }}
        style={{
          flex: 1,
          textAlign: 'left',
          padding: '8px 12px',
          borderRadius: 7,
          border: `1px solid ${capturing ? 'var(--accent)' : 'var(--border-rgba)'}`,
          background: 'var(--surface)',
          color: capturing && !draftDisplay ? 'var(--text-muted)' : 'var(--text-color)',
          fontFamily: 'monospace',
          fontSize: 12,
          cursor: 'pointer',
          fontStyle: capturing && !draftDisplay ? 'italic' : 'normal',
          transition: 'border-color 120ms ease',
        }}
      >
        {capturing
          ? (draftDisplay ?? '키 입력 대기… (Esc 로 취소)')
          : (value || '(설정 안 됨)')}
      </button>
      {value && !capturing && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="단축키 지우기"
          style={{
            padding: '7px 10px',
            borderRadius: 7,
            border: '1px solid var(--border-rgba)',
            background: 'var(--surface)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'inherit',
          }}
        >
          지우기
        </button>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function SettingsDialog({ open, onClose, settings, onSave, updateDownloaded, downloadProgress, initialTab, onStartTutorial, onOpenMemoTrash, onEmptyMemoTrash, syncDevices }: SettingsDialogProps) {
  // onExtendAllMemos was destructured for the "모든 메모 +수명" button
  // in the now-removed 일괄정리 section. Prop stays in the interface for
  // back-compat but is no longer consumed here.
  useBusyMark('modal:settings', open);
  // initialTab may carry legacy values ('general', 'monitor') from older
  // call sites (notification action payloads, deep links). remapLegacyTab
  // funnels them to the right new home transparently.
  const [tab, setTab] = useState<Tab>(remapLegacyTab(initialTab));
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
      setTab(remapLegacyTab(initialTab));
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
      // v1.3.45: main writes the imported tree to electron-store and
      // fires 'app-data-reloaded' which the main renderer listens to —
      // reloadFromStore picks it up + applies migrateData so legacy
      // backups also land without a restart.
      setBackupStatus('복원 완료');
      setTimeout(() => { setBackupStatus(null); onClose(); }, 1800);
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

          {/* Left sidebar nav — grouped (v1.3.34, Option C).
              Each TAB_GROUPS entry renders a small non-clickable header
              followed by indented tab buttons. Width grew 148 → 168 to
              fit "나의 nost" / "콘텐츠 규칙" group labels without ellipsis. */}
          <nav style={{
            width: 168,
            flexShrink: 0,
            borderRight: '1px solid var(--border-rgba)',
            padding: '10px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            overflowY: 'auto',
          }}>
            {TAB_GROUPS.map((group, gIdx) => (
              <div key={group.label} style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: gIdx === 0 ? 0 : 10 }}>
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  padding: '4px 10px 6px',
                  userSelect: 'none',
                }}>
                  {group.label}
                </div>
                {group.tabs.map(t => {
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 10px 7px 14px',
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
                      <Icon name={t.icon} size={15} style={{ flexShrink: 0 }} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Right content panel */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', scrollbarWidth: 'none' } as React.CSSProperties}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* ══ 계정 ═══════════════════════════════════════════ */}
              {tab === 'account' && (
                <AccountTab syncDevices={syncDevices} />
              )}

              {/* ══ 화면 (Appearance) ════════════════════════════════ */}
              {tab === 'appearance' && <>
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

              {/* ══ 동작 (Behavior) ══════════════════════════════════ */}
              {/* 창 크기 섹션은 status bar 우측 슬라이더 + `/N`
                  슬래시 명령에서 이미 노출되므로 설정에서 제거.
                  설정값(settings.windowSizePct)은 그대로 유지 —
                  삭제한 건 UI surface일 뿐. */}
              {tab === 'behavior' && <>
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
                  <SectionLabel icon="open_with" text="창이 뜨는 위치" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -2, marginBottom: 8, lineHeight: 1.45 }}>
                    단축키 / 트레이 / 플로팅 버튼으로 창을 띄울 때 어디에 나타날지 결정합니다.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {([
                      { value: 'cursor', icon: 'my_location', title: '마우스 위치',  desc: '커서가 있는 모니터의 가운데에 나타납니다.' },
                      { value: 'last',   icon: 'restart_alt',  title: '최근 위치',  desc: '마지막에 닫은 위치 그대로 다시 나타납니다.' },
                    ] as const).map(opt => {
                      const active = (form.windowOpenAt ?? 'last') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => f('windowOpenAt', opt.value)}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '10px 12px',
                            background: active ? 'var(--accent-dim)' : 'var(--surface)',
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--border-rgba)'}`,
                            borderRadius: 8,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            textAlign: 'left',
                            color: 'var(--text-color)',
                            transition: 'background 0.12s, border-color 0.12s',
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 14, height: 14, borderRadius: '50%',
                              border: `2px solid ${active ? 'var(--accent)' : 'var(--border-focus)'}`,
                              background: 'transparent',
                              flexShrink: 0,
                              marginTop: 2,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {active && (
                              <span style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: 'var(--accent)',
                              }} />
                            )}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Icon name={opt.icon} size={14} color={active ? 'var(--accent)' : 'var(--text-muted)'} />
                              <span style={{ fontSize: 12, fontWeight: 600 }}>{opt.title}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>{opt.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Section>

                <Section>
                  <SectionLabel icon="ads_click" text="카드 액션 제스처" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -2, marginBottom: 8, lineHeight: 1.45 }}>
                    카드의 4방향 액션(수정·모니터·새창·복사)을 여는 방법입니다. 꾹 누르기는 어떤 설정이든 항상 함께 동작해요.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {([
                      { value: 'ctrl-click',   icon: 'ads_click',     title: 'Ctrl + 클릭',  desc: 'Ctrl(⌘)을 누른 채 카드를 클릭합니다. 일반 클릭(실행)은 그대로 즉시 동작.' },
                      { value: 'double-click', icon: 'touch_app',     title: '더블클릭',     desc: '카드를 빠르게 두 번 클릭합니다. 단, 일반 클릭(실행)이 약 0.2초 늦게 반응해요.' },
                      { value: 'hold',         icon: 'back_hand',     title: '꾹 누르기만',  desc: '길게 누르기만 사용합니다 (Ctrl·더블클릭 비활성).' },
                    ] as const).map(opt => {
                      const active = (form.cardActionGesture ?? 'ctrl-click') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => f('cardActionGesture', opt.value)}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '10px 12px',
                            background: active ? 'var(--accent-dim)' : 'var(--surface)',
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--border-rgba)'}`,
                            borderRadius: 8,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            textAlign: 'left',
                            color: 'var(--text-color)',
                            transition: 'background 0.12s, border-color 0.12s',
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 14, height: 14, borderRadius: '50%',
                              border: `2px solid ${active ? 'var(--accent)' : 'var(--border-focus)'}`,
                              background: 'transparent', flexShrink: 0, marginTop: 2,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            {active && (
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
                            )}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Icon name={opt.icon} size={14} color={active ? 'var(--accent)' : 'var(--text-muted)'} />
                              <span style={{ fontSize: 12, fontWeight: 600 }}>{opt.title}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>{opt.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Section>

                <Section>
                  <SectionLabel icon="keyboard" text="전역 단축키" />
                  <ShortcutCapture value={form.shortcut} onChange={v => f('shortcut', v)} />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
                    클릭한 뒤 원하는 단축키를 누르면 자동으로 입력됩니다.
                  </p>
                </Section>
              </>}

              {/* ══ 표면 (Surfaces) ══════════════════════════════════ */}
              {/* Floating button + badges (own BrowserWindows) and the
                  monitor identification widget all share the "external
                  visual surfaces" mental model. Old separate '모니터' tab
                  is collapsed here as of v1.3.34. */}
              {tab === 'surfaces' && <>
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

                {/* ── Monitor identification widget — same group ('surfaces') as
                       floating button + badges. Old separate '모니터' tab is gone
                       (v1.3.34); contents stay identical, just nested here. */}
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

                {/* ── 문서 코호트 — 토큰 규칙 (v1.3.34+) ─────────────────
                    같은 파일의 다른 버전을 어떻게 비교할지 정의한다. 카드
                    우클릭의 "최신 버전 확인"이 이 규칙으로 디렉터리를 스캔
                    + 매칭 + 정렬한다. SSOT: rules are *global*, per-card
                    binding (LauncherItem.docCohort) only stores which preset
                    a card chose at detection time. */}
                <Section>
                  <SectionLabel icon="schedule" text="문서 코호트 — 토큰 규칙" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
                    같은 파일의 다른 버전을 어떻게 인식할지 정의합니다. 카드 우클릭의
                    "최신 버전 확인"이 이 규칙을 따라 디렉터리를 스캔합니다.
                    위에서부터 순서대로 시도하므로, 복합 토큰을 먼저 두면 단순 숫자보다 우선합니다.
                  </p>

                  {/* Preset list — toggle on/off + drag-reorder. */}
                  <TokenPresetList
                    enabled={form.docCohort?.enabledPresets ?? DEFAULT_DOC_COHORT_SETTINGS.enabledPresets}
                    onChange={(next) => f('docCohort', {
                      enabledPresets: next,
                      labelOrder: form.docCohort?.labelOrder ?? [...DEFAULT_DOC_LABEL_ORDER],
                    })}
                  />

                  {/* Label hierarchy editor — used by 'label' and 'label-rev'
                      presets. Older labels on the left, newer on the right. */}
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-rgba)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      라벨 우선순위 <span style={{ color: 'var(--text-dim)' }}>(왼쪽 → 오른쪽: 오래된 → 최신)</span>
                    </div>
                    <LabelOrderEditor
                      order={form.docCohort?.labelOrder ?? [...DEFAULT_DOC_LABEL_ORDER]}
                      onChange={(next) => f('docCohort', {
                        enabledPresets: form.docCohort?.enabledPresets ?? DEFAULT_DOC_COHORT_SETTINGS.enabledPresets,
                        labelOrder: next,
                      })}
                    />
                  </div>

                  <button
                    onClick={() => f('docCohort', { ...DEFAULT_DOC_COHORT_SETTINGS, labelOrder: [...DEFAULT_DOC_LABEL_ORDER] })}
                    style={{
                      marginTop: 12,
                      padding: '6px 10px', background: 'var(--bg-rgba)',
                      border: '1px solid var(--border-rgba)', borderRadius: 7,
                      color: 'var(--text-dim)', fontSize: 11,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    기본값으로 초기화
                  </button>
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
                        {extStatus === 'connected' ? '탭 스캔 및 타일 분할 사용 가능' : extStatus === 'disconnected' ? 'Chrome 확장이 필요합니다 (Whale 사용자도 동일)' : ''}
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

                {/* "일괄 정리" 섹션 (모든 메모 +수명) 제거 — 사용 빈도
                    낮고 유지보수 가치 없다는 사용자 피드백. onExtendAllMemos
                    prop 은 satellite stub (return 0) 와 호환 위해 유지. */}
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

                {/* ── Tutorials replay (moved from 일반 tab, v1.3.34) ──
                   Re-run any of the spotlight tours from the start. We close
                   the dialog first and defer the dispatch by a tick so the
                   modal's busy mark clears before TourOverlay's listener
                   evaluates `whenIdle` — otherwise the tour would queue
                   itself behind our own settings dialog. */}
                <Section>
                  <SectionLabel icon="play_circle" text="다시 보기" />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                    각 기능별 안내 투어를 다시 볼 수 있어요.
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
                // var(--surface) 는 3% 불투명 (라이트 모드) 이라
                // 본문 글자가 비쳐 보이던 문제 — 솔리드한 var(--bg-rgba)
                // (95%) 로 변경. backdrop blur 위에 올라가니 살짝
                // 투명해도 OK 지만 글씨 가독성이 우선.
                background: 'var(--bg-rgba)',
                border: '1px solid var(--border-focus)',
                borderRadius: 14,
                padding: '20px 20px 16px',
                boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
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
