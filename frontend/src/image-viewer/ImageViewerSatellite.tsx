/**
 * ImageViewerSatellite — 자체 BrowserWindow 로 이미지 가볍게 보기.
 *
 * 외부 라이브러리 0 — <img src="file://...">  가 PNG/JPG/GIF/WEBP/SVG/AVIF/BMP
 * 모두 네이티브 렌더. zoom/pan 은 CSS transform + wheel/drag 핸들러.
 *
 * Window 톤앤매너 (메모 에디터 / SettingsDialog 와 일관):
 *   - 다크 반투명 backdrop (rgba(0,0,0,0.92))
 *   - 프레임리스, transparent BrowserWindow
 *   - 우상단 X 닫기 + ESC + 백드롭 클릭으로 dismiss
 *
 * 인터랙션:
 *   - 휠: 줌 (0.2x ~ 8x)
 *   - 드래그: 이동 (zoom > 1 일 때만 의미)
 *   - 더블클릭: 1배 ↔ fit 토글
 *   - 0 키: fit 리셋
 *
 * 의도적 비-목표 (v1):
 *   - 다음/이전 이미지 (single image 뷰)
 *   - 회전, EXIF, 메타 표시
 *   - 동영상/PDF (별도 viewer 필요)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSatelliteTheme } from '../lib/satelliteTheme';

export interface ImageViewerSatelliteState {
  /** 절대 경로. preload 가 file:// 변환을 해서 src 에 넘김. */
  path: string;
  /** 헤더에 표시할 라벨 (파일명 등). 없으면 path 의 basename. */
  label?: string;
  /** v1.3.49 — 호스트 윈도우 theme/accent mirror (다크 모드 일관). */
  accentColor?: string;
  theme?: 'light' | 'dark';
}

type Action = { kind: 'close' };

interface Api {
  onState: (cb: (s: ImageViewerSatelliteState) => void) => () => void;
  requestState: () => void;
  action: (payload: Action) => void;
}

const api = (window as unknown as { imageViewer: Api }).imageViewer;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

function basenameOf(p: string): string {
  if (!p) return '';
  const m = p.split(/[\\/]/).pop() || p;
  return m;
}

function toFileUrl(p: string): string {
  if (!p) return '';
  // Already a URL (svg data URL etc. — defensive)
  if (/^([a-z]+):/i.test(p)) return p;
  return `file:///${p.replace(/\\/g, '/')}`;
}

export function ImageViewerSatellite() {
  const [state, setState] = useState<ImageViewerSatelliteState | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [loadError, setLoadError] = useState(false);
  const draggingRef = useRef<{ startX: number; startY: number; basePan: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const off = api.onState(setState);
    api.requestState();
    return off;
  }, []);

  useSatelliteTheme(state);

  const close = useCallback(() => api.action({ kind: 'close' }), []);

  // Reset state when path changes (re-using viewer for another image).
  useEffect(() => {
    setZoom('fit');
    setPan({ x: 0, y: 0 });
    setLoadError(false);
  }, [state?.path]);

  // Global key handlers: ESC close, '0' reset.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === '0') { e.preventDefault(); setZoom('fit'); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close]);

  // Wheel zoom — clamped, anchored to center for simplicity.
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY / 500;  // 1 notch ≈ 0.2
    setZoom(prev => {
      const cur = prev === 'fit' ? 1 : prev;
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur * (1 + delta)));
      return Math.abs(next - 1) < 0.02 ? 1 : next;
    });
  }, []);

  // Drag pan — only meaningful when zoomed beyond fit.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (zoom === 'fit') return;
    draggingRef.current = { startX: e.clientX, startY: e.clientY, basePan: pan };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [zoom, pan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d) return;
    setPan({ x: d.basePan.x + (e.clientX - d.startX), y: d.basePan.y + (e.clientY - d.startY) });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current) {
      draggingRef.current = null;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch (_) {}
    }
  }, []);

  const onDoubleClick = useCallback(() => {
    setZoom(prev => (prev === 'fit' || prev === 1 ? 2 : 'fit'));
    setPan({ x: 0, y: 0 });
  }, []);

  if (!state) return null;

  const label = state.label || basenameOf(state.path);
  const src = toFileUrl(state.path);
  const isFit = zoom === 'fit';
  const numericZoom = isFit ? 1 : zoom;
  const imgStyle: React.CSSProperties = isFit
    ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
    : {
        // Manual zoom: don't constrain — let CSS transform handle scale,
        // image renders at its intrinsic size then scaled.
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${numericZoom})`,
        transformOrigin: 'center center',
        maxWidth: 'none',
        maxHeight: 'none',
      };

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        // Frameless window 드래그를 위해 root 는 drag, 본문/버튼은 no-drag
        // (메모 에디터와 동일 패턴).
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{
            fontWeight: 600,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: 420,
          }}>{label}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
            {isFit ? '맞춤' : `${Math.round(numericZoom * 100)}%`}
          </span>
        </div>
        <button
          onClick={close}
          title="닫기 (ESC)"
          style={{
            WebkitAppRegion: 'no-drag',
            width: 28, height: 28, borderRadius: 6,
            background: 'transparent', border: 'none',
            color: 'rgba(255,255,255,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 18, lineHeight: 1,
            fontFamily: 'inherit',
          } as React.CSSProperties}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >×</button>
      </div>

      {/* ── Image stage ────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          cursor: isFit ? 'zoom-in' : (draggingRef.current ? 'grabbing' : 'grab'),
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {loadError ? (
          <div style={{
            color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center',
            display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
          }}>
            <div>이미지를 불러올 수 없어요</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{label}</div>
          </div>
        ) : (
          <img
            src={src}
            alt={label}
            draggable={false}
            onError={() => setLoadError(true)}
            style={imgStyle}
          />
        )}
      </div>

      {/* ── Hint footer (subtle) ───────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: '8px 14px',
        textAlign: 'center',
        fontSize: 10, color: 'rgba(255,255,255,0.4)',
      }}>
        휠 = 줌 · 드래그 = 이동 · 더블클릭 = 토글 · 0 = 맞춤 · ESC = 닫기
      </div>
    </div>
  );
}
