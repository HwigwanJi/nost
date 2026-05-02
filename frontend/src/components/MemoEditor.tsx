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
   * "정리하여 복사" — strips markdown markers AND bullet glyphs from
   * the current body, copies the cleaned text to the clipboard.
   * Body itself is NOT modified — user keeps their formatted memo,
   * gets a clean snapshot for paste targets that already provide
   * their own list formatting (PowerPoint, Google Slides, etc).
   *
   * Address two real-world frustrations the user described:
   *   1. GPT/Claude paste → memo holds markdown → "paste as plain
   *      text" via Ctrl+Shift+V loses line breaks. Our cleaner
   *      preserves them.
   *   2. Existing bullet markers double up in PowerPoint
   *      ("• - item"). Cleaner strips the leading bullet glyph.
   */
  const handleCleanCopy = async () => {
    const cleaned = memoBodyToPlain(body);
    if (!cleaned.trim()) {
      showToast?.('정리할 내용이 없어요');
      return;
    }
    try {
      await navigator.clipboard.writeText(cleaned);
    } catch {
      try { electronAPI.copyText(cleaned, false); } catch { /* dev mode */ }
    }
    showToast?.('정리하여 복사했어요 (말머리표·서식 제거)');
  };

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
              title="클릭으로 수명 리셋 (Ctrl+S)"
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
          {/* 정리하여 복사 — strips markdown + bullet glyphs and
              copies. Non-destructive: the memo body stays intact.
              auto_fix_high glyph reads as "magic cleanup" — same
              vocabulary other apps (Notion, Linear) use for the
              transform-to-plain action. */}
          <HeaderBtn
            icon="auto_fix_high"
            title="정리하여 복사 — 말머리표·서식 제거"
            onClick={handleCleanCopy}
          />
          {/* Material Symbols doesn't have a `shield_outline` —
              that was rendering as raw text in the toolbar
              ("♡_OUTLINE" the user spotted). Use `lock_open` /
              `lock` instead: same "is this protected?" semantics,
              icons that actually exist, and the open ↔ closed
              metaphor reads instantly across locales. */}
          <HeaderBtn
            icon={pinned ? 'lock' : 'lock_open'}
            title={pinned ? '보호 해제 (Ctrl+P)' : '보호 — 자동 만료 안 됨 (Ctrl+P)'}
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
            title="삭제 — 휴지통으로 보내기"
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
