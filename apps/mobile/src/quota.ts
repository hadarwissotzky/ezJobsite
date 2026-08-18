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
// The one predicate for "which meter applies". Pure and separately tested — the rule it
// encodes (paying anything retires the trial caps) is the reason this file no longer
// refuses a customer who has bought credits.
import { meterFor, trialCapsApply } from './entitlement.ts';
import { purchasedEver } from './credits.ts';
import { listProjects, INBOX_ID } from './projects.ts';
import { planLimits, asPlanId, type PlanId } from './plans.ts';

export type QuotaKind = 'members' | 'jobs' | 'changeOrders' | 'photos' | 'recordingMinutes';
export type QuotaResult =
  | { ok: true }
  | { ok: false; kind: QuotaKind; limit: number; current: number };

const PLAN_RANK: Record<PlanId, number> = { free: 0, core: 1, crew: 2 };

/**
 * The plan that governs this user (382). The owner pays; crew inherit it. A device can
 * hold MORE THAN ONE company row (the cross-company Crew tier syncs every company the
 * user is an active member of), so we return the BEST plan among them rather than an
 * arbitrary one (review 2026-07-26 — the old unscoped `LIMIT 1` was non-deterministic
 * and could cap a paying user or uncap a free one). Best-plan-wins is deterministic
 * and user-favourable: a member of any paid company gets the paid experience, which is
 * exactly "crew inherit the plan". Solo/no-company reads 'free'.
 */
export const ENTITLED_KEY = 'entitled_plan';
/** The exact product behind the entitlement, so the paywall can tell monthly from
 *  annual. Cached beside the plan and for the same reason: `company` may be empty. */
export const ENTITLED_PRODUCT_KEY = 'entitled_product';

export async function currentPlan(db: AbstractPowerSyncDatabase): Promise<PlanId> {
  let best: PlanId = 'free';
  try {
    const rows = await db.getAll<{ plan: string | null }>(`SELECT plan FROM company`);
    for (const r of rows) {
      const p = asPlanId(r.plan);
      if (PLAN_RANK[p] > PLAN_RANK[best]) best = p;
    }
  } catch { /* pre-migration schema / not synced yet → the entitlement below decides */ }

  /**
   * THE VALIDATED ENTITLEMENT, when the server's copy has not arrived.
   *
   * hadar, 2026-08-13: bought Core, got "You're all set", and the drawer still said
   * Free. `company.plan` is written by the RevenueCat webhook and reaches the device
   * through PowerSync — and on that device the `company` table is empty, so the column
   * this function reads does not exist locally at all. A man who has just paid was
   * being told he had not.
   *
   * WHAT THIS IS NOT: the client asserting it is paid. The value is written only from
   * `Purchases.getCustomerInfo()` — RevenueCat's own answer after IT validated the
   * receipt with Apple — so it is a cached server verdict, not a local claim.
   * `company.plan` remains the durable record and the thing the backend trusts.
   *
   * RAISES ONLY. A stale entitlement can never DOWNGRADE somebody below what the server
   * says they have; the worst it can do is keep a lapsed subscriber at their old tier
   * until the next successful read, which is the correct way to be wrong about somebody
   * who has been paying.
   */
  try {
    const r = (await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [ENTITLED_KEY]))[0];
    const p = asPlanId(r?.v ?? null);
    if (PLAN_RANK[p] > PLAN_RANK[best]) best = p;
  } catch { /* no settings table → server value stands */ }
  return best;
}

/** The cached product id behind the entitlement, or null. Never throws. */
export async function currentProductId(
  db: AbstractPowerSyncDatabase
): Promise<string | null> {
  try {
    const r = (await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [ENTITLED_PRODUCT_KEY]))[0];
    return r?.v ?? null;
  } catch { return null; }
}

/** Cache which product is active. Cleared with an empty string when nothing is. */
export async function rememberEntitledProduct(
  db: AbstractPowerSyncDatabase, productId: string | null
): Promise<void> {
  await db.execute(
    `INSERT INTO device_settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    [ENTITLED_PRODUCT_KEY, productId ?? '']);
}

/** Cache RevenueCat's verdict. Called after a purchase, a restore, and on launch. */
export async function rememberEntitledPlan(
  db: AbstractPowerSyncDatabase, plan: PlanId
): Promise<void> {
  await db.execute(
    `INSERT INTO device_settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`, [ENTITLED_KEY, plan]);
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
 * Active members of a company, OWNER INCLUDED.
 *
 * LIVE AS OF 2026-08-04. This gate used to be dormant (members was Infinity, "crew are
 * free"); hadar set free to 1 — "limited to only 1 team member per company" — and the
 * seam did exactly what it promised: a number changed in plans.ts and the invite flow
 * started blocking with no new code here.
 *
 * The owner counts toward the limit, so free = owner alone and the FIRST invite is
 * refused, not the second.
 *
 * CLIENT-SIDE ONLY. The matching server cap noted in sql/382 was never re-added, so
 * this is the friendly modal and not the wall — a second device racing the count, or a
 * direct RPC call, still gets through. Named here so nobody mistakes it for enforcement.
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
  const limit = planLimits(await currentPlan(db)).members;  // 1 on free, Infinity on paid
  const n = await memberCount(db, companyId);
  return n >= limit ? { ok: false, kind: 'members', limit, current: n } : { ok: true };
}

// ── free-tier usage caps (hadar 2026-08-04) ────────────────────────────────────
//
// "2 change orders, 30 images (total) and 30 (min) total recording — once you have
// gone past that limit we need to prompt the user to subscribe."
//
// TOTALS, NOT PER JOB. `decisionsPerJob` above is a different, older cap; these three
// count across everything the company has ever made, which is what makes the free tier
// a trial rather than a small-but-permanent product.
//
// WHERE THESE GATES BELONG — and it is not the capture button. Mandate #1 says a
// capture is never blocked and never lost; a free user who has run out of quota
// standing in front of a finished job must still be able to record what happened.
// So these gate the ACT OF SENDING a change order, not the act of capturing. The
// evidence is always safe; what is gated is the paid outcome.
//
// THE RECORDING CAP IS A SAFETY RAIL, NOT A PAYWALL (hadar 2026-08-04: "for safety to
// limit the recording, so a user will not record for hours on end"). It sits on top of
// the per-SESSION cap already in capturesession.ts (10 minutes, warning at 9). That one
// stops a single runaway recording; this one stops an account accumulating hours of
// audio nobody will ever listen to. Different job, same gentleness: it is a prompt,
// never a refusal to capture.
//
// DISCARDED CAPTURES DO NOT COUNT. `capture_commit` is append-only, so a discarded
// photo's row survives forever — but its bytes are gone and the user got no value
// from it, so charging quota for it would be charging for nothing. The gallery
// already excludes them (capture.ts) and this matches.

/**
 * Change orders that have actually been SENT (hadar 2026-08-04: "limit the account to
 * 2 sent change orders"). Drafts are free and unlimited — a contractor can build up as
 * much work as they like; the meter only runs when something leaves the phone and
 * reaches a client, which is the moment the product delivered its value.
 *
 * SUPERSEDED VERSIONS DO NOT COUNT, and this is the fairness decision in the query.
 * Revising a sent extra freezes v1 as `superseded` and sends v2 (SPEC-extra-lifecycle
 * D2). Counting both would mean fixing a typo costs a second of two free slots — the
 * user would experience their allowance vanishing for one change order. So we count
 * the live and terminal versions only: sent · approved · declined.
 */
export async function sentChangeOrderCount(db: AbstractPowerSyncDatabase): Promise<number> {
  try {
    const r = await db.getAll<{ n: number }>(
      `SELECT COUNT(*) AS n FROM change_order
        WHERE status IN ('sent','approved','declined')`);
    return r[0]?.n ?? 0;
  } catch {
    return 0;   // table not created yet -> nothing sent
  }
}

export async function checkChangeOrders(db: AbstractPowerSyncDatabase): Promise<QuotaResult> {
  const limit = planLimits(await currentPlan(db)).changeOrders;
  if (!Number.isFinite(limit)) return { ok: true };
  const n = await sentChangeOrderCount(db);
  return n >= limit ? { ok: false, kind: 'changeOrders', limit, current: n } : { ok: true };
}

/** Photos committed, across every job, ever. Excludes discarded (bytes are gone). */
export async function photoCount(db: AbstractPowerSyncDatabase): Promise<number> {
  try {
    const r = await db.getAll<{ n: number }>(
      `SELECT COUNT(*) AS n FROM capture_commit c
        WHERE (c.modality = 'photo' OR c.media_mime_type LIKE 'image/%')
          AND c.capture_id NOT IN (SELECT capture_id FROM capture_discarded)`);
    return r[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function checkPhotos(db: AbstractPowerSyncDatabase): Promise<QuotaResult> {
  const limit = planLimits(await currentPlan(db)).photos;
  if (!Number.isFinite(limit)) return { ok: true };
  const n = await photoCount(db);
  return n >= limit ? { ok: false, kind: 'photos', limit, current: n } : { ok: true };
}

/**
 * Recording quota, measured in BYTES because minutes are not stored.
 *
 * WHY BYTES (hadar 2026-08-04: "we can restrict the upload size of the file"). Audio
 * duration is never persisted: `capture_draft_item` holds it and is deleted at commit
 * (capturedraft.ts), `stt_outbox` is a drain queue, and `capture_commit` — the one
 * durable record — stores `media_bytes` and no duration. Rather than thread a new
 * column through the append-only evidence path for a quota, we count the bytes that
 * are already there.
 *
 * THE CONVERSION, and why it is deliberately generous. The recorder is expo-audio's
 * HIGH_QUALITY preset: 128 kbps AAC = 16,000 bytes/sec nominal. Measured against real
 * recordings from the field device, sustained voice actually lands at ~13,000-14,000
 * bytes/sec (AAC is variable-rate and speech compresses well). Budgeting at the
 * NOMINAL 16,000 therefore buys roughly 35 real minutes for a promised 30.
 *
 * That asymmetry is the point: this cap can stop someone from sending a change order,
 * so every rounding decision runs in the user's favour. "30 minutes" is a floor we
 * are confident of, not a ceiling we enforce to the second. Short clips carry heavy
 * container overhead (a 1.4s file measured 53 kB/s, almost all header), and a stingier
 * constant would punish exactly the quick-note habit the product is trying to build.
 */
const AUDIO_BYTES_PER_MINUTE = 16_000 * 60;   // 960 kB/min at the preset's nominal rate

/** Bytes of committed voice audio, across every job. Excludes discarded captures. */
export async function recordingBytesUsed(db: AbstractPowerSyncDatabase): Promise<number> {
  try {
    const r = await db.getAll<{ n: number | null }>(
      `SELECT SUM(c.media_bytes) AS n FROM capture_commit c
        WHERE (c.modality = 'voice' OR c.media_mime_type LIKE 'audio/%')
          AND c.capture_id NOT IN (SELECT capture_id FROM capture_discarded)`);
    return r[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Minutes used, rounded DOWN — never bill a user for a partial minute. */
export async function recordingMinutesUsed(db: AbstractPowerSyncDatabase): Promise<number> {
  return Math.floor((await recordingBytesUsed(db)) / AUDIO_BYTES_PER_MINUTE);
}

export async function checkRecording(db: AbstractPowerSyncDatabase): Promise<QuotaResult> {
  const limit = planLimits(await currentPlan(db)).recordingMinutes;
  if (!Number.isFinite(limit)) return { ok: true };
  const used = await recordingMinutesUsed(db);
  return used >= limit
    ? { ok: false, kind: 'recordingMinutes', limit, current: used }
    : { ok: true };
}

/** The byte budget a plan's minute allowance corresponds to. Exported for tests/UI. */
export function recordingByteBudget(minutes: number): number {
  return Number.isFinite(minutes) ? minutes * AUDIO_BYTES_PER_MINUTE : Infinity;
}

/**
 * Every cap that stands between a free account and SENDING a change order, checked in
 * one call and reported as the first thing to hit.
 *
 * WHY ALL THREE GATE THE SAME ACT (hadar 2026-08-04, resolving a question flagged
 * twice). The obvious home for a photo cap is the shutter and for a recording cap the
 * record button — and both are wrong here. Mandate #1 permits refusing to START when
 * capacity cannot be reserved, so a hard block would not strictly violate it; but this
 * product's entire promise is that a contractor standing in front of a finished job
 * can get it down before it slips. An app that refuses the photo is an app that let
 * the evidence evaporate, whatever the quota said.
 *
 * So capture is ALWAYS free and always safe, and the meter is read at the one moment
 * the product delivers its paid value: something leaving the phone for a client. The
 * evidence is already committed by then; what is withheld is the outcome.
 *
 * ORDER MATTERS. Change orders first because it is the cap the user actually
 * understands ("2 free change orders"); photos and minutes are consequences of working,
 * not choices they made, and leading with those reads as punishment for using the app.
 */
export async function checkSendQuota(db: AbstractPowerSyncDatabase): Promise<QuotaResult> {
  /**
   * WHICH METER APPLIES (hadar, 2026-08-18). Before this, ALL THREE caps ran against
   * every account, and the change-order one duplicated a count the server already keeps
   * against the credit balance. A contractor who bought twenty credits would have been
   * refused here and told his free plan includes two.
   *
   *   'unlimited' — a subscription. Every limit is already Infinity, so this is a fast
   *                 path rather than a behaviour change.
   *   'credits'   — he has paid. The BALANCE is the meter and it is the server's to
   *                 enforce at reservation time; the trial's photo and recording caps
   *                 retire with it, because a pack he cannot attach photographs to is a
   *                 quantity he cannot spend.
   *   'free'      — the trial. Unchanged, except that the change-order cap is no longer
   *                 counted here: `free_allowance` in `pricing_config` is the same
   *                 number, the server enforces it, and one act must have one meter.
   */
  const meter = meterFor({
    plan: await currentPlan(db),
    purchasedEver: await purchasedEver(db),
  });
  if (meter === 'unlimited') return { ok: true };
  if (!trialCapsApply(meter)) return { ok: true };

  // `checkChangeOrders` is deliberately NOT in this list — see localChangeOrderCapApplies.
  // It is still exported and still used by the usage line, which reports where someone
  // stands rather than refusing them.
  for (const check of [checkPhotos, checkRecording]) {
    const r = await check(db);
    if (!r.ok) return r;
  }
  return { ok: true };
}
