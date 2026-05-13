/**
 * ItemDialog — phase-based card add/edit (v4).
 *
 * Earlier rewrites kept squeezing every form field onto one screen.
 * The user pushed back: a wide one-page form is still a form. The
 * goal is "뇌빼고 딸깍딸깍" — each step exposes ONE decision, the
 * user moves forward (click / Enter / swipe), and the next step
 * appears. v4 implements that as three slide-able phases:
 *
 *   ① 유형 (TYPE)   — big icon-card grid. Click → 0.12s feedback → next.
 *                     If allowedTypes narrows to one, this phase is
 *                     skipped on mount.
 *   ② 값 + 이름     — value input + (optional) folder/exe picker, plus
 *      (VALUE)        a smaller name input whose placeholder shows the
 *                     auto-derived title so Enter alone commits.
 *   ③ 위치 (PLACE)  — space chip grid (click = save+close), monitor
 *                     pill row, and an opt-in "🎯 화면에서 고르기"
 *                     button (wires into App via onPickOnScreen).
 *
 * Navigation surfaces:
 *   - Tab dots at the top — clickable, jumps to any phase.
 *   - ⌘/Ctrl + Enter — save anywhere; if invalid, jump to first
 *                      incomplete phase instead.
 *   - ←/→ — phase nav, ignored when focus is in a text input.
 *   - Horizontal pointer drag (60+ px) on the phase area — slide
 *     between phases; visual translateX follows finger live, snaps
 *     on release.
 *
 * Advanced (icon picker + custom colour) is intentionally OUT of the
 * three-phase flow — it's reachable only via the post-save toast
 * "꾸미기" button, which re-opens the dialog with `startAdvanced` so
 * the dialog renders ONLY the advanced editor (no tabs, no slider).
 *
 * Widget mode (color-swatch) reuses the same phase shell but with
 * different content: phase ① is replaced by the colour + name editor
 * (since the widget's "type" is already fixed at creation), phase ②
 * disappears, phase ③ stays as space picker.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { LauncherItem, Space } from '../types';
import { Icon } from '@/components/ui/Icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { electronAPI } from '../electronBridge';
import { useBusyMark } from '../lib/userBusy';
import { useFaviconAutoFetch, fetchFaviconDataUrl, ensureHttpUrl } from '../hooks/useFavicon';
import { plausibleTypes } from '../lib/typePlausibility';

interface ItemDialogProps {
  open: boolean;
  onClose: () => void;
  spaces: Space[];
  editItem?: LauncherItem | null;
  defaultSpaceId?: string;
  monitorCount?: number;
  allowedTypes?: Array<LauncherItem['type']>;
  presets?: Array<{ id: '1' | '2' | '3'; label?: string; spaces: Space[] }>;
  currentPresetId?: '1' | '2' | '3';
  onSave: (spaceId: string, item: Omit<LauncherItem, 'id'> | LauncherItem, targetPresetId?: '1' | '2' | '3') => void;
  /** Optional — fires the post-save "꾸미기" toast nudge for the
   *  brain-off path. Parent looks up the just-added card by id and
   *  re-opens the dialog with `startAdvanced` so the user can swap
   *  icon / pick colour without leaving keyboard rhythm. */
  onRequestAdvanced?: (spaceId: string) => void;
  /** True when re-opened from the toast nudge — bypasses phases and
   *  renders the advanced editor only. */
  startAdvanced?: boolean;
  /** Optional — phase ③ "🎯 화면에서 고르기" button calls this with
   *  the in-progress item. Parent typically hides the dialog and
   *  enables a click-on-space picker mode in the main UI. Omit to
   *  hide the button. */
  onPickOnScreen?: (item: Omit<LauncherItem, 'id'>) => void;
  /** Optional — bridge to the in-house toast queue. The dialog's
   *  post-save "꾸미기" nudge prefers this over sonner so the
   *  visual chrome matches every other toast in the app. */
  showToast?: (msg: string, opts?: { actions?: Array<{ label: string; icon: string; onClick: () => void }>; duration?: number }) => void;
}

const TYPE_OPTIONS: Array<{ value: LauncherItem['type']; label: string; icon: string; hint: string }> = [
  { value: 'url',     label: '웹 URL',      icon: 'language',       hint: 'https://...' },
  { value: 'folder',  label: '폴더',        icon: 'folder',         hint: 'C:\\...' },
  { value: 'app',     label: '앱',          icon: 'apps',           hint: '.exe / .lnk' },
  { value: 'doc',     label: '문서',        icon: 'description',    hint: '.docx / .pdf / .hwp …' },
  { value: 'memo',    label: '메모',        icon: 'sticky_note_2',  hint: '본문 내용 직접' },
  { value: 'text',    label: '텍스트',      icon: 'content_paste',  hint: '클립보드 복사' },
  { value: 'cmd',     label: '커맨드',      icon: 'terminal',       hint: 'cmd 한 줄' },
  { value: 'window',  label: '창 포커스',   icon: 'select_window',  hint: '창 제목' },
  { value: 'browser', label: '브라우저 탭', icon: 'tab',            hint: '확장 필요' },
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

type Phase = 0 | 1 | 2;
const PHASE_LABELS = ['유형', '값·이름', '위치'];
/** Material-symbol names are lowercase + underscore; emoji are
 *  multi-byte glyphs in the dingbat / supplemental ranges. Same
 *  predicate SpaceAccordion uses to render space.icon correctly. */
const isEmojiIcon = (s: string) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s);

// ── Glassmorphic phase navigation buttons (v1.3.34) ──────────────────
// Floating `<` / `>` over the phase slider edges. Frosted backdrop blur
// + 1px inner ring for the "glass" feel. Hover bumps the saturation
// and accent ring; default state is calm enough to not steal attention
// from the form content.
const GLASS_NAV_SIZE = 34;
function glassNavBtn(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    top: '50%',
    [side]: 8,
    transform: 'translateY(-50%)',
    width:  GLASS_NAV_SIZE,
    height: GLASS_NAV_SIZE,
    borderRadius: '50%',
    background: 'color-mix(in srgb, var(--bg-rgba) 60%, transparent)',
    backdropFilter: 'blur(10px) saturate(120%)',
    WebkitBackdropFilter: 'blur(10px) saturate(120%)',
    border: '1px solid color-mix(in srgb, var(--border-rgba) 80%, transparent)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 5,
    fontFamily: 'inherit',
    transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), background 0.15s, border-color 0.15s',
  };
}
const glassNavBtnHover: React.CSSProperties = {
  transform: 'translateY(-50%) scale(1.06)',
  background: 'color-mix(in srgb, var(--bg-rgba) 80%, transparent)',
  borderColor: 'var(--accent)',
};
const glassNavBtnReset: React.CSSProperties = {
  transform: 'translateY(-50%) scale(1)',
  background: 'color-mix(in srgb, var(--bg-rgba) 60%, transparent)',
  borderColor: 'color-mix(in srgb, var(--border-rgba) 80%, transparent)',
};

export function ItemDialog({
  open, onClose, spaces, editItem, defaultSpaceId, monitorCount = 1,
  allowedTypes, presets, currentPresetId, onSave,
  onRequestAdvanced, startAdvanced, onPickOnScreen, showToast,
}: ItemDialogProps) {
  useBusyMark('modal:item-edit', open);
  const isEdit = !!(editItem && 'id' in editItem && editItem.id);

  const initialPresetId: '1' | '2' | '3' | undefined = (() => {
    if (!isEdit || !presets || !editItem) return currentPresetId;
    const owning = presets.find(p => p.spaces.some(s => s.items.some(i => i.id === (editItem as LauncherItem).id)));
    return (owning?.id as '1' | '2' | '3' | undefined) ?? currentPresetId;
  })();

  type ItemForm = {
    title: string;
    type: LauncherItem['type'];
    value: string;
    color: string;
    presetId?: '1' | '2' | '3';
    spaceId: string;
    iconType: 'material' | 'image';
    icon: string;
    monitor: number | undefined;
  };

  const [form, setForm] = useState<ItemForm>(() => ({
    title: editItem?.title ?? '',
    type: editItem?.type ?? (allowedTypes?.[0] ?? 'url'),
    value: editItem?.value ?? '',
    color: editItem?.color ?? '',
    presetId: initialPresetId,
    spaceId: (() => {
      if (isEdit && editItem && presets) {
        for (const p of presets) {
          const s = p.spaces.find(sp => sp.items.some(i => i.id === (editItem as LauncherItem).id));
          if (s) return s.id;
        }
      }
      if (editItem) return spaces.find(s => s.items.some(i => i.id === editItem.id))?.id ?? defaultSpaceId ?? spaces[0]?.id ?? '';
      return defaultSpaceId ?? spaces[0]?.id ?? '';
    })(),
    iconType: editItem?.iconType ?? 'material',
    icon: editItem?.icon ?? 'star',
    monitor: editItem?.monitor ?? undefined,
  }));

  const visibleSpaces: Space[] = (() => {
    if (!presets || !form.presetId) return spaces;
    const p = presets.find(pp => pp.id === form.presetId);
    return p?.spaces ?? spaces;
  })();


  const [iconSearch, setIconSearch] = useState(isEdit && editItem?.iconType === 'material' ? editItem.icon ?? '' : '');
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [autoFavicon, setAutoFavicon] = useState(false);
  const [clipboardHint, setClipboardHint] = useState<{ type: LauncherItem['type']; label: string } | null>(null);
  const advancedTouchedRef = useRef(!!startAdvanced || isEdit);
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

  const isWidgetMode = form.type === 'widget';
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

  /* ── Type plausibility ─────────────────────────────────────────
   * Three layers of narrowing the type cards visible to the user:
   *   1. Caller-supplied `allowedTypes` (drag-drop / scan context).
   *   2. Value-derived plausibility — paths can't be URLs, etc.
   *      Empty value = no signal, so all types pass.
   *   3. User override (`showAllTypes` toggled via "다른 유형 보기")
   *      — bypasses #2 only, never #1.
   *
   * Effective option list = TYPE_OPTIONS ∩ allowed ∩ (plausible ∪
   * override). If everything would be hidden by plausibility, we
   * still show the override-revealed full list for sanity. */
  const [showAllTypes, setShowAllTypes] = useState(false);
  const plausibleSet = useMemo(() => plausibleTypes(form.value), [form.value]);

  const typeOptions = useMemo(() => {
    let opts = TYPE_OPTIONS;
    if (allowedTypes && allowedTypes.length > 0) {
      opts = opts.filter(o => allowedTypes.includes(o.value));
    }
    if (!showAllTypes) {
      const narrowed = opts.filter(o => plausibleSet.has(o.value));
      // Sanity guard: if plausibility hid everything (e.g. exotic
      // value the rules don't recognise), fall back to the wider
      // post-allowedTypes set so the user can always pick something.
      if (narrowed.length > 0) opts = narrowed;
    }
    return opts;
  }, [allowedTypes, plausibleSet, showAllTypes]);

  const hiddenTypeCount = useMemo(() => {
    const baseCount = (allowedTypes && allowedTypes.length > 0)
      ? TYPE_OPTIONS.filter(o => allowedTypes.includes(o.value)).length
      : TYPE_OPTIONS.length;
    return showAllTypes ? 0 : Math.max(0, baseCount - typeOptions.length);
  }, [allowedTypes, showAllTypes, typeOptions.length]);

  const typeLocked = typeOptions.length <= 1;

  /* Auto-correct: when the value changes such that the currently
   * selected type is no longer plausible, snap to the first
   * plausible option. Skip while the user has opted into
   * "다른 유형 보기" — that's a deliberate override. */
  useEffect(() => {
    if (showAllTypes) return;
    if (isWidgetMode) return;
    if (!form.value.trim()) return;
    if (plausibleSet.has(form.type)) return;
    const next = typeOptions[0]?.value;
    if (next && next !== form.type) f({ type: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plausibleSet, showAllTypes]);

  /* ── Smart space recommendation ─────────────────────────────
   * Score each visible space against the in-progress value, then
   * surface the strongest match as the recommended landing spot.
   * Heuristics by type:
   *   url/browser : matching hostname → +10/match
   *   folder/app  : same parent folder → +6/match, same drive → +1
   *   text/cmd/window : skip (too noisy)
   * A busy space gets a tiny tiebreaker (+0.5 per item) so a frequently
   * touched space wins over a near-empty one with one coincidence. */
  const recommendedSpaceId: string | null = useMemo(() => {
    const v = form.value.trim();
    if (!v) return null;
    if (form.type === 'text' || form.type === 'cmd' || form.type === 'window') return null;
    if (isWidgetMode) return null;

    const hostFor = (url: string): string | null => {
      try {
        const u = new URL(/^https?:\/\//.test(url) ? url : 'https://' + url);
        return u.hostname.replace(/^www\./, '').toLowerCase();
      } catch { return null; }
    };
    const dirFor = (p: string): string | null => {
      const m = p.match(/^(.*[\\/])[^\\/]+$/);
      return m ? m[1].toLowerCase() : null;
    };
    const driveFor = (p: string): string | null => {
      const m = p.match(/^([A-Za-z]:[\\/])/);
      return m ? m[1].toLowerCase() : null;
    };

    const targetHost = (form.type === 'url' || form.type === 'browser') ? hostFor(v) : null;
    const targetDir  = (form.type === 'folder' || form.type === 'app') ? dirFor(v) : null;
    const targetDrive = (form.type === 'folder' || form.type === 'app') ? driveFor(v) : null;
    if (!targetHost && !targetDir && !targetDrive) return null;

    let best: { id: string; score: number } | null = null;
    for (const s of visibleSpaces) {
      let score = 0;
      for (const it of s.items) {
        if (it.id === editItem?.id) continue;
        if (targetHost && (it.type === 'url' || it.type === 'browser')) {
          if (hostFor(it.value) === targetHost) score += 10;
        }
        if (targetDir && (it.type === 'folder' || it.type === 'app')) {
          if (dirFor(it.value) === targetDir) score += 6;
        }
        if (targetDrive && (it.type === 'folder' || it.type === 'app')) {
          if (driveFor(it.value) === targetDrive) score += 1;
        }
      }
      if (score > 0) score += s.items.length * 0.5;
      if (score > 0 && (!best || score > best.score)) best = { id: s.id, score };
    }
    return best?.id ?? null;
  }, [form.value, form.type, isWidgetMode, visibleSpaces, editItem?.id]);

  /* ── Phase state ────────────────────────────────────────────
   * Always start at phase 0 (TYPE) so the user sees the full
   * 3-step flow. Exceptions:
   *   - widget mode: phase 0 is the colour/name editor; edit reopens
   *     at place.
   *   - typeLocked (caller fixed the kind, e.g. dedicated "add memo"
   *     entry): start at VALUE since TYPE has nothing to choose. */
  const initialPhase: Phase = (() => {
    if (isWidgetMode) return isEdit ? 2 : 0;
    if (typeLocked) return 1;
    return 0;
  })();
  const [phase, setPhase] = useState<Phase>(initialPhase);

  /* ── Validation + derived title ─────────────────────────── */
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

  const derivedTitle: string = useMemo(() => {
    const v = form.value.trim();
    if (!v) return '';
    try {
      switch (form.type) {
        case 'url':
        case 'browser': {
          const u = new URL(/^https?:\/\//.test(v) ? v : 'https://' + v);
          return u.hostname.replace(/^www\./, '');
        }
        case 'folder':
        case 'app': {
          const last = v.split(/[\\/]/).pop() ?? v;
          return last.replace(/\.(exe|lnk|bat|cmd)$/i, '');
        }
        case 'text': {
          const firstLine = v.split(/\r?\n/).find(l => l.trim()) ?? v;
          return firstLine.slice(0, 32);
        }
        case 'cmd':
          return v.split(/\s+/)[0] ?? v;
        case 'window':
          return v.slice(0, 32);
        default:
          return v.slice(0, 32);
      }
    } catch {
      return v.slice(0, 32);
    }
  }, [form.type, form.value]);

  const phaseComplete = useCallback((p: Phase): boolean => {
    if (isWidgetMode) {
      // Widget: phase 0 = colour+name editor, phase 1 unused, phase 2 = place
      if (p === 0) return !!form.title.trim() && (!isColorSwatch || /^#[0-9A-F]{6}$/i.test(swatchHex));
      if (p === 2) return !!form.spaceId;
      return true;
    }
    if (p === 0) return !!form.type;
    // Memo body can be empty — user fills it in the editor after save.
    // form.value carries the body for type==='memo'; no validation gate.
    if (p === 1) return form.type === 'memo' ? true : (!!form.value.trim() && !valueError);
    if (p === 2) return !!form.spaceId;
    return false;
  }, [form.type, form.value, form.title, form.spaceId, valueError, isWidgetMode, isColorSwatch, swatchHex]);

  const firstIncompletePhase = (): Phase => {
    if (isWidgetMode) {
      if (!phaseComplete(0)) return 0;
      return 2;
    }
    if (!phaseComplete(0)) return 0;
    if (!phaseComplete(1)) return 1;
    return 2;
  };

  const goPhase = useCallback((p: Phase) => {
    setPhase(p);
  }, []);

  /** Phase navigation helpers — widget mode skips phase 1 entirely
   *  (no value/name to edit; the swatch editor lives on phase 0).
   *  Earlier the slider walked 0→1→2 even in widget mode and the
   *  user briefly saw the empty phase 1 panel. */
  const nextPhase = useCallback((p: Phase): Phase => {
    if (isWidgetMode && p === 0) return 2;
    return (p < 2 ? p + 1 : p) as Phase;
  }, [isWidgetMode]);
  const prevPhase = useCallback((p: Phase): Phase => {
    if (isWidgetMode && p === 2) return 0;
    return (p > 0 ? p - 1 : p) as Phase;
  }, [isWidgetMode]);
  const isLastPhase = useCallback((p: Phase) => isWidgetMode ? p === 2 : p === 2, [isWidgetMode]);
  const isFirstPhase = useCallback((p: Phase) => p === 0, []);

  /* ── Effects: clipboard, favicon, file icon ─────────────── */
  useEffect(() => {
    if (!open) return;
    if (isEdit) return;
    if (form.value) return;
    if (allowedTypes) return;
    if (isWidgetMode) return;
    let cancelled = false;
    (async () => {
      // ItemDialog reaches into AppData via its props (no settings prop
      // currently); for the doc-extensions arg we fall back to undefined
      // here so main.js uses its default doc list. If we later thread
      // the user's customised list through, this is the swap point.
      const r = await electronAPI.analyzeClipboard();
      if (cancelled) return;
      if (r.type === 'none' || !r.value) return;
      const mapped: LauncherItem['type'] | null =
        r.type === 'url' ? 'url' :
        r.type === 'app' ? 'app' :
        r.type === 'doc' ? 'doc' :
        r.type === 'folder' ? 'folder' :
        r.type === 'text' ? 'text' :
        null;
      if (!mapped) return;
      setForm(prev => ({
        ...prev,
        type: mapped,
        value: r.value!,
        title: prev.title || r.label || '',
      }));
      setClipboardHint({ type: mapped, label: r.label ?? r.value! });
      // Clipboard pre-fill makes phase ① redundant — jump to ② so the
      // user just confirms. They can swipe back if they want a different type.
      goPhase(1);
      window.setTimeout(() => setClipboardHint(null), 4500);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  /* ── Icon helpers (advanced editor) ─────────────────────── */
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

  /* ── File pickers ─────────────────────────────────────────── */
  const handlePickFolder = async () => {
    const p = await electronAPI.pickFolder();
    if (p) {
      const fallbackName = p.split('\\').pop() || p;
      f({ value: p, ...(form.title ? {} : { title: fallbackName }) });
    }
  };

  const handlePickExe = async () => {
    const p = await electronAPI.pickExe();
    if (p) {
      const name = p.split('\\').pop()?.replace(/\.(exe|lnk)$/i, '') || p;
      f({ value: p, ...(form.title ? {} : { title: name }) });
    }
  };

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
  function buildItemPayload(): Omit<LauncherItem, 'id'> | LauncherItem | null {
    // Memo type: title and body are both optional (addMemo computes a
    // title from the body, and an empty memo is a valid blank scratchpad
    // matching the existing handleAddMemo button flow).
    const isMemoType = form.type === 'memo';
    const finalTitle = isMemoType
      ? form.title.trim()
      : (form.title.trim() || derivedTitle);
    if (!isMemoType && !finalTitle) return null;
    if (!isWidgetMode && !isMemoType && !form.value.trim()) return null;

    const base = {
      title: finalTitle,
      type: form.type,
      value: form.value,
      color: form.color || undefined,
      icon: form.icon,
      iconType: form.iconType,
      monitor: form.monitor,
      ...(editItem?.exePath ? { exePath: editItem.exePath } : {}),
    };

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
      return { ...editItem, ...base, ...(widget ? { widget } : {}) } as LauncherItem;
    }
    return { ...base, ...(widget ? { widget } : {}) } as Omit<LauncherItem, 'id'>;
  }

  function handleSave(targetSpaceId?: string) {
    const payload = buildItemPayload();
    if (!payload) {
      const p = firstIncompletePhase();
      goPhase(p);
      return;
    }
    const useSpace = targetSpaceId || form.spaceId;
    if (isEdit) {
      const presetMoved = !!(form.presetId && initialPresetId && form.presetId !== initialPresetId);
      onSave(useSpace, payload as LauncherItem, presetMoved ? form.presetId : undefined);
    } else {
      onSave(useSpace, payload as Omit<LauncherItem, 'id'>);
      if (!advancedTouchedRef.current && onRequestAdvanced && showToast) {
        showToast('카드 추가됨 · 아이콘이나 색상을 바꿔볼까요?', {
          actions: [{
            label: '꾸미기',
            icon: 'palette',
            onClick: () => onRequestAdvanced(useSpace),
          }],
          duration: 5000,
        });
      }
    }
    onClose();
  }

  /* ── Phase auto-advance handlers ────────────────────────── */
  const handlePickType = (t: LauncherItem['type']) => {
    // If the current value is incompatible with the new type, clear it.
    // Concretely: a .txt drag-drop pre-fills the dialog with type=memo
    // and value=file body. If the user pivots to type=app, the body
    // would otherwise sit in the file-path input — incoherent. The
    // plausibility check gives us a free incompatibility test.
    const v = form.value.trim();
    if (v) {
      const okTypes = plausibleTypes(v);
      if (!okTypes.has(t)) {
        f({ type: t, value: '' });
      } else {
        f({ type: t });
      }
    } else {
      f({ type: t });
    }
    setClipboardHint(null);
    // Tiny dwell so the user sees the selection state before sliding.
    window.setTimeout(() => goPhase(1), 120);
  };

  const handleValueEnter = () => {
    if (!form.value.trim() || valueError) return;
    goPhase(2);
  };

  const handlePickSpace = (sid: string) => {
    f({ spaceId: sid });
    handleSave(sid);
  };

  /* ── Keyboard nav ───────────────────────────────────────────
   * Bound on `document` with capture: true — Radix Dialog's own
   * keydown handlers bubble first by default, and an earlier
   * `window`-level binding was occasionally beaten by them on
   * Ctrl+Enter (the close button focused inside the trap, Enter
   * fires its click before our handler sees the event). Capture
   * ensures we always run first.
   *
   * Stale-closure guard: `handleSave` / `goPhase` / `phaseComplete`
   * are read via refs that always point to the latest render —
   * otherwise the listener freezes on the first render's closures
   * and Ctrl+Enter ends up calling stale form state. */
  const latestRef = useRef({
    phase,
    handleSave: (_?: string) => {},
    goPhase,
    phaseComplete,
    nextPhase,
    prevPhase,
    isFirstPhase,
    isLastPhase,
  });
  useEffect(() => {
    latestRef.current = { phase, handleSave, goPhase, phaseComplete, nextPhase, prevPhase, isFirstPhase, isLastPhase };
  });
  useEffect(() => {
    if (!open || startAdvanced) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      const cur = latestRef.current;
      // Power-user shortcut — Ctrl/Cmd+Enter anywhere submits, regardless
      // of phase or input focus. Kept for muscle memory; new users get
      // the simpler Enter-Enter flow below.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        cur.handleSave();
        return;
      }
      // Plain Enter (no input focused) — chains forward:
      //   phase ① type        → advance to ② if type is set
      //   phase ② value+name  → advance to ③ if value passes validation
      //   phase ③ place       → submit (handleSave)
      // Inputs handle their own Enter via onKeyDown in renderValuePhase
      // (advance to next phase), so "type a value + Enter + Enter" naturally
      // ends in save with no Ctrl needed.
      if (e.key === 'Enter' && !inInput && !e.metaKey && !e.ctrlKey) {
        if (cur.isLastPhase(cur.phase)) {
          e.preventDefault(); e.stopPropagation();
          cur.handleSave();
        } else if (cur.phaseComplete(cur.phase)) {
          e.preventDefault(); e.stopPropagation();
          cur.goPhase(cur.nextPhase(cur.phase));
        }
        return;
      }
      // Tab — page-style navigation (v1.3.34). Treat like the glass `>`
      // button: advance phase when current is complete, otherwise no-op
      // (instead of cycling focus to a child element which leaves the
      // user stranded mid-dialog). Shift+Tab goes backward like `<`.
      // We intercept Tab BEFORE the browser's default tabindex traversal
      // by stopping immediate propagation in addition to preventDefault.
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.shiftKey) {
          if (!cur.isFirstPhase(cur.phase)) {
            e.preventDefault(); e.stopPropagation();
            cur.goPhase(cur.prevPhase(cur.phase));
          }
        } else {
          if (!cur.isLastPhase(cur.phase) && cur.phaseComplete(cur.phase)) {
            e.preventDefault(); e.stopPropagation();
            cur.goPhase(cur.nextPhase(cur.phase));
          }
        }
        return;
      }
      if (e.key === 'ArrowLeft' && !inInput) {
        if (!cur.isFirstPhase(cur.phase)) { e.preventDefault(); cur.goPhase(cur.prevPhase(cur.phase)); }
      } else if (e.key === 'ArrowRight' && !inInput) {
        if (!cur.isLastPhase(cur.phase) && cur.phaseComplete(cur.phase)) {
          e.preventDefault(); cur.goPhase(cur.nextPhase(cur.phase));
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, startAdvanced]);

  /* ── Auto-focus the relevant input each phase ───────────── */
  const valueInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open || startAdvanced) return;
    const t = window.setTimeout(() => {
      if (phase === 1) valueInputRef.current?.focus();
    }, 220);
    return () => window.clearTimeout(t);
  }, [open, startAdvanced, phase]);

  /* ── Render: advanced (re-open) mode ────────────────────── */
  if (startAdvanced) {
    return (
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent style={{ width: 560, maxWidth: '92vw', padding: 0, overflow: 'hidden' }}>
          <DialogHeader style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--border-rgba)' }}>
            <DialogTitle style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-color)' }}>
              꾸미기 — {form.title || derivedTitle || '카드'}
            </DialogTitle>
          </DialogHeader>
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 'calc(82vh - 110px)', overflowY: 'auto' }}>
            {renderAdvancedSection({
              form, cropSrc, setCropSrc, imgRef, handleCropApply,
              setAutoFavicon, setForm, iconTab, setIconTab,
              iconSearch, setIconSearch, filteredIcons, selectMaterialIcon,
              fetchFavicon, fetchFileIcon, resetIcon, fileRef, handleFileChange,
              f,
            })}
          </div>
          <DialogFooter style={{ padding: '12px 20px', borderTop: '1px solid var(--border-rgba)' }}>
            <Button variant="ghost" onClick={onClose}>닫기</Button>
            {/* Inline shortcut chip removed (was producing the awkward
                left-only margin on the dark Save button). Modern apps
                surface keyboard hints in the hover tooltip — see
                `title` below — and document them in the help / shortcut
                cheat sheet, not on the button face. */}
            <Button onClick={() => handleSave()} title="저장 (Ctrl + Enter)">
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  /* ── Render: phase shell ─────────────────────────────────── */
  const sliderTransform = `translateX(${-phase * 100}%)`;
  const sliderTransition = 'transform 0.28s cubic-bezier(0.4, 0.1, 0.3, 1)';
  const canGoNext = phaseComplete(phase) && !isLastPhase(phase);
  const isPlace = isLastPhase(phase);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent data-tour-id="item-dialog" style={{ width: 580, maxWidth: '94vw', padding: 0, overflow: 'hidden' }}>
        <DialogHeader style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border-rgba)' }}>
          <DialogTitle style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-color)' }}>
            {isEdit ? '카드 수정' : '카드 추가'}
          </DialogTitle>
        </DialogHeader>

        {/* Phase tabs — clickable progress dots with labels. Below
            them, a 2px progress line that grows with the active phase
            ratio. The line lives in a 1px-tall track so it doesn't
            stack visually with the dialog header border. */}
        <div style={{
          position: 'relative', height: 2,
          background: 'color-mix(in srgb, var(--border-rgba) 60%, transparent)',
        }}>
          <div style={{
            position: 'absolute', inset: 0, right: 'auto',
            width: `${((isWidgetMode
              ? (phase === 0 ? 0.5 : 1)
              : ((phase + 1) / 3)) * 100)}%`,
            background: 'var(--accent)',
            transition: 'width 0.32s cubic-bezier(0.4, 0.1, 0.3, 1)',
          }} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0,
          padding: '12px 20px 6px',
        }}>
          {(isWidgetMode ? [0, 2] : [0, 1, 2]).map((p, i, arr) => {
            const active = phase === p;
            const reachable = p === 0 || phaseComplete((p - 1) as Phase) || phaseComplete(p as Phase);
            const labelOverride = isWidgetMode && p === 0 ? '색·이름' : PHASE_LABELS[p];
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => reachable && goPhase(p as Phase)}
                  disabled={!reachable}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', borderRadius: 99,
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    border: 'none',
                    color: active ? 'var(--accent)' : reachable ? 'var(--text-muted)' : 'var(--text-dim)',
                    fontSize: 11, fontWeight: active ? 700 : 500,
                    cursor: reachable ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'var(--accent)' : phaseComplete(p as Phase) ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--surface)',
                    color: active ? '#fff' : phaseComplete(p as Phase) ? 'var(--accent)' : 'var(--text-dim)',
                    fontSize: 10, fontWeight: 700,
                    border: active ? 'none' : `1px solid ${phaseComplete(p as Phase) ? 'var(--accent)' : 'var(--border-rgba)'}`,
                  }}>
                    {phaseComplete(p as Phase) && !active ? '✓' : (isWidgetMode && p === 2 ? 2 : p + 1)}
                  </span>
                  {labelOverride}
                </button>
                {i < arr.length - 1 && (
                  <span style={{
                    width: 24, height: 1, background: 'var(--border-rgba)', margin: '0 2px',
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Phase slider — overflow hidden, transform-translateX.
            Phase navigation surfaces (v1.3.34):
              - Tab dots above (jump to any phase)
              - Tab / Shift+Tab keys (page-style nav)
              - Arrow keys ← / →
              - Floating glass `<` / `>` buttons on each edge (new!)
              - Plain Enter chains forward; Enter at last phase saves
            Pointer-drag/swipe was removed earlier (caused accidental
            phase changes during marquee selection of chips).
            Width/box-sizing locked at every layer so content-driven
            growth (long unbreakable tokens in inputs/textareas) can't
            inflate the inner flex past the viewport — that would make
            translateX(-100%) over-shift and bleed the next phase in. */}
        <div style={{ overflow: 'hidden', userSelect: 'none', width: '100%', boxSizing: 'border-box', position: 'relative' }}>
          {/* Glass-morph prev/next buttons — absolutely positioned over
              the slider's vertical centre, hidden at the boundaries so
              first phase shows only `>` and last phase only `<`. Uses
              backdrop-filter for the frosted look against whichever
              phase content sits behind. */}
          {!isFirstPhase(phase) && (
            <button
              type="button"
              onClick={() => goPhase(prevPhase(phase))}
              title="이전 단계 (Shift+Tab / ←)"
              style={glassNavBtn('left')}
              onMouseEnter={e => Object.assign(e.currentTarget.style, glassNavBtnHover)}
              onMouseLeave={e => Object.assign(e.currentTarget.style, glassNavBtnReset)}
            >
              <Icon name="chevron_left" size={18} color="var(--text-color)" />
            </button>
          )}
          {!isLastPhase(phase) && phaseComplete(phase) && (
            <button
              type="button"
              onClick={() => goPhase(nextPhase(phase))}
              title="다음 단계 (Tab / Enter / →)"
              style={glassNavBtn('right')}
              onMouseEnter={e => Object.assign(e.currentTarget.style, glassNavBtnHover)}
              onMouseLeave={e => Object.assign(e.currentTarget.style, glassNavBtnReset)}
            >
              <Icon name="chevron_right" size={18} color="var(--text-color)" />
            </button>
          )}
          <div style={{
            display: 'flex',
            width: '100%',
            boxSizing: 'border-box',
            transform: sliderTransform,
            transition: sliderTransition,
            minHeight: 380,
          }}>
            {/* Phase ① — Type / (widget) Color+Name */}
            <div style={{ flex: '0 0 100%', width: '100%', boxSizing: 'border-box', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, overflow: 'hidden' }}>
              {isWidgetMode ? (
                renderWidgetPhase({
                  isColorSwatch, swatchHex, setSwatchHex, swatchName, setSwatchName,
                  title: form.title, onTitleChange: (v: string) => f({ title: v }),
                  derivedTitle, titleInputRef,
                })
              ) : (
                renderTypePhase({
                  typeOptions, current: form.type, onPick: handlePickType,
                  typeLocked, clipboardHint, setClipboardHint,
                  hiddenTypeCount, showAllTypes,
                  onToggleShowAll: () => setShowAllTypes(s => !s),
                })
              )}
            </div>

            {/* Phase ② — Value + Name */}
            <div style={{ flex: '0 0 100%', width: '100%', boxSizing: 'border-box', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, overflow: 'hidden' }}>
              {!isWidgetMode && renderValuePhase({
                form, f,
                valueInputRef, titleInputRef,
                derivedTitle, valueError, duplicateItem,
                onPickFolder: handlePickFolder, onPickExe: handlePickExe,
                onEnterCommit: handleValueEnter,
              })}
            </div>

            {/* Phase ③ — Place */}
            <div style={{ flex: '0 0 100%', width: '100%', boxSizing: 'border-box', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, overflow: 'hidden' }}>
              {renderPlacePhase({
                visibleSpaces, recommendedSpaceId,
                form, f, isEdit, presets,
                monitorCount, isWidgetMode,
                onPickSpace: handlePickSpace,
                onPickPreset: (pid) => {
                  const p = presets?.find(pp => pp.id === pid);
                  const firstSpaceId = p?.spaces[0]?.id ?? '';
                  setForm(prev => ({ ...prev, presetId: pid, spaceId: firstSpaceId }));
                },
                onPickOnScreen: onPickOnScreen
                  ? () => {
                      const payload = buildItemPayload();
                      if (!payload) { goPhase(firstIncompletePhase()); return; }
                      onPickOnScreen(payload as Omit<LauncherItem, 'id'>);
                    }
                  : undefined,
              })}
            </div>
          </div>
        </div>

        <DialogFooter style={{ padding: '12px 20px', borderTop: '1px solid var(--border-rgba)', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="ghost" onClick={onClose}>취소</Button>
            {!isFirstPhase(phase) && (
              <Button variant="ghost" onClick={() => goPhase(prevPhase(phase))}>
                이전
              </Button>
            )}
          </div>
          <div>
            {!isPlace ? (
              <Button
                onClick={() => goPhase(nextPhase(phase))}
                disabled={!canGoNext}
                title="다음 (Enter 또는 우측 드래그)"
              >
                다음
              </Button>
            ) : (
              <Button
                onClick={() => handleSave()}
                disabled={!phaseComplete(2) || !(form.title.trim() || derivedTitle) || (!isWidgetMode && !form.value.trim())}
                title={`${isEdit ? '저장' : '추가'} (Ctrl + Enter)`}
              >
                {isEdit ? '저장' : '추가'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Phase renderers — kept as plain functions (not components) so
 * they share the parent's closure state without ref/prop juggling.
 * Pure JSX-returning helpers; no hooks inside.
 * ───────────────────────────────────────────────────────────── */

function renderTypePhase({
  typeOptions, current, onPick, typeLocked, clipboardHint, setClipboardHint,
  hiddenTypeCount, showAllTypes, onToggleShowAll,
}: {
  typeOptions: typeof TYPE_OPTIONS;
  current: LauncherItem['type'];
  onPick: (t: LauncherItem['type']) => void;
  typeLocked: boolean;
  clipboardHint: { type: LauncherItem['type']; label: string } | null;
  setClipboardHint: (v: null) => void;
  hiddenTypeCount: number;
  showAllTypes: boolean;
  onToggleShowAll: () => void;
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 style={phaseHeadingStyle}>어떤 카드인가요?</h2>
        {clipboardHint && (
          <button
            type="button"
            onClick={() => setClipboardHint(null)}
            title="클립보드에서 자동 감지된 유형. 다른 카드를 누르면 바뀝니다."
            style={chipStyle}
          >
            <Icon name="content_paste" size={11} color="var(--accent)" />
            클립보드에서
          </button>
        )}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10,
        marginTop: 4,
      }}>
        {typeOptions.map(o => {
          const active = o.value === current;
          return (
            <button
              key={o.value}
              type="button"
              disabled={typeLocked && !active}
              onClick={() => onPick(o.value)}
              title={`${o.label} : ${o.hint}`}
              style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 8,
                padding: '20px 12px',
                minHeight: 110,
                borderRadius: 12,
                background: active ? 'var(--accent-dim)' : 'var(--surface)',
                border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-rgba)'}`,
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                cursor: typeLocked && !active ? 'default' : 'pointer',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                transition: 'all 0.15s',
                opacity: typeLocked && !active ? 0.4 : 1,
                transform: active ? 'scale(1.02)' : 'scale(1)',
              }}
            >
              <Icon name={o.icon} size={28} color={active ? 'var(--accent)' : 'var(--text-muted)'} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                <span>{o.label}</span>
                <span style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--text-dim)', fontWeight: 400 }}>{o.hint}</span>
              </div>
            </button>
          );
        })}
      </div>
      {/* Override link — surfaces only when plausibility hid types
          AND the user hasn't already opted into the full list. The
          link disappears once expanded so it doesn't shout "go back"
          at the user; they can re-narrow by editing the value. */}
      {(hiddenTypeCount > 0 || showAllTypes) && (
        <button
          type="button"
          onClick={onToggleShowAll}
          style={{
            alignSelf: 'center',
            marginTop: 4,
            padding: '4px 10px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            fontSize: 10.5,
            fontFamily: 'inherit',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          {showAllTypes ? '추천 유형만 보기' : `다른 유형 보기 (${hiddenTypeCount}개 더)`}
        </button>
      )}
    </>
  );
}

function renderWidgetPhase({
  isColorSwatch, swatchHex, setSwatchHex, swatchName, setSwatchName,
  title, onTitleChange, derivedTitle, titleInputRef,
}: {
  isColorSwatch: boolean;
  swatchHex: string;
  setSwatchHex: (v: string) => void;
  swatchName: string;
  setSwatchName: (v: string) => void;
  title: string;
  onTitleChange: (v: string) => void;
  derivedTitle: string;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  if (!isColorSwatch) {
    return (
      <>
        <h2 style={phaseHeadingStyle}>이름</h2>
        <Input
          ref={titleInputRef}
          value={title}
          onChange={e => onTitleChange(e.target.value)}
          placeholder={derivedTitle ? `${derivedTitle}  (Enter로 그대로 사용)` : '카드 이름'}
          style={{ height: 44, fontSize: 14, borderRadius: 10 }}
          autoFocus
        />
      </>
    );
  }
  return (
    <>
      <h2 style={phaseHeadingStyle}>색상과 이름</h2>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <label style={{
          position: 'relative',
          width: 88, height: 88, borderRadius: 16,
          background: swatchHex,
          border: '1px solid var(--border-rgba)',
          cursor: 'pointer', flexShrink: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}>
          <input
            type="color"
            value={swatchHex}
            onChange={e => setSwatchHex(e.target.value.toUpperCase())}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none' }}
          />
        </label>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input
            value={swatchHex}
            onChange={e => {
              const v = e.target.value.toUpperCase();
              if (/^#?[0-9A-F]{0,6}$/.test(v)) {
                setSwatchHex(v.startsWith('#') ? v : '#' + v);
              }
            }}
            placeholder="#RRGGBB"
            className="font-mono text-xs"
            style={{ height: 36, fontSize: 13 }}
          />
          <Input
            ref={titleInputRef}
            value={swatchName}
            onChange={e => { setSwatchName(e.target.value); onTitleChange(e.target.value); }}
            placeholder="이름 (선택) — 예: 브랜드 프라이머리"
            style={{ height: 36, fontSize: 13 }}
          />
        </div>
      </div>
    </>
  );
}

function renderValuePhase({
  form, f,
  valueInputRef, titleInputRef,
  derivedTitle, valueError, duplicateItem,
  onPickFolder, onPickExe, onEnterCommit,
}: {
  form: any;
  f: (patch: any) => void;
  valueInputRef: React.RefObject<HTMLInputElement | null>;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  derivedTitle: string;
  valueError: string | null;
  duplicateItem: { item: LauncherItem; space: Space } | null;
  onPickFolder: () => void;
  onPickExe: () => void;
  onEnterCommit: () => void;
}) {
  const valueLabel =
    form.type === 'url' || form.type === 'browser' ? 'URL' :
    form.type === 'folder' ? '폴더 경로' :
    form.type === 'app' ? '실행 파일' :
    form.type === 'cmd' ? '커맨드' :
    form.type === 'text' ? '텍스트' :
    form.type === 'memo' ? '메모 본문 (선택)' :
    form.type === 'window' ? '창 제목' : '값';
  const valuePlaceholder =
    form.type === 'url' ? 'https://...'
    : form.type === 'folder' ? 'C:\\Users\\...'
    : form.type === 'app' ? 'C:\\Program Files\\...'
    : form.type === 'cmd' ? 'notepad.exe  /  start "" "C:\\..."'
    : form.type === 'text' ? '클립보드에 복사될 텍스트'
    : form.type === 'memo' ? '본문은 비워두고 나중에 에디터에서 작성해도 됩니다.'
    : form.type === 'window' ? '창 제목 (Alt+Tab에 보이는 이름)'
    : '값 입력';
  // Memo body uses a multi-line textarea — markdown notes don't fit in
  // a single-line input. The same form.value field carries the body
  // through to handleSave, where the memo-routing branch in App.tsx
  // hands it to store.addMemo.
  const isMemoType = form.type === 'memo';
  return (
    <>
      <h2 style={phaseHeadingStyle}>{valueLabel}</h2>
      <div style={{ display: 'flex', gap: 8, minWidth: 0, width: '100%' }}>
        {isMemoType ? (
          <textarea
            value={form.value}
            onChange={e => f({ value: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onEnterCommit(); } }}
            placeholder={valuePlaceholder}
            style={{
              flex: '1 1 auto', minWidth: 0, width: '100%',
              minHeight: 160, maxHeight: 280, padding: '10px 12px',
              borderRadius: 8, border: '1px solid var(--border-rgba)',
              background: 'var(--surface)', color: 'var(--text-color)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12, lineHeight: 1.55, resize: 'vertical',
              outline: 'none',
              overflowWrap: 'anywhere', wordBreak: 'break-word',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <Input
            ref={valueInputRef}
            value={form.value}
            onChange={e => f({ value: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onEnterCommit(); } }}
            placeholder={valuePlaceholder}
            className="font-mono text-xs"
            style={{ flex: '1 1 auto', minWidth: 0, width: '100%', height: 44, fontSize: 13, borderColor: valueError ? 'var(--destructive, #ef4444)' : undefined }}
          />
        )}
        {form.type === 'folder' && (
          <button type="button" onClick={onPickFolder} title="폴더 선택" style={pickerBtnStyle}>
            <Icon name="folder_open" size={18} />
          </button>
        )}
        {form.type === 'app' && (
          <button type="button" onClick={onPickExe} title="실행 파일 선택" style={pickerBtnStyle}>
            <Icon name="apps" size={18} />
          </button>
        )}
      </div>
      {valueError && (
        <p style={{ fontSize: 11, color: 'var(--destructive, #ef4444)', display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
          <Icon name="error" size={12} />{valueError}
        </p>
      )}
      {duplicateItem && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-focus)' }}>
          <Icon name="warning" size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            <b style={{ color: 'var(--text-color)' }}>{duplicateItem.item.title}</b>에 동일한 값이 이미 있습니다 ({duplicateItem.space.name})
          </span>
        </div>
      )}

      <div style={{ height: 1, background: 'var(--border-rgba)', margin: '4px 0' }} />

      <h2 style={{ ...phaseHeadingStyle, fontSize: 12, color: 'var(--text-muted)' }}>이름 (선택)</h2>
      <Input
        ref={titleInputRef}
        value={form.title}
        onChange={e => f({ title: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onEnterCommit(); } }}
        placeholder={derivedTitle ? `${derivedTitle}  (비워두면 자동)` : '카드 이름 (자동 추론)'}
        style={{ height: 38, fontSize: 13, borderRadius: 8 }}
      />
    </>
  );
}

function renderPlacePhase({
  visibleSpaces, recommendedSpaceId,
  form, f, isEdit, presets,
  monitorCount, isWidgetMode,
  onPickSpace, onPickPreset, onPickOnScreen,
}: {
  visibleSpaces: Space[];
  recommendedSpaceId: string | null;
  form: any;
  f: (patch: any) => void;
  isEdit: boolean;
  presets?: Array<{ id: '1' | '2' | '3'; label?: string; spaces: Space[] }>;
  monitorCount: number;
  isWidgetMode: boolean;
  onPickSpace: (sid: string) => void;
  onPickPreset: (pid: '1' | '2' | '3') => void;
  onPickOnScreen?: () => void;
}) {
  // Recommended space, when present, leads the chip grid. Original
  // order is preserved otherwise — we don't re-sort by score, just
  // promote the single best match. This keeps the rest of the list
  // predictable for repeat users.
  const orderedSpaces = recommendedSpaceId
    ? [
        ...visibleSpaces.filter(s => s.id === recommendedSpaceId),
        ...visibleSpaces.filter(s => s.id !== recommendedSpaceId),
      ]
    : visibleSpaces;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={phaseHeadingStyle}>어디에 둘까요?</h2>
        {isEdit && presets && presets.length > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {presets.map(p => {
              const active = p.id === form.presetId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPickPreset(p.id)}
                  style={{
                    padding: '3px 9px', borderRadius: 6,
                    fontSize: 10, fontWeight: active ? 700 : 500,
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-rgba)'}`,
                    color: active ? 'var(--accent)' : 'var(--text-dim)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {p.label || `프리셋 ${p.id}`}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Space chip grid — click to save+close. No own scroll: an
          earlier `overflowY: auto, maxHeight: 200` scrolled but ALSO
          clipped the "추천" badge at the chip's top edge. The badge
          intentionally floats 7px above the chip, so the parent must
          allow vertical overflow. The phase shell (slider) still
          clips horizontally for the slide animation; vertical
          growth is naturally bounded by the dialog viewport. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 8,
        paddingTop: 8,   // gives the floating "추천" badge room before the section above
      }}>
        {orderedSpaces.map(s => {
          const active = s.id === form.spaceId;
          const recommended = s.id === recommendedSpaceId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onPickSpace(s.id)}
              title={`${s.name} — 클릭 즉시 저장${recommended ? ' (도메인/경로 일치 · 추천)' : ''}`}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 12px',
                borderRadius: 10,
                background: active ? 'var(--accent-dim)' : recommended ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : 'var(--surface)',
                border: `1.5px solid ${active || recommended ? 'var(--accent)' : 'var(--border-rgba)'}`,
                color: active ? 'var(--accent)' : 'var(--text-color)',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: active ? 700 : 500,
                textAlign: 'left', minHeight: 50,
                transition: 'all 0.12s',
                boxShadow: recommended && !active ? '0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent)' : undefined,
              }}
            >
              {s.icon && (
                isEmojiIcon(s.icon)
                  ? <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1 }}>{s.icon}</span>
                  : <Icon name={s.icon} size={18} color={active ? 'var(--accent)' : (s.color ?? 'var(--text-muted)')} />
              )}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--text-dim)', fontWeight: 400 }}>
                  {s.items.length}개 카드
                </span>
              </div>
              {recommended && (
                <span
                  aria-label="추천"
                  style={{
                    position: 'absolute', top: -7, right: 8,
                    padding: '1px 7px', fontSize: 9, fontWeight: 700,
                    borderRadius: 99,
                    background: 'var(--accent)',
                    color: '#fff',
                    letterSpacing: 0.3,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                  }}
                >
                  추천
                </span>
              )}
              <Icon name="arrow_forward" size={14} color={active ? 'var(--accent)' : 'var(--text-dim)'} />
            </button>
          );
        })}
      </div>

      {/* Monitor + screen-pick — bottom row. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
        {!isWidgetMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>모니터</span>
            <button type="button" onClick={() => f({ monitor: undefined })} title="자동 (마지막 위치)" style={monitorBtn(form.monitor === undefined)}>
              자동
            </button>
            {Array.from({ length: monitorCount }, (_, i) => i + 1).map(n => (
              <button key={n} type="button" onClick={() => f({ monitor: n })} title={`모니터 ${n}`} style={monitorBtn(form.monitor === n)}>
                {n}
              </button>
            ))}
          </div>
        )}
        {onPickOnScreen && (
          <button
            type="button"
            onClick={onPickOnScreen}
            title="다이얼로그가 잠시 숨겨지고, 화면의 스페이스를 직접 클릭해서 고를 수 있어요"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 32, padding: '0 12px', borderRadius: 8,
              background: 'var(--surface)',
              border: '1px solid var(--border-rgba)',
              color: 'var(--text-muted)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Icon name="my_location" size={14} />화면에서 고르기
          </button>
        )}
      </div>
    </>
  );
}

/* ── Advanced section renderer (used by startAdvanced re-open mode) */
function renderAdvancedSection(p: {
  form: any;
  cropSrc: string | null;
  setCropSrc: (v: string | null) => void;
  imgRef: React.RefObject<HTMLImageElement | null>;
  handleCropApply: () => void;
  setAutoFavicon: (v: boolean) => void;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  iconTab: 'symbol' | 'system' | 'image';
  setIconTab: (t: 'symbol' | 'system' | 'image') => void;
  iconSearch: string;
  setIconSearch: (v: string) => void;
  filteredIcons: string[];
  selectMaterialIcon: (n: string) => void;
  fetchFavicon: () => void;
  fetchFileIcon: () => void;
  resetIcon: () => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  f: (patch: any) => void;
}) {
  const { form, cropSrc, setCropSrc, imgRef, handleCropApply,
    setAutoFavicon, setForm, iconTab, setIconTab,
    iconSearch, setIconSearch, filteredIcons, selectMaterialIcon,
    fetchFavicon, fetchFileIcon, resetIcon, fileRef, handleFileChange, f } = p;
  return (
    <>
      {cropSrc && (
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>가운데 정사각형으로 크롭됩니다</p>
          <img ref={imgRef} src={cropSrc} alt="crop preview" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 6, objectFit: 'contain' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setCropSrc(null)} style={cropBtnGhost}>취소</button>
            <button onClick={handleCropApply} style={cropBtnAccent}>적용</button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          <div style={{ width: 64, height: 64, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border-rgba)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {form.iconType === 'image'
              ? <img src={form.icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => { setAutoFavicon(false); setForm((q: any) => ({ ...q, iconType: 'material', icon: form.type === 'app' ? 'apps' : 'public' })); }} />
              : <Icon name={form.icon} size={32} color="var(--text-muted)" />
            }
          </div>
          <button onClick={resetIcon} title="기본값으로 초기화" style={{ padding: '2px 8px', fontSize: 10, borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border-rgba)', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
            <Icon name="restart_alt" size={11} />초기화
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['symbol', 'system', 'image'] as const).map(tab => {
              const labels = { symbol: '심볼', system: '시스템', image: '이미지' };
              const active = iconTab === tab;
              return (
                <button key={tab} onClick={() => setIconTab(tab)}
                  style={{ padding: '4px 12px', fontSize: 11, borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 700 : 400, background: active ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border-rgba)'}`, color: active ? 'var(--accent)' : 'var(--text-muted)', transition: 'all 0.1s' }}>
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
                style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border-rgba)', borderRadius: 7, color: 'var(--text-color)', fontFamily: 'inherit', outline: 'none' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 168, overflowY: 'auto' }}>
                {filteredIcons.slice(0, 80).map(ico => (
                  <button key={ico} title={ico} onClick={() => selectMaterialIcon(ico)}
                    style={{ width: 32, height: 32, borderRadius: 7, background: form.icon === ico && form.iconType === 'material' ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${form.icon === ico && form.iconType === 'material' ? 'var(--accent)' : 'var(--border-rgba)'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={ico} size={16} color={form.icon === ico && form.iconType === 'material' ? 'var(--accent)' : 'var(--text-muted)'} />
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
                  <button onClick={fetchFavicon} style={smallActionBtn}>
                    <Icon name="language" size={13} />사이트 아이콘 가져오기
                  </button>
                </>
              )}
              {form.type === 'app' && (
                <>
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>실행 파일의 시스템 아이콘을 가져옵니다.</p>
                  <button onClick={fetchFileIcon} style={smallActionBtn}>
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
              <button onClick={() => fileRef.current?.click()} style={smallActionBtn}>
                <Icon name="upload" size={13} />이미지 업로드
              </button>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>카드 색상</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {PRESET_COLORS.map(c => (
            <button key={c} onClick={() => f({ color: c })}
              style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', outline: form.color === c ? `2.5px solid ${c}` : 'none', outlineOffset: 2, transition: 'transform 0.1s', flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.2)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            />
          ))}
          <input type="color" value={form.color || '#6366f1'} onChange={e => f({ color: e.target.value })} title="직접 지정"
            style={{ width: 24, height: 24, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'transparent', padding: 0, flexShrink: 0 }} />
          {form.color && (
            <button onClick={() => f({ color: '' })} style={{ fontSize: 10, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              초기화
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Shared style fragments ──────────────────────────────────── */
const phaseHeadingStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-color)',
  margin: 0,
  letterSpacing: -0.2,
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 9px', fontSize: 10, fontWeight: 600,
  borderRadius: 99,
  background: 'var(--accent-dim)',
  border: '1px solid var(--accent)',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const pickerBtnStyle: React.CSSProperties = {
  flexShrink: 0, width: 44, height: 44,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--surface)', border: '1px solid var(--border-rgba)',
  borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)',
};

function monitorBtn(active: boolean): React.CSSProperties {
  return {
    height: 32, padding: '0 12px', borderRadius: 7,
    fontWeight: 600, fontSize: 11, cursor: 'pointer',
    fontFamily: 'inherit', transition: 'all 0.12s',
    background: active ? 'var(--accent)' : 'var(--surface)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-rgba)'}`,
    color: active ? '#fff' : 'var(--text-muted)',
  };
}

const cropBtnGhost: React.CSSProperties = {
  padding: '4px 12px', fontSize: 11, borderRadius: 6,
  background: 'var(--surface)', border: '1px solid var(--border-rgba)',
  color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
};

const cropBtnAccent: React.CSSProperties = {
  padding: '4px 12px', fontSize: 11, borderRadius: 6,
  background: 'var(--accent)', border: 'none',
  color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
};

const smallActionBtn: React.CSSProperties = {
  padding: '5px 12px', fontSize: 11, borderRadius: 7,
  background: 'var(--surface)', border: '1px solid var(--border-rgba)',
  color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
  display: 'flex', alignItems: 'center', gap: 5, width: 'fit-content',
};
