import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { LauncherItem, Space } from '../types';
import { Icon } from '@/components/ui/Icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { electronAPI } from '../electronBridge';

interface ItemDialogProps {
  open: boolean;
  onClose: () => void;
  spaces: Space[];
  editItem?: LauncherItem | null;
  defaultSpaceId?: string;
  monitorCount?: number;
  onSave: (spaceId: string, item: Omit<LauncherItem, 'id'> | LauncherItem) => void;
}

const TYPE_OPTIONS = [
  { value: 'url',     label: '🌐 웹 URL' },
  { value: 'folder',  label: '📂 폴더 경로' },
  { value: 'app',     label: '🪟 앱 실행' },
  { value: 'window',  label: '🖥 창 포커스' },
  { value: 'browser', label: '🌍 브라우저 탭' },
  { value: 'text',    label: '📋 텍스트 복사' },
  { value: 'cmd',     label: '💻 커맨드 실행' },
] as const;

const PRESET_COLORS = [
  '#6366f1','#818cf8','#22c55e','#f59e0b','#ef4444',
  '#0ea5e9','#a855f7','#ec4899','#14b8a6','#f97316',
];

const MAT_ICONS = [
  // Essentials
  'star','home','settings','apps','search','menu','close','add','remove','edit',
  'delete','check','check_circle','cancel','info','help','warning','error','lock','lock_open',
  // Files & Folders
  'folder_open','folder','description','article','note','draft','source','attach_file',
  'save','download','upload','share','print','cloud','cloud_upload','cloud_download','file_copy',
  // Apps & Tech
  'code','terminal','api','bug_report','database','dns','developer_mode','memory','storage',
  'computer','laptop','phone_android','tablet_android','tv','headphones','sports_esports',
  'gamepad','usb','wifi','bluetooth','cast','router','smart_toy',
  // Communication
  'email','chat','forum','message','notifications','send','reply','phone','video_call',
  'voicemail','inbox','drafts','announcement','campaign','contact_support',
  // Media
  'music_note','play_arrow','pause','stop','playlist_play','audio_file','video_file',
  'photo','image','photo_camera','videocam','mic','volume_up','queue_music',
  // Time & Calendar
  'calendar_today','event','schedule','alarm','timer','history','update','today','date_range','access_time',
  // People & Places
  'person','group','account_circle','contacts','work','business','school',
  'map','location_on','place','navigation','directions','flight','hotel',
  'restaurant','local_cafe','shopping_cart','store','home_work','apartment',
  // Actions & Security
  'bookmark','label','flag','key','vpn_key','security','shield','fingerprint',
  'open_in_new','launch','link','qr_code','share','content_copy',
  // Analytics & Money
  'payments','credit_card','account_balance','trending_up','bar_chart','pie_chart',
  'analytics','assessment','insights','receipt','savings','attach_money',
  // Education & Science
  'book','library_books','science','calculate','lightbulb','tips_and_updates',
  'psychology','biotech','functions','quiz',
  // Navigation UI
  'dashboard','grid_view','list','expand_more','chevron_right','arrow_forward',
  'arrow_back','more_vert','more_horiz','menu_open','side_navigation',
  // Nature & Environment
  'eco','nature','park','water','wb_sunny','ac_unit','thermostat',
  // Misc
  'public','language','translate','explore','travel_explore','rocket_launch',
  'celebration','cake','sports','fitness_center','self_improvement',
  'favorite','radio_button_checked','emoji_emotions','face',
];

function ensureHttpUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(v)) return `https://${v}`;
  return null;
}

function faviconCandidates(inputUrl: string): string[] {
  try {
    const u = new URL(inputUrl);
    const domain = u.hostname;
    const origin = u.origin;
    return [
      `${origin}/apple-touch-icon.png`,
      `${origin}/apple-touch-icon-precomposed.png`,
      `https://www.google.com/s2/favicons?domain=${domain}&sz=256`,
      `${origin}/favicon.ico`,
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    ];
  } catch {
    return [];
  }
}

function tryLoadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

export function ItemDialog({ open, onClose, spaces, editItem, defaultSpaceId, monitorCount = 1, onSave }: ItemDialogProps) {
  const isEdit = !!(editItem && 'id' in editItem && editItem.id);
  type ItemForm = {
    title: string;
    type: LauncherItem['type'];
    value: string;
    color: string;
    spaceId: string;
    iconType: 'material' | 'image';
    icon: string;
    monitor: number | undefined;
  };

  const [form, setForm] = useState<ItemForm>(() => ({
    title: editItem?.title ?? '',
    type: editItem?.type ?? 'url',
    value: editItem?.value ?? '',
    color: editItem?.color ?? '',
    spaceId: (() => {
      if (editItem) return spaces.find(s => s.items.some(i => i.id === editItem.id))?.id ?? defaultSpaceId ?? spaces[0]?.id ?? '';
      return defaultSpaceId ?? spaces[0]?.id ?? '';
    })(),
    iconType: editItem?.iconType ?? 'material',
    icon: editItem?.icon ?? 'star',
    monitor: editItem?.monitor ?? undefined,
  }));

  const [iconSearch, setIconSearch] = useState(isEdit && editItem?.iconType === 'material' ? editItem.icon ?? '' : '');
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [autoFavicon, setAutoFavicon] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cropRef = useRef<{ x: number; y: number; size: number } | null>(null);
  const manualIconRef = useRef(!!(editItem?.iconType === 'image'));

  type IconTab = 'symbol' | 'system' | 'image';
  const [iconTab, setIconTab] = useState<IconTab>(() => {
    if (!editItem) return 'symbol';
    if (editItem.iconType === 'image') {
      return editItem.icon?.startsWith('data:') ? 'image' : 'system';
    }
    return 'symbol';
  });

  const f = useCallback((patch: Partial<ItemForm>) => {
    setForm(prev => ({ ...prev, ...patch }));
  }, []);

  /* ── Auto-fetch favicon for URL / browser items ─────────── */
  useEffect(() => {
    if (manualIconRef.current) return;
    if (form.type !== 'url' && form.type !== 'browser') {
      if (autoFavicon) {
        setAutoFavicon(false);
        setForm(prev => ({ ...prev, iconType: 'material', icon: 'star' }));
      }
      return;
    }
    const normalized = ensureHttpUrl(form.value);
    if (!normalized) {
      if (autoFavicon) {
        setAutoFavicon(false);
        setForm(prev => ({ ...prev, iconType: 'material', icon: 'star' }));
      }
      return;
    }

    let cancelled = false;
    (async () => {
      const candidates = faviconCandidates(normalized);
      for (const candidate of candidates) {
        const ok = await tryLoadImage(candidate);
        if (cancelled) return;
        if (ok) {
          setForm(prev => ({ ...prev, iconType: 'image', icon: candidate }));
          setAutoFavicon(true);
          return;
        }
      }

      if (!cancelled) {
        setAutoFavicon(false);
        setForm(prev => ({ ...prev, iconType: 'material', icon: 'public' }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autoFavicon, form.type, form.value]);

  useEffect(() => {
    if (manualIconRef.current) return;
    if (form.type !== 'app') return;
    if (!form.value?.trim()) return;

    let cancelled = false;
    (async () => {
      const icon = await electronAPI.getFileIcon(form.value.trim());
      if (cancelled || !icon) return;
      setForm((prev) => ({ ...prev, iconType: 'image', icon }));
    })();
    return () => {
      cancelled = true;
    };
  }, [form.type, form.value]);

  /* ── Icon helpers ───────────────────────────────────────── */
  const selectMaterialIcon = useCallback((name: string) => {
    manualIconRef.current = true;
    setAutoFavicon(false);
    f({ iconType: 'material', icon: name });
    setIconSearch(name);
  }, [f]);

  const fetchFavicon = useCallback(async () => {
    const normalized = ensureHttpUrl(form.value);
    if (!normalized) return;
    const candidates = faviconCandidates(normalized);
    for (const candidate of candidates) {
      const ok = await tryLoadImage(candidate);
      if (ok) {
        manualIconRef.current = true;
        f({ iconType: 'image', icon: candidate });
        setAutoFavicon(false);
        return;
      }
    }
  }, [form.value, f]);

  const fetchFileIcon = useCallback(async () => {
    if (!form.value?.trim()) return;
    const icon = await electronAPI.getFileIcon(form.value.trim());
    if (!icon) return;
    manualIconRef.current = true;
    f({ iconType: 'image', icon });
    setAutoFavicon(false);
  }, [form.value, f]);

  const resetIcon = useCallback(() => {
    manualIconRef.current = false;
    setAutoFavicon(false);
    if (form.type === 'url' || form.type === 'browser') {
      f({ iconType: 'material', icon: 'public' });
      setIconTab('system');
      fetchFavicon();
    } else if (form.type === 'app') {
      f({ iconType: 'material', icon: 'apps' });
      setIconTab('system');
      fetchFileIcon();
    } else {
      f({ iconType: 'material', icon: 'star' });
      setIconTab('symbol');
    }
  }, [form.type, f, fetchFavicon, fetchFileIcon]);

  const filteredIcons = iconSearch.trim()
    ? MAT_ICONS.filter(i => i.includes(iconSearch.toLowerCase()))
    : MAT_ICONS;

  /* ── Image crop (canvas-based, no external lib) ──────────── */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setCropSrc(ev.target?.result as string);
      cropRef.current = null;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropApply = useCallback(() => {
    if (!imgRef.current || !cropSrc) return;
    const img = imgRef.current;
    const size = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const sx = (img.naturalWidth - size) / 2;
    const sy = (img.naturalHeight - size) / 2;
    ctx.drawImage(img, sx, sy, size, size, 0, 0, 64, 64);
    const dataUrl = canvas.toDataURL('image/png');
    manualIconRef.current = true;
    setAutoFavicon(false);
    f({ iconType: 'image', icon: dataUrl });
    setCropSrc(null);
  }, [cropSrc, f]);

  /* ── Value validation ────────────────────────────────────── */
  const valueError = useMemo(() => {
    const v = form.value.trim();
    if (!v) return null;
    if ((form.type === 'url' || form.type === 'browser') && !/^https?:\/\/.+/.test(v))
      return 'URL은 https:// 또는 http://로 시작해야 합니다';
    if (form.type === 'folder' && !/^[A-Za-z]:\\/.test(v) && !v.startsWith('/') && !v.startsWith('\\\\'))
      return '올바른 폴더 경로를 입력하세요 (예: C:\\Users\\...)';
    if (form.type === 'app' && v && !/\.(exe|bat|cmd|lnk)$/i.test(v) && !v.startsWith('C:\\'))
      return '실행 파일 경로를 입력하거나 브라우저로 선택하세요';
    return null;
  }, [form.type, form.value]);

  /* ── File pickers ─────────────────────────────────────────── */
  const handlePickFolder = async () => {
    const p = await electronAPI.pickFolder();
    if (p) {
      f({ value: p });
      if (!form.title) f({ title: p.split('\\').pop() || p, value: p });
    }
  };

  const handlePickExe = async () => {
    const p = await electronAPI.pickExe();
    if (p) {
      const name = p.split('\\').pop()?.replace(/\.(exe|lnk)$/i, '') || p;
      f({ value: p });
      if (!form.title) f({ title: name, value: p });
    }
  };

  /* ── Duplicate check ─────────────────────────────────────── */
  const duplicateItem = (() => {
    const val = form.value.trim().toLowerCase();
    if (!val) return null;
    for (const space of spaces) {
      for (const item of space.items) {
        if (item.value.toLowerCase() === val && item.id !== editItem?.id) return { item, space };
      }
    }
    return null;
  })();

  /* ── Save ─────────────────────────────────────────────────── */
  function handleSave() {
    if (!form.title.trim() || !form.value.trim()) return;
    const base = {
      title: form.title,
      type: form.type,
      value: form.value,
      color: form.color || undefined,
      icon: form.icon,
      iconType: form.iconType,
      monitor: form.monitor,
      // Preserve exePath if present (from scan or existing item)
      ...(editItem?.exePath ? { exePath: editItem.exePath } : {}),
    };
    if (isEdit) onSave(form.spaceId, { ...editItem, ...base } as LauncherItem);
    else onSave(form.spaceId, base as Omit<LauncherItem, 'id'>);
    onClose();
  }

  // ── Section divider helper ───────────────────────────────────
  const Divider = ({ label }: { label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 2px' }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-rgba)' }} />
    </div>
  );

  // ── Dropdown button style helper ─────────────────────────────
  const dropBtnStyle: React.CSSProperties = {
    width: '100%', height: 32, padding: '0 10px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    background: 'var(--surface)', border: '1px solid var(--border-rgba)',
    borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12, color: 'var(--text-color)', transition: 'border-color 0.12s',
  };

  const selectedSpace = spaces.find(s => s.id === form.spaceId);
  const selectedType = TYPE_OPTIONS.find(o => o.value === form.type);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="w-[460px]" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <DialogHeader>
          <DialogTitle>{isEdit ? '카드 수정' : '카드 추가'}</DialogTitle>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>

          {/* ━━ 섹션 1: 기본 정보 ━━ */}
          <Divider label="기본 정보" />

          {/* 이름 — 가장 중요하므로 맨 위 단독 배치 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>이름</Label>
            <Input
              value={form.title}
              onChange={e => f({ title: e.target.value })}
              placeholder="카드에 표시될 이름"
              style={{ fontSize: 13 }}
              autoFocus
            />
          </div>

          {/* Space + Type — 나란히 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {/* 스페이스 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>스페이스</Label>
              <DropdownMenu>
                <DropdownMenuTrigger style={dropBtnStyle}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedSpace ? `${selectedSpace.icon ?? ''} ${selectedSpace.name}`.trim() : '선택'}
                  </span>
                  <Icon name="expand_more" size={14} style={{ flexShrink: 0 }} color="var(--text-dim)" />
                </DropdownMenuTrigger>
                <DropdownMenuContent style={{ minWidth: 160 }}>
                  {spaces.map(s => (
                    <DropdownMenuItem key={s.id} onClick={() => f({ spaceId: s.id })}
                      style={{ fontWeight: s.id === form.spaceId ? 700 : 400 }}>
                      {s.icon} {s.name}
                      {s.id === form.spaceId && <Icon name="check" size={13} style={{ marginLeft: 'auto' }} color="var(--accent)" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* 유형 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>유형</Label>
              <DropdownMenu>
                <DropdownMenuTrigger style={dropBtnStyle}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedType?.label ?? '선택'}
                  </span>
                  <Icon name="expand_more" size={14} style={{ flexShrink: 0 }} color="var(--text-dim)" />
                </DropdownMenuTrigger>
                <DropdownMenuContent style={{ minWidth: 160 }}>
                  {TYPE_OPTIONS.map(o => (
                    <DropdownMenuItem key={o.value} onClick={() => f({ type: o.value as LauncherItem['type'] })}
                      style={{ fontWeight: o.value === form.type ? 700 : 400 }}>
                      {o.label}
                      {o.value === form.type && <Icon name="check" size={13} style={{ marginLeft: 'auto' }} color="var(--accent)" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* ━━ 섹션 2: 대상 ━━ */}
          <Divider label={
            form.type === 'url' || form.type === 'browser' ? 'URL' :
            form.type === 'folder' ? '폴더 경로' :
            form.type === 'app' ? '실행 파일' :
            form.type === 'cmd' ? '커맨드' :
            form.type === 'text' ? '텍스트' :
            form.type === 'window' ? '창 제목' : '대상'
          } />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Input
                value={form.value}
                onChange={e => f({ value: e.target.value })}
                placeholder={
                  form.type === 'url' ? 'https://...'
                  : form.type === 'folder' ? 'C:\\Users\\...'
                  : form.type === 'app' ? 'C:\\Program Files\\...'
                  : form.type === 'cmd' ? 'notepad.exe  /  start "" "C:\\..."'
                  : form.type === 'text' ? '클립보드에 복사될 텍스트'
                  : form.type === 'window' ? '창 제목 (Alt+Tab에 보이는 이름)'
                  : '값 입력'
                }
                className="font-mono text-xs"
                style={{ flex: 1, borderColor: valueError ? 'var(--destructive, #ef4444)' : undefined }}
              />
              {form.type === 'folder' && (
                <button type="button" onClick={handlePickFolder} title="폴더 선택" style={{ flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--border-rgba)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <Icon name="folder_open" size={16} />
                </button>
              )}
              {form.type === 'app' && (
                <button type="button" onClick={handlePickExe} title="실행 파일 선택" style={{ flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--border-rgba)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <Icon name="apps" size={16} />
                </button>
              )}
            </div>
            {valueError && (
              <p style={{ fontSize: 10, color: 'var(--destructive, #ef4444)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="error" size={12} />
                {valueError}
              </p>
            )}
            {duplicateItem && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--border-focus)' }}>
                <Icon name="warning" size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  <b style={{ color: 'var(--text-color)' }}>{duplicateItem.item.title}</b>에 동일한 값이 이미 있습니다 ({duplicateItem.space.name})
                </span>
              </div>
            )}
          </div>

          {/* ━━ 섹션 3: 아이콘 ━━ */}
          <Divider label="아이콘" />

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            {/* 미리보기 + 초기화 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', flexShrink: 0 }}>
              <div style={{ position: 'relative', width: 56, height: 56, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {form.iconType === 'image'
                  ? <img src={form.icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => { setAutoFavicon(false); setForm(p => ({ ...p, iconType: 'material', icon: form.type === 'app' ? 'apps' : 'public' })); }} />
                  : <Icon name={form.icon} size={28} color="var(--text-muted)" />
                }
              </div>
              <button onClick={resetIcon} title="기본값으로 초기화" style={{ padding: '2px 8px', fontSize: 10, borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border-rgba)', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                <Icon name="restart_alt" size={11} />초기화
              </button>
            </div>

            {/* 탭 + 컨텐츠 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* 탭 버튼 */}
              <div style={{ display: 'flex', gap: 3 }}>
                {(['symbol', 'system', 'image'] as const).map(tab => {
                  const labels: Record<IconTab, string> = { symbol: '심볼', system: '시스템', image: '이미지' };
                  const active = iconTab === tab;
                  return (
                    <button key={tab} onClick={() => setIconTab(tab)}
                      style={{ padding: '3px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 700 : 400, background: active ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border-rgba)'}`, color: active ? 'var(--accent)' : 'var(--text-muted)', transition: 'all 0.1s' }}>
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>

              {/* 심볼 탭 */}
              {iconTab === 'symbol' && (
                <>
                  <input
                    value={iconSearch}
                    onChange={e => { setIconSearch(e.target.value); if (!e.target.value) f({ iconType: 'material', icon: 'star' }); }}
                    placeholder="아이콘 검색 (예: folder, chart, person...)"
                    style={{ width: '100%', padding: '5px 8px', fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border-rgba)', borderRadius: 6, color: 'var(--text-color)', fontFamily: 'inherit', outline: 'none' }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxHeight: 72, overflowY: 'auto' }}>
                    {filteredIcons.slice(0, 30).map(ico => (
                      <button key={ico} title={ico} onClick={() => selectMaterialIcon(ico)}
                        style={{ width: 28, height: 28, borderRadius: 6, background: form.icon === ico && form.iconType === 'material' ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${form.icon === ico && form.iconType === 'material' ? 'var(--accent)' : 'var(--border-rgba)'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={ico} size={15} color={form.icon === ico && form.iconType === 'material' ? 'var(--accent)' : 'var(--text-muted)'} />
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* 시스템 탭 */}
              {iconTab === 'system' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(form.type === 'url' || form.type === 'browser') && (
                    <>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>사이트의 파비콘/아이콘을 자동으로 가져옵니다.</p>
                      <button onClick={fetchFavicon} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border-rgba)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5, width: 'fit-content' }}>
                        <Icon name="language" size={13} />사이트 아이콘 가져오기
                      </button>
                    </>
                  )}
                  {form.type === 'app' && (
                    <>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>실행 파일(.exe)의 시스템 아이콘을 가져옵니다.</p>
                      <button onClick={fetchFileIcon} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border-rgba)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5, width: 'fit-content' }}>
                        <Icon name="apps" size={13} />파일 아이콘 가져오기
                      </button>
                    </>
                  )}
                  {form.type !== 'url' && form.type !== 'browser' && form.type !== 'app' && (
                    <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>이 유형은 시스템 아이콘을 지원하지 않습니다.</p>
                  )}
                </div>
              )}

              {/* 이미지 탭 */}
              {iconTab === 'image' && (
                <>
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>이미지 파일을 업로드해 아이콘으로 사용합니다.</p>
                  <button onClick={() => fileRef.current?.click()} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border-rgba)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5, width: 'fit-content' }}>
                    <Icon name="upload" size={13} />이미지 업로드
                  </button>
                </>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
            </div>
          </div>

          {cropSrc && (
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>가운데 정사각형으로 크롭됩니다</p>
              <img ref={imgRef} src={cropSrc} alt="crop preview" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 6, objectFit: 'contain' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setCropSrc(null)} style={{ padding: '4px 12px', fontSize: 11, borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border-rgba)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
                <button onClick={handleCropApply} style={{ padding: '4px 12px', fontSize: 11, borderRadius: 6, background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>적용</button>
              </div>
            </div>
          )}

          {/* ━━ 섹션 4: 표시 옵션 ━━ */}
          <Divider label="표시 옵션" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* 모니터 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>모니터</Label>
              <div style={{ display: 'flex', gap: 5 }}>
                <button onClick={() => f({ monitor: undefined })} title="자동"
                  style={{ flex: 1, height: 30, borderRadius: 7, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s', background: form.monitor === undefined ? 'var(--accent)' : 'var(--surface)', border: `1px solid ${form.monitor === undefined ? 'var(--accent)' : 'var(--border-rgba)'}`, color: form.monitor === undefined ? '#fff' : 'var(--text-muted)' }}>C</button>
                {Array.from({ length: monitorCount }, (_, i) => i + 1).map(n => (
                  <button key={n} onClick={() => f({ monitor: n })} title={`모니터 ${n}`}
                    style={{ flex: 1, height: 30, borderRadius: 7, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s', background: form.monitor === n ? 'var(--accent)' : 'var(--surface)', border: `1px solid ${form.monitor === n ? 'var(--accent)' : 'var(--border-rgba)'}`, color: form.monitor === n ? '#fff' : 'var(--text-muted)' }}>{n}</button>
                ))}
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                {form.monitor === undefined ? '자동 (마지막 위치)' : `모니터 ${form.monitor}${form.monitor === 1 ? ' (주)' : ''}`}
              </span>
            </div>

            {/* 색상 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>카드 색상</Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => f({ color: c })}
                    style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', outline: form.color === c ? `2.5px solid ${c}` : 'none', outlineOffset: 2, transition: 'transform 0.1s', flexShrink: 0 }}
                    onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.2)')}
                    onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                  />
                ))}
                <input type="color" value={form.color || '#6366f1'} onChange={e => f({ color: e.target.value })} title="직접 지정" style={{ width: 20, height: 20, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'transparent', padding: 0, flexShrink: 0 }} />
                {form.color && <button onClick={() => f({ color: '' })} style={{ fontSize: 10, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>초기화</button>}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter style={{ marginTop: 8 }}>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button onClick={handleSave} disabled={!form.title.trim() || !form.value.trim()}>
            {isEdit ? '저장' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
