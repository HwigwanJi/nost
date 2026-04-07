/* eslint react-refresh/only-export-components: 0 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Space, NodeGroup, LauncherItem } from '../types';

// ── Types ──────────────────────────────────────────────────────
export type ParsedCommand =
  | { kind: 'search'; query: string }
  | { kind: 'launch-card'; spaceIdx: number; cardIdx: number }
  | { kind: 'launch-node'; nodeIdx: number }
  | { kind: 'settings' }
  | { kind: 'clipboard'; spaceIdx: number; cardIdx: number }  // -1,-1 = auto-place
  | { kind: 'tile'; pairs: Array<{ spaceIdx: number; cardIdx: number }> }
  | { kind: 'new-space'; name: string }
  | { kind: 'pin'; spaceIdx: number; cardIdx: number }
  | { kind: 'resize-window'; pct: 50 | 75 | 100 }
  | { kind: 'help' }
  | { kind: 'invalid'; reason: string };

export interface Suggestion {
  icon: string;
  label: string;
  sub?: string;
  onSelect: () => void;
  dimmed?: boolean;
}

interface Props {
  isOpen: boolean;
  inputValue: string;
  onInputChange: (v: string) => void;
  onClose: () => void;
  onExecute: (cmd: ParsedCommand) => void;
  spaces: Space[];
  nodeGroups: NodeGroup[];
}

// ── Parser ────────────────────────────────────────────────────
function parseCardRef(ref: string): { spaceIdx: number; cardIdx: number } | null {
  const m = ref.match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  return { spaceIdx: parseInt(m[1]) - 1, cardIdx: parseInt(m[2]) - 1 };
}

export function parseCommand(input: string, spaces: Space[], _nodeGroups: NodeGroup[]): ParsedCommand {
  const raw = input.trim();
  if (!raw) return { kind: 'search', query: '' };

  // ── //n → launch node n ──────────────────────────────────
  const nodeMatch = raw.match(/^\/\/(\d+)$/);
  if (nodeMatch) {
    return { kind: 'launch-node', nodeIdx: parseInt(nodeMatch[1]) - 1 };
  }

  // ── /... commands ─────────────────────────────────────────
  if (raw.startsWith('/')) {
    const body = raw.slice(1).trim();

    // /n-m → launch card
    const cardRef = parseCardRef(body);
    if (cardRef) return { kind: 'launch-card', ...cardRef };

    // /setting(s)
    if (/^settings?$/i.test(body)) return { kind: 'settings' };

    // /help or /?
    if (/^(help|\?)$/i.test(body)) return { kind: 'help' };

    // /clipboard [n-m]
    if (/^clipboard(\s.*)?$/i.test(body)) {
      const rest = body.replace(/^clipboard/i, '').trim();
      if (!rest) return { kind: 'clipboard', spaceIdx: -1, cardIdx: -1 };
      const ref = parseCardRef(rest);
      if (ref) return { kind: 'clipboard', ...ref };
      return { kind: 'invalid', reason: `"${rest}"는 유효한 위치가 아닙니다 (예: /clipboard 2-3)` };
    }

    // /tile n-m n-m [n-m]
    if (/^tile\s+/i.test(body)) {
      const parts = body.replace(/^tile\s+/i, '').split(/\s+/);
      const pairs: Array<{ spaceIdx: number; cardIdx: number }> = [];
      for (const p of parts) {
        const ref = parseCardRef(p);
        if (!ref) return { kind: 'invalid', reason: `"${p}"는 유효한 카드 참조가 아닙니다` };
        pairs.push(ref);
      }
      if (pairs.length < 2) return { kind: 'invalid', reason: '타일에는 최소 2개의 카드가 필요합니다' };
      return { kind: 'tile', pairs };
    }

    // /new [name]
    if (/^new(\s.*)?$/i.test(body)) {
      const name = body.replace(/^new\s*/i, '').trim() || `스페이스 ${spaces.length + 1}`;
      return { kind: 'new-space', name };
    }

    // /pin n-m
    if (/^pin\s+/i.test(body)) {
      const ref = parseCardRef(body.replace(/^pin\s+/i, '').trim());
      if (ref) return { kind: 'pin', ...ref };
      return { kind: 'invalid', reason: '핀 형식: /pin n-m (예: /pin 2-3)' };
    }

    // /50 /75 /100 — resize active window
    if (/^(50|75|100)$/.test(body)) {
      const pct = parseInt(body) as 50 | 75 | 100;
      return { kind: 'resize-window', pct };
    }

    // Unknown slash command
    return { kind: 'invalid', reason: `"/${body}"는 알 수 없는 명령어입니다. /? 로 도움말 확인` };
  }

  // ── Regular search ────────────────────────────────────────
  return { kind: 'search', query: raw };
}

// ── Suggestion generator ──────────────────────────────────────
export function buildSuggestions(
  input: string,
  cmd: ParsedCommand,
  spaces: Space[],
  nodeGroups: NodeGroup[],
  onExecute: (c: ParsedCommand) => void,
): Suggestion[] {
  const raw = input.trim();

  if (cmd.kind === 'search' && raw) {
    const q = raw.toLowerCase();
    const hits: Suggestion[] = [];
    spaces.forEach((sp, si) => {
      sp.items.forEach((item, ci) => {
        if (item.title.toLowerCase().includes(q) || item.value.toLowerCase().includes(q)) {
          hits.push({
            icon: itemIcon(item),
            label: item.title,
            sub: `스페이스 ${si + 1}-${ci + 1} · ${item.value.slice(0, 40)}`,
            onSelect: () => onExecute({ kind: 'launch-card', spaceIdx: si, cardIdx: ci }),
          });
        }
      });
    });
    // Also suggest node groups
    nodeGroups.forEach((ng, ni) => {
      if (ng.name.toLowerCase().includes(q)) {
        hits.push({
          icon: 'account_tree',
          label: ng.name,
          sub: `노드 ${ni + 1} · ${ng.itemIds.length}개 연결`,
          onSelect: () => onExecute({ kind: 'launch-node', nodeIdx: ni }),
        });
      }
    });
    return hits.slice(0, 8);
  }

  if (cmd.kind === 'launch-card') {
    const sp = spaces[cmd.spaceIdx];
    const item = sp?.items[cmd.cardIdx];
    if (item) return [{ icon: itemIcon(item), label: item.title, sub: `실행: ${item.value.slice(0, 50)}`, onSelect: () => onExecute(cmd) }];
    return [{ icon: 'error', label: `${cmd.spaceIdx + 1}-${cmd.cardIdx + 1} 카드를 찾을 수 없습니다`, sub: '', onSelect: () => {}, dimmed: true }];
  }

  if (cmd.kind === 'launch-node') {
    const ng = nodeGroups[cmd.nodeIdx];
    if (ng) return [{ icon: 'account_tree', label: ng.name, sub: `노드 실행 · ${ng.itemIds.length}개 창 분할`, onSelect: () => onExecute(cmd) }];
    return [{ icon: 'error', label: `노드 ${cmd.nodeIdx + 1}을 찾을 수 없습니다`, sub: '', onSelect: () => {}, dimmed: true }];
  }

  if (cmd.kind === 'settings') return [{ icon: 'settings', label: '설정 열기', sub: '앱 환경설정', onSelect: () => onExecute(cmd) }];
  if (cmd.kind === 'help') return [{ icon: 'help', label: '커맨드 도움말', sub: '모든 명령어 보기', onSelect: () => onExecute(cmd) }];

  if (cmd.kind === 'clipboard') {
    const loc = cmd.spaceIdx === -1
      ? '첫 번째 스페이스 자동 배치'
      : `스페이스 ${cmd.spaceIdx + 1}-${cmd.cardIdx + 1}`;
    return [{ icon: 'content_paste', label: '클립보드 저장', sub: `클립보드 내용 → ${loc}`, onSelect: () => onExecute(cmd) }];
  }

  if (cmd.kind === 'tile') {
    const labels = cmd.pairs.map(p => {
      const item = spaces[p.spaceIdx]?.items[p.cardIdx];
      return item ? item.title : `${p.spaceIdx + 1}-${p.cardIdx + 1}`;
    }).join(' + ');
    return [{ icon: 'view_column', label: '분할화면 실행', sub: labels, onSelect: () => onExecute(cmd) }];
  }

  if (cmd.kind === 'new-space') return [{ icon: 'add_circle', label: `새 스페이스 "${cmd.name}" 생성`, sub: '', onSelect: () => onExecute(cmd) }];

  if (cmd.kind === 'pin') {
    const item = spaces[cmd.spaceIdx]?.items[cmd.cardIdx];
    if (item) return [{ icon: 'push_pin', label: `핀 토글: ${item.title}`, sub: `스페이스 ${cmd.spaceIdx + 1}-${cmd.cardIdx + 1}`, onSelect: () => onExecute(cmd) }];
    return [{ icon: 'error', label: `카드를 찾을 수 없습니다`, sub: '', onSelect: () => {}, dimmed: true }];
  }

  if (cmd.kind === 'resize-window') {
    const labels: Record<number, string> = { 50: '런처를 화면 절반 크기로, 중앙 배치', 75: '런처를 화면 75% 크기로, 중앙 배치', 100: '런처를 작업 영역 전체로 확장' };
    return [{ icon: 'open_in_full', label: `런처 크기 ${cmd.pct}%`, sub: labels[cmd.pct], onSelect: () => onExecute(cmd) }];
  }

  if (cmd.kind === 'invalid') {
    return [{ icon: 'error', label: cmd.reason, sub: '', onSelect: () => {}, dimmed: true }];
  }

  // Empty — show hint suggestions
  return buildHintSuggestions(spaces, nodeGroups, onExecute);
}

function buildHintSuggestions(spaces: Space[], nodeGroups: NodeGroup[], onExec: (c: ParsedCommand) => void): Suggestion[] {
  const hints: Suggestion[] = [];

  // Add a few card shortcuts
  spaces.slice(0, 2).forEach((sp, si) => {
    sp.items.slice(0, 2).forEach((item, ci) => {
      hints.push({ icon: itemIcon(item), label: item.title, sub: `/${si + 1}-${ci + 1}`, onSelect: () => onExec({ kind: 'launch-card', spaceIdx: si, cardIdx: ci }) });
    });
  });

  // Node groups
  nodeGroups.slice(0, 2).forEach((ng, ni) => {
    hints.push({ icon: 'account_tree', label: ng.name, sub: `//${ni + 1}`, onSelect: () => onExec({ kind: 'launch-node', nodeIdx: ni }) });
  });

  hints.push({ icon: 'help', label: '/? 도움말', sub: '모든 명령어 보기', onSelect: () => onExec({ kind: 'help' }) });
  return hints;
}

function itemIcon(item: LauncherItem): string {
  switch (item.type) {
    case 'url': case 'browser': return 'public';
    case 'folder': return 'folder';
    case 'app': return 'apps';
    case 'window': return 'desktop_windows';
    case 'text': return 'content_copy';
    case 'cmd': return 'terminal';
    default: return 'link';
  }
}

// ── HELP content ──────────────────────────────────────────────
const HELP_CONTENT = [
  { cmd: '/n-m', desc: 'n번 스페이스의 m번 카드 실행' },
  { cmd: '//n', desc: 'n번 노드(워크플로우) 실행' },
  { cmd: '/setting', desc: '설정 열기' },
  { cmd: '/clipboard', desc: '클립보드 → 첫 번째 빈 슬롯에 저장' },
  { cmd: '/clipboard n-m', desc: '클립보드 → n번 스페이스 m번 위치에 저장' },
  { cmd: '/tile n-m n-m', desc: '두 카드를 분할화면으로 실행' },
  { cmd: '/new 이름', desc: '새 스페이스 생성' },
  { cmd: '/pin n-m', desc: '해당 카드 핀 토글' },
  { cmd: '/50  /75  /100', desc: '런처 창 크기를 화면 대비 해당 비율로 조정 (중앙 배치)' },
  { cmd: '텍스트', desc: '카드 전체 검색 (실시간 필터)' },
];

// ── CommandBar Component ──────────────────────────────────────
export function CommandBar({ isOpen, inputValue, onInputChange, onClose, onExecute, spaces, nodeGroups }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  const cmd = parseCommand(inputValue, spaces, nodeGroups);
  const suggestions = buildSuggestions(inputValue, cmd, spaces, nodeGroups, onExecute);

  // Auto-focus when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setSelectedIdx(0);
      setShowHelp(false);
    }
  }, [isOpen]);

  // Reset selection when input changes
  useEffect(() => { setSelectedIdx(0); }, [inputValue]);

  const handleExecuteSelected = useCallback(() => {
    if (cmd.kind === 'help') { setShowHelp(true); return; }
    if (suggestions[selectedIdx]) {
      suggestions[selectedIdx].onSelect();
    } else if (cmd.kind !== 'invalid' && cmd.kind !== 'search') {
      onExecute(cmd);
    }
  }, [cmd, suggestions, selectedIdx, onExecute]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleExecuteSelected();
    }
  }, [suggestions, handleExecuteSelected, onClose]);

  if (!isOpen) return null;

  const accentColor = document.documentElement.style.getPropertyValue('--accent') || '#6366f1';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.25)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: '18%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(560px, 90vw)',
          zIndex: 1000,
          borderRadius: 14,
          background: 'var(--bg-rgba)',
          backdropFilter: 'blur(50px) saturate(160%)',
          border: '1px solid var(--border-rgba)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          fontFamily: 'inherit',
        }}
      >
        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10, borderBottom: '1px solid var(--border-rgba)' }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18, color: accentColor, flexShrink: 0 }}>
            {cmd.kind === 'search' && inputValue ? 'search' :
             cmd.kind.startsWith('launch') ? 'play_circle' :
             cmd.kind === 'clipboard' ? 'content_paste' :
             cmd.kind === 'invalid' ? 'error' : 'terminal'}
          </span>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="검색하거나 /명령어를 입력하세요 — /? 도움말"
            spellCheck={false}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 14,
              color: 'var(--text-color)',
              fontFamily: 'inherit',
            }}
          />
          {inputValue && (
            <button
              onClick={() => onInputChange('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 0, display: 'flex' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
            </button>
          )}
          <kbd style={{
            flexShrink: 0, padding: '2px 6px', background: 'var(--surface)', border: '1px solid var(--border-rgba)',
            borderRadius: 4, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'inherit',
          }}>ESC</kbd>
        </div>

        {/* Help overlay */}
        {showHelp ? (
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              커맨드 도움말
            </div>
            {HELP_CONTENT.map(h => (
              <div key={h.cmd} style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: '1px solid var(--border-rgba)', alignItems: 'baseline' }}>
                <code style={{
                  flexShrink: 0, width: 160, fontSize: 12, color: accentColor,
                  fontFamily: 'Consolas, "Courier New", monospace',
                }}>{h.cmd}</code>
                <span style={{ fontSize: 12, color: 'var(--text-color)' }}>{h.desc}</span>
              </div>
            ))}
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-dim)' }}>
              Enter로 실행 · ↑↓ 선택 · ESC 닫기
            </div>
          </div>
        ) : (
          /* Suggestions list */
          suggestions.length > 0 && (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {suggestions.map((sg, i) => (
                <div
                  key={i}
                  onClick={sg.dimmed ? undefined : sg.onSelect}
                  onMouseEnter={() => !sg.dimmed && setSelectedIdx(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 14px',
                    cursor: sg.dimmed ? 'default' : 'pointer',
                    background: i === selectedIdx && !sg.dimmed ? 'var(--surface)' : 'transparent',
                    borderLeft: i === selectedIdx && !sg.dimmed ? `3px solid ${accentColor}` : '3px solid transparent',
                    opacity: sg.dimmed ? 0.45 : 1,
                    transition: 'background 0.1s',
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 16, color: i === selectedIdx ? accentColor : 'var(--text-muted)', flexShrink: 0 }}>
                    {sg.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sg.label}
                    </div>
                    {sg.sub && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                        {sg.sub}
                      </div>
                    )}
                  </div>
                  {i === selectedIdx && !sg.dimmed && (
                    <kbd style={{
                      flexShrink: 0, padding: '2px 5px', background: 'var(--bg-rgba)', border: '1px solid var(--border-rgba)',
                      borderRadius: 4, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'inherit',
                    }}>↵</kbd>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* Footer hint */}
        {!showHelp && (
          <div style={{
            padding: '6px 14px',
            borderTop: '1px solid var(--border-rgba)',
            display: 'flex',
            gap: 12,
            fontSize: 10,
            color: 'var(--text-dim)',
          }}>
            <span>↑↓ 이동</span>
            <span>↵ 실행</span>
            <span style={{ marginLeft: 'auto' }}>
              {cmd.kind !== 'search' && cmd.kind !== 'invalid'
                ? <span style={{ color: accentColor }}>{inputValue}</span>
                : null}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
