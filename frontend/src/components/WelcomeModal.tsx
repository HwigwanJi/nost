import { Icon } from '@/components/ui/Icon';
import { electronAPI } from '../electronBridge';

interface WelcomeModalProps {
  extConnected: boolean | null;
  onClose: () => void;
  onOpenExtensionSettings: () => void;
}

export function WelcomeModal({ extConnected, onClose, onOpenExtensionSettings }: WelcomeModalProps) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-solid, #1a1a2e)',
          border: '1px solid var(--border-rgba)',
          borderRadius: 14,
          padding: '28px 28px 22px',
          width: 340,
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="waving_hand" size={28} color="var(--accent)" />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-color)' }}>nost</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>stary no more — 더 이상 헤매지 마세요.</div>
          </div>
        </div>

        {/* Description */}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
          자주 쓰는 앱, 폴더, 웹사이트를 한 곳에 모아두고<br />
          단축키 하나로 즉시 꺼내 쓰는 런처입니다.
        </p>

        {/* Info rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { icon: 'keyboard', label: '호출 단축키', value: 'Alt + 4' },
            { icon: 'touch_app', label: '카드 꾹 누르기', value: '모니터 이동 · 스냅 · 삭제' },
            { icon: 'hub', label: '노드 / 덱', value: '여러 앱을 한번에 배치 · 실행' },
            { icon: 'settings', label: '설정', value: '단축키 · 테마 · 기타 설정' },
          ].map(({ icon, label, value }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border-rgba)' }}>
              <Icon name={icon} size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 1 }}>{label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-color)' }}>{value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Extension install inline link */}
        {extConnected === false && (
          <button
            onClick={() => { onClose(); onOpenExtensionSettings(); }}
            style={{
              width: '100%', padding: '8px 12px', background: 'var(--accent-dim)',
              border: '1px solid var(--accent)', borderRadius: 8, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <Icon name="extension" size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>브라우저 확장 설치하기</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>탭 제어 기능을 사용하려면 확장 프로그램이 필요합니다</div>
            </div>
            <Icon name="arrow_forward" size={14} color="var(--accent)" />
          </button>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={() => electronAPI.openGuide()}
            style={{
              flex: 1, padding: '9px 0',
              background: 'var(--surface)', color: 'var(--text-color)',
              border: '1px solid var(--border-rgba)', borderRadius: 8,
              fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            <Icon name="menu_book" size={14} />
            사용 설명서
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '9px 0',
              background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              letterSpacing: '0.02em',
            }}
          >
            시작하기
          </button>
        </div>
      </div>
    </div>
  );
}
