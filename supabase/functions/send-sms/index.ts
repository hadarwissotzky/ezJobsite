// send-sms — deliver an approval link (or an invite) by SMS via Twilio.
//
// WHY AN EDGE FUNCTION. The Twilio credentials must never reach the client (mandate:
// keys in server secrets, never in the app). The client holds only the user's JWT and
// asks this function to send; the function authenticates the caller, then calls Twilio
// with the secrets. This is the "structuring layer is the product, transport is a
// commodity" split applied to delivery.
//
// SECRETS (set with `supabase secrets set` — hadar supplies the values):
//   TWILIO_ACCOUNT_SID   · TWILIO_AUTH_TOKEN   · TWILIO_FROM  (an E.164 number or a
//   Messaging Service SID starting 'MG', in which case it is sent as MessagingServiceSid)
//
// DEPLOY:  supabase functions deploy send-sms
//
// CONTRACT (POST JSON):  { "to": "+14155551234", "body": "…link…" }
//   200 { ok: true, sid }         — queued at Twilio
//   4xx { ok: false, error }      — bad input / not configured / Twilio rejected
//
// SAFETY. The function refuses to send if it is not configured (no silent no-op),
// validates the destination is a plausible phone, and never echoes the credentials.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  // 1. Authenticate the caller — only a signed-in user may send.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supaUrl || !anon) return json({ ok: false, error: 'server not configured (supabase)' }, 500);
  const supabase = createClient(supaUrl, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: 'not authenticated' }, 401);

  // 2. Validate input.
  let payload: { to?: string; body?: string; sid?: string };
  try { payload = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }

  /**
   * STATUS LOOKUP — `{ sid: "SM..." }` instead of `{ to, body }`.
   *
   * WHY IT IS HERE. Twilio's create call returns `queued`, which means "we accepted
   * it", NOT "the handset got it". Everything after that — carrier filtering, an
   * unverified trial destination, A2P 10DLC rejection — lands minutes later on the
   * message resource and NOWHERE ELSE. Without this, "Twilio said ok and the text
   * never arrived" is a dead end that can only be resolved by a human reading the
   * Twilio console (hadar was asked twice; that is the wrong place to put the work).
   *
   * It is READ-ONLY and sends nothing. Same auth as a send — a message SID is not a
   * secret, but the numbers and bodies inside it are, so this must not be open.
   */
  /**
   * REGISTRATION STATE — `{ diag: true }`.
   *
   * Read-only, sends nothing, same auth as everything else here. It exists because
   * "still 30034" is a symptom, not a diagnosis: A2P is a THREE-step chain (brand →
   * campaign → number attached to the campaign's Messaging Service) and a carrier
   * rejection looks identical whichever step is missing. Without this, every attempt
   * ends with a human being asked to go read a console — which is where the work does
   * not belong (hadar was asked three times).
   *
   * Returns only status fields. No message bodies, no destinations.
   */
  if ((payload as { diag?: boolean }).diag === true) {
    const sid1 = Deno.env.get('TWILIO_ACCOUNT_SID');
    const token1 = Deno.env.get('TWILIO_AUTH_TOKEN');
    const from1 = Deno.env.get('TWILIO_FROM') ?? '';
    if (!sid1 || !token1) return json({ ok: false, error: 'SMS not configured' }, 503);
    const auth = { Authorization: 'Basic ' + btoa(`${sid1}:${token1}`) };
    const get = async (u: string) => {
      try {
        const r = await fetch(u, { headers: auth });
        return await r.json();
      } catch (e) { return { error: String(e) }; }
    };
    const brands = await get('https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=5');
    const svcs = await get('https://messaging.twilio.com/v1/Services?PageSize=5');
    const services = (svcs?.services ?? []) as Array<{ sid: string; friendly_name: string }>;
    // Per service: its campaign (us_app_to_person) and its attached numbers. The
    // campaign is the step that actually clears 30034.
    const detail = [];
    for (const sv of services.slice(0, 5)) {
      const camp = await get(`https://messaging.twilio.com/v1/Services/${sv.sid}/Compliance/Usa2p`);
      const nums = await get(`https://messaging.twilio.com/v1/Services/${sv.sid}/PhoneNumbers?PageSize=20`);
      detail.push({
        service: sv.sid, name: sv.friendly_name,
        campaigns: (camp?.compliance ?? []).map((c: Record<string, unknown>) => ({
          sid: c.sid, status: c.campaign_status, useCase: c.us_app_to_person_usecase,
          errors: c.errors,
        })),
        numbers: (nums?.phone_numbers ?? []).map((n: Record<string, unknown>) => n.phone_number),
      });
    }
    return json({
      ok: true,
      // Which of the two shapes TWILIO_FROM is. An MG SID means a Messaging Service
      // (campaign-aware); a bare number sends outside any campaign, which is 30034.
      from: from1.startsWith('MG') ? { kind: 'messaging_service', sid: from1 }
                                   : { kind: 'raw_number', number: from1 },
      brands: (brands?.data ?? []).map((b: Record<string, unknown>) => ({
        sid: b.sid, status: b.status, type: b.brand_type ?? b.entity_type,
        failureReason: b.failure_reason,
      })),
      services: detail,
    });
  }

  const lookupSid = (payload.sid ?? '').trim();
  if (lookupSid) {
    if (!/^SM[0-9a-f]{32}$/i.test(lookupSid)) {
      return json({ ok: false, error: 'not a message sid' }, 400);
    }
    const sid0 = Deno.env.get('TWILIO_ACCOUNT_SID');
    const token0 = Deno.env.get('TWILIO_AUTH_TOKEN');
    if (!sid0 || !token0) return json({ ok: false, error: 'SMS not configured' }, 503);
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid0}/Messages/${lookupSid}.json`,
      { headers: { Authorization: 'Basic ' + btoa(`${sid0}:${token0}`) } });
    const m = await r.json().catch(() => ({}));
    if (!r.ok) return json({ ok: false, error: m?.message ?? `twilio ${r.status}` }, 502);
    return json({
      ok: true, sid: m?.sid ?? null, status: m?.status ?? null,
      // THE TWO FIELDS THAT ACTUALLY EXPLAIN A MISSING TEXT. 21608 = trial account,
      // destination not verified. 30034 = A2P 10DLC unregistered, carrier-filtered.
      errorCode: m?.error_code ?? null, errorMessage: m?.error_message ?? null,
      to: m?.to ?? null, from: m?.from ?? null,
    });
  }
  const to = (payload.to ?? '').trim();
  const body = (payload.body ?? '').trim();
  if (!/^\+?[0-9\s\-().]{7,20}$/.test(to)) return json({ ok: false, error: 'invalid destination' }, 400);
  if (!body) return json({ ok: false, error: 'empty message' }, 400);
  const e164 = to.startsWith('+') ? to.replace(/[^\d+]/g, '') : '+1' + to.replace(/[^\d]/g, ''); // default US

  // 3. Twilio.
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_FROM');
  if (!sid || !token || !from) {
    return json({ ok: false, error: 'SMS not configured (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)' }, 503);
  }
  const form = new URLSearchParams();
  form.set('To', e164);
  form.set('Body', body);
  if (from.startsWith('MG')) form.set('MessagingServiceSid', from); else form.set('From', from);

  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const out = await resp.json().catch(() => ({}));
  if (!resp.ok) return json({ ok: false, error: out?.message ?? `twilio ${resp.status}` }, 502);
  // `status` rides back with the SID. It is 'queued' or 'accepted' here and NEVER
  // 'delivered' — the delivery verdict arrives later and is read with the sid lookup
  // above. Returned so the caller never has to guess which of the two it holds.
  return json({ ok: true, sid: out?.sid ?? null, status: out?.status ?? null });
});
