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

export const FREE_LIMITS = { members: 2, jobs: 2 } as const;

export type QuotaKind = 'members' | 'jobs';
export type QuotaResult =
  | { ok: true }
  | { ok: false; kind: QuotaKind; limit: number; current: number };

/** Active jobs (excludes the Inbox sentinel and archived projects — archiving frees a slot). */
export async function jobCount(db: AbstractPowerSyncDatabase): Promise<number> {
  const ps = await listProjects(db, 'active');
  return ps.filter((p) => p.id !== INBOX_ID).length;
}

export async function checkJobs(db: AbstractPowerSyncDatabase): Promise<QuotaResult> {
  const n = await jobCount(db);
  return n >= FREE_LIMITS.jobs
    ? { ok: false, kind: 'jobs', limit: FREE_LIMITS.jobs, current: n } : { ok: true };
}

/**
 * Active members of a company (owner included). This is the CLIENT-SIDE UX check —
 * it counts what the device can see (company_member is synced; company_invite is NOT,
 * so pending invites are invisible here). It stops the common case (an owner already
 * at the cap tapping Invite) but CANNOT stop the real bypass — several outstanding
 * invites each accepted on their own device. That is why the actual wall lives in the
 * accept-invite RPC (sql/381), which re-counts at the only device-independent moment:
 * when a membership is actually minted.
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
  const n = await memberCount(db, companyId);
  return n >= FREE_LIMITS.members
    ? { ok: false, kind: 'members', limit: FREE_LIMITS.members, current: n } : { ok: true };
}
