#!/usr/bin/env node
/**
 * The processing worker — REQ-PROC1's runtime half.
 *
 * ARCHITECTURE (ADR-3/ADR-5): the multi-step pipeline lives in a durable-jobs
 * runtime, "NEVER a synchronous Edge Function (no retry/resume there)". This is
 * that runtime's loop: claim a leased job, run its remaining steps, record each one
 * as it finishes.
 *
 * WHY THIS EXISTS WITH NO API KEY:
 * the gap between "needs an LLM key" and "add a key and it works" is this loop, and
 * a loop is not something you want to write for the first time while also debugging
 * someone's API. So the STEPS ARE PLUGGABLE and ship with stubs. Swapping a stub for
 * a real call is one function; if the loop were missing, a key would buy nothing.
 *
 * WHAT THE STUBS DO AND DO NOT DO:
 * a stub does NOT fabricate a transcript. It BLOCKS the job with
 * `needs_api_key` — the job stays in the queue, visible in processing_backlog, and
 * the capture never reaches `processed`. That is the honest behaviour: a state
 * claiming work that never happened is exactly what server-owned processing_state
 * exists to prevent. A stub that returned "lorem ipsum" would be a lie that looks
 * like a feature.
 *
 * RUN:  node services/worker/worker.mjs [--once] [--stub]
 *   --once  drain what is claimable and exit (what CI would run)
 *   --stub  run the fake steps, to prove the LOOP without a key
 *
 * CREDENTIAL: connects as the Postgres owner. claim_job/complete_step/block_job are
 * REVOKED from anon and authenticated precisely so only a server-side worker can
 * advance a job — a client that could call complete_step could claim work it never
 * did.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const env = (k) => {
  const line = readFileSync(root + '.env', 'utf8').split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.slice(k.length + 1).replace(/^['"]|['"]$/g, '').trim() : '';
};
const REF = env('EXPO_PUBLIC_SUPABASE_URL').match(/https:\/\/([^.]+)\./)?.[1];
const CONN = `postgresql://postgres.${REF}@${env('SUPABASE_DB_HOST')}:5432/postgres`;

const sql = (q) =>
  execFileSync('psql', [CONN, '-At', '-c', q],
    { env: { ...process.env, PGPASSWORD: env('SUPABASE_DB_PASSWORD') } }).toString().trim();

const WORKER_ID = `worker-${process.pid}`;
const STUB = process.argv.includes('--stub');
const ONCE = process.argv.includes('--once');

/**
 * The steps. Each returns nothing and throws to fail.
 *
 * Adding a real transcriber is: replace this function's body with a fetch to
 * Deepgram/Whisper and write the result. The signature is what the loop depends on;
 * the model is not.
 */
const STEPS = {
  /**
   * REQ-PROC3 — transcribe + RETAIN THE ORIGINAL.
   *
   * "the original recording + source-language transcript are retained immutably"
   * The original is never touched: we download it, send a copy, and write the
   * transcript BESIDE it. The audio in Storage is the evidence; the transcript is
   * a derivative, and mandate #1's immutability applies to the former.
   *
   * GATED ON EXPLICIT CONSENT (PIPELINE_SEND_AUDIO_TO_OPENAI=yes), and that is not
   * ceremony: this uploads a contractor's jobsite audio — which may contain a
   * client's voice, recorded under REQ-CON1's consent regime — to a third party.
   * The mere PRESENCE of an API key is not permission to send someone's recordings
   * anywhere. A key set up for one purpose is not consent for another.
   */
  transcribe: async (job) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw { block: 'needs_api_key', why: 'no STT key in the environment' };
    if (process.env.PIPELINE_SEND_AUDIO_TO_OPENAI !== 'yes') {
      throw { block: 'needs_api_key',
              why: 'a key is present but sending audio to a third party is not enabled — set PIPELINE_SEND_AUDIO_TO_OPENAI=yes' };
    }

    // The object key lives in capture.payload (a spike-era column name; see
    // IMPLEMENTATION_NOTES §5). Signed for a moment, downloaded, sent, discarded.
    const objectKey = sql(`select payload from public.capture where id = '${job.capture_id}'`);
    if (!objectKey) throw { block: 'needs_connection', why: 'no object key on the capture' };

    const url = env('EXPO_PUBLIC_SUPABASE_URL');
    const anon = env('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    // Sign in as the OWNER rather than using SUPABASE_SERVICE_ROLE_KEY.
    // The service-role key bypasses RLS entirely; the owner's session is the
    // weaker credential that suffices, so a leaked worker cannot read every
    // tenant's media. (It is also an unfilled placeholder in .env — the first cut
    // used it and blocked with "could not sign the media URL", which was the
    // adapter refusing rather than faking. Correct behaviour, wrong credential.)
    const auth = JSON.parse(execFileSync('curl', ['-s', '-X', 'POST',
      `${url}/auth/v1/token?grant_type=password`,
      '-H', `apikey: ${anon}`, '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ email: env('WORKER_EMAIL') || 'device1@example.com',
                             password: env('WORKER_PASSWORD') || 'bakeoff-spike-pw-2026' })
    ]).toString() || '{}');
    if (!auth.access_token) throw { block: 'needs_connection', why: 'worker could not sign in' };

    const signed = JSON.parse(execFileSync('curl', ['-s', '-X', 'POST',
      `${url}/storage/v1/object/sign/captures/${objectKey}`,
      '-H', `apikey: ${anon}`,
      '-H', `Authorization: Bearer ${auth.access_token}`,
      '-H', 'Content-Type: application/json', '-d', '{"expiresIn":120}']).toString() || '{}');
    if (!signed.signedURL) {
      throw { block: 'needs_connection', why: `could not sign the media URL: ${signed.error ?? signed.message ?? '?'}` };
    }

    // THE EXTENSION MATTERS, for the third time this session. The temp file was
    // `/tmp/ez-<id>` with no extension, so the API could not infer the format:
    //   "Unrecognized file format. Supported formats: [flac, m4a, mp3, ...]"
    // Same class as the local `.bin` bug and the Storage-key bug: a file whose
    // NAME does not declare what it is. The object key already carries the right
    // extension — because performCapture derives it from the mime — so use it
    // rather than invent one.
    const ext = objectKey.split('.').pop() || 'wav';
    const tmp = `/tmp/ez-${job.capture_id}.${ext}`;
    execFileSync('curl', ['-s', '-o', tmp, `${url}/storage/v1${signed.signedURL}`]);
    const out = execFileSync('curl', ['-s', 'https://api.openai.com/v1/audio/transcriptions',
      '-H', `Authorization: Bearer ${key}`,
      '-F', `file=@${tmp}`, '-F', 'model=whisper-1',
      // Ask for the language back: REQ-PROC5 needs the SOURCE language recorded,
      // and whisper detects it, so a second detect_language call is waste.
      '-F', 'response_format=verbose_json']).toString();
    const r = JSON.parse(out || '{}');
    if (r.error) throw { block: 'needs_api_key', why: r.error.message };

    const text = (r.text ?? '').replace(/'/g, "''");
    const lang = (r.language ?? '').replace(/'/g, "''");
    // Written BESIDE the original, never over it.
    // INSERT beside the capture, never UPDATE it. The append-only trigger refused
    // the column version and was right: a re-transcription next year with a better
    // model must not silently overwrite what we believed this year — that is the
    // one thing a dispute needs. Newest wins via capture_transcript_current; the
    // old row stays, with which engine said it.
    const dur = Number(r.duration ?? 0) || 'null';
    sql(`insert into public.capture_transcript
           (id, capture_id, owner_id, text, source_language, engine, engine_model, duration_sec)
         select 'tr-' || substr(md5(random()::text),1,10), '${job.capture_id}', c.owner_id,
                '${text}', '${lang}', 'openai', 'whisper-1', ${dur}
           from public.capture c where c.id = '${job.capture_id}'`);
  },
  /**
   * REQ-PROC5's detection half. Whisper returns the language WITH the text, so if
   * transcribe already recorded it there is nothing to do and nothing to pay for.
   * A second model call to learn a fact we were already told is waste, and it is
   * the kind of waste that only shows up on the bill.
   */
  detect_language: async (job) => {
    const got = sql(`select coalesce(source_language,'') from public.capture_transcript_current
                      where capture_id = '${job.capture_id}'`);
    if (got) return;                       // already known, free
    // Text captures have no audio to detect from. Their language needs a real
    // call, and that adapter is not written — say so rather than guess 'english'.
    throw { block: 'needs_api_key', why: 'no language on the capture and no text-detector adapter' };
  },
  structure: async (job) => {
    if (!process.env.OPENAI_API_KEY) {
      throw { block: 'needs_api_key', why: 'no LLM key in the environment' };
    }
    throw { block: 'needs_api_key', why: 'structurer not implemented — key present but no adapter' };
  },
};

/** Stubs exist ONLY to prove the loop. They do no work and claim none. */
const STUB_STEPS = Object.fromEntries(Object.keys(STEPS).map((k) => [k, async () => {}]));

async function runOnce() {
  const impl = STUB ? STUB_STEPS : STEPS;
  // `select row_to_json(j) from claim_job(...) j` returns A ROW OF NULLS when the
  // function returns NULL — not an empty result. The first cut treated that as a
  // job with a null id and looped on it forever, "handling" work that did not
  // exist. Ask for the id and require it.
  const row = sql(`select coalesce(row_to_json(j)::text, '') from public.claim_job('${WORKER_ID}') j`);
  if (!row) return null;
  const job = JSON.parse(row);
  if (!job?.id) return null;   // no work. Not a job with no name.
  const done = new Set(job.completed_steps ?? []);
  // RESUME: only the steps not already recorded. A job that died after
  // transcribing must not transcribe again — that is a paid call and a different
  // answer for the same audio.
  const remaining = (job.steps ?? []).filter((s) => !done.has(s));

  for (const step of remaining) {
    try {
      await impl[step](job);
      // Recorded PER STEP, not at the end. That is what makes a crash resumable.
      sql(`select public.complete_step('${job.id}', '${step}')`);
    } catch (e) {
      const reason = e?.block ?? 'needs_connection';
      const why = String(e?.why ?? e?.message ?? e).replace(/'/g, "''").slice(0, 200);
      sql(`select public.block_job('${job.id}', '${reason}', '${why}')`);
      return { job: job.id, blocked: reason, why };
    }
  }
  return { job: job.id, done: remaining };
}

async function main() {
  console.log(`${WORKER_ID} ${STUB ? '(STUB steps — proving the loop, doing no work)' : ''}`);
  let n = 0;
  for (;;) {
    const r = await runOnce();
    if (r) { n++; console.log(' ', JSON.stringify(r)); }
    else if (ONCE) break;
    else await new Promise((s) => setTimeout(s, 2000));
    if (ONCE && n > 200) break;   // a drain, not a life sentence
  }
  console.log(`handled ${n} job(s)`);
  console.log(sql(`select string_agg(state || '/' || blocked_reason || ': ' || n, '  ')
                     from public.processing_backlog`) || '  backlog empty');
}
main().catch((e) => { console.error(e); process.exit(1); });
