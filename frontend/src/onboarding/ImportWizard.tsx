import { useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import { electronAPI } from '../electronBridge';
import { parseBookmarksHtml, parseMarkdownLinks, type ParseResult } from './importParsers';
import { useBusyMark } from '../lib/userBusy';
import type { Space } from '../types';

/**
 * ImportWizard — modal for getting other-tool data into nost.
 *
 * Three sources currently supported:
 *   - Browser bookmarks HTML (Chrome / Edge / Whale / Firefox; same format)
 *   - Markdown file with [text](url) links
 *   - .nost backup file (full restore)
 *
 * After a successful parse the user picks a merge strategy:
 *   - 'replace' — wipe the active preset's spaces and use only the imported
 *   - 'merge'   — append imported spaces to the existing list
 *
 * The wizard never writes data itself — it parses and hands a payload to
 * the parent's `onApply` callback. Same separation as WelcomeWizard.
 */

type ImportSource = 'bookmarks' | 'markdown' | 'nost';
type Strategy = 'merge' | 'replace';
type Step = 'pick-source' | 'pick-strategy' | 'error';

interface ImportPayload {
  kind: 'spaces';            // future: 'full-restore' for .nost
  spaces: Space[];
  strategy: Strategy;
}

interface FullRestorePayload {
  kind: 'full-restore';
  data: unknown;             // raw AppData blob
}

interface Props {
  open: boolean;
  onApply: (payload: ImportPayload | FullRestorePayload) => void;
  onClose: () => void;
}

interface Parsed {
  source: ImportSource;
  spaces: Space[];
  cardCount: number;
  fileName: string;
}

export function ImportWizard({ open, onApply, onClose }: Props) {
  const [step, setStep] = useState<Step>('pick-source');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useBusyMark('modal:import', open);

  if (!open) return null;

  const reset = () => {
    setStep('pick-source');
    setParsed(null);
    setError('');
    setLoading(false);
  };

  const handleSourcePick = async (source: ImportSource) => {
    setLoading(true);
    setError('');
    try {
      if (source === 'nost') {
        const r = await electronAPI.importData();
        if (!r.success) {
          if (r.reason !== 'canceled') {
            setError(r.reason ?? '복원 실패');
            setStep('error');
          }
          setLoading(false);
          return;
        }
        // .nost full restore — short-circuit the strategy step (it's
        // always a wholesale replace at the AppData level).
        onApply({ kind: 'full-restore', data: r.data });
        reset();
        onClose();
        return;
      }

      const kind = source === 'bookmarks' ? 'bookmarks-html' : 'markdown';
      const r = await electronAPI.pickAndReadText(kind);
      if (!r.success) {
        if (r.reason !== 'canceled') {
          setError(r.reason ?? '파일 읽기 실패');
          setStep('error');
        }
        setLoading(false);
        return;
      }
      const text = r.text ?? '';
      const result: ParseResult = source === 'bookmarks'
        ? parseBookmarksHtml(text)
        : parseMarkdownLinks(text, r.fileName?.replace(/\.[^.]+$/, '') ?? '마크다운');
      if (!result.ok) {
        setError(result.reason);
        setStep('error');
        setLoading(false);
        return;
      }
      setParsed({
        source,
        spaces: result.spaces,
        cardCount: result.cardCount,
        fileName: r.fileName ?? '',
      });
      setStep('pick-strategy');
      setLoading(false);
    } catch (e) {
      setError(String(e));
      setStep('error');
      setLoading(false);
    }
  };

  const handleStrategy = (strategy: Strategy) => {
    if (!parsed) return;
    onApply({ kind: 'spaces', spaces: parsed.spaces, strategy });
    reset();
    onClose();
  };

  const close = () => { reset(); onClose(); };

  return (
    <>
      <style>{`
        @keyframes nost-import-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes nost-import-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      `}</style>
      <div style={backdrop} onClick={close}>
        <div style={panel} onClick={e => e.stopPropagation()}>
          {/* Close */}
          <button onClick={close} style={closeBtn} title="닫기">×</button>

          {step === 'pick-source' && (
            <SourcePick onPick={handleSourcePick} loading={loading} />
          )}
          {step === 'pick-strategy' && parsed && (
            <StrategyPick
              parsed={parsed}
              onChoose={handleStrategy}
              onBack={() => { setParsed(null); setStep('pick-source'); }}
            />
          )}
          {step === 'error' && (
            <ErrorView reason={error} onBack={() => { setError(''); setStep('pick-source'); }} />
          )}
        </div>
      </div>
    </>
  );
}

// ── Step 1 — pick a source ─────────────────────────────────────────
function SourcePick({ onPick, loading }: { onPick: (s: ImportSource) => void; loading: boolean }) {
  return (
    <>
      <div style={hero}>
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.015em' }}>
          가져오기
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
          어디에서 가져올까요?<br />
          파일을 선택하면 카드로 변환해 드릴게요.
        </div>
      </div>

      <div style={sourceGrid}>
        <SourceCard
          icon="bookmark"
          color="#0ea5e9"
          title="브라우저 북마크"
          desc="Chrome · Edge · Whale · Firefox"
          hint="설정 → 북마크 관리자 → 내보내기 (.html)"
          onClick={() => onPick('bookmarks')}
          loading={loading}
        />
        <SourceCard
          icon="article"
          color="#a855f7"
          title="마크다운 파일"
          desc="[제목](URL) 형식 링크"
          hint="제목(#)이 있으면 스페이스로 자동 분리"
          onClick={() => onPick('markdown')}
          loading={loading}
        />
        <SourceCard
          icon="restore"
          color="#22c55e"
          title=".nost 백업"
          desc="다른 nost에서 내보낸 파일"
          hint="전체 복원 (현재 설정 덮어씁니다)"
          onClick={() => onPick('nost')}
          loading={loading}
        />
      </div>
    </>
  );
}

function SourceCard({
  icon, color, title, desc, hint, onClick, loading,
}: { icon: string; color: string; title: string; desc: string; hint: string; onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} style={{
      ...sourceBtn,
      opacity: loading ? 0.6 : 1,
      cursor: loading ? 'wait' : 'pointer',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 60%, black))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon name={icon} size={18} color="#fff" />
      </div>
      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-color)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>{desc}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
      </div>
      <Icon name="chevron_right" size={16} color="var(--text-dim)" />
    </button>
  );
}

// ── Step 2 — merge vs replace ───────────────────────────────────────
function StrategyPick({
  parsed, onChoose, onBack,
}: { parsed: Parsed; onChoose: (s: Strategy) => void; onBack: () => void }) {
  return (
    <>
      <div style={hero}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {parsed.fileName || '파일'} 분석 완료
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          스페이스 {parsed.spaces.length}개 · 카드 {parsed.cardCount}개
        </div>
      </div>

      {/* Quick preview of first 3 spaces */}
      <div style={previewBox}>
        {parsed.spaces.slice(0, 3).map(sp => (
          <div key={sp.id} style={previewRow}>
            <span style={{ fontWeight: 600, fontSize: 11.5 }}>{sp.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto' }}>
              {sp.items.length}개
            </span>
          </div>
        ))}
        {parsed.spaces.length > 3 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>
            그 외 {parsed.spaces.length - 3}개 스페이스
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.5 }}>
        현재 활성 프리셋에 어떻게 들이실 건가요?
      </div>

      <div style={ctaCol}>
        <button onClick={() => onChoose('merge')} style={primaryBtn}>
          <Icon name="merge" size={14} />
          기존에 추가하기 (병합)
        </button>
        <button onClick={() => onChoose('replace')} style={dangerBtn}>
          <Icon name="restart_alt" size={14} />
          기존을 대체하기
        </button>
        <button onClick={onBack} style={secondaryBtn}>
          ← 다시 선택
        </button>
      </div>
    </>
  );
}

function ErrorView({ reason, onBack }: { reason: string; onBack: () => void }) {
  return (
    <>
      <div style={hero}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(239, 68, 68, 0.16)',
          margin: '0 auto 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="error_outline" size={22} color="#ef4444" />
        </div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>가져오기 실패</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          {reason}
        </div>
      </div>
      <div style={ctaCol}>
        <button onClick={onBack} style={primaryBtn}>다시 시도</button>
      </div>
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────────
const backdrop: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9100,
  background: 'rgba(6, 6, 14, 0.6)',
  backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  animation: 'nost-import-fade 200ms ease',
};
const panel: CSSProperties = {
  width: 440, maxWidth: 'calc(100vw - 40px)',
  background: 'var(--bg-rgba)',
  border: '1px solid var(--border-rgba)',
  borderRadius: 16,
  boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
  padding: '26px 26px 22px',
  position: 'relative',
  color: 'var(--text-color)',
  animation: 'nost-import-rise 220ms cubic-bezier(0.22, 1, 0.36, 1)',
};
const closeBtn: CSSProperties = {
  position: 'absolute', top: 14, right: 14,
  width: 24, height: 24, borderRadius: 6,
  background: 'transparent', border: 'none',
  color: 'var(--text-dim)', cursor: 'pointer',
  fontSize: 16, lineHeight: 1,
};
const hero: CSSProperties = {
  textAlign: 'center',
  marginBottom: 18,
};
const sourceGrid: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
};
const sourceBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 14px',
  background: 'var(--surface)',
  border: '1px solid var(--border-rgba)',
  borderRadius: 10,
  fontFamily: 'inherit',
  textAlign: 'left',
  width: '100%',
};
const previewBox: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border-rgba)',
  borderRadius: 10,
  padding: '10px 12px',
  marginBottom: 14,
};
const previewRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '4px 0',
};
const ctaCol: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
};
const primaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px 14px',
  background: 'var(--accent)', color: '#fff',
  border: 'none', borderRadius: 8,
  fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
  cursor: 'pointer',
};
const dangerBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px 14px',
  background: 'transparent', color: 'var(--text-color)',
  border: '1px solid var(--border-rgba)', borderRadius: 8,
  fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
  cursor: 'pointer',
};
const secondaryBtn: CSSProperties = {
  padding: '8px 12px',
  background: 'transparent', color: 'var(--text-dim)',
  border: 'none',
  fontSize: 11, fontFamily: 'inherit',
  cursor: 'pointer',
};
