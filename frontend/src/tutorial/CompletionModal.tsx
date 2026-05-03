/**
 * CompletionModal — fires after the runner's last step finishes.
 *
 * Shows the user:
 *   1. The reward they just earned (+ N일).
 *   2. A list of items the quest added to nost (provision + their
 *      own runtime additions).
 *   3. Two buttons:
 *        [정리하기]  — reverse every addition (provisioner.cleanup)
 *        [남기기]    — keep everything
 *
 * Reward already lives in tutorialState.rewardDays (the runner
 * called markCompleted before navigating here). We just *display*
 * it; the keep/discard choice doesn't affect the reward.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/Icon';
import type { AppData } from '../types';
import type { Quest, ActiveQuest } from './types';

interface Props {
  open: boolean;
  quest: Quest;
  /** The quest's addedXxxIds — items this run created (provision +
   *  what the user did during the steps). */
  added: Pick<ActiveQuest, 'addedItemIds' | 'addedSpaceIds' | 'addedMemoIds'>;
  /** Used to render the friendly labels for each id ("github.com 카드"). */
  data: AppData;
  /** Total reward + bonus the user just earned (delta, not cumulative). */
  earnedDays: number;
  /** Cumulative reward days after this completion. */
  totalDays: number;
  /** True when finishing this quest also tipped a category complete. */
  bonusCategory?: string;
  /** True when finishing this quest tipped the master bonus. */
  bonusMaster?: boolean;
  onKeep: () => void;
  onCleanup: () => void;
}

export function CompletionModal({
  open, quest, added, data, earnedDays, totalDays,
  bonusCategory, bonusMaster, onKeep, onCleanup,
}: Props) {
  const itemEntries = added.addedItemIds
    .map(id => {
      for (const sp of data.spaces) {
        const it = sp.items.find(i => i.id === id);
        if (it) return { kind: 'item' as const, label: `${it.title || '(이름 없음)'} · ${typeLabel(it.type)}`, sub: sp.name };
      }
      return null;
    })
    .filter(Boolean) as Array<{ kind: 'item'; label: string; sub: string }>;

  const spaceEntries = added.addedSpaceIds
    .map(id => {
      const sp = data.spaces.find(s => s.id === id);
      return sp ? { kind: 'space' as const, label: `${sp.name || '(이름 없음)'} 스페이스`, sub: `${sp.items.length}개 카드` } : null;
    })
    .filter(Boolean) as Array<{ kind: 'space'; label: string; sub: string }>;

  const memoEntries = added.addedMemoIds
    .map(id => {
      for (const sp of data.spaces) {
        const it = sp.items.find(i => i.id === id);
        if (it) return { kind: 'memo' as const, label: `${it.title || '(빈 메모)'} · 메모`, sub: sp.name };
      }
      return null;
    })
    .filter(Boolean) as Array<{ kind: 'memo'; label: string; sub: string }>;

  const allEntries = [...itemEntries, ...spaceEntries, ...memoEntries];

  return (
    <Dialog open={open} onOpenChange={() => { /* must explicitly choose */ }}>
      <DialogContent style={{ width: 480, maxWidth: '92vw', padding: 0, overflow: 'hidden' }}>
        <DialogHeader style={{
          padding: '18px 22px 14px',
          borderBottom: '1px solid var(--border-rgba)',
          background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
        }}>
          <DialogTitle style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="celebration" size={18} color="var(--accent)" />
            {quest.title} 완료
          </DialogTitle>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
              +{earnedDays}일 적립
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              누적 {totalDays}일
              {bonusCategory && ` · 카테고리 완주 보너스 +2일`}
              {bonusMaster && ` · 마스터 보너스 +7일`}
            </span>
          </div>
        </DialogHeader>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {allEntries.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              이번 튜토리얼에서 새로 만든 항목이 없어요. 기존 데이터는 그대로 유지됩니다.
            </p>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                이번 튜토리얼에서 추가된 항목 ({allEntries.length}개):
              </p>
              <ul style={{
                margin: 0, padding: 0, listStyle: 'none',
                display: 'flex', flexDirection: 'column', gap: 4,
                maxHeight: 220, overflowY: 'auto',
              }}>
                {allEntries.map((e, i) => (
                  <li key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 7,
                    background: 'var(--surface)',
                    fontSize: 11.5,
                  }}>
                    <Icon name={iconFor(e.kind)} size={13} color="var(--text-muted)" />
                    <span style={{ flex: 1, color: 'var(--text-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{e.sub}</span>
                  </li>
                ))}
              </ul>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                <b>남기기</b> = 노스트에 그대로 보존 · <b>정리하기</b> = 추가 항목만 삭제 (보상은 유지됩니다)
              </p>
            </>
          )}
        </div>

        <DialogFooter style={{ padding: '12px 20px', borderTop: '1px solid var(--border-rgba)' }}>
          {allEntries.length > 0 && (
            <Button variant="ghost" onClick={onCleanup}>정리하기</Button>
          )}
          <Button onClick={onKeep}>{allEntries.length > 0 ? '남기기' : '확인'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function typeLabel(t: string): string {
  switch (t) {
    case 'url':     return 'URL';
    case 'browser': return '브라우저 탭';
    case 'folder':  return '폴더';
    case 'app':     return '앱';
    case 'window':  return '창';
    case 'text':    return '텍스트';
    case 'cmd':     return '커맨드';
    case 'widget':  return '위젯';
    case 'memo':    return '메모';
    default:        return t;
  }
}

function iconFor(kind: 'item' | 'space' | 'memo'): string {
  switch (kind) {
    case 'item':  return 'add_card';
    case 'space': return 'view_compact';
    case 'memo':  return 'sticky_note_2';
  }
}
