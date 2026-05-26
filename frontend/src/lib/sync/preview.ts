/**
 * Sync preview — Phase 2 P2.B (UX 명료성).
 *
 * Why: 이전엔 "지금 동기화" 클릭 = 즉시 pull-merge-push 라 사용자가
 * 무엇이 추가/변경되는지 모르고 실행해야 했음. 카드가 많은 사용자가
 * 우발적으로 다른 PC 의 옛 상태를 받아오면 혼란. 이 모듈은 실제 commit
 * 전에 `previewSyncDiff` 로 dry-run 결과를 계산해서 모달에 표시한다.
 *
 * 의도:
 *   - pull 만 (push 없음). 실제 변경 없음.
 *   - id 기준 set 차이만 — 같은 id 의 content 차이는 v1.3.48 에선
 *     local-first 머지라 어차피 local 이 이김. P2.C 에서 lastModifiedAt
 *     도입되면 'changed' 카운트도 의미를 가짐.
 *
 * Local-first union 정책상 commit 시:
 *   - 로컬에만 있는 것 → 클라우드에 추가됨 (push)
 *   - 서버에만 있는 것 → 로컬에 추가됨 (pull)
 *   - 양쪽 다 있는 것 → 변경 없음 (local 이 그대로 유지)
 */

import { pullSnapshot } from './snapshot';
import type { AppData, Space, LauncherItem, Preset } from '../../types';
import { DEVICE_ONLY_SETTING_KEYS } from '../cohort';

export interface SyncDiffBucket {
  /** 카드 합 (모든 type 포함 — local-first 머지 하에선 cohort 분리 안 됨) */
  items: number;
  spaces: number;
  presets: number;
  nodeGroups: number;
  decks: number;
}

export interface SyncDiff {
  /** 서버에 user 의 snapshot row 존재 여부. false 면 첫 sync — 모든 게 push. */
  serverHasRow: boolean;
  serverGeneration: number;
  /** 이 PC → 클라우드 (로컬에만 있는 것) */
  push: SyncDiffBucket;
  /** 클라우드 → 이 PC (서버에만 있는 것) */
  pull: SyncDiffBucket;
  /** 양쪽 동일 id 가 존재하는 카드 수 (변경 없음 카테고리) */
  unchangedItems: number;
  /** 절대 sync 안 되는 디바이스-전용 settings 키 목록 */
  deviceOnlyKeys: readonly string[];
  /** 현재 로컬에 있는 sync 가능한 카드 총 수 (push 페이로드 기준) */
  localTotalItems: number;
}

function emptyBucket(): SyncDiffBucket {
  return { items: 0, spaces: 0, presets: 0, nodeGroups: 0, decks: 0 };
}

function collectItemIds(spaces: readonly Space[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const s of spaces ?? []) {
    for (const it of (s.items ?? []) as LauncherItem[]) ids.add(it.id);
  }
  return ids;
}

function collectIds<T extends { id: string }>(arr: readonly T[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const x of arr ?? []) ids.add(x.id);
  return ids;
}

function countAll(local: AppData): SyncDiffBucket {
  return {
    items: collectItemIds(local.spaces).size,
    spaces: (local.spaces ?? []).length,
    presets: (local.presets ?? []).length,
    nodeGroups: (local.nodeGroups ?? []).length,
    decks: (local.decks ?? []).length,
  };
}

/**
 * Pull server snapshot + compute diff against local. Pure read — no
 * writes, no IPC mutations. Safe to call repeatedly.
 *
 * Failure modes:
 *   - 서버 row 없음 → serverHasRow:false + push 에 모든 로컬 카운트
 *   - 네트워크 실패 → pullSnapshot 이 found:false 반환 → 첫 sync 처럼
 *     보이게 됨. 호출자는 별도로 에러 표시 권장 (이 함수는 throw 안 함).
 */
export async function previewSyncDiff(userId: string, local: AppData): Promise<SyncDiff> {
  const pulled = await pullSnapshot(userId);
  const deviceOnly = [...DEVICE_ONLY_SETTING_KEYS];
  const localTotal = collectItemIds(local.spaces).size;

  if (!pulled.found || !pulled.data) {
    return {
      serverHasRow: false,
      serverGeneration: 0,
      push: countAll(local),
      pull: emptyBucket(),
      unchangedItems: 0,
      deviceOnlyKeys: deviceOnly,
      localTotalItems: localTotal,
    };
  }

  const server = pulled.data;

  // Items — id 기반 set 차이
  const localItems = collectItemIds(local.spaces);
  const serverItems = collectItemIds(server.spaces);
  let pushItems = 0, pullItems = 0, unchanged = 0;
  for (const id of localItems) {
    if (serverItems.has(id)) unchanged++; else pushItems++;
  }
  for (const id of serverItems) {
    if (!localItems.has(id)) pullItems++;
  }

  // Spaces / Presets / NodeGroups / Decks — 같은 id-set 차이 패턴
  const diffByIds = <T extends { id: string }>(localArr: readonly T[] | undefined, serverArr: readonly T[] | undefined) => {
    const L = collectIds(localArr); const S = collectIds(serverArr);
    let p = 0, q = 0;
    for (const id of L) if (!S.has(id)) p++;
    for (const id of S) if (!L.has(id)) q++;
    return { push: p, pull: q };
  };

  const spaces      = diffByIds(local.spaces, server.spaces);
  const presets     = diffByIds(local.presets, (server.presets as Preset[] | undefined));
  const nodeGroups  = diffByIds(local.nodeGroups, server.nodeGroups);
  const decks       = diffByIds(local.decks, server.decks);

  return {
    serverHasRow: true,
    serverGeneration: pulled.generation,
    push: {
      items: pushItems,
      spaces: spaces.push,
      presets: presets.push,
      nodeGroups: nodeGroups.push,
      decks: decks.push,
    },
    pull: {
      items: pullItems,
      spaces: spaces.pull,
      presets: presets.pull,
      nodeGroups: nodeGroups.pull,
      decks: decks.pull,
    },
    unchangedItems: unchanged,
    deviceOnlyKeys: deviceOnly,
    localTotalItems: localTotal,
  };
}

/** Convenience: 어떤 변경도 없는지. UI 가 "변경 없음" 안내문 표시할 때 사용. */
export function isNoOpDiff(d: SyncDiff): boolean {
  const sumPush = d.push.items + d.push.spaces + d.push.presets + d.push.nodeGroups + d.push.decks;
  const sumPull = d.pull.items + d.pull.spaces + d.pull.presets + d.pull.nodeGroups + d.pull.decks;
  return sumPush === 0 && sumPull === 0 && d.serverHasRow;
}
