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
  todayYmd,
} from '../lib/memoUtils';

interface MemoEditorProps {
  item: LauncherItem;
  pinned: boolean;
  exportFolder?: string;
  onChangeBody: (body: string) => void;
  onClose: () => void;
  onExtend: () => void;
  onTogglePin: () => void;
  onTrash: () => void;
  /** Called after successful txt export. Parent should hard-delete the
   *  memo (per spec: export = "이동", not copy). */
  onExportedToTxt: (filePath: string) => void;
  /** Called by the empty-on-close auto-trash logic. */
  onAutoDeleteIfEmpty: () => void;
  showToast?: (msg: string) => void;
}

const AUTOSAVE_DEBOUNCE_MS = 500;
const AUTO_DELETE_GRACE_MS = 3 * 60 * 1000;

export function MemoEditor({
  item, pinned, exportFolder,
  onChangeBody, onClose, onExtend, onTogglePin, onTrash,
  onExportedToTxt, onAutoDeleteIfEmpty, showToast,
}: MemoEditorProps) {
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
    // Ctrl+S — 살리기 (TTL reset). Don't let the browser's "save page"
    // dialog escape into the world.
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
    // Ctrl+P — pin toggle
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      cbRef.current.onTogglePin();
      showToast?.(pinned ? '핀 해제됨' : '영구 보관으로 핀 설정');
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

  const handleExport = async () => {
    const title = memoTitleFromBody(body);
    const slug = slugifyTitle(title);
    try {
      const result = await electronAPI.exportMemoTxt({
        body,
        slug: `${slug}_${todayYmd(Date.now())}`,
        customFolder: exportFolder,
        openAfter: true,
      });
      if (result.success && result.filePath) {
        showToast?.(`파일로 내보냈습니다 — ${result.filePath.split(/[/\\]/).pop()}`);
        // Parent hard-deletes the memo so the file becomes the single
        // source of truth (per spec: export = move, not copy).
        onExportedToTxt(result.filePath);
        // Skip the close animation — the memo is gone, just unmount.
        setClosing(true);
        setTimeout(onClose, 100);
      } else {
        showToast?.('내보내기 실패: ' + (result.reason ?? '알 수 없는 오류'));
      }
    } catch (e) {
      showToast?.('내보내기 실패: ' + String(e));
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
          the grid distracting underneath. */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
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
          background: 'var(--surface)',
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
          {/* TTL pill */}
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 10px',
              borderRadius: 12,
              background: pinned ? 'var(--accent-dim)' : 'var(--surface-hover)',
              border: '1px solid var(--border-rgba)',
              fontSize: 11,
            }}
          >
            {pinned ? (
              <>
                <Icon name="bookmark" size={11} color="var(--accent)" />
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>영구 보관 중</span>
              </>
            ) : (
              <>
                <div
                  style={{
                    width: 50, height: 3,
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
              </>
            )}
          </div>

          <div style={{ flex: 1 }} />

          {/* Action buttons */}
          <HeaderBtn icon="add" label="살리기" title="수명을 다시 채웁니다 (Ctrl+S)" onClick={handleExtend} disabled={pinned} />
          <HeaderBtn icon="content_copy" label="복사" title="본문 클립보드로 (Ctrl+Shift+C)" onClick={handleCopy} />
          <HeaderBtn icon={pinned ? 'bookmark' : 'bookmark_border'} label={pinned ? '핀 해제' : '핀'} title="핀 토글 (Ctrl+P)" onClick={onTogglePin} active={pinned} />
          <HeaderBtn icon="upload_file" label="내보내기" title="txt로 저장하고 일반 카드로 변환" onClick={handleExport} />
          <HeaderBtn icon="delete" label="삭제" title="휴지통으로 보내기" onClick={onTrash} destructive />
          <div style={{ width: 1, height: 20, background: 'var(--border-rgba)', margin: '0 4px' }} />
          <HeaderBtn icon="close" label="" title="닫기 (Esc)" onClick={handleClose} />
        </div>

        {/* Editor — pure textarea. No toolbar, no markdown rendering.
            Korean IME works perfectly with native textarea. */}
        <textarea
          ref={textareaRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder={`메모를 적어주세요. 첫 줄이 제목이 됩니다.

7일 동안 안 만지면 알아서 사라집니다.
살리고 싶으면 카드의 ⊕ 버튼을 한 번 누르세요.`}
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
