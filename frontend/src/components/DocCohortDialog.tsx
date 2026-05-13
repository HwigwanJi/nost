/**
 * DocCohortDialog — "최신 버전 확인" quick-action surface.
 *
 * Opened by the ItemCard hold/right-click menu for doc-like cards.
 * Two phases:
 *
 *   1. detection (first time, when item.docCohort is unset)
 *      → analyse the basename → propose a pattern → user confirms
 *      → save binding to item.docCohort
 *
 *   2. ranked-list (always reached after detection OR when binding exists)
 *      → main.js scans directory for masking pattern
 *      → renderer ranks results via docCohort.ts comparator
 *      → user sees "💡 최신: filename" + buttons:
 *           [최신으로 바꾸기]  [다른 파일 선택]  [취소]
 *      → "다른 파일 선택" expands the full ranked list (radio select)
 *
 * Saving the choice updates item.value to the picked file and persists
 * item.docCohort (binding stays for future scans without re-prompt).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LauncherItem, TokenPreset } from '../types';
import { electronAPI } from '../electronBridge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/Icon';
import { useBusyMark } from '../lib/userBusy';
import {
  basenameOf, detectPattern, matchPreset, rankCandidates,
  type ScanCandidate, type RankedCandidate, type TokenMatch,
} from '../lib/docCohort';

// Korean preset labels — keep in sync with the settings UI.
const PRESET_LABELS: Record<TokenPreset, string> = {
  numeric:            '버전 번호 (_v3)',
  semver:             '세마버 (1.2.3)',
  'date-yymmdd':      '날짜 (240513)',
  'date-yyyymmdd':    '날짜 (20240513)',
  'date-iso':         '날짜 (2024-05-13)',
  'date-dotted':      '날짜 (2024.05.13)',
  label:              '라벨 (draft → final)',
  'date-yyyymmdd_re': '날짜 + 개정 (20260513_RE4)',
  'date-iso_v':       '날짜 + 버전 (2024-05-13_v2)',
  'semver-build':     '세마버 + 빌드 (1.2.3-build42)',
  'label-rev':        '라벨 + 개정 (final_rev2)',
  mtime:              '파일 수정 시각 (fallback)',
};

interface Props {
  open: boolean;
  /** The card we're managing. Must have a path-like `value`. */
  item: LauncherItem;
  /** Token presets enabled in global settings — drives detection order. */
  enabledPresets: TokenPreset[];
  /** Label hierarchy (older → newer). */
  labelOrder: string[];
  /**
   * Commit the user's choice. The caller updates BOTH item.value (the
   * picked path) AND item.docCohort (the binding so subsequent scans skip
   * detection). spaceId is captured at open-time by the caller.
   */
  onCommit: (next: { value: string; pattern: string; tokenType: TokenPreset; directory: string }) => void;
  onClose: () => void;
}

type Phase =
  | { kind: 'scanning' }
  | { kind: 'detect'; candidates: { match: TokenMatch; mtime: number }[]; rawItems: ScanCandidate[] }
  | { kind: 'ranked'; ranked: RankedCandidate[]; preset: TokenPreset; mask: string }
  | { kind: 'error'; message: string };

export function DocCohortDialog({ open, item, enabledPresets, labelOrder, onCommit, onClose }: Props) {
  useBusyMark('modal:doc-cohort', open);
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' });
  const [showAll, setShowAll] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const inflightRef = useRef(0);

  // Memoise the directory + current basename so we don't recompute on
  // every re-render (and to give the scan effect a stable closure).
  const { directory, currentBasename } = useMemo(() => {
    const v = item.value ?? '';
    const last = Math.max(v.lastIndexOf('\\'), v.lastIndexOf('/'));
    return {
      directory: last >= 0 ? v.slice(0, last) : v,
      currentBasename: basenameOf(v),
    };
  }, [item.value]);

  // ── Scan effect: runs every time the dialog opens. Saved binding
  // (item.docCohort) lets us jump straight to the ranked phase; otherwise
  // we go through detection.
  useEffect(() => {
    if (!open) return;
    setPhase({ kind: 'scanning' });
    setShowAll(false);
    setSelectedPath(null);

    const myCall = ++inflightRef.current;

    (async () => {
      if (item.docCohort) {
        // Saved binding → scan with its mask + rank with its preset.
        const r = await electronAPI.listDocCohort(item.docCohort.directory, item.docCohort.pattern);
        if (myCall !== inflightRef.current) return;
        if (!r.ok) { setPhase({ kind: 'error', message: r.error ?? 'scan-failed' }); return; }
        const ranked = rankCandidates(r.items, item.docCohort.tokenType, labelOrder);
        setPhase({ kind: 'ranked', ranked, preset: item.docCohort.tokenType, mask: item.docCohort.pattern });
        return;
      }

      // No binding — detect from current filename first. We use the
      // detection match's mask as the listing pattern.
      const det = detectPattern(currentBasename, enabledPresets, labelOrder);
      if (!det || det.preset === 'mtime') {
        // Fall back to mtime: list every file in the directory, rank by
        // mtime, let the user pick manually.
        const r = await electronAPI.listDocCohort(directory, '*');
        if (myCall !== inflightRef.current) return;
        if (!r.ok) { setPhase({ kind: 'error', message: r.error ?? 'scan-failed' }); return; }
        const ranked = rankCandidates(r.items, 'mtime', labelOrder);
        setPhase({ kind: 'ranked', ranked, preset: 'mtime', mask: '*' });
        return;
      }

      // Detected a pattern — scan once with the proposed mask and stash
      // raw items so the "different pattern" path can re-rank without
      // a second round-trip. We hand the user a confirm step BEFORE
      // committing the binding.
      const r = await electronAPI.listDocCohort(directory, det.mask);
      if (myCall !== inflightRef.current) return;
      if (!r.ok) { setPhase({ kind: 'error', message: r.error ?? 'scan-failed' }); return; }

      // Build the candidate annotation list so the confirm screen can
      // preview "found N siblings". Drop entries that don't actually
      // match the detected preset (mask is permissive, preset is strict).
      const annotated = r.items
        .map(it => ({ raw: it, m: matchPreset(it.basename, det.preset, labelOrder) }))
        .filter(a => a.m?.token != null)
        .map(a => ({ match: a.m!, mtime: a.raw.mtime }));

      // If only the current file matches, skip the confirm — show ranked
      // (it'll be a 1-element list, but the dialog still lets the user
      // pick a different pattern through the "다른 파일" path).
      if (annotated.length <= 1) {
        const ranked = rankCandidates(r.items, det.preset, labelOrder);
        setPhase({ kind: 'ranked', ranked, preset: det.preset, mask: det.mask });
        return;
      }

      setPhase({ kind: 'detect', candidates: annotated, rawItems: r.items });
    })().catch(e => {
      if (myCall !== inflightRef.current) return;
      setPhase({ kind: 'error', message: String(e?.message ?? e) });
    });
  }, [open, item.value, item.docCohort, directory, currentBasename, enabledPresets, labelOrder]);

  // Confirm the detected pattern → transition to ranked.
  const acceptDetection = useCallback((preset: TokenPreset, mask: string, rawItems: ScanCandidate[]) => {
    const ranked = rankCandidates(rawItems, preset, labelOrder);
    setPhase({ kind: 'ranked', ranked, preset, mask });
  }, [labelOrder]);

  // Commit selection → caller persists.
  const commitChoice = useCallback((picked: RankedCandidate, preset: TokenPreset, mask: string) => {
    onCommit({
      value: picked.path,
      pattern: mask,
      tokenType: preset,
      directory,
    });
    onClose();
  }, [onCommit, onClose, directory]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent size="lg" style={{ padding: 0, overflow: 'hidden' }}>
        <DialogHeader style={{ padding: '16px 20px 10px', borderBottom: '1px solid var(--border-rgba)' }}>
          <DialogTitle style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="schedule" size={16} color="var(--accent)" />
            최신 버전 확인
          </DialogTitle>
        </DialogHeader>

        <div style={{ padding: '14px 20px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Directory + current filename — always shown, sets context */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)' }}>
              <Icon name="folder_open" size={12} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{directory}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: 'monospace' }}>
              <Icon name="description" size={13} color="var(--text-muted)" />
              <span style={{ color: 'var(--text-color)' }}>{currentBasename}</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>현재</span>
            </div>
          </div>

          {/* ── Scanning state ── */}
          {phase.kind === 'scanning' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 0', color: 'var(--text-muted)', fontSize: 12 }}>
              <Icon name="sync" size={16} className="animate-spin" />
              디렉터리 스캔 중...
            </div>
          )}

          {/* ── Error state ── */}
          {phase.kind === 'error' && (
            <div style={{
              padding: '14px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--destructive) 10%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--destructive) 30%, transparent)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Icon name="error_outline" size={14} color="var(--destructive)" />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--destructive)' }}>스캔 실패</span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{phase.message}</p>
            </div>
          )}

          {/* ── Detect-confirm state ── */}
          {phase.kind === 'detect' && (() => {
            // All candidates share the same preset since detectPattern
            // returns one; grab it from the first match.
            const preset = phase.candidates[0].match.preset;
            const mask   = phase.candidates[0].match.mask;
            return (
              <>
                <div style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
                  border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                    이 파일과 비슷한 패턴을 가진 파일이 <strong style={{ color: 'var(--accent)' }}>{phase.candidates.length}개</strong> 있어요.
                  </div>
                  <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-color)', marginBottom: 4 }}>
                    {mask}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                    {PRESET_LABELS[preset]}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={() => acceptDetection(preset, mask, phase.rawItems)}
                    style={primaryBtn}
                  >
                    <Icon name="check" size={14} /> 확인하기
                  </button>
                  <button
                    onClick={onClose}
                    style={ghostBtn}
                  >
                    취소
                  </button>
                </div>
              </>
            );
          })()}

          {/* ── Ranked state ── */}
          {phase.kind === 'ranked' && (() => {
            const ranked = phase.ranked;
            const newest = ranked[0];
            const currentInList = ranked.find(r => r.basename === currentBasename);
            const isAlreadyNewest = newest && currentInList && newest.basename === currentBasename;

            if (!newest) {
              return (
                <div style={{ padding: '18px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  매칭되는 파일을 찾지 못했어요.
                </div>
              );
            }

            return (
              <>
                {/* Headline result */}
                {isAlreadyNewest ? (
                  <div style={{
                    padding: '12px 14px', borderRadius: 8,
                    background: 'color-mix(in srgb, #22c55e 10%, var(--surface))',
                    border: '1px solid color-mix(in srgb, #22c55e 30%, transparent)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="check_circle" size={14} color="#22c55e" />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>이미 최신 버전이에요</span>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    padding: '12px 14px', borderRadius: 8,
                    background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
                    border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                      💡 발견된 최신
                    </div>
                    <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-color)' }}>
                      {newest.basename}
                    </div>
                  </div>
                )}

                {/* Buttons */}
                {!isAlreadyNewest && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      onClick={() => commitChoice(newest, phase.preset, phase.mask)}
                      style={primaryBtn}
                    >
                      <Icon name="published_with_changes" size={14} /> 최신으로 바꾸기
                    </button>
                    <button onClick={() => setShowAll(s => !s)} style={ghostBtn}>
                      {showAll ? '목록 접기' : '다른 파일 선택'}
                    </button>
                  </div>
                )}

                {/* Already-newest still allows "다른 파일 선택" */}
                {isAlreadyNewest && (
                  <button onClick={() => setShowAll(s => !s)} style={ghostBtn}>
                    {showAll ? '목록 접기' : '다른 파일 선택'}
                  </button>
                )}

                {/* Full ranked list */}
                {showAll && (
                  <div style={{
                    marginTop: 6,
                    border: '1px solid var(--border-rgba)',
                    borderRadius: 8,
                    maxHeight: 280,
                    overflowY: 'auto',
                  }}>
                    {ranked.map((r, i) => {
                      const isCurrent = r.basename === currentBasename;
                      const isSelected = selectedPath === r.path;
                      return (
                        <button
                          key={r.path}
                          onClick={() => setSelectedPath(r.path)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            width: '100%', padding: '8px 12px',
                            border: 'none',
                            borderBottom: i === ranked.length - 1 ? 'none' : '1px solid var(--border-rgba)',
                            background: isSelected ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                            color: 'var(--text-color)',
                            fontFamily: 'monospace', fontSize: 11,
                            cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          <span style={{
                            width: 12, height: 12, borderRadius: 6,
                            border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border-focus)'}`,
                            background: isSelected ? 'var(--accent)' : 'transparent',
                            flexShrink: 0,
                          }} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.basename}
                          </span>
                          {i === 0 && <Tag color="#22c55e">최신</Tag>}
                          {isCurrent && <Tag color="var(--text-muted)">현재</Tag>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Commit button — only enabled when a non-current row is picked */}
                {showAll && selectedPath && selectedPath !== currentInList?.path && (
                  <button
                    onClick={() => {
                      const picked = ranked.find(r => r.path === selectedPath);
                      if (picked) commitChoice(picked, phase.preset, phase.mask);
                    }}
                    style={{ ...primaryBtn, marginTop: 4 }}
                  >
                    <Icon name="check" size={14} /> 선택한 파일로 바꾸기
                  </button>
                )}
              </>
            );
          })()}
        </div>

        <DialogFooter style={{ padding: '12px 20px', borderTop: '1px solid var(--border-rgba)' }}>
          <button onClick={onClose} style={ghostBtn}>닫기</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Small visual helpers (kept inline; no design-system token) ────────
function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700,
      padding: '2px 6px', borderRadius: 99,
      background: `color-mix(in srgb, ${color} 18%, transparent)`,
      color,
      flexShrink: 0,
    }}>{children}</span>
  );
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '9px 12px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  flex: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-rgba)',
  background: 'var(--surface)',
  color: 'var(--text-color)',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
