// invoices — what this company has paid for.
//
// hadar, 2026-08-18: "need to add billing section for the one that owns the account —
// display all the invoices."
//
// ─── WHY THIS READS REVENUECAT AND NOT OUR OWN DATABASE ─────────────────────────
// Because we do not have the data. `billing_event_log` (409) exists and is EMPTY — the
// RevenueCat webhook only ever updated `company.plan` and never wrote a row to it,
// verified 2026-08-18. So there is no local ledger to render, and building one now would
// still start empty: it could only ever show purchases made AFTER we started logging,
// which is the wrong first impression for a billing screen ("you have no invoices" to
// someone who paid last month).
//
// RevenueCat holds every purchase on both rails — the web packs it sells through Stripe
// and the App Store purchases it validates — keyed by the same `appUserID` the app
// already uses (`company.id`). Reading it is authoritative and needs no backfill. If a
// local mirror becomes worth having (offline access, faster lists), it should be built by
// having the webhook write `billing_event_log` and treated as a CACHE of this, not as a
// second source of truth.
//
// ─── OWNER ONLY, AND THE CHECK IS ON THE SERVER ─────────────────────────────────
// hadar asked for "the one that owns the account". A crew member is an active member of
// the company and can see the jobs; he must not see what the business pays. The predicate
// is `company.owner_id = the caller`, evaluated here with the service key — never taken
// from the request, and never left to the client to enforce.
//
// ─── SHAPE CAVEAT, STATED RATHER THAN DISCOVERED ────────────────────────────────
// No purchase has EVER been made on this project (`/purchases` returns `items: []`,
// checked against the live API today), so the field mapping below is written against
// RevenueCat's documented v2 shape and has never seen a real row. Every field is read
// defensively and anything missing renders as absent rather than as a wrong number — a
// billing screen that invents an amount is worse than one that says it does not know.
// The first real purchase is the test.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const RC = 'https://api.revenuecat.com/v2';

/** One line on the billing screen. Deliberately flat — the client renders, it does not
 *  interpret. */
type Invoice = {
  id: string;
  /** ms since epoch, or null when the provider gave us nothing we could parse. */
  atMs: number | null;
  /** What was bought, as the store names it. */
  product: string;
  /** Cents, or null for UNKNOWN — never 0, which would read as free. */
  amountCents: number | null;
  currency: string;
  /** 'app_store' | 'rc_billing' | … — decides whether we can offer a receipt link. */
  store: string;
  /** 'purchase' | 'subscription'. */
  kind: 'purchase' | 'subscription';
  /** Refunded / cancelled / active — shown verbatim rather than mapped to our own words,
   *  because the store's own status is the one a support conversation will use. */
  status: string | null;
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/**
 * RevenueCat reports money in a few shapes across endpoints and versions. Take whichever
 * is present, and return null rather than guessing a unit.
 *
 * `*_in_usd` is DOLLARS as a float in the v2 responses; a cents field is already cents.
 * Multiplying the wrong one by 100 is how a $25 pack becomes $2,500 on a screen a
 * contractor is reading to decide whether we overcharged him (mandate #6).
 */
function centsOf(o: Record<string, unknown>): number | null {
  const cents = num(o.price_in_cents) ?? num(o.amount_in_cents);
  if (cents !== null) return Math.round(cents);
  const usd = num(o.revenue_in_usd) ?? num(o.price_in_usd) ?? num(o.gross_revenue_in_usd);
  if (usd !== null) return Math.round(usd * 100);
  return null;
}

function atMsOf(o: Record<string, unknown>): number | null {
  // v2 sends epoch MILLISECONDS on most timestamps, but ISO strings appear too.
  const n = num(o.purchased_at_ms) ?? num(o.purchased_at) ?? num(o.starts_at) ?? num(o.created_at);
  if (n !== null) return n > 1e12 ? n : n * 1000;   // seconds vs ms, without guessing
  const s = str(o.purchased_at) ?? str(o.starts_at) ?? str(o.created_at);
  if (s) { const d = Date.parse(s); if (!Number.isNaN(d)) return d; }
  return null;
}

function toInvoice(o: Record<string, unknown>, kind: Invoice['kind']): Invoice {
  return {
    id: str(o.id) ?? `${kind}-${atMsOf(o) ?? '0'}`,
    atMs: atMsOf(o),
    product: str(o.product_id) ?? str((o.product as Record<string, unknown>)?.identifier)
      ?? 'Purchase',
    amountCents: centsOf(o),
    currency: (str(o.currency) ?? 'USD').toUpperCase(),
    store: str(o.store) ?? 'unknown',
    kind,
    status: str(o.status),
  };
}

async function rcList(
  path: string, key: string
): Promise<Record<string, unknown>[] | null> {
  try {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${key}` } });
    // A 404 means "this customer has bought nothing", which is an ANSWER (zero), not a
    // failure. Anything else is unknown and must not be rendered as an empty list — see
    // the caller: an error says so rather than showing "no invoices" over a real history.
    if (r.status === 404) return [];
    if (!r.ok) return null;
    const b = await r.json();
    return Array.isArray(b?.items) ? b.items : [];
  } catch {
    return null;
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
  if (!supaUrl || !anon || !service) return json({ ok: false, error: 'server not configured' }, 500);

  // WHO IS ASKING — the caller's own JWT, same as `credits`.
  const auth = req.headers.get('Authorization') ?? '';
  const asUser = createClient(supaUrl, anon, { global: { headers: { Authorization: auth } } });
  const { data: u, error: uErr } = await asUser.auth.getUser();
  if (uErr || !u?.user) return json({ ok: false, error: 'not authenticated' }, 401);

  const db = createClient(supaUrl, service);

  // WHICH COMPANY, and IS HE THE OWNER. Derived on the server from his membership, never
  // from the request body — otherwise naming another company id would read its billing.
  const { data: mem } = await db.from('company_member')
    .select('company_id').eq('user_id', u.user.id).eq('status', 'active')
    .limit(1).maybeSingle();
  const companyId = (mem as { company_id?: string } | null)?.company_id;
  if (!companyId) return json({ ok: false, error: 'no company' }, 403);

  const { data: co } = await db.from('company')
    .select('owner_id').eq('id', companyId).maybeSingle();
  const isOwner = (co as { owner_id?: string } | null)?.owner_id === u.user.id;
  // 403 with a REASON the client can render. A crew member opening a deep link to this
  // screen should be told it is the owner's, not shown a broken list.
  if (!isOwner) return json({ ok: false, error: 'not_owner' }, 403);

  if (!rcKey) return json({ ok: false, error: 'billing not configured' }, 500);

  const base = `${RC}/projects/${rcProject}/customers/${encodeURIComponent(companyId)}`;
  const [purchases, subs] = await Promise.all([
    rcList(`${base}/purchases?limit=100`, rcKey),
    rcList(`${base}/subscriptions?limit=100`, rcKey),
  ]);

  // A FAILED READ IS NOT AN EMPTY HISTORY. Conflating them would tell a contractor who
  // has paid us for a year that he has never bought anything.
  if (purchases === null && subs === null) {
    return json({ ok: false, error: 'unavailable' }, 502);
  }

  const invoices: Invoice[] = [
    ...(purchases ?? []).map((p) => toInvoice(p, 'purchase')),
    ...(subs ?? []).map((s) => toInvoice(s, 'subscription')),
  ].sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0));

  return json({
    ok: true,
    invoices,
    // Which halves we actually managed to read, so the client can say "some of this could
    // not be loaded" instead of quietly showing a short list.
    partial: purchases === null || subs === null,
  });
});
