/**
 * "Take a look at this" — asking a teammate to review a DRAFT extra.
 *
 * The client half of `sql/407_review_request.sql`. The server is where the rules live
 * (you must own the extra; every recipient must be an active member of a company you
 * also belong to); this is the call and the honest reporting of what came back.
 *
 * WHAT THIS IS NOT: a send. It mints no signing link and changes no status — see 407's
 * header for why that is the requirement rather than an omission. If this succeeds, the
 * extra is still a draft and still yours to finish.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReviewResult =
  | { ok: true; notified: number }
  | { ok: false; reason: string };

export async function requestExtraReview(
  supabase: SupabaseClient, changeOrderId: string, userIds: readonly string[]
): Promise<ReviewResult> {
  // Nobody to ask is not a failure and not a round trip.
  if (!userIds.length) return { ok: true, notified: 0 };
  const { data, error } = await supabase.rpc('request_extra_review', {
    p_change_order_id: changeOrderId,
    p_user_ids: userIds,
  });
  if (error) return { ok: false, reason: error.message };
  /**
   * THE COUNT IS REPORTED, NOT ASSUMED.
   *
   * 407 skips a recipient who has left the company or was never in it, rather than
   * failing the whole call — so asking four people can legitimately notify three. The
   * caller shows this number instead of saying "asked your team", because "asked 3
   * people" and "asked nobody" must not read the same on a screen where the difference
   * is whether anyone is actually going to look at it.
   */
  const n = Number((data as { notified?: number } | null)?.notified ?? 0);
  return { ok: true, notified: n };
}
