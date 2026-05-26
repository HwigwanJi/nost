/**
 * SyncPreviewModal — "지금 동기화" 클릭 시 확인 단계.
 *
 * 사용자가 commit 전에 무엇이 추가 / 가져와질지 명시적으로 보고 결정.
 * v1.3.47 이전 "버튼 클릭 = 즉시 push-pull" UX 가 black box 라서 사용자가
 * 우발적으로 다른 PC 의 옛 상태를 받아오는 사고 방지.
 *
 * 표시 내용:
 *   - 이 PC → 클라우드 (push 카운트, 카드 위주)
 *   - 클라우드 → 이 PC (pull 카운트)
 *   - 변경 없음 카운트 (양쪽 동일 id)
 *   - 디바이스 전용 settings 키 목록 (절대 sync 안 됨)
 *
 * 모드:
 *   - phase='preview' → 카운트 표시 + [취소] [실행]
 *   - phase='syncing' → 스피너 + 비활성 버튼
 */

import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Icon } from './ui/Icon';
import type { SyncDiff } from '../lib/sync/preview';
import { isNoOpDiff } from '../lib/sync/preview';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  diff: SyncDiff | null;
  /** preview 계산 중 / commit 중 / 일반 */
  phase: 'loading' | 'preview' | 'syncing' | 'error';
  errorMessage?: string | null;
}

function Row({ label, value, accent }: { label: string; value: number; accent?: 'push' | 'pull' | 'unchanged' }) {
  const color =
    accent === 'push'   ? 'var(--accent)' :
    accent === 'pull'   ? 'var(--accent)' :
    'var(--text-muted)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 0', borderBottom: '1px solid var(--border-rgba)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-color)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color, fontFamily: 'ui-monospace, monospace' }}>
        {value > 0 ? `+${value}` : '0'}
      </span>
    </div>
  );
}

function SectionHeader({ icon, title, count, color }: { icon: string; title: string; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <Icon name={icon} size={14} color={color} />
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-color)', letterSpacing: '0.02em' }}>
        {title}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
        총 +{count}
      </span>
    </div>
  );
}

export function SyncPreviewModal({ open, onClose, onConfirm, diff, phase, errorMessage }: Props) {
  // v1.3.48 UX: 변경 없음일 때 확인 버튼 disable — 의미 없는 round-trip 방지.
  const noOp = !!(diff && isNoOpDiff(diff));
  const canConfirm = phase === 'preview' && !!diff && !noOp;
  return (
    <Dialog
      open={open}
      // 동기화 진행 중 ESC / 백드롭 클릭으로 모달 닫히면 사용자가
      // 결과(성공/실패)를 못 봄. syncing phase 에선 dismiss 차단.
      onOpenChange={(o) => { if (!o && phase !== 'syncing') onClose(); }}
    >
      <DialogContent size="md" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 12px' }}>
          <DialogTitle style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-color)', margin: 0 }}>
            동기화 미리보기
          </DialogTitle>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
            {phase === 'loading' && '클라우드 상태를 확인하는 중…'}
            {phase === 'preview' && (
              diff && !diff.serverHasRow
                ? '클라우드에 처음 저장하는 단계예요. 이 PC 의 데이터를 그대로 올립니다.'
                : diff && isNoOpDiff(diff)
                  ? '양쪽이 이미 동일해요. 동기화해도 변경되는 항목이 없어요.'
                  : '아래 변경 사항을 확인한 뒤 동기화를 실행해주세요.'
            )}
            {phase === 'syncing' && '동기화 중… 잠시만 기다려주세요.'}
            {phase === 'error' && (errorMessage ?? '동기화 중 문제가 발생했어요.')}
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: '0 20px 12px', maxHeight: 360, overflowY: 'auto' }}>
          {phase === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 8, color: 'var(--text-muted)' }}>
              <Icon name="sync" size={14} className="animate-spin" />
              <span style={{ fontSize: 11 }}>계산 중…</span>
            </div>
          )}

          {phase !== 'loading' && diff && (
            <>
              {/* Push */}
              <div style={{ marginBottom: 14 }}>
                <SectionHeader
                  icon="cloud_upload"
                  title="이 PC → 클라우드"
                  count={diff.push.items + diff.push.spaces + diff.push.presets + diff.push.nodeGroups + diff.push.decks}
                  color="var(--accent)"
                />
                <Row label="카드"        value={diff.push.items} accent="push" />
                <Row label="스페이스"    value={diff.push.spaces} accent="push" />
                <Row label="프리셋"      value={diff.push.presets} accent="push" />
                <Row label="노드 그룹"   value={diff.push.nodeGroups} accent="push" />
                <Row label="덱"          value={diff.push.decks} accent="push" />
              </div>

              {/* Pull */}
              <div style={{ marginBottom: 14 }}>
                <SectionHeader
                  icon="cloud_download"
                  title="클라우드 → 이 PC"
                  count={diff.pull.items + diff.pull.spaces + diff.pull.presets + diff.pull.nodeGroups + diff.pull.decks}
                  color="var(--accent)"
                />
                <Row label="카드"        value={diff.pull.items} accent="pull" />
                <Row label="스페이스"    value={diff.pull.spaces} accent="pull" />
                <Row label="프리셋"      value={diff.pull.presets} accent="pull" />
                <Row label="노드 그룹"   value={diff.pull.nodeGroups} accent="pull" />
                <Row label="덱"          value={diff.pull.decks} accent="pull" />
              </div>

              {/* Unchanged */}
              {diff.unchangedItems > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <SectionHeader
                    icon="check_circle"
                    title="변경 없음 (양쪽 동일)"
                    count={diff.unchangedItems}
                    color="var(--text-muted)"
                  />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                    카드 {diff.unchangedItems}개는 이미 양쪽에 동일하게 있어요.
                  </p>
                </div>
              )}

              {/* Device-only — informational */}
              <div style={{
                marginTop: 14, padding: '10px 12px', borderRadius: 8,
                background: 'var(--surface)', border: '1px solid var(--border-rgba)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Icon name="computer" size={12} color="var(--text-muted)" />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                    이 PC 에만 유지되는 항목
                  </span>
                </div>
                <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: 0, lineHeight: 1.55 }}>
                  단축키, 자동 실행, 창 크기/위치, 모니터 매핑, 플로팅 버튼 위치 — 이 항목들은 PC 마다 달라야 자연스러워서 동기화되지 않아요.
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '6px 0 0', lineHeight: 1.55 }}>
                  폴더 / 앱 / 문서 카드도 경로가 PC 마다 달라 다른 PC 에서는 보이지 않을 수 있어요.
                </p>
              </div>
            </>
          )}

          {phase === 'error' && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--color-destructive) 8%, transparent)',
              border: '1px solid var(--color-destructive)',
              fontSize: 11, color: 'var(--color-destructive)',
              marginTop: 12,
            }}>
              {errorMessage ?? '알 수 없는 오류'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8,
          borderTop: '1px solid var(--border-rgba)', background: 'var(--surface)',
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'syncing'}
            style={{
              padding: '7px 14px', fontSize: 11, fontWeight: 600,
              background: 'transparent', color: 'var(--text-color)',
              border: '1px solid var(--border-rgba)', borderRadius: 6,
              cursor: phase === 'syncing' ? 'default' : 'pointer',
              fontFamily: 'inherit', opacity: phase === 'syncing' ? 0.55 : 1,
            }}
          >닫기</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm && phase !== 'syncing'}
            title={noOp ? '변경 사항이 없어 동기화할 항목이 없어요.' : ''}
            style={{
              padding: '7px 16px', fontSize: 11, fontWeight: 700,
              background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 6,
              cursor: canConfirm ? 'pointer' : 'default',
              fontFamily: 'inherit', opacity: canConfirm || phase === 'syncing' ? 1 : 0.55,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {phase === 'syncing' && <Icon name="sync" size={12} className="animate-spin" />}
            {phase === 'syncing' ? '동기화 중…' : '확인'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
