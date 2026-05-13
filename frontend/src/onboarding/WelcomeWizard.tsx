import { useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import { TEMPLATES, type Template } from './templates';
import { useBusyMark } from '../lib/userBusy';

/**
 * WelcomeWizard — first-run onboarding modal that asks "what do you do?"
 * and seeds the active preset with a matching template, then triggers the
 * existing TourOverlay.
 *
 * Two-step flow:
 *   1. Persona pick (5 cards: developer / designer / student / general / blank)
 *   2. Brief confirmation + "투어 보기" or "건너뛰기"
 *
 * The wizard is also reachable from the EmptyState's "템플릿으로 시작" button
 * (any time, not just first-run); in that case it acts as a template picker.
 *
 * Props:
 *   open       — whether the modal is visible
 *   onApply    — caller installs the chosen template into the active preset
 *                (typically replacing existing empty space[s])
 *   onClose    — dismissed
 *   showTour   — kick off the Presets tour after apply
 *
 * The wizard NEVER touches AppData directly — it only picks a template and
 * hands it to the parent. That keeps the seed-application logic (which has
 * to merge / replace / migrate carefully) in App.tsx where the store is.
 */

interface Props {
  open: boolean;
  onApply: (template: Template, alsoStartTour: boolean) => void;
  onClose: () => void;
}

type Step = 'pick' | 'confirm';

export function WelcomeWizard({ open, onApply, onClose }: Props) {
  const [step, setStep] = useState<Step>('pick');
  const [chosen, setChosen] = useState<Template | null>(null);

  // Mark the user as occupied while the wizard is up — auto-popups (tour
  // start, future paywall warnings) gate themselves on `isUserBusy()` and
  // wait until we close.
  useBusyMark('modal:welcome', open);

  if (!open) return null;

  const handlePick = (t: Template) => {
    setChosen(t);
    setStep('confirm');
  };

  const handleConfirm = (startTour: boolean) => {
    if (!chosen) return;
    onApply(chosen, startTour);
    setStep('pick');
    setChosen(null);
  };

  return (
    <>
      <style>{`
        @keyframes nost-welcome-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes nost-welcome-rise { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
      `}</style>
      <div style={backdrop}>
        <div style={panel}>
          {step === 'pick' && (
            <PickStep onPick={handlePick} onSkip={onClose} />
          )}
          {step === 'confirm' && chosen && (
            <ConfirmStep
              template={chosen}
              onBack={() => { setStep('pick'); setChosen(null); }}
              onConfirm={handleConfirm}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ── Step 1 — pick a persona ─────────────────────────────────────────
function PickStep({ onPick, onSkip }: { onPick: (t: Template) => void; onSkip: () => void }) {
  return (
    <>
      <div style={hero}>
        <div style={heroIcon}>
          <Icon name="auto_awesome" size={28} color="#fff" />
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>
          nost에 오신 걸 환영해요
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          어떤 일을 주로 하시는지 알려주시면<br />
          그에 맞는 시작 구성을 준비해 드릴게요.
        </div>
      </div>

      <div style={cardGrid}>
        {TEMPLATES.map(t => (
          <button key={t.id} onClick={() => onPick(t)} style={personaCard}>
            <span style={personaEmoji}>{t.emoji}</span>
            <span style={personaLabel}>{t.label}</span>
            <span style={personaTagline}>{t.tagline}</span>
          </button>
        ))}
      </div>

      <button onClick={onSkip} style={skipBtn}>
        지금은 건너뛰기
      </button>
    </>
  );
}

// ── Step 2 — confirm + tour ─────────────────────────────────────────
function ConfirmStep({
  template,
  onBack,
  onConfirm,
}: {
  template: Template;
  onBack: () => void;
  onConfirm: (startTour: boolean) => void;
}) {
  // Compute a quick preview of what's about to land.
  const preview = template.build();
  const totalCards = preview.reduce((s, sp) => s + sp.items.length, 0);

  return (
    <>
      <div style={hero}>
        <div style={{ fontSize: 36, marginBottom: 4 }}>{template.emoji}</div>
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.015em' }}>
          {template.label} 시작 키트
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
          스페이스 {preview.length}개 · 카드 {totalCards}개
        </div>
      </div>

      <div style={previewBox}>
        {preview.map(sp => (
          <div key={sp.id} style={previewSpace}>
            <span style={{
              width: 10, height: 10, borderRadius: 3,
              background: sp.color ?? 'var(--accent)',
              flexShrink: 0,
            }} />
            <span style={{ fontWeight: 600, fontSize: 12 }}>{sp.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 4 }}>
              {sp.items.length}개
            </span>
          </div>
        ))}
      </div>

      <div style={ctaRow}>
        <button onClick={onBack} style={secondaryBtn}>
          <Icon name="arrow_back" size={13} /> 다시 선택
        </button>
        <button onClick={() => onConfirm(false)} style={secondaryBtn}>
          가져오기만
        </button>
        <button onClick={() => onConfirm(true)} style={primaryBtn}>
          <Icon name="play_arrow" size={14} />
          가져오고 투어 시작
        </button>
      </div>
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────────
const backdrop: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9100,
  background: 'rgba(6, 6, 14, 0.62)',
  backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  animation: 'nost-welcome-fade 220ms ease',
};
const panel: CSSProperties = {
  width: 480, maxWidth: 'calc(100vw - 40px)',
  background: 'var(--bg-rgba)',
  border: '1px solid var(--border-rgba)',
  borderRadius: 18,
  boxShadow: '0 30px 80px rgba(0, 0, 0, 0.55)',
  padding: '28px 28px 22px',
  color: 'var(--text-color)',
  animation: 'nost-welcome-rise 260ms cubic-bezier(0.22, 1, 0.36, 1)',
};
const hero: CSSProperties = {
  textAlign: 'center',
  marginBottom: 18,
};
const heroIcon: CSSProperties = {
  width: 56, height: 56, borderRadius: 16,
  background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, black))',
  margin: '0 auto 14px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 10px 26px rgba(99, 102, 241, 0.32)',
};
const cardGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  gap: 8,
  marginBottom: 18,
};
const personaCard: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  gap: 4,
  padding: '14px 8px 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border-rgba)',
  borderRadius: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: 'inherit',
  transition: 'transform 120ms ease, border-color 120ms ease, background 120ms ease',
};
const personaEmoji: CSSProperties = { fontSize: 28, lineHeight: 1 };
const personaLabel: CSSProperties = { fontSize: 12, fontWeight: 700, marginTop: 2 };
const personaTagline: CSSProperties = {
  fontSize: 9.5, color: 'var(--text-dim)',
  textAlign: 'center', lineHeight: 1.35, marginTop: 1,
};
const skipBtn: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'transparent',
  color: 'var(--text-dim)',
  border: 'none',
  fontSize: 11,
  fontFamily: 'inherit',
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};
const previewBox: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border-rgba)',
  borderRadius: 10,
  padding: '8px 10px',
  marginBottom: 16,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const previewSpace: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 12,
};
const ctaRow: CSSProperties = {
  display: 'flex', gap: 8,
  marginTop: 6,
};
const primaryBtn: CSSProperties = {
  flex: 1.4,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  padding: '9px 12px',
  background: 'var(--accent)', color: '#fff',
  border: 'none', borderRadius: 8,
  fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
  cursor: 'pointer',
};
const secondaryBtn: CSSProperties = {
  flex: 1,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '9px 12px',
  background: 'var(--surface)', color: 'var(--text-color)',
  border: '1px solid var(--border-rgba)', borderRadius: 8,
  fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
  cursor: 'pointer',
};
