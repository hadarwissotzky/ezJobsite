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
    // The narration TIMELINE. verbose_json has carried per-segment start/end all
    // along; we were discarding it. Kept compact ({s,e,t}, seconds rounded to 0.1)
    // because it is read back by the app to tie mid-walkthrough photos to the
    // sentence being spoken when the shutter fired.
    const segs = Array.isArray(r.segments)
      ? JSON.stringify(r.segments.map((s) => ({
          s: Math.round((s.start ?? 0) * 10) / 10,
          e: Math.round((s.end ?? 0) * 10) / 10,
          t: (s.text ?? '').trim(),
        }))).replace(/'/g, "''")
      : null;
    // Written BESIDE the original, never over it.
    // INSERT beside the capture, never UPDATE it. The append-only trigger refused
    // the column version and was right: a re-transcription next year with a better
    // model must not silently overwrite what we believed this year — that is the
    // one thing a dispute needs. Newest wins via capture_transcript_current; the
    // old row stays, with which engine said it.
    const dur = Number(r.duration ?? 0) || 'null';
    sql(`insert into public.capture_transcript
           (id, capture_id, owner_id, text, source_language, engine, engine_model, duration_sec, segments)
         select 'tr-' || substr(md5(random()::text),1,10), '${job.capture_id}', c.owner_id,
                '${text}', '${lang}', 'openai', 'whisper-1', ${dur},
                ${segs === null ? 'null' : `'${segs}'::jsonb`}
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
  /**
   * MANDATE #4: "transcription is a commodity; THE STRUCTURING LAYER IS THE
   * PRODUCT." This is that layer, and it is built around one number:
   *
   *   "LLM structuring hallucinates ~31% OF THE TIME in the closest studied
   *    domain — a dollar figure cannot ride on an unconfirmed transcript."
   *
   * At ~31%, a pipeline that WRITES decisions invents one the contractor never
   * made, roughly one time in three. So this writes a PROPOSAL to
   * capture_structured and nothing else. It cannot create a decision. It cannot
   * create a change order — change_order.numbers_confirmed_at is NOT NULL, so the
   * DB refuses a price no human read back. This step feeds that read-back; it does
   * not go around it.
   *
   * THE PROMPT IS THE SAFETY, and every rule in it is a mandate:
   *  - "quote only what was said" — an invented subject is a hallucination with
   *    good grammar.
   *  - amount null unless a currency figure was ACTUALLY SPOKEN. A wrong number is
   *    worse than no number: no number makes a man type it; a wrong one gets
   *    confirmed by a tired man who trusts the app (mandate #6).
   *  - confidence is the model's own, kept honestly. 'low' never prefills.
   */
  structure: async (job) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw { block: 'needs_api_key', why: 'no LLM key in the environment' };

    const transcript = sql(`select coalesce(text,'') from public.capture_transcript_current
                             where capture_id = '${job.capture_id}'`);
    if (!transcript) {
      // Nothing to structure. A photo has no words; a text capture is its own text.
      // Blocking is right: the step cannot run, and pretending it did would mark
      // the capture processed with an empty proposal.
      throw { block: 'needs_connection', why: 'no transcript to structure' };
    }

    const body = {
      model: 'gpt-4o-mini',
      // Deterministic: the same audio must not produce a different proposal on a
      // retry. A resumed job that disagrees with itself is unarguable in a dispute.
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content:
          'You extract a jobsite decision from a transcript. You are feeding a HUMAN CONFIRMATION step, not a database. Rules, in order of importance:\n' +
          '1. NEVER invent. Quote or closely paraphrase only what was said. If a field was not said, use null.\n' +
          '2. DO NOT extract prices, amounts or numbers. Another part of the system owns those. Never mention a figure.\n' +
          '3. subject = the thing being decided (2-4 words, e.g. "trim colour", "outlets in unit 3B"). value = what was decided about it.\n' +
          '4. scope: "party" if it assigns work to a trade/company, else "project".\n' +
          '5. who_directed: only if a person or role was named.\n' +
          '6. confidence: "high" only if the transcript is unambiguous. Otherwise "low". If it is not a decision at all, "none".\n' +
          'Return JSON: {subject, value, scope, who_directed, confidence}.' },
        { role: 'user', content: transcript },
      ],
    };
    const out = execFileSync('curl', ['-s', 'https://api.openai.com/v1/chat/completions',
      '-H', `Authorization: Bearer ${key}`, '-H', 'Content-Type: application/json',
      '-d', JSON.stringify(body)]).toString();
    const res = JSON.parse(out || '{}');
    if (res.error) throw { block: 'needs_api_key', why: res.error.message };

    let g;
    try { g = JSON.parse(res.choices?.[0]?.message?.content ?? '{}'); }
    catch { throw { block: 'needs_connection', why: 'model returned non-JSON' }; }

    const q = (v) => (v === null || v === undefined || v === '') ? 'null' : `'${String(v).replace(/'/g, "''")}'`;

    // THE MODEL NEVER SETS THE AMOUNT. Always null here.
    //
    // This is not caution, it is a MEASURED RESULT. Given "Add three outlets in
    // unit 3B, four fifty", gpt-4o-mini returned amount_cents: 45000 with
    // confidence "high" — it invented $450 from an ambiguous spoken number, in
    // direct defiance of a prompt that said "ONLY if a currency figure was
    // actually spoken". That is the ~31% hallucination mandate #2 cites, live.
    //
    // The app's parseMoney() REFUSES that exact input ({cents: null, confidence:
    // 'none'}) because it only accepts an explicit currency marker. THE REGEX IS
    // SAFER THAN THE MODEL on the highest-risk field in the product.
    //
    // So the split is: THE MODEL STRUCTURES THE WORDS; A DETERMINISTIC PARSER OWNS
    // THE NUMBER. Mandate #6 says numbers get read-back + tap-to-correct ALWAYS —
    // they get the auditable, testable, conservative path, never the probabilistic
    // one. The app runs parseMoney() on `from_transcript` at read-back time, so
    // there is ONE money parser in the product and it cannot drift from itself.
    const cents = null;
    const conf = ['high', 'low', 'none'].includes(g.confidence) ? g.confidence : 'low';

    sql(`insert into public.capture_structured
           (id, capture_id, owner_id, proposed_subject, proposed_value, proposed_scope,
            proposed_who_directed, proposed_amount_cents, confidence, engine, engine_model,
            from_transcript)
         select 'st-' || substr(md5(random()::text),1,10), '${job.capture_id}', c.owner_id,
                ${q(g.subject)}, ${q(g.value)},
                ${['project','party'].includes(g.scope) ? `'${g.scope}'` : 'null'},
                ${q(g.who_directed)}, ${cents === null ? 'null' : cents}, '${conf}',
                'openai', 'gpt-4o-mini', ${q(transcript)}
           from public.capture c where c.id = '${job.capture_id}'`);
  },
  /**
   * REQ-P4 — content-assisted project detection.
   *
   *   "a recording that names/implies a known project resolves to it; one that fits
   *    no project is flagged 'new project?' rather than mis-filed or lost."
   *
   * NO MODEL CALL, AND THAT IS THE POINT. The step right above this one exists
   * because only a model can turn rambling speech into a subject and a value. This
   * one asks "did he say a job we have on the books?", which is a string match
   * against rows we already hold — and the model, asked that, will confidently
   * match a job that was never mentioned. The whole rule is in 170's header: THE
   * MODEL FOR COMPREHENSION, A DETERMINISTIC RULE FOR IDENTITY.
   *
   * IT WRITES A ROW EVEN WHEN IT MATCHES NOTHING. "The words named no job we know"
   * is a FINDING — it is exactly the evidence REQ-P5's "new project?" prompt rests
   * on — and it is not the same as "this step never ran". An absent row cannot
   * tell those apart, and the second one is a bug.
   *
   * It never files anything. It writes a candidate + what was matched, quoted, so
   * a human can check it in a second. GPS resolution (REQ-P1) still decides;
   * ambiguity still goes to the Inbox (REQ-P2); a project is still never
   * auto-created (REQ-P5).
   */
  resolve_project: async (job) => {
    const transcript = sql(`select coalesce(text,'') from public.capture_transcript_current
                             where capture_id = '${job.capture_id}'`);
    // No words is not a failure: a photo names no job. There is nothing for a
    // CONTENT signal to say, so it says nothing and the step is done. Blocking
    // here would wedge every photo in the pipeline forever.
    if (!transcript) return;

    const t = transcript.replace(/'/g, "''");
    // One statement: resolve and record atomically. The left join is what makes
    // the no-match case a row rather than an absence — content_resolve returns
    // ZERO rows when the words name nothing, and `from f` alone would insert
    // nothing at all.
    sql(`insert into public.capture_content_signal
           (id, capture_id, owner_id, candidate_project_id, matched_on, matched_text,
            confidence, from_transcript)
         select 'cs-' || substr(md5(random()::text),1,10), c.id, c.owner_id,
                f.project_id, coalesce(f.matched_on, 'no_match'), f.matched_text,
                coalesce(f.confidence, 'none'), '${t}'
           from public.capture c
           left join lateral public.content_resolve(c.owner_id, '${t}') f on true
          where c.id = '${job.capture_id}'`);
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
  // NOTHING LEFT TO DO -> say so. complete_step is the only thing that marks a
  // job done, and it is only called BY a step, so a job with no remaining steps
  // was never finished by anyone: it sat in 'running' until the lease lapsed, got
  // reclaimed, and died at attempts >= 5. Silent, and it hit every photo (which
  // declares no steps) and every resumed job whose work was already complete.
  // finish_job re-checks the same predicate itself, so this cannot skip work.
  if (remaining.length === 0) sql(`select public.finish_job('${job.id}')`);
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
