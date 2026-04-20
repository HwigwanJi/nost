import { useEffect, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { Entitlement } from '../hooks/useEntitlement';

/**
 * PaywallModal — opens whenever a Pro-only gate is triggered. Single
 * component, reused across every lock point (card-add, node-add, preset 2/3,
 * container, etc.); the `reason` prop picks the headline copy and the
 * iconography. Everything else (pricing, CTA, trial CTA) is identical.
 *
 * The actual payment flow is NOT started here — clicking "Pro로 업그레이드"
 * dispatches `nost:start-checkout` on window; the checkout coordinator (added
 * in the payment phase) owns the `shell.openExternal` + 127.0.0.1 callback
 * dance. That lets this modal stay pure UI.
 */

export type PaywallReason =
  | 'card-limit'
  | 'space-limit'
  | 'node-limit'
  | 'deck-limit'
  | 'preset-lock'
  | 'container-lock'
  | 'floating-badge-limit'
  | 'generic';

interface Props {
  open: boolean;
  reason: PaywallReason;
  entitlement: Entitlement;
  onClose: () => void;
  /** Fired when the user clicks the trial CTA and no license yet exists. */
  onStartTrial: () => void;
}

const HEADLINE: Record<PaywallReason, { icon: string; title: string; body: string }> = {
  'card-limit':           { icon: 'style',             title: '카드 20개 제한에 도달했어요',     body: 'Pro로 업그레이드하면 카드를 무제한으로 추가할 수 있습니다.' },
  'space-limit':          { icon: 'dashboard',         title: '스페이스 4개 제한에 도달했어요',  body: 'Pro는 스페이스를 원하는 만큼 만들 수 있습니다.' },
  'node-limit':           { icon: 'hub',               title: '노드는 무료 1개까지',            body: '여러 워크플로우를 동시에 관리하려면 Pro가 필요합니다.' },
  'deck-limit':           { icon: 'stacks',            title: '덱은 무료 1개까지',              body: '순차 실행할 덱이 더 필요하면 Pro로 업그레이드하세요.' },
  'preset-lock':          { icon: 'view_carousel',     title: '프리셋 2 / 3은 Pro 전용',        body: '업무·개인·프로젝트를 완전히 분리해서 쓰려면 Pro.' },
  'container-lock':       { icon: 'view_module',       title: '컨테이너 기능은 Pro 전용',       body: '슬롯 기반 카드 레이아웃은 Pro 플랜에서만 사용 가능합니다.' },
  'floating-badge-limit': { icon: 'radio_button_checked', title: '플로팅 뱃지 1개 제한',         body: '여러 스페이스·노드·덱을 동시에 띄우려면 Pro.' },
  'generic':              { icon: 'auto_awesome',      title: 'nost Pro로 업그레이드',          body: '모든 기능 · 모든 제한 해제 · 연 5,900원.' },
};

export function PaywallModal({ open, reason, entitlement, onClose, onStartTrial }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const headline = HEADLINE[reason];
  const trialAvailable = !entitlement.raw; // no license at all → eligible for first trial
  const trialActive = entitlement.trialActive;

  const backdrop: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9200,
    background: 'rgba(6, 6, 14, 0.62)',
    backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    animation: 'nost-paywall-fade 180ms ease',
  };
  const panel: CSSProperties = {
    width: 420, maxWidth: 'calc(100vw - 40px)',
    background: 'var(--bg-rgba)',
    border: '1px solid var(--border-rgba)',
    borderRadius: 16,
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.55)',
    padding: '24px 24px 20px',
    color: 'var(--text-color)',
    animation: 'nost-paywall-rise 220ms cubic-bezier(0.22, 1, 0.36, 1)',
  };
  const heroIcon: CSSProperties = {
    width: 52, height: 52, borderRadius: 14,
    background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 65%, black))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
    boxShadow: '0 8px 22px rgba(99, 102, 241, 0.35)',
  };
  const priceCard: CSSProperties = {
    marginTop: 16, padding: '12px 14px',
    background: 'var(--surface)',
    border: '1px solid var(--border-rgba)',
    borderRadius: 10,
    display: 'flex', alignItems: 'baseline', gap: 8,
  };
  const ctaPrimary: CSSProperties = {
    flex: 1, padding: '10px 14px',
    background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: 8,
    fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
    cursor: 'pointer',
    letterSpacing: '-0.01em',
  };
  const ctaSecondary: CSSProperties = {
    padding: '10px 14px',
    background: 'transparent',
    color: 'var(--text-dim)',
    border: '1px solid var(--border-rgba)',
    borderRadius: 8,
    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
    cursor: 'pointer',
  };

  return (
    <>
      <style>{`
        @keyframes nost-paywall-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes nost-paywall-rise { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
      `}</style>
      <div style={backdrop} onClick={onClose}>
        <div style={panel} onClick={e => e.stopPropagation()}>
          {/* Close */}
          <button
            onClick={onClose}
            title="닫기 (Esc)"
            style={{
              position: 'absolute', top: 14, right: 14,
              width: 24, height: 24, borderRadius: 6,
              background: 'transparent', border: 'none',
              color: 'var(--text-dim)', cursor: 'pointer',
              fontSize: 16, lineHeight: 1,
            }}
          >×</button>

          <div style={heroIcon}>
            <Icon name={headline.icon} size={26} color="#fff" />
          </div>

          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.015em' }}>
            {headline.title}
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-dim)' }}>
            {headline.body}
          </div>

          {/* Feature recap */}
          <ul style={{
            marginTop: 14, padding: 0, listStyle: 'none',
            fontSize: 12, color: 'var(--text-color)',
            display: 'grid', gap: 6,
          }}>
            <FeatureRow icon="check_circle">카드·스페이스·노드·덱 무제한</FeatureRow>
            <FeatureRow icon="check_circle">프리셋 1 / 2 / 3 전부 사용</FeatureRow>
            <FeatureRow icon="check_circle">플로팅 뱃지 무제한</FeatureRow>
            <FeatureRow icon="check_circle">컨테이너 슬롯</FeatureRow>
            <FeatureRow icon="check_circle">최대 3대 디바이스 동시 사용</FeatureRow>
          </ul>

          {/* Price */}
          <div style={priceCard}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em' }}>
              ₩5,900
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>/ 년</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
              월 492원 · 언제든 해지
            </span>
          </div>

          {/* Trial banner if active */}
          {trialActive && (
            <div style={{
              marginTop: 10, padding: '8px 12px',
              background: 'var(--accent-dim)',
              borderRadius: 8,
              fontSize: 11, color: 'var(--accent)',
              fontWeight: 600,
            }}>
              🎁 체험 {entitlement.trialDaysLeft}일 남음 — 체험 중에는 모든 Pro 기능 사용 가능
            </div>
          )}

          {/* CTA row */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('nost:start-checkout'))}
              style={ctaPrimary}
            >
              Pro로 업그레이드
            </button>
            {trialAvailable && (
              <button onClick={onStartTrial} style={ctaSecondary}>
                14일 무료 체험
              </button>
            )}
            {!trialAvailable && (
              <button onClick={onClose} style={ctaSecondary}>
                나중에
              </button>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
            결제는 <a href="#" onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('nost:open-url', { detail: 'https://tosspayments.com' })); }} style={{ color: 'var(--text-dim)', textDecoration: 'underline' }}>토스페이먼츠</a>를 통해 안전하게 처리됩니다
          </div>
        </div>
      </div>
    </>
  );
}

function FeatureRow({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={14} color="var(--accent)" />
      <span>{children}</span>
    </li>
  );
}
