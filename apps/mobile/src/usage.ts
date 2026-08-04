/**
 * What this account has used, and how close it is to the ceiling (hadar 2026-08-04:
 * "communicate to the user about the subscription, their correct subscription state
 * and when to upgrade, through multiple points of upgrade").
 *
 * ONE DERIVATION, MANY SURFACES. The drawer, the paywall, the pre-emptive nudge and
 * the blocked-action modal all describe the same four numbers. Computing them in four
 * places is how a drawer says "1 left" while the modal says "you're out" — so they all
 * read `usageSummary()` and nothing re-counts.
 *
 * IT IS NOT A SECOND AUTHORITY. quota.ts still owns the yes/no decisions; this owns
 * only the *reporting*. Both read the same counters, so they cannot disagree about
 * whether a limit is reached — but only quota.ts is allowed to block anything.
 *
 * PAID PLANS ARE NOT AUTOMATICALLY UNMETERED. Core caps seats at 3, so a paying user
 * still has a finite limit worth showing. Anything with a finite limit is reported,
 * whatever the tier; only Infinity is silent. Treating "paid" as "nothing to say"
 * would hide a Core owner's seat usage until the moment their fourth hire is refused.
 *
 * TONE. This module returns numbers and a severity, never sentences — the words live
 * in i18n so they can be Spanish. `severity` is what the UI colours on, and it is
 * deliberately only three values: nobody needs a progress bar to understand "2 left".
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { planLimits, asPlanId, type PlanId } from './plans.ts';
import {
  currentPlan, jobCount, memberCount,
  photoCount, recordingMinutesUsed, sentChangeOrderCount,
} from './quota.ts';
import type { QuotaKind } from './quota.ts';

/**
 * How loudly to speak about a limit.
 *   ok       — plenty of room; say nothing unprompted.
 *   nearing  — one or two actions from the wall; this is the moment a nudge converts,
 *              because the user still has a choice rather than an interruption.
 *   reached  — the next action of this kind will be refused.
 */
export type UsageSeverity = 'ok' | 'nearing' | 'reached';

export type UsageItem = {
  kind: QuotaKind;
  used: number;
  /** Infinity when unmetered on this plan. */
  limit: number;
  /** limit - used, never negative. Infinity when unmetered. */
  remaining: number;
  severity: UsageSeverity;
};

export type UsageSummary = {
  plan: PlanId;
  /** Only the METERED kinds — anything unlimited is omitted, not listed as infinite. */
  items: UsageItem[];
  /** The most urgent item, or null when everything is comfortable. Drives the nudge. */
  worst: UsageItem | null;
  /** True when any limit is already reached. */
  anyReached: boolean;
};

/**
 * When to start nudging. Two rules, because a single percentage misbehaves at both
 * ends of this product's range:
 *   - 80% works for 30 photos (nudge at 24) but is useless for 2 change orders, where
 *     80% is 1.6 and would only fire at 2 — the moment it is already too late.
 *   - "1 remaining" works for small caps and fires far too late for large ones.
 * Either condition triggers, so both sizes nudge while the user still has room.
 */
const NEAR_RATIO = 0.8;

export function severityFor(used: number, limit: number): UsageSeverity {
  if (!Number.isFinite(limit)) return 'ok';
  if (used >= limit) return 'reached';
  if (limit - used <= 1) return 'nearing';
  if (limit > 0 && used / limit >= NEAR_RATIO) return 'nearing';
  return 'ok';
}

function item(kind: QuotaKind, used: number, limit: number): UsageItem {
  const remaining = Number.isFinite(limit) ? Math.max(0, limit - used) : Infinity;
  return { kind, used, limit, remaining, severity: severityFor(used, limit) };
}

const RANK: Record<UsageSeverity, number> = { ok: 0, nearing: 1, reached: 2 };

/**
 * Everything metered on this account, in the order the user should care about.
 *
 * `companyId` is optional because seats are per-company and the caller does not always
 * have one (solo, pre-sync). Omitting it drops the members row rather than guessing a
 * count — a wrong seat number on a paid plan is worse than no seat number.
 */
export async function usageSummary(
  db: AbstractPowerSyncDatabase, companyId?: string | null,
): Promise<UsageSummary> {
  const plan = await currentPlan(db);
  const lim = planLimits(plan);

  const items: UsageItem[] = [];
  const push = async (kind: QuotaKind, count: () => Promise<number>, limit: number) => {
    if (!Number.isFinite(limit)) return;          // unmetered → nothing to say
    try {
      items.push(item(kind, await count(), limit));
    } catch {
      // A counter that cannot read is not evidence of usage. Skipping keeps the UI
      // honest — better to omit a row than to tell someone they have used 0 of 2
      // when we simply could not look.
    }
  };

  await push('changeOrders', () => sentChangeOrderCount(db), lim.changeOrders);
  await push('photos', () => photoCount(db), lim.photos);
  await push('recordingMinutes', () => recordingMinutesUsed(db), lim.recordingMinutes);
  await push('jobs', () => jobCount(db), lim.jobs);
  if (companyId) await push('members', () => memberCount(db, companyId), lim.members);

  let worst: UsageItem | null = null;
  for (const it of items) {
    if (it.severity === 'ok') continue;
    if (!worst || RANK[it.severity] > RANK[worst.severity]
        || (RANK[it.severity] === RANK[worst.severity] && it.remaining < worst.remaining)) {
      worst = it;
    }
  }

  return { plan, items, worst, anyReached: items.some((i) => i.severity === 'reached') };
}

/** True when this plan meters anything at all — i.e. there is a reason to show usage. */
export function isMetered(plan: string | null | undefined): boolean {
  const l = planLimits(asPlanId(plan));
  return [l.changeOrders, l.photos, l.recordingMinutes, l.jobs, l.members]
    .some((v) => Number.isFinite(v));
}
