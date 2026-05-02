/**
 * MemoTrashDialog — list of trashed memos with restore / hard-delete.
 *
 * Why a separate dialog (not a sidebar item or a tab):
 *   The trash is intentionally OUT of the main flow. Per spec it's a
 *   safety net, not a working surface. Burying it in settings keeps
 *   memos feeling ephemeral; surfacing it would make users feel
 *   responsible for cleaning trash, which defeats the "auto-fade"
 *   value prop.
 *
 * Restore: clears trashedAt and resets TTL to current default. The memo
 * reappears in its original space.
 * Hard-delete: drops the item entirely, no recovery.
 *
 * Auto-purge of overdue trash items happens at app start (see
 * purgeExpiredMemos in memoUtils). This dialog only shows currently-
 * surviving trashed memos.
 */

import { useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AppData, LauncherItem } from '../types';
import { memoTitleFromBody, memoBodyPreview, resolveMemoSettings } from '../lib/memoUtils';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface TrashEntry {
  spaceId: string;
  spaceName: string;
  presetId: string;
  presetLabel: string;
  item: LauncherItem;
}

interface MemoTrashDialogProps {
  open: boolean;
  onClose: () => void;
  data: AppData;
  onRestore: (presetId: string, spaceId: string, itemId: string) => void;
  onHardDelete: (presetId: string, spaceId: string, itemId: string) => void;
  onEmptyAll: () => void;
}

export function MemoTrashDialog({ open, onClose, data, onRestore, onHardDelete, onEmptyAll }: MemoTrashDialogProps) {
  const settings = resolveMemoSettings(data.settings.memo);
  const retentionMs = settings.trashRetentionHours * 60 * 60 * 1000;
  // Register with the global ESC stack so when this dialog is on top,
  // ESC closes IT — not the editor or tool mode beneath. Radix's own
  // Esc handling still triggers onOpenChange(false) which calls onClose,
  // but our stack handler runs FIRST (capture phase in App.tsx) and
  // produces the same outcome — the redundancy is intentional defence.
  useEscapeKey(onClose, open);

  // Collect every trashed memo across every preset (trash is global —
  // a memo trashed in preset 2 still surfaces here even when preset 1
  // is active).
  const entries: TrashEntry[] = useMemo(() => {
    const out: TrashEntry[] = [];
    for (const preset of data.presets) {
      for (const space of preset.spaces) {
        for (const item of space.items) {
          if (item.type === 'memo' && item.memo?.trashedAt) {
            out.push({
              spaceId: space.id,
              spaceName: space.name,
              presetId: preset.id,
              presetLabel: preset.label,
              item,
            });
          }
        }
      }
    }
    // Most-recently-trashed first (so quick restores find the freshest one).
    out.sort((a, b) => (b.item.memo?.trashedAt ?? 0) - (a.item.memo?.trashedAt ?? 0));
    return out;
  }, [data.presets]);

  const now = Date.now();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="delete" size={16} />
            휴지통
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-dim)', marginLeft: 6 }}>
              {entries.length}개 · 보관 {settings.trashRetentionHours}시간 후 영구 삭제
            </span>
          </DialogTitle>
        </DialogHeader>

        {entries.length === 0 ? (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontSize: 12,
            }}
          >
            휴지통이 비어있어요.
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 'min(60vh, 500px)',
                overflowY: 'auto',
                padding: '4px 0',
              }}
            >
              {entries.map(({ spaceId, spaceName, presetId, presetLabel, item }) => {
                const memo = item.memo!;
                const trashedAt = memo.trashedAt ?? 0;
                const remainsMs = trashedAt + retentionMs - now;
                const remainsHours = Math.max(0, Math.ceil(remainsMs / (60 * 60 * 1000)));
                const title = memoTitleFromBody(memo.body);
                const preview = memoBodyPreview(memo.body, 1);
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '8px 10px',
                      background: 'var(--surface)',
                      border: '1px solid var(--border-rgba)',
                      borderRadius: 8,
                    }}
                  >
                    <Icon name="sticky_note_2" size={14} color="var(--text-muted)" style={{ marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--text-color)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {title}
                      </div>
                      {preview && (
                        <div
                          style={{
                            fontSize: 10.5,
                            color: 'var(--text-muted)',
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {preview}
                        </div>
                      )}
                      <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 3 }}>
                        {presetLabel} · {spaceName} · {remainsHours > 0 ? `${remainsHours}시간 후 삭제` : '곧 삭제'}
                      </div>
                    </div>
                    <button
                      onClick={() => onRestore(presetId, spaceId, item.id)}
                      title="되살리기 — 수명을 새로 채우고 원래 자리로"
                      style={{
                        padding: '3px 8px',
                        borderRadius: 5,
                        background: 'var(--accent-dim)',
                        color: 'var(--accent)',
                        border: '1px solid var(--accent)',
                        fontSize: 10.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        flexShrink: 0,
                      }}
                    >
                      되살리기
                    </button>
                    <button
                      onClick={() => onHardDelete(presetId, spaceId, item.id)}
                      title="영구 삭제"
                      style={{
                        width: 22, height: 22,
                        borderRadius: 5,
                        background: 'transparent',
                        color: '#ef4444',
                        border: '1px solid var(--border-rgba)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="delete_forever" size={11} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>
              <button
                onClick={onEmptyAll}
                style={{
                  padding: '5px 11px',
                  borderRadius: 6,
                  background: 'transparent',
                  color: '#ef4444',
                  border: '1px solid var(--border-rgba)',
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                전부 비우기
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
