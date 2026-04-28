import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { LauncherItem, Space } from '../types';
import { Icon } from '@/components/ui/Icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { electronAPI } from '../electronBridge';
import { useBusyMark } from '../lib/userBusy';
import { useFaviconAutoFetch, fetchFaviconDataUrl, ensureHttpUrl } from '../hooks/useFavicon';

interface ItemDialogProps {
  open: boolean;
  onClose: () => void;
  spaces: Space[];
  editItem?: LauncherItem | null;
  defaultSpaceId?: string;
  monitorCount?: number;
  // Restrict the Type dropdown to a subset. Callers that already know the type
  // (e.g. file-drop → folder/app only, URL-drop → url/browser) pass this so the
  // user isn't shown meaningless alternatives. Omit to show every type.
  allowedTypes?: Array<LauncherItem['type']>;
  onSave: (spaceId: string, item: Omit<LauncherItem, 'id'> | LauncherItem) => void;
}

// Monotone Material Symbols only — emoji were jarring when mixed with the rest
// of the UI. `icon` is rendered via <Icon name=...> so it picks up theme colors.
const TYPE_OPTIONS: Array<{ value: LauncherItem['type']; label: string; icon: string }> = [
  { value: 'url',     label: '웹 URL',      icon: 'language' },
  { value: 'folder',  label: '폴더 경로',   icon: 'folder' },
  { value: 'app',     label: '앱 실행',     icon: 'apps' },
  { value: 'window',  label: '창 포커스',   icon: 'select_window' },
  { value: 'browser', label: '브라우저 탭', icon: 'tab' },
  { value: 'text',    label: '텍스트 복사', icon: 'content_paste' },
  { value: 'cmd',     label: '커맨드 실행', icon: 'terminal' },
];

const PRESET_COLORS = [
  '#6366f1','#818cf8','#22c55e','#f59e0b','#ef4444',
  '#0ea5e9','#a855f7','#ec4899','#14b8a6','#f97316',
];

const MAT_ICONS = [
  'star','home','settings','apps','search','menu','close','add','remove','edit',
  'delete','check','check_circle','cancel','info','help','warning','error','lock','lock_open',
  'folder_open','folder','description','article','note','draft','source','attach_file',
  'save','download','upload','share','print','cloud','cloud_upload','cloud_download','file_copy',
  'code','terminal','api','bug_report','database','dns','developer_mode','memory','storage',
  'computer','laptop','phone_android','tablet_android','tv','headphones','sports_esports',
  'gamepad','usb','wifi','bluetooth','cast','router','smart_toy',
  'email','chat','forum','message','notifications','send','reply','phone','video_call',
  'voicemail','inbox','drafts','announcement','campaign','contact_support',
  'music_note','play_arrow','pause','stop','playlist_play','audio_file','video_file',
  'photo','image','photo_camera','videocam','mic','volume_up','queue_music',
  'calendar_today','event','schedule','alarm','timer','history','update','today','date_range','access_time',
  'person','group','account_circle','contacts','work','business','school',
  'map','location_on','place','navigation','directions','flight','hotel',
  'restaurant','local_cafe','shopping_cart','store','home_work','apartment',
  'bookmark','label','flag','key','vpn_key','security','shield','fingerprint',
  'open_in_new','launch','link','qr_code','content_copy',
  'payments','credit_card','account_balance','trending_up','bar_chart','pie_chart',
  'analytics','assessment','insights','receipt','savings','attach_money',
  'book','library_books','science','calculate','lightbulb','tips_and_updates',
  'psychology','biotech','functions','quiz',
  'dashboard','grid_view','list','expand_more','chevron_right','arrow_forward',
  'arrow_back','more_vert','more_horiz','menu_open',
  'eco','nature','park','water','wb_sunny','ac_unit','thermostat',
  'public','language','translate','explore','travel_explore','rocket_launch',
  'celebration','cake','sports','fitness_center','self_improvement',
  'favorite','radio_button_checked','emoji_emotions','face',
];

export function ItemDialog({ open, onClose, spaces, editItem, defaultSpaceId, monitorCount = 1, allowedTypes, onSave }: ItemDialogProps) {
  useBusyMark('modal:item-edit', open);
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
  const [showAdvanced, setShowAdvanced] = useState(isEdit);
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

  /* ── Auto-fetch favicon for URL / browser items ──────────────────
   * Two effects: (1) reset to default when the input no longer warrants
   * an auto-resolved favicon; (2) hand off the actual fetch to the
   * shared hook, which goes through main process (CSP-bypass + 1×1
   * placeholder rejection — see hooks/useFavicon.ts). */
  useEffect(() => {
    if (manualIconRef.current) return;
    if (!autoFavicon) return;
    const isUrlType = form.type === 'url' || form.type === 'browser';
    const hasUrl = !!ensureHttpUrl(form.value);
    if (!isUrlType || !hasUrl) {
      setAutoFavicon(false);
      setForm(prev => ({ ...prev, iconType: 'material', icon: 'star' }));
    }
  }, [form.type, form.value, autoFavicon]);

  const handleFaviconResolved = useCallback((dataUrl: string | null) => {
    if (manualIconRef.current) return;
    if (dataUrl) {
      setForm(prev => ({ ...prev, iconType: 'image', icon: dataUrl }));
      setAutoFavicon(true);
    } else {
      setForm(prev => ({ ...prev, iconType: 'material', icon: 'public' }));
      setAutoFavicon(false);
    }
  }, []);

  useFaviconAutoFetch({
    url: form.value,
    enabled: !manualIconRef.current && (form.type === 'url' || form.type === 'browser'),
    onResolved: handleFaviconResolved,
  });

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
    return () => { cancelled = true; };
  }, [form.type, form.value]);

  /* ── Icon helpers ───────────────────────────────────────── */
  const selectMaterialIcon = useCallback((name: string) => {
    manualIconRef.current = true;
    setAutoFavicon(false);
    f({ iconType: 'material', icon: name });
    setIconSearch(name);
  }, [f]);

  const fetchFavicon = useCallback(async () => {
    const dataUrl = await fetchFaviconDataUrl(form.value);
    if (!dataUrl) return;
    manualIconRef.current = true;
    f({ iconType: 'image', icon: dataUrl });
    setAutoFavicon(false);
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

  /* ── Image crop ──────────────────────────────────────────── */
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
    // Widgets carry no `value` (they don't launch a target), so the
    // standard "title + value required" check would block save. We
    // gate on title only for widgets; colour-swatches additionally
    // need a valid hex.
    if (!form.title.trim()) return;
    if (!isWidgetMode && !form.value.trim()) return;

    const base = {
      title: form.title,
      type: form.type,
      value: form.value,
      color: form.color || undefined,
      icon: form.icon,
      iconType: form.iconType,
      monitor: form.monitor,
      ...(editItem?.exePath ? { exePath: editItem.exePath } : {}),
    };

    // Preserve / update the widget sub-document. For colour-swatch we
    // pull the local hex/name state into options; for any other
    // widget kind we just spread editItem.widget through unchanged.
    let widget: LauncherItem['widget'] | undefined;
    if (isWidgetMode && editItem?.widget) {
      if (editItem.widget.kind === 'color-swatch') {
        widget = {
          kind: 'color-swatch',
          options: {
            hex: swatchHex.toUpperCase(),
            ...(swatchName.trim() ? { name: swatchName.trim() } : {}),
          },
        };
      } else {
        widget = editItem.widget;
      }
    }

    if (isEdit) {
      onSave(form.spaceId, { ...editItem, ...base, ...(widget ? { widget } : {}) } as LauncherItem);
    } else {
      onSave(form.spaceId, { ...base, ...(widget ? { widget } : {}) } as Omit<LauncherItem, 'id'>);
    }
    onClose();
  }

  const dropBtnStyle: React.CSSProperties = {
    width: '100%', height: 32, padding: '0 10px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    background: 'var(--surface)', border: '1px solid var(--border-rgba)',
    borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12, color: 'var(--text-color)', transition: 'border-color 0.12s',
  };

  const selectedSpace = spaces.find(s => s.id === form.spaceId);
  const selectedType = TYPE_OPTIONS.find(o => o.value === form.type);
  // Widget cards have an entirely different shape — no value/URL/path,
  // no type to choose, no icon picker (the widget renders its own
  // inner UI). We hide those sections in widget mode and keep only
  // title + space (and color via the existing color section, if any).
  const isWidgetMode = form.type === 'widget';
  // Specific widget-kind fields. Only populated when editing a
  // colour-swatch widget — `editItem.widget.options` is read once at
  // mount and the user's edits live in local state until save.
  const isColorSwatch = isWidgetMode && editItem?.widget?.kind === 'color-swatch';
  const initialColorOpts = (editItem?.widget?.kind === 'color-swatch')
    ? editItem.widget.options
    : null;
  const [swatchHex, setSwatchHex] = useState(
    (initialColorOpts?.hex || '#6366F1').toUpperCase()
  );
  const [swatchName, setSwatchName] = useState(
    initialColorOpts?.name ?? ''
  );
  // When context narrows the choices to one, the dropdown is meaningless — we
  // still render it (disabled) so users know the type, but they can't change it.
  const typeOptions = useMemo(
    () => (allowedTypes && allowedTypes.length > 0)
      ? TYPE_OPTIONS.filter(o => allowedTypes.includes(o.value))
      : TYPE_OPTIONS,
    [allowedTypes],
  );
  const typeLocked = typeOptions.length <= 1;

  const valuePlaceholder =
    form.type === 'url' ? 'https://...'
    : form.type === 'folder' ? 'C:\\Users\\...'
    : form.type === 'app' ? 'C:\\Program Files\\...'
    : form.type === 'cmd' ? 'notepad.exe  /  start "" "C:\\..."'
    : form.type === 'text' ? '클립보드에 복사될 텍스트'
    : form.type === 'window' ? '창 제목 (Alt+Tab에 보이는 이름)'
    : '값 입력';

  const valueLabel =
    form.type === 'url' || form.type === 'browser' ? 'URL' :
    form.type === 'folder' ? '폴더 경로' :
    form.type === 'app' ? '실행 파일' :
    form.type === 'cmd' ? '커맨드' :
    form.type === 'text' ? '텍스트' :
    form.type === 'window' ? '창 제목' : '값';

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent style={{ width: 440, padding: 0, overflow: 'hidden' }}>
        <DialogHeader style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-rgba)' }}>
          <DialogTitle style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-color)' }}>
            {isEdit ? '카드 수정' : '카드 추가'}
          </DialogTitle>
        </DialogHeader>

        <div style={{ padding: '16px 20px 4px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 'calc(88vh - 110px)' }}>

          {/* ① Icon preview + Name */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={() => setShowAdvanced(v => !v)}
              title="아이콘 변경 (클릭)"
              style={{
                width: 48, height: 48, flexShrink: 0, borderRadius: 12,
                background: 'var(--surface)',
                border: `1.5px solid ${showAdvanced ? 'var(--accent)' : 'var(--border-rgba)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', overflow: 'hidden', padding: 0,
                transition: 'border-color 0.15s',
              }}
            >
              {form.iconType === 'image'
                ? <img src={form.icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={() => { setAutoFavicon(false); setForm(p => ({ ...p, iconType: 'material', icon: form.type === 'app' ? 'apps' : 'public' })); }} />
                : <Icon name={form.icon} size={24} color="var(--text-muted)" />
              }
            </button>
            <Input
              value={form.title}
              onChange={e => f({ title: e.target.value })}
              placeholder="카드 이름"
              style={{ flex: 1, height: 48, fontSize: 14, borderRadius: 10 }}
              autoFocus
            />
          </div>

          {/* ② Type + Space — widget mode hides the Type dropdown
                 (its kind is fixed at creation; can't be changed to
                 a URL etc.) and gives Space the full row. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isWidgetMode ? '1fr' : '1fr 1fr',
            gap: 8,
          }}>
            {!isWidgetMode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>유형</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={typeLocked}
                    style={{ ...dropBtnStyle, opacity: typeLocked ? 0.75 : 1, cursor: typeLocked ? 'default' : 'pointer' }}
                    title={typeLocked ? '감지된 유형으로 자동 설정됨' : undefined}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedType && <Icon name={selectedType.icon} size={14} color="var(--text-muted)" />}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedType?.label ?? '선택'}
                      </span>
                    </span>
                    {!typeLocked && <Icon name="expand_more" size={14} style={{ flexShrink: 0 }} color="var(--text-dim)" />}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent style={{ minWidth: 160 }}>
                    {typeOptions.map(o => (
                      <DropdownMenuItem key={o.value} onClick={() => f({ type: o.value })}
                        style={{ fontWeight: o.value === form.type ? 700 : 400 }}>
                        <Icon name={o.icon} size={14} color="var(--text-muted)" />
                        <span>{o.label}</span>
                        {o.value === form.type && <Icon name="check" size={13} style={{ marginLeft: 'auto' }} color="var(--accent)" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

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
          </div>

          {/* ②-bis Colour swatch editor — only for color-swatch widgets.
                A native color picker handles the hex (HTML5 input
                type=color, integrated with the OS picker), and a
                separate name input lets the user label the swatch
                (e.g. "Brand primary"). The Pantone-style widget
                renders the name above the hex when a name is set. */}
          {isColorSwatch && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 0 2px' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {/* Color picker swatch — clicking opens the OS native
                    color picker. We render a styled wrapper so it
                    matches the rest of the dialog instead of looking
                    like a default browser control. */}
                <label style={{
                  position: 'relative',
                  width: 56, height: 56,
                  borderRadius: 10,
                  background: swatchHex,
                  border: '1px solid var(--border-rgba)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  overflow: 'hidden',
                }}>
                  <input
                    type="color"
                    value={swatchHex}
                    onChange={e => setSwatchHex(e.target.value.toUpperCase())}
                    style={{
                      position: 'absolute', inset: 0,
                      width: '100%', height: '100%',
                      opacity: 0, cursor: 'pointer', border: 'none',
                    }}
                  />
                </label>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>HEX</Label>
                  <Input
                    value={swatchHex}
                    onChange={e => {
                      const v = e.target.value.toUpperCase();
                      // Only accept hex-shaped input. Tolerant on
                      // length so the user can type one char at a
                      // time without the value snapping back.
                      if (/^#?[0-9A-F]{0,6}$/.test(v)) {
                        setSwatchHex(v.startsWith('#') ? v : '#' + v);
                      }
                    }}
                    placeholder="#RRGGBB"
                    className="font-mono text-xs"
                    style={{ height: 30, fontSize: 12 }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>이름 (선택)</Label>
                <Input
                  value={swatchName}
                  onChange={e => setSwatchName(e.target.value)}
                  placeholder="예: 브랜드 프라이머리"
                  style={{ height: 30, fontSize: 12 }}
                />
              </div>
            </div>
          )}

          {/* ③ Value / Path — hidden for widgets (no URL/path on a
                widget; the renderer wires its own behaviour). */}
          {!isWidgetMode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>{valueLabel}</Label>
            <div style={{ display: 'flex', gap: 6 }}>
              <Input
                value={form.value}
                onChange={e => f({ value: e.target.value })}
                placeholder={valuePlaceholder}
                className="font-mono text-xs"
                style={{ flex: 1, borderColor: valueError ? 'var(--destructive, #ef4444)' : undefined }}
              />
              {form.type === 'folder' && (
                <button type="button" onClick={handlePickFolder} title="폴더 선택"
                  style={{ flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--border-rgba)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <Icon name="folder_open" size={16} />
                </button>
              )}
              {form.type === 'app' && (
                <button type="button" onClick={handlePickExe} title="실행 파일 선택"
                  style={{ flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--border-rgba)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <Icon name="apps" size={16} />
                </button>
              )}
            </div>
            {valueError && (
              <p style={{ fontSize: 10, color: 'var(--destructive, #ef4444)', display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
                <Icon name="error" size={12} />{valueError}
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
          )}

          {/* ④ Monitor — also hidden for widgets (they have no
              launchable target so monitor preference is meaningless). */}
          {!isWidgetMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>모니터</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => f({ monitor: undefined })} title="자동 (마지막 위치)"
                style={{ height: 28, padding: '0 10px', borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s', background: form.monitor === undefined ? 'var(--accent)' : 'var(--surface)', border: `1px solid ${form.monitor === undefined ? 'var(--accent)' : 'var(--border-rgba)'}`, color: form.monitor === undefined ? '#fff' : 'var(--text-muted)' }}>
                자동
              </button>
              {Array.from({ length: monitorCount }, (_, i) => i + 1).map(n => (
                <button key={n} onClick={() => f({ monitor: n })} title={`모니터 ${n}`}
                  style={{ height: 28, padding: '0 10px', borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s', background: form.monitor === n ? 'var(--accent)' : 'var(--surface)', border: `1px solid ${form.monitor === n ? 'var(--accent)' : 'var(--border-rgba)'}`, color: form.monitor === n ? '#fff' : 'var(--text-muted)' }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* ⑤ Advanced toggle */}
          <button
            onClick={() => setShowAdvanced(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, width: '100%',
              padding: '6px 0', background: 'none', border: 'none',
              borderTop: '1px solid var(--border-rgba)', cursor: 'pointer',
              color: showAdvanced ? 'var(--accent)' : 'var(--text-dim)',
              fontSize: 11, fontFamily: 'inherit', transition: 'color 0.12s',
            }}
          >
            <Icon name={showAdvanced ? 'expand_less' : 'expand_more'} size={14} />
            아이콘 &amp; 색상
          </button>

          {/* ⑥ Advanced section */}
          {showAdvanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 4 }}>

              {/* Crop overlay */}
              {cropSrc && (
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>가운데 정사각형으로 크롭됩니다</p>
                  <img ref={imgRef} src={cropSrc} alt="crop preview" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 6, objectFit: 'contain' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setCropSrc(null)} style={{ padding: '4px 12px', fontSize: 11, borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border-rgba)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
                    <button onClick={handleCropApply} style={{ padding: '4px 12px', fontSize: 11, borderRadius: 6, background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>적용</button>
                  </div>
                </div>
              )}

              {/* Icon picker */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {/* Preview + reset */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {form.iconType === 'image'
                      ? <img src={form.icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => { setAutoFavicon(false); setForm(p => ({ ...p, iconType: 'material', icon: form.type === 'app' ? 'apps' : 'public' })); }} />
                      : <Icon name={form.icon} size={28} color="var(--text-muted)" />
                    }
                  </div>
                  <button onClick={resetIcon} title="기본값으로 초기화"
                    style={{ padding: '2px 8px', fontSize: 10, borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border-rgba)', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                    <Icon name="restart_alt" size={11} />초기화
                  </button>
                </div>

                {/* Tabs + content */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
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

                  {iconTab === 'symbol' && (
                    <>
                      <input
                        value={iconSearch}
                        onChange={e => { setIconSearch(e.target.value); if (!e.target.value) f({ iconType: 'material', icon: 'star' }); }}
                        placeholder="아이콘 검색 (예: folder, chart...)"
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

                  {iconTab === 'system' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(form.type === 'url' || form.type === 'browser') && (
                        <>
                          <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>사이트의 파비콘을 자동으로 가져옵니다.</p>
                          <button onClick={fetchFavicon} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border-rgba)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5, width: 'fit-content' }}>
                            <Icon name="language" size={13} />사이트 아이콘 가져오기
                          </button>
                        </>
                      )}
                      {form.type === 'app' && (
                        <>
                          <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>실행 파일의 시스템 아이콘을 가져옵니다.</p>
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

              {/* Color picker */}
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
                  <input type="color" value={form.color || '#6366f1'} onChange={e => f({ color: e.target.value })} title="직접 지정"
                    style={{ width: 20, height: 20, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'transparent', padding: 0, flexShrink: 0 }} />
                  {form.color && (
                    <button onClick={() => f({ color: '' })} style={{ fontSize: 10, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      초기화
                    </button>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>

        <DialogFooter style={{ padding: '12px 20px', borderTop: '1px solid var(--border-rgba)', marginTop: 4 }}>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          {/* Widgets carry no `value` — gating on it would leave the
              save button permanently disabled for widget edits.
              For widgets we only require a non-empty title; the
              value validation is bypassed. handleSave's own check
              mirrors this. */}
          <Button
            onClick={handleSave}
            disabled={!form.title.trim() || (!isWidgetMode && !form.value.trim())}
          >
            {isEdit ? '저장' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
