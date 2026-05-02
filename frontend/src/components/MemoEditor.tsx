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

const AUTOSAVE_DEBOUNCE_MS = 500;
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

  // Refs to latest callbacks so the keydown handler effect can read them
  // without re-binding (and dropping events) on every parent re-render.
  const cbRef = useRef({ onClose, onExtend, onTogglePin });
  cbRef.current = { onClose, onExtend, onTogglePin };

  // ── Autosave ───────────────────────────────────────────────────
  useEffect(() => {
    if (body === lastCommittedRef.current) return;
    if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
    debouncedSaveRef.current = setTimeout(() => {
      onChangeBody(body);
      lastCommittedRef.current = body;
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
    };
  }, [body, onChangeBody]);

  // Flush pending save on unmount (close fires unmount via parent state).
  useEffect(() => {
    return () => {
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
      if (lastCommittedRef.current !== body) {
        // body inside this closure may be stale — capture the textarea's
        // current value as the truth-of-the-moment.
        const final = textareaRef.current?.value ?? body;
        if (final !== lastCommittedRef.current) {
          onChangeBody(final);
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Plays the close animation (~150ms) before unmounting via onClose.
  // Auto-deletes empty newly-created memos to avoid grid pollution.
  const handleClose = () => {
    if (closing) return;
    // Flush latest body BEFORE the empty check (otherwise an in-flight
    // typed character wouldn't be reflected when we evaluate "empty").
    const finalBody = textareaRef.current?.value ?? body;
    if (finalBody !== lastCommittedRef.current) {
      onChangeBody(finalBody);
      lastCommittedRef.current = finalBody;
    }
    // Auto-delete: empty body AND the memo was created in the last 3
    // minutes (so we know this isn't an old memo the user just emptied).
    if (item.memo && finalBody.trim().length === 0) {
      const age = Date.now() - item.memo.createdAt;
      if (age <= AUTO_DELETE_GRACE_MS) {
        onAutoDeleteIfEmpty();
      }
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

          {/* Action buttons.
              Order: 보기 토글 (preview) → 복사 → 보호 → 다른이름저장 →
              메모장에서열기 → 삭제 → 닫기.

              Removed the standalone "살리기" — TTL pill above takes
              over that role.
              "핀" → "보호" (label collision with card-grid pin).
              "내보내기" now means save-as (file picker, no shell-open,
              no card delete) per the user's explicit redefinition. */}
          <HeaderBtn
            icon={mode === 'edit' ? 'visibility' : 'edit'}
            label={mode === 'edit' ? '미리보기' : '편집'}
            title="마크다운 미리보기 / 편집 토글 (Ctrl+M)"
            onClick={() => setMode(m => m === 'edit' ? 'preview' : 'edit')}
            active={mode === 'preview'}
          />
          <HeaderBtn icon="content_copy" label="복사" title="본문 클립보드로 (Ctrl+Shift+C)" onClick={handleCopy} />
          <HeaderBtn
            icon={pinned ? 'shield' : 'shield_outline'}
            label={pinned ? '보호 해제' : '보호'}
            title={pinned ? '보호 해제 (Ctrl+P)' : '메모를 보호 (자동 만료 안 됨, Ctrl+P)'}
            onClick={onTogglePin}
            active={pinned}
          />
          <HeaderBtn icon="save_alt"   label="다른 이름으로 저장" title="원하는 위치에 .txt로 저장" onClick={handleExport} />
          <HeaderBtn icon="open_in_new" label="메모장에서 열기"   title="기본 텍스트 편집기로 열기" onClick={handleOpenExternal} />
          <HeaderBtn icon="delete" label="삭제" title="휴지통으로 보내기" onClick={onTrash} destructive />
          <div style={{ width: 1, height: 20, background: 'var(--border-rgba)', margin: '0 4px' }} />
          <HeaderBtn icon="close" label="" title="닫기 (Esc)" onClick={handleClose} />
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

        {/* Footer — char/line count, helper hint */}
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
          <span style={{ opacity: 0.7 }}>
            저장은 자동으로 — Esc 또는 Ctrl+Enter로 닫기
          </span>
        </div>
      </div>
    </>
  );
}

interface HeaderBtnProps {
  icon: string;
  label: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

function HeaderBtn({ icon, label, title, onClick, active, destructive, disabled }: HeaderBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: label ? '5px 9px' : '5px',
        borderRadius: 7,
        background: active ? 'var(--accent-dim)' : 'transparent',
        color: disabled ? 'var(--text-dim)' :
               destructive ? '#ef4444' :
               active ? 'var(--accent)' : 'var(--text-muted)',
        border: '1px solid ' + (active ? 'var(--accent)' : 'transparent'),
        fontSize: 11,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = active ? 'var(--accent-dim)' : 'var(--surface-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? 'var(--accent-dim)' : 'transparent'; }}
    >
      <Icon name={icon} size={13} />
      {label && <span>{label}</span>}
    </button>
  );
}
