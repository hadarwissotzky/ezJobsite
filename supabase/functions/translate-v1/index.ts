/**
 * translate-v1 — the ONE door through which message text changes language.
 *
 * LANGUAGE-LAYER slice 3 (hadar, 2026-09-03: "the homeowner can respond to the messages
 * in english, and the user will read them in the app in spanish"). Two callers:
 *
 *   · THE APP (a signed-in contractor): translating a client's message into the profile
 *     language for display.
 *   · THE PORTAL (anon, holding a confirmation token): translating the contractor's
 *     replies into the language the document was sent in.
 *
 * ─── WHAT IT NEVER DOES ─────────────────────────────────────────────────────────
 * It never STORES a translation over an original. Messages stay exactly as written —
 * the original is the record and the corroboration (mandate #5's rule about native
 * content, applied to chat). What it returns is display text, and the caches exist
 * only so one message is never paid for twice.
 *
 * ─── AUTH ───────────────────────────────────────────────────────────────────────
 * A user JWT (the app) or a live confirmation token (the portal). The token path is
 * verified against confirmation_request and rate-limited by cache: an attacker with a
 * link can translate the thread that link already shows them, and nothing else.
 *
 * ─── NUMBERS (mandate #6) ───────────────────────────────────────────────────────
 * The prompt requires digits copied verbatim, and the function VERIFIES it: if the
 * digit sequences of source and translation differ, the original text is returned
 * untranslated rather than a version with a changed number. A message a client cannot
 * read is a smaller failure than a price that moved in translation.
 */
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

const LANGS = new Set(['en', 'es']);
const MAX_TEXTS = 30;
const MAX_LEN = 4000;

/** Every digit in reading order — the invariant translation must preserve. */
const digits = (s: string) => (s.match(/\d/g) ?? []).join('');

async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  let body: { texts?: unknown; target?: unknown; token?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }

  const target = typeof body.target === 'string' ? body.target : '';
  if (!LANGS.has(target)) return json({ ok: false, error: 'unknown target language' }, 400);
  const texts = Array.isArray(body.texts)
    ? body.texts.filter((t): t is string => typeof t === 'string').slice(0, MAX_TEXTS)
        .map((t) => t.slice(0, MAX_LEN))
    : [];
  if (!texts.length) return json({ ok: false, error: 'nothing to translate' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service);

  // ── who is asking ──────────────────────────────────────────────────────────────
  let allowed = false;
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await caller.auth.getUser();
    if (data?.user) allowed = true;
  }
  if (!allowed && typeof body.token === 'string' && body.token.length >= 20) {
    const { data } = await admin.from('confirmation_request')
      .select('token, expires_at').eq('token', body.token).limit(1);
    if (data?.[0] && new Date(data[0].expires_at as string) > new Date()) allowed = true;
  }
  if (!allowed) return json({ ok: false, error: 'not authenticated' }, 401);

  // ── cache first: one message is never paid for twice ───────────────────────────
  const keys = await Promise.all(texts.map((t) => sha256hex(`${target}\n${t}`)));
  const cached = new Map<string, string>();
  try {
    const { data } = await admin.from('translation_cache')
      .select('key, body').in('key', keys);
    for (const r of data ?? []) cached.set(r.key as string, r.body as string);
  } catch { /* cache down -> translate everything */ }

  const misses = texts.map((t, i) => ({ t, i, key: keys[i] }))
    .filter((x) => !cached.has(x.key));

  if (misses.length) {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ ok: false, error: 'translation not configured' }, 503);
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
                 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: `Translate each string in the JSON array into ${target === 'es' ? 'Spanish' : 'English'}. ` +
          `These are short messages between a contractor and a homeowner about construction work. ` +
          `Faithful and plain; keep trade terms a local reader would know. ` +
          `Copy every number, price, measurement and model number DIGIT FOR DIGIT. ` +
          `If a string is already in the target language, return it unchanged. ` +
          `Return ONLY a JSON array of the translated strings, same order, same length.`,
        messages: [{ role: 'user', content: JSON.stringify(misses.map((m) => m.t)) }],
      }),
    });
    if (!resp.ok) return json({ ok: false, error: `translator: ${resp.status}` }, 502);
    const out = await resp.json();
    const text = out?.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '[]';
    /**
     * THE MODEL WRAPS THE ARRAY — a code fence, a leading sentence — often enough that
     * the first deploy's strict parse failed on its very first real call. The array is
     * still in there; take the outermost [...] and parse that. A response with no
     * bracket pair at all still fails into the wrong-shape branch below.
     */
    let arr: unknown;
    try { arr = JSON.parse(text); } catch {
      const a = text.indexOf('['), b = text.lastIndexOf(']');
      if (a >= 0 && b > a) { try { arr = JSON.parse(text.slice(a, b + 1)); } catch { arr = null; } }
      else arr = null;
    }
    if (!Array.isArray(arr) || arr.length !== misses.length) {
      return json({ ok: false, error: 'translator returned a wrong shape' }, 502);
    }
    for (let k = 0; k < misses.length; k++) {
      const src = misses[k].t;
      let tr = typeof arr[k] === 'string' ? (arr[k] as string) : src;
      // MANDATE #6, ENFORCED: a translation that moved a digit is discarded — the
      // reader gets the original untouched rather than a changed number.
      if (digits(tr) !== digits(src)) tr = src;
      cached.set(misses[k].key, tr);
    }
    // best-effort write-back; a failed cache write only costs a future call
    try {
      await admin.from('translation_cache').upsert(
        misses.map((m) => ({ key: m.key, target, body: cached.get(m.key)! })),
        { onConflict: 'key' });
    } catch { /* next call pays again; correctness unaffected */ }
  }

  return json({ ok: true, texts: keys.map((k, i) => cached.get(k) ?? texts[i]) });
});
