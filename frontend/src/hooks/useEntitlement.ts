import { useMemo } from 'react';
import type { AppData, License, LicenseTier } from '../types';
import { FREE_LIMITS, LICENSE_GRACE_DAYS, TRIAL_DURATION_MS } from '../types';

/**
 * Entitlement — the single source of truth for "can the user do X right now?".
 *
 * Design:
 *   - Every gate in the app calls `useEntitlement(data)` and asks the
 *     returned object (`canAddCard(totalCards)`, `isPro`, `limits`, …).
 *   - The hook is PURE over `data`; it does not fetch, subscribe, or
 *     side-effect. The license record inside `data.settings.license` is
 *     the cached verification result — separate code (useLicenseSync) is
 *     responsible for refreshing it from the server.
 *   - Trial is client-awarded once: the FIRST time a user with no license
 *     hits a Pro gate, we stamp `trialStartedAt = now`, `trialEndsAt = now
 *     + TRIAL_DURATION_MS`. The server re-signs this during first login.
 */

export interface Entitlement {
  /** Resolved tier — collapses license state + dates into a simple flag. */
  tier: LicenseTier;
  isPro: boolean;
  /** Trial metadata for the UI (show countdown / offer upgrade). */
  trialActive: boolean;
  trialEndsAt?: number;
  trialDaysLeft?: number;
  /** Paid subscription period end, when applicable. */
  periodEndsAt?: number;
  /** Effective limits — Pro gets Infinity / true for all. */
  limits: {
    totalCards: number;
    spaces: number;
    nodes: number;
    decks: number;
    floatingBadges: number;
    presets: number;
    containerEnabled: boolean;
  };
  /** Reason the user is not Pro (for UX copy). Empty string when Pro. */
  notProReason: '' | 'never-signed-in' | 'trial-expired' | 'subscription-expired' | 'canceled';
  raw: License | undefined;
  // ── Gate predicates (call-site sugar) ──────────────────────────
  canAddCard:          (currentTotal: number) => boolean;
  canAddSpace:         (currentCount: number) => boolean;
  canAddNode:          (currentCount: number) => boolean;
  canAddDeck:          (currentCount: number) => boolean;
  canAddFloatingBadge: (currentCount: number) => boolean;
  canUsePreset:        (presetId: '1' | '2' | '3') => boolean;
  canUseContainer:     () => boolean;
}

const PRO_LIMITS = {
  totalCards: Infinity,
  spaces: Infinity,
  nodes: Infinity,
  decks: Infinity,
  floatingBadges: Infinity,
  presets: 3,
  containerEnabled: true,
} as const;

/**
 * Resolve the effective tier from a license record + current time.
 *
 * Order of precedence:
 *   1. Active paid subscription with periodEndsAt in the future → pro
 *   2. Active subscription past due BUT within offline grace → pro
 *   3. Canceled but still inside already-paid period → pro
 *   4. Trial in progress → pro
 *   5. Everything else → free
 */
function resolveTier(license: License | undefined, now: number): {
  tier: LicenseTier;
  reason: Entitlement['notProReason'];
} {
  if (!license) return { tier: 'free', reason: 'never-signed-in' };
  const GRACE_MS = LICENSE_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const periodEnd   = license.periodEndsAt ?? 0;
  const trialEnd    = license.trialEndsAt ?? 0;
  const lastVerified = license.lastVerifiedAt ?? 0;
  const offlineDeadline = lastVerified + GRACE_MS;

  if (license.status === 'active' && periodEnd > now) return { tier: 'pro', reason: '' };
  if (license.status === 'canceled' && periodEnd > now) return { tier: 'pro', reason: '' };
  if (license.status === 'past_due' && offlineDeadline > now) return { tier: 'pro', reason: '' };
  if (license.status === 'trial' && trialEnd > now) return { tier: 'pro', reason: '' };

  // Expired cases — pick the most specific reason for nicer UX copy.
  if (license.status === 'trial' && trialEnd <= now) return { tier: 'free', reason: 'trial-expired' };
  if (license.status === 'canceled') return { tier: 'free', reason: 'canceled' };
  if (license.status === 'expired' || periodEnd <= now) return { tier: 'free', reason: 'subscription-expired' };
  return { tier: 'free', reason: 'never-signed-in' };
}

export function useEntitlement(data: AppData): Entitlement {
  return useMemo(() => {
    const license = data.settings.license;
    const now = Date.now();
    const { tier, reason } = resolveTier(license, now);
    const isPro = tier === 'pro';
    const limits = isPro ? PRO_LIMITS : FREE_LIMITS;

    const trialActive = !!(license?.status === 'trial' && (license.trialEndsAt ?? 0) > now);
    const trialEndsAt = license?.trialEndsAt;
    const trialDaysLeft = trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)))
      : undefined;

    return {
      tier,
      isPro,
      trialActive,
      trialEndsAt,
      trialDaysLeft,
      periodEndsAt: license?.periodEndsAt,
      limits: { ...limits },
      notProReason: reason,
      raw: license,
      canAddCard:          (n) => n < limits.totalCards,
      canAddSpace:         (n) => n < limits.spaces,
      canAddNode:          (n) => n < limits.nodes,
      canAddDeck:          (n) => n < limits.decks,
      canAddFloatingBadge: (n) => n < limits.floatingBadges,
      // Preset 1 is always free; 2/3 need pro tier.
      canUsePreset: (id) => id === '1' ? true : isPro,
      canUseContainer: () => limits.containerEnabled,
    };
  }, [data.settings.license]);
}

/**
 * Helper — compute the *first-time* trial stamp for a brand-new license
 * record. Called by store helpers the first time a user hits a Pro gate
 * (so trials never "auto-start" just by opening the app).
 */
export function newTrialLicense(): License {
  const now = Date.now();
  return {
    tier: 'free',
    status: 'trial',
    trialStartedAt: now,
    trialEndsAt: now + TRIAL_DURATION_MS,
  };
}
