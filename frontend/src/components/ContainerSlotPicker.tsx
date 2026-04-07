import { useState, useEffect, useCallback } from 'react';
import type { LauncherItem, ContainerSlots, Space, WindowEntry, ChromeTab } from '../types';
import { electronAPI } from '../electronBridge';
import { detectClipboardType, suggestName, DEFAULT_DOCUMENT_EXTENSIONS } from '../lib/documentExtensions';

type SlotDir = 'up' | 'down' | 'left' | 'right';
type AddTab = 'existing' | 'scan' | 'new';

const DIR_ICONS: Record<SlotDir, string> = {
  up: 'arrow_upward', down: 'arrow_downward', left: 'arrow_back', right: 'arrow_forward',
};
const DIR_LABELS: Record<SlotDir, string> = {
  up: '위', down: '아래', left: '왼쪽', right: '오른쪽',
};
const DIRS: SlotDir[] = ['up', 'left', 'right', 'down'];

const ITEM_TYPES = [
  { value: 'url',     label: 'URL',       icon: 'language' },
  { value: 'folder',  label: '폴더',      icon: 'folder_open' },
  { value: 'app',     label: '앱',        icon: 'apps' },
  { value: 'window',  label: '창',        icon: 'window' },
  { value: 'browser', label: '브라우저',   icon: 'public' },
  { value: 'text',    label: '텍스트',    icon: 'content_copy' },
  { value: 'cmd',     label: '명령어',    icon: 'terminal' },
] as const;

function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function getTypeIcon(type: LauncherItem['type']) {
  const map: Record<string, string> = {
    url: 'language', folder: 'folder_open', app: 'apps',
    window: 'window', browser: 'public', text: 'content_copy', cmd: 'terminal',
  };
  return map[type] ?? 'link';
}

export interface PendingNewItem {
  id: string;
  item: Omit<LauncherItem, 'id'>;
}
export interface PendingRemoval {
  spaceId: string;
  itemId: string;
}

interface ContainerSlotPickerProps {
  open: boolean;
  onClose: () => void;
  containerItem: LauncherItem;
  containerSpaceId: string;
  defaultDir?: string;
  allSpaces: Space[];
  onSave: (slots: ContainerSlots, removals: PendingRemoval[], newItems: PendingNewItem[]) => void;
}

export function ContainerSlotPicker({
  open, onClose, containerItem, containerSpaceId: _containerSpaceId, defaultDir, allSpaces, onSave,
}: ContainerSlotPickerProps) {
  const [slots, setSlots] = useState<ContainerSlots>({});
  const [activeDir, setActiveDir] = useState<SlotDir | null>(null);
  const [tab, setTab] = useState<AddTab>('existing');
  const [search, setSearch] = useState('');
  const [pendingNewItems, setPendingNewItems] = useState<PendingNewItem[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  // Track which assigned items should be hidden from their space (default: true = hidden)
  const [slotHideMap, setSlotHideMap] = useState<Record<string, boolean>>({});

  // Scan state
  const [scanResults, setScanResults] = useState<{ windows: WindowEntry[]; tabs: ChromeTab[] } | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanIcons, setScanIcons] = useState<Record<string, string>>({});

  // New item form
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<LauncherItem['type']>('url');
  const [newValue, setNewValue] = useState('');

  // Existing tab: collapsed spaces
  const [collapsedSpaces, setCollapsedSpaces] = useState<Set<string>>(new Set());

  // Dirty = any unsaved slot assignment / new item / removal
  const isDirty = pendingNewItems.length > 0 || pendingRemovals.length > 0 ||
    Object.keys(slots).some(k => slots[k as SlotDir] !== (containerItem?.slots?.[k as SlotDir] ?? ''));

  const handleClose = () => {
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const fillFromClipboard = useCallback(async () => {
    const text = await electronAPI.readClipboard();
    if (!text?.trim()) return;
    const detected = detectClipboardType(text.trim(), DEFAULT_DOCUMENT_EXTENSIONS);
    const mappedType: LauncherItem['type'] = detected === 'doc' ? 'app' : detected === null ? 'text' : detected;
    setNewType(mappedType);
    setNewValue(text.trim());
    if (!newTitle) setNewTitle(suggestName(mappedType, text.trim()));
  }, [newTitle]);

  useEffect(() => {
    if (open) {
      setSlots(containerItem?.slots ?? {});
      setActiveDir((defaultDir as SlotDir) ?? null);
      setTab('existing');
      setSearch('');
      setPendingNewItems([]);
      setPendingRemovals([]);
      setSlotHideMap({});
      setScanResults(null);
      setNewTitle(''); setNewType('url'); setNewValue('');
    }
  }, [open, containerItem, defaultDir]);

  const allItems = allSpaces.flatMap(s => s.items);
  const assignedIds = new Set(Object.values(slots).filter(Boolean) as string[]);

  const findItem = useCallback((id: string): LauncherItem | undefined => {
    if (!id) return undefined;
    const pending = pendingNewItems.find(p => p.id === id);
    if (pending) return { ...pending.item, id } as LauncherItem;
    return allItems.find(i => i.id === id);
  }, [allItems, pendingNewItems]);

  const doScan = useCallback(async () => {
    setScanLoading(true);
    try {
      const result = await electronAPI.getOpenWindows();
      const wins = result.windows ?? [];
      const tabs = result.browserTabs ?? [];
      setScanResults({ windows: wins, tabs });
      const iconMap: Record<string, string> = {};
      await Promise.all(wins.filter(w => w.ExePath).map(async w => {
        try {
          const ico = await electronAPI.getFileIcon(w.ExePath!);
          if (ico) iconMap[w.ExePath!] = ico;
        } catch { /* ignore */ }
      }));
      setScanIcons(iconMap);
    } catch { /* ignore */ }
    finally { setScanLoading(false); }
  }, []);

  useEffect(() => {
    if (open && tab === 'scan' && !scanResults) doScan();
  }, [open, tab, scanResults, doScan]);

  if (!open || !containerItem) return null;

  // ── Slot helpers ─────────────────────────────────────────────
  const clearSlot = (dir: SlotDir) => {
    const itemId = slots[dir];
    if (itemId) {
      const isPending = pendingNewItems.some(p => p.id === itemId);
      if (isPending) setPendingNewItems(prev => prev.filter(p => p.id !== itemId));
      setPendingRemovals(prev => prev.filter(r => r.itemId !== itemId));
      setSlotHideMap(prev => { const n = {...prev}; delete n[itemId]; return n; });
    }
    setSlots(prev => { const n = {...prev}; delete n[dir]; return n; });
  };

  const assignSlot = (dir: SlotDir, itemId: string) => {
    const otherDir = (Object.entries(slots) as [SlotDir, string][]).find(([d, id]) => id === itemId && d !== dir)?.[0];
    if (otherDir) setSlots(prev => { const n = {...prev}; delete n[otherDir]; return n; });
    setSlots(prev => ({ ...prev, [dir]: itemId }));
  };

  const handlePickExisting = (item: LauncherItem, sourceSpaceId: string) => {
    if (!activeDir || assignedIds.has(item.id)) return;
    assignSlot(activeDir, item.id);
    // Default: hide from space (can be toggled off by user)
    setSlotHideMap(prev => ({ ...prev, [item.id]: true }));
    setPendingRemovals(prev => [...prev.filter(r => r.itemId !== item.id), { spaceId: sourceSpaceId, itemId: item.id }]);
  };

  const toggleSlotHide = (itemId: string, hide: boolean) => {
    setSlotHideMap(prev => ({ ...prev, [itemId]: hide }));
    if (hide) {
      // Find space for this item
      const sourceSpace = allSpaces.find(s => s.items.some(i => i.id === itemId));
      if (sourceSpace) {
        setPendingRemovals(prev => [...prev.filter(r => r.itemId !== itemId), { spaceId: sourceSpace.id, itemId }]);
      }
    } else {
      setPendingRemovals(prev => prev.filter(r => r.itemId !== itemId));
    }
  };

  const handlePickScanWindow = (entry: WindowEntry) => {
    if (!activeDir) return;
    const id = genId();
    setPendingNewItems(prev => [...prev, { id, item: {
      title: entry.MainWindowTitle, type: entry.ExePath ? 'app' : 'window',
      value: entry.ExePath ?? entry.MainWindowTitle, exePath: entry.ExePath, clickCount: 0,
      hiddenInSpace: true,  // hidden by default
    }}]);
    setSlotHideMap(prev => ({ ...prev, [id]: true }));
    assignSlot(activeDir, id);
  };

  const handlePickScanTab = (t: ChromeTab) => {
    if (!activeDir) return;
    const id = genId();
    setPendingNewItems(prev => [...prev, { id, item: {
      title: t.title, type: 'browser', value: t.url, clickCount: 0,
      hiddenInSpace: true,  // hidden by default
    }}]);
    setSlotHideMap(prev => ({ ...prev, [id]: true }));
    assignSlot(activeDir, id);
  };

  const handleCreateNew = () => {
    if (!activeDir || !newTitle.trim() || !newValue.trim()) return;
    const id = genId();
    setPendingNewItems(prev => [...prev, { id, item: {
      title: newTitle.trim(), type: newType, value: newValue.trim(), clickCount: 0,
      hiddenInSpace: true,  // hidden by default
    }}]);
    setSlotHideMap(prev => ({ ...prev, [id]: true }));
    assignSlot(activeDir, id);
    setNewTitle(''); setNewValue('');
  };

  // Toggle hide for pending new items
  const toggleNewItemHide = (id: string, hide: boolean) => {
    setSlotHideMap(prev => ({ ...prev, [id]: hide }));
    setPendingNewItems(prev => prev.map(p => p.id === id ? { ...p, item: { ...p.item, hiddenInSpace: hide } } : p));
  };

  const pickPath = async () => {
    if (newType === 'folder') {
      const p = await electronAPI.pickFolder();
      if (p) { setNewValue(p); if (!newTitle) setNewTitle(p.split('\\').pop() || p); }
    } else if (newType === 'app') {
      const p = await electronAPI.pickExe();
      if (p) { setNewValue(p); if (!newTitle) setNewTitle(p.split('\\').pop()?.replace('.exe','') || p); }
    }
  };

  const isWindowRegistered = (entry: WindowEntry) =>
    allItems.some(i => (i.type==='window' && i.value===entry.MainWindowTitle) || (i.type==='app' && i.value===entry.ExePath));
  const isTabRegistered = (t: ChromeTab) => allItems.some(i => i.value === t.url);
  const isWindowInSlot = (entry: WindowEntry) =>
    Object.values(slots).some(id => { const it = findItem(id??''); return it && (it.value===entry.MainWindowTitle || it.value===entry.ExePath); });
  const isTabInSlot = (t: ChromeTab) =>
    Object.values(slots).some(id => { const it = findItem(id??''); return it && it.value===t.url; });

  const existingItems = allSpaces.flatMap(s =>
    s.items.filter(i => i.id !== containerItem.id && !i.isContainer)
           .map(i => ({ item: i, spaceId: s.id, spaceName: s.name }))
  );
  const filteredExisting = search.trim()
    ? existingItems.filter(({ item }) =>
        item.title.toLowerCase().includes(search.toLowerCase()) ||
        item.value.toLowerCase().includes(search.toLowerCase()))
    : existingItems;

  const activeDirItem = activeDir ? findItem(slots[activeDir] ?? '') : undefined;

  return (
    <>
      {/* Backdrop */}
      <div onClick={handleClose} style={{ position:'fixed', inset:0, zIndex:99990, background:'rgba(0,0,0,0.45)', backdropFilter:'blur(4px)' }} />

      {/* Confirm close (unsaved changes) */}
      {confirmClose && (
        <div style={{ position:'fixed', inset:0, zIndex:99994, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'var(--bg-rgba)', backdropFilter:'blur(40px)', border:'1px solid var(--border-rgba)', borderRadius:14, padding:24, width:300, boxShadow:'0 20px 60px rgba(0,0,0,0.4)', fontFamily:'inherit', color:'var(--text-color)' }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>변경사항 버리기?</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:20, lineHeight:1.6 }}>
              저장하지 않은 변경사항이 있습니다.<br/>
              <span style={{ fontSize:10, color:'var(--text-dim)' }}>닫으면 슬롯 변경이 모두 취소됩니다.</span>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setConfirmClose(false)} style={{ padding:'6px 14px', borderRadius:8, border:'1px solid var(--border-rgba)', background:'transparent', color:'var(--text-muted)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>계속 편집</button>
              <button onClick={() => { setConfirmClose(false); onClose(); }} style={{ padding:'6px 14px', borderRadius:8, border:'none', background:'var(--destructive, #ef4444)', color:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>버리고 닫기</button>
            </div>
          </div>
        </div>
      )}


      {/* Main dialog — fixed size */}
      <div style={{
        position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
        zIndex:99991, width:620, height:520,
        background:'var(--bg-rgba)', backdropFilter:'blur(40px) saturate(150%)',
        border:'1px solid var(--border-rgba)', borderRadius:16,
        boxShadow:'0 24px 64px rgba(0,0,0,0.4)',
        color:'var(--text-color)', fontFamily:'inherit',
        display:'flex', flexDirection:'column', overflow:'hidden',
      }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 18px 12px', borderBottom:'1px solid var(--border-rgba)', flexShrink:0 }}>
          <span className="material-symbols-rounded" style={{ fontSize:17, color:'var(--accent)' }}>grid_view</span>
          <div style={{ flex:1 }}>
            <span style={{ fontSize:13, fontWeight:700 }}>슬롯 편집</span>
            <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:8 }}>"{containerItem.title}"</span>
          </div>
          <button onClick={handleClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', padding:4, borderRadius:6, display:'flex' }}>
            <span className="material-symbols-rounded" style={{ fontSize:18 }}>close</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

          {/* ── Left: Direction tabs ────────────────────────── */}
          <div style={{ width:180, flexShrink:0, borderRight:'1px solid var(--border-rgba)', padding:'10px 8px', display:'flex', flexDirection:'column', gap:4, overflowY:'auto', scrollbarWidth:'none' } as React.CSSProperties}>
            {/* Container card info */}
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, background:'var(--surface)', marginBottom:6 }}>
              <span className="material-symbols-rounded" style={{ fontSize:16, color:'var(--accent)' }}>grid_view</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text-color)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{containerItem.title}</div>
                <div style={{ fontSize:9, color:'var(--text-dim)' }}>컨테이너</div>
              </div>
            </div>

            {/* 4 direction slot tabs */}
            {DIRS.map(dir => {
              const slotId = slots[dir];
              const slotItem = slotId ? findItem(slotId) : undefined;
              const isActive = activeDir === dir;
              return (
                <button key={dir} onClick={() => setActiveDir(isActive ? null : dir)}
                  style={{
                    display:'flex', alignItems:'center', gap:8, padding:'10px 10px',
                    borderRadius:10, border:`1.5px solid ${isActive ? 'var(--accent)' : slotItem ? 'var(--border-focus)' : 'var(--border-rgba)'}`,
                    background: isActive ? 'var(--accent-dim)' : 'transparent',
                    cursor:'pointer', fontFamily:'inherit', textAlign:'left', width:'100%',
                    transition:'all 0.12s', position:'relative',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = isActive ? 'var(--accent-dim)' : 'transparent'; }}
                >
                  {/* Direction icon */}
                  <span className="material-symbols-rounded" style={{ fontSize:15, color: isActive ? 'var(--accent)' : 'var(--text-dim)', flexShrink:0 }}>{DIR_ICONS[dir]}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:10, color: isActive ? 'var(--accent)' : 'var(--text-dim)', fontWeight:600, marginBottom:1 }}>{DIR_LABELS[dir]} 슬롯</div>
                    {slotItem ? (
                      <div style={{ fontSize:11, color:'var(--text-color)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{slotItem.title}</div>
                    ) : (
                      <div style={{ fontSize:10, color:'var(--text-dim)', fontStyle:'italic' }}>비어있음</div>
                    )}
                  </div>
                  {/* Clear button */}
                  {slotItem && (
                    <button onClick={e => { e.stopPropagation(); clearSlot(dir); }}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', padding:2, borderRadius:4, display:'flex', flexShrink:0 }}
                      title="슬롯 제거"
                      onMouseEnter={e => (e.currentTarget.style.color='var(--text-color)')}
                      onMouseLeave={e => (e.currentTarget.style.color='var(--text-dim)')}>
                      <span className="material-symbols-rounded" style={{ fontSize:13 }}>close</span>
                    </button>
                  )}
                </button>
              );
            })}

            {/* Pending summary */}
            {(pendingRemovals.length > 0 || pendingNewItems.length > 0) && (
              <div style={{ marginTop:'auto', padding:'8px 10px', borderRadius:8, background:'var(--surface)', border:'1px solid var(--border-rgba)', fontSize:10, color:'var(--text-dim)', display:'flex', flexDirection:'column', gap:3 }}>
                {pendingNewItems.length > 0 && <div style={{ display:'flex', alignItems:'center', gap:4 }}><span className="material-symbols-rounded" style={{ fontSize:11, color:'var(--accent)' }}>add_circle</span>새 카드 {pendingNewItems.length}개</div>}
                {pendingRemovals.length > 0 && <div style={{ display:'flex', alignItems:'center', gap:4 }}><span className="material-symbols-rounded" style={{ fontSize:11 }}>visibility_off</span>숨김 {pendingRemovals.length}개</div>}
              </div>
            )}
          </div>

          {/* ── Right: Content panel ────────────────────────── */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {!activeDir ? (
              <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, color:'var(--text-dim)' }}>
                <span className="material-symbols-rounded" style={{ fontSize:36, opacity:0.35 }}>touch_app</span>
                <span style={{ fontSize:12 }}>왼쪽에서 슬롯을 선택하세요</span>
              </div>
            ) : (
              <>
                {/* Active slot header */}
                <div style={{ flexShrink:0, padding:'12px 16px 0' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:activeDirItem ? 6 : 10 }}>
                    <span className="material-symbols-rounded" style={{ fontSize:15, color:'var(--accent)' }}>{DIR_ICONS[activeDir]}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:'var(--accent)' }}>{DIR_LABELS[activeDir]} 슬롯</span>
                    {activeDirItem && (
                      <span style={{ fontSize:10, color:'var(--text-muted)', marginLeft:4, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>— {activeDirItem.title}</span>
                    )}
                  </div>
                  {/* Visibility toggle for assigned slot item */}
                  {activeDirItem && (
                    <label style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 10px', borderRadius:8, background:'var(--surface)', border:'1px solid var(--border-rgba)', cursor:'pointer', marginBottom:10, userSelect:'none' }}>
                      <input
                        type="checkbox"
                        checked={slotHideMap[activeDirItem.id] !== false}
                        onChange={e => {
                          const hide = e.target.checked;
                          const isPending = pendingNewItems.some(p => p.id === activeDirItem.id);
                          if (isPending) toggleNewItemHide(activeDirItem.id, hide);
                          else toggleSlotHide(activeDirItem.id, hide);
                        }}
                        style={{ width:13, height:13, accentColor:'var(--accent)', cursor:'pointer' }}
                      />
                      <span className="material-symbols-rounded" style={{ fontSize:13, color:'var(--text-muted)' }}>
                        {slotHideMap[activeDirItem.id] !== false ? 'visibility_off' : 'visibility'}
                      </span>
                      <span style={{ fontSize:11, color:'var(--text-color)', fontWeight:500 }}>스페이스에서 숨기기</span>
                      <span style={{ fontSize:9, color:'var(--text-dim)', marginLeft:'auto' }}>
                        {slotHideMap[activeDirItem.id] !== false ? '그리드에 미표시' : '그리드에 표시'}
                      </span>
                    </label>
                  )}

                  {/* Tab bar */}
                  <div style={{ display:'flex', gap:4, background:'var(--surface)', borderRadius:8, padding:3, marginBottom:12 }}>
                    {([
                      { id:'existing' as AddTab, icon:'grid_view', label:'기존 카드' },
                      { id:'scan' as AddTab, icon:'radar', label:'스마트 스캔' },
                      { id:'new' as AddTab, icon:'add_circle', label:'새로 만들기' },
                    ]).map(t => (
                      <button key={t.id} onClick={() => setTab(t.id)}
                        style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:5, padding:'6px 4px', borderRadius:6, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:11, fontWeight: tab===t.id ? 700 : 500, background: tab===t.id ? 'var(--bg-rgba)' : 'transparent', color: tab===t.id ? 'var(--accent)' : 'var(--text-muted)', boxShadow: tab===t.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', transition:'all 0.12s' }}>
                        <span className="material-symbols-rounded" style={{ fontSize:13 }}>{t.icon}</span>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scrollable content area */}
                <div style={{ flex:1, overflowY:'auto', padding:'0 16px 12px', scrollbarWidth:'none' } as React.CSSProperties}>

                  {/* ── 기존 카드 ── */}
                  {tab === 'existing' && (() => {
                    // Group by space
                    const groups: { spaceId: string; spaceName: string; icon?: string; items: typeof filteredExisting }[] = [];
                    const seen = new Set<string>();
                    for (const entry of filteredExisting) {
                      if (!seen.has(entry.spaceId)) {
                        seen.add(entry.spaceId);
                        const sp = allSpaces.find(s => s.id === entry.spaceId);
                        groups.push({ spaceId: entry.spaceId, spaceName: entry.spaceName, icon: sp?.icon, items: [] });
                      }
                      groups.find(g => g.spaceId === entry.spaceId)!.items.push(entry);
                    }
                    const searching = search.trim().length > 0;
                    return (
                      <>
                        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="카드 검색..."
                          style={{ width:'100%', boxSizing:'border-box', padding:'7px 11px', background:'var(--surface)', border:'1px solid var(--border-rgba)', borderRadius:8, fontSize:12, color:'var(--text-color)', outline:'none', fontFamily:'inherit', marginBottom:10 }}
                          onFocus={e => (e.target.style.borderColor='var(--border-focus)')}
                          onBlur={e => (e.target.style.borderColor='var(--border-rgba)')} />
                        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                          {groups.length === 0 && (
                            <div style={{ textAlign:'center', fontSize:11, color:'var(--text-dim)', padding:'24px 0' }}>검색 결과 없음</div>
                          )}
                          {groups.map(group => {
                            const isCollapsed = !searching && collapsedSpaces.has(group.spaceId);
                            return (
                              <div key={group.spaceId}>
                                {/* Space header */}
                                <button
                                  onClick={() => setCollapsedSpaces(prev => {
                                    const next = new Set(prev);
                                    if (next.has(group.spaceId)) next.delete(group.spaceId);
                                    else next.add(group.spaceId);
                                    return next;
                                  })}
                                  style={{ display:'flex', alignItems:'center', gap:6, width:'100%', padding:'5px 8px 5px 4px', border:'none', background:'transparent', cursor:'pointer', fontFamily:'inherit', color:'var(--text-dim)', marginBottom:3 }}
                                >
                                  <span className="material-symbols-rounded" style={{ fontSize:12, transition:'transform 0.15s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>expand_more</span>
                                  {group.icon && <span style={{ fontSize:13 }}>{group.icon}</span>}
                                  <span style={{ fontSize:10, fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase' }}>{group.spaceName}</span>
                                  <span style={{ fontSize:9, color:'var(--text-dim)', marginLeft:'auto' }}>{group.items.length}</span>
                                </button>
                                {/* Items */}
                                {!isCollapsed && (
                                  <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:6, paddingLeft:4 }}>
                                    {group.items.map(({ item, spaceId }) => {
                                      const inSlot = assignedIds.has(item.id);
                                      return (
                                        <button key={item.id} disabled={inSlot} onClick={() => handlePickExisting(item, spaceId)}
                                          style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:9, border:`1px solid ${inSlot ? 'var(--accent)' : 'var(--border-rgba)'}`, background: inSlot ? 'var(--accent-dim)' : 'var(--surface)', cursor: inSlot ? 'default' : 'pointer', fontFamily:'inherit', textAlign:'left', width:'100%', opacity: inSlot ? 0.75 : 1, transition:'background 0.1s' }}
                                          onMouseEnter={e => { if (!inSlot) (e.currentTarget as HTMLButtonElement).style.background='var(--surface-hover)'; }}
                                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = inSlot ? 'var(--accent-dim)' : 'var(--surface)'; }}>
                                          {item.iconType==='image' && item.icon
                                            ? <img src={item.icon} alt="" style={{ width:22, height:22, borderRadius:4, objectFit:'cover', flexShrink:0 }} />
                                            : <span className="material-symbols-rounded" style={{ fontSize:20, color:'var(--text-muted)', flexShrink:0 }}>{item.icon ?? getTypeIcon(item.type)}</span>}
                                          <div style={{ flex:1, minWidth:0 }}>
                                            <div style={{ fontSize:12, color:'var(--text-color)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.title}</div>
                                          </div>
                                          {inSlot && <span style={{ flexShrink:0, fontSize:9, color:'var(--accent)', fontWeight:700, background:'var(--accent-dim)', padding:'2px 7px', borderRadius:4 }}>슬롯 지정됨</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}

                  {/* ── 스마트 스캔 ── */}
                  {tab === 'scan' && (
                    <>
                      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:10 }}>
                        <button onClick={doScan} disabled={scanLoading}
                          style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:8, border:'1px solid var(--border-rgba)', background:'transparent', color:'var(--text-muted)', fontSize:11, cursor: scanLoading?'default':'pointer', fontFamily:'inherit' }}>
                          <span className={`material-symbols-rounded ${scanLoading?'animate-spin':''}`} style={{ fontSize:13 }}>refresh</span>
                          새로고침
                        </button>
                      </div>
                      {scanLoading && <div style={{ textAlign:'center', fontSize:11, color:'var(--text-dim)', padding:'24px 0' }}>스캔 중...</div>}
                      {!scanLoading && scanResults && (
                        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                          {scanResults.tabs.length > 0 && <>
                            <ScanSection label="브라우저 탭" icon="public" />
                            {scanResults.tabs.map((t, i) => (
                              <ScanItem key={i} icon="public" imageUrl={t.favIconUrl} title={t.title} sub={t.url}
                                inSlot={isTabInSlot(t)} registered={isTabRegistered(t)}
                                onClick={() => !isTabInSlot(t) && !isTabRegistered(t) && handlePickScanTab(t)} />
                            ))}
                          </>}
                          {scanResults.windows.length > 0 && <>
                            <ScanSection label="실행 중인 프로그램" icon="window" />
                            {scanResults.windows.map((w, i) => (
                              <ScanItem key={i} icon="window" imageUrl={w.ExePath ? scanIcons[w.ExePath] : undefined}
                                title={w.MainWindowTitle} sub={w.ExePath ?? w.ProcessName}
                                inSlot={isWindowInSlot(w)} registered={isWindowRegistered(w)}
                                onClick={() => !isWindowInSlot(w) && !isWindowRegistered(w) && handlePickScanWindow(w)} />
                            ))}
                          </>}
                          {scanResults.tabs.length === 0 && scanResults.windows.length === 0 && (
                            <div style={{ textAlign:'center', fontSize:11, color:'var(--text-dim)', padding:'24px 0' }}>실행 중인 프로그램이 없습니다</div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* ── 새로 만들기 ── */}
                  {tab === 'new' && (
                    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                      {/* Clipboard auto-fill */}
                      <button onClick={fillFromClipboard}
                        style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'8px', borderRadius:8, border:'1px dashed var(--border-focus)', background:'var(--accent-dim)', color:'var(--accent)', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'opacity 0.12s' }}
                        onMouseEnter={e => (e.currentTarget.style.opacity='0.8')}
                        onMouseLeave={e => (e.currentTarget.style.opacity='1')}
                        title="클립보드에서 자동으로 유형과 값을 감지해 채웁니다">
                        <span className="material-symbols-rounded" style={{ fontSize:14 }}>content_paste</span>
                        클립보드에서 자동 세팅
                      </button>
                      <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="카드 이름"
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 11px', background:'var(--surface)', border:'1px solid var(--border-rgba)', borderRadius:8, fontSize:12, color:'var(--text-color)', outline:'none', fontFamily:'inherit' }}
                        onFocus={e => (e.target.style.borderColor='var(--border-focus)')}
                        onBlur={e => (e.target.style.borderColor='var(--border-rgba)')} />
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        {ITEM_TYPES.map(t => (
                          <button key={t.value} onClick={() => setNewType(t.value)}
                            style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 10px', borderRadius:7, border:`1px solid ${newType===t.value?'var(--accent)':'var(--border-rgba)'}`, background: newType===t.value?'var(--accent-dim)':'transparent', color: newType===t.value?'var(--accent)':'var(--text-muted)', fontSize:11, cursor:'pointer', fontFamily:'inherit', fontWeight: newType===t.value?700:400 }}>
                            <span className="material-symbols-rounded" style={{ fontSize:13 }}>{t.icon}</span>{t.label}
                          </button>
                        ))}
                      </div>
                      <div style={{ display:'flex', gap:6 }}>
                        <input value={newValue} onChange={e => setNewValue(e.target.value)}
                          placeholder={newType==='url'?'https://...':newType==='folder'?'C:\\경로':newType==='app'?'C:\\앱.exe':newType==='cmd'?'명령어':'값'}
                          style={{ flex:1, padding:'8px 11px', background:'var(--surface)', border:'1px solid var(--border-rgba)', borderRadius:8, fontSize:12, color:'var(--text-color)', outline:'none', fontFamily:'inherit' }}
                          onFocus={e => (e.target.style.borderColor='var(--border-focus)')}
                          onBlur={e => (e.target.style.borderColor='var(--border-rgba)')} />
                        {(newType==='folder'||newType==='app') && (
                          <button onClick={pickPath}
                            style={{ padding:'8px 11px', borderRadius:8, border:'1px solid var(--border-rgba)', background:'transparent', color:'var(--text-muted)', fontSize:11, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                            <span className="material-symbols-rounded" style={{ fontSize:14 }}>folder_open</span>찾아보기
                          </button>
                        )}
                      </div>
                      <button onClick={handleCreateNew} disabled={!newTitle.trim()||!newValue.trim()}
                        style={{ padding:'9px', borderRadius:8, border:'none', background: (!newTitle.trim()||!newValue.trim())?'var(--border-rgba)':'var(--accent)', color: (!newTitle.trim()||!newValue.trim())?'var(--text-dim)':'#fff', fontSize:12, cursor: (!newTitle.trim()||!newValue.trim())?'not-allowed':'pointer', fontFamily:'inherit', fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                        <span className="material-symbols-rounded" style={{ fontSize:14 }}>add</span>슬롯에 추가
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', padding:'12px 18px', borderTop:'1px solid var(--border-rgba)', flexShrink:0 }}>
          <button onClick={handleClose} style={{ padding:'7px 18px', borderRadius:8, border:'1px solid var(--border-rgba)', background:'transparent', color:'var(--text-muted)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>취소</button>
          <button onClick={() => onSave(slots, pendingRemovals, pendingNewItems)}
            style={{ padding:'7px 18px', borderRadius:8, border:'none', background:'var(--accent)', color:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>저장</button>
        </div>
      </div>
    </>
  );
}

// ── Scan section header ──────────────────────────────────────
function ScanSection({ label, icon }: { label: string; icon: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:9, fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-dim)', margin:'6px 0 2px' }}>
      <span className="material-symbols-rounded" style={{ fontSize:11 }}>{icon}</span>{label}
    </div>
  );
}

// ── Scan item row ────────────────────────────────────────────
function ScanItem({ icon, imageUrl, title, sub, inSlot, registered, onClick }: {
  icon: string; imageUrl?: string; title: string; sub?: string;
  inSlot: boolean; registered: boolean; onClick: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const disabled = inSlot || registered;
  return (
    <button disabled={disabled} onClick={onClick}
      style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:9, border:`1px solid ${inSlot?'var(--accent)':'var(--border-rgba)'}`, background: inSlot?'var(--accent-dim)':'var(--surface)', cursor: disabled?'default':'pointer', fontFamily:'inherit', textAlign:'left', opacity: registered&&!inSlot?0.5:1, width:'100%', transition:'background 0.1s' }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background='var(--surface-hover)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = inSlot?'var(--accent-dim)':'var(--surface)'; }}>
      {imageUrl && !imgFailed
        ? <img src={imageUrl} alt="" style={{ width:20, height:20, objectFit:'contain', borderRadius:3, flexShrink:0 }} onError={() => setImgFailed(true)} />
        : <span className="material-symbols-rounded" style={{ fontSize:20, color:'var(--text-muted)', flexShrink:0 }}>{icon}</span>}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, color:'var(--text-color)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</div>
        {sub && <div style={{ fontSize:10, color:'var(--text-dim)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sub}</div>}
      </div>
      {inSlot && <span style={{ flexShrink:0, fontSize:9, color:'var(--accent)', fontWeight:700, background:'var(--accent-dim)', padding:'2px 7px', borderRadius:4 }}>슬롯</span>}
      {registered && !inSlot && <span style={{ flexShrink:0, fontSize:9, color:'var(--text-dim)', background:'var(--surface-hover)', padding:'2px 7px', borderRadius:4 }}>등록됨</span>}
    </button>
  );
}

