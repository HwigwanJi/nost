import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@/components/ui/Icon';
import { NostLogo } from '@/components/ui/NostLogo';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { electronAPI } from '../electronBridge';
import { useBusyMark } from '../lib/userBusy';
import { fetchFaviconDataUrl } from '../hooks/useFavicon';
import type { LauncherItem, Space } from '../types';
import {
  detectClipboardType,
  suggestName,
  getDocumentExtensions,
} from '../lib/documentExtensions';

// ── Types ─────────────────────────────────────────────────────────

type ItemType = 'url' | 'app' | 'folder' | 'doc' | 'text' | 'cmd';

type WizardMode = 'quick' | 'manual'; // quick = clipboard auto, manual = user picks

type Phase =
  | { kind: 'detecting' }                          // quick: reading clipboard
  | { kind: 'empty' }                              // quick: clipboard empty
  | { kind: 'quick-confirm'; type: ItemType; value: string; sugName: string } // quick: confirm
  | { kind: 'pick-type' }                          // manual: choose type
  | { kind: 'detail'; type: ItemType }             // manual: enter value
  | { kind: 'name'; type: ItemType; value: string; iconUrl?: string } // both: confirm name
  | { kind: 'done' };

interface ItemWizardProps {
  open: boolean;
  mode: WizardMode;
  spaces: Space[];
  defaultSpaceId: string;
  docExtensions?: string[];
  onClose: () => void;
  onSave: (spaceId: string, item: Omit<LauncherItem, 'id'>) => void;
  /**
   * Memo save path — same destination as the top inline gateway banner's
   * "메모로" button. Mirrors the SSOT decision (v1.3.34): when clipboard
   * is plain text, the user gets TWO commit choices everywhere — card
   * (this wizard's normal save) or memo (via this callback).
   * Optional so older call sites that don't yet route memos through
   * the wizard keep compiling.
   */
  onSaveAsMemo?: (spaceId: string, body: string) => void;
}

// ── Icon map per type ─────────────────────────────────────────────

const TYPE_META: Record<ItemType, { icon: string; label: string; color: string }> = {
  url:    { icon: 'language',   label: '웹사이트 / URL',    color: '#3b82f6' },
  app:    { icon: 'apps',       label: '프로그램 (.exe)',   color: '#8b5cf6' },
  folder: { icon: 'folder_open',label: '폴더',              color: '#f59e0b' },
  doc:    { icon: 'description',label: '문서',              color: '#10b981' },
  text:   { icon: 'content_paste', label: '클립보드 텍스트', color: '#6366f1' },
  cmd:    { icon: 'terminal',   label: '명령어 실행',       color: '#64748b' },
};

// ── Small helpers ─────────────────────────────────────────────────

function TypeChip({ type, small }: { type: ItemType; small?: boolean }) {
  const m = TYPE_META[type];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: small ? '2px 7px' : '3px 10px',
        borderRadius: 99,
        background: `${m.color}18`,
        border: `1px solid ${m.color}33`,
        fontSize: small ? 10 : 11,
        fontWeight: 600,
        color: m.color,
      }}
    >
      <Icon name={m.icon} size={small ? 12 : 13} />
      {m.label}
    </span>
  );
}

function WizardBtn({
  icon, label, onClick, primary = false, disabled = false, loading = false,
}: {
  icon: string; label: string; onClick: () => void;
  primary?: boolean; disabled?: boolean; loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '9px 18px',
        borderRadius: 9,
        border: primary ? 'none' : '1px solid var(--border-rgba)',
        background: primary ? 'var(--accent)' : 'transparent',
        color: primary ? '#fff' : 'var(--text-muted)',
        fontSize: 12,
        fontWeight: primary ? 700 : 500,
        cursor: disabled || loading ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
        transition: 'opacity 0.15s',
      }}
    >
      <Icon name={loading ? 'sync' : icon} size={15} className={loading ? 'animate-spin' : undefined} />
      {label}
    </button>
  );
}

const MAT_ICONS_MINI = [
  'star','home','settings','language','public','apps','code','terminal',
  'folder_open','description','email','chat','music_note','image','calendar_today',
  'person','link','bookmark','favorite','rocket_launch','lightbulb',
  'shopping_cart','analytics','database','cloud','security','translate',
  'phone','videocam','mic','print','science','school','work','launch',
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
      {children}
    </div>
  );
}

function TextInput({
  value, onChange, placeholder, mono = false, readOnly = false,
}: {
  value: string; onChange?: (v: string) => void; placeholder?: string; mono?: boolean; readOnly?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      style={{
        width: '100%',
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--border-rgba)',
        background: 'var(--surface)',
        color: readOnly ? 'var(--text-muted)' : 'var(--text-color)',
        fontSize: 12,
        fontFamily: mono ? 'monospace' : 'inherit',
        outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}

// ── Main Component ────────────────────────────────────────────────

export function ItemWizard({ open, mode, spaces, defaultSpaceId, docExtensions, onClose, onSave, onSaveAsMemo }: ItemWizardProps) {
  useBusyMark('modal:item-wizard', open);
  const [phase, setPhase] = useState<Phase>({ kind: 'detecting' });
  const [selectedSpaceId, setSelectedSpaceId] = useState(defaultSpaceId);
  const [detailValue, setDetailValue] = useState('');
  const [nameValue, setNameValue] = useState('');
  const [iconUrl, setIconUrl] = useState<string | undefined>();
  const [iconKind, setIconKind] = useState<'image' | 'material'>('image');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [iconSearch, setIconSearch] = useState('');
  // v1.3.34: text type gets TWO destinations (card or memo). The
  // segmented control at the top of the quick-confirm view toggles which
  // commit path runs. Default = card (legacy behaviour); user can flip
  // to memo for prose-y pastes. Other types only have one destination
  // so the toggle is hidden.
  const [destinationTab, setDestinationTab] = useState<'card' | 'memo'>('card');

  const exts = getDocumentExtensions(docExtensions);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setSelectedSpaceId(defaultSpaceId);
    setDetailValue('');
    setNameValue('');
    setIconUrl(undefined);
    setIconKind('image');
    setShowIconPicker(false);
    setIconSearch('');
    setDestinationTab('card');

    if (mode === 'quick') {
      setPhase({ kind: 'detecting' });
      electronAPI.readClipboard().then(text => {
        const t = text?.trim() ?? '';
        if (!t) {
          setPhase({ kind: 'empty' });
          return;
        }
        const detectedRaw = detectClipboardType(t, exts);
        // ItemWizard intentionally skips image type — the clipboard
        // gateway banner / ItemDialog 유형 picker is the canonical
        // entry for image cards (manual path-typing in the wizard
        // makes no sense for binary blobs). Treat detected==='image'
        // as "no auto-detect" → user proceeds via manual path.
        const detected = detectedRaw === 'image' ? null : detectedRaw;
        if (!detected) {
          setPhase({ kind: 'empty' });
          return;
        }
        setPhase({ kind: 'quick-confirm', type: detected, value: t, sugName: suggestName(detected, t) });
      });
    } else {
      setPhase({ kind: 'pick-type' });
    }
  }, [open, mode, defaultSpaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch icon when entering quick-confirm
  useEffect(() => {
    if (!open || phase.kind !== 'quick-confirm') return;
    const { type, value } = phase;
    let cancelled = false;

    if (type === 'url') {
      (async () => {
        // Main-process fetch: bypasses renderer CSP and rejects 1×1
        // placeholders so we don't end up saving a blank icon. Returns
        // a self-contained data URL — no follow-up network calls when
        // the card is rendered later.
        const dataUrl = await fetchFaviconDataUrl(value);
        if (cancelled || !dataUrl) return;
        setIconUrl(dataUrl);
        setIconKind('image');
      })();
    } else if (type === 'app' || type === 'doc') {
      electronAPI.getFileIcon(value).then(ico => {
        if (!cancelled && ico) { setIconUrl(ico); setIconKind('image'); }
      });
    }

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase.kind]);

  const goToName = useCallback((type: ItemType, value: string, preIconUrl?: string) => {
    setNameValue(suggestName(type, value));
    setIconUrl(preIconUrl);
    setPhase({ kind: 'name', type, value, iconUrl: preIconUrl });
  }, []);

  const handleSave = useCallback((type: ItemType, value: string, name: string) => {
    const spaceId = selectedSpaceId || spaces[0]?.id;
    if (!spaceId || !name.trim() || !value.trim()) return;

    // v1.3.34: 'doc' is now a first-class LauncherItem.type, no remap.
    // Previously we collapsed doc → app at save time, which made the
    // cohort feature unable to distinguish "이 카드는 문서다" from
    // "이 카드는 앱이다" at storage level.
    const item: Omit<LauncherItem, 'id'> = {
      title: name.trim(),
      type: type as LauncherItem['type'],
      value: value.trim(),
      clickCount: 0,
      pinned: false,
      ...(iconUrl ? { icon: iconUrl, iconType: iconKind } : {}),
    };
    onSave(spaceId, item);
    // "X 추가됨" toast moved to App.tsx's save-action listener —
    // satellite renderer has no <Toaster> mount so sonner here would
    // have been invisible. App's Toaster shows it.
    onClose();
  }, [selectedSpaceId, spaces, iconUrl, onSave, onClose]);

  // ── Space selector row ──────────────────────────────────────────
  const selectedSpace = spaces.find(s => s.id === selectedSpaceId);
  const spaceSelector = spaces.length > 1 ? (
    <div style={{ marginBottom: 14 }}>
      <FieldLabel>스페이스</FieldLabel>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-rgba)',
            background: 'var(--surface)',
            color: 'var(--text-color)',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {selectedSpace?.icon && <span style={{ fontSize: 13 }}>{selectedSpace.icon}</span>}
            {selectedSpace?.color && !selectedSpace?.icon && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: selectedSpace.color, display: 'inline-block', flexShrink: 0 }} />
            )}
            {selectedSpace?.name ?? '스페이스 선택'}
          </span>
          <Icon name="expand_more" size={14} color="var(--text-dim)" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" style={{ minWidth: 200 }}>
          {spaces.map(s => (
            <DropdownMenuItem
              key={s.id}
              onClick={() => setSelectedSpaceId(s.id)}
              style={{ fontWeight: s.id === selectedSpaceId ? 700 : 400 }}
            >
              {s.icon && <span style={{ fontSize: 13 }}>{s.icon}</span>}
              {s.color && !s.icon && <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0 }} />}
              {s.name}
              {s.id === selectedSpaceId && <Icon name="check" size={13} style={{ marginLeft: 'auto' }} color="var(--accent)" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null;

  // ── Render phases ──────────────────────────────────────────────

  // detecting
  if (phase.kind === 'detecting') {
    return (
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent style={{ width: 400, padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Icon name="sync" size={32} color="var(--accent)" className="animate-spin" />
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>클립보드 읽는 중...</p>
        </DialogContent>
      </Dialog>
    );
  }

  // empty clipboard
  if (phase.kind === 'empty') {
    return (
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent style={{ width: 400, padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="content_paste_off" size={24} color="var(--text-dim)" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-color)' }}>클립보드가 비어있습니다</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              URL, 파일 경로, 텍스트를 복사한 후 다시 시도해보세요.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <WizardBtn icon="close" label="닫기" onClick={onClose} />
            <WizardBtn icon="edit" label="직접 입력" onClick={() => setPhase({ kind: 'pick-type' })} primary />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // quick-confirm
  if (phase.kind === 'quick-confirm') {
    const { type, value, sugName } = phase;
    const m = TYPE_META[type];
    const filteredIcons = iconSearch.trim()
      ? MAT_ICONS_MINI.filter(i => i.includes(iconSearch.toLowerCase()))
      : MAT_ICONS_MINI;
    // Text type only — segmented destination toggle (v1.3.34).
    const showDestinationTabs = type === 'text' && !!onSaveAsMemo;
    const isMemo = showDestinationTabs && destinationTab === 'memo';

    return (
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent style={{ width: 440, padding: 0, overflow: 'hidden' }}>
          <DialogHeader style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-rgba)' }}>
            <DialogTitle style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <NostLogo size={16} color="var(--accent)" />
              빠른 추가
            </DialogTitle>
          </DialogHeader>

          {/* Segmented destination tabs — shown only when the source has
              multiple commit targets. Today that's text only (card vs
              memo). Visual register matches shadcn segmented control:
              flat bg tray + active pill with subtle shadow. */}
          {showDestinationTabs && (
            <div style={{ padding: '12px 20px 0' }}>
              <div
                role="tablist"
                style={{
                  display: 'flex',
                  padding: 3,
                  background: 'var(--border-rgba)',
                  borderRadius: 9,
                  gap: 2,
                }}
              >
                {([
                  { id: 'card', label: '클립보드 카드', icon: 'content_paste' },
                  { id: 'memo', label: '메모', icon: 'sticky_note_2' },
                ] as const).map(t => {
                  const active = destinationTab === t.id;
                  return (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setDestinationTab(t.id)}
                      style={{
                        flex: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        padding: '6px 10px',
                        borderRadius: 7,
                        border: 'none',
                        background: active ? 'var(--bg-rgba)' : 'transparent',
                        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                        color: active ? 'var(--text-color)' : 'var(--text-muted)',
                        fontSize: 11,
                        fontWeight: active ? 700 : 500,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'all 0.15s',
                      }}
                    >
                      <Icon name={t.icon} size={13} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {spaceSelector}

            {/* Detected preview — same shape for both tabs; the icon
                button is hidden in memo mode since memos render from
                their body, not from a per-card icon. */}
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>
                  {isMemo ? '메모 본문' : '감지됨'}
                </span>
                <TypeChip type={type} small />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {!isMemo && (
                  <button
                    onClick={() => setShowIconPicker(p => !p)}
                    title="아이콘 클릭하여 변경"
                    style={{ width: 42, height: 42, borderRadius: 10, background: `${m.color}14`, border: `1.5px solid ${showIconPicker ? m.color : `${m.color}33`}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', transition: 'border-color 0.15s' }}
                  >
                    {iconUrl && iconKind === 'image'
                      ? <img src={iconUrl} alt="" style={{ width: 26, height: 26, objectFit: 'contain', borderRadius: 4 }} onError={() => { setIconUrl(undefined); setIconKind('image'); }} />
                      : <Icon name={iconKind === 'material' && iconUrl ? iconUrl : m.icon} size={22} color={m.color} />
                    }
                  </button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-color)',
                      fontFamily: 'monospace',
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: isMemo ? 4 : 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                    }}
                  >
                    {isMemo
                      ? value
                      : value.length > 80 ? `${value.slice(0, 78)}…` : value}
                  </span>
                  {!isMemo && (
                    <button onClick={() => setShowIconPicker(p => !p)} style={{ fontSize: 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, marginTop: 3 }}>
                      {showIconPicker ? '아이콘 닫기' : '아이콘 변경'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Icon picker — hidden in memo mode (memo body's first line
                is the title; no per-card icon). */}
            {!isMemo && showIconPicker && (
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  value={iconSearch}
                  onChange={e => setIconSearch(e.target.value)}
                  placeholder="아이콘 검색 (예: folder, chart...)"
                  style={{ width: '100%', padding: '5px 8px', fontSize: 11, background: 'var(--bg-rgba)', border: '1px solid var(--border-rgba)', borderRadius: 6, color: 'var(--text-color)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {filteredIcons.map(ico => (
                    <button
                      key={ico}
                      title={ico}
                      onClick={() => { setIconUrl(ico); setIconKind('material'); setShowIconPicker(false); }}
                      style={{ width: 30, height: 30, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: `1px solid ${iconKind === 'material' && iconUrl === ico ? 'var(--accent)' : 'var(--border-rgba)'}`, background: iconKind === 'material' && iconUrl === ico ? 'var(--accent-dim)' : 'transparent' }}
                    >
                      <Icon name={ico} size={16} color={iconKind === 'material' && iconUrl === ico ? 'var(--accent)' : 'var(--text-muted)'} />
                    </button>
                  ))}
                </div>
                {iconUrl && iconKind === 'image' && (
                  <button onClick={() => { setIconUrl(undefined); setIconKind('image'); }} style={{ fontSize: 10, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, textAlign: 'left' }}>
                    자동 아이콘으로 되돌리기
                  </button>
                )}
              </div>
            )}

            {/* Name field — card mode only. Memos take the first
                non-empty line of their body as the title. */}
            {!isMemo && (
              <div>
                <FieldLabel>이름</FieldLabel>
                <TextInput
                  value={sugName}
                  onChange={next => setPhase({ ...phase, sugName: next })}
                  placeholder="표시될 이름"
                />
              </div>
            )}

            {/* Single action row — destination is selected at the top.
                The "추가" button's icon + label adapt to the active tab. */}
            <div style={{ display: 'flex', gap: 8 }}>
              <WizardBtn icon="arrow_back" label="취소" onClick={onClose} />
              <WizardBtn
                icon={isMemo ? 'sticky_note_2' : 'add_circle'}
                label={isMemo ? '메모 추가' : '추가'}
                primary
                disabled={isMemo ? !value.trim() : !sugName.trim()}
                onClick={() => {
                  if (isMemo) {
                    const spaceId = selectedSpaceId || spaces[0]?.id;
                    if (!spaceId) return;
                    onSaveAsMemo?.(spaceId, value);
                    onClose();
                  } else {
                    handleSave(type, value, sugName);
                  }
                }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // pick-type (manual)
  if (phase.kind === 'pick-type') {
    const types: ItemType[] = ['url', 'app', 'folder', 'doc', 'text', 'cmd'];
    return (
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent style={{ width: 420, padding: 0, overflow: 'hidden' }}>
          <DialogHeader style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-rgba)' }}>
            <DialogTitle style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="add_circle" size={16} color="var(--accent)" />
              직접 입력 — 유형 선택
            </DialogTitle>
          </DialogHeader>
          <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {spaceSelector}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {types.map(t => {
                const m = TYPE_META[t];
                return (
                  <button
                    key={t}
                    onClick={() => { setDetailValue(''); setPhase({ kind: 'detail', type: t }); }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 6, padding: '14px 8px',
                      borderRadius: 10, border: '1px solid var(--border-rgba)',
                      background: 'var(--surface)', cursor: 'pointer',
                      fontFamily: 'inherit', transition: 'background 0.12s, border-color 0.12s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = `${m.color}12`;
                      (e.currentTarget as HTMLButtonElement).style.borderColor = `${m.color}44`;
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-rgba)';
                    }}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${m.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={m.icon} size={20} color={m.color} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-color)', fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>{m.label}</span>
                  </button>
                );
              })}
            </div>
            <WizardBtn icon="close" label="취소" onClick={onClose} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // detail (manual: enter value)
  if (phase.kind === 'detail') {
    const { type } = phase;
    const m = TYPE_META[type];

    const canBrowse = type === 'app' || type === 'folder' || type === 'doc';
    const placeholder =
      type === 'url'    ? 'https://example.com' :
      type === 'app'    ? 'C:\\Program Files\\...\\app.exe' :
      type === 'folder' ? 'C:\\Users\\...' :
      type === 'doc'    ? 'C:\\Users\\...\\document.pdf' :
      type === 'cmd'    ? 'notepad.exe' :
      '클립보드에 복사할 텍스트';

    const handleBrowse = async () => {
      const result = type === 'folder'
        ? await electronAPI.pickFolder()
        : await electronAPI.pickExe();
      if (result) setDetailValue(result);
    };

    const handleNext = async () => {
      if (!detailValue.trim()) return;
      let ic: string | undefined;
      if ((type === 'app' || type === 'doc') && detailValue) {
        ic = (await electronAPI.getFileIcon(detailValue)) ?? undefined;
      }
      goToName(type, detailValue.trim(), ic);
    };

    return (
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent style={{ width: 420, padding: 0, overflow: 'hidden' }}>
          <DialogHeader style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-rgba)' }}>
            <DialogTitle style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={m.icon} size={16} color={m.color} />
              {m.label}
            </DialogTitle>
          </DialogHeader>
          <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {spaceSelector}

            <div>
              <FieldLabel>{type === 'url' ? 'URL' : type === 'cmd' ? '명령어' : type === 'text' ? '내용' : '경로'}</FieldLabel>
              <div style={{ display: 'flex', gap: 6 }}>
                <TextInput
                  value={detailValue}
                  onChange={setDetailValue}
                  placeholder={placeholder}
                  mono={type !== 'text'}
                />
                {canBrowse && (
                  <button
                    onClick={handleBrowse}
                    title="파일 탐색기에서 선택"
                    style={{
                      flexShrink: 0, width: 34, height: 34, borderRadius: 8,
                      border: '1px solid var(--border-rgba)', background: 'var(--surface)',
                      color: 'var(--text-muted)', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Icon name="folder_open" size={16} />
                  </button>
                )}
              </div>
              {type === 'text' && (
                <button
                  onClick={async () => { const t = await electronAPI.readClipboard(); if (t) setDetailValue(t); }}
                  style={{ marginTop: 6, fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                >
                  클립보드에서 붙여넣기
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <WizardBtn icon="arrow_back" label="이전" onClick={() => setPhase({ kind: 'pick-type' })} />
              <WizardBtn icon="arrow_forward" label="다음" primary disabled={!detailValue.trim()} onClick={handleNext} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // name confirmation
  if (phase.kind === 'name') {
    const { type, value } = phase;
    const m = TYPE_META[type];

    return (
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent style={{ width: 420, padding: 0, overflow: 'hidden' }}>
          <DialogHeader style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-rgba)' }}>
            <DialogTitle style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="badge" size={16} color="var(--accent)" />
              이름 확인
            </DialogTitle>
          </DialogHeader>
          <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Preview card */}
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${m.color}14`, border: `1px solid ${m.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {iconUrl
                  ? <img src={iconUrl} alt="" style={{ width: 26, height: 26, objectFit: 'contain', borderRadius: 4 }} />
                  : <Icon name={m.icon} size={22} color={m.color} />
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-color)', marginBottom: 2 }}>
                  {nameValue || '이름 없음'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {value}
                </div>
              </div>
              <TypeChip type={type} small />
            </div>

            <div>
              <FieldLabel>이름</FieldLabel>
              <TextInput value={nameValue} onChange={setNameValue} placeholder="표시될 이름" />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <WizardBtn icon="arrow_back" label="이전" onClick={() => setPhase({ kind: 'detail', type })} />
              <WizardBtn
                icon="add_circle"
                label="추가"
                primary
                disabled={!nameValue.trim()}
                onClick={() => handleSave(type, value, nameValue)}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
