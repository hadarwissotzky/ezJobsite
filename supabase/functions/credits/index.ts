// credits — reserve, release, and read the balance for one company.
//
// hadar's model (2026-08-17): free → packs (pay per signed change order) →
// subscription (unlimited). A credit is consumed WHEN THE HOMEOWNER SIGNS — not on
// capture, not on send — because charging at the moment of capture is what pushes a
// contractor back to the verbal handshake this product exists to replace.
//
// ─── WHAT LIVES WHERE, AND WHY IT IS NOT ALL IN ONE PLACE ───────────────────────
//   RevenueCat  owns the BALANCE. It is the store of record for what was bought.
//   Postgres    owns RESERVATIONS. "Sent, awaiting signature" is domain state that
//               RevenueCat has no concept of.
//   available_to_send = rc_balance − count(open reservations)
//
// The balance is never mirrored here as a mutable counter. Two sources of truth for a
// number diverge exactly when a contractor is disputing a charge, which is the one
// moment the number has to be defensible.
//
// ─── THE SPEND IS NOT HERE ──────────────────────────────────────────────────────
// This function never deducts. The deduction happens in the worker, draining
// `credit_spend_outbox`, because a signature must never wait on a billing call
// (R-5.3): a failed spend is recoverable, a failed signature is a lost change order
// and a lost customer. The settle trigger appends to that outbox in the same
// transaction as the signature, so the intent to charge is as durable as the
// signature itself.
//
// ─── ACTIONS ───────────────────────────────────────────────────────────────────
//   { action: 'balance' }                        → what this company can send
//   { action: 'reserve', changeOrderId }         → hold one credit for a send
//   { action: 'release', changeOrderId, reason } → give it back (declined/cancelled)
//
// The CLIENT NEVER SPENDS, GRANTS OR ADJUSTS. RevenueCat's own guidance, and the
// obvious reason: a client that can write a balance is a client that can mint one.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const RC_API = 'https://api.revenuecat.com/v2';

/**
 * The customer's credit balance, straight from RevenueCat.
 *
 * ─── 200 IS AUTHORITATIVE, EVEN WHEN IT IS EMPTY ────────────────────────────────
 * VERIFIED against the live API (2026-08-18), not inferred from the docs' example: a
 * customer who has never bought anything returns
 *
 *     200 {"items":[],"next_page":null,"object":"list", ...include_empty_balances=False}
 *
 * — a successful read of a real state, which is ZERO. The first draft of this function
 * returned `null` for that, and null means "unknown", and `reserve` deliberately lets an
 * unknown balance through rather than hard-blocking a contractor on a number it failed
 * to read. Put together, a customer with no credits would have been able to send
 * FOREVER. That is a money bug, and it only surfaced because the shape was probed
 * instead of assumed.
 *
 * So: an HTTP 200 is an answer. A missing CREDIT entry inside a 200 means the customer
 * holds none — the endpoint omits empty balances by default, which is exactly why
 * absence must not be read as ignorance.
 *
 * NULL IS RESERVED FOR GENUINE IGNORANCE: a non-2xx, a transport failure, or a body
 * that does not parse. Those are the only cases where we do not know, and they are the
 * only cases where the caller is entitled to proceed anyway.
 */
async function rcBalance(projectId: string, customerId: string, key: string): Promise<number | null> {
  try {
    const r = await fetch(
      `${RC_API}/projects/${projectId}/customers/${encodeURIComponent(customerId)}` +
      `/virtual_currencies?include_empty_balances=true`,
      { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    // A 404 is a customer RevenueCat has never seen — which is zero purchased credits,
    // not an unreadable balance. Anything else non-2xx is genuinely unknown.
    if (r.status === 404) return 0;
    if (!r.ok) return null;
    const body = await r.json();
    const items = (body?.items ?? []) as Array<Record<string, unknown>>;
    const credit = items.find((i) => (i.code ?? i.virtual_currency_code) === 'CREDIT');
    if (!credit) return 0;                       // read fine; this customer holds none
    const bal = credit.balance;
    return typeof bal === 'number' ? bal : 0;
  } catch {
    return null;                                  // transport failure — genuinely unknown
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const supaUrl = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rcKey = Deno.env.get('REVENUECAT_SECRET_KEY');
  const rcProject = Deno.env.get('REVENUECAT_PROJECT_ID') ?? 'proj960cec8c';
  if (!supaUrl || !anon || !service) {
    return json({ ok: false, error: 'server not configured' }, 500);
  }

  // 1. WHO IS ASKING. The caller's own JWT, not the service key — every answer below is
  //    scoped to a company this user is actually an active member of.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(supaUrl, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u, error: uErr } = await asUser.auth.getUser();
  if (uErr || !u?.user) return json({ ok: false, error: 'not authenticated' }, 401);

  let body: { action?: string; changeOrderId?: string; reason?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  const action = (body.action ?? '').trim();

  // The service client does the writing. RLS on these tables denies the client
  // everything but reading its own reservations, by design.
  const db = createClient(supaUrl, service);

  // 2. WHICH COMPANY. Derived from the caller's ACTIVE membership on the server — never
  //    taken from the request body, or one contractor could spend another's credits by
  //    naming his company id.
  const { data: mem } = await db
    .from('company_member')
    .select('company_id, company:company_id(id, owner_id)')
    .eq('user_id', u.user.id).eq('status', 'active').limit(1).maybeSingle();
  const companyId = (mem as { company_id?: string } | null)?.company_id;
  if (!companyId) return json({ ok: false, error: 'no company' }, 403);

  // 3. The plan decides whether credits apply at all. An unlimited subscription never
  //    consults a balance — `credits_per_month: null` in pricing_config means "does not
  //    meter", which is what Core and Crew are.
  const { data: co } = await db.from('company').select('plan').eq('id', companyId).maybeSingle();
  const plan = ((co as { plan?: string } | null)?.plan ?? 'free').toLowerCase();
  const metered = plan === 'free' || plan === 'packs';

  /**
   * OPEN reservations reduce what can still be sent — but ONLY THE PAID ONES.
   *
   * The two kinds are already accounted for differently, and counting them the same way
   * subtracts a free send twice:
   *   · a FREE reservation increments `free_allowance_used` the moment it is made, so it
   *     has already come out of `freeLeft`;
   *   · a PAID reservation changes nothing at RevenueCat until the signature spends it,
   *     so it is invisible in the balance and must be subtracted here.
   *
   * Found live, on the run that proved the previous fix: one free reservation left
   * `freeLeft: 1` and `available: 0`, which told a contractor with a free send in hand
   * that he had none. `is_free` is excluded for that reason.
   */
  const { count: openCount } = await db
    .from('credit_reservation')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('state', 'OPEN').eq('is_free', false);
  const open = openCount ?? 0;

  /**
   * FREE CREDITS USED = THE RESERVATIONS THAT PROVE IT. Not a counter.
   *
   * `company_billing.free_allowance_used` was the authority, and a counter that only
   * ever goes up is wrong for a credit that can come back: a free-tier user whose client
   * DECLINED lost the credit permanently, because `release` moves the reservation to
   * RELEASED and no counter anywhere hears about it. The model says a credit is consumed
   * when the homeowner SIGNS — a decline returns it, and that has to be true for the free
   * two as well as the paid ones.
   *
   * Deriving it removes the class of bug rather than the instance. There is nothing to
   * keep in step, a release restores the credit by definition, and the repair in 411
   * (which set the counter to `count(is_free)`) becomes the permanent rule instead of a
   * one-off fix. The column stays for now as a cache for the paywall to render offline;
   * nothing decides anything from it.
   */
  const { count: freeUsedCount } = await db
    .from('credit_reservation')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('is_free', true).neq('state', 'RELEASED');
  const freeUsed = freeUsedCount ?? 0;

  const { data: cfg } = await db
    .from('pricing_config').select('free_allowance').eq('id', 1).maybeSingle();
  const freeAllowance = (cfg as { free_allowance?: number } | null)?.free_allowance ?? 2;
  const freeLeft = Math.max(0, freeAllowance - freeUsed);

  if (action === 'balance') {
    const purchased = metered && rcKey
      ? await rcBalance(rcProject, companyId, rcKey) : null;
    return json({
      ok: true, metered, plan,
      freeLeft,
      // null = unknown, and the client is expected to say so rather than render 0.
      purchased,
      open,
      available: metered ? freeLeft + (purchased ?? 0) - open : null,
    });
  }

  if (action === 'reserve') {
    const coId = (body.changeOrderId ?? '').trim();
    if (!coId) return json({ ok: false, error: 'changeOrderId required' }, 400);

    // An unlimited plan reserves nothing. There is no balance to protect, and an
    // unnecessary row is a row that can leak and block a later send.
    if (!metered) return json({ ok: true, reserved: false, reason: 'unlimited' });

    /**
     * ONE PATH FOR FREE AND PAID, AND THE INSERT COMES FIRST.
     *
     * The first cut checked the free allowance BEFORE reserving, decremented a counter,
     * and returned without creating a row. That kept the free tier out of the money path
     * — and threw away the only thing making double-counting impossible. Reserving the
     * same change order twice took two free credits (verified against the live database;
     * see 411). A revise-and-resend would have eaten a free user's whole allowance on
     * one piece of work.
     *
     * So the reservation is attempted FIRST, always. `one_open_reservation_per_co` is a
     * partial unique index, so a second attempt on the same extra conflicts and changes
     * nothing — which is what makes "revise and resend five times consumes exactly one
     * credit" structural rather than remembered. Only a genuinely NEW reservation draws
     * anything down.
     */
    const purchased = rcKey ? await rcBalance(rcProject, companyId, rcKey) : null;
    const usingFree = freeLeft > 0;

    // UNKNOWN BALANCE DOES NOT BLOCK (mandate #7, and hadar: queue it, tell him, never
    // hard-refuse). A KNOWN zero does — that distinction is the whole reason `rcBalance`
    // separates 0 from null, and reading a 200-with-no-entry as "unknown" would let a
    // contractor with no credits send forever.
    if (!usingFree && purchased !== null && purchased - open <= 0) {
      return json({ ok: true, reserved: false, reason: 'no_credits', available: purchased - open });
    }

    /**
     * THE IDEMPOTENCY KEY IS PER RESERVATION, NOT PER CHANGE ORDER.
     *
     * It was `res-${coId}` and that column is UNIQUE across the whole table — so once a
     * reservation was RELEASED, re-reserving the same extra collided, and the 23505
     * branch below reported `reserved: true` while holding NOTHING. The realistic path
     * is the common one: a client declines, the contractor revises and resends, and from
     * then on that change order is sent free forever, because at signature there is no
     * OPEN reservation to consume. Reported success, reserved nothing — the worst
     * available failure. Caught by reading the rows after a release, not by testing.
     *
     * 409's own comment says what this column is for: "The spend is idempotent on this."
     * A spend belongs to ONE reservation, so the key is that reservation's identity.
     * Uniqueness per change order is a DIFFERENT rule and already has its own mechanism —
     * `one_open_reservation_per_co`, a PARTIAL index on state='OPEN', which permits
     * exactly what this needs: one open at a time, and a fresh one after a release.
     */
    const reservationId = `cr-${crypto.randomUUID()}`;
    const { error: insErr } = await db.from('credit_reservation').insert({
      id: reservationId,
      company_id: companyId,
      change_order_id: coId,
      state: 'OPEN',
      is_free: usingFree,
      idempotency_key: reservationId,
    });

    if (insErr) {
      // 23505 can now only come from `one_open_reservation_per_co` — the key above is a
      // fresh uuid and cannot collide. So it genuinely means "this extra is already
      // reserved and still open", which is success: the credit is held and nothing is
      // drawn down twice.
      if ((insErr as { code?: string }).code === '23505') {
        return json({ ok: true, reserved: true, already: true });
      }
      return json({ ok: false, error: insErr.message }, 500);
    }

    /**
     * `company_billing.free_allowance_used` IS DELIBERATELY NOT WRITTEN.
     *
     * It was maintained here until the derivation above replaced it. Keeping the write
     * would leave a number that increments on reserve and never decrements on release —
     * it already read "2 used" while the reservations said none were. A cache that is
     * wrong is worse than no cache: the first screen to render it would show a
     * contractor a free tier he had not used up.
     *
     * The column survives because 409 declared it and dropping a column is its own
     * migration; nothing reads it, and `credit_reservation` is the only account of what
     * was used.
     */
    return json({ ok: true, reserved: true, free: usingFree });
  }

  if (action === 'release') {
    const coId = (body.changeOrderId ?? '').trim();
    const reason = (body.reason ?? 'CANCELLED').trim().toUpperCase();
    if (!coId) return json({ ok: false, error: 'changeOrderId required' }, 400);
    if (!['DECLINED', 'CANCELLED', 'EXPIRED'].includes(reason)) {
      // SIGNED is deliberately not releasable here — that path consumes, and it belongs
      // to the settle trigger, not to anything a client can call.
      return json({ ok: false, error: 'bad reason' }, 400);
    }
    const { error } = await db.from('credit_reservation')
      .update({ state: 'RELEASED', closed_at: new Date().toISOString(), close_reason: reason })
      .eq('company_id', companyId).eq('change_order_id', coId).eq('state', 'OPEN');
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, released: true });
  }

  return json({ ok: false, error: 'unknown action' }, 400);
});
