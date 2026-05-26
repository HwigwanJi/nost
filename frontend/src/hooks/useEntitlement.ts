import { useMemo } from 'react';
import type { AppData, License, LicenseTier } from '../types';
import { FREE_LIMITS, LICENSE_GRACE_DAYS, TRIAL_DURATION_MS } from '../types';
import { useAuth } from '../lib/auth';

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
    widgets: number;
    presets: number;
    containerEnabled: boolean;
    memoMarkdownEditor: boolean;
    memoMarkdownCleanup: boolean;
    memoMdExport: boolean;
    memoFolderSync: boolean;
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
  canAddWidget:        (currentCount: number) => boolean;
  canUsePreset:        (presetId: '1' | '2' | '3') => boolean;
  canUseContainer:     () => boolean;
  /** Memo Pro features. UI surfaces a lock indicator + opens paywall when false. */
  canUseMemoMarkdownEditor: () => boolean;
  /** Cleanup palette (markdownify / format / bullets / compact / plain).
   *  Currently Free — text-transform tools work standalone. */
  canUseMemoMarkdownCleanup: () => boolean;
  canUseMemoMdExport:       () => boolean;
  canUseMemoFolderSync:     () => boolean;
}

const PRO_LIMITS = {
  totalCards: Infinity,
  spaces: Infinity,
  nodes: Infinity,
  decks: Infinity,
  floatingBadges: Infinity,
  widgets: Infinity,
  presets: 3,
  containerEnabled: true,
  memoMarkdownEditor: true,
  memoMarkdownCleanup: true,
  memoMdExport: true,
  memoFolderSync: true,
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

/**
 * BETA OVERRIDE — when true, every user is treated as Pro regardless of
 * license state. Used during early beta when billing wasn't ready yet.
 *
 * Flipped OFF (2026-05-15) once the founder confirmed Free/Pro policy:
 *   - Free: presets 1, spaces 4/preset, cards 16/preset, nodes 1, decks 1
 *   - Pro:  unlimited everything + container slots + memo markdown stack
 *           + cloud sync (server-gated)
 *
 * Real Pro entitlement now flows through useLicenseSync ← server verify.
 * Keep this constant so a future emergency rollback (e.g. payment outage)
 * can be a one-line flip back to true.
 */
const BETA_FORCE_PRO = false;

/**
 * v1.3.48 — Admin / founder allowlist. These accounts get Pro
 * unconditionally regardless of license state. Used while billing infra
 * isn't yet shipped (Stripe / Toss webhook → license server). Once the
 * real payment flow lands this list can stay as a "permanent comp" for
 * the founders / staff accounts.
 *
 * Email match is exact + case-insensitive. Anonymous / signed-out users
 * never hit this branch (no email to match).
 */
const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  'gwansol56@gmail.com',
]);

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase());
}

export function useEntitlement(data: AppData): Entitlement {
  // useAuth() is a lightweight external-store subscribe — pulling the
  // signed-in email here means every entitlement consumer auto-refreshes
  // when the user signs in / out without threading auth state through
  // the call chain.
  const auth = useAuth();
  const adminPro = isAdminEmail(auth.user?.email ?? null);
  return useMemo(() => {
    const license = data.settings.license;
    const now = Date.now();
    const resolved = resolveTier(license, now);
    // Tier resolution order (highest precedence first):
    //   1. BETA_FORCE_PRO emergency rollback (global)
    //   2. Admin allowlist (per-email)
    //   3. License-derived tier (server-verified or local trial)
    const tier   = BETA_FORCE_PRO ? 'pro' : (adminPro ? 'pro' : resolved.tier);
    const reason = BETA_FORCE_PRO ? '' : (adminPro ? '' : resolved.reason);
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
      canAddWidget:        (n) => n < limits.widgets,
      // Preset N is free iff N <= limits.presets. Free = 2 → '1' and '2'
      // accessible; '3' blocked. Pro = 3 → all accessible. Generalised
      // (was hardcoded to id==='1') so flipping FREE_LIMITS.presets is
      // a one-place change.
      canUsePreset: (id) => Number(id) <= limits.presets,
      canUseContainer: () => limits.containerEnabled,
      canUseMemoMarkdownEditor:  () => limits.memoMarkdownEditor,
      canUseMemoMarkdownCleanup: () => limits.memoMarkdownCleanup,
      canUseMemoMdExport:        () => limits.memoMdExport,
      canUseMemoFolderSync:      () => limits.memoFolderSync,
    };
  }, [data.settings.license, adminPro]);
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
