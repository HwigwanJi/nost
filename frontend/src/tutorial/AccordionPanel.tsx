/**
 * AccordionPanel — settings dialog "튜토리얼" tab.
 *
 * Two-tier:
 *   1. Header strip — total earned days + master progress bar
 *   2. Categories accordion — each expandable to a quest grid
 *
 * Empty state: when registry has zero quests (Sprint 1 reality)
 * we still render the categories with a "곧 추가됩니다" message
 * so the structure is visible from day one. As quests land
 * (Sprint 2+) the cards populate automatically.
 */

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useTutorialState } from './state';
import { QUESTS, CATEGORY_ORDER, CATEGORY_LABELS, questsByCategory, isUnlocked } from './registry';
import { totalAvailableDays } from './reward';
import type { CategoryId, Quest } from './types';

interface Props {
  /** Caller fires the actual quest start (ScanLoader → runner).
   *  AccordionPanel just emits intent; the host owns the lifecycle. */
  onStartQuest: (quest: Quest) => void;
  /** Current user's tier — used to lock requiresEntitlement='pro'
   *  quests for free users. Defaults to 'pro' so the BETA forced-
   *  pro period behaves the same as today. */
  tier?: 'free' | 'pro';
}

export function AccordionPanel({ onStartQuest, tier = 'pro' }: Props) {
  const state = useTutorialState();
  const [expanded, setExpanded] = useState<Set<CategoryId>>(new Set(['basics']));

  const toggleCategory = (c: CategoryId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const totalAvail = totalAvailableDays();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header — earned days + master progress */}
      <div style={{
        padding: 16, borderRadius: 12,
        background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border-rgba))',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
            {state.rewardDays}일
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            지금까지 적립 · 총 {totalAvail}일 가능
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'color-mix(in srgb, var(--border-rgba) 60%, transparent)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${totalAvail > 0 ? Math.min(100, (state.rewardDays / totalAvail) * 100) : 0}%`,
            background: 'var(--accent)',
            transition: 'width 0.4s cubic-bezier(0.4, 0.1, 0.3, 1)',
          }} />
        </div>
      </div>

      {/* Categories */}
      {CATEGORY_ORDER.map(cat => {
        const meta = CATEGORY_LABELS[cat];
        const isOpen = expanded.has(cat);
        const quests = questsByCategory(cat);
        const completedCount = quests.filter(q => q.id in state.completed).length;
        const allDone = quests.length > 0 && completedCount === quests.length;
        return (
          <div
            key={cat}
            style={{
              borderRadius: 10,
              border: '1px solid var(--border-rgba)',
              background: 'var(--surface)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => toggleCategory(cat)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <Icon name={meta.icon} size={18} color={allDone ? 'var(--accent)' : 'var(--text-muted)'} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-color)' }}>{meta.title}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{meta.summary}</span>
              </div>
              <span style={{ fontSize: 10.5, color: allDone ? 'var(--accent)' : 'var(--text-dim)', fontWeight: 600 }}>
                {quests.length === 0 ? '준비 중' : `${completedCount} / ${quests.length}`}
                {allDone && ' ✓'}
              </span>
              <Icon name={isOpen ? 'expand_less' : 'expand_more'} size={16} color="var(--text-dim)" />
            </button>

            {isOpen && (
              <div style={{ padding: '4px 12px 12px', borderTop: '1px solid var(--border-rgba)' }}>
                {quests.length === 0 ? (
                  <p style={{ margin: '12px 4px', fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    이 카테고리의 퀘스트는 곧 추가됩니다.
                  </p>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 8,
                    marginTop: 8,
                  }}>
                    {quests.map(q => {
                      const proGated = q.requiresEntitlement === 'pro' && tier !== 'pro';
                      return (
                        <QuestCard
                          key={q.id}
                          quest={q}
                          isCompleted={q.id in state.completed}
                          isUnlocked={isUnlocked(q, state.completed) && !proGated}
                          isProGated={proGated}
                          onStart={() => onStartQuest(q)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {QUESTS.length === 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.6 }}>
          튜토리얼 시스템 준비 중 — 챕터별로 추가될 예정이에요.
        </p>
      )}
    </div>
  );
}

interface QuestCardProps {
  quest: Quest;
  isCompleted: boolean;
  isUnlocked: boolean;
  isProGated?: boolean;
  onStart: () => void;
}

function QuestCard({ quest, isCompleted, isUnlocked, isProGated, onStart }: QuestCardProps) {
  const disabled = !isUnlocked;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onStart}
      title={isProGated
        ? 'Pro 사용자 전용 퀘스트입니다'
        : disabled
          ? '선행 퀘스트 완료 후 잠금 해제됩니다'
          : isCompleted
            ? '다시 진행하기 (보상 추가 적립 없음)'
            : `시작 — 약 ${Math.round(quest.estimatedSec / 10) * 10}초 · +${quest.rewardDays}일 적립`}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '12px 14px',
        borderRadius: 9,
        background: isCompleted ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
        border: `1.5px solid ${isCompleted ? 'var(--accent)' : 'var(--border-rgba)'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'border-color 0.12s, background 0.12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: isCompleted ? 'var(--accent)' : 'var(--text-color)' }}>
          {quest.title}
        </span>
        {isCompleted
          ? <Icon name="check_circle" size={14} color="var(--accent)" />
          : isProGated
            ? <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Icon name="workspace_premium" size={11} />Pro
              </span>
            : disabled
              ? <Icon name="lock" size={12} color="var(--text-dim)" />
              : <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>+{quest.rewardDays}일</span>
        }
      </div>
      <span style={{ fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {quest.summary}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
        ~{quest.estimatedSec}초
      </span>
    </button>
  );
}
