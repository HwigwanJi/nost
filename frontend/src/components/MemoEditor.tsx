/**
 * MemoEditor — inplace sheet for editing a memo.
 *
 * Why "inplace sheet" rather than a new BrowserWindow:
 *   Electron windows feel cheap when opened ad-hoc (cold flash, taskbar
 *   pollution, animation tone mismatch with the OS). The user explicitly
 *   asked to avoid that. So we render INSIDE the main window — a fixed
 *   overlay that blankets the grid, transitioning in with CSS only.
 *   Zero new BrowserWindows. Zero packaging surface to maintain.
 *
 * Editor surface = plain `<textarea>` (no Tiptap, no CodeMirror — see
 * plans/memo-feature-v1.md "에디터" section). Korean IME works for free.
 *
 * Lifecycle:
 *   - Open: fade in (~150ms), focus textarea
 *   - Auto-save: debounced 500ms after last keystroke
 *   - Close: Esc / Ctrl+Enter / outside-click
 *     - On close, if body is empty AND createdAt > now-3min (i.e. the
 *       memo was just opened-and-emptied), auto-trash it. This realises
 *       the spec's "빈 메모 자동 삭제" without surprising users who
 *       deliberately cleared an existing memo for re-typing.
 *
 * Shortcuts (only while editor is open):
 *   - Esc / Ctrl+Enter      → close
 *   - Ctrl+S                → 살리기 (TTL reset, no close)
 *   - Ctrl+Shift+C          → copy body to clipboard
 *   - Ctrl+P                → toggle pin
 *
 * The component receives the active memo as a snapshot (so re-renders
 * from the parent don't blow away unsaved input). All persistence flows
 * through the parent's update callback.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast as sonnerToast } from 'sonner';
import { Icon } from '@/components/ui/Icon';
import type { LauncherItem } from '../types';
import { electronAPI } from '../electronBridge';
import {
  memoTitleFromBody,
  memoDaysLeft,
  memoHoursLeft,
  memoGaugeFraction,
  memoIsExpiringSoon,
  slugifyTitle,
  memoBodyToPlain,
  memoBodyToMarkdown,
  memoStripBullets,
  memoStripFormatting,
  memoCompactBlankLines,
} from '../lib/memoUtils';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { renderMemoMarkdown } from '../lib/memoMarkdown';

interface MemoEditorProps {
  item: LauncherItem;
  pinned: boolean;
  exportFolder?: string;
  onChangeBody: (body: string) => void;
  onClose: () => void;
  onExtend: () => void;
  onTogglePin: () => void;
  onTrash: () => void;
  /** Called by the empty-on-close auto-trash logic. */
  onAutoDeleteIfEmpty: () => void;
  showToast?: (msg: string) => void;
}

const AUTOSAVE_DEBOUNCE_MS = 200;
const AUTO_DELETE_GRACE_MS = 3 * 60 * 1000;

export function MemoEditor({
  item, pinned, exportFolder: _exportFolder,
  onChangeBody, onClose, onExtend, onTogglePin, onTrash,
  onAutoDeleteIfEmpty, showToast,
}: MemoEditorProps) {
  // ── View mode (edit textarea ↔ preview rendered) ──────────────
  // The user asked for a markdown editor "based on modern markdown
  // editors." We keep the lightweight approach: editing stays in the
  // native textarea (Korean IME just works), preview is a separate
  // mode rendered by lib/memoMarkdown — no contenteditable hackery.
  // Toggle with the eye icon in the toolbar or Ctrl+M.
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  // Save-status indicator. The user's confusion: "저장 버튼이 없는데
  // ESC만 눌러도 정말 저장되는 건가?" — autosave WAS working but
  // there was no visible signal. Three states:
  //   - 'idle'   : nothing typed since last save / fresh load
  //   - 'pending': debounce timer in flight
  //   - 'saved'  : last save completed within the last 1.5 s
  // Footer renders the state in human-readable Korean so the user
  // can see exactly what's happening at a glance.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saved'>('idle');
  const savedClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cleanup tool memory ─────────────────────────────────────
  // Adobe-style: the toolbar button shows the LAST tool the user
  // ran. Click runs that tool again; hover (or click on the chevron)
  // reveals the full tool palette. Persisted in localStorage so the
  // user's preferred default sticks across sessions / app restarts.
  type CleanupToolId = 'markdownify' | 'plain' | 'bullets' | 'format' | 'compact';
  /** Where the cleaned text lands.
   *   'clipboard' (default, non-destructive): cleaned string goes
   *      to the clipboard, the memo body is left as-is. Matches
   *      the old single-button behaviour.
   *   'inPlace'    (destructive): the memo body itself is rewritten
   *      to the cleaned string; clipboard untouched. Triggers an
   *      autosave commit. The toast offers "되돌리기" to restore
   *      the previous body — Ctrl+Z on the textarea won't work
   *      because we mutate React state directly, bypassing the
   *      native undo stack. */
  type CleanupMode = 'clipboard' | 'inPlace';
  const CLEANUP_LS_KEY = 'nost.memo.lastCleanupTool';
  const CLEANUP_MODE_LS_KEY = 'nost.memo.cleanupMode';
  const [lastCleanupTool, setLastCleanupTool] = useState<CleanupToolId>(() => {
    try {
      const saved = localStorage.getItem(CLEANUP_LS_KEY) as CleanupToolId | null;
      if (saved && ['markdownify', 'plain', 'bullets', 'format', 'compact'].includes(saved)) {
        return saved;
      }
    } catch { /* SSR / blocked storage — fall through */ }
    return 'markdownify';
  });
  const [cleanupMode, setCleanupMode] = useState<CleanupMode>(() => {
    try {
      const saved = localStorage.getItem(CLEANUP_MODE_LS_KEY) as CleanupMode | null;
      if (saved === 'clipboard' || saved === 'inPlace') return saved;
    } catch { /* fall through */ }
    return 'clipboard'; // safe default — never modifies the body without explicit opt-in
  });
  const [cleanupMenuOpen, setCleanupMenuOpen] = useState(false);
  const cleanupHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectCleanupMode = useCallback((m: CleanupMode) => {
    setCleanupMode(m);
    try { localStorage.setItem(CLEANUP_MODE_LS_KEY, m); } catch { /* blocked storage */ }
  }, []);
  // Local body state. We seed from the item once on mount; subsequent
  // re-renders of the parent (because of TTL ticks, autosave commits,
  // etc.) don't clobber unsaved input — only an explicit prop change
  // (different memo opened) does, but the parent unmounts/remounts via
  // `key` for that case anyway.
  const initialBody = item.memo?.body ?? '';
  const [body, setBody] = useState(initialBody);
  const [closing, setClosing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debouncedSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef(initialBody);

  // ── Latest-callback refs ──────────────────────────────────────
  // Why refs: the parent (App.tsx) recreates `onChangeBody` on every
  // render via an inline arrow inside the editing-memo IIFE. The
  // previous implementation captured that prop in two `useEffect`
  // closures with empty deps — a textbook stale-closure bug. When
  // the user pressed Esc, the unmount cleanup would run with a
  // stale `body`/`onChangeBody`, sometimes skipping the flush
  // entirely (or flushing to the wrong target). The user reported
  // it as "토스트는 뜨는데 저장은 안 됨" — the visible signal fired
  // but the data didn't move.
  //
  // The ref pattern keeps every consumer pointed at the LATEST
  // callbacks regardless of when the surrounding closure was
  // created. The autosave effect now runs with stable deps and
  // the unmount cleanup always reaches the current callback.
  const onChangeBodyRef = useRef(onChangeBody);
  onChangeBodyRef.current = onChangeBody;
  const cbRef = useRef({ onClose, onExtend, onTogglePin });
  cbRef.current = { onClose, onExtend, onTogglePin };

  // ── Autosave ───────────────────────────────────────────────────
  // Two reasons we save aggressively (200ms debounce + immediate
  // on-blur force-flush + cleanup-on-unmount fallback):
  //   1. The user just learned not to trust the implicit save when
  //      it failed silently. We need overlapping guarantees.
  //   2. 500ms felt too long when the user is typing then
  //      immediately Esc-ing — the timer would cancel and the
  //      handleClose flush had to do all the work alone.
  // 200ms catches normal typing pauses + an Esc-on-quick-close
  // still has time to flush via handleClose.
  useEffect(() => {
    if (body === lastCommittedRef.current) return;
    setSaveStatus('pending');
    if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
    debouncedSaveRef.current = setTimeout(() => {
      // Use the ref so the LATEST onChangeBody is invoked, not
      // whatever closure was alive when this timer was scheduled.
      onChangeBodyRef.current(body);
      lastCommittedRef.current = body;
      setSaveStatus('saved');
      if (savedClearTimerRef.current) clearTimeout(savedClearTimerRef.current);
      savedClearTimerRef.current = setTimeout(() => setSaveStatus('idle'), 1500);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
    };
  // Deliberately omit onChangeBody from deps — we read it via
  // onChangeBodyRef. Including it would re-fire this effect on
  // every parent render and reset the debounce timer mid-typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  // Clean up save-status timer on unmount.
  useEffect(() => () => {
    if (savedClearTimerRef.current) clearTimeout(savedClearTimerRef.current);
  }, []);

  // Flush pending save on unmount. We always read the FRESHEST
  // textarea value + LATEST callback, regardless of the closure
  // age — the previous version was capturing a stale `body` here.
  useEffect(() => {
    return () => {
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
      const final = textareaRef.current?.value ?? lastCommittedRef.current;
      if (final !== lastCommittedRef.current) {
        onChangeBodyRef.current(final);
        lastCommittedRef.current = final;
      }
    };
  }, []);

  // ── Global ESC stack registration ──────────────────────────────
  // Even though we have a textarea-scoped onKeyDown, focus can be on
  // a header button (살리기, 복사, …) when ESC fires. Registering with
  // the global escape stack ensures ESC closes the editor regardless
  // of where focus is — and crucially, BEFORE the App-level ESC
  // priority chain (which would otherwise hide the app or exit a
  // tool mode).
  useEscapeKey(() => handleClose());

  // ── Auto-focus on open ─────────────────────────────────────────
  useEffect(() => {
    const t = textareaRef.current;
    if (!t) return;
    t.focus();
    // Place cursor at end so existing memos are append-friendly.
    const len = t.value.length;
    try { t.setSelectionRange(len, len); } catch { /* IE-style failures don't apply */ }
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────
  // Bound on the textarea (not window) so we don't steal Esc / Ctrl+S
  // from other editors. The outer overlay also catches outside clicks.
  const onTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Esc — close
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
      return;
    }
    // Ctrl+Enter — close
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleClose();
      return;
    }
    // Ctrl+S — 수명 리셋. Catches the browser's default "save page"
    // intent and routes it to the TTL reset (the closest analogue
    // for an in-launcher memo).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      cbRef.current.onExtend();
      showToast?.('수명을 다시 채웠습니다');
      return;
    }
    // Ctrl+Shift+C — copy body
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      handleCopy();
      return;
    }
    // Ctrl+P — 보호 토글 (renamed from 핀 to 보호 — user said the
    // "pin" word collided with the card-grid pin feature).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      cbRef.current.onTogglePin();
      showToast?.(pinned ? '보호 해제됨' : '메모를 보호함');
      return;
    }
    // Ctrl+M — toggle preview (markdown render). Vim-style mnemonic.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      setMode(m => m === 'edit' ? 'preview' : 'edit');
      return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, showToast]);

  // ── Close path ────────────────────────────────────────────────
  // Plays the close animation (~150 ms) before unmounting via onClose.
  // Auto-deletes empty newly-created memos to avoid grid pollution.
  //
  // Save semantics on close:
  //   - We FORCE the flush regardless of lastCommittedRef equality.
  //     Reason: under heavy parent re-renders the autosave debounce
  //     can get reset before firing, leaving lastCommittedRef behind
  //     by one or two characters. Forcing the flush guarantees the
  //     final keystrokes always land. The downstream updateMemoBody
  //     is idempotent — re-saving the same body is a no-op against
  //     React state thanks to spread-equality in setDataRaw.
  //   - We toast "저장됨" so the user has a clear visible confirmation
  //     that the close-on-Esc didn't lose their typing. The
  //     bottom-of-editor "저장됨 ✓" indicator covers in-edit feedback;
  //     the toast covers post-close feedback.
  const handleClose = () => {
    if (closing) return;
    const finalBody = textareaRef.current?.value ?? body;
    // wasEmptyOnOpen reflects whether the EDITOR opened against an
    // empty memo — captured BEFORE we mutate lastCommittedRef. Used
    // by the auto-delete guard below.
    const wasEmptyOnOpen = !initialBody.trim();
    const hasContent = finalBody.trim().length > 0;
    // Cancel any pending debounce so it can't double-fire AFTER we
    // commit the final value.
    if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
    // Force-flush via the ref — same path autosave uses, so this
    // call is identical in shape to a successful debounced save.
    // Equality check skipped intentionally: even if the body looks
    // unchanged, defending against the stale-closure bug means
    // always committing on close.
    onChangeBodyRef.current(finalBody);
    lastCommittedRef.current = finalBody;
    // Auto-delete: empty body AND the memo was just created (3-min
    // grace) AND it WAS empty when the editor opened (i.e. fresh
    // create that the user abandoned). The wasEmptyOnOpen guard
    // protects users who deliberately cleared an existing memo to
    // re-type — those deserve the chance to re-fill rather than
    // losing the card mid-edit.
    if (item.memo && !hasContent && wasEmptyOnOpen) {
      const age = Date.now() - item.memo.createdAt;
      if (age <= AUTO_DELETE_GRACE_MS) {
        onAutoDeleteIfEmpty();
      }
    } else if (hasContent) {
      // User typed something — confirm the save landed.
      showToast?.('저장됨');
    }
    setClosing(true);
    setTimeout(onClose, 160);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      // Fallback through Electron — works in restricted contexts.
      try { electronAPI.copyText(body, false); } catch { /* dev mode */ }
    }
    showToast?.('본문을 복사했습니다');
  };

  /**
   * Tool palette for "정리하여 복사" — one entry per cleanup mode.
   * The body is never mutated; we just produce a cleaned string and
   * push it to the clipboard, so destructive operations are
   * reversible by simply pasting from history.
   *
   * ICONS: chosen from Material Symbols' "format_*" family so they
   * read as document-cleanup affordances. The active-tool icon
   * surfaces in the toolbar (Adobe-style "last used wins").
   */
  const cleanupTools: Array<{
    id: 'markdownify' | 'plain' | 'bullets' | 'format' | 'compact';
    label: string;
    hint: string;
    icon: string;
    run: (s: string) => string;
    toast: string;
  }> = [
    {
      id: 'markdownify',
      label: '마크다운으로 정리',
      hint: '제목·목록·단락을 자동 인식해 마크다운 구조로',
      icon: 'auto_awesome',
      run: memoBodyToMarkdown,
      toast: '마크다운으로 정리해 복사했어요',
    },
    {
      id: 'plain',
      label: '서식·말머리표 모두 제거',
      hint: '플레인 텍스트로. 파워포인트 붙여넣기 최적',
      icon: 'format_clear',
      run: memoBodyToPlain,
      toast: '플레인으로 정리해 복사했어요',
    },
    {
      id: 'bullets',
      label: '말머리표만 제거',
      hint: '굵기·제목은 유지, 글머리 기호만 떼기',
      icon: 'format_indent_decrease',
      run: memoStripBullets,
      toast: '말머리표 제거 후 복사했어요',
    },
    {
      id: 'format',
      label: '굵기·기울임만 제거',
      hint: '`**`·`*`·`#` 만 제거, 글머리표는 유지',
      icon: 'format_color_reset',
      run: memoStripFormatting,
      toast: '서식 제거 후 복사했어요',
    },
    {
      id: 'compact',
      label: '연속 빈 줄 합치기',
      hint: '빈 줄 2줄 이상은 1줄로, 줄바꿈 정리',
      icon: 'compress',
      run: memoCompactBlankLines,
      toast: '빈 줄 정리 후 복사했어요',
    },
  ];

  /**
   * Adobe-style tool palette flow (two-step):
   *
   *   1. selectCleanupTool — clicking a submenu item ONLY swaps the
   *      currently-armed tool. The toolbar icon changes to reflect
   *      it. NO clipboard write, NO toast. This is "loading the
   *      tool" in Photoshop terms — the slot is now bound to that
   *      tool but you haven't applied it yet.
   *
   *   2. runActiveCleanupTool — clicking the main toolbar button
   *      runs whatever tool is currently armed and writes the
   *      cleaned text to the clipboard. This is "stroking the
   *      canvas" in Photoshop terms.
   *
   * Earlier draft conflated the two (submenu click both selected
   * AND ran). The user pointed out the flow is select-then-apply,
   * not select-and-fire. Matters because users may want to swap
   * the active tool ahead of time and then apply later, or
   * preview the icon to confirm the right tool is loaded.
   */
  const selectCleanupTool = useCallback((id: CleanupToolId) => {
    setLastCleanupTool(id);
    try { localStorage.setItem(CLEANUP_LS_KEY, id); } catch { /* blocked storage */ }
    setCleanupMenuOpen(false);
  }, []);

  const activeCleanupTool = cleanupTools.find(t => t.id === lastCleanupTool) ?? cleanupTools[0];

  const runActiveCleanupTool = useCallback(async () => {
    const tool = activeCleanupTool;
    const cleaned = tool.run(body);
    if (!cleaned.trim()) {
      showToast?.('정리할 내용이 없어요');
      return;
    }
    if (cleanupMode === 'inPlace') {
      // Destructive: rewrite the memo body. The autosave debounce
      // picks this up and commits. We snapshot the previous body so
      // the toast can restore it — Ctrl+Z doesn't work for
      // programmatic state changes (textarea native undo only
      // tracks user keystrokes).
      if (cleaned === body) {
        showToast?.('이미 정리된 상태예요');
        return;
      }
      const before = body;
      setBody(cleaned);
      sonnerToast(`본문에 적용됨 — ${tool.label}`, {
        description: '되돌리기를 누르면 이전 상태로 복구됩니다',
        action: { label: '되돌리기', onClick: () => setBody(before) },
        duration: 6000,
      });
    } else {
      try {
        await navigator.clipboard.writeText(cleaned);
      } catch {
        try { electronAPI.copyText(cleaned, false); } catch { /* dev mode */ }
      }
      showToast?.(tool.toast);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, activeCleanupTool, cleanupMode, showToast]);

  /** 내보내기 = OS save-as dialog. Snapshot to a real file the user
   *  picks. Memo stays — different from the previous "open in
   *  notepad + delete card" flow which the user flagged as wrong. */
  const handleExport = async () => {
    const title = memoTitleFromBody(body);
    const slug = slugifyTitle(title) || '메모';
    try {
      const result = await electronAPI.saveMemoAs({ body, slug });
      if (result.success && result.filePath) {
        showToast?.(`저장됨 — ${result.filePath.split(/[/\\]/).pop()}`);
      } else if (result.reason && result.reason !== 'canceled') {
        showToast?.('저장 실패: ' + result.reason);
      }
    } catch (e) {
      showToast?.('저장 실패: ' + String(e));
    }
  };

  /** 메모장에서 열기 — write to userData/memos and shell-open. The
   *  memo card stays; this is a *view*, not a move. Separate from
   *  save-as on the user's explicit request. */
  const handleOpenExternal = async () => {
    const title = memoTitleFromBody(body);
    const slug = slugifyTitle(title) || '메모';
    try {
      const result = await electronAPI.openMemoExternal({ body, slug });
      if (result.success) {
        showToast?.('기본 편집기에서 열었어요');
      } else {
        showToast?.('열기 실패: ' + (result.reason ?? '알 수 없는 오류'));
      }
    } catch (e) {
      showToast?.('열기 실패: ' + String(e));
    }
  };

  const handleExtend = () => {
    onExtend();
    showToast?.('수명을 다시 채웠습니다');
  };

  // ── Derived display values ────────────────────────────────────
  const now = Date.now();
  const daysLeft = memoDaysLeft(item, now);
  const hoursLeft = memoHoursLeft(item, now);
  const fraction = memoGaugeFraction(item, now);
  const expiringSoon = memoIsExpiringSoon(item, now);
  const charCount = body.length;
  const lineCount = body ? body.split(/\r?\n/).length : 1;

  return (
    <>
      {/* Backdrop — covers the whole window. Click = close. Subtle blur
          so the user retains spatial sense of where the memo was without
          the grid distracting underneath. We keep the dim very light
          (12%) because the sheet itself is fully opaque (var(--bg-rgba)
          renders at 95–96% alpha) — the backdrop is a *spatial cue*,
          not a contrast mechanism. The earlier 35% darkened both the
          backdrop AND visually bled into the sheet, making the memo
          editor body hard to read. */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.12)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          zIndex: 9000,
          opacity: closing ? 0 : 1,
          transition: 'opacity 0.15s ease-out',
        }}
      />

      {/* Sheet — centred, grows from card-ish width to a comfortable
          editor area. We use fixed positioning rather than transform/
          scale because that fights with Korean IME composition boxes
          on Windows (composition popup follows screen coords, not
          transformed local coords). */}
      <div
        role="dialog"
        aria-label="메모 편집"
        style={{
          position: 'fixed',
          left: '50%', top: '50%',
          transform: `translate(-50%, -50%) ${closing ? 'scale(0.96)' : 'scale(1)'}`,
          width: 'min(640px, 88vw)',
          height: 'min(560px, 82vh)',
          // var(--surface) is intentionally a 3–5% alpha tint for in-grid
          // panels; for a modal sheet we need full opacity. var(--bg-rgba)
          // is the app's "real" surface (95–96% alpha) — same value the
          // main window uses.
          background: 'var(--bg-rgba)',
          border: '1px solid var(--border-rgba)',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)',
          display: 'flex', flexDirection: 'column',
          zIndex: 9001,
          opacity: closing ? 0 : 1,
          transition: 'transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1), opacity 0.15s',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — TTL pill on left, action buttons on right */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 14px',
            borderBottom: '1px solid var(--border-rgba)',
            flexShrink: 0,
          }}
        >
          {/* TTL pill — NOW CLICKABLE. The user dropped the standalone
              "살리기" button: instead, clicking the time-remaining
              chip itself fires the refresh + toast. Pinned ("보호")
              memos show the protected pill (no refresh available).
              The previous separate button was visual noise for an
              action that visually belongs ON the time indicator. */}
          {pinned ? (
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px',
                borderRadius: 12,
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent)',
                fontSize: 11,
              }}
            >
              <Icon name="shield" size={11} color="var(--accent)" />
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>보호 중</span>
            </div>
          ) : (
            <button
              onClick={handleExtend}
              title={'클릭으로 수명 리셋 (Ctrl+S)'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '4px 10px',
                borderRadius: 12,
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-rgba)',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background 0.12s, border-color 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.borderColor = 'var(--border-rgba)'; }}
            >
              <div
                style={{
                  width: 40, height: 3,
                  borderRadius: 2,
                  background: 'var(--border-rgba)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${fraction * 100}%`, height: '100%',
                    background: expiringSoon ? '#f5b800' : 'var(--text-muted)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <span style={{ color: expiringSoon ? '#f5b800' : 'var(--text-dim)', fontWeight: expiringSoon ? 600 : 400 }}>
                {daysLeft === 0
                  ? (hoursLeft && hoursLeft > 0 ? `${hoursLeft}시간 남음` : '곧 만료')
                  : daysLeft != null ? `${daysLeft}일 남음` : ''}
              </span>
              <Icon name="refresh" size={10} color="var(--text-dim)" />
            </button>
          )}

          <div style={{ flex: 1 }} />

          {/* Action buttons — ICON ONLY, labels in tooltip.
              Same family rule as widget secondary rows (see
              widgets/widgetTokens.ts WIDGET_TIP). The previous icon+
              label layout caused the bilingual labels to wrap into
              two columns at this dialog width — visual disaster.
              Now: ~28px square buttons, label discovered on hover. */}
          {/* Tooltip format: `라벨 (단축키)` for buttons with a
              shortcut, `라벨 · 부연` for buttons that benefit from
              a one-clause clarifier (정리하여 복사 / 보호). Same
              design-system rule the cards follow. */}
          <HeaderBtn
            icon={mode === 'edit' ? 'visibility' : 'edit'}
            title={mode === 'edit' ? '미리보기 (Ctrl+M)' : '편집 (Ctrl+M)'}
            onClick={() => setMode(m => m === 'edit' ? 'preview' : 'edit')}
            active={mode === 'preview'}
          />
          <HeaderBtn
            icon="content_copy"
            title="복사 (Ctrl+Shift+C)"
            onClick={handleCopy}
          />
          {/* ── Cleanup tool palette (Adobe-style) ────────────
              The toolbar slot mirrors WHATEVER tool is currently
              armed. Hover reveals the full palette so the user
              can swap the armed tool — clicking a palette entry
              ONLY arms it (icon swaps). Actually running the
              cleanup happens by clicking the main slot afterwards.

              Two-step (select → apply) instead of one-step
              (select-and-run) because the user described the
              flow explicitly that way: pick the tool, then use
              the button you just configured. */}
          <div
            style={{ position: 'relative', display: 'flex' }}
            onMouseEnter={() => {
              if (cleanupHoverTimerRef.current) clearTimeout(cleanupHoverTimerRef.current);
              cleanupHoverTimerRef.current = setTimeout(() => setCleanupMenuOpen(true), 220);
            }}
            onMouseLeave={() => {
              if (cleanupHoverTimerRef.current) clearTimeout(cleanupHoverTimerRef.current);
              cleanupHoverTimerRef.current = setTimeout(() => setCleanupMenuOpen(false), 200);
            }}
          >
            {/* The slot. In 'inPlace' mode we add a subtle warning
                accent so the user is reminded the click will modify
                the body — even at a glance, before reading the
                tooltip. The accent uses the same destructive-hue
                conventions the rest of the editor uses (delete btn). */}
            <div style={{ position: 'relative' }}>
              <HeaderBtn
                icon={activeCleanupTool.icon}
                title={`정리 — ${activeCleanupTool.label}\n${cleanupMode === 'inPlace' ? '클릭: 본문에 적용 · 호버: 다른 도구 / 모드 선택' : '클릭: 클립보드에 복사 · 호버: 다른 도구 / 모드 선택'}`}
                onClick={runActiveCleanupTool}
              />
              {cleanupMode === 'inPlace' && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 1, right: 1,
                    width: 6, height: 6,
                    borderRadius: '50%',
                    background: 'var(--color-destructive, #f59e0b)',
                    boxShadow: '0 0 0 1.5px var(--bg-rgba)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>

            {cleanupMenuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  minWidth: 260,
                  padding: 4,
                  background: 'var(--bg-rgba)',
                  border: '1px solid var(--border-rgba)',
                  borderRadius: 10,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
                  zIndex: 100,
                  backdropFilter: 'blur(18px)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  animation: 'memoCleanupMenuIn 0.15s ease',
                }}
              >
                <style>{`
                  @keyframes memoCleanupMenuIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to   { opacity: 1; transform: translateY(0); }
                  }
                `}</style>
                <div style={{
                  padding: '6px 10px 4px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text-dim)',
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                }}>
                  정리 결과를 어디로
                </div>
                {/* Mode toggle — two pills. Persisted choice. The
                    'inPlace' option is intentionally a different
                    hue to make the destructive intent self-evident
                    even before reading the label. */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 4,
                  padding: '0 6px 6px',
                }}>
                  {([
                    { id: 'clipboard' as const, label: '복사만', icon: 'content_paste', hint: '메모 본문은 그대로, 정리한 결과만 클립보드에' },
                    { id: 'inPlace' as const, label: '본문에 적용', icon: 'edit_note', hint: '메모 본문 자체를 정리된 결과로 덮어씁니다' },
                  ]).map(opt => {
                    const active = cleanupMode === opt.id;
                    const destructive = opt.id === 'inPlace';
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); selectCleanupMode(opt.id); }}
                        title={opt.hint}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                          padding: '6px 8px',
                          borderRadius: 7,
                          background: active
                            ? (destructive ? 'color-mix(in srgb, var(--color-destructive, #f59e0b) 16%, transparent)' : 'var(--accent-dim)')
                            : 'transparent',
                          border: `1px solid ${active
                            ? (destructive ? 'var(--color-destructive, #f59e0b)' : 'var(--accent)')
                            : 'var(--border-rgba)'}`,
                          color: active
                            ? (destructive ? 'var(--color-destructive, #f59e0b)' : 'var(--accent)')
                            : 'var(--text-muted)',
                          fontSize: 10.5, fontWeight: active ? 700 : 500,
                          cursor: 'pointer', fontFamily: 'inherit',
                          transition: 'all 0.1s',
                        }}
                      >
                        <Icon name={opt.icon} size={12} color="currentColor" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <div style={{
                  padding: '4px 10px 4px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text-dim)',
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  borderTop: '1px solid var(--border-rgba)',
                  marginTop: 2,
                }}>
                  정리 도구 선택
                </div>
                {cleanupTools.map(tool => {
                  const isActive = tool.id === lastCleanupTool;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      role="menuitem"
                      onClick={(e) => { e.stopPropagation(); selectCleanupTool(tool.id); }}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '8px 10px',
                        background: isActive ? 'var(--accent-dim)' : 'transparent',
                        border: 'none', borderRadius: 7,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => {
                        if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
                      }}
                      onMouseLeave={e => {
                        if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                      }}
                    >
                      <Icon name={tool.icon} size={16} color={isActive ? 'var(--accent)' : 'var(--text-muted)'} style={{ marginTop: 1, flexShrink: 0 }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? 'var(--accent)' : 'var(--text-color)' }}>
                          {tool.label}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                          {tool.hint}
                        </span>
                      </div>
                      {isActive && (
                        <Icon name="check" size={13} color="var(--accent)" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                      )}
                    </button>
                  );
                })}
                <div style={{
                  padding: '4px 10px 6px',
                  fontSize: 10,
                  color: 'var(--text-dim)',
                  borderTop: '1px solid var(--border-rgba)',
                  marginTop: 2,
                  lineHeight: 1.5,
                }}>
                  도구를 누르면 아이콘이 바뀝니다 · 그 다음 버튼을 클릭해 실행
                  {cleanupMode === 'inPlace' && (
                    <div style={{ color: 'var(--color-destructive, #f59e0b)', fontWeight: 600, marginTop: 2 }}>
                      ⚠ 본문에 적용 모드 — 토스트의 '되돌리기'로 복구 가능
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <HeaderBtn
            icon={pinned ? 'lock' : 'lock_open'}
            title={pinned ? '보호 해제 (Ctrl+P)' : '보호 · 자동 만료 안 됨 (Ctrl+P)'}
            onClick={onTogglePin}
            active={pinned}
          />
          <HeaderBtn
            icon="save_alt"
            title="다른 이름으로 저장"
            onClick={handleExport}
          />
          <HeaderBtn
            icon="open_in_new"
            title="메모장에서 열기"
            onClick={handleOpenExternal}
          />
          <HeaderBtn
            icon="delete"
            title="삭제 · 휴지통으로 이동"
            onClick={onTrash}
            destructive
          />
          <div style={{ width: 1, height: 18, background: 'var(--border-rgba)', margin: '0 4px' }} />
          <HeaderBtn icon="close" title="닫기 (Esc)" onClick={handleClose} />
        </div>

        {/* Body — edit (textarea) or preview (rendered markdown).
            Edit mode keeps Korean IME native + autosave debounce.
            Preview mode uses memoMarkdown to render the same body
            with structural styling (headings, lists, checkboxes,
            bold/italic/code). Toggle with the eye icon or Ctrl+M.
            User said the editor placeholder TMI was noise, so we
            keep just the first line. */}
        {mode === 'edit' ? (
          <textarea
            ref={textareaRef}
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder="메모를 적어주세요. 첫 줄이 제목이 됩니다."
            spellCheck={false}
            style={{
              flex: 1,
              background: 'transparent',
              color: 'var(--text-color)',
              border: 'none',
              outline: 'none',
              resize: 'none',
              padding: '16px 18px',
              fontFamily: '"Pretendard", "Apple SD Gothic Neo", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 14,
              lineHeight: 1.55,
              letterSpacing: '0.005em',
            }}
          />
        ) : (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 22px',
              fontFamily: '"Pretendard", "Apple SD Gothic Neo", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              color: 'var(--text-color)',
            }}
          >
            {body.trim() ? (
              renderMemoMarkdown(body, {
                onToggleCheckbox: (lineIdx, checked) => {
                  // In preview mode the user can still tick boxes —
                  // we mutate the source body and let autosave catch
                  // it. The textarea picks up the fresh body via the
                  // controlled-value path on next mode switch.
                  const lines = body.split(/\r?\n/);
                  if (lineIdx < 0 || lineIdx >= lines.length) return;
                  lines[lineIdx] = lines[lineIdx].replace(
                    /^(\s*\[)([ xX])(\]\s+)/,
                    `$1${checked ? 'x' : ' '}$3`
                  );
                  setBody(lines.join('\n'));
                },
              })
            ) : (
              <div style={{ color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic' }}>
                메모가 비어있어요.
              </div>
            )}
          </div>
        )}

        {/* Footer — char/line count + visible save status.
            The save indicator is the answer to "어, 저장 버튼이 없는데
            저장된 거 맞나?" — without a button, the user needs SOME
            signal that their typing actually committed. We keep three
            states: "저장 중...", "저장됨 ✓", and idle (just the helper
            hint). The state is driven by the same debounce path as the
            real save, so what the user sees == what's happening. */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 14px',
            borderTop: '1px solid var(--border-rgba)',
            fontSize: 10,
            color: 'var(--text-dim)',
            flexShrink: 0,
          }}
        >
          <span>{charCount}자 · {lineCount}줄</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {saveStatus === 'pending' ? (
              <>
                <Icon name="cloud_sync" size={11} color="var(--text-dim)" />
                <span style={{ color: 'var(--text-muted)' }}>저장 중…</span>
              </>
            ) : saveStatus === 'saved' ? (
              <>
                <Icon name="check_circle" size={11} color="#22c55e" />
                <span style={{ color: '#22c55e', fontWeight: 600 }}>저장됨</span>
              </>
            ) : (
              <span style={{ opacity: 0.7 }}>
                자동 저장 · Esc 또는 Ctrl+Enter로 닫기
              </span>
            )}
          </span>
        </div>
      </div>
    </>
  );
}

interface HeaderBtnProps {
  icon: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

function HeaderBtn({ icon, title, onClick, active, destructive, disabled }: HeaderBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      style={{
        // Icon-only — same family rule the widget secondary row
        // follows. Square 26×26 footprint stays compact at the
        // typical dialog width even with all 7 buttons rendered.
        width: 26,
        height: 26,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        borderRadius: 7,
        background: active ? 'var(--accent-dim)' : 'transparent',
        color: disabled ? 'var(--text-dim)' :
               destructive ? '#ef4444' :
               active ? 'var(--accent)' : 'var(--text-muted)',
        border: '1px solid ' + (active ? 'var(--accent)' : 'transparent'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = active ? 'var(--accent-dim)' : 'var(--surface-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? 'var(--accent-dim)' : 'transparent'; }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}
