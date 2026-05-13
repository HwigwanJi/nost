import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { electronAPI } from '../electronBridge';
import { Icon } from '@/components/ui/Icon';

type Browser = 'chrome' | 'whale';

type WizardPhase =
  | { kind: 'idle' }
  | { kind: 'launching'; browser: Browser }
  | { kind: 'step'; n: 1 | 2 | 3; browser: Browser }
  | { kind: 'checking'; browser?: Browser }
  // Chrome Web Store path: store page opened in default browser,
  // waiting for user to click "Chrome에 추가" then come back and verify.
  | { kind: 'store-installing' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

interface ExtensionInstallWizardProps {
  onSuccess: () => void; // called when extension is confirmed connected
}

// ── Small visual helpers ─────────────────────────────────────────

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
        transition: 'background 0.2s, color 0.2s, border-color 0.2s',
        background: done
          ? 'var(--accent, #6366f1)'
          : active
            ? 'var(--accent-dim, rgba(99,102,241,0.15))'
            : 'var(--surface)',
        color: done
          ? '#fff'
          : active
            ? 'var(--accent, #6366f1)'
            : 'var(--text-dim)',
        border: `1.5px solid ${
          done ? 'var(--accent, #6366f1)' : active ? 'var(--accent, #6366f1)' : 'var(--border-rgba)'
        }`,
      }}
    >
      {done ? <Icon name="check" size={13} /> : n}
    </div>
  );
}

function StepBar({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 18 }}>
      {([1, 2, 3] as const).map((n, i) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', flex: n < 3 ? 1 : undefined }}>
          <StepDot n={n} active={current === n} done={current > n} />
          {i < 2 && (
            <div
              style={{
                flex: 1,
                height: 1.5,
                margin: '0 4px',
                background: current > n + 1
                  ? 'var(--accent, #6366f1)'
                  : current > n
                    ? 'var(--accent, #6366f1)'
                    : 'var(--border-rgba)',
                transition: 'background 0.3s',
              }}
            />
          )}
        </div>
      ))}
      <div style={{ marginLeft: 10, fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
        {current} / 3 단계
      </div>
    </div>
  );
}

function InstructionCard({
  icon,
  title,
  description,
  highlight,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  highlight?: string;
  children?: React.ReactNode;
}) {
  const parts = highlight
    ? description.split(highlight)
    : [description];

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--surface)',
        border: '1px solid var(--border-rgba)',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          background: 'var(--accent-dim, rgba(99,102,241,0.1))',
          border: '1px solid rgba(99,102,241,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={18} color="var(--accent)" />
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-color)', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {highlight && parts.length > 1
            ? <>
                {parts[0]}
                <strong style={{ color: 'var(--text-color)', fontWeight: 700 }}>{highlight}</strong>
                {parts[1]}
              </>
            : description}
        </div>
        {children}
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  variant = 'primary',
  disabled = false,
  loading = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '10px 0',
        borderRadius: 9,
        border: variant === 'primary' ? 'none' : '1px solid var(--border-rgba)',
        background:
          variant === 'primary'
            ? 'var(--accent, #6366f1)'
            : 'var(--bg-rgba)',
        color: variant === 'primary' ? '#fff' : 'var(--text-color)',
        fontSize: 12,
        fontWeight: variant === 'primary' ? 700 : 500,
        cursor: disabled || loading ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        fontFamily: 'inherit',
        transition: 'opacity 0.15s',
        letterSpacing: '0.01em',
      }}
    >
      <Icon name={loading ? 'sync' : icon} size={15} className={loading ? 'animate-spin' : undefined} />
      {label}
    </button>
  );
}

// ── Copy field (text box + icon + toast) ─────────────────────────

function CopyField({ value, label }: { value: string; label: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      toast(`${label} 복사됨`);
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        borderRadius: 8,
        border: '1px solid var(--border-rgba)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          flex: 1,
          padding: '7px 10px',
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          userSelect: 'text',
        }}
      >
        {value}
      </span>
      <button
        onClick={handleCopy}
        title="복사"
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          background: 'transparent',
          border: 'none',
          borderLeft: '1px solid var(--border-rgba)',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          transition: 'background 0.12s, color 0.12s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--surface-hover)';
          e.currentTarget.style.color = 'var(--text-color)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-muted)';
        }}
      >
        <Icon name="content_copy" size={14} />
      </button>
    </div>
  );
}

// 클립보드에 있는 값(extensionDir)을 재복사
function ClipboardReCopy() {
  const handleCopy = async () => {
    const text = await electronAPI.readClipboard();
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        toast('확장 폴더 경로 복사됨');
      });
    }
  };

  return (
    <button
      onClick={handleCopy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        borderRadius: 99,
        background: 'var(--accent-dim, rgba(99,102,241,0.1))',
        border: '1px solid rgba(99,102,241,0.25)',
        color: 'var(--accent, #6366f1)',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <Icon name="content_paste" size={13} />
      경로 다시 복사
    </button>
  );
}

// ── Main Wizard ──────────────────────────────────────────────────

export function ExtensionInstallWizard({ onSuccess }: ExtensionInstallWizardProps) {
  const [phase, setPhase] = useState<WizardPhase>({ kind: 'idle' });
  const [selectedBrowser, setSelectedBrowser] = useState<Browser>('chrome');
  const [extensionDir, setExtensionDir] = useState<string | null>(null);
  // Web Store is now the recommended path. The dev-mode unpacked-load
  // flow is still useful (testing, custom builds, environments where
  // Chrome Web Store is blocked) so we keep it tucked behind a
  // disclosure rather than ripping it out.
  const [showManual, setShowManual] = useState(false);

  const browserLabel = (b: Browser) => (b === 'chrome' ? 'Chrome' : 'Whale');
  const browserIcon = (b: Browser) => (b === 'chrome' ? 'open_in_browser' : 'open_in_new');

  // Step 1: Launch browser + open folder + copy path
  const handleStart = useCallback(async () => {
    setPhase({ kind: 'launching', browser: selectedBrowser });
    const res = await electronAPI.openExtensionInstallHelper(selectedBrowser);
    if (!res.success) {
      const msg =
        res.reason === 'browser-not-found'
          ? `${browserLabel(selectedBrowser)} 실행 파일을 찾지 못했습니다. ${browserLabel(selectedBrowser)} 설치 후 다시 시도해주세요.`
          : '확장 폴더를 찾지 못했습니다. 앱 설치 폴더 구성을 확인해주세요.';
      setPhase({ kind: 'error', message: msg });
      return;
    }
    if (res.extensionDir) setExtensionDir(res.extensionDir);
    setPhase({ kind: 'step', n: 1, browser: selectedBrowser });
  }, [selectedBrowser]);

  const handleCheckInstalled = useCallback(async () => {
    const browser = phase.kind === 'step' || phase.kind === 'checking' ? (phase as { browser: Browser }).browser : selectedBrowser;
    setPhase({ kind: 'checking', browser });
    const status = await electronAPI.getExtensionBridgeStatus();
    const connected = status.connected || status.tabsCount > 0;
    if (connected) {
      setPhase({ kind: 'success' });
      setTimeout(() => onSuccess(), 1200);
    } else {
      setPhase({ kind: 'step', n: 3, browser: browser as Browser });
    }
  }, [phase, selectedBrowser, onSuccess]);

  // ── Web Store install path ───────────────────────────────────
  // Two-pronged strategy:
  //  1. Best-effort HKCU registry write (ExternalExtensions). If it
  //     succeeds, Chrome on its next launch shows a one-click
  //     "활성화" notification — the most automated path possible
  //     within Chrome's security model.
  //  2. Always open the store page in the default browser as a
  //     guaranteed fallback. User can complete via "Chrome에 추가"
  //     even if the registry path didn't fire (Chrome closed,
  //     dismissed notification, etc.).
  const handleStoreInstall = useCallback(async () => {
    // Fire-and-forget; never blocks the UX path.
    electronAPI.registerExtensionExternal().catch(() => undefined);

    const res = await electronAPI.openExtensionStore();
    if (!res.success) {
      setPhase({ kind: 'error', message: '스토어 페이지를 열 수 없습니다. 브라우저에서 직접 검색해주세요: nost-bridge' });
      return;
    }
    setPhase({ kind: 'store-installing' });
  }, []);

  const handleVerifyStoreInstall = useCallback(async () => {
    setPhase({ kind: 'checking' });
    const status = await electronAPI.getExtensionBridgeStatus();
    const connected = status.connected || status.tabsCount > 0;
    if (connected) {
      setPhase({ kind: 'success' });
      setTimeout(() => onSuccess(), 1200);
    } else {
      // Stay on store-installing; surface a soft toast instead of
      // bouncing back to error — the user might just need 1-2s for the
      // SSE handshake after Chrome auto-loads the extension.
      setPhase({ kind: 'store-installing' });
      toast.error('아직 연결되지 않았습니다. 설치 완료 후 잠시 기다린 다음 다시 시도해주세요.');
    }
  }, [onSuccess]);

  // ── Idle: browser selection ──────────────────────────────────
  if (phase.kind === 'idle') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'var(--accent-dim, rgba(99,102,241,0.1))',
              border: '1px solid rgba(99,102,241,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name="extension" size={20} color="var(--accent)" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-color)' }}>
              브라우저 확장 설치
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
              탭 스캔과 타일 분할을 위해 확장이 필요합니다.
            </div>
          </div>
        </div>

        {/* ── Primary install path ───────────────────────────────
             A single confident CTA. We removed the 2024-era badge
             ("권장 · Chrome 웹 스토어") and tinted-box pattern in
             favor of a clean surface card — visual prominence comes
             from the button itself, not chrome around it. Manual
             install (dev mode) lives behind the disclosure below. */}
        <div
          style={{
            padding: '14px 16px 16px',
            borderRadius: 12,
            background: 'var(--surface)',
            border: '1px solid var(--border-rgba)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12.5, color: 'var(--text-color)', lineHeight: 1.55 }}>
            Chrome 웹 스토어에서 nost-bridge를 설치합니다.
            <span style={{ color: 'var(--text-muted)' }}> 클릭 한 번이면 됩니다.</span>
          </div>
          <ActionButton
            icon="open_in_new"
            label="Chrome 웹 스토어에서 설치"
            onClick={handleStoreInstall}
          />
        </div>

        {/* ── Disclosure: manual / dev-mode install ───────────── */}
        {!showManual ? (
          <button
            onClick={() => setShowManual(true)}
            style={{
              alignSelf: 'center',
              padding: '6px 10px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 11,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Icon name="expand_more" size={13} />
            수동 설치 (개발자용)
          </button>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6, borderTop: '1px dashed var(--border-rgba)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
              수동 설치 — 개발자 모드
            </span>
            <button
              onClick={() => setShowManual(false)}
              style={{
                padding: '3px 6px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                fontSize: 11,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              접기
            </button>
          </div>

        {/* Browser selector */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 500 }}>
            브라우저 선택
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(['chrome', 'whale'] as Browser[]).map(b => (
              <button
                key={b}
                onClick={() => setSelectedBrowser(b)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1.5px solid ${selectedBrowser === b ? 'var(--accent, #6366f1)' : 'var(--border-rgba)'}`,
                  background: selectedBrowser === b ? 'var(--accent-dim, rgba(99,102,241,0.08))' : 'var(--surface)',
                  color: selectedBrowser === b ? 'var(--accent, #6366f1)' : 'var(--text-muted)',
                  fontSize: 12,
                  fontWeight: selectedBrowser === b ? 700 : 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                <Icon name={browserIcon(b)} size={16} />
                {browserLabel(b)}
                {selectedBrowser === b && (
                  <Icon name="check_circle" size={13} style={{ marginLeft: 2 }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* What will happen preview */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 9,
            background: 'var(--surface)',
            border: '1px solid var(--border-rgba)',
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.6,
          }}
        >
          {[
            `${browserLabel(selectedBrowser)} 확장 관리 페이지가 열립니다`,
            '확장 폴더 경로가 클립보드에 자동 복사됩니다',
            '3단계 안내에 따라 1분 안에 설치 완료',
          ].map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <span style={{ color: 'var(--accent, #6366f1)', fontWeight: 700, flexShrink: 0 }}>·</span>
              {t}
            </div>
          ))}
        </div>

        <ActionButton
          icon="play_arrow"
          label="설치 시작하기"
          onClick={handleStart}
        />
        </div>
        )}
      </div>
    );
  }

  // ── Store install — waiting for user to confirm in browser ──
  if (phase.kind === 'store-installing') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.25)',
          }}
        >
          <Icon name="check_circle" size={18} color="#22c55e" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-color)' }}>
              브라우저에서 마지막 단계만 남았습니다
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
              열린 스토어 페이지에서 <strong>Chrome에 추가</strong>를 누르거나, Chrome 우상단에 뜬 알림에서 <strong>활성화</strong>를 눌러주세요.
            </div>
          </div>
        </div>

        <InstructionCard
          icon="auto_awesome"
          title="자동 설치도 시도했습니다"
          description="Chrome을 열어두셨다면 우상단에 '확장 프로그램이 추가됨' 알림이 뜰 수 있습니다. 알림에서 한 번만 활성화하면 됩니다."
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <ActionButton
            icon="arrow_back"
            label="뒤로"
            onClick={() => setPhase({ kind: 'idle' })}
            variant="secondary"
          />
          <ActionButton
            icon="check"
            label="연결 확인"
            onClick={handleVerifyStoreInstall}
          />
        </div>
      </div>
    );
  }

  // ── Launching ────────────────────────────────────────────────
  if (phase.kind === 'launching') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '20px 0' }}>
        <Icon name="sync" size={36} color="var(--accent)" className="animate-spin" />
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {browserLabel(phase.browser)} 확장 페이지를 여는 중...
        </p>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────
  if (phase.kind === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.25)',
          }}
        >
          <Icon name="error" size={18} color="#ef4444" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: 12, color: '#ef4444', lineHeight: 1.5 }}>{phase.message}</p>
        </div>
        <ActionButton
          icon="arrow_back"
          label="다시 시도"
          onClick={() => setPhase({ kind: 'idle' })}
          variant="secondary"
        />
      </div>
    );
  }

  // ── Step 1: Browser opened ───────────────────────────────────
  if (phase.kind === 'step' && phase.n === 1) {
    const b = browserLabel(phase.browser);
    const extPage = phase.browser === 'whale' ? 'whale://extensions' : 'chrome://extensions';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <StepBar current={1} />

        {/* Success banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.25)',
          }}
        >
          <Icon name="check_circle" size={18} color="#22c55e" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-color)' }}>
              {b} 확장 페이지를 열었습니다
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              확장 폴더 경로가 클립보드에 복사됐습니다.
            </div>
          </div>
        </div>

        {phase.browser === 'whale' ? (
          <InstructionCard
            icon="open_in_browser"
            title="Whale 주소창에 아래 URL을 붙여넣으세요"
            description="Whale은 외부에서 내부 페이지를 직접 열 수 없습니다. 아래 URL을 복사해 주소창에 붙여넣어 이동해 주세요."
          >
            <div style={{ marginTop: 8 }}>
              <CopyField value="whale://extensions" label="URL" />
            </div>
          </InstructionCard>
        ) : (
          <InstructionCard
            icon="open_in_browser"
            title={`${b} 창으로 이동하세요`}
            description={`${b}에서 ${extPage} 페이지가 열려 있습니다. 해당 창을 클릭해 앞으로 가져오세요.`}
          />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <ActionButton
            icon="arrow_back"
            label="이전"
            onClick={() => setPhase({ kind: 'idle' })}
            variant="secondary"
          />
          <ActionButton
            icon="arrow_forward"
            label="다음"
            onClick={() => setPhase({ kind: 'step', n: 2, browser: phase.browser })}
          />
        </div>
      </div>
    );
  }

  // ── Step 2: Developer mode ───────────────────────────────────
  if (phase.kind === 'step' && phase.n === 2) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <StepBar current={2} />

        <InstructionCard
          icon="developer_mode"
          title="개발자 모드를 켜주세요"
          description={
            phase.browser === 'whale'
              ? `Whale 확장 관리 페이지 하단 중앙의 '개발자 모드' 토글을 ON으로 켜주세요. 이 설정은 비공개 확장을 로드하기 위해 필요합니다.`
              : `Chrome 확장 관리 페이지 우측 상단의 '개발자 모드' 토글을 ON으로 켜주세요. 이 설정은 비공개 확장을 로드하기 위해 필요합니다.`
          }
          highlight="개발자 모드"
        />

        {/* Visual illustration */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'var(--surface)',
            border: '1px solid var(--border-rgba)',
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            찾는 위치
          </div>
          {/* Mock browser extension page header */}
          <div
            style={{
              borderRadius: 8,
              border: '1px solid var(--border-rgba)',
              overflow: 'hidden',
              fontSize: 11,
            }}
          >
            {/* Mock address bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                background: 'var(--border-rgba)',
                borderBottom: '1px solid var(--border-rgba)',
              }}
            >
              <div
                style={{
                  flex: 1,
                  padding: '3px 8px',
                  borderRadius: 5,
                  background: 'var(--surface)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                }}
              >
                {phase.browser === 'whale' ? 'whale://extensions' : 'chrome://extensions'}
              </div>
            </div>
            {/* Mock page header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: 'var(--bg-rgba)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-color)' }}>확장 프로그램</span>
              {/* Chrome: toggle top-right */}
              {phase.browser === 'chrome' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 7,
                    border: '2px solid var(--accent, #6366f1)',
                    background: 'var(--accent-dim, rgba(99,102,241,0.1))',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent, #6366f1)' }}>개발자 모드</span>
                  <div style={{ width: 32, height: 18, borderRadius: 99, background: 'var(--accent, #6366f1)', position: 'relative' }}>
                    <div style={{ position: 'absolute', right: 3, top: 3, width: 12, height: 12, borderRadius: '50%', background: '#fff' }} />
                  </div>
                </div>
              )}
            </div>
            {/* Whale: toggle bottom-center */}
            {phase.browser === 'whale' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px 14px',
                  borderTop: '1px solid var(--border-rgba)',
                  background: 'var(--bg-rgba)',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 7,
                    border: '2px solid var(--accent, #6366f1)',
                    background: 'var(--accent-dim, rgba(99,102,241,0.1))',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent, #6366f1)' }}>개발자 모드</span>
                  <div style={{ width: 32, height: 18, borderRadius: 99, background: 'var(--accent, #6366f1)', position: 'relative' }}>
                    <div style={{ position: 'absolute', right: 3, top: 3, width: 12, height: 12, borderRadius: '50%', background: '#fff' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8, textAlign: 'center' }}>
            {phase.browser === 'whale' ? '↑ 하단 중앙 강조된 토글을 ON 으로 켜주세요' : '↑ 우측 상단 강조된 토글을 ON 으로 켜주세요'}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <ActionButton
            icon="arrow_back"
            label="이전"
            onClick={() => setPhase({ kind: 'step', n: 1, browser: phase.browser })}
            variant="secondary"
          />
          <ActionButton
            icon="toggle_on"
            label="켰어요, 다음으로"
            onClick={() => setPhase({ kind: 'step', n: 3, browser: phase.browser })}
          />
        </div>
      </div>
    );
  }

  // ── Step 3: Load unpacked ────────────────────────────────────
  if (phase.kind === 'step' && phase.n === 3) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <StepBar current={3} />

        <InstructionCard
          icon="folder_open"
          title="'압축해제된 확장 프로그램 로드' 클릭"
          description={`개발자 모드를 켜면 상단에 버튼이 나타납니다. 해당 버튼을 클릭하면 폴더 선택 창이 열립니다.`}
          highlight="압축해제된 확장 프로그램 로드"
        />

        {/* Visual illustration */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'var(--surface)',
            border: '1px solid var(--border-rgba)',
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            폴더 선택 방법
          </div>
          {[
            { icon: 'folder_open', text: `'압축해제된 확장 프로그램 로드' 버튼 클릭`, accent: false },
            { icon: 'content_paste', text: '폴더 선택 창 주소창에 Ctrl+V 로 붙여넣기', accent: true },
            { icon: 'check_circle', text: `chrome-extension 폴더가 선택됐는지 확인 후 '폴더 선택' 클릭`, accent: false },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderBottom: i < 2 ? '1px solid var(--border-rgba)' : 'none',
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: item.accent ? 'var(--accent-dim, rgba(99,102,241,0.15))' : 'var(--border-rgba)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name={item.icon} size={13} color={item.accent ? 'var(--accent)' : 'var(--text-muted)'} />
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: item.accent ? 'var(--text-color)' : 'var(--text-muted)',
                  fontWeight: item.accent ? 600 : 400,
                  lineHeight: 1.4,
                }}
              >
                {item.text}
              </span>
            </div>
          ))}
        </div>

        {/* Extension dir path */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            확장 폴더 경로
          </span>
          {extensionDir ? (
            <CopyField value={extensionDir} label="확장 폴더 경로" />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', flex: 1 }}>
                경로가 클립보드에 복사되어 있습니다.
              </span>
              <ClipboardReCopy />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <ActionButton
            icon="arrow_back"
            label="이전"
            onClick={() => setPhase({ kind: 'step', n: 2, browser: phase.browser })}
            variant="secondary"
          />
          <ActionButton
            icon="verified"
            label="설치 완료 확인"
            onClick={handleCheckInstalled}
          />
        </div>
      </div>
    );
  }

  // ── Checking ─────────────────────────────────────────────────
  if (phase.kind === 'checking') {
    // StepBar belongs to the dev-mode 3-step flow; the store-install
    // verify path doesn't carry a browser, so we hide it then.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {phase.browser && <StepBar current={3} />}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '16px 0' }}>
          <Icon name="sync" size={32} color="var(--accent)" className="animate-spin" />
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>확장 연결 상태 확인 중...</p>
        </div>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────
  if (phase.kind === 'success') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '12px 0' }}>
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'rgba(34,197,94,0.1)',
            border: '2px solid rgba(34,197,94,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="check_circle" size={30} color="#22c55e" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-color)' }}>설치 완료!</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            브라우저 확장이 연결되었습니다.
            <br />
            스마트 스캔을 다시 실행하면 브라우저 탭을 볼 수 있습니다.
          </div>
        </div>
      </div>
    );
  }

  return null;
}
