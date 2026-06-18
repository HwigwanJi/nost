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
 *   - Ctrl+C: 클립보드 복사 (크롭 선택 있으면 그 영역, 없으면 전체) [v1.3.50]
 *   - 크롭 모드: 드래그로 영역 선택 → 복사 [v1.3.50]
 *
 * 의도적 비-목표 (v1):
 *   - 다음/이전 이미지 (single image 뷰)
 *   - 회전, EXIF, 메타 표시
 *   - 동영상/PDF (별도 viewer 필요)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSatelliteTheme } from '../lib/satelliteTheme';
import { electronAPI } from '../electronBridge';

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

/** 화면 좌표 사각형 (left/top/width/height). */
interface ScreenRect { left: number; top: number; width: number; height: number; }

export function ImageViewerSatellite() {
  const [state, setState] = useState<ImageViewerSatelliteState | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [loadError, setLoadError] = useState(false);
  // v1.3.50 — 크롭 모드 + 선택 영역 + 임시 피드백 토스트.
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<ScreenRect | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const draggingRef = useRef<{ startX: number; startY: number; basePan: { x: number; y: number } } | null>(null);
  const cropDragRef = useRef<{ startX: number; startY: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = api.onState(setState);
    api.requestState();
    return off;
  }, []);

  useSatelliteTheme(state);

  const close = useCallback(() => api.action({ kind: 'close' }), []);

  const flash = useCallback((msg: string) => {
    setFeedback(msg);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 1600);
  }, []);

  // Reset state when path changes (re-using viewer for another image).
  useEffect(() => {
    setZoom('fit');
    setPan({ x: 0, y: 0 });
    setLoadError(false);
    setCropMode(false);
    setCropRect(null);
  }, [state?.path]);

  // ── 클립보드 복사 (v1.3.50) ────────────────────────────────────
  // 전체 이미지: path 기반 copyImageToClipboard (재인코딩 없음, 원본 품질).
  // 크롭 선택: canvas 로 영역 추출 → dataURL → copyImageDataToClipboard.
  const copyWhole = useCallback(async () => {
    if (!state?.path) return;
    // SVG 는 nativeImage.createFromPath 가 못 읽음 (vector). 안내.
    if (/\.svg(\?|#|$)/i.test(state.path)) { flash('SVG 는 클립보드 복사를 지원하지 않아요'); return; }
    electronAPI.copyImageToClipboard(state.path, false);
    flash('클립보드에 복사되었습니다');
  }, [state?.path, flash]);

  const cropAndCopy = useCallback(async () => {
    const img = imgRef.current;
    if (!img || !cropRect) return;
    const imgBox = img.getBoundingClientRect();
    const natW = img.naturalWidth, natH = img.naturalHeight;
    if (!natW || !natH) { flash('이미지 크기를 읽지 못했어요'); return; }
    // 화면 좌표 → 표시 박스 상대 → 자연 픽셀. 표시 박스 밖은 clamp.
    const scale = natW / imgBox.width;
    const relLeft = Math.max(0, cropRect.left - imgBox.left);
    const relTop  = Math.max(0, cropRect.top - imgBox.top);
    const relRight  = Math.min(imgBox.width,  cropRect.left + cropRect.width - imgBox.left);
    const relBottom = Math.min(imgBox.height, cropRect.top + cropRect.height - imgBox.top);
    const sx = relLeft * scale;
    const sy = relTop * scale;
    const sw = (relRight - relLeft) * scale;
    const sh = (relBottom - relTop) * scale;
    if (sw < 2 || sh < 2) { flash('선택 영역이 너무 작아요'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) { flash('크롭 실패'); return; }
    try {
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      const r = await electronAPI.copyImageDataToClipboard(dataUrl);
      if (r.success) { flash('잘라서 클립보드에 복사되었습니다'); setCropMode(false); setCropRect(null); }
      else flash('복사 실패');
    } catch {
      flash('크롭 실패 (보안 제한)');
    }
  }, [cropRect, flash]);

  // Global key handlers: ESC close, '0' reset, Ctrl+C copy.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        if (cropMode && cropRect) void cropAndCopy();
        else void copyWhole();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // 크롭 모드면 모드만 해제, 아니면 창 닫기 (단계적 ESC).
        if (cropMode) { setCropMode(false); setCropRect(null); }
        else close();
      }
      else if (e.key === '0') { e.preventDefault(); setZoom('fit'); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close, cropMode, cropRect, cropAndCopy, copyWhole]);

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

  // Pointer down — crop 모드면 선택 시작, 아니면 (zoom>fit) pan 시작.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (cropMode) {
      cropDragRef.current = { startX: e.clientX, startY: e.clientY };
      setCropRect({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (zoom === 'fit') return;
    draggingRef.current = { startX: e.clientX, startY: e.clientY, basePan: pan };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [cropMode, zoom, pan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const c = cropDragRef.current;
    if (c) {
      const left = Math.min(c.startX, e.clientX);
      const top  = Math.min(c.startY, e.clientY);
      setCropRect({ left, top, width: Math.abs(e.clientX - c.startX), height: Math.abs(e.clientY - c.startY) });
      return;
    }
    const d = draggingRef.current;
    if (!d) return;
    setPan({ x: d.basePan.x + (e.clientX - d.startX), y: d.basePan.y + (e.clientY - d.startY) });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (cropDragRef.current) {
      cropDragRef.current = null;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (draggingRef.current) {
      draggingRef.current = null;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch (_) {}
    }
  }, [cropMode]);

  const onDoubleClick = useCallback(() => {
    if (cropMode) return;  // 크롭 중 더블클릭 줌 토글 방지
    setZoom(prev => (prev === 'fit' || prev === 1 ? 2 : 'fit'));
    setPan({ x: 0, y: 0 });
  }, [cropMode]);

  // 크롭 모드 진입 시 줌을 fit 으로 고정 — 화면↔자연픽셀 매핑이 단순해짐
  // (fit 에서 img element box == 표시 이미지 box, letterbox 없음).
  const toggleCrop = useCallback(() => {
    setCropMode(prev => {
      const next = !prev;
      if (next) { setZoom('fit'); setPan({ x: 0, y: 0 }); }
      setCropRect(null);
      return next;
    });
  }, []);

  if (!state) return null;

  const label = state.label || basenameOf(state.path);
  const src = toFileUrl(state.path);
  const isFit = zoom === 'fit';
  const numericZoom = isFit ? 1 : zoom;
  const imgStyle: React.CSSProperties = isFit
    // v1.3.50 — objectFit:contain 제거. maxWidth/maxHeight 만으로 비율
    // 유지 스케일 → element box == 표시 이미지 box (letterbox 없음) →
    // 크롭 좌표 매핑이 정확해짐 (getBoundingClientRect 가 곧 이미지 영역).
    ? { maxWidth: '100%', maxHeight: '100%' }
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
        {/* 우측 액션 버튼들 (v1.3.50) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {cropMode && cropRect && (cropRect.width > 4 && cropRect.height > 4) && (
            <button
              onClick={() => void cropAndCopy()}
              title="선택 영역 복사 (Ctrl+C)"
              style={hdrBtnStyle(true)}
            >잘라서 복사</button>
          )}
          <button
            onClick={toggleCrop}
            title={cropMode ? '크롭 종료 (ESC)' : '크롭'}
            style={hdrBtnStyle(cropMode)}
          >크롭</button>
          <button
            onClick={() => void copyWhole()}
            title="전체 복사 (Ctrl+C)"
            style={hdrBtnStyle(false)}
          >복사</button>
          <button
            onClick={close}
            title="닫기 (ESC)"
            style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 18, lineHeight: 1,
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >×</button>
        </div>
      </div>

      {/* ── Image stage ────────────────────────────────────────── */}
      <div
        style={{
          flex: 1, position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          cursor: cropMode ? 'crosshair' : (isFit ? 'zoom-in' : (draggingRef.current ? 'grabbing' : 'grab')),
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
        onWheel={cropMode ? undefined : onWheel}
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
            ref={imgRef}
            src={src}
            alt={label}
            draggable={false}
            onError={() => setLoadError(true)}
            style={imgStyle}
          />
        )}

        {/* 크롭 선택 사각형 (화면 fixed 좌표). 어둡게 깔고 선택부만 밝게. */}
        {cropMode && cropRect && cropRect.width > 0 && cropRect.height > 0 && (
          <div
            style={{
              position: 'fixed',
              left: cropRect.left, top: cropRect.top,
              width: cropRect.width, height: cropRect.height,
              border: '1.5px solid #fff',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />
        )}
      </div>

      {/* 임시 피드백 토스트 (v1.3.50) — 복사/크롭 결과 */}
      {feedback && (
        <div style={{
          position: 'fixed', bottom: 44, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(20,20,22,0.92)', color: '#fff',
          padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          pointerEvents: 'none', zIndex: 10,
        }}>
          {feedback}
        </div>
      )}

      {/* ── Hint footer (subtle) ───────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: '8px 14px',
        textAlign: 'center',
        fontSize: 10, color: 'rgba(255,255,255,0.4)',
      }}>
        {cropMode
          ? '드래그 = 영역 선택 · Ctrl+C = 선택 복사 · ESC = 크롭 종료'
          : '휠 = 줌 · 드래그 = 이동 · Ctrl+C = 복사 · 크롭 · 0 = 맞춤 · ESC = 닫기'}
      </div>
    </div>
  );
}

/** 헤더 액션 버튼 스타일 (active=강조). */
function hdrBtnStyle(active: boolean): React.CSSProperties {
  return {
    height: 26, padding: '0 10px', borderRadius: 6,
    background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
    border: '1px solid rgba(255,255,255,0.18)',
    color: 'rgba(255,255,255,0.85)',
    cursor: 'pointer', fontSize: 11, fontWeight: 600,
    fontFamily: 'inherit',
  };
}
