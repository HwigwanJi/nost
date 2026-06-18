/**
 * useDocCohortBadges — doc 카드의 "새 버전 있음" 모서리 배지 (v1.3.50).
 *
 * 설계 원칙: 가장 가벼움 (사용자 요청 "캐시 안 잡아먹게").
 *   - store 에 안 쌓음 — 결과는 in-memory Set<itemId> 뿐. sync·disk 0.
 *   - 폴링 없음 — 런처 window 'focus'(=show) 시점에만 1회 스캔 +
 *     document.hidden 가드 (백그라운드 미실행).
 *   - opt-in 카드만 — item.docCohort 가 설정된 doc 카드만 대상. 대부분의
 *     카드는 바인딩이 없어 스캔 집합이 보통 한 줌.
 *   - 시그니처 캐시 — (itemId:dir:pattern:value) 가 직전 스캔과 같으면
 *     listDocCohort IPC 자체를 skip. 디렉토리/파일명 안 바뀌면 재스캔 0.
 *   - "오래됨" 만 배지 — 최신은 무배지 (알림 노이즈 0, 가장 가벼운 UX).
 *
 * 반환: outdated 인 itemId 의 Set. ItemCard 가 자기 id 포함 여부만 본다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppData } from '../types';
import { electronAPI } from '../electronBridge';
import { rankCandidates, basenameOf } from '../lib/docCohort';

export function useDocCohortBadges(data: AppData): Set<string> {
  const [outdated, setOutdated] = useState<Set<string>>(() => new Set());
  // 시그니처 캐시: itemId → 마지막으로 스캔한 시그니처. 같은 시그니처면
  // IPC skip. 세션 메모리에만 — 영속 안 함.
  const sigRef = useRef<Map<string, string>>(new Map());
  const scanningRef = useRef(false);

  const labelOrder = data.settings.docCohort?.labelOrder ?? [];

  const scan = useCallback(async () => {
    if (scanningRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    // opt-in 대상 수집: doc 타입 + docCohort 바인딩 있는 카드만.
    const targets: Array<{ id: string; value: string; dir: string; pattern: string; tokenType: string }> = [];
    for (const sp of data.spaces) {
      for (const it of sp.items) {
        if (it.type !== 'doc' || !it.docCohort) continue;
        targets.push({
          id: it.id,
          value: it.value,
          dir: it.docCohort.directory,
          pattern: it.docCohort.pattern,
          tokenType: it.docCohort.tokenType,
        });
      }
    }
    if (targets.length === 0) {
      if (outdated.size > 0) setOutdated(new Set());
      return;
    }

    scanningRef.current = true;
    try {
      const next = new Set<string>();
      for (const t of targets) {
        const sig = `${t.id}:${t.dir}:${t.pattern}:${t.value}`;
        const prevSig = sigRef.current.get(t.id);
        // 시그니처 동일 → 직전 판정 유지 (IPC skip). 직전이 outdated 였으면
        // 유지하기 위해 현재 outdated 에서 읽어 옮긴다.
        if (prevSig === sig) {
          if (outdated.has(t.id)) next.add(t.id);
          continue;
        }
        const r = await electronAPI.listDocCohort(t.dir, t.pattern);
        sigRef.current.set(t.id, sig);
        if (!r.ok || r.items.length === 0) continue;
        const ranked = rankCandidates(
          r.items,
          t.tokenType as Parameters<typeof rankCandidates>[1],
          labelOrder,
        );
        const newest = ranked[0];
        if (!newest) continue;
        // 카드가 가리키는 파일이 최신이 아니면 outdated.
        const cur = basenameOf(t.value);
        if (newest.basename !== cur) next.add(t.id);
      }
      // 사라진 카드의 시그니처 정리 (메모리 누수 방지).
      const liveIds = new Set(targets.map(t => t.id));
      for (const id of sigRef.current.keys()) if (!liveIds.has(id)) sigRef.current.delete(id);

      setOutdated(prev => {
        if (prev.size === next.size && [...next].every(id => prev.has(id))) return prev;
        return next;
      });
    } finally {
      scanningRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.spaces, labelOrder, outdated]);

  useEffect(() => {
    // 런처가 보일 때만 — focus(=show) + 최초 1회. 인터벌/realtime 없음.
    const onFocus = () => { void scan(); };
    window.addEventListener('focus', onFocus);
    void scan();
    return () => window.removeEventListener('focus', onFocus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  return outdated;
}
