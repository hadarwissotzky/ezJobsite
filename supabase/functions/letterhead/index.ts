// letterhead — the contractor's logo, for the no-login approval page.
//
// hadar, 2026-08-18: he had uploaded a logo and could not tell whether it was doing
// anything. It saved correctly (`company.logo_key` + the Storage object both landed);
// it reached nothing. The client opening a link to authorise $1,800 saw a grey tile with
// two initials in it.
//
// ─── WHY THIS NEEDS A SERVER AT ALL ─────────────────────────────────────────────
// `confirmation_company_v1` already returns `logo_key`, and has since 402. A key is not
// an image: the object lives in the private `captures` bucket, and the approval page runs
// as `anon` with no rights to it. Postgres cannot mint a signed Storage URL, so the RPC
// could never have closed this gap on its own. This is the smallest thing that can — a
// function holding the service key, which signs one object and returns one URL.
//
// ─── WHY NOT FREEZE THE URL AT SEND TIME, LIKE THE PHOTOS ───────────────────────
// `approvalphotopublish.ts` mints 45-day signed URLs when the change order is sent, and
// stores them on the approval record. That is right for PHOTOGRAPHS: they are evidence of
// the work, and what the client saw must not change afterwards.
//
// A letterhead is not evidence. It is who is asking. Freezing it would also mean every
// change order already sent — including the ones sitting in clients' text messages right
// now — keeps its blank tile forever, because nothing would ever go back and fill it.
// Minting on read fixes those retroactively, which is the entire point of doing it today.
//
// The trade-off, stated rather than discovered: a contractor who changes his logo changes
// it on documents already sent. For a brand mark that is the expected behaviour (it is
// the same mark on his truck), and `companylogo.ts` already refuses to DELETE the old
// object precisely so nothing that was signed loses its picture.
//
// ─── WHAT A LINK-HOLDER GAINS ───────────────────────────────────────────────────
// `docs/CLIENT-PORTAL.md` asks what an attacker holding a link can do. With this: fetch
// the contractor's company logo. That is a public-facing brand mark, and the holder of
// this token can already read the whole change order, its price, the jobsite address and
// every photograph attached to it. No new class of data is exposed.
//
// THE TOKEN IS STILL CHECKED. Not because the logo is sensitive, but because an endpoint
// that signs a Storage object for anyone who asks is one refactor away from signing a
// different object for anyone who asks.
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

const BUCKET = 'captures';
/** One hour. The page mints this on load and uses it immediately; a long-lived URL here
 *  would be a link that outlives the visit for no benefit. */
const TTL_SEC = 3600;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let token = '';
  try {
    const body = await req.json();
    token = String(body?.token ?? '').trim();
  } catch { /* an unreadable body is a missing token */ }
  if (!token) return json({ ok: false, error: 'no token' }, 400);

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ ok: false, error: 'not configured' }, 500);
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // THE EXISTING LOOKUP, CALLED — not re-expressed here.
  //
  // Finding "the company behind this token" is not one join: `project.company_id` is null
  // on every project created before company membership existed, and there is a documented
  // fallback to the sender's own company that is the only reason those documents have a
  // letterhead at all. 408's header records that the first draft of THAT migration
  // rewrote the function from memory and silently dropped exactly this. Copying the
  // lookup into a second language would be the same mistake with a longer fuse.
  const { data, error } = await sb.rpc('confirmation_company_v1', { p_token: token });
  if (error) return json({ ok: false, error: error.message }, 500);

  const company = (data as Record<string, unknown> | null)?.company as
    Record<string, unknown> | null | undefined;
  // An unknown or expired token returns {} from the RPC. Reported as "no logo" rather
  // than as an error: the page must render the document either way, and a 404 here would
  // put a console error in front of a homeowner for a missing picture.
  const logoKey = typeof company?.logo_key === 'string' ? company.logo_key : '';
  if (!logoKey) return json({ ok: true, logoUrl: null });

  // RESIZED SERVER-SIDE, and this is not a micro-optimisation.
  //
  // The logo on this page is drawn at 46 CSS pixels. The real one on the live account is
  // a 1.6 MB JPEG — measured, not assumed — because it comes straight out of the phone's
  // photo library and there is no image resizer in the app to shrink it (adding one means
  // a native rebuild). This page states a 3-second budget for a homeowner on a jobsite
  // connection; a 1.6 MB decoration would eat most of it before the price rendered.
  //
  // Same lever `approvalphotopublish.ts` pulls for the photographs, for the same reason
  // and with the same fallback: the transform is a storage-tier feature and CAN 400, so a
  // failure returns the untransformed object rather than no logo.
  const small = await sb.storage.from(BUCKET).createSignedUrl(logoKey, TTL_SEC, {
    transform: { width: 240, height: 240, resize: 'contain', quality: 80 },
  });
  if (small.data?.signedUrl) return json({ ok: true, logoUrl: small.data.signedUrl });

  const plain = await sb.storage.from(BUCKET).createSignedUrl(logoKey, TTL_SEC);
  if (plain.error || !plain.data?.signedUrl) return json({ ok: true, logoUrl: null });
  return json({ ok: true, logoUrl: plain.data.signedUrl });
});
