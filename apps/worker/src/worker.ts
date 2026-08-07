/**
 * The worker that implements `140_processing_jobs`.
 *
 * WHAT THIS FIXES. `voicesource.ts` reads `capture_transcript` and
 * `voiceprice.ts` extracts a price from it, both built and both tested. NOTHING
 * WROTE THAT TABLE. R2 was recorded for weeks as "pipeline built but not
 * configured (no STT key)", which named the symptom and got the cause wrong: a
 * key alone would have changed nothing, because there was no worker and no
 * server in this repo at all.
 *
 * WHY IT IS USEFUL BEFORE THERE IS A KEY. `processing_job.blocked_reason`
 * already includes `needs_api_key`, and `block_job` already takes a reason a
 * person can act on. Parking a job with that reason is the SPECIFIED behaviour,
 * not a placeholder: `processing_backlog` then answers "what is waiting, and
 * why" — which is the office's Monday query and REQ-PROC6's source. Run it today
 * and the backlog says `needs_api_key` with a count. Supply a key and the same
 * jobs drain, because claim_job already re-claims blocked jobs whose reason may
 * have cleared.
 *
 * It uses the SERVICE ROLE. 140 revokes claim/complete/finish/block from public,
 * anon and authenticated, so this is the only identity that can advance a job —
 * which is why the worker is a server and never the app.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isComplete, pendingSteps } from './steps.ts';
import { hasSttKey, transcribe, type Transcript } from './transcribe.ts';
import { hasLlmKey, structureTranscript, STRUCTURE_MODEL,
         type StructureResult } from './structure.ts';

export type Job = {
  id: string; capture_id: string; owner_id: string; project_id: string;
  steps: string[]; completed_steps: string[];
  state: string; blocked_reason: string; attempts: number;
};

export type StepOutcome =
  | { ok: true }
  /** Park it with a reason. `retryable` decides whether it is worth another pass. */
  | { ok: false; reason: 'needs_api_key' | 'needs_connection'; error?: string };

/**
 * Run ONE step. Split out so the loop below has no knowledge of what a step
 * does, and so each step's failure is parked with its own reason rather than a
 * generic one.
 */
export async function runStep(
  sb: SupabaseClient, job: Job, step: string
): Promise<StepOutcome> {
  if (step === 'transcribe') {
    if (!hasSttKey()) return { ok: false, reason: 'needs_api_key' };
    // `capture.payload` holds the storage object key (060 inserts p_object_key
    // into it). The bucket is 'captures', matching uploader.ts. There is NO mime
    // column on the server capture table — this selected one anyway and every
    // voice job parked on "column does not exist" (2026-07-23). The key itself
    // carries the extension; derive the mime from it.
    const { data: cap, error: capErr } = await sb
      .from('capture').select('payload').eq('id', job.capture_id).single();
    if (capErr || !cap?.payload) {
      return { ok: false, reason: 'needs_connection', error: capErr?.message ?? 'no payload key' };
    }
    const ext = String(cap.payload).split('.').pop()?.toLowerCase() ?? '';
    const mime = ext === 'wav' ? 'audio/wav'
      : ext === 'mp3' ? 'audio/mpeg'
      : ext === 'caf' ? 'audio/x-caf'
      : 'audio/m4a';
    const dl = await sb.storage.from('captures').download(cap.payload);
    if (dl.error || !dl.data) {
      return { ok: false, reason: 'needs_connection', error: dl.error?.message ?? 'no audio' };
    }
    // A provider failure PARKS the job, it does not throw. A 401 from a wrong
    // key thrown out of here would leave the job 'running' until its lease
    // expired, retry five times, and never once appear in processing_backlog as
    // something a person could fix. needs_api_key with the provider's own words
    // attached is REQ-PROC6 working: "what is waiting, and why".
    let t: Transcript | null;
    try {
      t = await transcribe(await dl.data.arrayBuffer(), mime);
    } catch (e: any) {
      return { ok: false, reason: 'needs_api_key', error: String(e?.message ?? e).slice(0, 400) };
    }
    if (t === null) return { ok: false, reason: 'needs_api_key' };
    return writeTranscript(sb, job, t);
  }
  // NEEDS NO CREDENTIAL. `content_resolve` is a plain SQL function — it matches
  // the transcript against the owner's project names, addresses and client refs.
  // I had this filed under "blocked on a key" alongside the rest of the pipeline,
  // which was wrong: the only thing it needs is a transcript.
  if (step === 'resolve_project') return resolveProject(sb, job);

  if (step === 'detect_language') {
    // Not implemented against nothing: the transcribe step's provider already
    // reports the language, and writeTranscript stores it (`source_language`).
    // This step VERIFIES that fact landed rather than re-deriving it — done when
    // a transcript for this capture carries a language, parked when none does.
    const { data: tr, error: trErr } = await sb
      .from('capture_transcript').select('source_language')
      .eq('capture_id', job.capture_id)
      .order('created_at', { ascending: false }).limit(1);
    if (trErr) return { ok: false, reason: 'needs_connection', error: trErr.message };
    const lang = tr?.[0]?.source_language;
    if (typeof lang === 'string' && lang.length > 0) return { ok: true };
    return { ok: false, reason: 'needs_api_key', error: 'no transcript carries a language yet' };
  }

  if (step === 'structure') {
    if (!hasLlmKey()) return { ok: false, reason: 'needs_api_key' };
    // EVERY RECORDING BEHIND THIS EXTRA, NOT JUST THIS ONE (hadar 2026-08-06: "I can
    // see the second recording and the transcription but I cannot see that the scope of
    // work was updated").
    //
    // A contractor adds a voice note to an extra he already made — "I would like to
    // add, that the price is…" — and that clip gets its own job. Structured alone it
    // produces a scope of work describing an afterthought, because on its own that is
    // all it is. The document has to be rewritten from EVERYTHING said about this
    // extra, in the order it was said, or adding information makes the write-up worse.
    //
    // The link is `decision_version`, the one grouping that reaches the server
    // (`capture_pair` is device-only). Captures with no decision row degrade to just
    // this one, which is the pre-2026-08-06 behaviour and still correct for a first
    // recording — the fallback is a narrower input, never a wrong one.
    const text = await extraTranscript(sb, job.capture_id);
    if (!text) {
      // NOTHING WAS HEARD — and that is an ANSWER, not a failure to be retried forever
      // (hadar 2026-08-07: "I keep getting the message this is taking longer than usual
      // for every process").
      //
      // What this used to do: park with `needs_connection`. The job went to `blocked`,
      // attempts climbed, and it never completed — so the capture screen waited out its
      // full 90 seconds and told the contractor it was slow. It was not slow. Deepgram
      // had returned an empty transcript (a real, explicit answer for silence — see
      // deepgram.ts), and no amount of waiting was going to change it. A recording with
      // nothing in it and a pipeline that is merely late looked identical, and only one
      // of them is worth waiting for.
      //
      // So: record the step's honest outcome — a `confidence: 'none'` proposal, exactly
      // what a model decline produces — and finish. The app then knows the pass RAN and
      // produced nothing usable, which is a state it already draws properly ("No
      // write-up came back… you can always write it yourself"), instead of a spinner
      // that ends in a shrug.
      //
      // The distinction that matters, and why this is not "swallowing an error": a
      // MISSING transcript row means the steps ran out of order and IS parked below
      // (`typeof text !== 'string'` at the read). An EMPTY one means transcription
      // succeeded and heard nothing.
      const { error: noneErr } = await sb.from('capture_structured').insert({
        id: `st-${job.capture_id}-${Date.now()}`,
        capture_id: job.capture_id,
        owner_id: job.owner_id,
        confidence: 'none',
        engine: 'worker-claude',
        engine_model: STRUCTURE_MODEL,
        from_transcript: '',
      });
      if (noneErr) return { ok: false, reason: 'needs_connection', error: noneErr.message };
      return { ok: true };
    }
    let s: StructureResult | null;
    try {
      s = await structureTranscript(text);
    } catch (e: any) {
      // Same rule as transcribe: a provider failure PARKS the job with the
      // provider's own words attached — needs_api_key surfaces in the backlog
      // as something a person can fix.
      return { ok: false, reason: 'needs_api_key', error: String(e?.message ?? e).slice(0, 400) };
    }
    // A decline or unusable output is RECORDED as a confidence-none proposal —
    // the step ran, and "nothing usable" is its honest answer. proposals.ts
    // rule 2 then guarantees it prefills nothing.
    const { error } = await sb.from('capture_structured').insert({
      id: `st-${job.capture_id}-${Date.now()}`,
      capture_id: job.capture_id,
      owner_id: job.owner_id,
      proposed_subject: s?.subject ?? null,
      proposed_value: s?.value ?? null,
      proposed_who_directed: s?.whoDirected ?? null,
      proposed_extra_type: s?.extraType ?? null,
      // Search tags from the transcript (hadar, 2026-08-05). Stored on the PROPOSAL
      // like every other proposed field — the app decides whether to apply them,
      // because a proposal is not a record.
      proposed_tags: s?.tags?.length ? s.tags : null,
      // 393 — the scope IN SECTIONS, and the terms the narration already stated.
      // Stored as proposals like everything else here: the app renders and seeds
      // them, and a human confirms before any of it can be sent (mandate #2).
      // `proposed_value` above is the RENDERED text of exactly these sections, so
      // the two can never describe different work.
      proposed_sections: s?.sections ? {
        background: s.sections.background,
        steps: s.sections.steps,
        included: s.sections.included,
        excluded: s.sections.excluded,
        assumptions: s.sections.assumptions,
      } : null,
      proposed_schedule_effect: s?.terms.scheduleEffect ?? null,
      proposed_schedule_days: s?.terms.scheduleDays ?? null,
      proposed_billing_timing: s?.terms.billingTiming ?? null,
      // The two lists as TEXT, ready to copy into the change order's own columns.
      // Bulleted the same way `renderScope` bullets them, so what the contractor
      // reviews on the extra and what the owner reads in the instrument match.
      proposed_exclusions: s?.sections.excluded.length
        ? s.sections.excluded.map((x) => `• ${x}`).join('\n') : null,
      proposed_inclusions: s?.sections.included.length
        ? s.sections.included.map((x) => `• ${x}`).join('\n') : null,
      // Verbatim-quote task grouping (374). price_words in here is a QUOTE of
      // the transcript, never a figure — the app's parser + read-back remain
      // the only path a number takes into a field.
      proposed_tasks: s?.tasks?.length ? s.tasks.map((t) => ({
        title: t.title, scope: t.scope, materials: t.materials,
        price_words: t.priceWords, time_words: t.timeWords, start_words: t.startWords,
      })) : null,
      // proposed_amount_cents stays NULL forever from this step (mandate #6).
      confidence: s?.confidence ?? 'none',
      engine: 'worker-claude',
      engine_model: STRUCTURE_MODEL,
      from_transcript: text,
    });
    if (error) return { ok: false, reason: 'needs_connection', error: error.message };

    // APPLY IT, HERE, ONCE (394). The proposal used to be written and then left for
    // whichever client happened to open next — which meant the rule deciding what a
    // binding document says lived in the React Native app, and would have had to be
    // written a second time for the web app. `apply_proposal_v1` is that rule as a
    // single SQL predicate: draft-only, never over a human-written scope, never over an
    // answered term, never a price.
    //
    // NOT FATAL, and deliberately after the insert. The proposal is the durable
    // outcome of this step; applying it is a convenience that the next capture on this
    // extra — or a client that reads the proposal directly — can still deliver. A
    // failure here must not park a job whose real work succeeded.
    const { data: applied, error: applyErr } = await sb.rpc('apply_proposal_v1', {
      p_capture_id: job.capture_id,
    });
    if (applyErr) console.warn('[worker] apply_proposal_v1:', applyErr.message);
    else if (applied) console.log('[worker] applied proposal to its change order');

    return { ok: true };
  }

  // An unknown step (declared by a newer job shape this worker predates) parks
  // rather than "succeeds": a step that passes without doing anything marks the
  // capture processed and hands the contractor an empty card with nothing
  // saying why.
  return { ok: false, reason: 'needs_api_key' };
}

/**
 * Which job do these words point at? (170)
 *
 * WRITES THE SIGNAL EVEN WHEN IT MATCHES NOTHING. 'none' is a real, useful
 * answer — "the words point at nothing we know" — and recording it is what lets
 * a person see the capture was considered rather than skipped. Writing only on a
 * hit would leave an unresolved capture indistinguishable from one the worker
 * never reached.
 *
 * It is a SIGNAL, never a filing decision. The column is `candidate_project_id`
 * and mandate #8 is suggest-never-decide: nothing here moves a capture between
 * jobs.
 */
async function resolveProject(sb: SupabaseClient, job: Job): Promise<StepOutcome> {
  // Newest transcript wins: 150 is append-only, so a re-transcribe is a NEW row
  // and the latest is the current reading.
  const { data: tr, error: trErr } = await sb
    .from('capture_transcript').select('text')
    .eq('capture_id', job.capture_id)
    .order('created_at', { ascending: false }).limit(1);
  if (trErr) return { ok: false, reason: 'needs_connection', error: trErr.message };

  const text = tr?.[0]?.text;
  // No transcript yet means the step is out of order, not that it failed. Park
  // it rather than writing a 'none' signal derived from nothing — a signal that
  // says "matched nothing" when nothing was READ is a lie about evidence.
  if (typeof text !== 'string') {
    return { ok: false, reason: 'needs_api_key', error: 'no transcript to resolve against' };
  }

  const { data: hits, error } = await sb.rpc('content_resolve', {
    p_owner: job.owner_id, p_transcript: text,
  });
  if (error) return { ok: false, reason: 'needs_connection', error: error.message };

  const hit = (Array.isArray(hits) ? hits[0] : hits) ?? null;
  const ins = await sb.from('capture_content_signal').insert({
    id: `sig-${job.capture_id}-${Date.now()}`,
    capture_id: job.capture_id,
    owner_id: job.owner_id,
    candidate_project_id: hit?.project_id ?? null,
    matched_on: hit?.matched_on ?? null,
    matched_text: hit?.matched_text ?? null,
    // The check constraint allows high/low/none only. content_resolve returns
    // 'none' for both "no match" and "ambiguous"; anything unexpected becomes
    // 'none' rather than violating the constraint and failing the whole job.
    confidence: ['high', 'low', 'none'].includes(hit?.confidence) ? hit.confidence : 'none',
    from_transcript: text.slice(0, 2000),
  });
  if (ins.error) return { ok: false, reason: 'needs_connection', error: ins.error.message };
  return { ok: true };
}

/**
 * Transcripts are append-only (150's trigger blocks UPDATE and DELETE), so this
 * inserts and never upserts. Re-transcribing means a NEW row, which is why the
 * table is read newest-first.
 */
async function writeTranscript(
  sb: SupabaseClient, job: Job, t: Transcript
): Promise<StepOutcome> {
  const { error } = await sb.from('capture_transcript').insert({
    id: `tr-${job.capture_id}-${t.engine}-${Date.now()}`,
    capture_id: job.capture_id,
    owner_id: job.owner_id,
    text: t.text,
    source_language: t.language,
    engine: t.engine,
    engine_model: t.model,
    duration_sec: t.durationSec,
  });
  if (error) return { ok: false, reason: 'needs_connection', error: error.message };
  return { ok: true };
}

/**
 * Claim one job and advance it as far as it can go.
 *
 * `complete_step` is called after EACH step, never once at the end. That is the
 * whole point of the design: recording only at the end means every crash re-runs
 * a paid API call.
 *
 * Returns what happened so the caller can log it. Never throws on a job-level
 * failure — a worker that dies on one bad capture stops processing every other
 * capture behind it.
 */
export async function runOnce(
  sb: SupabaseClient, workerId: string
): Promise<{ claimed: boolean; jobId?: string; done?: boolean; blocked?: string }> {
  const { data, error } = await sb.rpc('claim_job', {
    p_worker: workerId, p_lease_seconds: 120,
  });
  if (error) throw error;                    // a claim failure is infrastructure
  const job = (Array.isArray(data) ? data[0] : data) as Job | null;
  if (!job || !job.id) return { claimed: false };

  for (const step of pendingSteps(job.steps ?? [], job.completed_steps ?? [])) {
    const out = await runStep(sb, job, step);
    if (!out.ok) {
      await sb.rpc('block_job', {
        p_job: job.id, p_reason: out.reason, p_error: out.error ?? null,
      });
      return { claimed: true, jobId: job.id, blocked: out.reason };
    }
    await sb.rpc('complete_step', { p_job: job.id, p_step: step });
    job.completed_steps = [...(job.completed_steps ?? []), step];
  }

  if (isComplete(job.steps ?? [], job.completed_steps ?? [])) {
    // finish_job re-checks the same condition server-side and refuses silently
    // if work is outstanding. Calling it is a request, not an assertion.
    await sb.rpc('finish_job', { p_job: job.id });
    return { claimed: true, jobId: job.id, done: true };
  }
  return { claimed: true, jobId: job.id };
}

export function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'worker needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
      'The anon key cannot advance a job: 140 revokes claim_job from anon.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}


/**
 * The transcript of the WHOLE extra this capture belongs to, oldest first.
 *
 * Two reads rather than a join: PostgREST cannot join `capture_transcript` to
 * `decision_version` without a declared relationship, and inventing one in the schema
 * to save a round-trip on a background job is a bad trade.
 *
 * ORDER IS CHRONOLOGICAL AND LOAD-BEARING. The model is told to write steps "in the
 * order the work happens", and the contractor's own sequence is the only evidence of
 * that order. Sorting by anything else would silently rearrange the job.
 *
 * Each clip is separated by a blank line and nothing else — no "RECORDING 2" heading.
 * The model is writing one document about one piece of work; telling it there were two
 * sessions invites it to structure the output around the recordings instead of around
 * the work.
 */
async function extraTranscript(sb: SupabaseClient, captureId: string): Promise<string> {
  const one = async (id: string) => {
    const { data } = await sb.from('capture_transcript').select('text')
      .eq('capture_id', id).order('created_at', { ascending: false }).limit(1);
    return (data?.[0]?.text ?? '').trim();
  };
  // Which decision is this capture part of?
  const { data: mine } = await sb.from('decision_version').select('decision_id')
    .eq('capture_id', captureId).limit(1);
  const decisionId = mine?.[0]?.decision_id;
  if (!decisionId) return one(captureId);

  const { data: sibs } = await sb.from('decision_version')
    .select('capture_id, created_at_ms')
    .eq('decision_id', decisionId)
    .order('created_at_ms', { ascending: true });
  const ids = [...new Set((sibs ?? [])
    .map((r: any) => r.capture_id).filter((x: unknown): x is string => !!x))];
  if (ids.length <= 1) return one(captureId);

  const parts: string[] = [];
  for (const id of ids) {
    const t = await one(id);
    if (t) parts.push(t);
  }
  // A group whose transcripts have all vanished still has this capture's own words —
  // never return empty when a single read would have answered.
  return parts.length ? parts.join('\n\n') : one(captureId);
}
