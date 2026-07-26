/**
 * Free-tier quota — the pilot's "free version": a company gets the basics, capped.
 * (hadar 2026-07-25: up to 2 members, 2 jobs, 2 extras per job.)
 *
 * ONE TIER TODAY. There is no billing yet — the Settings → Subscription card routes
 * an upgrade to a contact email. So these caps apply to everyone. When a paid plan
 * ships, gate on the company's plan (an isFreeTier(company) seam) and the caps lift;
 * nothing else here changes.
 *
 * ENFORCEMENT IS CLIENT-SIDE and advisory-with-a-wall: every "add" action checks the
 * count and shows a modal instead of creating the N+1th. It is NOT a security
 * boundary — a determined client could bypass it — which is acceptable for a free
 * tier with no adversarial incentive. The server-side gate (an RLS/trigger keyed on
 * company.plan) is the follow-up once billing and a plan column exist. Counts read
 * the locally-synced tables, which see the whole company once PowerSync has synced.
 *
 * MANDATE #1 stays intact: no cap here gates a capture — a blocked action leaves
 * every captured byte committed and safe.
 *
 * SCOPE (hadar 2026-07-25): members and jobs ship now. The extras-per-job cap is
 * DEFERRED — enforcing it correctly means gating the capture→extra PROMOTION (which
 * is created eagerly on a guessed project and re-hydrated from the server), so a
 * clean client-only gate is not possible without dead-ending the assign sheet or
 * mis-counting. It wants the promotion reworked or server enforcement; see the
 * 2026-07-25 review note in docs/AUTONOMOUS-BUILD-LOG.md.
 *
 * These caps are ALSO enforced server-side where a clean seam exists (members: the
 * accept-invite RPC, sql/381). The client checks are the friendly modal; the server
 * check is the wall a second device or a pre-sync count can't walk through.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { listProjects, INBOX_ID } from './projects.ts';
import { planLimits, asPlanId, type PlanId } from './plans.ts';

export type QuotaKind = 'members' | 'jobs';
export type QuotaResult =
  | { ok: true }
  | { ok: false; kind: QuotaKind; limit: number; current: number };

const PLAN_RANK: Record<PlanId, number> = { free: 0, core: 1, crew: 2, enterprise: 3 };

/**
 * The plan that governs this user (382). The owner pays; crew inherit it. A device can
 * hold MORE THAN ONE company row (the cross-company Crew tier syncs every company the
 * user is an active member of), so we return the BEST plan among them rather than an
 * arbitrary one (review 2026-07-26 — the old unscoped `LIMIT 1` was non-deterministic
 * and could cap a paying user or uncap a free one). Best-plan-wins is deterministic
 * and user-favourable: a member of any paid company gets the paid experience, which is
 * exactly "crew inherit the plan". Solo/no-company reads 'free'.
 */
export async function currentPlan(db: AbstractPowerSyncDatabase): Promise<PlanId> {
  try {
    const rows = await db.getAll<{ plan: string | null }>(`SELECT plan FROM company`);
    let best: PlanId = 'free';
    for (const r of rows) {
      const p = asPlanId(r.plan);
      if (PLAN_RANK[p] > PLAN_RANK[best]) best = p;
    }
    return best;
  } catch {
    return 'free';  // pre-migration schema / not synced yet → treat as free
  }
}

/** Active jobs (excludes the Inbox sentinel and archived projects — archiving frees a slot). */
export async function jobCount(db: AbstractPowerSyncDatabase): Promise<number> {
  const ps = await listProjects(db, 'active');
  return ps.filter((p) => p.id !== INBOX_ID).length;
}

export async function checkJobs(db: AbstractPowerSyncDatabase): Promise<QuotaResult> {
  const limit = planLimits(await currentPlan(db)).jobs;   // Infinity on paid → never blocks
  const n = await jobCount(db);
  return n >= limit ? { ok: false, kind: 'jobs', limit, current: n } : { ok: true };
}

/**
 * Active members of a company (owner included). Crew are FREE today, so the members
 * limit is Infinity and this gate never fires — but the SEAM is intact: set
 * planLimits().members to a number (and re-add the server cap noted in sql/382) and
 * the invite flow starts blocking, no new code. "Field crew may not be free moving
 * forward" (hadar 2026-07-26).
 */
export async function memberCount(
  db: AbstractPowerSyncDatabase, companyId: string,
): Promise<number> {
  const rows = await db.getAll<{ n: number }>(
    `SELECT count(*) AS n FROM company_member WHERE company_id = ? AND status = 'active'`,
    [companyId]);
  return rows[0]?.n ?? 0;
}

export async function checkMembers(
  db: AbstractPowerSyncDatabase, companyId: string,
): Promise<QuotaResult> {
  const limit = planLimits(await currentPlan(db)).members;  // Infinity today → never blocks
  const n = await memberCount(db, companyId);
  return n >= limit ? { ok: false, kind: 'members', limit, current: n } : { ok: true };
}
