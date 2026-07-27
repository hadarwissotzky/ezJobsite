// revenuecat-webhook — the ONLY writer of company.plan.
//
// WHY THIS EXISTS. A client can never be the authority on "is paid" (sql/382, plans.ts):
// a jailbroken device would otherwise grant itself unlimited jobs. RevenueCat validates
// the App Store receipt server-side and calls this function; this function writes
// company.plan with the service-role key. The app only ever READS that column via
// PowerSync (quota.ts currentPlan), so the entitlement chain has exactly one writer.
//
// IDENTITY. billing.ts configures RevenueCat with appUserID = company.id (the owner
// pays; crew inherit). So event.app_user_id IS the company id. Aliases are tolerated:
// RevenueCat may send `original_app_user_id` / `aliases`, and we try each until one
// matches a real company row rather than silently writing nothing.
//
// SECRETS (supabase secrets set):
//   REVENUECAT_WEBHOOK_AUTH   the shared secret you type into RevenueCat's
//                             Dashboard -> Integrations -> Webhooks -> Authorization
//                             header. REQUIRED — the function refuses every request
//                             when it is unset, rather than accepting anonymous writes.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (injected by the platform)
//
// DEPLOY:  supabase functions deploy revenuecat-webhook --no-verify-jwt
//   --no-verify-jwt is REQUIRED: RevenueCat is not a Supabase user and sends no user
//   JWT. Authentication is the Authorization shared secret checked below instead.
//
// CONTRACT (POST JSON from RevenueCat):  { "event": { type, app_user_id, entitlement_ids, ... } }
//   200 { ok: true, ... }   — handled (RevenueCat stops retrying)
//   401                     — bad/missing shared secret
//   500                     — server misconfigured; RevenueCat WILL retry, which is what we want

import { createClient } from 'jsr:@supabase/supabase-js@2';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

/** Entitlement ids -> the PlanId stored on the company. Highest tier wins. */
function planFromEntitlements(ids: string[]): 'free' | 'core' | 'crew' {
  if (ids.includes('crew')) return 'crew';
  if (ids.includes('core')) return 'core';
  return 'free';
}

/**
 * Event types that REMOVE access. Everything else that carries entitlements grants it.
 * NOTE: CANCELLATION means "auto-renew turned off", NOT "access ended" — the user keeps
 * what they paid for until EXPIRATION. Treating CANCELLATION as a downgrade would rob a
 * paying customer of time they already bought.
 */
const REVOKING = new Set(['EXPIRATION', 'SUBSCRIPTION_PAUSED']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  // 1. Authenticate RevenueCat by shared secret. Unset secret => refuse loudly; an
  //    open webhook that writes entitlements is a free-subscription vulnerability.
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
  if (!expected) return json({ ok: false, error: 'server not configured (webhook auth)' }, 500);
  if ((req.headers.get('Authorization') ?? '') !== expected) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ ok: false, error: 'server not configured (supabase)' }, 500);

  let body: any;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: 'bad json' }, 400); }

  const ev = body?.event ?? {};
  const type: string = String(ev.type ?? '');
  // TEST events fire from the dashboard "Send test event" button and carry no real
  // company — acknowledge so the dashboard shows green, but write nothing.
  if (type === 'TEST') return json({ ok: true, test: true });

  const entitlements: string[] = Array.isArray(ev.entitlement_ids) ? ev.entitlement_ids
    : (ev.entitlement_id ? [String(ev.entitlement_id)] : []);
  const plan = REVOKING.has(type) ? 'free' : planFromEntitlements(entitlements);

  // Candidate ids, most-specific first. RevenueCat aliases a user across restores.
  const candidates: string[] = [ev.app_user_id, ev.original_app_user_id,
    ...(Array.isArray(ev.aliases) ? ev.aliases : [])]
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (!candidates.length) return json({ ok: false, error: 'no app_user_id' }, 400);

  const supabase = createClient(url, serviceKey);

  for (const id of candidates) {
    const { data, error } = await supabase
      .from('company')
      .update({ plan, plan_since: new Date().toISOString(), plan_source: 'revenuecat' })
      .eq('id', id)
      .select('id');
    // A DB error is NOT acknowledged: return 500 so RevenueCat retries rather than
    // dropping an entitlement change on the floor.
    if (error) return json({ ok: false, error: error.message }, 500);
    if (data && data.length) {
      return json({ ok: true, company: id, plan, event: type });
    }
  }

  // No company matched. Acknowledge (a retry would never match either) but say so
  // plainly in the response so it is visible in RevenueCat's delivery log.
  return json({ ok: true, matched: false, tried: candidates, plan, event: type });
});
